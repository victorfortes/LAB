/**
 * Aba QGC, dois instrumentos a partir do QGC validado:
 *
 *  - Recuperação extrajudicial: controle das adesões ao plano (PRE). Por espécie abrangida, quanto do valor
 *    já assinou, frente aos dois marcos do art. 163: pelo menos 1/3 para pedir (§ 7º) e mais da metade para
 *    homologar (caput), com o prazo de 90 dias do § 7º contado do pedido.
 *  - Recuperação judicial: simulador do quórum da AGC. Cada credor recebe um voto hipotético; a apuração usa
 *    o mesmo motor determinístico das assembleias reais (arts. 45 e 58, § 1º), mais o quórum de instalação
 *    do art. 37, § 2º, e o desdobramento do art. 41, § 2º.
 *
 * Aqui só se conta. Direito a voto, abusividade e legalidade do plano continuam com o advogado.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado } from './erros.ts';
import { apurarAssembleia, type VotoLancado } from '../domain/insolvencia/quorum.ts';
import type { ClasseCredor } from '../domain/insolvencia/creditos.ts';
import { NOME_DA_CLASSE } from '../domain/insolvencia/creditos.ts';
import { formatarReais } from '../domain/shared/dinheiro.ts';

interface LinhaCredito {
  id: string; credor_id: string; credor: string; documento: string | null; me_epp: boolean; valor: string; natureza: string;
  valor_bem_gravado: string | null; classe: ClasseCredor | null; sujeito: boolean | null; validado: boolean;
}

async function projeto(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<{ organizacao_id: string; tipo: string; nome: string }>('SELECT organizacao_id, tipo, nome FROM projetos WHERE id = $1', [projetoId]);
  if (!rows[0]) throw new NaoEncontrado('projeto não encontrado');
  return rows[0];
}

async function creditosDoProjeto(db: PoolClient, projetoId: string) {
  return (await db.query<LinhaCredito>(
    // Valor sujeito informado (garantia parcial): vota/adere só o saldo sujeito. Crédito fiduciário com saldo
    // descoberto entra como quirografário (classe III) por esse saldo.
    `SELECT c.id, c.credor_id, cr.nome AS credor, cr.documento, cr.me_epp, coalesce(c.valor_sujeito, c.valor)::text AS valor, c.natureza, c.valor_bem_gravado::text,
            CASE WHEN c.valor_sujeito > 0 AND coalesce(c.sujeito_validado, c.sujeito_sugerido) = false THEN 'III' ELSE coalesce(c.classe_validada, c.classe_sugerida) END AS classe,
            CASE WHEN c.valor_sujeito IS NOT NULL THEN c.valor_sujeito > 0 ELSE coalesce(c.sujeito_validado, c.sujeito_sugerido) END AS sujeito,
            c.classe_validada IS NOT NULL AS validado
       FROM creditos c JOIN credores cr ON cr.id = c.credor_id
      WHERE c.projeto_id = $1 ORDER BY c.valor DESC, cr.nome`, [projetoId])).rows;
}

const fmt = (v: bigint) => formatarReais(v);
const pct = (parte: bigint, total: bigint) => (total > 0n ? Number((parte * 10000n) / total) / 100 : 0);
const hojeIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

// ======================================================================= PRE ===

/**
 * Espécie padrão pelo art. 83 da LREF (redação da Lei 14.112/2020): privilégios especial e geral passaram a
 * integrar os quirografários (art. 83, § 6º), e ME/EPP não é espécie do art. 83, também é quirografário.
 * O que em regra não entra no PRE (art. 161, § 1º: tributários, art. 49, § 3º, e art. 86, II) começa não abrangido.
 */
