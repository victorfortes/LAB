import type { AstreaHint } from '../domain/types.ts';

/**
 * Parsers PUROS (sem navegador) do texto exibido pelo Astrea. Formatos observados em 2026-10-21
 * (docs/ASTREA-MAP.md). Se um campo obrigatório não for encontrado, lançam ParseError: nunca
 * inventam valores.
 */
export class ParseError extends Error {}

const MONTHS: Record<string, string> = { jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06', jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12' };
const CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/;

export const brToIso = (d: string): string => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  if (!m) throw new ParseError(`data inválida: "${d}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
};

/** "sex, 13 de nov 2026" / "Sex, 13 De Nov 2026" → 2026-11-13 */
export function parsePtShortDate(s: string): string | null {
  const m = /(\d{1,2})\s+de\s+([a-zç]{3})[a-z]*\.?\s+(\d{4})/i.exec(s);
  const mm = m ? MONTHS[m[2]!.toLowerCase()] : undefined;
  return m && mm ? `${m[3]}-${mm}-${m[1]!.padStart(2, '0')}` : null;
}

export interface ListRow {
  divulgadoEm: string; // ISO
  publicadoEm: string | null; // ISO
  processNumber: string;
  caseName: string | null;
  responsible: string | null;
  untreated: boolean;
  snippet: string;
  hints: AstreaHint[];
  /** Assinatura estável para reconferir a linha depois de recarregar a lista. */
  signature: string;
}

export function parseListRow(articleText: string): ListRow {
  const lines = articleText.split('\n').map((l) => l.trim()).filter(Boolean);
  const dm = lines.find((l) => /^\d{2}\/\d{2}\/\d{4}$/.test(l));
  const process = CNJ.exec(articleText)?.[0] ?? /\b\d{6,7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/.exec(articleText)?.[0];
  if (!dm || !process) throw new ParseError('linha da lista sem data/processo');
  const pub = /Publicado em:\s*(\d{2}\/\d{2}\/\d{4})/.exec(articleText)?.[1];
  const resp = /Responsável:\s*(.+)/.exec(articleText)?.[1]?.trim() ?? null;
  const snippet = lines.find((l) => l.startsWith('Publicação Processo:')) ?? '';
  const caseName = lines[lines.findIndex((l) => l.includes(process)) + 1] ?? null;
  const hints: AstreaHint[] = [];
  // innerText devolve MAIÚSCULAS (text-transform do CSS): a busca é case-insensitive.
  for (const m of articleText.matchAll(/Adicionar um prazo para\s+(.+)/gi)) {
    const due = parsePtShortDate(m[1]!);
    if (due) hints.push({ title: null, dueDate: due, responsible: null });
  }
  return {
    divulgadoEm: brToIso(dm), publicadoEm: pub ? brToIso(pub) : null, processNumber: process, caseName,
    responsible: resp, untreated: /Não tratada/i.test(articleText), snippet, hints,
    signature: `${dm}|${process}|${snippet.slice(0, 120)}`,
  };
}

export interface DetailParsed {
  processNumber: string;
  availabilityDate: string; // ISO — "Data de disponibilização"
  publishedDate: string | null;
  diary: string | null;
  clientName: string | null;
  responsible: string | null;
  fullText: string;
  untreated: boolean;
  hints: AstreaHint[];
}

// O fim do texto da publicação é onde começam os controles da tela. Atenção: uma linha avulsa "IA" (selo) aparece
// NO MEIO do texto real e não é marcador de fim (observado em conta real, 2026-10-21).
const END_MARKERS = [/^VOLTAR$/m, /^PROCESSO$/m, /^TRATAMENTOS SUGERIDOS/im];

export function parseDetail(mainText: string): DetailParsed {
  const text = mainText.replace(/\r/g, '');
  const process = /Processo:\s*(\d{6,7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/.exec(text)?.[1];
  const div = /Divulgado em:\s*(\d{2}\/\d{2}\/\d{4})/.exec(text)?.[1];
  const disp = /Data de disponibiliza[cç][aã]o:\s*(\d{2}\/\d{2}\/\d{4})/.exec(text)?.[1] ?? div;
  const pub = /Publicado em:\s*(\d{2}\/\d{2}\/\d{4})/.exec(text)?.[1];
  if (!process || !disp) throw new ParseError('detalhe sem processo/data de disponibilização');

  // Texto integral: do bloco "Publicação\nProcesso:" até o próximo marcador da tela (IA / PROCESSO / TRATAMENTOS).
  // Formato TJSP: bloco "Publicação / Processo: …". Formato TJPR (e outros): o corpo vem logo após a linha "Diário: <x>".
  let start = text.search(/^Publicação\s*\n\s*Processo:/m);
  let rest: string;
  if (start >= 0) rest = text.slice(start);
  else {
    const d = /^Diário:.*$/m.exec(text);
    if (!d) throw new ParseError('corpo da publicação não encontrado (nem bloco "Publicação" nem linha "Diário:")');
    start = d.index + d[0].length;
    rest = text.slice(start).replace(/^\s+/, '');
  }
  const ends = END_MARKERS.map((re) => rest.search(re)).filter((i) => i > 0);
  const fullText = (ends.length ? rest.slice(0, Math.min(...ends)) : rest).replace(/^\s*IA\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (fullText.length < 40) throw new ParseError('texto integral muito curto');

  const hints: AstreaHint[] = [];
  // Sugestões: após remover linhas vazias, o formato real é "PRAZO / <título> / <Dia, dd De Mon aaaa> / | / <responsável>".
  const compact = text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  const sug = compact.slice(Math.max(0, compact.search(/^TRATAMENTOS SUGERIDOS/im)));
  for (const m of sug.matchAll(/^PRAZO\n(.+)\n(?:.*?)(\d{1,2}\s+de\s+[a-zç]{3}[a-z]*\.?\s+\d{4})\n?\|?\n?(.+)?$/gim)) {
    const due = parsePtShortDate(m[2]!);
    if (due) hints.push({ title: m[1]!.trim(), dueDate: due, responsible: m[3]?.replace(/^\s*\|?\s*/, '').trim() || null });
  }
  return {
    processNumber: process, availabilityDate: brToIso(disp), publishedDate: pub ? brToIso(pub) : null,
    diary: /Diário:\s*(.+)/.exec(text)?.[1]?.trim() ?? null,
    clientName: /^Cliente:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null,
    responsible: /^Respons[aá]vel:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null,
    fullText, untreated: /N[ÃA]O TRATADA/i.test(text.slice(0, 200)), hints,
  };
}

// ───────────── Atividades de um processo (ficha do processo > aba "Atividades") ─────────────

export type ActivityType = 'PRAZO' | 'TAREFA' | 'EVENTO' | 'AUDIÊNCIA';
const TYPES = new Set<string>(['PRAZO', 'TAREFA', 'EVENTO', 'AUDIÊNCIA', 'AUDIENCIA']);
const DATE_LINE = /(\d{1,2}\s+de\s+[a-zç]{3}[a-z]*\.?\s+\d{4})/i;

export interface ActivityRow {
  type: ActivityType;
  title: string;
  dueDate: string; // ISO
  /** Ordem entre linhas com o mesmo tipo+título (desambigua duplicatas ao reabrir o item). */
  occurrence: number;
}

/**
 * Lê o texto da aba "Atividades". Formato observado (2026-10-21): para cada atividade de topo vem
 * TIPO / título / data / [horário | "N atividades"] / responsável / [+N]; as tarefas-filhas vêm sem TIPO.
 */
export function parseActivitiesText(mainText: string): ActivityRow[] {
  const lines = mainText.split('\n').map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => /^\d+\s+(ABERTAS|CONCLU[ÍI]DAS)$/i.test(l));
  const rows: ActivityRow[] = [];
  const seen = new Map<string, number>();
  for (let i = Math.max(0, start); i < lines.length; i++) {
    const t = lines[i]!.toUpperCase();
    if (!TYPES.has(t)) continue;
    const title = lines[i + 1];
    const dateLine = lines.slice(i + 2, i + 4).find((l) => DATE_LINE.test(l));
    const due = dateLine ? parsePtShortDate(dateLine) : null;
    if (!title || !due) continue;
    const key = `${t}|${title}|${due}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    rows.push({ type: (t === 'AUDIENCIA' ? 'AUDIÊNCIA' : t) as ActivityType, title, dueDate: due, occurrence });
  }
  return rows;
}

