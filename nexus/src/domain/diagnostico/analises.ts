/**
 * Análises do diagnóstico inicial: aritmética conferida por código, sem texto de modelo.
 *
 * Toda função recebe números JÁ extraídos (cada um com a sua referência) e devolve números derivados.
 * Se algo não fecha, devolve a divergência: nunca corrige em silêncio. Nada aqui consulta fonte externa.
 */

export interface Ref { readonly arquivo: string; readonly local?: string }
export type Qualidade = 'boa' | 'regular' | 'ruim' | 'ilegivel';

/** Em reais (não em centavos): são demonstrações contábeis, arredondadas pelo próprio documento. */
export interface Balanco {
  exercicio: number; ref: Ref;
  ativoCirculante: number; ativoNaoCirculante: number;
  passivoCirculante: number; passivoNaoCirculante: number; patrimonioLiquido: number;
  /** 'dc': saldos vêm como devedor/credor (credor do passivo positivo). 'sinal': passivo e PL já com o sinal natural. */
  convencao?: 'sinal' | 'dc';
  resultado?: number;
  assinadoEm?: string;
}
export interface Dre { exercicio: number; ref: Ref; tipo: 'contabil' | 'gerencial'; receitaBruta: number | null; resultado: number | null }
export interface Faturamento { ano: number; ref: Ref; fiscal: number | null; gerencial: number | null }
export interface LinhaExtrato { data: string; valor: number; historico: string }
export interface Extrato { banco: string; ref: Ref; saldoInicial?: number; linhas: LinhaExtrato[] }
export interface PassivoFonte { fonte: string; ref: Ref; total: number; fiscal: number | null }

const r2 = (n: number) => Math.round(n * 100) / 100;
const soma = (a: readonly number[]) => a.reduce((t, x) => t + x, 0);
const razao = (a: number, b: number) => (b === 0 ? null : a / b);

// --------------------------------------------------------------- balanço ---

export interface AnaliseDeBalanco {
  exercicio: number; ref: Ref; ativo: number; exigivel: number; patrimonioLiquido: number;
  liquidezCorrente: number | null; exigivelSobreAtivo: number | null;
  /** ativo − (exigível + PL). Diferente de zero (além da tolerância) vira divergência, nunca é ajustado. */
  diferenca: number; fecha: boolean; assinadoEm?: string;
}

/** Tolerância de R$ 1,00: arredondamento de demonstração em reais inteiros. */
export function analisarBalanco(b: Balanco, tolerancia = 1): AnaliseDeBalanco {
  const ativo = b.ativoCirculante + b.ativoNaoCirculante;
  // Convenção D/C: o saldo credor do passivo/PL pode vir negativo; normaliza para o sinal natural antes de somar.
  const n = (v: number) => (b.convencao === 'dc' ? Math.abs(v) : v);
  const pc = n(b.passivoCirculante); const pnc = n(b.passivoNaoCirculante); const pl = b.patrimonioLiquido;
  const exigivel = pc + pnc; const diferenca = r2(ativo - (exigivel + pl));
  return {
    exercicio: b.exercicio, ref: b.ref, ativo: r2(ativo), exigivel: r2(exigivel), patrimonioLiquido: r2(pl),
    liquidezCorrente: razao(b.ativoCirculante, pc) === null ? null : r2(b.ativoCirculante / pc),
    exigivelSobreAtivo: razao(exigivel, ativo) === null ? null : r2(exigivel / ativo),
    diferenca, fecha: Math.abs(diferenca) <= tolerancia, assinadoEm: b.assinadoEm,
  };
}

/** Exercícios sem demonstração dentro do intervalo coberto e o déficit acumulado estimado (resultado dos anos disponíveis). */
export function exerciciosAusentes(bs: readonly Balanco[]): number[] {
  if (bs.length < 2) return [];
  const anos = bs.map((b) => b.exercicio); const min = Math.min(...anos); const max = Math.max(...anos);
  return Array.from({ length: max - min + 1 }, (_, i) => min + i).filter((a) => !anos.includes(a));
}

/** Demonstração assinada depois do exercício seguinte sugere "feita sob demanda": indício, não conclusão. */
export function assinaturaTardia(b: Balanco): boolean {
  if (!b.assinadoEm) return false;
  const ano = Number(b.assinadoEm.slice(0, 4)); return Number.isFinite(ano) && ano > b.exercicio + 1;
}

