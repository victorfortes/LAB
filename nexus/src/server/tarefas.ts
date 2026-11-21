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
  tipo: z.enum(['tarefa', 'prazo', 'evento', 'audiencia', 'analise']).default('tarefa'),
  hora: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  processoId: z.string().uuid().nullable().optional(),
  /** Fase do procedimento a que a tarefa pertence: é o que monta a árvore. */
  fase: z.string().trim().min(1).max(80).nullable().optional(),
  paiId: z.string().uuid().nullable().optional(),
});

export const EsquemaAtualizacao = z.object({
  titulo: z.string().trim().min(1).max(300).optional(),
  descricao: z.string().max(4000).nullable().optional(),
  status: z.enum(STATUS).optional(),
  prioridade: z.enum(PRIORIDADES).optional(),
  responsavelId: z.string().uuid().nullable().optional(),
  prazo: DATA.nullable().optional(),
  tipo: z.enum(['tarefa', 'prazo', 'evento', 'audiencia', 'analise']).optional(),
  hora: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  /** Nota de conclusão: o que foi feito (fica no histórico da tarefa). */
  conclusaoNota: z.string().trim().max(4000).nullable().optional(),
  /** Reabrir uma tarefa arquivada pela limpeza. */
  desarquivar: z.literal(true).optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a atualizar');

const hojeISO = (): string => new Date().toISOString().slice(0, 10);
const dia = (d: Date | string | null): string | null =>
  (d === null ? null : new Date(d).toISOString().slice(0, 10));

interface Linha {
  playbook_no_id:string|null; tarefa_pai_id:string|null; fase:string|null;
  id: string; projeto_id: string; titulo: string; descricao: string | null;
  status: StatusDaTarefa; prioridade: Prioridade; prazo: Date | null;
  responsavel_id: string | null; responsavel: string | null; projeto: string;
  origem: string; origem_id: string | null; tipo: string; hora: string | null; caso: string | null; processo_ref: string | null; arquivada_em: Date | null; arquivada_motivo: string | null; conclusao_nota: string | null; concluida_por_nome: string | null; publicacao_id: string | null; processo_numero:string|null; vencimento_processual:Date|null; chave_playbook: string | null; concluida_em: Date | null; criado_em: Date;
}

function enriquecer(l: Linha, hoje: string) {
  const prazo = dia(l.prazo);
  return {
    id: l.id, projetoId: l.projeto_id, projeto: l.projeto, titulo: l.titulo,
    descricao: l.descricao, status: l.status, prioridade: l.prioridade, prazo,
    responsavelId: l.responsavel_id, responsavel: l.responsavel,
    fase: l.fase ?? null, paiId: l.tarefa_pai_id ?? null,
    origem: l.origem, origemId:l.origem_id, publicacaoId:l.publicacao_id, processo:l.processo_numero, vencimentoProcessual:dia(l.vencimento_processual), tipoAtividade:(l.tipo==='analise'||l.chave_playbook?.startsWith('djen-analise:')||l.chave_playbook?.startsWith('astrea-analise:'))?'analise_intimacao':(l.origem==='prazo'||l.tipo==='prazo')?'prazo_processual':l.tipo==='evento'||l.tipo==='audiencia'?l.tipo:'tarefa',
    tipo: l.tipo, hora: l.hora, caso: l.caso, processoId: l.processo_ref, vinculo: l.processo_numero ? 'processo' : l.caso ? 'caso' : null,
    doAstrea: !!l.chave_playbook?.startsWith('astrea'), arquivadaEm: l.arquivada_em, arquivadaMotivo: l.arquivada_motivo, conclusaoNota: l.conclusao_nota, concluidaPor: l.concluida_por_nome, chavePlaybook: l.chave_playbook, playbookNoId:l.playbook_no_id,tarefaPaiId:l.tarefa_pai_id, concluidaEm: l.concluida_em, criadoEm: l.criado_em,
    situacaoDoPrazo: situacaoDoPrazo({ status: l.status, prazo, prioridade: l.prioridade }, hoje),
  };
}

export interface Filtros {
  readonly projetoId?: string;
  readonly responsavelId?: string;
  readonly incluirConcluidas?: boolean;
  /** Só as arquivadas (pela limpeza do Astrea ou à mão). */
  readonly arquivadas?: boolean;
  /** Parceiro externo: só as tarefas dele ou da área dele (fase = área) nos projetos em que atua. */
  readonly parceiroId?: string;
}

export async function listar(db: PoolClient, filtros: Filtros = {}) {
  const hoje = hojeISO();
  const cond: string[] = [];
  const args: unknown[] = [];
  if (filtros.projetoId) { args.push(filtros.projetoId); cond.push(`t.projeto_id = $${args.length}`); }
  if (filtros.responsavelId) { args.push(filtros.responsavelId); cond.push(`t.responsavel_id = $${args.length}`); }
  // Concluída antiga polui o quadro: por padrão só entram as concluídas dos
  // últimos 14 dias, o bastante para ver o que acabou de andar.
  if (filtros.parceiroId) {
    args.push(filtros.parceiroId); const n = args.length;
    cond.push(`(t.responsavel_id = $${n} OR EXISTS (SELECT 1 FROM projeto_parceiros pp WHERE pp.projeto_id = t.projeto_id AND pp.usuario_id = $${n} AND pp.ate IS NULL AND lower(coalesce(t.fase, '')) = pp.area))`);
  }
  if (filtros.arquivadas) cond.push('t.arquivada_em IS NOT NULL');
  else {
    cond.push('t.arquivada_em IS NULL');
    if (!filtros.incluirConcluidas) cond.push(`(t.status <> 'concluida' OR t.concluida_em > now() - interval '14 days')`);
  }

  const { rows } = await db.query<Linha>(
    `SELECT t.id, t.projeto_id, t.titulo, t.descricao, t.status, t.prioridade, t.prazo,
            t.responsavel_id, u.nome AS responsavel, p.nome AS projeto,
            t.origem, t.origem_id, t.tipo, t.hora, t.caso, t.processo_id AS processo_ref, t.arquivada_em, t.arquivada_motivo, t.conclusao_nota, uc.nome AS concluida_por_nome,
            pub.id AS publicacao_id, coalesce(pr.numero, prt.numero) AS processo_numero, prazo.vencimento AS vencimento_processual, t.chave_playbook,t.playbook_no_id,t.tarefa_pai_id, t.fase, t.concluida_em, t.criado_em
       FROM tarefas t
       JOIN projetos p ON p.id = t.projeto_id
       LEFT JOIN usuarios u ON u.id = t.responsavel_id
       LEFT JOIN prazos prazo ON t.origem='prazo' AND prazo.id=t.origem_id AND prazo.organizacao_id=t.organizacao_id
       LEFT JOIN publicacoes pub ON pub.organizacao_id=t.organizacao_id AND (t.chave_playbook='djen-analise:'||pub.id::text OR (t.origem='prazo' AND pub.prazo_id=t.origem_id))
       LEFT JOIN processos pr ON pr.id=coalesce(pub.processo_id,prazo.processo_id) AND pr.organizacao_id=t.organizacao_id
       LEFT JOIN processos prt ON prt.id = t.processo_id
       LEFT JOIN usuarios uc ON uc.id = t.concluida_por
      ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}`, args);

  const tarefas = ordenar(rows.map((r) => enriquecer(r, hoje)), hoje);
  return { hoje, tarefas, resumo: resumir(tarefas, hoje) };
}

async function validarResponsavel(db: PoolClient, organizacaoId: string, usuarioId: string | null | undefined) {
  if (!usuarioId) return;
  const r = await db.query(
    `SELECT u.id FROM usuarios u JOIN vinculos v ON v.usuario_id = u.id
      WHERE u.id = $1 AND v.organizacao_id = $2 AND v.revogado_em IS NULL AND u.ativo
        AND v.papel NOT IN ('integracao','parceiro_externo','cliente_administrador','cliente_usuario') LIMIT 1`,
    [usuarioId, organizacaoId]);
  if (!r.rows[0]) throw new PedidoInvalido('o responsável deve integrar a equipe ativa do escritório deste projeto');
}

export async function criar(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaTarefa>, identidade: Identidade,
) {
  const { rows: proj } = await db.query<{ organizacao_id: string; nome: string }>(
    'SELECT organizacao_id, nome FROM projetos WHERE id = $1', [projetoId]);
  const projeto = proj[0];
  if (!projeto) throw new NaoEncontrado('projeto não encontrado');

  await validarResponsavel(db, projeto.organizacao_id, dados.responsavelId);
  const concluida = dados.status === 'concluida';
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO tarefas (organizacao_id, projeto_id, titulo, descricao, status, prioridade,
       responsavel_id, prazo, origem, origem_id, concluida_em, concluida_por, criado_por, fase, tarefa_pai_id, tipo, hora, processo_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             (SELECT id FROM processos WHERE id = $18 AND projeto_id = $2)) RETURNING id`,
    [projeto.organizacao_id, projetoId, dados.titulo, dados.descricao ?? null, dados.status,
     dados.prioridade, dados.responsavelId ?? identidade.usuarioId, dados.prazo ?? null,
     dados.origem, dados.origemId ?? null,
     concluida ? new Date() : null, concluida ? identidade.usuarioId : null,
     identidade.usuarioId, dados.fase ?? null, dados.paiId ?? null, dados.tipo, dados.hora ?? null, dados.processoId ?? null]);

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
    organizacao_id: string; titulo: string; status: StatusDaTarefa; origem: string; origem_id: string | null;
  }>('SELECT organizacao_id, titulo, status, origem, origem_id FROM tarefas WHERE id = $1', [tarefaId]);
  const atual = rows[0];
  if (!atual) throw new NaoEncontrado('tarefa não encontrada');
  await validarResponsavel(db, atual.organizacao_id, dados.responsavelId);

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
  if (dados.tipo !== undefined) campo('tipo', dados.tipo);
  if (dados.hora !== undefined) campo('hora', dados.hora);
  if (dados.conclusaoNota !== undefined) campo('conclusao_nota', dados.conclusaoNota || null);
  if (dados.desarquivar) {
    sets.push("arquivada_em = NULL", "arquivada_motivo = NULL");
    if (dados.status === undefined) { sets.push("status = 'a_fazer'", 'concluida_em = NULL', 'concluida_por = NULL'); }
  }

  if (dados.status !== undefined && (dados.status !== atual.status || dados.desarquivar)) {
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
  // Concluir a tarefa de um prazo processual cumpre o prazo junto (e reabrir devolve o prazo a "aberto").
  if (atual.origem === 'prazo' && atual.origem_id && dados.status !== undefined && dados.status !== atual.status) {
    if (dados.status === 'concluida') {
      await db.query(`UPDATE prazos SET situacao = 'cumprido', cumprido_em = now(), observacao = coalesce($2, observacao) WHERE id = $1 AND situacao = 'aberto'`, [atual.origem_id, dados.conclusaoNota ?? 'Cumprido pela tarefa no LAB.']);
    } else if (atual.status === 'concluida') {
      await db.query(`UPDATE prazos SET situacao = 'aberto', cumprido_em = NULL WHERE id = $1 AND situacao = 'cumprido'`, [atual.origem_id]);
    }
  }

  await auditar(db, {
    organizacaoId: atual.organizacao_id, usuarioId: identidade.usuarioId,
    acao: dados.status && dados.status !== atual.status ? 'tarefa.movida' : 'tarefa.editada',
    entidade: 'tarefa', entidadeId: tarefaId,
    antes: { status: atual.status }, depois: { ...dados, titulo: atual.titulo },
  });
  return { id: tarefaId };
}

// ------------------------------------------------------------- limpeza ---

/**
 * Limpeza do que apodreceu: tarefa aberta vinda do Astrea (ou análise de intimação) com data vencida há mais
 * de `dias` dias. Arquivar NÃO apaga: a tarefa sai do quadro, guarda o motivo e volta com "Reabrir".
 * `previa` só conta; a limpeza de verdade devolve os ids, para o "Desfazer" da tela.
 */
export const EsquemaLimpeza = z.object({
  dias: z.number().int().min(0).max(3650).default(30),
  grupos: z.array(z.enum(['astrea', 'analise', 'outras'])).min(1).default(['astrea']),
  previa: z.boolean().default(true),
});
const GRUPO_SQL: Record<string, string> = {
  astrea: `t.chave_playbook LIKE 'astrea%'`,
  analise: `(t.tipo = 'analise' OR t.chave_playbook LIKE 'djen-analise:%')`,
  outras: `coalesce(t.chave_playbook,'') NOT LIKE 'astrea%' AND t.tipo <> 'analise' AND coalesce(t.chave_playbook,'') NOT LIKE 'djen-analise:%'`,
};
export async function limpeza(db: PoolClient, d: z.infer<typeof EsquemaLimpeza>, identidade: Identidade) {
  const corte = new Date(Date.now() - 3 * 3600_000 - d.dias * 86_400_000).toISOString().slice(0, 10);
  const contagem: Record<string, number> = {};
  const exemplos: Record<string, unknown[]> = {};
  for (const g of ['astrea', 'analise', 'outras']) {
    const { rows } = await db.query<{ n: number; ex: unknown[] }>(
      `SELECT count(*)::int n, coalesce((SELECT json_agg(x) FROM (SELECT t2.titulo, t2.prazo, p2.nome projeto FROM tarefas t2 JOIN projetos p2 ON p2.id = t2.projeto_id
          WHERE t2.status <> 'concluida' AND t2.arquivada_em IS NULL AND t2.prazo < $1::date AND ${GRUPO_SQL[g]!.replace(/\bt\./g, 't2.')} ORDER BY t2.prazo LIMIT 5) x), '[]') ex
         FROM tarefas t WHERE t.status <> 'concluida' AND t.arquivada_em IS NULL AND t.prazo < $1::date AND ${GRUPO_SQL[g]}`, [corte]);
    contagem[g] = rows[0]!.n; exemplos[g] = rows[0]!.ex;
  }
  if (d.previa) return { corte, dias: d.dias, contagem, exemplos };
  const onde = d.grupos.map((g) => GRUPO_SQL[g]).join(' OR ');
  const { rows } = await db.query<{ id: string; organizacao_id: string }>(
    `UPDATE tarefas t SET status = 'concluida', concluida_em = now(), concluida_por = NULL, arquivada_em = now(), atualizado_em = now(),
            arquivada_motivo = $2
      WHERE t.status <> 'concluida' AND t.arquivada_em IS NULL AND t.prazo < $1::date AND (${onde}) RETURNING t.id, t.organizacao_id`,
    [corte, `Vencida há mais de ${d.dias} dias: arquivada na limpeza por ${identidade.nome ?? 'administração'}.`]);
  if (rows[0]) await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'tarefa.limpeza', entidade: 'organizacao', entidadeId: rows[0].organizacao_id, depois: { dias: d.dias, grupos: d.grupos, arquivadas: rows.length } });
  return { corte, dias: d.dias, arquivadas: rows.length, ids: rows.map((r) => r.id) };
}

/** Arquiva à mão (lote da lista). */
export async function arquivar(db: PoolClient, ids: readonly string[], motivo: string | null, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>(
    `UPDATE tarefas SET status = 'concluida', concluida_em = now(), concluida_por = NULL, arquivada_em = now(), atualizado_em = now(), arquivada_motivo = $2
      WHERE id = ANY($1::uuid[]) AND arquivada_em IS NULL RETURNING organizacao_id`, [ids, motivo ?? `Arquivada à mão por ${identidade.nome ?? 'alguém da equipe'}.`]);
  if (rows[0]) await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'tarefa.arquivada', entidade: 'organizacao', entidadeId: rows[0].organizacao_id, depois: { n: rows.length } });
  return { arquivadas: rows.length };
}

/** Desfaz uma limpeza (ou arquivamento): as tarefas voltam ao quadro como estavam antes ("a fazer"). */
export async function desarquivar(db: PoolClient, ids: readonly string[], identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>(
    `UPDATE tarefas SET status = 'a_fazer', concluida_em = NULL, concluida_por = NULL, arquivada_em = NULL, arquivada_motivo = NULL, atualizado_em = now()
      WHERE id = ANY($1::uuid[]) AND arquivada_em IS NOT NULL RETURNING organizacao_id`, [ids]);
  if (rows[0]) await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'tarefa.desarquivada', entidade: 'organizacao', entidadeId: rows[0].organizacao_id, depois: { n: rows.length } });
  return { reabertas: rows.length };
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
