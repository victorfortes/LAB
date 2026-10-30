import { createHash } from 'node:crypto';
import { computeDeadline } from './deadline.ts';
import type { Analysis, Evidence, ProposedAction, RawPublication, Unit } from './types.ts';

export const CLASSIFIER_VERSION = 'rules-1.0.0';

const WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10, quinze: 15, vinte: 20, trinta: 30, 'quarenta e oito': 48, quarenta: 40, sessenta: 60, noventa: 90,
};
const NUM = `\\d{1,3}|${Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|')}`;
const DEADLINE_RE = new RegExp(
  `(?:\\bprazo\\s+(?:comum\\s+|sucessivo\\s+|legal\\s+)?(?:de|:)?\\s*|\\b(?:em|no)\\s+)(${NUM})(?:\\s*\\(([^)]{1,40})\\))?\\s*(dias|horas|meses|anos)(?:\\s+(úteis|uteis|corridos))?`,
  'gi',
);

const PROVIDENCIAS: Array<[RegExp, string]> = [
  [/contrarraz/i, 'Apresentar contrarrazões'],
  [/contest/i, 'Apresentar contestação'],
  [/r[eé]plica/i, 'Apresentar réplica'],
  [/emend/i, 'Emendar a petição inicial'],
  [/custas|preparo/i, 'Recolher custas/preparo'],
  [/especifi\w+\s+(as\s+)?provas/i, 'Especificar provas'],
  [/impugn/i, 'Impugnar'],
  [/embargos/i, 'Opor embargos'],
  [/apela[cç][aã]o|recurso/i, 'Interpor recurso'],
  [/manifest/i, 'Manifestar-se'],
  [/pagar|pagamento|cumpr/i, 'Cumprir/pagar'],
  [/juntar|apresentar documentos/i, 'Juntar documentos'],
  [/regulariz|procura[cç][aã]o/i, 'Regularizar representação'],
];

// Inclui avisos de distribuição (TJPR: "DISTRIBUÍDO POR PREVENÇÃO", "Resenha de distribuição"): não geram prazo.
// Terceiros cujas ordens NÃO geram prazo para o cliente (credor). Se a mesma oração cita o cliente, o prazo pode ser nosso.
const THIRD_PARTIES: Array<[RegExp, string]> = [
  [/administrador(?:a|\(a\))?\s+judicial/i, 'Administrador Judicial'],
  [/\brecuperand[oa]s?\b/i, 'Recuperanda'],
  [/minist[eé]rio\s+p[uú]blico|\bMP\b/i, 'Ministério Público'],
];

function thirdPartyIn(clause: string, clientName: string): { label: string; quote: string; index: number } | null {
  const tokens = clientName.toLowerCase().split(/[^a-zà-ú0-9]+/).filter((t) => t.length >= 4 && !['sociedade', 'anonima', 'anônima', 'ltda', 'companhia'].includes(t));
  const lower = clause.toLowerCase();
  if (tokens.some((t) => lower.includes(t))) return null; // a oração cita o cliente: tratar como possivelmente nosso
  for (const [re, label] of THIRD_PARTIES) {
    const m = re.exec(clause);
    if (m) return { label, quote: m[0], index: m.index };
  }
  return null;
}

// Renúncia/exclusão de patrono (art. 112 CPC) e avisos de distribuição: informativos, sem prazo.
const NO_ACTION_RE = /(exclus[aã]o do patrono|art(?:igo|\.)?\s*112 do (?:cpc|c[oó]digo de processo civil)|juntada|conclusos?|remetidos? os autos|baixa definitiva|arquiv|mero expediente|ci[eê]ncia (às|as) partes|redistribu|distribu[ií]d[oa] por preven[cç][aã]o|resenha de distribui[cç][aã]o|publica[cç][aã]o da distribui[cç][aã]o)/i;
// "Ciência às partes sobre o acórdão" (TJSP) e "Divulgamos o acórdão" (TJPR).
const CIENCIA_ACORDAO_RE = /ci[eê]ncia\s+(?:[àa]s?\s+)?partes\s+sobre\s+o\s+ac[óo]rd[ãa]o[^.]{0,120}|divulgamos\s+o\s+ac[óo]rd[ãa]o[^.]{0,120}/i;
export const CIENCIA_ACORDAO_DAYS = 15;
const AUDIENCIA_RE = /audi[eê]ncia[^.]{0,120}?(\d{2})\/(\d{2})\/(\d{4})(?:[^.]{0,30}?(\d{1,2})\s*(?:h|:)\s*(\d{2})?)?/i;