// ------------------------------------------------------- DRE e faturamento ---

export function compararDre(dres: readonly Dre[]) {
  const anos = [...new Set(dres.map((d) => d.exercicio))].sort();
  return anos.map((ano) => {
    const c = dres.find((d) => d.exercicio === ano && d.tipo === 'contabil'); const g = dres.find((d) => d.exercicio === ano && d.tipo === 'gerencial');
    return {
      ano, contabil: c ? { receita: c.receitaBruta, resultado: c.resultado, ref: c.ref } : null, gerencial: g ? { receita: g.receitaBruta, resultado: g.resultado, ref: g.ref } : null,
      /** Resultados de sinal oposto entre as duas versões é o sinal mais forte de duas contabilidades. */
      sinalOposto: !!c && !!g && c.resultado !== null && g.resultado !== null && Math.sign(c.resultado) !== 0 && Math.sign(c.resultado) === -Math.sign(g.resultado),
    };
  });
}

export function compararFaturamento(fs: readonly Faturamento[]) {
  const linhas = [...fs].sort((a, b) => a.ano - b.ano).map((f) => ({
    ano: f.ano, ref: f.ref, fiscal: f.fiscal, gerencial: f.gerencial,
    diferenca: f.fiscal !== null && f.gerencial !== null ? r2(f.gerencial - f.fiscal) : null,
    razaoGerencialFiscal: f.fiscal && f.gerencial !== null ? r2(f.gerencial / f.fiscal) : null,
  }));
  const comAmbos = linhas.filter((l) => l.diferenca !== null);
  const acumulada = r2(soma(comAmbos.map((l) => l.diferenca!)));
  const totalFiscal = soma(comAmbos.map((l) => l.fiscal!));
  return { linhas, diferencaAcumulada: acumulada, percentualSobreFiscal: totalFiscal ? r2((acumulada / totalFiscal) * 100) : null };
}

/** Meses com valor idêntico em sequência: indício de linha copiada, a esclarecer com o contador. */
export function mesesRepetidos(serie: readonly { mes: string; valor: number }[]): string[] {
  const achados: string[] = [];
  for (let i = 1; i < serie.length; i++) if (serie[i]!.valor !== 0 && serie[i]!.valor === serie[i - 1]!.valor) achados.push(`${serie[i - 1]!.mes} e ${serie[i]!.mes}`);
  return achados;
}

// -------------------------------------------------------- contrapartes ---

export type GrupoContraparte = 'fomento' | 'tributos' | 'cartorio' | 'parte_relacionada' | 'outros';
const FOMENTO = /(factoring|\bfidc\b|securitiza|\bsecurit\b|fomento|direitos credit|fundo de investimentos? em direitos|\bf\.i\.d\.c\b)/i;
const TRIBUTOS = /\b(darf|gps|fgts|receita federal|simples nacional|das\b|inss|pgfn|sefaz|icms)\b/i;
const CARTORIO = /\b(cart[oó]rio|protesto|tabelionato|ieptb)\b/i;

/** Classifica pela RAZÃO SOCIAL ou histórico. `relacionadas` são nomes de sócios e empresas do grupo (informados, nunca inferidos). */
export function classificarContraparte(historico: string, relacionadas: readonly string[] = []): GrupoContraparte {
  const h = historico.toLowerCase();
  if (relacionadas.some((n) => n.trim().length >= 4 && h.includes(n.trim().toLowerCase()))) return 'parte_relacionada';
  if (FOMENTO.test(historico)) return 'fomento';
  if (TRIBUTOS.test(historico)) return 'tributos';
  if (CARTORIO.test(historico)) return 'cartorio';
  return 'outros';
}