export function especiePadrao(natureza: string): { especie: string; abrangivel: boolean } {
  switch (natureza) {
    case 'trabalhista': case 'acidente_trabalho': return { especie: 'Trabalhista', abrangivel: true };
    case 'garantia_real': return { especie: 'Garantia real', abrangivel: true };
    case 'subordinado': return { especie: 'Subordinado', abrangivel: true };
    case 'quirografario': case 'privilegio_especial': case 'privilegio_geral': case 'me_epp': return { especie: 'Quirografário', abrangivel: true };
    case 'tributario': return { especie: 'Tributário', abrangivel: false };
    case 'adiantamento_contrato_cambio': return { especie: 'ACC', abrangivel: false };
    case 'posterior_ao_pedido': return { especie: 'Posterior ao pedido', abrangivel: false };
    default: return { especie: 'Propriedade fiduciária e afins', abrangivel: false };
  }
}

export const SITUACOES_PRE = ['pendente', 'negociando', 'aderiu', 'recusou'] as const;
export const EsquemaAdesao = z.object({
  especie: z.string().trim().min(1).max(80).nullable().optional(),
  abrangido: z.boolean().nullable().optional(),
  situacao: z.enum(SITUACOES_PRE).optional(),
  assinadoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  art43: z.boolean().optional(),
  observacao: z.string().trim().max(1000).nullable().optional(),
});
export const EsquemaPlanoPre = z.object({
  dataPedido: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  observacao: z.string().trim().max(2000).nullable().optional(),
});

interface ResumoEspecie {
  especie: string; credores: number; total: string; aderido: string; negociando: string; recusado: string;
  percentual: number; atingiuTerco: boolean; atingiuMaioria: boolean; faltaTerco: string; faltaMaioria: string;
  /** Os maiores pendentes/negociando que, somados, fecham a maioria. */
  caminho: { creditoId: string; credor: string; valor: string; situacao: string }[];
}

/**
 * Apura a espécie pelo valor. "Pelo menos 1/3" (art. 163, § 7º) admite igualdade: 3*aderido >= total.
 * "Mais da metade" (caput) é estrita: 2*aderido > total. Os valores ficam em centavos inteiros.
 */
export function apurarEspecie(especie: string, itens: { creditoId: string; credor: string; valor: bigint; situacao: string }[]): ResumoEspecie {
  let total = 0n; let aderido = 0n; let negociando = 0n; let recusado = 0n;
  for (const i of itens) {
    total += i.valor;
    if (i.situacao === 'aderiu') aderido += i.valor; else if (i.situacao === 'negociando') negociando += i.valor; else if (i.situacao === 'recusou') recusado += i.valor;
  }
  const atingiuTerco = total > 0n && aderido * 3n >= total;
  const atingiuMaioria = total > 0n && aderido * 2n > total;
  // Menor valor que torna 3*x >= total: teto(total/3). Menor que torna 2*x > total: piso(total/2)+1.
  const metaTerco = (total + 2n) / 3n; const metaMaioria = total / 2n + 1n;
  const falta = (meta: bigint) => (aderido >= meta ? 0n : meta - aderido);
  const caminho: ResumoEspecie['caminho'] = [];
  let acumulado = aderido;
  for (const i of [...itens].filter((x) => x.situacao === 'negociando' || x.situacao === 'pendente').sort((a, b) => (b.situacao === 'negociando' ? 1 : 0) - (a.situacao === 'negociando' ? 1 : 0) || (b.valor > a.valor ? 1 : b.valor < a.valor ? -1 : 0))) {
    if (acumulado * 2n > total) break;
    caminho.push({ creditoId: i.creditoId, credor: i.credor, valor: fmt(i.valor), situacao: i.situacao });
    acumulado += i.valor;
  }
  return {
    especie, credores: new Set(itens.map((i) => i.credor)).size, total: fmt(total), aderido: fmt(aderido), negociando: fmt(negociando), recusado: fmt(recusado),
    percentual: pct(aderido, total), atingiuTerco, atingiuMaioria, faltaTerco: fmt(falta(metaTerco)), faltaMaioria: fmt(falta(metaMaioria)),
    caminho: atingiuMaioria ? [] : caminho,
  };
}