const AMBIGUITY: Array<[RegExp, string, string]> = [
  [/em dobro|em qu[aá]druplo|prazo diferenciado/i, 'prazo_dobro', 'Menção a prazo em dobro/diferenciado: confirmar prerrogativa e contagem.'],
  [/prazo comum|sucessiv/i, 'prazo_comum_sucessivo', 'Prazo comum/sucessivo: confirmar partes e ordem.'],
  [/a contar d[aoe]s?\s+(juntada|cita[cç][aã]o|intima[cç][aã]o pessoal|tr[aâ]nsito|ci[eê]ncia|carga|retorno|mandado|aviso de recebimento|AR\b)/i, 'termo_inicial_distinto', 'Termo inicial indicado no texto difere da disponibilização no DJe.'],
  [/prazo legal|prazo da lei|prazo previsto em lei|prazo regimental/i, 'prazo_nao_numerico', 'Prazo remetido à lei, sem número no texto.'],
  [/\b(ap[oó]s|quando)\b[^.]{0,40}\b(tr[aâ]nsito|cumprimento|decis[aã]o)/i, 'condicional', 'Prazo condicionado a evento futuro.'],
  [/fazenda p[uú]blica|minist[eé]rio p[uú]blico|defensoria/i, 'parte_prerrogativa', 'Parte com possível prerrogativa de prazo (Fazenda/MP/Defensoria).'],
];