export interface ModalParsed {
  kind: string; // "Prazo"
  title: string;
  dueDate: string;
  processNumber: string | null;
  responsible: string | null;
  kanbanBoard: string | null;
  /** "Observações" — rótulo observado na tela da publicação; no modal NÃO verificado. */
  description: string;
}

const LABELS = ['Data', 'Processo', 'Número do processo', 'Quadro Kanban', 'Coluna', 'Responsável', 'Outros envolvidos', 'Observações', 'Criado por', 'Prazo concluído'];

/** Lê o texto do modal de detalhe de um Prazo (a partir do título "Prazo", caixa mista). */
export function parsePrazoModal(bodyText: string): ModalParsed {
  const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
  // O título do modal é a linha "Prazo" seguida de <título> e "Data:" (rótulos de linha de lista também podem ser "Prazo"/"PRAZO").
  const h = lines.findIndex((l, i) => /^prazo$/i.test(l) && /^Data:/.test(lines[i + 2] ?? ''));
  if (h < 0) throw new ParseError('modal de Prazo não encontrado');
  const end = lines.findIndex((l, i) => i > h && /^(Atividades|Checklists)$/.test(l));
  const block = lines.slice(h + 1, end > h ? end : h + 40);
  const title = block[0];
  if (!title) throw new ParseError('modal sem título');
  const joined = block.join('\n');
  const val = (label: string): string | null => {
    const others = LABELS.filter((l) => l !== label).map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const m = new RegExp(`^${label}:\\s*([\\s\\S]*?)(?=\\n(?:${others}):|(?![\\s\\S]))`, 'm').exec(joined);
    return m ? m[1]!.trim() || null : null;
  };
  const due = parsePtShortDate(val('Data') ?? '');
  if (!due) throw new ParseError('modal sem data');
  return {
    kind: 'Prazo', title, dueDate: due, processNumber: val('Número do processo'), responsible: val('Responsável'),
    kanbanBoard: val('Quadro Kanban'), description: val('Observações') ?? '',
  };
}

