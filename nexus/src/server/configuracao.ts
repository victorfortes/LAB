/**
 * Ajustes editáveis do escritório: fluxogramas, linhas do tempo e automações.
 *
 * São MODELOS do escritório (`modelos_config`), não código: o que a coordenação desenha aqui vira o que o
 * time enxerga como processo de trabalho. A linha do tempo se aplica a um projeto e vira marcos reais dele;
 * a automação (tabela `automacoes`, disparada por gatilho no banco) vira tarefa real quando o evento acontece.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

const texto = (n: number) => z.string().trim().max(n);

const No = z.object({
  id: z.string().trim().min(1).max(40),
  tipo: z.enum(['inicio', 'etapa', 'decisao', 'fim']),
  rotulo: texto(120),
  x: z.number().min(-5000).max(20000), y: z.number().min(-5000).max(20000),
  cor: z.enum(['ambar', 'ciano', 'verde', 'vermelho', 'cinza']).optional(),
  nota: texto(500).optional(),
});
const Aresta = z.object({ id: z.string().trim().min(1).max(40), de: z.string().max(40), para: z.string().max(40), rotulo: texto(60).optional() });
export const DefFluxograma = z.object({ nos: z.array(No).max(200), arestas: z.array(Aresta).max(500) }).superRefine((d, ctx) => {
  const ids = new Set(d.nos.map((n) => n.id));
  if (ids.size !== d.nos.length) ctx.addIssue({ code: 'custom', message: 'identificadores de etapa repetidos' });
  for (const a of d.arestas) if (!ids.has(a.de) || !ids.has(a.para)) ctx.addIssue({ code: 'custom', message: 'ligação aponta para etapa que não existe' });
});
const Etapa = z.object({
  id: z.string().trim().min(1).max(40), titulo: z.string().trim().min(1).max(300), descricao: texto(1000).optional(),
  diasApos: z.number().int().min(0).max(3650), visivelCliente: z.boolean().default(false),
});
export const DefLinhaDoTempo = z.object({ etapas: z.array(Etapa).max(120) });

export const EsquemaModelo = z.object({
  tipo: z.enum(['fluxograma', 'linha_do_tempo']),
  nome: z.string().trim().min(1).max(160),
  descricao: texto(2000).default(''),
  procedimento: z.string().trim().max(60).nullable().optional(),
  definicao: z.unknown(),
  ativo: z.boolean().optional(),
}).superRefine((d, ctx) => {
  const r = (d.tipo === 'fluxograma' ? DefFluxograma : DefLinhaDoTempo).safeParse(d.definicao);
  if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: 'custom', message: `definição: ${i.message}`, path: ['definicao', ...i.path] });
});
export const EsquemaAtualizacaoModelo = z.object({
  nome: z.string().trim().min(1).max(160).optional(), descricao: texto(2000).optional(),
  procedimento: z.string().trim().max(60).nullable().optional(), definicao: z.unknown().optional(), ativo: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a alterar');

const COLUNAS = `id, tipo, nome, descricao, procedimento, definicao, ativo, atualizado_em AS "atualizadoEm"`;

export async function listarModelos(db: PoolClient, tipo?: string) {
  const { rows } = await db.query(`SELECT ${COLUNAS} FROM modelos_config ${tipo ? 'WHERE tipo = $1' : ''} ORDER BY tipo, ativo DESC, nome`, tipo ? [tipo] : []);
  return rows;
}

async function organizacaoDe(db: PoolClient, identidade: Identidade) {
  const org = identidade.organizacoes.find((o) => o.tipo === 'escritorio')?.id;
  if (!org) throw new PedidoInvalido('usuário não pertence ao escritório');
  return org;
}

export async function criarModelo(db: PoolClient, d: z.infer<typeof EsquemaModelo>, identidade: Identidade) {
  const org = await organizacaoDe(db, identidade);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO modelos_config (organizacao_id, tipo, nome, descricao, procedimento, definicao, ativo, criado_por, atualizado_por)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8) RETURNING id`,
    [org, d.tipo, d.nome, d.descricao, d.procedimento ?? null, JSON.stringify(d.definicao), d.ativo ?? true, identidade.usuarioId]);
  await auditar(db, { organizacaoId: org, usuarioId: identidade.usuarioId, acao: 'config.modelo_criado', entidade: 'modelo_config', entidadeId: rows[0]!.id, depois: { tipo: d.tipo, nome: d.nome } });
  return { id: rows[0]!.id };
}

export async function atualizarModelo(db: PoolClient, id: string, d: z.infer<typeof EsquemaAtualizacaoModelo>, identidade: Identidade) {
  const { rows: atual } = await db.query<{ organizacao_id: string; tipo: string; nome: string }>('SELECT organizacao_id, tipo, nome FROM modelos_config WHERE id = $1', [id]);
  if (!atual[0]) throw new NaoEncontrado('modelo não encontrado');
  if (d.definicao !== undefined) {
    const r = (atual[0].tipo === 'fluxograma' ? DefFluxograma : DefLinhaDoTempo).safeParse(d.definicao);
    if (!r.success) throw new PedidoInvalido(`definição inválida: ${r.error.issues[0]?.message}`);
  }
  const sets = ['atualizado_em = now()', 'atualizado_por = $2']; const args: unknown[] = [id, identidade.usuarioId];
  const campo = (c: string, v: unknown, cast = '') => { args.push(v); sets.push(`${c} = $${args.length}${cast}`); };
  if (d.nome !== undefined) campo('nome', d.nome);
  if (d.descricao !== undefined) campo('descricao', d.descricao);
  if (d.procedimento !== undefined) campo('procedimento', d.procedimento);
  if (d.definicao !== undefined) campo('definicao', JSON.stringify(d.definicao), '::jsonb');
  if (d.ativo !== undefined) campo('ativo', d.ativo);
  await db.query(`UPDATE modelos_config SET ${sets.join(', ')} WHERE id = $1`, args);
  await auditar(db, { organizacaoId: atual[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'config.modelo_editado', entidade: 'modelo_config', entidadeId: id, depois: { nome: atual[0].nome, campos: Object.keys(d) } });
  return { ok: true };
}

export async function excluirModelo(db: PoolClient, id: string, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; nome: string }>('DELETE FROM modelos_config WHERE id = $1 RETURNING organizacao_id, nome', [id]);
  if (!rows[0]) throw new NaoEncontrado('modelo não encontrado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'config.modelo_excluido', entidade: 'modelo_config', entidadeId: id, depois: { nome: rows[0].nome } });
  return { ok: true };
}

const somarDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Aplica uma linha do tempo a um projeto: cada etapa vira um marco real, com data prevista a partir do início. */
export async function aplicarLinhaDoTempo(db: PoolClient, id: string, projetoId: string, inicio: string, identidade: Identidade) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new PedidoInvalido('data de início inválida');
  const { rows } = await db.query<{ tipo: string; definicao: z.infer<typeof DefLinhaDoTempo>; nome: string }>('SELECT tipo, definicao, nome FROM modelos_config WHERE id = $1', [id]);
  if (!rows[0] || rows[0].tipo !== 'linha_do_tempo') throw new NaoEncontrado('linha do tempo não encontrada');
  const { rows: pj } = await db.query<{ organizacao_id: string; nome: string }>('SELECT organizacao_id, nome FROM projetos WHERE id = $1', [projetoId]);
  if (!pj[0]) throw new NaoEncontrado('projeto não encontrado');
  const def = DefLinhaDoTempo.parse(rows[0].definicao);
  for (const e of def.etapas) {
    await db.query(
      `INSERT INTO projeto_marcos (projeto_id, organizacao_id, titulo, descricao, data_prevista, visivel_cliente, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [projetoId, pj[0].organizacao_id, e.titulo, e.descricao ?? '', somarDias(inicio, e.diasApos), e.visivelCliente, identidade.usuarioId]);
  }
  await auditar(db, { organizacaoId: pj[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'config.linha_do_tempo_aplicada', entidade: 'projeto', entidadeId: projetoId, depois: { modelo: rows[0].nome, marcos: def.etapas.length } });
  return { marcos: def.etapas.length };
}

// ------------------------------------------------------------- automações ---

export const GATILHOS = ['projeto_criado', 'fase_iniciada', 'documento_cliente_enviado', 'fatura_criada', 'fatura_paga'] as const;
export const EsquemaAutomacaoEscritorio = z.object({
  nome: z.string().trim().min(1).max(200),
  gatilho: z.enum(GATILHOS),
  fase: z.string().trim().max(80).nullable().optional(),
  tituloTarefa: z.string().trim().min(1).max(300),
  descricao: texto(1000).nullable().optional(),
  diasUteis: z.number().int().min(0).max(365).default(1),
  prioridade: z.enum(['baixa', 'media', 'alta', 'urgente']).default('media'),
  ativo: z.boolean().default(true),
});
export const EsquemaAtualizacaoAutomacao = z.object({
  nome: z.string().trim().min(1).max(200).optional(), gatilho: z.enum(GATILHOS).optional(),
  fase: z.string().trim().max(80).nullable().optional(), tituloTarefa: z.string().trim().min(1).max(300).optional(),
  descricao: texto(1000).nullable().optional(), diasUteis: z.number().int().min(0).max(365).optional(),
  prioridade: z.enum(['baixa', 'media', 'alta', 'urgente']).optional(), ativo: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a alterar');

const AUT = `a.id, a.nome, a.gatilho, a.fase, a.titulo_tarefa AS "tituloTarefa", a.descricao, a.dias_uteis AS "diasUteis", a.prioridade, a.ativo,
  a.execucoes, a.ultima_execucao_em AS "ultimaExecucaoEm", CASE WHEN a.projeto_id IS NULL THEN 'escritorio' ELSE 'projeto' END AS escopo, p.nome AS projeto`;

export async function listarAutomacoes(db: PoolClient) {
  const { rows } = await db.query(`SELECT ${AUT} FROM automacoes a LEFT JOIN projetos p ON p.id = a.projeto_id ORDER BY (a.projeto_id IS NULL) DESC, a.criado_em`);
  return rows;
}
export async function criarAutomacao(db: PoolClient, d: z.infer<typeof EsquemaAutomacaoEscritorio>, identidade: Identidade) {
  const org = await organizacaoDe(db, identidade);
  if (d.fase && d.gatilho !== 'fase_iniciada') throw new PedidoInvalido('a fase só vale para o gatilho "fase iniciada"');
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO automacoes (organizacao_id, projeto_id, nome, gatilho, fase, titulo_tarefa, descricao, dias_uteis, prioridade, ativo, criado_por)
     VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [org, d.nome, d.gatilho, d.fase || null, d.tituloTarefa, d.descricao || null, d.diasUteis, d.prioridade, d.ativo, identidade.usuarioId]);
  await auditar(db, { organizacaoId: org, usuarioId: identidade.usuarioId, acao: 'config.automacao_criada', entidade: 'automacao', entidadeId: rows[0]!.id, depois: { nome: d.nome, gatilho: d.gatilho } });
  return { id: rows[0]!.id };
}
export async function atualizarAutomacao(db: PoolClient, id: string, d: z.infer<typeof EsquemaAtualizacaoAutomacao>, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM automacoes WHERE id = $1', [id]);
  if (!rows[0]) throw new NaoEncontrado('automação não encontrada');
  const map: Record<string, string> = { nome: 'nome', gatilho: 'gatilho', fase: 'fase', tituloTarefa: 'titulo_tarefa', descricao: 'descricao', diasUteis: 'dias_uteis', prioridade: 'prioridade', ativo: 'ativo' };
  const sets: string[] = []; const args: unknown[] = [id];
  for (const [k, v] of Object.entries(d)) { if (v === undefined) continue; args.push(v === '' ? null : v); sets.push(`${map[k]} = $${args.length}`); }
  await db.query(`UPDATE automacoes SET ${sets.join(', ')} WHERE id = $1`, args);
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'config.automacao_editada', entidade: 'automacao', entidadeId: id, depois: d });
  return { ok: true };
}
export async function excluirAutomacao(db: PoolClient, id: string, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; nome: string }>('DELETE FROM automacoes WHERE id = $1 RETURNING organizacao_id, nome', [id]);
  if (!rows[0]) throw new NaoEncontrado('automação não encontrada');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'config.automacao_excluida', entidade: 'automacao', entidadeId: id, depois: { nome: rows[0].nome } });
  return { ok: true };
}