export function analisarExtrato(e: Extrato, relacionadas: readonly string[] = []) {
  const porMes = new Map<string, { entradas: number; saidas: number }>();
  const grupos = new Map<GrupoContraparte, { entradas: number; saidas: number }>();
  let saldo = e.saldoInicial ?? 0; let minimo = saldo; let maximo = saldo;
  const dias = new Map<string, number>();
  const ordenadas = [...e.linhas].sort((a, b) => a.data.localeCompare(b.data));
  for (const l of ordenadas) {
    const m = l.data.slice(0, 7); const x = porMes.get(m) ?? { entradas: 0, saidas: 0 };
    if (l.valor >= 0) x.entradas += l.valor; else x.saidas += -l.valor; porMes.set(m, x);
    const g = classificarContraparte(l.historico, relacionadas); const y = grupos.get(g) ?? { entradas: 0, saidas: 0 };
    if (l.valor >= 0) y.entradas += l.valor; else y.saidas += -l.valor; grupos.set(g, y);
    saldo += l.valor; minimo = Math.min(minimo, saldo); maximo = Math.max(maximo, saldo); dias.set(l.data, saldo);
  }
  const meses = [...porMes].sort(([a], [b]) => a.localeCompare(b)).map(([mes, v]) => ({ mes, entradas: r2(v.entradas), saidas: r2(v.saidas), liquido: r2(v.entradas - v.saidas) }));
  const diasNegativos = [...dias.values()].filter((s) => s < 0).length;
  // Queda de atividade: média de entradas dos primeiros 5 meses contra a dos meses restantes (só com 8+ meses).
  let queda: { mediaInicial: number; mediaFinal: number; variacaoPercentual: number } | null = null;
  if (meses.length >= 8) {
    const ini = meses.slice(0, 5); const fim = meses.slice(5);
    const mi = soma(ini.map((m) => m.entradas)) / ini.length; const mf = soma(fim.map((m) => m.entradas)) / fim.length;
    queda = { mediaInicial: r2(mi), mediaFinal: r2(mf), variacaoPercentual: mi ? r2(((mf - mi) / mi) * 100) : 0 };
  }
  const grupo = (g: GrupoContraparte) => { const v = grupos.get(g) ?? { entradas: 0, saidas: 0 }; return { entradas: r2(v.entradas), saidas: r2(v.saidas), liquido: r2(v.entradas - v.saidas) }; };
  const totalEntradas = soma(meses.map((m) => m.entradas));
  return {
    banco: e.banco, ref: e.ref, meses, entradasTotal: r2(totalEntradas), saidasTotal: r2(soma(meses.map((m) => m.saidas))),
    saldoMinimo: r2(minimo), saldoMaximo: r2(maximo), percentualDiasNegativos: dias.size ? r2((diasNegativos / dias.size) * 100) : 0, queda,
    grupos: { fomento: grupo('fomento'), tributos: grupo('tributos'), cartorio: grupo('cartorio'), parteRelacionada: grupo('parte_relacionada'), outros: grupo('outros') },
    percentualFomentoNasEntradas: totalEntradas ? r2((grupo('fomento').entradas / totalEntradas) * 100) : null,
  };
}

// ------------------------------------------------------ concentração ABC ---

export function curvaAbc(clientes: readonly { nome: string; valor: number }[]) {
  const ord = [...clientes].filter((c) => c.valor > 0).sort((a, b) => b.valor - a.valor); const total = soma(ord.map((c) => c.valor));
  const top = (n: number) => (total ? r2((soma(ord.slice(0, n).map((c) => c.valor)) / total) * 100) : null);
  return { total: r2(total), clientes: ord.length, top1: top(1), top5: top(5), top10: top(10), principais: ord.slice(0, 10).map((c) => ({ nome: c.nome, valor: r2(c.valor), percentual: total ? r2((c.valor / total) * 100) : null })) };
}

/** A faixa do passivo entre fontes: mínimo e máximo, nunca uma média que esconda a divergência. */
export function faixaDePassivo(fontes: readonly PassivoFonte[]) {
  if (!fontes.length) return null;
  const tot = fontes.map((f) => f.total); const fis = fontes.map((f) => f.fiscal).filter((x): x is number => x !== null);
  return { total: { minimo: Math.min(...tot), maximo: Math.max(...tot) }, fiscal: fis.length ? { minimo: Math.min(...fis), maximo: Math.max(...fis) } : null, fontes: fontes.map((f) => ({ fonte: f.fonte, total: f.total, fiscal: f.fiscal, ref: f.ref })) };
}

// ------------------------------------------------------------ checklist ---

export type StatusDoChecklist = 'pendente' | 'marcado_sem_arquivo' | 'parcial' | 'sem_resposta' | 'entregue';
export interface ItemDoChecklist { numero: number; titulo: string; area: string; artigo: string | null; situacao: string; temArquivo: boolean }