/** Id sintético (o Astrea não expõe id de atividade no DOM/URL): processo|tipo|data|título. */
export const scheduleKey = (proc: string, type: string, dueDate: string, title: string) => `${proc}|${type}|${dueDate}|${title}`;
export function splitScheduleKey(id: string): { proc: string; type: string; dueDate: string; title: string } {
  const [proc, type, dueDate, ...rest] = id.split('|');
  if (!proc || !type || !dueDate || !rest.length) throw new ParseError(`id de agendamento inválido: ${id}`);
  return { proc, type, dueDate, title: rest.join('|') };
}

// ───────────── Calculadora do formulário "Adicionar prazo" (observada 2026-10-21) ─────────────

export interface CalculatorParsed {
  publicationDate: string | null; // "Data da publicação"
  startDate: string | null; // "Início do prazo"
  holidays: Array<{ name: string; date: string }>; // "Considerar feriado e recesso"
  multipleAlerts: boolean;
}

export function parseCalculator(formText: string): CalculatorParsed {
  const lines = formText.split('\n').map((l) => l.trim()).filter(Boolean);
  // A data vem na linha seguinte ao rótulo, ou até 3 linhas depois (ícones/tooltips podem ocupar linhas no meio),
  // ou na MESMA linha ("Início do prazo 23/10/2026").
  const after = (label: RegExp) => {
    const i = lines.findIndex((l) => label.test(l));
    if (i < 0) return null;
    for (const l of [lines[i]!, ...lines.slice(i + 1, i + 4)]) {
      const m = /(\d{2}\/\d{2}\/\d{4})/.exec(l);
      if (m) return brToIso(m[1]!);
    }
    return null;
  };
  const holidays: CalculatorParsed['holidays'] = [];
  const h = lines.findIndex((l) => /^Considerar feriado e recesso/i.test(l));
  if (h >= 0) {
    for (const l of lines.slice(h + 1, h + 12)) {
      if (/^Este c[aá]lculo/i.test(l)) break;
      const m = /^(.+?)\s+-\s+(\d{2}\/\d{2}\/\d{4})/.exec(l);
      if (m) holidays.push({ name: m[1]!, date: brToIso(m[2]!) });
    }
  }
  return {
    publicationDate: after(/^Data da publicação/i), startDate: after(/^Início do prazo/i), holidays,
    multipleAlerts: /(adicionar|novo|mais)\s+alerta/i.test(formText),
  };
}

// ───────────── Cartão "Tratamentos" da tela da publicação (prazos já criados a partir dela) ─────────────
// Formato derivado da tela observada em 2026-10-21 (screenshot: tipo, título, "Data:", "Responsável:", "Quadro Kanban:/Coluna:",
// "Observações:"). O formato do TEXTO (innerText) será confirmado na 1ª gravação autorizada: se não casar, a releitura falha e o
// robô NÃO declara sucesso.
const CARD_STOPS = ['Data', 'Responsável', 'Quadro Kanban', 'Coluna', 'Observações', 'Prioridade', 'Criado por', 'Acessar detalhes'];
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface CardSchedule {
  title: string;
  dueDate: string;
  responsible: string | null;
  kanbanBoard: string | null;
  kanbanColumn: string | null;
  description: string;
}

export function parseTreatmentCards(mainText: string): CardSchedule[] {
  const lines = mainText.split('\n').map((l) => l.trim()).filter(Boolean);
  const h = lines.findIndex((l) => /^TRATAMENTOS$/i.test(l));
  if (h < 0) return [];
  const out: CardSchedule[] = [];
  for (let i = h + 1; i < lines.length; i++) {
    if (!/^prazo$/i.test(lines[i]!)) continue;
    const end = lines.findIndex((l, k) => k > i && /^(prazo|tarefa|evento|audi[eê]ncia|hist[oó]rico|acessar detalhes)$/i.test(l));
    const block = lines.slice(i + 1, end > i ? end : lines.length);
    const title = block[0];
    const joined = block.join('\n');
    const val = (label: string) => {
      const others = CARD_STOPS.filter((x) => x !== label).map(esc).join('|');
      const m = new RegExp(`(?:^|\\n)${esc(label)}:\\s*([\\s\\S]*?)(?=\\n(?:${others}):|\\s{2,}(?:${others}):|(?![\\s\\S]))`).exec(joined);
      return m ? m[1]!.trim() || null : null;
    };
    const due = parsePtShortDate(val('Data') ?? '');
    if (!title || !due) continue;
    out.push({ title, dueDate: due, responsible: val('Responsável'), kanbanBoard: val('Quadro Kanban'), kanbanColumn: val('Coluna'), description: val('Observações') ?? '' });
  }
  return out;
}