export async function painelPre(db: PoolClient, projetoId: string) {
  const p = await projeto(db, projetoId);
  const creditos = await creditosDoProjeto(db, projetoId);
  const { rows: adesoes } = await db.query<{ credito_id: string; especie: string | null; abrangido: boolean | null; situacao: string; assinado_em: string | null; art43: boolean; observacao: string | null; atualizado_em: Date }>(
    'SELECT credito_id, especie, abrangido, situacao, assinado_em::text, art43, observacao, atualizado_em FROM pre_adesoes WHERE projeto_id = $1', [projetoId]);
  const { rows: [plano] } = await db.query<{ data_pedido: string | null; observacao: string | null }>('SELECT data_pedido::text, observacao FROM pre_planos WHERE projeto_id = $1', [projetoId]);
  const porCredito = new Map(adesoes.map((a) => [a.credito_id, a]));

  const linhas = creditos.map((c) => {
    const a = porCredito.get(c.id); const padrao = especiePadrao(c.natureza);
    return {
      creditoId: c.id, credor: c.credor, documento: c.documento, natureza: c.natureza, valor: c.valor, valorFormatado: fmt(BigInt(c.valor)),
      especie: a?.especie ?? padrao.especie, especiePadrao: padrao.especie, abrangido: a?.abrangido ?? padrao.abrangivel,
      situacao: a?.situacao ?? 'pendente', assinadoEm: a?.assinado_em ?? null, art43: a?.art43 ?? false, observacao: a?.observacao ?? null,
      atualizadoEm: a?.atualizado_em ?? null,
    };
  });
  // Entram no percentual só os abrangidos e fora do art. 43 (art. 163, §§ 2º e 3º, II).
  const contam = linhas.filter((l) => l.abrangido && !l.art43);
  const especies = [...new Set(contam.map((l) => l.especie))].sort()
    .map((e) => apurarEspecie(e, contam.filter((l) => l.especie === e).map((l) => ({ creditoId: l.creditoId, credor: l.credor, valor: BigInt(l.valor), situacao: l.situacao }))));

  const dataPedido = plano?.data_pedido ?? null;
  let prazo: { limite: string; diasRestantes: number } | null = null;
  if (dataPedido) {
    const limite = new Date(`${dataPedido}T12:00:00Z`); limite.setUTCDate(limite.getUTCDate() + 90);
    const lim = limite.toISOString().slice(0, 10);
    prazo = { limite: lim, diasRestantes: Math.round((Date.parse(`${lim}T12:00:00Z`) - Date.parse(`${hojeIso()}T12:00:00Z`)) / 86400_000) };
  }
  const podePedir = especies.length > 0 && especies.every((e) => e.atingiuTerco);
  const podeHomologar = especies.length > 0 && especies.every((e) => e.atingiuMaioria);
  return {
    tipoProjeto: p.tipo, linhas, especies, dataPedido, observacao: plano?.observacao ?? null, prazo, podePedir, podeHomologar,
    totais: {
      abrangidos: contam.length, aderiram: contam.filter((l) => l.situacao === 'aderiu').length,
      foraDoPlano: linhas.filter((l) => !l.abrangido).length, art43: linhas.filter((l) => l.art43).length,
    },
    fundamentos: [
      'Art. 163, caput: homologação com assinatura de credores que representem mais da metade dos créditos de cada espécie abrangida.',
      'Art. 163, § 7º: o pedido pode ser feito com pelo menos 1/3 de cada espécie, e o devedor tem 90 dias improrrogáveis, contados do pedido, para atingir a maioria.',
      'Art. 163, §§ 2º e 3º, II: não entram no cálculo os créditos não abrangidos nem os das pessoas do art. 43.',
      'Art. 161, § 5º: depois do pedido, o credor só desiste da adesão com a anuência expressa dos demais signatários.',
    ],
  };
}

