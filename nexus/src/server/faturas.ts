/**
 * Faturas e guias: o que o cliente deve ao escritório, o que o escritório paga por ele em custas, e a prova de cada pagamento.
 *
 * REGRA CENTRAL: uma fatura só aparece como paga quando existe comprovante. Isso vale no banco (CHECK
 * `paga_com_comprovante`), não só na tela. O cliente anexa o comprovante pelo portal; o financeiro confere
 * (ou recusa, e a fatura volta a ficar em aberto). O comprovante vira documento do projeto, na aba de
 * documentos do financeiro.
 *
 * Isolamento: o cliente lê só fatura visível dele, do próprio portal (política `faturas_portal`). O papel
 * `financeiro` só alcança os projetos em que está na equipe (função `app_financeiro_restrito`).
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { formatarReais, parseReais } from '../domain/shared/dinheiro.ts';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
export const TIPOS_DE_FATURA = ['honorarios', 'guia_custas', 'despesa', 'outros'] as const;
export const ROTULO_DO_TIPO_FATURA: Record<string, string> = {
  honorarios: 'Honorários', guia_custas: 'Guia de custas', despesa: 'Despesa', outros: 'Outros',
};

export const EsquemaFatura = z.object({
  projetoId: z.string().uuid(),
  tipo: z.enum(TIPOS_DE_FATURA).default('honorarios'),
  /** Honorário e despesa: o cliente paga. Guia de custas: o escritório paga (e pode repassar). */
  pagador: z.enum(['cliente', 'escritorio']).optional(),
  descricao: z.string().trim().min(1).max(300),
  competencia: z.string().trim().max(40).optional(),
  valor: z.union([z.string().trim().min(1), z.number()]),
  emissao: DATA.optional(),
  vencimento: DATA,
  linhaDigitavel: z.string().trim().max(120).optional(),
  processoId: z.string().uuid().optional(),
  visivelCliente: z.boolean().optional(),
  observacao: z.string().trim().max(2000).optional(),
});

