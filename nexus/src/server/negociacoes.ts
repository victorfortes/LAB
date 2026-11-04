/**
 * Negociações do projeto: o quadro "em negociação / stand by / concluídas".
 *
 * Duas camadas, de propósito. A tabela é interna e guarda a estratégia (`notas_internas`). O cliente só vê
 * o que a NGA publicou — com o resumo escrito por gente — e só pela função `negociacoes_do_cliente` (021).
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

export const STATUS_NEGOCIACAO = ['em_negociacao', 'stand_by', 'concluida'] as const;
export type StatusNegociacao = typeof STATUS_NEGOCIACAO[number];
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const EsquemaNegociacao = z.object({
  titulo: z.string().trim().min(1).max(300),
  contraparte: z.string().trim().max(300).nullable().optional(),
  credorId: z.string().uuid().nullable().optional(),
  /** Centavos, só dígitos (bigint não cabe em Number com segurança). */
  valor: z.string().regex(/^\d+$/, 'valor em centavos, só dígitos').nullable().optional(),
  status: z.enum(STATUS_NEGOCIACAO).default('em_negociacao'),
  desfecho: z.enum(['acordo', 'sem_acordo']).nullable().optional(),
  prazo: DATA.nullable().optional(),
  responsavelId: z.string().uuid().nullable().optional(),
  notasInternas: z.string().max(8000).nullable().optional(),
  resumoCliente: z.string().trim().max(2000).nullable().optional(),
  visivelAoCliente: z.boolean().optional(),
});
export const EsquemaAtualizacaoNegociacao = EsquemaNegociacao.partial()
  .refine((d) => Object.keys(d).length > 0, 'nada a atualizar');

const dia = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString().slice(0, 10));

interface Linha {
  id: string; projeto_id: string; titulo: string; contraparte: string | null; credor_id: string | null; valor: string | null;
  status: StatusNegociacao; desfecho: string | null; prazo: Date | null; responsavel_id: string | null; responsavel: string | null;
  organizacao_id: string; notas_internas: string | null; resumo_cliente: string | null; visivel_ao_cliente: boolean;
  concluida_em: Date | null; atualizado_em: Date; criado_em: Date;
}
const paraApi = (l: Linha) => ({
  id: l.id, projetoId: l.projeto_id, titulo: l.titulo, contraparte: l.contraparte, credorId: l.credor_id, valor: l.valor,
  status: l.status, desfecho: l.desfecho, prazo: dia(l.prazo), responsavelId: l.responsavel_id, responsavel: l.responsavel,
  notasInternas: l.notas_internas, resumoCliente: l.resumo_cliente, visivelAoCliente: l.visivel_ao_cliente,
  concluidaEm: l.concluida_em, atualizadoEm: l.atualizado_em, criadoEm: l.criado_em,
});

export async function listar(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<Linha>(
    `SELECT n.*, u.nome AS responsavel FROM negociacoes n LEFT JOIN usuarios u ON u.id = n.responsavel_id
      WHERE n.projeto_id = $1 ORDER BY n.ordem, n.atualizado_em DESC`, [projetoId]);
  const itens = rows.map(paraApi);
  const por = (s: StatusNegociacao) => itens.filter((i) => i.status === s);
  return {
    negociacoes: itens,
    resumo: {
      emNegociacao: por('em_negociacao').length, standBy: por('stand_by').length, concluidas: por('concluida').length,
      acordos: itens.filter((i) => i.desfecho === 'acordo').length,
    },
  };
}