export async function salvarAdesao(db: PoolClient, projetoId: string, creditoId: string, d: z.infer<typeof EsquemaAdesao>, i: Identidade) {
  const p = await projeto(db, projetoId);
  const { rows: [c] } = await db.query<{ id: string }>('SELECT id FROM creditos WHERE id = $1 AND projeto_id = $2', [creditoId, projetoId]);
  if (!c) throw new NaoEncontrado('crédito não encontrado neste projeto');
  const assinadoEm = d.situacao && d.situacao !== 'aderiu' ? null : d.assinadoEm === undefined ? (d.situacao === 'aderiu' ? hojeIso() : undefined) : d.assinadoEm;
  const { rows: [antes] } = await db.query('SELECT especie, abrangido, situacao, assinado_em::text, art43 FROM pre_adesoes WHERE credito_id = $1', [creditoId]);
  await db.query(
    `INSERT INTO pre_adesoes (credito_id, organizacao_id, projeto_id, especie, abrangido, situacao, assinado_em, art43, observacao, atualizado_por)
     VALUES ($1,$2,$3,$4,$5,coalesce($6,'pendente'),$7,coalesce($8,false),$9,$10)
     ON CONFLICT (credito_id) DO UPDATE SET
       especie = CASE WHEN $11 THEN EXCLUDED.especie ELSE pre_adesoes.especie END,
       abrangido = CASE WHEN $12 THEN EXCLUDED.abrangido ELSE pre_adesoes.abrangido END,
       situacao = coalesce($6, pre_adesoes.situacao),
       assinado_em = CASE WHEN $13 THEN EXCLUDED.assinado_em ELSE pre_adesoes.assinado_em END,
       art43 = coalesce($8, pre_adesoes.art43),
       observacao = CASE WHEN $14 THEN EXCLUDED.observacao ELSE pre_adesoes.observacao END,
       atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
    [creditoId, p.organizacao_id, projetoId, d.especie ?? null, d.abrangido ?? null, d.situacao ?? null, assinadoEm ?? null, d.art43 ?? null, d.observacao ?? null, i.usuarioId,
     d.especie !== undefined, d.abrangido !== undefined, assinadoEm !== undefined, d.observacao !== undefined]);
  await auditar(db, { organizacaoId: p.organizacao_id, usuarioId: i.usuarioId, acao: 'pre.adesao', entidade: 'credito', entidadeId: creditoId, antes: antes ?? null, depois: d });
  return { ok: true };
}

export async function salvarPlanoPre(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaPlanoPre>, i: Identidade) {
  const p = await projeto(db, projetoId);
  await db.query(`INSERT INTO pre_planos (projeto_id, organizacao_id, data_pedido, observacao, atualizado_por) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (projeto_id) DO UPDATE SET data_pedido = EXCLUDED.data_pedido, observacao = coalesce(EXCLUDED.observacao, pre_planos.observacao), atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
    [projetoId, p.organizacao_id, d.dataPedido, d.observacao ?? null, i.usuarioId]);
  await auditar(db, { organizacaoId: p.organizacao_id, usuarioId: i.usuarioId, acao: 'pre.plano', entidade: 'projeto', entidadeId: projetoId, depois: d });
  return { ok: true };
}

// ======================================================================= AGC ===

export const VOTOS_SIMULADOS = ['sim', 'nao', 'abstencao', 'ausente'] as const;
type VotoSimulado = typeof VOTOS_SIMULADOS[number];
const chaveVoto = z.string().regex(/^(I|II|III|IV):[0-9a-f-]{36}$/);
export const EsquemaCenario = z.object({
  nome: z.string().trim().min(1).max(60),
  convocacao: z.enum(['primeira', 'segunda']).default('primeira'),
  votos: z.record(chaveVoto, z.enum(VOTOS_SIMULADOS)).refine((v) => Object.keys(v).length <= 5000, 'votos demais'),
  /** Só calcula, sem gravar (arrastar um voto e ver o resultado na hora). */
  rascunho: z.boolean().default(false),
});

interface CabecaNaClasse { chave: string; classe: ClasseCredor; credorId: string; credor: string; valor: bigint; creditos: number; desdobrada: boolean }