export const EsquemaEdicaoFatura = z.object({
  descricao: z.string().trim().min(1).max(300).optional(),
  competencia: z.string().trim().max(40).nullable().optional(),
  valor: z.union([z.string().trim().min(1), z.number()]).optional(),
  vencimento: DATA.optional(),
  linhaDigitavel: z.string().trim().max(120).nullable().optional(),
  visivelCliente: z.boolean().optional(),
  observacao: z.string().trim().max(2000).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a alterar');

export const EsquemaConferencia = z.object({
  acao: z.enum(['conferir', 'recusar']),
  motivo: z.string().trim().min(3).max(500).optional(),
});

function centavos(v: string | number): number {
  const c = typeof v === 'number' ? BigInt(Math.round(v * 100)) : parseReais(v);
  if (c <= 0n) throw new PedidoInvalido('o valor deve ser maior que zero');
  if (c > 9_000_000_000_000n) throw new PedidoInvalido('valor fora do limite');
  return Number(c);
}

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dia = (d: Date | string | null): string | null => (d ? (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null);
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

interface Linha {
  id: string; numero: string; projeto_id: string; projeto: string | null; tipo: string; pagador: string; descricao: string;
  competencia: string | null; valor_centavos: string | number; emissao: Date | string; vencimento: Date | string; situacao: string;
  linha_digitavel: string | null; processo: string | null; visivel_cliente: boolean; documento_id: string | null;
  comprovante_id: string | null; comprovante_em: Date | null; conferido_em: Date | null; pago_em: Date | string | null;
  observacao: string | null; documento_nome: string | null; comprovante_nome: string | null;
}

const SELECAO = `f.id, f.numero, f.projeto_id, p.nome AS projeto, f.tipo, f.pagador, f.descricao, f.competencia, f.valor_centavos,
  f.emissao, f.vencimento, f.situacao, f.linha_digitavel, pr.numero AS processo, f.visivel_cliente, f.documento_id,
  f.comprovante_id, f.comprovante_em, f.conferido_em, f.pago_em, f.observacao,
  dd.nome_original AS documento_nome, dc.nome_original AS comprovante_nome`;
const JUNCOES = `FROM faturas f
  LEFT JOIN projetos p ON p.id = f.projeto_id
  LEFT JOIN processos pr ON pr.id = f.processo_id
  LEFT JOIN documentos dd ON dd.id = f.documento_id
  LEFT JOIN documentos dc ON dc.id = f.comprovante_id`;

export function apresentar(l: Linha, hoje = hojeSP()) {
  const venc = dia(l.vencimento)!;
  const vcent = Number(l.valor_centavos);
  const diasParaVencer = diasEntre(hoje, venc);
  // O estado que a pessoa lê. "paga" sem conferência é honesto: o comprovante chegou, mas ninguém conferiu ainda.
  const status = l.situacao === 'cancelada' ? 'cancelada'
    : l.situacao === 'paga' ? (l.conferido_em ? 'paga' : 'paga_em_conferencia')
    : diasParaVencer < 0 ? 'vencida' : 'a_vencer';
  return {
    id: l.id, numero: l.numero, projetoId: l.projeto_id, projeto: l.projeto, tipo: l.tipo,
    rotuloDoTipo: ROTULO_DO_TIPO_FATURA[l.tipo] ?? l.tipo, pagador: l.pagador, descricao: l.descricao, competencia: l.competencia,
    valorCentavos: vcent, valorFormatado: formatarReais(BigInt(vcent)),
    emissao: dia(l.emissao), vencimento: venc, diasParaVencer, situacao: l.situacao, status,
    linhaDigitavel: l.linha_digitavel, processo: l.processo, visivelCliente: l.visivel_cliente,
    documentoId: l.documento_id, documentoNome: l.documento_nome,
    comprovanteId: l.comprovante_id, comprovanteNome: l.comprovante_nome,
    comprovanteEm: l.comprovante_em ? new Date(l.comprovante_em).toISOString() : null,
    conferidoEm: l.conferido_em ? new Date(l.conferido_em).toISOString() : null,
    pagoEm: dia(l.pago_em), observacao: l.observacao,
  };
}

export interface FiltroFaturas { projetoId?: string; situacao?: string; tipo?: string }

export async function listar(db: PoolClient, f: FiltroFaturas = {}) {
  const args: unknown[] = []; const onde: string[] = [];
  if (f.projetoId) { args.push(f.projetoId); onde.push(`f.projeto_id = $${args.length}`); }
  if (f.tipo && (TIPOS_DE_FATURA as readonly string[]).includes(f.tipo)) { args.push(f.tipo); onde.push(`f.tipo = $${args.length}`); }
  if (f.situacao && ['aberta', 'paga', 'cancelada'].includes(f.situacao)) { args.push(f.situacao); onde.push(`f.situacao = $${args.length}`); }
  const { rows } = await db.query<Linha>(
    `SELECT ${SELECAO} ${JUNCOES} ${onde.length ? `WHERE ${onde.join(' AND ')}` : ''}
      ORDER BY (f.situacao = 'aberta') DESC, f.vencimento, f.criado_em LIMIT 2000`, args);
  const hoje = hojeSP();
  const faturas = rows.map((r) => apresentar(r, hoje));
  return { faturas, resumo: resumir(faturas) };
}

/** Os números que o cliente e o financeiro leem primeiro. Contados, não estimados. */
export function resumir(faturas: ReturnType<typeof apresentar>[]) {
  const ativas = faturas.filter((x) => x.situacao !== 'cancelada');
  const abertas = ativas.filter((x) => x.situacao === 'aberta');
  const vencidas = abertas.filter((x) => x.status === 'vencida');
  const pagas = ativas.filter((x) => x.situacao === 'paga');
  const soma = (l: typeof ativas) => l.reduce((t, x) => t + x.valorCentavos, 0);
  const proxima = [...abertas].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0] ?? null;
  return {
    emAberto: abertas.length, vencidas: vencidas.length, pagas: pagas.length,
    aConferir: pagas.filter((x) => !x.conferidoEm).length,
    totalAbertoCentavos: soma(abertas), totalAbertoFormatado: formatarReais(BigInt(soma(abertas))),
    totalVencidoFormatado: formatarReais(BigInt(soma(vencidas))),
    totalPagoFormatado: formatarReais(BigInt(soma(pagas))),
    proxima,
  };
}

async function obter(db: PoolClient, id: string) {
  const { rows } = await db.query<Linha & { organizacao_id: string }>(
    `SELECT ${SELECAO}, f.organizacao_id ${JUNCOES} WHERE f.id = $1`, [id]);
  if (!rows[0]) throw new NaoEncontrado('fatura não encontrada');
  return rows[0];
}

export async function criar(db: PoolClient, d: z.infer<typeof EsquemaFatura>, identidade: Identidade) {
  const { rows: pj } = await db.query<{ organizacao_id: string; nome: string }>('SELECT organizacao_id, nome FROM projetos WHERE id = $1', [d.projetoId]);
  if (!pj[0]) throw new NaoEncontrado('projeto não encontrado');
  const guia = d.tipo === 'guia_custas';
  const pagador = d.pagador ?? (guia ? 'escritorio' : 'cliente');
  // Guia paga pelo escritório não aparece para o cliente a menos que se decida repassar.
  const visivel = d.visivelCliente ?? (pagador === 'cliente');
  if (visivel && pagador !== 'cliente') throw new PedidoInvalido('só fatura cobrada do cliente pode ficar visível a ele');
  const valor = centavos(d.valor);
  const emissao = d.emissao ?? hojeSP();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO faturas (organizacao_id, projeto_id, tipo, pagador, descricao, competencia, valor_centavos, emissao, vencimento,
       linha_digitavel, processo_id, visivel_cliente, observacao, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [pj[0].organizacao_id, d.projetoId, d.tipo, pagador, d.descricao, d.competencia ?? null, valor, emissao, d.vencimento,
     d.linhaDigitavel ?? null, d.processoId ?? null, visivel, d.observacao ?? null, identidade.usuarioId]);
  await auditar(db, {
    organizacaoId: pj[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'fatura.criada', entidade: 'fatura', entidadeId: rows[0]!.id,
    depois: { projeto: pj[0].nome, tipo: d.tipo, descricao: d.descricao, valorCentavos: valor, vencimento: d.vencimento },
  });
  return apresentar(await obter(db, rows[0]!.id));
}

export async function editar(db: PoolClient, id: string, d: z.infer<typeof EsquemaEdicaoFatura>, identidade: Identidade) {
  const atual = await obter(db, id);
  if (atual.situacao !== 'aberta') throw new PedidoInvalido('só é possível editar fatura em aberto');
  const sets: string[] = ['atualizado_em = now()']; const args: unknown[] = [id];
  const campo = (c: string, v: unknown) => { args.push(v); sets.push(`${c} = $${args.length}`); };
  if (d.descricao !== undefined) campo('descricao', d.descricao);
  if (d.competencia !== undefined) campo('competencia', d.competencia);
  if (d.valor !== undefined) campo('valor_centavos', centavos(d.valor));
  if (d.vencimento !== undefined) campo('vencimento', d.vencimento);
  if (d.linhaDigitavel !== undefined) campo('linha_digitavel', d.linhaDigitavel);
  if (d.observacao !== undefined) campo('observacao', d.observacao);
  if (d.visivelCliente !== undefined) {
    if (d.visivelCliente && atual.pagador !== 'cliente') throw new PedidoInvalido('só fatura cobrada do cliente pode ficar visível a ele');
    campo('visivel_cliente', d.visivelCliente);
  }
  await db.query(`UPDATE faturas SET ${sets.join(', ')} WHERE id = $1`, args);
  await auditar(db, { organizacaoId: atual.organizacao_id, usuarioId: identidade.usuarioId, acao: 'fatura.editada', entidade: 'fatura', entidadeId: id, depois: { numero: atual.numero, campos: Object.keys(d) } });
  return apresentar(await obter(db, id));
}

export async function cancelar(db: PoolClient, id: string, identidade: Identidade) {
  const atual = await obter(db, id);
  if (atual.situacao === 'paga') throw new PedidoInvalido('fatura paga não se cancela: recuse o comprovante, se estiver errado');
  await db.query(`UPDATE faturas SET situacao = 'cancelada', atualizado_em = now() WHERE id = $1`, [id]);
  await auditar(db, { organizacaoId: atual.organizacao_id, usuarioId: identidade.usuarioId, acao: 'fatura.cancelada', entidade: 'fatura', entidadeId: id, depois: { numero: atual.numero } });
  return apresentar(await obter(db, id));
}

/** O boleto, a guia ou a nota que o escritório anexa à fatura (o cliente baixa pelo portal). */
export async function anexarDocumento(db: PoolClient, id: string, documentoId: string, identidade: Identidade) {
  const atual = await obter(db, id);
  await db.query('UPDATE faturas SET documento_id = $2, atualizado_em = now() WHERE id = $1', [id, documentoId]);
  await auditar(db, { organizacaoId: atual.organizacao_id, usuarioId: identidade.usuarioId, acao: 'fatura.documento_anexado', entidade: 'fatura', entidadeId: id, depois: { numero: atual.numero, documentoId } });
  return apresentar(await obter(db, id));
}

/** O cliente anexa o comprovante: a fatura passa a aparecer como paga, "em conferência" até o financeiro conferir. */
export async function comprovanteDoCliente(db: PoolClient, id: string, documentoId: string, identidade: Identidade) {
  await db.query('SELECT faturas_anexar_comprovante($1, $2)', [id, documentoId]);
  await auditar(db, { organizacaoId: null, usuarioId: identidade.usuarioId, acao: 'fatura.comprovante_do_cliente', entidade: 'fatura', entidadeId: id, depois: { documentoId }, origem: 'portal' });
  return apresentar(await obter(db, id));
}

/** O financeiro registra o pagamento (ex.: guia de custas paga pelo escritório) com o comprovante já anexado. */
export async function registrarPagamento(db: PoolClient, id: string, documentoId: string, pagoEm: string | undefined, identidade: Identidade) {
  const atual = await obter(db, id);
  if (atual.situacao !== 'aberta') throw new PedidoInvalido('esta fatura não está em aberto');
  const data = pagoEm ?? hojeSP();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new PedidoInvalido('data de pagamento inválida');
  await db.query(
    `UPDATE faturas SET comprovante_id = $2, comprovante_em = now(), comprovante_por = $3, situacao = 'paga', pago_em = $4,
            conferido_em = now(), conferido_por = $3, atualizado_em = now() WHERE id = $1`,
    [id, documentoId, identidade.usuarioId, data]);
  await auditar(db, { organizacaoId: atual.organizacao_id, usuarioId: identidade.usuarioId, acao: 'fatura.paga', entidade: 'fatura', entidadeId: id, depois: { numero: atual.numero, pagoEm: data } });
  return apresentar(await obter(db, id));
}

export async function conferir(db: PoolClient, id: string, d: z.infer<typeof EsquemaConferencia>, identidade: Identidade) {
  const atual = await obter(db, id);
  if (atual.situacao !== 'paga') throw new PedidoInvalido('só se confere fatura com comprovante');
  if (d.acao === 'conferir') {
    await db.query('UPDATE faturas SET conferido_em = now(), conferido_por = $2, atualizado_em = now() WHERE id = $1', [id, identidade.usuarioId]);
  } else {
    if (!d.motivo) throw new PedidoInvalido('diga por que o comprovante foi recusado');
    await db.query(
      `UPDATE faturas SET situacao = 'aberta', comprovante_id = NULL, comprovante_em = NULL, comprovante_por = NULL, pago_em = NULL,
              conferido_em = NULL, conferido_por = NULL, observacao = $2, atualizado_em = now() WHERE id = $1`,
      [id, `Comprovante recusado: ${d.motivo}`]);
  }
  await auditar(db, { organizacaoId: atual.organizacao_id, usuarioId: identidade.usuarioId, acao: d.acao === 'conferir' ? 'fatura.conferida' : 'fatura.comprovante_recusado', entidade: 'fatura', entidadeId: id, depois: { numero: atual.numero, motivo: d.motivo ?? null } });
  return apresentar(await obter(db, id));
}

/** A aba de documentos do financeiro: boletos, guias e comprovantes, cada um com a fatura de origem. */
export async function documentos(db: PoolClient) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT f.numero, f.id AS fatura_id, p.nome AS projeto, f.tipo AS tipo_fatura, 'comprovante' AS papel, d.id AS documento_id, d.nome_original AS nome,
              d.tamanho_bytes AS tamanho, f.comprovante_em AS em, uc.nome AS enviado_por, f.conferido_em IS NOT NULL AS conferido
         FROM faturas f JOIN documentos d ON d.id = f.comprovante_id JOIN projetos p ON p.id = f.projeto_id LEFT JOIN usuarios uc ON uc.id = d.enviado_por
       UNION ALL
       SELECT f.numero, f.id, p.nome, f.tipo, 'fatura', d.id, d.nome_original, d.tamanho_bytes, d.criado_em, ud.nome, NULL
         FROM faturas f JOIN documentos d ON d.id = f.documento_id JOIN projetos p ON p.id = f.projeto_id LEFT JOIN usuarios ud ON ud.id = d.enviado_por
     ) x ORDER BY em DESC NULLS LAST LIMIT 1000`);
  return rows;
}