export async function criar(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaNegociacao>, identidade: Identidade) {
  const { rows: proj } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  if (!proj[0]) throw new NaoEncontrado('projeto não encontrado');
  validarPublicacao(d);
  const concluida = d.status === 'concluida';
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO negociacoes (organizacao_id, projeto_id, credor_id, titulo, contraparte, valor, status, desfecho, prazo,
       responsavel_id, notas_internas, resumo_cliente, visivel_ao_cliente, concluida_em, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [proj[0].organizacao_id, projetoId, d.credorId ?? null, d.titulo, d.contraparte ?? null, d.valor ?? null, d.status,
     concluida ? (d.desfecho ?? null) : null, d.prazo ?? null, d.responsavelId ?? identidade.usuarioId, d.notasInternas ?? null,
     d.resumoCliente ?? null, d.visivelAoCliente ?? false, concluida ? new Date() : null, identidade.usuarioId]);
  await auditar(db, {
    organizacaoId: proj[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'negociacao.criada', entidade: 'negociacao',
    entidadeId: rows[0]!.id, depois: { titulo: d.titulo, status: d.status, visivelAoCliente: d.visivelAoCliente ?? false },
  });
  return { id: rows[0]!.id };
}

function validarPublicacao(d: { visivelAoCliente?: boolean | undefined; resumoCliente?: string | null | undefined }) {
  if (d.visivelAoCliente && !(d.resumoCliente && d.resumoCliente.trim().length >= 10)) {
    throw new PedidoInvalido('para mostrar ao cliente, escreva o texto que ele vai ler (mínimo de 10 caracteres)');
  }
}

export async function atualizar(db: PoolClient, id: string, d: z.infer<typeof EsquemaAtualizacaoNegociacao>, identidade: Identidade) {
  const { rows } = await db.query<Linha>('SELECT * FROM negociacoes WHERE id = $1', [id]);
  const atual = rows[0];
  if (!atual) throw new NaoEncontrado('negociação não encontrada');

  const resumo = d.resumoCliente !== undefined ? d.resumoCliente : atual.resumo_cliente;
  const visivel = d.visivelAoCliente !== undefined ? d.visivelAoCliente : atual.visivel_ao_cliente;
  validarPublicacao({ visivelAoCliente: visivel, resumoCliente: resumo });

  const sets: string[] = ['atualizado_em = now()']; const args: unknown[] = [id];
  const campo = (col: string, v: unknown) => { args.push(v); sets.push(`${col} = $${args.length}`); };
  if (d.titulo !== undefined) campo('titulo', d.titulo);
  if (d.contraparte !== undefined) campo('contraparte', d.contraparte);
  if (d.credorId !== undefined) campo('credor_id', d.credorId);
  if (d.valor !== undefined) campo('valor', d.valor);
  if (d.prazo !== undefined) campo('prazo', d.prazo);
  if (d.responsavelId !== undefined) campo('responsavel_id', d.responsavelId);
  if (d.notasInternas !== undefined) campo('notas_internas', d.notasInternas);
  if (d.resumoCliente !== undefined) campo('resumo_cliente', d.resumoCliente);
  if (d.visivelAoCliente !== undefined) campo('visivel_ao_cliente', d.visivelAoCliente);

  const novoStatus = d.status ?? atual.status;
  if (novoStatus !== atual.status) {
    campo('status', novoStatus);
    // Concluir é ato datado; reabrir limpa a data e o desfecho (a restrição do banco exige coerência).
    if (novoStatus === 'concluida') sets.push('concluida_em = now()');
    else { sets.push('concluida_em = NULL'); sets.push('desfecho = NULL'); }
  }
  if (d.desfecho !== undefined && novoStatus === 'concluida') campo('desfecho', d.desfecho);

  await db.query(`UPDATE negociacoes SET ${sets.join(', ')} WHERE id = $1`, args);
  await auditar(db, {
    organizacaoId: atual.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'negociacao.atualizada', entidade: 'negociacao', entidadeId: id,
    antes: { status: atual.status, visivelAoCliente: atual.visivel_ao_cliente },
    depois: { status: novoStatus, visivelAoCliente: visivel },
  });
  return { ok: true };
}

export async function excluir(db: PoolClient, id: string, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; titulo: string }>('DELETE FROM negociacoes WHERE id = $1 RETURNING organizacao_id, titulo', [id]);
  if (!rows[0]) throw new NaoEncontrado('negociação não encontrada');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'negociacao.excluida', entidade: 'negociacao', entidadeId: id, antes: { titulo: rows[0].titulo } });
  return { ok: true };
}

/** O que o cliente vê: a função do banco já filtra linhas E colunas. */
export async function doCliente(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<{
    id: string; titulo: string; contraparte: string | null; status: StatusNegociacao; desfecho: string | null;
    resumo: string | null; prazo: Date | null; atualizado_em: Date;
  }>('SELECT * FROM negociacoes_do_cliente($1)', [projetoId]);
  return rows.map((r) => ({
    id: r.id, titulo: r.titulo, contraparte: r.contraparte, status: r.status, desfecho: r.desfecho,
    resumo: r.resumo, prazo: dia(r.prazo), atualizadoEm: r.atualizado_em,
  }));
}