/**
 * Cabeças votantes por classe, a partir do QGC validado (ou da classe sugerida, quando ainda não validada).
 * Crédito não sujeito não vota (art. 45, § 3º, e art. 49). Garantia real vota na classe II até o valor do bem
 * e na III pelo excedente (art. 41, § 2º). O mesmo credor com vários créditos na classe é uma cabeça só.
 */
export function cabecasPorClasse(creditos: Pick<LinhaCredito, 'id' | 'credor_id' | 'credor' | 'valor' | 'valor_bem_gravado' | 'classe' | 'sujeito'>[]) {
  const mapa = new Map<string, CabecaNaClasse>();
  const somar = (classe: ClasseCredor, c: typeof creditos[number], valor: bigint, desdobrada: boolean) => {
    const chave = `${classe}:${c.credor_id}`;
    const atual = mapa.get(chave);
    if (atual) { atual.valor += valor; atual.creditos++; atual.desdobrada ||= desdobrada; } else mapa.set(chave, { chave, classe, credorId: c.credor_id, credor: c.credor, valor, creditos: 1, desdobrada });
  };
  for (const c of creditos) {
    if (c.sujeito === false || !c.classe) continue;
    const valor = BigInt(c.valor);
    if (c.classe === 'II' && c.valor_bem_gravado !== null && BigInt(c.valor_bem_gravado) < valor) {
      const bem = BigInt(c.valor_bem_gravado);
      if (bem > 0n) somar('II', c, bem, true);
      somar('III', c, valor - bem, true);
    } else somar(c.classe, c, valor, false);
  }
  return [...mapa.values()];
}

