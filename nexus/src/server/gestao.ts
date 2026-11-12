/**
 * Gestão financeira da recuperanda, PRJ Studio, PMT, atas, chat e acompanhamento do LAB.
 *
 * Quem separa os dados é o RLS: o escritório só LÊ o financeiro autorizado no portal, e o
 * lançamento exige ser da organização do cliente. Cálculo vem só dos motores determinísticos.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { raioX, type DocumentoLido } from '../domain/analise/raio_x.ts';
import { extrair } from './analise_auto.ts';
import { lerConteudoDocumento, type Deposito } from './arquivos.ts';
import { chaveDoHash } from '../store/arquivos.ts';
import { somarMeses } from '../domain/shared/datas.ts';
import { repartir } from '../domain/shared/dinheiro.ts';
import { gerarCronograma } from '../domain/insolvencia/plano.ts';
import { fluxo, concentracao, type Granularidade } from '../domain/financeiro/motor.ts';
import { chaveDedupe, type LinhaImportada } from '../domain/financeiro/importacao.ts';
import { CENARIOS_DE_ESTRESSE, ParametroInvalido, otimizar, sensibilidade, simular, type CaixaBase, type ClassePrj, type Entrada, type Estresse } from '../domain/insolvencia/prj_motor.ts';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CENTAVOS = z.string().regex(/^-?\d{1,18}$/);
const POSITIVO = z.string().regex(/^\d{1,18}$/);
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString().slice(0, 10));

async function orgCliente(db: PoolClient, projetoId: string, i: Identidade): Promise<string> {
  const ids = i.organizacoes.filter((o) => o.tipo === 'cliente').map((o) => o.id);
  const { rows } = await db.query<{ o: string }>('SELECT organizacao_cliente_id AS o FROM portais WHERE projeto_id=$1 AND ativo AND mostra_financeiro AND organizacao_cliente_id=ANY($2::uuid[])', [projetoId, ids]);
  if (rows.length !== 1) throw new NaoEncontrado('financeiro não disponível para este vínculo com o projeto');
  return rows[0]!.o;
}

// ------------------------------------------------------------- financeiro ---
export const EsquemaTitulo = z.object({
  tipo: z.enum(['pagar', 'receber']), contraparte: z.string().trim().min(1).max(300), descricao: z.string().max(1000).optional(), categoria: z.string().trim().max(120).default('Sem categoria'),
  centroCusto: z.string().trim().max(120).optional(), competencia: DATA.optional(), vencimento: DATA, valor: POSITIVO.refine((v) => BigInt(v) > 0n, 'valor deve ser positivo'), parcelas: z.number().int().min(1).max(360).default(1),
});

export async function criarTitulo(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaTitulo>, i: Identidade) {
  const org = await orgCliente(db, projetoId, i); const valores = repartir(BigInt(d.valor), d.parcelas); const ids: string[] = [];
  const lote = crypto.randomUUID();
  for (let n = 0; n < d.parcelas; n++) {
    const vencimento = somarMeses(d.vencimento, n);
    const { rows } = await db.query<{ id: string }>(`INSERT INTO titulos (organizacao_id,projeto_id,tipo,contraparte,descricao,categoria,centro_custo,competencia,vencimento,valor_original,valor_atualizado,parcela,parcelas,chave_dedupe,criado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14) RETURNING id`, [org, projetoId, d.tipo, d.contraparte, d.descricao ?? null, d.categoria, d.centroCusto ?? null, d.competencia ?? null, vencimento, valores[n]!.toString(), d.parcelas > 1 ? n + 1 : null, d.parcelas > 1 ? d.parcelas : null, `manual:${lote}:${n}`, i.usuarioId]);
    ids.push(rows[0]!.id);
    await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'titulo.criado', entidade: 'titulo', entidadeId: rows[0]!.id, depois: { tipo: d.tipo, vencimento, parcela: n + 1 } });
  }
  return { ids };
}

export const EsquemaBaixa = z.object({ valor: POSITIVO, data: DATA, contaId: z.string().uuid().optional() });
export async function baixarTitulo(db: PoolClient, tituloId: string, d: z.infer<typeof EsquemaBaixa>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; projeto_id: string; tipo: string; contraparte: string; categoria: string; valor_atualizado: string; valor_liquidado: string; situacao: string; centro_custo: string | null }>('SELECT * FROM titulos WHERE id=$1 FOR UPDATE', [tituloId]);
  const t = rows[0]; if (!t) throw new NaoEncontrado('título não encontrado');
  await orgCliente(db, t.projeto_id, i);
  if (t.situacao === 'cancelado' || t.situacao === 'liquidado') throw new PedidoInvalido('este título não está em aberto');
  const pago = BigInt(d.valor); const saldo = BigInt(t.valor_atualizado) - BigInt(t.valor_liquidado);
  if (pago <= 0n || pago > saldo) throw new PedidoInvalido('o valor da baixa precisa ficar entre zero e o saldo em aberto');
  await db.query(`INSERT INTO lancamentos (organizacao_id,projeto_id,conta_id,data,tipo,situacao,valor,categoria,contraparte,titulo_id,centro_custo,criado_por) VALUES ($1,$2,$3,$4,$5,'realizado',$6,$7,$8,$9,$10,$11)`,
    [t.organizacao_id, t.projeto_id, d.contaId ?? null, d.data, t.tipo === 'pagar' ? 'despesa' : 'receita', pago.toString(), t.categoria, t.contraparte, tituloId, t.centro_custo, i.usuarioId]);
  const novo = BigInt(t.valor_liquidado) + pago;
  await db.query(`UPDATE titulos SET valor_liquidado=$2, situacao=$3, atualizado_em=now() WHERE id=$1`, [tituloId, novo.toString(), novo === BigInt(t.valor_atualizado) ? 'liquidado' : 'parcial']);
  await auditar(db, { organizacaoId: t.organizacao_id, usuarioId: i.usuarioId, acao: 'titulo.baixado', entidade: 'titulo', entidadeId: tituloId, depois: { valor: d.valor, data: d.data } });
  return { ok: true };
}

export async function painelFinanceiro(db: PoolClient, projetoId: string, g: Granularidade) {
  // Em sequência: a transação usa uma conexão só, e ela não executa consultas em paralelo.
  const { rows: contas } = await db.query<{ id: string; nome: string; saldo_inicial: string }>('SELECT id,nome,saldo_inicial FROM contas_financeiras WHERE projeto_id=$1', [projetoId]);
  const { rows: lanc } = await db.query<{ data: Date; tipo: 'receita' | 'despesa'; situacao: 'previsto' | 'realizado'; valor: string; titulo_id: string | null; categoria: string; contraparte: string | null }>('SELECT data,tipo,situacao,valor,titulo_id,categoria,contraparte FROM lancamentos WHERE projeto_id=$1', [projetoId]);
  const { rows: tit } = await db.query('SELECT * FROM titulos WHERE projeto_id=$1 ORDER BY vencimento LIMIT 5000', [projetoId]);
  const { rows: imp } = await db.query('SELECT id,arquivo,formato,linhas,importadas,duplicadas,erros,criado_em FROM fin_importacoes WHERE projeto_id=$1 ORDER BY criado_em DESC LIMIT 30', [projetoId]);
  const h = hoje(); const saldoInicial = contas.reduce((a, c) => a + BigInt(c.saldo_inicial), 0n);
  const titulos = (tit as Array<Record<string, any>>).map((t) => ({ id: t.id as string, tipo: t.tipo as 'pagar' | 'receber', contraparte: t.contraparte as string, descricao: t.descricao as string | null, categoria: t.categoria as string, centroCusto: t.centro_custo as string | null, vencimento: dia(t.vencimento)!, valorOriginal: t.valor_original as string, valorAtualizado: t.valor_atualizado as string, valorLiquidado: t.valor_liquidado as string, saldo: (BigInt(t.valor_atualizado) - BigInt(t.valor_liquidado)).toString(), situacao: t.situacao as string, parcela: t.parcela as number | null, parcelas: t.parcelas as number | null, origem: t.origem as string, vencido: dia(t.vencimento)! < h && !['liquidado', 'cancelado'].includes(t.situacao) }));
  const lancs = lanc.map((l) => ({ data: dia(l.data)!, tipo: l.tipo, situacao: l.situacao, valor: BigInt(l.valor), tituloId: l.titulo_id }));
  const f = fluxo({ saldoInicial, hoje: h, lancamentos: lancs, titulos: titulos.map((t) => ({ tipo: t.tipo, vencimento: t.vencimento, valorAtualizado: BigInt(t.valorAtualizado), valorLiquidado: BigInt(t.valorLiquidado), situacao: t.situacao })), granularidade: g });
  const soma = (tipo: string) => lancs.filter((l) => l.situacao === 'realizado' && l.tipo === tipo).reduce((a, l) => a + l.valor, 0n);
  const abertos = (tipo: string) => titulos.filter((t) => t.tipo === tipo && BigInt(t.saldo) > 0n && !['cancelado', 'liquidado'].includes(t.situacao));
  const emAte = (tipo: string, d: number) => { const lim = new Date(`${h}T12:00:00Z`); lim.setUTCDate(lim.getUTCDate() + d); const fim = lim.toISOString().slice(0, 10); return abertos(tipo).filter((t) => t.vencimento <= fim).reduce((a, t) => a + BigInt(t.saldo), 0n); };
  const receber = abertos('receber').reduce((a, t) => a + BigInt(t.saldo), 0n);
  return { hoje: h, contas, titulos, importacoes: imp, totalLancamentos: lancs.length, fluxo: f,
    indicadores: { receitasRealizadas: soma('receita'), despesasRealizadas: soma('despesa'), resultado: soma('receita') - soma('despesa'), inadimplencia: receber ? Number((f.vencidoReceber * 10000n) / receber) / 100 : null, pagar14: emAte('pagar', 14), receber14: emAte('receber', 14), necessidadeCapitalGiro: f.aPagar > receber + f.saldoAtual ? f.aPagar - receber - f.saldoAtual : 0n, },
    concentracaoRecebiveis: concentracao(abertos('receber').map((t) => ({ contraparte: t.contraparte, saldo: BigInt(t.saldo) }))) };
}

export const EsquemaConfirmacaoImportacao = z.object({
  arquivo: z.string().trim().min(1).max(300), formato: z.string().max(20),
  linhas: z.array(z.object({ data: DATA, valor: POSITIVO, tipo: z.enum(['receita', 'despesa']), natureza: z.enum(['lancamento', 'titulo']), descricao: z.string().max(500).default(''), contraparte: z.string().max(300).default(''), categoria: z.string().max(120).default('Sem categoria'), situacao: z.enum(['realizado', 'previsto']), documento: z.string().max(120).nullable().optional() })).min(1).max(20_000),
});
export async function confirmarImportacao(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaConfirmacaoImportacao>, i: Identidade) {
  const org = await orgCliente(db, projetoId, i); const imp = crypto.randomUUID(); let importadas = 0; let duplicadas = 0;
  for (const l of d.linhas as LinhaImportada[] as Array<LinhaImportada & { data: string; valor: string }>) {
    const chave = chaveDedupe(l);
    const r = l.natureza === 'titulo'
      ? await db.query(`INSERT INTO titulos (organizacao_id,projeto_id,tipo,contraparte,descricao,categoria,vencimento,valor_original,valor_atualizado,origem,origem_ref,chave_dedupe,importacao_id,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,'importacao',$9,$10,$11,$12) ON CONFLICT (projeto_id,chave_dedupe) DO NOTHING`,
        [org, projetoId, l.tipo === 'despesa' ? 'pagar' : 'receber', l.contraparte || '(sem nome)', l.descricao, l.categoria, l.data, l.valor, l.documento ?? null, chave, imp, i.usuarioId])
      : await db.query(`INSERT INTO lancamentos (organizacao_id,projeto_id,data,tipo,situacao,valor,categoria,contraparte,documento,origem,chave_dedupe,importacao_id,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'importacao',$10,$11,$12) ON CONFLICT (projeto_id,chave_dedupe) WHERE chave_dedupe IS NOT NULL DO NOTHING`,
        [org, projetoId, l.data, l.tipo, l.situacao, l.valor, l.categoria, l.contraparte || null, l.documento ?? l.descricao ?? null, chave, imp, i.usuarioId]);
    if (r.rowCount) importadas++; else duplicadas++;
  }
  await db.query('INSERT INTO fin_importacoes (id,organizacao_id,projeto_id,arquivo,formato,linhas,importadas,duplicadas,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [imp, org, projetoId, d.arquivo, d.formato, d.linhas.length, importadas, duplicadas, i.usuarioId]);
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'financeiro.importado', entidade: 'projeto', entidadeId: projetoId, depois: { arquivo: d.arquivo, importadas, duplicadas } });
  return { importadas, duplicadas };
}

// ------------------------------------------------------------- PRJ Studio ---
const CondicaoZ = z.object({
  desagio: z.number().min(0).lt(1), carenciaMeses: z.number().int().min(0).max(240), parcelas: z.number().int().min(1).max(360),
  periodicidade: z.enum(['mensal', 'bimestral', 'trimestral', 'semestral', 'anual']), jurosAoAno: z.number().min(0).max(2), correcaoAoAno: z.number().min(0).max(2).default(0),
  sistema: z.enum(['sem_juros', 'sac', 'price']).default('sem_juros'), capitalizarNaCarencia: z.boolean().default(false), modalidade: z.enum(['parcelas', 'bullet', 'escalonado']).default('parcelas'),
  bulletPercentual: z.number().gt(0).max(1).optional(), percentuais: z.array(z.number().min(0).max(1)).max(360).optional(),
});
const CaixaZ = z.object({ saldoInicial: CENTAVOS, inicio: DATA, receitaMensal: POSITIVO, outrasEntradasMensal: POSITIVO.default('0'), despesaMensal: POSITIVO, tributosMensal: POSITIVO.default('0'), extraconcursalMensal: POSITIVO.default('0'), investimentoMensal: POSITIVO.default('0'), crescimentoReceitaAoMes: z.number().min(-0.5).max(0.5).default(0) });
const EstresseZ = z.object({ receita: z.number().min(-1).max(2).optional(), despesa: z.number().min(-1).max(2).optional(), inadimplencia: z.number().min(0).max(1).optional(), atrasoDias: z.number().int().min(0).max(365).optional(), perdaClienteMensal: POSITIVO.optional(), perdaClienteMes: z.number().int().min(0).max(360).optional(), custoFinanceiroMensal: POSITIVO.optional(), investimentoExtra: POSITIVO.optional(), investimentoExtraMes: z.number().int().min(0).max(360).optional() }).default({});
export const EsquemaEstudio = z.object({
  marco: DATA, classes: z.array(z.object({ id: z.string().min(1).max(30), rotulo: z.string().min(1).max(80), credito: POSITIVO, condicao: CondicaoZ })).min(1).max(30),
  caixa: CaixaZ, horizonte: z.number().int().min(1).max(360), reservaMinima: CENTAVOS.default('0'), taxaDesconto: z.number().min(0).max(1).default(0), estresse: EstresseZ, cenarioEstresse: z.enum(['base', 'otimista', 'conservador', 'severo', 'personalizado']).default('personalizado'),
});
export type ParametrosEstudio = z.infer<typeof EsquemaEstudio>;

function entrada(p: ParametrosEstudio): Entrada {
  const c = p.caixa; const e = p.estresse;
  const caixa: CaixaBase = { saldoInicial: BigInt(c.saldoInicial), inicio: c.inicio, receitaMensal: BigInt(c.receitaMensal), outrasEntradasMensal: BigInt(c.outrasEntradasMensal), despesaMensal: BigInt(c.despesaMensal), tributosMensal: BigInt(c.tributosMensal), extraconcursalMensal: BigInt(c.extraconcursalMensal), investimentoMensal: BigInt(c.investimentoMensal), crescimentoReceitaAoMes: c.crescimentoReceitaAoMes };
  const estresse: Estresse = p.cenarioEstresse === 'personalizado' ? { ...e, perdaClienteMensal: e.perdaClienteMensal ? BigInt(e.perdaClienteMensal) : undefined, custoFinanceiroMensal: e.custoFinanceiroMensal ? BigInt(e.custoFinanceiroMensal) : undefined, investimentoExtra: e.investimentoExtra ? BigInt(e.investimentoExtra) : undefined } as Estresse : CENARIOS_DE_ESTRESSE[p.cenarioEstresse]!;
  return { marco: p.marco, classes: p.classes.map((x) => ({ ...x, credito: BigInt(x.credito) })) as ClassePrj[], caixa, horizonte: p.horizonte, reservaMinima: BigInt(p.reservaMinima), taxaDesconto: p.taxaDesconto, estresse };
}
const emParametro = <T>(f: () => T): T => { try { return f(); } catch (e) { if (e instanceof ParametroInvalido) throw new PedidoInvalido(e.message); throw e; } };

export function simularEstudio(p: ParametrosEstudio) {
  return emParametro(() => { const e = entrada(p); const r = simular(e); const { cronogramas, ...resto } = r;
    return { ...resto, classes: cronogramas.map(({ parcelas, ...c }) => ({ ...c, numeroDeParcelas: parcelas.length, primeira: parcelas[0]?.valor ?? 0n, primeiroVencimento: parcelas[0]?.vencimento ?? null, ultimoVencimento: parcelas.at(-1)?.vencimento ?? null, cronograma: parcelas })), sensibilidade: sensibilidade(e) }; });
}
export const EsquemaOtimizacao = z.object({ parametros: EsquemaEstudio, classeId: z.string().min(1).max(30), desagio: z.tuple([z.number().min(0).lt(1), z.number().min(0).lt(1)]), passoDesagio: z.number().gt(0), carencia: z.tuple([z.number().int().min(0), z.number().int().max(240)]), passoCarencia: z.number().int().min(1), parcelas: z.tuple([z.number().int().min(1), z.number().int().max(360)]), passoParcelas: z.number().int().min(1), reservaMinima: POSITIVO, limiteAnual: POSITIVO.optional(), pagamentoMinimo: POSITIVO.optional() });
export function otimizarEstudio(d: z.infer<typeof EsquemaOtimizacao>) {
  return emParametro(() => otimizar(entrada(d.parametros), { ...d, reservaMinima: BigInt(d.reservaMinima), limiteAnual: d.limiteAnual ? BigInt(d.limiteAnual) : undefined, pagamentoMinimo: d.pagamentoMinimo ? BigInt(d.pagamentoMinimo) : undefined }));
}

const ROTULOS: Record<string, string> = { I: 'I · Trabalhista', II: 'II · Garantia real', III: 'III · Quirografários', IV: 'IV · ME e EPP' };
export async function baseDoEstudio(db: PoolClient, projetoId: string) {
  const p = await db.query('SELECT id FROM projetos WHERE id=$1', [projetoId]); if (!p.rowCount) throw new NaoEncontrado('projeto não encontrado');
  const { rows: cred } = await db.query<{ classe: string; n: string; total: string }>(`SELECT classe_validada AS classe, count(*) n, sum(valor) total FROM creditos WHERE projeto_id=$1 AND sujeito_validado IS TRUE AND classe_validada IS NOT NULL GROUP BY 1 ORDER BY 1`, [projetoId]);
  const { rows: pend } = await db.query<{ n: string; total: string | null }>(`SELECT count(*) n, sum(valor) total FROM creditos WHERE projeto_id=$1 AND (classe_validada IS NULL OR sujeito_validado IS NULL)`, [projetoId]);
  const { rows: caixa } = await db.query<{ receita: string | null; despesa: string | null; meses: string }>(`SELECT sum(valor) FILTER (WHERE tipo='receita') receita, sum(valor) FILTER (WHERE tipo='despesa') despesa, count(DISTINCT to_char(data,'YYYY-MM')) meses FROM lancamentos WHERE projeto_id=$1 AND situacao='realizado' AND data >= now() - interval '6 months'`, [projetoId]);
  const { rows: contas } = await db.query<{ s: string | null }>('SELECT sum(saldo_inicial) s FROM contas_financeiras WHERE projeto_id=$1', [projetoId]);
  const meses = Number(caixa[0]?.meses ?? 0); const media = (v: string | null | undefined) => (meses && v ? (BigInt(v) / BigInt(meses)).toString() : '0');
  return { classes: cred.map((c) => ({ id: c.classe, rotulo: ROTULOS[c.classe] ?? c.classe, credito: c.total, creditos: Number(c.n) })), pendentes: { creditos: Number(pend[0]?.n ?? 0), valor: pend[0]?.total ?? '0' },
    caixa: { saldoInicial: contas[0]?.s ?? '0', receitaMensal: media(caixa[0]?.receita), despesaMensal: media(caixa[0]?.despesa), mesesDeHistorico: meses, origem: meses ? `média de ${meses} mês(es) de lançamentos realizados do cliente` : 'sem histórico autorizado: informe as premissas manualmente' } };
}

export const EsquemaCenario = z.object({ nome: z.string().trim().min(1).max(120), parametros: EsquemaEstudio });
export async function salvarCenario(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaCenario>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id=$1', [projetoId]); if (!rows[0]) throw new NaoEncontrado('projeto não encontrado');
  const r = simularEstudio(d.parametros).indicadores;
  const resumo = JSON.parse(JSON.stringify({ total: r.total, novado: r.novado, menorSaldo: r.menorSaldo, mesMenorSaldo: r.mesMenorSaldo, mesesDeficit: r.mesesDeficit.length, necessidadeFinanciamento: r.necessidadeFinanciamento, picoComprometimento: r.picoComprometimento }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  // Versão nova a cada gravação: comparar propostas exige não reescrever a anterior.
  const v = await db.query<{ v: number }>('SELECT coalesce(max(versao),0)+1 v FROM prj_cenarios WHERE projeto_id=$1 AND nome=$2', [projetoId, d.nome]);
  const ins = await db.query<{ id: string }>('INSERT INTO prj_cenarios (organizacao_id,projeto_id,nome,versao,parametros,resumo,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [rows[0].organizacao_id, projetoId, d.nome, v.rows[0]!.v, JSON.stringify(d.parametros), JSON.stringify(resumo), i.usuarioId]);
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'prj.cenario_salvo', entidade: 'projeto', entidadeId: projetoId, depois: { nome: d.nome, versao: v.rows[0]!.v } });
  return { id: ins.rows[0]!.id, versao: v.rows[0]!.v };
}
export const listarCenarios = async (db: PoolClient, projetoId: string) => (await db.query(`SELECT c.id,c.nome,c.versao,c.parametros,c.resumo,c.compartilhado,c.criado_em,u.nome autor FROM prj_cenarios c LEFT JOIN usuarios u ON u.id=c.criado_por WHERE c.projeto_id=$1 ORDER BY c.criado_em DESC LIMIT 60`, [projetoId])).rows;
export async function excluirCenario(db: PoolClient, id: string) { const r = await db.query('DELETE FROM prj_cenarios WHERE id=$1', [id]); if (!r.rowCount) throw new NaoEncontrado('cenário não encontrado'); return { ok: true }; }

// ------------------------------------------------------------------- PMT ---
export const EsquemaGerarPmt = z.object({ principal: POSITIVO, parcelas: z.number().int().min(1).max(360), primeiroVencimento: DATA, jurosAoMes: z.number().min(0).max(1).default(0), sistema: z.enum(['price', 'sac', 'fixa']).default('price') });
export async function gerarPmts(db: PoolClient, negociacaoId: string, d: z.infer<typeof EsquemaGerarPmt>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; projeto_id: string }>('SELECT organizacao_id,projeto_id FROM negociacoes WHERE id=$1', [negociacaoId]); const n = rows[0]; if (!n) throw new NaoEncontrado('negociação não encontrada');
  const pagas = await db.query('SELECT 1 FROM negociacao_pmts WHERE negociacao_id=$1 AND pago_em IS NOT NULL LIMIT 1', [negociacaoId]);
  if (pagas.rowCount) throw new PedidoInvalido('já há PMT paga nesta negociação: o cronograma não pode ser refeito por cima do que foi baixado');
  const juros = d.sistema === 'fixa' ? 0 : d.jurosAoMes;
  const c = gerarCronograma(BigInt(d.principal), { desagio: 0, carenciaMeses: 0, parcelas: d.parcelas, periodicidade: 'mensal', jurosAoAno: juros * 12, regimeDeJuros: 'nominal', sistema: juros === 0 ? 'sem_juros' : d.sistema === 'fixa' ? 'sem_juros' : d.sistema }, somarMeses(d.primeiroVencimento, -1));
  await db.query('DELETE FROM negociacao_pmts WHERE negociacao_id=$1', [negociacaoId]);
  for (const p of c.parcelas) await db.query('INSERT INTO negociacao_pmts (organizacao_id,projeto_id,negociacao_id,numero,vencimento,valor,juros,amortizacao,saldo_final) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [n.organizacao_id, n.projeto_id, negociacaoId, p.numero, p.vencimento, p.valor.toString(), p.juros.toString(), p.amortizacao.toString(), p.saldoFinal.toString()]);
  await auditar(db, { organizacaoId: n.organizacao_id, usuarioId: i.usuarioId, acao: 'pmt.cronograma_gerado', entidade: 'negociacao', entidadeId: negociacaoId, depois: { ...d } });
  return { parcelas: c.parcelas.length, primeira: c.parcelas[0]!.valor, total: c.totalPago };
}
export async function painelPmt(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<Record<string, any>>(`SELECT p.*, n.titulo negociacao, n.contraparte FROM negociacao_pmts p JOIN negociacoes n ON n.id=p.negociacao_id WHERE p.projeto_id=$1 ORDER BY p.vencimento, p.numero`, [projetoId]);
  const h = hoje(); const lim = new Date(`${h}T12:00:00Z`); lim.setUTCDate(lim.getUTCDate() + 30); const fim30 = lim.toISOString().slice(0, 10);
  const itens = rows.map((r) => { const v = dia(r.vencimento)!; const paga = r.pago_em !== null; return { id: r.id as string, negociacaoId: r.negociacao_id as string, negociacao: r.negociacao as string, contraparte: r.contraparte as string | null, numero: r.numero as number, vencimento: v, valor: r.valor as string, juros: r.juros as string, amortizacao: r.amortizacao as string, saldoFinal: r.saldo_final as string, valorPago: r.valor_pago as string | null, pagoEm: dia(r.pago_em), situacao: paga ? (BigInt(r.valor_pago) < BigInt(r.valor) ? 'paga_parcial' : 'paga') : v < h ? 'vencida' : v <= fim30 ? 'proxima' : 'futura', observacao: r.observacao as string | null }; });
  const soma = (f: (x: typeof itens[number]) => boolean) => itens.filter(f).reduce((a, x) => a + BigInt(x.valor), 0n);
  const porMes = new Map<string, { mes: string; previsto: bigint; pago: bigint }>();
  for (const x of itens) { const m = x.vencimento.slice(0, 7); const r = porMes.get(m) ?? { mes: m, previsto: 0n, pago: 0n }; r.previsto += BigInt(x.valor); r.pago += BigInt(x.valorPago ?? 0); porMes.set(m, r); }
  return { itens, resumo: { total: soma(() => true), pago: itens.reduce((a, x) => a + BigInt(x.valorPago ?? 0), 0n), vencido: soma((x) => x.situacao === 'vencida'), qtdVencidas: itens.filter((x) => x.situacao === 'vencida').length, proximos30: soma((x) => x.situacao === 'proxima'), qtdProximos30: itens.filter((x) => x.situacao === 'proxima').length }, porMes: [...porMes.values()] };
}
export const EsquemaBaixaPmt = z.object({ valorPago: POSITIVO.nullable(), pagoEm: DATA.nullable(), observacao: z.string().max(2000).nullable().optional() }).refine((d) => (d.valorPago === null) === (d.pagoEm === null), 'informe valor e data juntos');
export async function baixarPmt(db: PoolClient, id: string, d: z.infer<typeof EsquemaBaixaPmt>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>(`UPDATE negociacao_pmts SET valor_pago=$2,pago_em=$3,observacao=coalesce($4,observacao),baixado_por=$5,atualizado_em=now() WHERE id=$1 RETURNING organizacao_id`, [id, d.valorPago, d.pagoEm, d.observacao ?? null, i.usuarioId]);
  if (!rows[0]) throw new NaoEncontrado('PMT não encontrada');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: d.pagoEm ? 'pmt.baixada' : 'pmt.reaberta', entidade: 'pmt', entidadeId: id, depois: d });
  return { ok: true };
}

// ------------------------------------------------------------------ atas ---
export const EsquemaAta = z.object({ titulo: z.string().trim().min(1).max(300), realizadaEm: DATA, participantes: z.string().max(2000).default(''), pauta: z.string().max(10000).default(''), decisoes: z.string().max(30000).default(''), encaminhamentos: z.string().max(10000).default(''), publicada: z.boolean().default(false) });
const ataParaApi = (a: Record<string, any>) => ({ id: a.id, titulo: a.titulo, realizadaEm: dia(a.realizada_em), participantes: a.participantes, pauta: a.pauta, decisoes: a.decisoes, encaminhamentos: a.encaminhamentos, publicada: a.publicada, criadoEm: a.criado_em });
export async function criarAta(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaAta>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id=$1', [projetoId]); if (!rows[0]) throw new NaoEncontrado('projeto não encontrado');
  const r = await db.query<{ id: string }>('INSERT INTO atas (organizacao_id,projeto_id,titulo,realizada_em,participantes,pauta,decisoes,encaminhamentos,publicada,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id', [rows[0].organizacao_id, projetoId, d.titulo, d.realizadaEm, d.participantes, d.pauta, d.decisoes, d.encaminhamentos, d.publicada, i.usuarioId]);
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'ata.criada', entidade: 'ata', entidadeId: r.rows[0]!.id, depois: { titulo: d.titulo } });
  return { id: r.rows[0]!.id };
}
export async function atualizarAta(db: PoolClient, id: string, d: z.infer<typeof EsquemaAta>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>('UPDATE atas SET titulo=$2,realizada_em=$3,participantes=$4,pauta=$5,decisoes=$6,encaminhamentos=$7,publicada=$8,atualizado_em=now() WHERE id=$1 RETURNING organizacao_id', [id, d.titulo, d.realizadaEm, d.participantes, d.pauta, d.decisoes, d.encaminhamentos, d.publicada]);
  if (!rows[0]) throw new NaoEncontrado('ata não encontrada');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'ata.atualizada', entidade: 'ata', entidadeId: id, depois: { publicada: d.publicada } });
  return { ok: true };
}
export const listarAtas = async (db: PoolClient, projetoId: string) => (await db.query('SELECT * FROM atas WHERE projeto_id=$1 ORDER BY realizada_em DESC, criado_em DESC', [projetoId])).rows.map(ataParaApi);

/** Encaminhamentos viram sugestões de tarefa. `Tarefa | responsável | dd/mm/aaaa` preenche tudo; o resto vira só título. */
export function sugerirTarefas(encaminhamentos: string) {
  return encaminhamentos.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\[\s*\]|\d+[.)])\s*/, '').trim()).filter((l) => l.length >= 3).slice(0, 60).map((l) => {
    const [titulo = '', responsavel = '', prazoT = ''] = l.split('|').map((x) => x.trim());
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(prazoT);
    return { titulo: titulo.slice(0, 300), responsavel: responsavel || null, prazo: m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null };
  });
}
export const EsquemaTarefasDaAta = z.object({ tarefas: z.array(z.object({ titulo: z.string().trim().min(1).max(300), responsavelId: z.string().uuid().nullable().optional(), prazo: DATA.nullable().optional() })).min(1).max(60) });