/** Regra do diagnóstico: "não há" = pendente; "sim" sem arquivo = pendente (marcado sem arquivo); parcial; sem resposta; entregue. */
export function statusDoItem(i: ItemDoChecklist): StatusDoChecklist {
  if (i.situacao === 'nao_aplicavel') return 'entregue';
  if (i.situacao === 'aprovado') return i.temArquivo ? 'entregue' : 'marcado_sem_arquivo';
  if (i.situacao === 'complementacao') return 'parcial';
  if (i.situacao === 'enviado' || i.situacao === 'em_analise') return i.temArquivo ? 'parcial' : 'marcado_sem_arquivo';
  if (i.situacao === 'rejeitado' || i.situacao === 'pendente') return 'pendente';
  return 'sem_resposta';
}

export function coberturaDoChecklist(itens: readonly ItemDoChecklist[]) {
  const contagem: Record<StatusDoChecklist, number> = { pendente: 0, marcado_sem_arquivo: 0, parcial: 0, sem_resposta: 0, entregue: 0 };
  const lista = itens.map((i) => ({ ...i, status: statusDoItem(i) })); for (const i of lista) contagem[i.status]++;
  const total = itens.length; const pct = (n: number) => (total ? r2((n / total) * 100) : 0);
  const pendentes = contagem.pendente + contagem.marcado_sem_arquivo;
  return { total, contagem, percentuais: { pendente: pct(pendentes), parcial: pct(contagem.parcial), semResposta: pct(contagem.sem_resposta), entregue: pct(contagem.entregue) }, pendentesTotal: pendentes, itens: lista };
}

// ---------------------------------------------------------------- riscos ---

export interface Risco { tema: string; achado: string; porQueImporta: string; prioridade: 'Alta' | 'Media'; natureza: 'fato' | 'hipotese' | 'pendencia' }
const NOTA = 'indicativa, conferir redação vigente';

