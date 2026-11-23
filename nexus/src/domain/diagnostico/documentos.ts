/**
 * Leitores para os documentos como os clientes realmente mandam, a partir do
 * texto de PDF (uma linha visual por linha):
 *   - balanço de um exercício, coluna única "Saldo Atual" com D/C;
 *   - DRE contábil vertical (valores entre parênteses) e DRE gerencial
 *     ("Acumulado" + meses, valores em R$ com sinal);
 *   - balancete gerencial sem código de conta, saldos em R$ com sinal
 *     (credor negativo);
 *   - declarações de faturamento fiscal (mês, ano, valor, "Totais") e
 *     gerencial (mês/aa, faturamento, outros, total).
 * Cada documento é reconhecido pelo conteúdo; o que não for reconhecido vira
 * aviso. Todo número sai com a referência "arquivo | página".
 */
import type { ExtracaoLida, ResultadoDaLeitura } from './planilhas.ts';
import { lerTextoDeDemonstracao } from './planilhas.ts';
import type { LinhaBalancete } from '../insolvencia/balancete.ts';
import { consertarTexto, lerPorTipo } from './leitores.ts';

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Um valor monetário do texto: "R$ 1.234,56", "-R$ 1.234,56", "R$ -", "(1.234,56)", "1.234,56D". */
const TOKEN = /-?\s?R\$\s*-?\s?[\d.]*\d,\d{2}|-?\s?R\$\s*-?\s?\d{1,3}(?:\.\d{3})+(?![\d,])|-?\s?R\$\s*-(?![\d])|\(\s?[\d.]*\d,\d{2}\s?\)|-?[\d.]*\d,\d{2}\s?[DC]?\b/g;

export interface Valor { reais: number; lado: 'D' | 'C' | null }
export function lerToken(t: string): Valor | null {
  let s = t.replace(/\s/g, '');
  if (/^-?R\$-$/.test(s)) return { reais: 0, lado: null };
  let lado: 'D' | 'C' | null = null;
  const m = /([DC])$/i.exec(s); if (m) { lado = m[1]!.toUpperCase() as 'D' | 'C'; s = s.slice(0, -1); }
  const neg = s.startsWith('-') || /^\(.*\)$/.test(s) || /R\$-/.test(s);
  s = s.replace(/[()R$-]/g, '');
  // Valor sem centavos só é aceito com "R$" e milhar separado ("R$ 40.762.669"), como nos demonstrativos gerenciais.
  if (/^\d{1,3}(\.\d{3})+$/.test(s) && /R\$/.test(t)) s += ',00';
  if (!/^[\d.]*\d,\d{2}$/.test(s)) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return { reais: neg ? -n : n, lado };
}