// ------------------------------------------------------------------ chat ---
export async function conversas(db: PoolClient) {
  return (await db.query(`SELECT p.id, p.nome, (SELECT m.texto FROM mensagens m WHERE m.projeto_id=p.id ORDER BY m.criado_em DESC LIMIT 1) ultima,
      (SELECT max(m.criado_em) FROM mensagens m WHERE m.projeto_id=p.id) quando, (SELECT count(*)::int FROM mensagens m WHERE m.projeto_id=p.id AND m.lado='cliente' AND m.lida_em IS NULL) nao_lidas
    FROM projetos p WHERE p.situacao<>'encerrado' AND EXISTS (SELECT 1 FROM portais po WHERE po.projeto_id=p.id AND po.ativo) ORDER BY quando DESC NULLS LAST, p.nome LIMIT 200`)).rows;
}
export const marcarLidas = async (db: PoolClient, projetoId: string, lado: 'nga' | 'cliente') => {
  try { await db.query('SELECT marcar_mensagens_lidas($1,$2)', [projetoId, lado]); }
  catch (e) { if ((e as { code?: string }).code === '42501') throw new NaoEncontrado('projeto não encontrado'); throw e; }
  return { ok: true };
};

// -------------------------------------------------------- entregas do LAB ---
/** Restrito por e-mail no servidor: esconder só o menu não protegeria nada. */
export const podeVerEntregas = (email: string): boolean => (process.env.NGA_EMAILS_DONO ?? 'victor@nga.adv.br').split(',').map((e) => e.trim().toLowerCase()).includes(email.toLowerCase());

