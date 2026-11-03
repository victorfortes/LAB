/**
 * Serviços de tarefas. Todo o trabalho é interno: o RLS (migração 017) não
 * tem política de portal, então o cliente não alcança nenhuma.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import {
  PRIORIDADES, STATUS, ordenar, resumir, situacaoDoPrazo,
  type Prioridade, type StatusDaTarefa,
} from '../domain/projeto/tarefas.ts';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const EsquemaTarefa = z.object({
  titulo: z.string().trim().min(1).max(300),
  descricao: z.string().max(4000).optional(),
  status: z.enum(STATUS).default('a_fazer'),
  prioridade: z.enum(PRIORIDADES).default('media'),
  responsavelId: z.string().uuid().nullable().optional(),
  prazo: DATA.nullable().optional(),
  origem: z.enum(['manual', 'prazo', 'requisito', 'achado', 'credito']).default('manual'),
  origemId: z.string().uuid().optional(),
});

export const EsquemaAtualizacao = z.object({
  titulo: z.string().trim().min(1).max(300).optional(),
  descricao: z.string().max(4000).nullable().optional(),
  status: z.enum(STATUS).optional(),
  prioridade: z.enum(PRIORIDADES).optional(),
  responsavelId: z.string().uuid().nullable().optional(),
  prazo: DATA.nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a atualizar');

const hojeISO = (): string => new Date().toISOString().slice(0, 10);
const dia = (d: Date | string | null): string | null =>
  (d === null ? null : new Date(d).toISOString().slice(0, 10));

interface Linha {
  id: string; projeto_id: string; titulo: string; descricao: string | null;
  status: StatusDaTarefa; prioridade: Prioridade; prazo: Date | null;
  responsavel_id: string | null; responsavel: string | null; projeto: string;
  origem: string; concluida_em: Date | null; criado_em: Date;
}

function enriquecer(l: Linha, hoje: string) {
  const prazo = dia(l.prazo);
  return {
    id: l.id, projetoId: l.projeto_id, projeto: l.projeto, titulo: l.titulo,
    descricao: l.descricao, status: l.status, prioridade: l.prioridade, prazo,
    responsavelId: l.responsavel_id, responsavel: l.responsavel,
    origem: l.origem, concluidaEm: l.concluida_em, criadoEm: l.criado_em,
    situacaoDoPrazo: situacaoDoPrazo({ status: l.status, prazo, prioridade: l.prioridade }, hoje),
  };
}

export interface Filtros {
  readonly projetoId?: string;
  readonly responsavelId?: string;
  readonly incluirConcluidas?: boolean;
}

export async function listar(db: PoolClient, filtros: Filtros = {}) {
  const hoje = hojeISO();
  const cond: string[] = [];
  const args: unknown[] = [];
  if (filtros.projetoId) { args.push(filtros.projetoId); cond.push(`t.projeto_id = $${args.length}`); }
  if (filtros.responsavelId) { args.push(filtros.responsavelId); cond.push(`t.responsavel_id = $${args.length}`); }
  // Concluída antiga polui o quadro: por padrão só entram as concluídas dos
  // últimos 14 dias, o bastante para ver o que acabou de andar.
  if (!filtros.incluirConcluidas) {
    cond.push(`(t.status <> 'concluida' OR t.concluida_em > now() - interval '14 days')`);
  }

  const { rows } = await db.query<Linha>(
    `SELECT t.id, t.projeto_id, t.titulo, t.descricao, t.status, t.prioridade, t.prazo,
            t.responsavel_id, u.nome AS responsavel, p.nome AS projeto,
            t.origem, t.concluida_em, t.criado_em
       FROM tarefas t
       JOIN projetos p ON p.id = t.projeto_id
       LEFT JOIN usuarios u ON u.id = t.responsavel_id
      ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}`, args);

  const tarefas = ordenar(rows.map((r) => enriquecer(r, hoje)), hoje);
  return { hoje, tarefas, resumo: resumir(tarefas, hoje) };
}

export async function criar(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaTarefa>, identidade: Identidade,
) {
  const { rows: proj } = await db.query<{ organizacao_id: string; nome: string }>(
    'SELECT organizacao_id, nome FROM projetos WHERE id = $1', [projetoId]);
  const projeto = proj[0];
  if (!projeto) throw new NaoEncontrado('projeto não encontrado');

  const concluida = dados.status === 'concluida';
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO tarefas (organizacao_id, projeto_id, titulo, descricao, status, prioridade,
       responsavel_id, prazo, origem, origem_id, concluida_em, concluida_por, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [projeto.organizacao_id, projetoId, dados.titulo, dados.descricao ?? null, dados.status,
     dados.prioridade, dados.responsavelId ?? identidade.usuarioId, dados.prazo ?? null,
     dados.origem, dados.origemId ?? null,
     concluida ? new Date() : null, concluida ? identidade.usuarioId : null,
     identidade.usuarioId]);

  await auditar(db, {
    organizacaoId: projeto.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'tarefa.criada', entidade: 'tarefa', entidadeId: rows[0]!.id,
    depois: { projeto: projeto.nome, titulo: dados.titulo, prioridade: dados.prioridade },
  });
  return { id: rows[0]!.id };
}

export async function atualizar(
  db: PoolClient, tarefaId: string,
  dados: z.infer<typeof EsquemaAtualizacao>, identidade: Identidade,
) {
  const { rows } = await db.query<{
    organizacao_id: string; titulo: string; status: StatusDaTarefa;
  }>('SELECT organizacao_id, titulo, status FROM tarefas WHERE id = $1', [tarefaId]);
  const atual = rows[0];
  if (!atual) throw new NaoEncontrado('tarefa não encontrada');

  const sets: string[] = ['atualizado_em = now()'];
  const args: unknown[] = [tarefaId];
  const campo = (coluna: string, valor: unknown) => {
    args.push(valor); sets.push(`${coluna} = $${args.length}`);
  };

  if (dados.titulo !== undefined) campo('titulo', dados.titulo);
  if (dados.descricao !== undefined) campo('descricao', dados.descricao);
  if (dados.prioridade !== undefined) campo('prioridade', dados.prioridade);
  if (dados.responsavelId !== undefined) campo('responsavel_id', dados.responsavelId);
  if (dados.prazo !== undefined) campo('prazo', dados.prazo);

  if (dados.status !== undefined && dados.status !== atual.status) {
    campo('status', dados.status);
    // Concluir é ato datado e identificado; reabrir limpa os dois.
    if (dados.status === 'concluida') {
      sets.push('concluida_em = now()');
      campo('concluida_por', identidade.usuarioId);
    } else {
      sets.push('concluida_em = NULL', 'concluida_por = NULL');
    }
  }

  await db.query(`UPDATE tarefas SET ${sets.join(', ')} WHERE id = $1`, args);

  await auditar(db, {
    organizacaoId: atual.organizacao_id, usuarioId: identidade.usuarioId,
    acao: dados.status && dados.status !== atual.status ? 'tarefa.movida' : 'tarefa.editada',
    entidade: 'tarefa', entidadeId: tarefaId,
    antes: { status: atual.status }, depois: { ...dados, titulo: atual.titulo },
  });
  return { id: tarefaId };
}

export async function excluir(db: PoolClient, tarefaId: string, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; titulo: string }>(
    'DELETE FROM tarefas WHERE id = $1 RETURNING organizacao_id, titulo', [tarefaId]);
  const apagada = rows[0];
  if (!apagada) throw new NaoEncontrado('tarefa não encontrada');
  await auditar(db, {
    organizacaoId: apagada.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'tarefa.excluida', entidade: 'tarefa', entidadeId: tarefaId,
    antes: { titulo: apagada.titulo },
  });
  return { id: tarefaId, excluida: true };
}

/** Quem pode receber tarefa: a equipe do escritório, não o cliente nem integração. */
export async function equipeDoEscritorio(db: PoolClient) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id, u.nome, u.email, v.papel
       FROM vinculos v JOIN usuarios u ON u.id = v.usuario_id
       JOIN organizacoes o ON o.id = v.organizacao_id
      WHERE o.tipo = 'escritorio' AND v.revogado_em IS NULL AND u.ativo
        AND v.papel NOT IN ('integracao', 'parceiro_externo')
      ORDER BY u.nome`);
  return rows;
}

export { PedidoInvalido };