/** Rótulo (texto antes do primeiro valor) e valores da linha. */
export function partirLinha(linha: string): { rotulo: string; valores: Valor[] } {
  const ms = [...linha.matchAll(TOKEN)];
  if (!ms.length) return { rotulo: linha.trim(), valores: [] };
  const rotulo = linha.slice(0, ms[0]!.index).replace(/^\s*[\d.]+\s+(?=[A-Za-zÀ-ú(])/, '').replace(/[:\s]+$/, '').trim();
  return { rotulo, valores: ms.map((m) => lerToken(m[0])).filter((v): v is Valor => !!v) };
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Exercício do documento: data de encerramento, "exercício 2024", "referência 2024", meses "jan/24" ou o nome do arquivo. */
export function exercicioDo(texto: string, arquivo: string): number | null {
  const t = norm(texto);
  const pads = [/encerrado em:?\s*\d{2}\/\d{2}\/(\d{4})/, /exercicio em \d{2}\/\d{2}\/(\d{4})/, /exercicio (?:de )?(\d{4})/, /referencia (\d{4})/, /periodo:?\s*\d{2}\/\d{2}\/(\d{4})/];
  for (const p of pads) { const m = p.exec(t); if (m) return Number(m[1]); }
  const mm = /\b(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/(\d{2})\b/.exec(t); if (mm) return 2000 + Number(mm[1]);
  const f = /(20\d{2})/.exec(arquivo); return f ? Number(f[1]) : null;
}

const achar = (linhas: { rotulo: string; valores: Valor[] }[], re: RegExp) => linhas.find((l) => l.valores.length && re.test(norm(l.rotulo)));

// ------------------------------------------------------------------ balanço ---

function lerBalancoVertical(arquivo: string, pagina: number, linhas: string[], out: ResultadoDaLeitura): boolean {
  const ps = linhas.map(partirLinha);
  const ac = achar(ps, /^ativo circulante$/), anc = achar(ps, /^ativo nao[- ]circulante$/);
  const pc = achar(ps, /^passivo circulante$/), pnc = achar(ps, /^passivo nao[- ]circulante$/), pl = achar(ps, /^patrimonio liquido$/);
  if (!ac || !pc || !pl) return false;
  const ex = exercicioDo(linhas.join('\n'), arquivo); if (!ex) return false;
  // Convenção D/C: no ativo, D é positivo; no passivo e no PL, C é positivo. Sem D/C, vale o sinal impresso.
  const ativo = (l?: { valores: Valor[] }) => { const v = l?.valores.at(-1); return !v ? 0 : v.lado ? (v.lado === 'D' ? Math.abs(v.reais) : -Math.abs(v.reais)) : v.reais; };
  const passivo = (l?: { valores: Valor[] }) => { const v = l?.valores.at(-1); return !v ? 0 : v.lado ? (v.lado === 'C' ? Math.abs(v.reais) : -Math.abs(v.reais)) : v.reais; };
  const emissao = /emiss[aã]o:?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(linhas.join(' '));
  // Contas que o diagnóstico examina (adiantamentos, sócios, tributos, parcelamentos).
  const contas = ps.filter((l) => l.valores.length && l.rotulo).map((l) => ({ conta: l.rotulo, saldo: l.valores.at(-1)!.reais, lado: l.valores.at(-1)!.lado }));
  const soma = (re: RegExp) => contas.filter((c) => re.test(norm(c.conta))).reduce((t, c) => t + Math.abs(c.saldo), 0);
  out.extracoes.push({ tipo: 'balanco', referencia: `${arquivo} | página ${pagina}`, dados: {
    exercicio: ex, convencao: 'sinal', ativoCirculante: ativo(ac), ativoNaoCirculante: ativo(anc),
    passivoCirculante: passivo(pc), passivoNaoCirculante: passivo(pnc), patrimonioLiquido: passivo(pl),
    ...(emissao ? { assinadoEm: `${emissao[3]}-${emissao[2]}-${emissao[1]}` } : {}),
    contas,
  } });
  // O mesmo balanço é uma fonte de passivo: total exigível e a parte fiscal (tributos, sociais e parcelamentos, sem repetir os grupos).
  const fiscal = soma(/^(impostos e contribuicoes a recolher|obrigacoes sociais)$/) + soma(/^parcelamentos$/);
  out.extracoes.push({ tipo: 'passivo_fonte', referencia: `${arquivo} | página ${pagina}`, dados: { fonte: `Balanço contábil ${ex}`, total: passivo(pc) + passivo(pnc), fiscal: fiscal || null, periodo: `${ex}-12` } });
  return true;
}

/** Rótulo sem espaços nem acentos: o PDF de contabilidade costuma vir com "PA TRIMÔNIO", "RECEITAOPERACIONAL". */
const chave = (s: string) => norm(s).replace(/[^a-z]/g, '');

/**
 * Balanço em várias páginas, com "ATIVO" e "PASSIVO" como título e "CIRCULANTE" / "NÃO CIRCULANTE" logo abaixo
 * (formato dos sistemas contábeis mais comuns). Com duas colunas (exercício atual e anterior), vale a primeira.
 */
function lerBalancoPorSecoes(arquivo: string, paginas: string[][], out: ResultadoDaLeitura): boolean {
  const texto = paginas.flat().join('\n');
  if (!/balancopatrimonial/.test(chave(texto.slice(0, 4000))) && !/balan/.test(norm(arquivo))) return false;
  let secao: 'A' | 'P' | null = null; let pagAc = 1;
  const v: Record<string, number> = {};
  const contas: { conta: string; saldo: number; lado: 'D' | 'C' | null }[] = [];
  paginas.forEach((linhas, p) => linhas.forEach((l) => {
    const { rotulo, valores } = partirLinha(l); const k = chave(rotulo);
    if (!valores.length) { if (k === 'ativo') secao = 'A'; else if (k === 'passivo' || k === 'passivoepatrimonioliquido') secao = 'P'; return; }
    const x = valores[0]!.reais;
    if (/^(patrimonioliquido|passivoadescoberto)$/.test(k)) { v.pl ??= x; secao = 'P'; return; }
    if (secao === 'A' && k === 'circulante') { v.ac ??= x; pagAc = p + 1; }
    else if (secao === 'A' && k === 'naocirculante') v.anc ??= x;
    else if (secao === 'P' && k === 'circulante') v.pc ??= x;
    else if (secao === 'P' && k === 'naocirculante') v.pnc ??= x;
    if (rotulo && secao && !/^total/.test(k)) contas.push({ conta: rotulo, saldo: x, lado: null });
  }));
  if (v.ac === undefined || v.pc === undefined || v.pl === undefined) return false;
  const anoEspacado = /balan[cç]o patrimonial\s*-\s*((?:\d\s?){4})/i.exec(texto);
  const ex = anoEspacado ? Number(anoEspacado[1]!.replace(/\s/g, '')) : exercicioDo(texto, arquivo); if (!ex) return false;
  const ref = `${arquivo} | página ${pagAc}`;
  out.extracoes.push({ tipo: 'balanco', referencia: ref, dados: {
    exercicio: ex, convencao: 'sinal', ativoCirculante: v.ac, ativoNaoCirculante: v.anc ?? 0,
    passivoCirculante: v.pc, passivoNaoCirculante: v.pnc ?? 0, patrimonioLiquido: v.pl, contas,
  } });
  const soma = (re: RegExp) => contas.filter((c) => re.test(norm(c.conta))).reduce((t, c) => t + Math.abs(c.saldo), 0);
  const fiscal = soma(/^(impostos e contribuicoes a recolher|obrigacoes sociais|obrigacoes tributarias)$/) + soma(/^parcelamentos?( de impostos| fiscais)?$/);
  out.extracoes.push({ tipo: 'passivo_fonte', referencia: ref, dados: { fonte: `Balanço contábil ${ex}`, total: v.pc + (v.pnc ?? 0), fiscal: fiscal || null, periodo: `${ex}-12` } });
  return true;
}

/** DRE que ocupa várias páginas (receita na primeira, resultado na última), com rótulos colados. */
function lerDreDoDocumento(arquivo: string, paginas: string[][], out: ResultadoDaLeitura): boolean {
  const texto = paginas.flat().join('\n'); const k = chave(texto.slice(0, 6000));
  if (!/(demonstracaodoresultado|receitaoperacionalbruta|receitabruta)/.test(k) && !/\bdre\b/.test(norm(arquivo))) return false;
  let receita: number | null = null; let resultado: number | null = null; let financeiras: number | null = null; let pagina = 1;
  paginas.forEach((linhas, p) => linhas.forEach((l) => {
    const { rotulo, valores } = partirLinha(l); if (!valores.length) return; const c = chave(rotulo).replace(/^total/, ''); const x = valores[0]!.reais;
    if (receita === null && /^(receitaoperacionalbruta|receitabruta|receitabrutadevendas|receitabrutaoperacional)/.test(c)) { receita = x; pagina = p + 1; }
    if (/^(resultadodoexercicio|resultadoliquidodoexercicio|lucroliquido|prejuizoliquido|lucrodoexercicio|prejuizodoexercicio|lucroprejuizoliquido)/.test(c)) resultado = /prejuizo/.test(c) && x > 0 ? -x : x;
    if (financeiras === null && /^despesasfinanceiras$/.test(c)) financeiras = Math.abs(x);
  }));
  if (receita === null && resultado === null) return false;
  const ex = exercicioDo(texto, arquivo); if (!ex) return false;
  // Meses do período: "01/01/2025 a 31/12/2025" ou "Janeiro / 2024 a Dezembro / 2024".
  const t = norm(texto); let meses: number | null = null;
  const num = /periodo:?\s*\d{2}\/(\d{2})\/\d{4} a \d{2}\/(\d{2})\/\d{4}/.exec(t);
  const ext = new RegExp(`periodo:?\\s*(${MESES_LONGOS.join('|')})\\s*\\/\\s*\\d{4} a (${MESES_LONGOS.join('|')})`).exec(t);
  if (num) meses = Number(num[2]) - Number(num[1]) + 1; else if (ext) meses = MESES_LONGOS.indexOf(ext[2]!) - MESES_LONGOS.indexOf(ext[1]!) + 1;
  out.extracoes.push({ tipo: 'dre_contabil', referencia: `${arquivo} | página ${pagina}`, dados: { exercicio: ex, receitaBruta: receita, resultado, meses, despesasFinanceiras: financeiras } });
  return true;
}

/** "Relação de Faturamento de 05/2025 a 05/2026" com só o nome do mês em cada linha: o ano anda junto com os meses. */
function lerFaturamentoPorIntervalo(arquivo: string, paginas: string[][], out: ResultadoDaLeitura): boolean {
  const linhas = paginas.flat(); const t = norm(linhas.join('\n'));
  const m = /faturamento (?:de|entre) (\d{2})\/(\d{4}) (?:a|ate) (\d{2})\/(\d{4})/.exec(t); if (!m) return false;
  let mes = Number(m[1]); let ano = Number(m[2]);
  const porAno = new Map<number, { mes: string; valor: number }[]>();
  for (const l of linhas) {
    const n = norm(l); const i = MESES_LONGOS.findIndex((x) => n.startsWith(x)); const p = partirLinha(l);
    if (i < 0 || !p.valores.length || /\d{4}/.test(n.slice(0, 20))) continue;
    while (i + 1 !== mes) { mes++; if (mes > 12) { mes = 1; ano++; } }
    porAno.set(ano, [...(porAno.get(ano) ?? []), { mes: `${ano}-${String(mes).padStart(2, '0')}`, valor: p.valores.at(-1)!.reais }]);
    mes++; if (mes > 12) { mes = 1; ano++; }
  }
  if (!porAno.size) return false;
  // Lista do próprio cliente (fora da escrita fiscal): entra como faturamento gerencial, para comparar com o declarado.
  for (const [a, serie] of porAno) out.extracoes.push({ tipo: 'faturamento', referencia: `${arquivo} | página 1`, dados: {
    ano: a, gerencial: Math.round(serie.reduce((s, x) => s + x.valor, 0) * 100) / 100, outros: 0, meses: serie.length, ultimoMes: serie.at(-1)!.mes, serie } });
  return true;
}

// ---------------------------------------------------------------------- DRE ---

function lerDre(arquivo: string, pagina: number, linhas: string[], out: ResultadoDaLeitura): boolean {
  const texto = linhas.join('\n'); const t = norm(texto);
  if (!/(demonstracao d[oe] resultado|^receita bruta|receita operacional bruta|\breceita bruta\b)/m.test(t)) return false;
  const gerencial = linhas.some((l) => /^\s*acumulado\b/i.test(l));
  const ps = linhas.map(partirLinha);
  const rec = achar(ps, /^(receita bruta|receita operacional bruta|3\.1 receita operacional bruta)$/) ?? achar(ps, /receita (operacional )?bruta/);
  const res = achar(ps, /^(resultado do exercicio|lucro liquido|prejuizo do exercicio|lucro do exercicio|lucro liquido do exercicio|resultado liquido do exercicio|prejuizo liquido do exercicio)$/);
  if (!rec && !res) return false;
  const ex = exercicioDo(texto, arquivo); if (!ex) return false;
  // Na DRE gerencial o primeiro valor é o acumulado do ano; na contábil, o único.
  const primeiro = (l?: { valores: Valor[] }) => (l ? l.valores[0]!.reais : null);
  let resultado = primeiro(res);
  if (res && resultado !== null && resultado > 0 && /prejuizo/.test(norm(res.rotulo))) resultado = -resultado;
  // Meses cobertos: na gerencial, os meses com receita; na contábil, a data do encerramento.
  let meses: number | null = null;
  if (gerencial && rec) meses = rec.valores.slice(1).filter((v) => v.reais !== 0).length || null;
  const enc = /exercicio em \d{2}\/(\d{2})\/\d{4}/.exec(t); if (!gerencial && enc) meses = Number(enc[1]);
  out.extracoes.push({ tipo: gerencial ? 'dre_gerencial' : 'dre_contabil', referencia: `${arquivo} | página ${pagina}`, dados: {
    exercicio: ex, receitaBruta: primeiro(rec), resultado, meses,
    despesasFinanceiras: Math.abs(primeiro(achar(ps, /(despesas financeiras|resultado financeiro)$/)) ?? 0) || null,
  } });
  return true;
}

// -------------------------------------------------------------- faturamento ---

function lerFaturamento(arquivo: string, pagina: number, linhas: string[], out: ResultadoDaLeitura): boolean {
  const t = norm(linhas.join('\n')); const a = norm(arquivo);
  if (!/(declaracao de faturamento|faturamento gerencial|faturamento fiscal|demonstrativo mensal do faturamento|^fat(uramento)?\b)/m.test(t + '\n' + a)) return false;
  const gerencial = /gerencial/.test(t) || /gerencial/.test(a);
  const meses: { mes: string; valor: number; outros?: number }[] = [];
  let total: number | null = null;
  for (const l of linhas) {
    const n = norm(l); const p = partirLinha(l);
    const curto = /^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/(\d{2})\b/.exec(n);
    const longo = new RegExp(`^(${MESES_LONGOS.join('|')})\\s+(\\d{4})\\b`).exec(n);
    if ((curto || longo) && p.valores.length) {
      const mes = curto ? `20${curto[2]}-${String(MESES.indexOf(curto[1]!) + 1).padStart(2, '0')}` : `${longo![2]}-${String(MESES_LONGOS.indexOf(longo![1]!) + 1).padStart(2, '0')}`;
      // Gerencial: faturamento, outros, total. Fiscal: o valor do mês.
      const v = p.valores.map((x) => x.reais);
      const item = gerencial && v.length >= 3 ? { mes, valor: v[2]!, outros: v[1]! } : { mes, valor: v.at(-1)! };
      // Mês zerado no fim do ano é mês que ainda não aconteceu: não conta.
      if (item.valor !== 0) meses.push(item);
    } else if (/^totai?s?\b/.test(n) && p.valores.length) total = p.valores.at(-1)!.reais;
  }
  if (!meses.length) return false;
  const somaTudo = Math.round(meses.reduce((s, m) => s + m.valor, 0) * 100) / 100;
  if (total !== null && Math.abs(total - somaTudo) > 1) out.avisos.push(`${arquivo}: o total declarado (${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) não bate com a soma dos meses (${somaTudo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}). Usada a soma dos meses.`);
  // Doze meses móveis (nov/25 a out/26) viram um registro por ano civil: cada mês fica no ano a que pertence.
  for (const ano of [...new Set(meses.map((m) => Number(m.mes.slice(0, 4))))]) {
    const doAno = meses.filter((m) => Number(m.mes.slice(0, 4)) === ano);
    const soma = Math.round(doAno.reduce((s, m) => s + m.valor, 0) * 100) / 100;
    const outros = gerencial ? Math.round(doAno.reduce((s, m) => s + (m.outros ?? 0), 0) * 100) / 100 : null;
    out.extracoes.push({ tipo: 'faturamento', referencia: `${arquivo} | página ${pagina}`, dados: {
      ano, [gerencial ? 'gerencial' : 'fiscal']: soma, ...(gerencial ? { outros } : {}), meses: doAno.length, ultimoMes: doAno.at(-1)!.mes, serie: doAno,
    } });
  }
  return true;
}

// --------------------------------------------------------- balancete gerencial ---

const PL_OU_RESULTADO = /(capital social|ajuste de abertura|ajustes? de|lucros?|prejuizos?|reserva|receita|venda|faturamento|folha de pagamento|^despesas?|custo|cmv|resultado)/;

/** Linhas do balancete em R$ com sinal: saldo negativo é credor (passivo, PL e receita), positivo é devedor. */
export function linhasDoBalanceteGerencial(arquivo: string, paginas: string[][]): LinhaBalancete[] {
  const saida: LinhaBalancete[] = [];
  paginas.forEach((linhas, p) => linhas.forEach((l, k) => {
    if (!/R\$/.test(l)) return;
    const { rotulo, valores } = partirLinha(l); if (!rotulo || !/[a-zA-ZÀ-ú]{3}/.test(rotulo) || !valores.length) return;
    const v = valores.at(-1)!; if (v.reais === 0) return;
    saida.push({ codigo: null, conta: rotulo, saldo: BigInt(Math.round(Math.abs(v.reais) * 100)), lado: v.reais < 0 ? 'C' : 'D', referencia: `${arquivo} | página ${p + 1} | linha ${k + 1}` });
  }));
  return saida;
}

function lerBalanceteGerencial(arquivo: string, paginas: string[][], out: ResultadoDaLeitura): boolean {
  const t = norm(paginas.flat().join('\n'));
  if (!/balancete/.test(t + ' ' + norm(arquivo))) return false;
  const linhas = linhasDoBalanceteGerencial(arquivo, paginas); if (!linhas.length) return false;
  const passivo = linhas.filter((l) => l.lado === 'C' && !PL_OU_RESULTADO.test(norm(l.conta)));
  const total = passivo.reduce((s, l) => s + Number(l.saldo) / 100, 0);
  const fiscal = passivo.filter((l) => /(imposto|tribut|parcelad|inss|fgts)/.test(norm(l.conta))).reduce((s, l) => s + Number(l.saldo) / 100, 0);
  const m = /\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/(\d{2})\b/.exec(t) ?? /balancete (\d{2})\.(\d{2})/.exec(norm(arquivo));
  const periodo = m ? `20${m[2]}-${/^\d+$/.test(m[1]!) ? m[1] : String(MESES.indexOf(m[1]!) + 1).padStart(2, '0')}` : null;
  out.extracoes.push({ tipo: 'passivo_fonte', referencia: `${arquivo} | página 1`, dados: {
    fonte: `Balancete gerencial${periodo ? ` ${MESES[Number(periodo.slice(5)) - 1]}/${periodo.slice(2, 4)}` : ''}`, total: Math.round(total * 100) / 100, fiscal: Math.round(fiscal * 100) / 100, periodo,
    contas: passivo.map((l) => ({ conta: l.conta, saldo: Number(l.saldo) / 100 })),
  } });
  return true;
}

// ------------------------------------------------------------------- entrada ---

/** Reconhece o documento pelo conteúdo e extrai o que souber. Nunca inventa: o que não reconhece vira aviso. */
export function lerDocumentoPdf(arquivo: string, paginasBrutas: string[][], contexto = ''): ResultadoDaLeitura {
  const out: ResultadoDaLeitura = { extracoes: [], avisos: [] };
  // Extrato, contrato de crédito, SCR, apólice e licença têm leitor próprio (leitores.ts); o resto segue abaixo.
  const tipo = lerPorTipo(arquivo, contexto, paginasBrutas, out);
  if (tipo && out.extracoes.length) return out;
  out.avisos = [];
  const paginas = consertarTexto(paginasBrutas);
  if (lerBalanceteGerencial(arquivo, paginas, out)) return out;
  if (lerFaturamentoPorIntervalo(arquivo, paginas, out)) return out;
  let algum = lerBalancoPorSecoes(arquivo, paginas, out);
  const temBalanco = algum;
  // DRE no documento inteiro (receita numa página, resultado em outra, rótulos colados, linhas "*** Total").
  const colunasMensais = paginas.some((ls) => ls.some((l) => /^\s*acumulado\b/i.test(l)));
  const dreInteira = !colunasMensais && lerDreDoDocumento(arquivo, paginas, out) && out.extracoes.some((x) => x.tipo === 'dre_contabil' && x.dados.receitaBruta !== null && x.dados.resultado !== null);
  if (!dreInteira) out.extracoes = out.extracoes.filter((x) => x.tipo !== 'dre_contabil');
  algum ||= dreInteira;
  paginas.forEach((linhas, i) => {
    if (lerFaturamento(arquivo, i + 1, linhas, out)) { algum = true; return; }
    if (!temBalanco && lerBalancoVertical(arquivo, i + 1, linhas, out)) { algum = true; return; }
    if (!dreInteira && lerDre(arquivo, i + 1, linhas, out)) algum = true;
  });
  // Demonstrativo gerencial ("G-Balanço e DRE", "DRE gerencial"): não é a escrita contábil, entra como gerencial para comparar.
  if (/^g[-_ ]|gerencial/i.test(arquivo)) for (const x of out.extracoes) if (x.tipo === 'dre_contabil') x.tipo = 'dre_gerencial';
  // DRE contábil em mais de uma página repete o cabeçalho: fica a página que trouxe o resultado.
  const dres = out.extracoes.filter((x) => x.tipo === 'dre_contabil');
  if (dres.length > 1) {
    const melhor = dres.find((x) => x.dados.resultado !== null) ?? dres[0]!;
    const rec = dres.find((x) => x.dados.receitaBruta !== null)?.dados.receitaBruta ?? null;
    melhor.dados.receitaBruta = melhor.dados.receitaBruta ?? rec;
    out.extracoes = out.extracoes.filter((x) => x.tipo !== 'dre_contabil' || x === melhor);
  }
  if (algum) return out;
  // Demonstração com vários exercícios em colunas (formato antigo).
  return lerTextoDeDemonstracao(arquivo, paginas);
}

/**
 * Junta, por ano, o faturamento fiscal e o gerencial que vieram de arquivos diferentes. Quando dois arquivos trazem
 * o mesmo mês (relatório anual e relatório de doze meses móveis), o mês conta uma vez só, com o valor do último arquivo.
 */
export function juntarFaturamento(fs: ExtracaoLida[]) {
  type Serie = { mes: string; valor: number; outros?: number }[];
  const porAno = new Map<number, { ano: number; fiscal: Map<string, number>; gerencial: Map<string, number>; outros: number | null; refs: string[]; fiscalSemSerie: number | null; gerencialSemSerie: number | null; mesesF: number | null; mesesG: number | null }>();
  for (const f of fs) {
    const d = f.dados as { ano: number; fiscal?: number; gerencial?: number; outros?: number; meses?: number; serie?: Serie };
    const a = porAno.get(d.ano) ?? { ano: d.ano, fiscal: new Map<string, number>(), gerencial: new Map<string, number>(), outros: null, refs: [] as string[], fiscalSemSerie: null, gerencialSemSerie: null, mesesF: null, mesesG: null };
    if (typeof d.fiscal === 'number') { if (d.serie?.length) for (const m of d.serie) a.fiscal.set(m.mes, m.valor); else { a.fiscalSemSerie = d.fiscal; a.mesesF = d.meses ?? null; } }
    if (typeof d.gerencial === 'number') { if (d.serie?.length) for (const m of d.serie) a.gerencial.set(m.mes, m.valor); else { a.gerencialSemSerie = d.gerencial; a.mesesG = d.meses ?? null; } a.outros = d.outros ?? a.outros; }
    a.refs.push(f.referencia); porAno.set(d.ano, a);
  }
  const somar = (m: Map<string, number>) => Math.round([...m.values()].reduce((s, v) => s + v, 0) * 100) / 100;
  return [...porAno.values()].sort((x, y) => x.ano - y.ano).map((a) => ({
    ano: a.ano, refs: a.refs, outros: a.outros,
    fiscal: a.fiscal.size ? somar(a.fiscal) : a.fiscalSemSerie, mesesFiscal: a.fiscal.size || a.mesesF,
    gerencial: a.gerencial.size ? somar(a.gerencial) : a.gerencialSemSerie, mesesGerencial: a.gerencial.size || a.mesesG,
  }));
}