// ---------------------------------------------------------------- raio X ---

/**
 * Lê TODOS os documentos do projeto, do cliente e do escritório, exceto relatórios.
 * Usa o texto já extraído; sem ele, extrai na hora. O que não dá para ler sai como não lido.
 */
const LIMITE_DE_EXTRACAO = 20;
export async function raioXDoProjeto(db: PoolClient, projetoId: string, dep: Deposito, extrairAgora = true) {
  const p = await db.query('SELECT id FROM projetos WHERE id=$1', [projetoId]); if (!p.rowCount) throw new NaoEncontrado('projeto não encontrado');
  const { rows } = await db.query<{ id: string; titulo: string; tipo_mime: string | null; hash_sha256: string | null; tem_arquivo: boolean; texto: string | null }>(
    `SELECT d.id,d.titulo,d.tipo_mime,d.hash_sha256,d.tem_arquivo,t.texto FROM documentos d LEFT JOIN documento_textos t ON t.documento_id=d.id
      WHERE d.projeto_id=$1 AND coalesce(d.categoria,'') NOT IN ('relatorio_gerador','relatorio','Relatório') ORDER BY d.criado_em DESC LIMIT 150`, [projetoId]);
  const documentos: DocumentoLido[] = []; const naoLidos: { titulo: string; motivo: string }[] = [];
  // Extrair PDF na hora é caro: limita por chamada e diz o que ficou de fora, em vez de estourar o tempo.
  let extraidosAgora = 0;
  for (const d of rows) {
    if (d.texto) { documentos.push({ id: d.id, titulo: d.titulo, texto: d.texto }); continue; }
    // Na função Edge o limite de CPU não comporta abrir PDF: quem lê é o worker da fila.
    if (!extrairAgora) { naoLidos.push({ titulo: d.titulo, motivo: 'aguardando leitura automática' }); continue; }
    if (extraidosAgora >= LIMITE_DE_EXTRACAO) { naoLidos.push({ titulo: d.titulo, motivo: 'aguardando leitura automática: limite desta consulta atingido' }); continue; }
    extraidosAgora++;
    if (!d.tem_arquivo || !d.hash_sha256) { naoLidos.push({ titulo: d.titulo, motivo: 'sem arquivo guardado' }); continue; }
    try {
      const e = await extrair(await lerConteudoDocumento(db, d.id, dep, chaveDoHash(d.hash_sha256), d.hash_sha256), d.tipo_mime ?? '');
      if ('vazio' in e) naoLidos.push({ titulo: d.titulo, motivo: e.vazio }); else documentos.push({ id: d.id, titulo: d.titulo, texto: e.texto });
    } catch { naoLidos.push({ titulo: d.titulo, motivo: 'falha ao abrir o arquivo' }); }
  }
  return raioX({ documentos, naoLidos });
}