export interface ClassifyOptions {
  holidays?: ReadonlySet<string>;
  /** Se falso/ausente, todo cálculo carrega o alerta de feriados não verificados. */
  holidaysLoaded?: boolean;
  responsibleFor?: (processNumber: string) => string | null;
  /** Modalidade usada quando o texto não diz "úteis"/"corridos". Padrão da biblioteca: CPC (dias úteis). */
  defaultDayUnit?: 'dias_uteis' | 'dias_corridos';
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const actionId = (pubId: string, n: number, rule: string) =>
  createHash('sha256').update(`${pubId}|${n}|${rule}`).digest('hex').slice(0, 12);

function clauseAround(text: string, start: number, end: number): { clause: string; from: number } {
  const before = text.slice(0, start);
  const from = Math.max(before.lastIndexOf('.'), before.lastIndexOf(';')) + 1;
  const rest = text.slice(end);
  const m = rest.search(/[.;]/);
  const to = m === -1 ? text.length : end + m + 1;
  return { clause: text.slice(from, to), from };
}

/** Prazo padrão do escritório quando a publicação não traz prazo próprio: 5 dias corridos (CPC art. 218, §3º). */
export const DEFAULT_DEADLINE_DAYS = 5;
export function defaultDeadlineAction(pub: Pick<RawPublication, 'externalId' | 'availabilityDate'>, responsible: string | null, opts: { holidays?: ReadonlySet<string>; holidaysLoaded?: boolean } = {}, n = 90): ProposedAction {
  const deadline = computeDeadline({ availabilityDate: pub.availabilityDate, amount: DEFAULT_DEADLINE_DAYS, unit: 'dias_corridos', holidays: opts.holidays });
  deadline.basis = `Sem prazo próprio na publicação: prazo padrão de ${DEFAULT_DEADLINE_DAYS} dias corridos (CPC art. 218, §3º). ${deadline.basis}${opts.holidaysLoaded ? '' : ' ATENÇÃO: feriados/suspensões locais não verificados.'}`;
  return {
    id: actionId(pub.externalId, n, 'prazo_padrao'), kind: 'prazo', description: `Verificar publicação — prazo padrão de ${DEFAULT_DEADLINE_DAYS} dias`,
    deadline, eventAt: null, responsible, confidence: 0.5, ambiguous: true,
    ambiguityReasons: [`Sem prazo próprio no texto: será agendado o prazo padrão de ${DEFAULT_DEADLINE_DAYS} dias corridos para a equipe verificar.`], evidence: [],
  };
}

export function classify(pub: RawPublication, opts: ClassifyOptions = {}): Analysis {
  const text = pub.fullText;
  const flags: string[] = [];
  const actions: ProposedAction[] = [];
  const responsible = opts.responsibleFor?.(pub.processNumber) ?? null;
  if (!responsible) flags.push('responsavel_nao_definido');
  if (!opts.holidaysLoaded) flags.push('feriados_locais_nao_verificados');
  // 65.535 = 2^16-1: tamanho típico de truncamento de campo de texto. Conteúdo relevante pode ter sido cortado.
  if (text.length >= 65_535) flags.push('texto_possivelmente_truncado');

  let n = 0;
  for (const m of text.matchAll(DEADLINE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const { clause, from } = clauseAround(text, start, end);
    const reasons: string[] = [];
    const evidence: Evidence[] = [{ rule: 'prazo_explicito', quote: m[0], start, end }];

    const raw = m[1]!.toLowerCase();
    const amount = /^\d+$/.test(raw) ? Number(raw) : WORDS[raw]!;
    const spelled = m[2]?.toLowerCase().trim();
    if (spelled && WORDS[spelled] !== undefined && WORDS[spelled] !== amount) {
      reasons.push(`Divergência entre número (${raw}) e extenso (${spelled}).`);
    }
    const unitWord = m[3]!.toLowerCase();
    const mod = m[4]?.toLowerCase();
    let unit: Unit;
    let confidence = 0.92;
    if (unitWord === 'dias') {
      if (mod === 'corridos') unit = 'dias_corridos';
      else if (mod) unit = 'dias_uteis';
      else {
        unit = opts.defaultDayUnit ?? 'dias_uteis'; // modalidade presumida (config); texto explícito sempre prevalece
        confidence -= 0.05;
      }
    } else {
      unit = unitWord as Unit;
      reasons.push(`Unidade "${unitWord}" não é calculada automaticamente.`);
    }

    for (const [re, rule, msg] of AMBIGUITY) {
      const am = re.exec(clause);
      if (am) {
        reasons.push(msg);
        evidence.push({ rule, quote: am[0], start: from + am.index, end: from + am.index + am[0].length });
      }
    }

    // a providência é o verbo/objeto que aparece PRIMEIRO na oração (evita pegar substantivos como "sobre a contestação")
    const prov = PROVIDENCIAS.map(([re, label]) => ({ i: clause.search(re), label }))
      .filter((x) => x.i >= 0).sort((a, b) => a.i - b.i)[0];
    const provLabel = prov?.label;
    if (!prov) reasons.push('Providência não identificada no trecho.');

    // Regra: ordem dirigida a TERCEIRO (Administrador Judicial, Recuperanda, MP…) não é prazo do cliente.
    const third = thirdPartyIn(clause, pub.clientName);
    let description = provLabel ?? 'Providência não identificada (ver texto)';
    if (third) {
      reasons.push(`Ordem dirigida a terceiro (${third.label}), não ao cliente: NÃO agendar sem confirmar.`);
      evidence.push({ rule: 'prazo_de_terceiro', quote: third.quote, start: from + third.index, end: from + third.index + third.quote.length });
      description = `Prazo de terceiro (${third.label}) — não agendar`;
    }

    const deadline = computeDeadline({ availabilityDate: pub.availabilityDate, amount, unit, holidays: opts.holidays });
    if (!opts.holidaysLoaded) deadline.basis += ' ATENÇÃO: feriados/suspensões locais não verificados.';
    confidence -= 0.2 * reasons.length;
    actions.push({
      id: actionId(pub.externalId, n++, 'prazo'),
      kind: 'prazo',
      description,
      deadline,
      eventAt: null,
      responsible,
      confidence: Math.max(0.1, Number(confidence.toFixed(2))),
      ambiguous: reasons.length > 0,
      ambiguityReasons: reasons,
      evidence,
      ...(third ? { notOurs: true } : {}),
    });
  }

  const aud = AUDIENCIA_RE.exec(text);
  if (aud) {
    const [, dd, mm, yyyy, hh, mi] = aud;
    const eventAt = `${yyyy}-${mm}-${dd}${hh ? `T${hh.padStart(2, '0')}:${mi ?? '00'}` : ''}`;
    const reasons = hh ? [] : ['Horário da audiência não identificado.'];
    actions.push({
      id: actionId(pub.externalId, n++, 'audiencia'),
      kind: 'audiencia',
      description: 'Audiência designada',
      deadline: null,
      eventAt,
      responsible,
      confidence: hh ? 0.88 : 0.6,
      ambiguous: reasons.length > 0,
      ambiguityReasons: reasons,
      evidence: [{ rule: 'audiencia', quote: aud[0], start: aud.index, end: aud.index + aud[0].length }],
    });
  }

  // Regra interna: ciência às partes de acórdão, sem prazo no texto, é tratada como prazo presumido (SEMPRE análise humana).
  if (actions.length === 0) {
    const ca = CIENCIA_ACORDAO_RE.exec(text);
    if (ca) {
      const unit = opts.defaultDayUnit ?? 'dias_uteis';
      const deadline = computeDeadline({ availabilityDate: pub.availabilityDate, amount: CIENCIA_ACORDAO_DAYS, unit, holidays: opts.holidays });
      if (!opts.holidaysLoaded) deadline.basis += ' ATENÇÃO: feriados/suspensões locais não verificados.';
      actions.push({
        id: actionId(pub.externalId, n++, 'ciencia_acordao'),
        kind: 'prazo',
        description: 'Ciência sobre acórdão (prazo presumido)',
        deadline,
        eventAt: null,
        responsible,
        confidence: 0.4,
        ambiguous: true,
        ambiguityReasons: [`Prazo PRESUMIDO por regra interna (${CIENCIA_ACORDAO_DAYS} ${unit === 'dias_corridos' ? 'dias corridos' : 'dias úteis'}): o texto não indica prazo. Confirmar com o Astrea/tribunal.`],
        evidence: [{ rule: 'ciencia_acordao', quote: ca[0].slice(0, 200), start: ca.index, end: ca.index + Math.min(ca[0].length, 200) }],
      });
    }
  }

  // "prazo" citado sem número reconhecível
  if (!actions.some((a) => a.kind === 'prazo') && /\bprazo\b/i.test(text)) {
    const am = /\bprazo\b[^.]{0,80}/i.exec(text)!;
    const reasons = ['Há menção a prazo, mas sem quantidade/unidade reconhecível.'];
    for (const [re, , msg] of AMBIGUITY) if (re.test(text)) reasons.push(msg);
    actions.push({
      id: actionId(pub.externalId, n++, 'prazo_nao_numerico'),
      kind: 'prazo',
      description: 'Prazo não quantificado no texto',
      deadline: null,
      eventAt: null,
      responsible,
      confidence: 0.2,
      ambiguous: true,
      ambiguityReasons: reasons,
      evidence: [{ rule: 'prazo_sem_numero', quote: am[0], start: am.index, end: am.index + am[0].length }],
    });
  }

  if (actions.length === 0) {
    const na = NO_ACTION_RE.exec(text);
    const recognized = !!na;
    if (!recognized) flags.push('nenhum_padrao_reconhecido');
    actions.push({
      id: actionId(pub.externalId, 0, 'sem_providencia'),
      kind: 'sem_providencia',
      description: recognized ? 'Sem providência/prazo identificado' : 'Nenhum padrão reconhecido — revisar',
      deadline: null,
      eventAt: null,
      responsible: null,
      confidence: recognized ? 0.85 : 0.3,
      ambiguous: !recognized,
      ambiguityReasons: recognized ? [] : ['Texto não casa com nenhum padrão conhecido.'],
      evidence: na ? [{ rule: 'sem_providencia', quote: na[0], start: na.index, end: na.index + na[0].length }] : [],
    });
  }

  // Regra do escritório: sem prazo próprio (texto sem prazo, ou só prazo de terceiro) ⇒ propõe prazo padrão de 5 dias para a equipe verificar.
  // Não vale para o que é reconhecidamente informativo (juntada, distribuição, renúncia…) nem para audiência.
  const hasOwn = actions.some((x) => x.kind === 'prazo' && !x.notOurs && x.deadline?.endTerm);
  const informative = actions.every((x) => x.kind === 'sem_providencia' && x.confidence >= 0.8);
  if (!hasOwn && !informative && !actions.some((x) => x.kind === 'audiencia')) {
    actions.push(defaultDeadlineAction(pub, responsible, opts));
    flags.push('prazo_padrao_5_dias');
  }

  if (actions.filter((a) => a.kind !== 'sem_providencia').length > 1) flags.push('multiplas_providencias');
  // Conferência cruzada com a sugestão do próprio Astrea: divergência de data exige olhar humano.
  const hinted = (pub.hints ?? []).map((h) => h.dueDate).filter((d): d is string => !!d);
  if (hinted.length) {
    const mine = actions.map((a) => a.deadline?.endTerm).filter((d): d is string => !!d);
    if (!hinted.some((d) => mine.includes(d))) flags.push('sugestao_astrea_divergente');
  }
  const body = collapse(text);
  const summary = `${body.length > 260 ? `${body.slice(0, 257)}…` : body}`;
  const confidence = Math.min(...actions.map((a) => a.confidence));
  return { summary, actions, confidence, flags, classifierVersion: CLASSIFIER_VERSION };
}

/** Estado inicial proposto pela análise. */
export function initialStateFor(a: Analysis): 'classified' | 'needs_review' | 'no_action' {
  if (a.actions.some((x) => x.ambiguous) || a.confidence < 0.7 || a.flags.includes('nenhum_padrao_reconhecido') || a.flags.includes('sugestao_astrea_divergente') || a.flags.includes('texto_possivelmente_truncado')) return 'needs_review';
  if (a.actions.every((x) => x.kind === 'sem_providencia')) return 'no_action';
  return 'classified';
}