/** Apuração do cenário: instalação (art. 37, § 2º), deliberação por classe (art. 45) e cram down (art. 58, § 1º). */
export function simular(cabecas: CabecaNaClasse[], votos: Record<string, VotoSimulado>, convocacao: 'primeira' | 'segunda') {
  const ordem: ClasseCredor[] = ['I', 'II', 'III', 'IV'];
  const lancados: VotoLancado[] = [];
  for (const c of cabecas) {
    const v = votos[c.chave] ?? 'ausente';
    if (v !== 'ausente') lancados.push({ credor: c.credorId, classe: c.classe, valor: c.valor, voto: v });
  }
  const apuracao = apurarAssembleia(lancados);
  const classes = ordem.filter((k) => cabecas.some((c) => c.classe === k)).map((k) => {
    const daClasse = cabecas.filter((c) => c.classe === k);
    const totalValor = daClasse.reduce((s, c) => s + c.valor, 0n);
    const presentes = daClasse.filter((c) => (votos[c.chave] ?? 'ausente') !== 'ausente');
    const valorPresente = presentes.reduce((s, c) => s + c.valor, 0n);
    // Art. 37, § 2º: em 1ª convocação, instala com credores titulares de mais da metade dos créditos de cada classe, pelo valor.
    const instalada = convocacao === 'segunda' || (totalValor > 0n && valorPresente * 2n > totalValor);
    const a = apuracao.classes.find((x) => x.classe === k);
    const simCab = a?.sim.credores ?? 0; const presCab = a?.presentes.credores ?? 0;
    const simVal = a?.sim.valor ?? 0n; const presVal = a?.presentes.valor ?? 0n;
    // Quanto falta para aprovar: cabeças "sim" a mais (2*sim > presentes) e valor "sim" a mais (2*sim > presente).
    const faltaCabecas = presCab === 0 ? 0 : Math.max(0, Math.floor(presCab / 2) + 1 - simCab);
    const faltaValor = a?.criterio === 'cumulativo' && presVal > 0n ? (simVal * 2n > presVal ? 0n : presVal / 2n + 1n - simVal) : 0n;
    return {
      classe: k, nome: NOME_DA_CLASSE[k], criterio: a?.criterio ?? (k === 'I' || k === 'IV' ? 'cabeca' : 'cumulativo'),
      totalCredores: daClasse.length, totalValor: fmt(totalValor),
      presentes: { credores: presCab, valor: fmt(presVal), percentualValorDaClasse: pct(valorPresente, totalValor) },
      sim: { credores: simCab, valor: fmt(simVal) }, nao: { credores: a?.nao.credores ?? 0, valor: fmt(a?.nao.valor ?? 0n) }, abstencoes: a?.abstencoes ?? 0,
      percentualCabecas: presCab ? Math.round((simCab / presCab) * 10000) / 100 : 0,
      percentualValor: a?.criterio === 'cumulativo' ? pct(simVal, presVal) : null,
      aprovadaPorCabeca: a?.aprovadaPorCabeca ?? false, aprovadaPorValor: a?.aprovadaPorValor ?? null, aprovada: a?.aprovada ?? false,
      instalada, faltaCabecas, faltaValor: fmt(faltaValor), fundamento: a?.fundamento ?? '',
    };
  });
  const instalada = classes.every((c) => c.instalada);
  const cd = apuracao.cramDown;
  return {
    convocacao, instalada, classes,
    aprovadoPeloArt45: instalada && apuracao.aprovadoPeloArt45,
    cramDown: {
      cabivel: instalada && cd.cabivel,
      incisoI: { atendido: cd.incisoI.atendido, valorSim: fmt(cd.incisoI.valorSim), valorPresente: fmt(cd.incisoI.valorPresente), percentual: pct(cd.incisoI.valorSim, cd.incisoI.valorPresente) },
      incisoII: cd.incisoII,
      incisoIII: { atendido: cd.incisoIII.atendido, classesRejeitantes: cd.incisoIII.classesRejeitantes.map((r) => ({ ...r, proporcao: Math.round(r.proporcao * 10000) / 100, proporcaoValor: r.proporcaoValor === null ? null : Math.round(r.proporcaoValor * 10000) / 100 })) },
      ressalvas: cd.ressalvas,
    },
    concessaoPossivel: instalada && apuracao.concessaoPossivel,
    ressalvas: [
      ...(instalada ? [] : ['Assembleia não se instala em 1ª convocação: alguma classe não tem presentes com mais da metade do valor (art. 37, § 2º). Em 2ª convocação instala com qualquer número.']),
      ...apuracao.ressalvas,
      'Sócios, controladores e demais pessoas do art. 43 não votam nem contam para o quórum: marque-os como ausentes.',
      'Art. 45-A: a deliberação pode ser substituída por termos de adesão que atinjam o mesmo quórum; aí marque como ausente quem não assinou.',
    ],
  };
}

export async function painelAgc(db: PoolClient, projetoId: string, nome: string | null) {
  const p = await projeto(db, projetoId);
  const creditos = await creditosDoProjeto(db, projetoId);
  const cabecas = cabecasPorClasse(creditos);
  const { rows: cenarios } = await db.query<{ nome: string; convocacao: 'primeira' | 'segunda'; votos: Record<string, VotoSimulado>; atualizado_em: Date }>(
    'SELECT nome, convocacao, votos, atualizado_em FROM agc_cenarios WHERE projeto_id = $1 ORDER BY atualizado_em DESC', [projetoId]);
  const atual = (nome ? cenarios.find((c) => c.nome === nome) : cenarios[0]) ?? { nome: 'Cenário 1', convocacao: 'primeira' as const, votos: {}, atualizado_em: null };
  return {
    tipoProjeto: p.tipo,
    cabecas: cabecas.map((c) => ({ chave: c.chave, classe: c.classe, credor: c.credor, valor: fmt(c.valor), valorCentavos: c.valor.toString(), creditos: c.creditos, desdobrada: c.desdobrada })),
    pendentesDeValidacao: creditos.filter((c) => !c.validado).length,
    naoSujeitos: creditos.filter((c) => c.sujeito === false).length,
    cenarios: cenarios.map((c) => ({ nome: c.nome, atualizadoEm: c.atualizado_em })),
    cenario: { nome: atual.nome, convocacao: atual.convocacao, votos: atual.votos },
    apuracao: simular(cabecas, atual.votos, atual.convocacao),
    poderDeVoto: poderDeVoto(cabecas),
  };
}