export interface SinaisDeRisco {
  posicao: 'devedor' | 'credor';
  faturamento?: ReturnType<typeof compararFaturamento>;
  dre?: ReturnType<typeof compararDre>;
  balancos?: AnaliseDeBalanco[];
  extratos?: ReturnType<typeof analisarExtrato>[];
  passivo?: ReturnType<typeof faixaDePassivo>;
  cobertura?: ReturnType<typeof coberturaDoChecklist>;
  legiveis?: { lidos: number; ilegiveis: number };
}

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A matriz parte de sinais calculados. Cada linha diz se é FATO, HIPÓTESE ou PENDÊNCIA; nada afirma conduta ilícita. */
export function matrizDeRiscos(s: SinaisDeRisco): Risco[] {
  const r: Risco[] = []; const credor = s.posicao === 'credor';
  const f = s.faturamento;
  if (f && f.diferencaAcumulada > 0 && (f.percentualSobreFiscal ?? 0) >= 20) r.push({
    tema: 'Receita fora do fiscal', natureza: 'fato', prioridade: 'Alta',
    achado: `O faturamento gerencial supera o fiscal em ${brl(f.diferencaAcumulada)} no período (${f.percentualSobreFiscal}% sobre o fiscal).`,
    porQueImporta: credor ? `Indício a esclarecer: receita não escriturada fiscalmente reduz a confiabilidade da base de crédito e pode indicar tributação omitida (legislação tributária; ${NOTA}).`
      : `Receita sem lastro fiscal compromete a credibilidade do pedido e pode ter consequência tributária e penal a esclarecer (LREF art. 51, II; ${NOTA}).`,
  });
  const opostos = (s.dre ?? []).filter((d) => d.sinalOposto);
  if (opostos.length) r.push({
    tema: 'Contabilidade sem lastro', natureza: 'fato', prioridade: 'Alta',
    achado: `Resultado contábil e gerencial com sinais opostos em ${opostos.map((d) => d.ano).join(', ')}.`,
    porQueImporta: `Duas versões do resultado impedem demonstrar a situação econômica (LREF art. 51, II e § 6º; ${NOTA}).`,
  });
  const naoFecham = (s.balancos ?? []).filter((b) => !b.fecha);
  if (naoFecham.length) r.push({
    tema: 'Contabilidade sem lastro', natureza: 'fato', prioridade: 'Alta',
    achado: `O balanço não fecha (ativo diferente de passivo mais PL) em ${naoFecham.map((b) => `${b.exercicio} (diferença ${brl(b.diferenca)})`).join('; ')}.`,
    porQueImporta: `Demonstração que não fecha não serve de base para o pedido nem para proposta a credores (LREF art. 51, II; ${NOTA}).`,
  });
  const iliq = (s.balancos ?? []).filter((b) => b.liquidezCorrente !== null && b.liquidezCorrente < 1);
  if (iliq.length) r.push({
    tema: 'Liquidez de curto prazo', natureza: 'fato', prioridade: 'Alta',
    achado: `Liquidez corrente abaixo de 1,0 em ${iliq.map((b) => `${b.exercicio} (${b.liquidezCorrente!.toLocaleString('pt-BR')})`).join(', ')}.`,
    porQueImporta: `Indica dificuldade de honrar o passivo de curto prazo; pesa na urgência e na via escolhida (LREF art. 20-B; ${NOTA}).`,
  });
  for (const e of s.extratos ?? []) {
    if ((e.percentualFomentoNasEntradas ?? 0) >= 25) r.push({
      tema: 'Fomento e recebíveis', natureza: 'fato', prioridade: 'Alta',
      achado: `${e.percentualFomentoNasEntradas}% das entradas do ${e.banco} vieram de fomento (factoring, FIDC ou securitizadora).`,
      porQueImporta: `Recebíveis cedidos podem estar fora do alcance da recuperação; verificar cessão fiduciária (LREF art. 49, § 3º; ${NOTA}).`,
    });
    if (e.grupos.parteRelacionada.entradas + e.grupos.parteRelacionada.saidas > 0 && Math.abs(e.grupos.parteRelacionada.liquido) > 0) r.push({
      tema: 'Partes relacionadas', natureza: 'hipotese', prioridade: 'Media',
      achado: `Fluxo líquido de ${brl(e.grupos.parteRelacionada.liquido)} com partes relacionadas no ${e.banco}.`,
      porQueImporta: `Hipótese de trabalho: verificar documentação de cada fluxo e eventual confusão patrimonial (LREF art. 129; ${NOTA}).`,
    });
  }
  if (s.passivo?.fiscal && s.passivo.fiscal.maximo !== s.passivo.fiscal.minimo) r.push({
    tema: 'Tributos e contribuições', natureza: 'fato', prioridade: 'Alta',
    achado: `O passivo fiscal varia de ${brl(s.passivo.fiscal.minimo)} a ${brl(s.passivo.fiscal.maximo)} conforme a fonte.`,
    porQueImporta: `Sem relatório fiscal oficial, o passivo tributário é incerto; verificar tributos e contribuições retidos e não recolhidos (${NOTA}).`,
  });
  const c = s.cobertura;
  if (c && c.total > 0) r.push({
    tema: 'Qualidade documental', natureza: 'pendencia', prioridade: c.percentuais.entregue < 50 ? 'Alta' : 'Media',
    achado: `${c.contagem.entregue} de ${c.total} itens do checklist entregues integralmente; ${c.pendentesTotal} pendentes.`,
    porQueImporta: credor ? `Sem documentos do devedor, a avaliação de crédito e a estratégia de habilitação ficam limitadas (${NOTA}).` : `A petição inicial exige os documentos do art. 51 da LREF; a falta pode motivar emenda ou indeferimento (${NOTA}).`,
  });
  if (s.legiveis && s.legiveis.ilegiveis > 0) r.push({
    tema: 'Qualidade documental', natureza: 'pendencia', prioridade: 'Media',
    achado: `${s.legiveis.ilegiveis} de ${s.legiveis.lidos + s.legiveis.ilegiveis} arquivos sem leitura confiável.`,
    porQueImporta: 'Números desses arquivos não entram no relatório; precisam de nova cópia legível.',
  });
  return r;
}

/** O relatório nunca usa travessão longo: troca por vírgula. Aplicado a todo texto gerado. */
export const semTravessao = (t: string) => t.replace(/\s*[—–]\s*/g, ', ');
export function limparTextos<T>(v: T): T {
  if (typeof v === 'string') return semTravessao(v) as T;
  if (Array.isArray(v)) return v.map(limparTextos) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, limparTextos(x)])) as T;
  return v;
}