// -------------------------------------------------------- carteira Astrea ---
export async function clientesDaCarteira(db: PoolClient) {
  const { rows } = await db.query<Record<string, any>>(`SELECT r.cliente_etiqueta etiqueta, r.projeto_id, p.tipo, count(*)::int registros, count(DISTINCT r.processo_id)::int processos,
      count(*) FILTER (WHERE lower(coalesce(r.fase,'')) ~ 'arquivado|encerrado')::int arquivados,
      array_remove(array_agg(DISTINCT r.equipe),NULL) equipes,
      (SELECT count(*)::int FROM prazos z JOIN processos pr ON pr.id=z.processo_id WHERE pr.projeto_id=r.projeto_id AND z.situacao='aberto') prazos_abertos,
      p.whatsapp_grupo_url
    FROM astrea_registros r LEFT JOIN projetos p ON p.id=r.projeto_id WHERE r.cliente_etiqueta IS NOT NULL GROUP BY 1,2,3,p.whatsapp_grupo_url ORDER BY registros DESC`);
  const { rows: resp } = await db.query<{ etiqueta: string; responsavel: string; n: number }>(`SELECT cliente_etiqueta etiqueta, responsavel, count(*)::int n FROM astrea_registros WHERE cliente_etiqueta IS NOT NULL AND responsavel <> 'Migração de Sistema' GROUP BY 1,2`);
  const { rows: [s] } = await db.query<{ n: number; nomes: number }>(`SELECT count(*)::int n, count(DISTINCT cliente_nome)::int nomes FROM astrea_registros WHERE cliente_etiqueta IS NULL`);
  const { rows: equipes } = await db.query<{ equipe: string; n: number }>(`SELECT coalesce(equipe,'Sem equipe') equipe, count(*)::int n FROM astrea_registros GROUP BY 1 ORDER BY 2 DESC`);
  const { rows: pessoas } = await db.query<{ responsavel: string; n: number; ativos: number }>(`SELECT responsavel, count(*)::int n, count(*) FILTER (WHERE NOT lower(coalesce(fase,'')) ~ 'arquivado|encerrado')::int ativos FROM astrea_registros GROUP BY 1 ORDER BY 2 DESC`);
  return { clientes: rows.map((c) => ({ etiqueta: c.etiqueta, projetoId: c.projeto_id, tipo: c.tipo, registros: c.registros, processos: c.processos, arquivados: c.arquivados, equipes: c.equipes, prazosAbertos: c.prazos_abertos, whatsappGrupoUrl: c.whatsapp_grupo_url, responsaveis: resp.filter((x) => x.etiqueta === c.etiqueta).sort((a, b) => b.n - a.n).slice(0, 3) })), semEtiqueta: s, equipes, pessoas };
}
export async function semEtiqueta(db: PoolClient, q: string) {
  return (await db.query(`SELECT cliente_nome, count(*)::int n, max(responsavel) responsavel, array_remove(array_agg(DISTINCT equipe),NULL) equipes FROM astrea_registros WHERE cliente_etiqueta IS NULL AND ($1 = '' OR cliente_nome ILIKE '%'||$1||'%' OR titulo ILIKE '%'||$1||'%' OR numero_original ILIKE '%'||$1||'%') GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 100`, [q.slice(0, 100)])).rows;
}
export const registrosSemCnjDoProjeto = async (db: PoolClient, projetoId: string) => (await db.query(`SELECT id,tipo,titulo,numero_original,acao,fase,responsavel FROM astrea_registros WHERE projeto_id=$1 AND processo_id IS NULL ORDER BY titulo LIMIT 500`, [projetoId])).rows;