/**
 * Poder de voto a partir da relação de credores: por classe, a fatia de cada credor no valor e na contagem
 * por cabeça, e o MENOR grupo de credores que, sozinho, decide a classe pelo valor (maioria do art. 45).
 * É a pergunta da negociação: "com quem eu preciso fechar para aprovar esta classe?".
 */
export function poderDeVoto(cabecas: CabecaNaClasse[]) {
  const ordem: ClasseCredor[] = ['I', 'II', 'III', 'IV'];
  const totalGeral = cabecas.reduce((s, c) => s + c.valor, 0n);
  return ordem.filter((k) => cabecas.some((c) => c.classe === k)).map((k) => {
    const lista = cabecas.filter((c) => c.classe === k).sort((a, b) => (b.valor > a.valor ? 1 : b.valor < a.valor ? -1 : a.credor.localeCompare(b.credor)));
    const total = lista.reduce((s, c) => s + c.valor, 0n);
    let acumulado = 0n; let decisivos = 0;
    const credores = lista.map((c) => {
      const antes = acumulado; acumulado += c.valor;
      const decisivo = antes * 2n <= total; // ainda não havia maioria antes deste credor
      if (decisivo) decisivos++;
      return { chave: c.chave, credor: c.credor, valor: fmt(c.valor), percentualClasse: pct(c.valor, total), percentualAcumulado: pct(acumulado, total), percentualGeral: pct(c.valor, totalGeral), decisivo };
    });
    const porCabeca = k === 'I' || k === 'IV';
    return {
      classe: k, nome: NOME_DA_CLASSE[k], total: fmt(total), percentualDoTotal: pct(total, totalGeral), credores: lista.length,
      criterio: porCabeca ? 'cabeca' : 'cumulativo',
      // Classe por valor (II e III): quantos dos maiores decidem o valor; a cabeça exige ainda mais da metade dos presentes.
      minimoParaValor: porCabeca ? null : decisivos,
      minimoParaCabecas: Math.floor(lista.length / 2) + 1,
      concentracao: lista[0] ? pct(lista[0].valor, total) : 0,
      lista: credores,
    };
  });
}

export async function salvarCenario(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaCenario>, i: Identidade) {
  const p = await projeto(db, projetoId);
  const cabecas = cabecasPorClasse(await creditosDoProjeto(db, projetoId));
  const validas = new Set(cabecas.map((c) => c.chave));
  const votos = Object.fromEntries(Object.entries(d.votos).filter(([k]) => validas.has(k)));
  if (!d.rascunho) {
    await db.query(`INSERT INTO agc_cenarios (organizacao_id, projeto_id, nome, convocacao, votos, atualizado_por) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
      ON CONFLICT (projeto_id, nome) DO UPDATE SET convocacao = EXCLUDED.convocacao, votos = EXCLUDED.votos, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
      [p.organizacao_id, projetoId, d.nome, d.convocacao, JSON.stringify(votos), i.usuarioId]);
  }
  return { nome: d.nome, salvo: !d.rascunho, apuracao: simular(cabecas, votos, d.convocacao) };
}

export async function removerCenario(db: PoolClient, projetoId: string, nome: string, i: Identidade) {
  const p = await projeto(db, projetoId);
  const r = await db.query('DELETE FROM agc_cenarios WHERE projeto_id = $1 AND nome = $2', [projetoId, nome]);
  if (!r.rowCount) throw new NaoEncontrado('cenário não encontrado');
  await auditar(db, { organizacaoId: p.organizacao_id, usuarioId: i.usuarioId, acao: 'agc.cenario_removido', entidade: 'projeto', entidadeId: projetoId, depois: { nome } });
  return { ok: true };
}
