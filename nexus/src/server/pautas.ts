/**
 * Gestão de pauta por cliente — só administração, sócios e coordenação (permissão `modulo.pautas` e RLS 071).
 *
 * Lógica:
 *  - Cada cliente (projeto) tem uma pauta permanente. Item nasce "aberto".
 *  - Uma reunião de pauta puxa todos os itens abertos do cliente. Na reunião, cada item recebe decisão:
 *    "discutido" (volta na próxima se nada mudou), "encaminhado" (virou tarefa), "concluído" ou "descartado".
 *  - Encerrar a reunião registra a ata do projeto com pauta, decisões e encaminhamentos; o que ficou aberto
 *    continua na pauta e conta mais uma vez em pauta (item que volta 3 vezes ganha destaque).
 *  - O painel mostra, por cliente, a saúde do acompanhamento: dias desde a última reunião, itens abertos,
 *    tarefas atrasadas e prazos dos próximos 7 dias.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CATEGORIAS = ['geral', 'processual', 'negociacao', 'financeiro', 'cliente', 'documentos', 'estrategia'] as const;
export const SITUACOES = ['aberto', 'discutido', 'encaminhado', 'concluido', 'descartado'] as const;
const PRIORIDADES = ['baixa', 'media', 'alta', 'urgente'] as const;

export const EsquemaItem = z.object({
  titulo: z.string().trim().min(1).max(300),
  detalhe: z.string().trim().max(4000).nullable().optional(),
  categoria: z.enum(CATEGORIAS).default('geral'),
  prioridade: z.enum(PRIORIDADES).default('media'),
  responsavelId: z.string().uuid().nullable().optional(),
});
export const EsquemaEdicaoItem = z.object({
  titulo: z.string().trim().min(1).max(300).optional(),
  detalhe: z.string().trim().max(4000).nullable().optional(),
  categoria: z.enum(CATEGORIAS).optional(),
  prioridade: z.enum(PRIORIDADES).optional(),
  situacao: z.enum(SITUACOES).optional(),
  decisao: z.string().trim().max(4000).nullable().optional(),
  responsavelId: z.string().uuid().nullable().optional(),
  ordem: z.number().int().min(0).max(100000).optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a alterar');
export const EsquemaTarefaDoItem = z.object({
  titulo: z.string().trim().min(1).max(300).optional(),
  responsavelId: z.string().uuid().nullable().optional(),
  prazo: DATA.nullable().optional(),
  prioridade: z.enum(PRIORIDADES).optional(),
});
export const EsquemaReuniao = z.object({
  titulo: z.string().trim().min(1).max(200).default('Reunião de pauta'),
  data: DATA,
  participantes: z.string().trim().max(2000).nullable().optional(),
});
export const EsquemaEncerramento = z.object({
  resumo: z.string().trim().max(8000).nullable().optional(),
  participantes: z.string().trim().max(2000).nullable().optional(),
  publicarAta: z.boolean().default(false),
});

const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

async function projeto(db: PoolClient, id: string) {
  const { rows: [p] } = await db.query<{ id: string; organizacao_id: string; nome: string; responsavel_id: string | null }>(
    'SELECT id, organizacao_id, nome, responsavel_id FROM projetos WHERE id = $1', [id]);
  if (!p) throw new NaoEncontrado('projeto não encontrado');
  return p;
}

/** Painel de todos os clientes ativos, ordenado por quem mais precisa de atenção. */
export async function painel(db: PoolClient) {
  const { rows } = await db.query(`
    WITH ult AS (
      SELECT projeto_id, max(d) AS ultima FROM (
        SELECT projeto_id, data AS d FROM pauta_reunioes WHERE situacao = 'realizada'
        UNION ALL SELECT projeto_id, realizada_em FROM atas) x GROUP BY projeto_id),
    prox AS (SELECT projeto_id, min(data) AS proxima FROM pauta_reunioes WHERE situacao = 'agendada' AND data >= $1::date GROUP BY projeto_id),
    itens AS (SELECT projeto_id, count(*) FILTER (WHERE situacao IN ('aberto','discutido'))::int abertos,
                     count(*) FILTER (WHERE situacao IN ('aberto','discutido') AND prioridade IN ('alta','urgente'))::int criticos,
                     count(*) FILTER (WHERE situacao IN ('aberto','discutido') AND vezes_em_pauta >= 3)::int recorrentes,
                     count(*) FILTER (WHERE situacao = 'encaminhado')::int encaminhados
                FROM pauta_itens GROUP BY projeto_id),
    tar AS (SELECT projeto_id, count(*) FILTER (WHERE status <> 'concluida')::int abertas,
                   count(*) FILTER (WHERE status <> 'concluida' AND prazo < $1::date)::int atrasadas
              FROM tarefas GROUP BY projeto_id),
    pz AS (SELECT pr.projeto_id, count(*)::int semana FROM prazos z JOIN processos pr ON pr.id = z.processo_id
            WHERE z.situacao = 'aberto' AND z.vencimento BETWEEN $1::date AND $1::date + 7 GROUP BY pr.projeto_id)
    SELECT p.id, p.nome, p.tipo, p.fase,
           coalesce(u.nome, (SELECT u2.nome FROM projeto_equipe e JOIN usuarios u2 ON u2.id = e.usuario_id WHERE e.projeto_id = p.id AND e.ate IS NULL ORDER BY (e.papel = 'lider') DESC, e.desde LIMIT 1)) AS responsavel,
           ult.ultima, prox.proxima,
           coalesce(itens.abertos,0) abertos, coalesce(itens.criticos,0) criticos, coalesce(itens.recorrentes,0) recorrentes, coalesce(itens.encaminhados,0) encaminhados,
           coalesce(tar.abertas,0) tarefas_abertas, coalesce(tar.atrasadas,0) tarefas_atrasadas, coalesce(pz.semana,0) prazos_semana
      FROM projetos p
      LEFT JOIN usuarios u ON u.id = p.responsavel_id
      LEFT JOIN ult ON ult.projeto_id = p.id LEFT JOIN prox ON prox.projeto_id = p.id
      LEFT JOIN itens ON itens.projeto_id = p.id LEFT JOIN tar ON tar.projeto_id = p.id LEFT JOIN pz ON pz.projeto_id = p.id
     WHERE p.situacao IN ('ativo','proposto')`, [hoje()]);
  const ref = new Date(`${hoje()}T12:00:00Z`).getTime();
  const clientes = rows.map((r: any) => {
    const ultima = r.ultima ? new Date(r.ultima).toISOString().slice(0, 10) : null;
    const dias = ultima ? Math.round((ref - new Date(`${ultima}T12:00:00Z`).getTime()) / 86_400_000) : null;
    // Saúde: vermelho = sem reunião há mais de 45 dias (ou nunca) com pendências, ou atraso/crítico; âmbar = 30+ dias ou recorrente.
    let saude: 'ok' | 'atencao' | 'critico' = 'ok';
    if (r.tarefas_atrasadas > 0 || r.criticos > 0 || ((dias === null || dias > 45) && (r.abertos > 0 || r.prazos_semana > 0))) saude = 'critico';
    else if (dias === null || dias > 30 || r.recorrentes > 0 || r.prazos_semana > 0) saude = 'atencao';
    return { ...r, ultima, proxima: r.proxima ? new Date(r.proxima).toISOString().slice(0, 10) : null, diasSemReuniao: dias, saude };
  });
  const peso: Record<string, number> = { critico: 0, atencao: 1, ok: 2 };
  clientes.sort((a, b) => (peso[a.saude] ?? 2) - (peso[b.saude] ?? 2) || (b.diasSemReuniao ?? 9999) - (a.diasSemReuniao ?? 9999) || a.nome.localeCompare(b.nome));
  return {
    clientes,
    totais: {
      clientes: clientes.length, criticos: clientes.filter((c) => c.saude === 'critico').length, atencao: clientes.filter((c) => c.saude === 'atencao').length,
      itensAbertos: clientes.reduce((s, c) => s + c.abertos, 0), semReuniao30: clientes.filter((c) => c.diasSemReuniao === null || c.diasSemReuniao > 30).length,
      reunioesSemana: clientes.filter((c) => c.proxima && c.proxima <= new Date(ref + 7 * 86_400_000).toISOString().slice(0, 10)).length,
    },
  };
}

const ITEM = `i.id, i.titulo, i.detalhe, i.categoria, i.prioridade, i.situacao, i.decisao, i.responsavel_id AS "responsavelId", u.nome AS responsavel,
  i.reuniao_id AS "reuniaoId", i.tarefa_id AS "tarefaId", t.status AS "tarefaStatus", t.prazo AS "tarefaPrazo", i.ordem, i.vezes_em_pauta AS "vezesEmPauta",
  i.criado_em AS "criadoEm", i.resolvido_em AS "resolvidoEm"`;

/** Tudo de um cliente: itens, reuniões, equipe (para atribuir) e o contexto (tarefas e prazos abertos). */
export async function doCliente(db: PoolClient, projetoId: string) {
  const p = await projeto(db, projetoId);
  const [itens, reunioes, equipe, tarefas, prazos] = await Promise.all([
    db.query(`SELECT ${ITEM} FROM pauta_itens i LEFT JOIN usuarios u ON u.id = i.responsavel_id LEFT JOIN tarefas t ON t.id = i.tarefa_id
               WHERE i.projeto_id = $1 ORDER BY (i.situacao IN ('aberto','discutido')) DESC,
               CASE i.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, i.ordem, i.criado_em`, [projetoId]),
    db.query(`SELECT r.id, r.titulo, r.data, r.situacao, r.participantes, r.resumo, r.ata_id AS "ataId", r.realizada_em AS "realizadaEm",
                     (SELECT count(*)::int FROM pauta_itens i WHERE i.reuniao_id = r.id) itens
                FROM pauta_reunioes r WHERE r.projeto_id = $1 ORDER BY r.data DESC LIMIT 30`, [projetoId]),
    db.query(`SELECT DISTINCT u.id, u.nome FROM projeto_equipe e JOIN usuarios u ON u.id = e.usuario_id WHERE e.projeto_id = $1 AND e.ate IS NULL ORDER BY u.nome`, [projetoId]),
    db.query(`SELECT t.id, t.titulo, t.status, t.prazo, u.nome AS responsavel FROM tarefas t LEFT JOIN usuarios u ON u.id = t.responsavel_id
               WHERE t.projeto_id = $1 AND t.status <> 'concluida' ORDER BY t.prazo NULLS LAST LIMIT 30`, [projetoId]),
    db.query(`SELECT z.id, z.titulo, z.vencimento, pr.numero FROM prazos z JOIN processos pr ON pr.id = z.processo_id
               WHERE pr.projeto_id = $1 AND z.situacao = 'aberto' AND z.vencimento <= $2::date + 30 ORDER BY z.vencimento LIMIT 20`, [projetoId, hoje()]),
  ]);
  return { projeto: { id: p.id, nome: p.nome }, itens: itens.rows, reunioes: reunioes.rows, equipe: equipe.rows, tarefas: tarefas.rows, prazos: prazos.rows };
}

export async function criarItem(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaItem>, i: Identidade) {
  const p = await projeto(db, projetoId);
  const { rows: [r] } = await db.query<{ id: string }>(
    `INSERT INTO pauta_itens (organizacao_id, projeto_id, titulo, detalhe, categoria, prioridade, responsavel_id, criado_por, ordem)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, coalesce((SELECT max(ordem)+1 FROM pauta_itens WHERE projeto_id = $2), 0)) RETURNING id`,
    [p.organizacao_id, projetoId, d.titulo, d.detalhe ?? null, d.categoria, d.prioridade, d.responsavelId ?? null, i.usuarioId]);
  await auditar(db, { organizacaoId: p.organizacao_id, usuarioId: i.usuarioId, acao: 'pauta.item_criado', entidade: 'projeto', entidadeId: projetoId, depois: { titulo: d.titulo } });
  return { id: r!.id };
}

export async function editarItem(db: PoolClient, itemId: string, d: z.infer<typeof EsquemaEdicaoItem>, i: Identidade) {
  const { rows: [antes] } = await db.query<{ organizacao_id: string; projeto_id: string; situacao: string }>('SELECT organizacao_id, projeto_id, situacao FROM pauta_itens WHERE id = $1', [itemId]);
  if (!antes) throw new NaoEncontrado('item não encontrado');
  const mapa: Record<string, string> = { titulo: 'titulo', detalhe: 'detalhe', categoria: 'categoria', prioridade: 'prioridade', situacao: 'situacao', decisao: 'decisao', responsavelId: 'responsavel_id', ordem: 'ordem' };
  const sets: string[] = ['atualizado_em = now()']; const args: unknown[] = [itemId];
  for (const [k, v] of Object.entries(d)) { if (v === undefined) continue; args.push(v === '' ? null : v); sets.push(`${mapa[k]} = $${args.length}`); }
  if (d.situacao) sets.push(['concluido', 'descartado', 'encaminhado'].includes(d.situacao) ? 'resolvido_em = coalesce(resolvido_em, now())' : 'resolvido_em = NULL');
  await db.query(`UPDATE pauta_itens SET ${sets.join(', ')} WHERE id = $1`, args);
  await auditar(db, { organizacaoId: antes.organizacao_id, usuarioId: i.usuarioId, acao: 'pauta.item_editado', entidade: 'projeto', entidadeId: antes.projeto_id, depois: d });
  return { ok: true };
}

export async function excluirItem(db: PoolClient, itemId: string, i: Identidade) {
  const { rows: [r] } = await db.query<{ organizacao_id: string; projeto_id: string; titulo: string }>('DELETE FROM pauta_itens WHERE id = $1 RETURNING organizacao_id, projeto_id, titulo', [itemId]);
  if (!r) throw new NaoEncontrado('item não encontrado');
  await auditar(db, { organizacaoId: r.organizacao_id, usuarioId: i.usuarioId, acao: 'pauta.item_excluido', entidade: 'projeto', entidadeId: r.projeto_id, antes: { titulo: r.titulo } });
  return { ok: true };
}

/** Transforma o item em tarefa (origem "pauta") e marca o item como encaminhado. */
export async function gerarTarefa(db: PoolClient, itemId: string, d: z.infer<typeof EsquemaTarefaDoItem>, i: Identidade) {
  const { rows: [it] } = await db.query<{ organizacao_id: string; projeto_id: string; titulo: string; detalhe: string | null; decisao: string | null; prioridade: string; responsavel_id: string | null; tarefa_id: string | null }>(
    'SELECT organizacao_id, projeto_id, titulo, detalhe, decisao, prioridade, responsavel_id, tarefa_id FROM pauta_itens WHERE id = $1', [itemId]);
  if (!it) throw new NaoEncontrado('item não encontrado');
  if (it.tarefa_id) throw new PedidoInvalido('este item já virou tarefa');
  const p = await projeto(db, it.projeto_id);
  const lider = p.responsavel_id ?? (await db.query<{ usuario_id: string }>(`SELECT usuario_id FROM projeto_equipe WHERE projeto_id = $1 AND ate IS NULL ORDER BY (papel = 'lider') DESC, desde LIMIT 1`, [p.id])).rows[0]?.usuario_id ?? null;
  const responsavel = d.responsavelId !== undefined && d.responsavelId !== null ? d.responsavelId : (it.responsavel_id ?? lider);
  const descricao = [it.detalhe, it.decisao ? `Decisão da reunião de pauta: ${it.decisao}` : null].filter(Boolean).join('\n\n') || null;
  const { rows: [t] } = await db.query<{ id: string }>(
    `INSERT INTO tarefas (organizacao_id, projeto_id, titulo, descricao, prioridade, responsavel_id, prazo, origem, origem_id, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pauta',$8,$9) RETURNING id`,
    [it.organizacao_id, it.projeto_id, d.titulo ?? it.titulo, descricao, d.prioridade ?? it.prioridade, responsavel, d.prazo ?? null, itemId, i.usuarioId]);
  await db.query(`UPDATE pauta_itens SET tarefa_id = $2, situacao = 'encaminhado', responsavel_id = coalesce($3, responsavel_id), resolvido_em = now(), atualizado_em = now() WHERE id = $1`, [itemId, t!.id, responsavel]);
  await auditar(db, { organizacaoId: it.organizacao_id, usuarioId: i.usuarioId, acao: 'pauta.tarefa_gerada', entidade: 'tarefa', entidadeId: t!.id, depois: { item: itemId } });
  return { tarefaId: t!.id };
}

/** Agenda a reunião de pauta. Os itens abertos do cliente entram nela automaticamente. */
export async function agendarReuniao(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaReuniao>, i: Identidade) {
  const p = await projeto(db, projetoId);
  const { rows: [r] } = await db.query<{ id: string }>(
    `INSERT INTO pauta_reunioes (organizacao_id, projeto_id, titulo, data, participantes, criado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [p.organizacao_id, projetoId, d.titulo, d.data, d.participantes ?? null, i.usuarioId]);
  await db.query(`UPDATE pauta_itens SET reuniao_id = $2, atualizado_em = now() WHERE projeto_id = $1 AND situacao IN ('aberto','discutido')`, [projetoId, r!.id]);
  await auditar(db, { organizacaoId: p.organizacao_id, usuarioId: i.usuarioId, acao: 'pauta.reuniao_agendada', entidade: 'projeto', entidadeId: projetoId, depois: d });
  return { id: r!.id };
}

const ROT_SITUACAO: Record<string, string> = { aberto: 'Em aberto', discutido: 'Discutido, segue em pauta', encaminhado: 'Encaminhado (tarefa)', concluido: 'Concluído', descartado: 'Descartado' };

/**
 * Encerra a reunião: grava a ata do projeto (pauta, decisões, encaminhamentos), soma 1 em "vezes em pauta"
 * para o que segue aberto e solta esses itens para a próxima reunião.
 */
export async function encerrarReuniao(db: PoolClient, reuniaoId: string, d: z.infer<typeof EsquemaEncerramento>, i: Identidade) {
  const { rows: [r] } = await db.query<{ id: string; organizacao_id: string; projeto_id: string; titulo: string; data: Date; situacao: string; participantes: string | null }>(
    'SELECT id, organizacao_id, projeto_id, titulo, data, situacao, participantes FROM pauta_reunioes WHERE id = $1', [reuniaoId]);
  if (!r) throw new NaoEncontrado('reunião não encontrada');
  if (r.situacao !== 'agendada') throw new PedidoInvalido('esta reunião já foi encerrada');
  const { rows: itens } = await db.query<{ titulo: string; situacao: string; decisao: string | null; responsavel: string | null; tarefa_prazo: Date | null }>(
    `SELECT i.titulo, i.situacao, i.decisao, u.nome AS responsavel, t.prazo AS tarefa_prazo FROM pauta_itens i
       LEFT JOIN usuarios u ON u.id = i.responsavel_id LEFT JOIN tarefas t ON t.id = i.tarefa_id
      WHERE i.reuniao_id = $1 ORDER BY i.ordem, i.criado_em`, [reuniaoId]);
  const dataIso = new Date(r.data).toISOString().slice(0, 10);
  const pauta = itens.map((x, n) => `${n + 1}. ${x.titulo}`).join('\n');
  const decisoes = itens.map((x, n) => `${n + 1}. ${x.titulo}: ${ROT_SITUACAO[x.situacao]}${x.decisao ? `. ${x.decisao}` : ''}`).join('\n');
  const encaminhamentos = itens.filter((x) => x.situacao === 'encaminhado')
    .map((x) => `• ${x.titulo}${x.responsavel ? ` (${x.responsavel})` : ''}${x.tarefa_prazo ? `, até ${new Date(x.tarefa_prazo).toISOString().slice(0, 10).split('-').reverse().join('/')}` : ''}`).join('\n');
  const participantes = d.participantes ?? r.participantes ?? '';
  const { rows: [ata] } = await db.query<{ id: string }>(
    `INSERT INTO atas (organizacao_id, projeto_id, titulo, realizada_em, participantes, pauta, decisoes, encaminhamentos, publicada, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [r.organizacao_id, r.projeto_id, r.titulo, dataIso, participantes, pauta.slice(0, 10000), [d.resumo, decisoes].filter(Boolean).join('\n\n').slice(0, 30000), encaminhamentos.slice(0, 10000), d.publicarAta, i.usuarioId]);
  await db.query(`UPDATE pauta_reunioes SET situacao = 'realizada', resumo = $2, participantes = $3, ata_id = $4, realizada_em = now() WHERE id = $1`, [reuniaoId, d.resumo ?? null, participantes || null, ata!.id]);
  await db.query(`UPDATE pauta_itens SET vezes_em_pauta = vezes_em_pauta + 1, atualizado_em = now() WHERE reuniao_id = $1`, [reuniaoId]);
  // O que não se resolveu volta a "aberto" na pauta do cliente, solto para a próxima reunião.
  await db.query(`UPDATE pauta_itens SET reuniao_id = NULL WHERE reuniao_id = $1 AND situacao IN ('aberto','discutido')`, [reuniaoId]);
  await auditar(db, { organizacaoId: r.organizacao_id, usuarioId: i.usuarioId, acao: 'pauta.reuniao_encerrada', entidade: 'projeto', entidadeId: r.projeto_id, depois: { ata: ata!.id, itens: itens.length } });
  return { ataId: ata!.id, itens: itens.length, encaminhados: itens.filter((x) => x.situacao === 'encaminhado').length };
}

export async function cancelarReuniao(db: PoolClient, reuniaoId: string, i: Identidade) {
  const { rows: [r] } = await db.query<{ organizacao_id: string; projeto_id: string }>(`UPDATE pauta_reunioes SET situacao = 'cancelada' WHERE id = $1 AND situacao = 'agendada' RETURNING organizacao_id, projeto_id`, [reuniaoId]);
  if (!r) throw new NaoEncontrado('reunião agendada não encontrada');
  await db.query('UPDATE pauta_itens SET reuniao_id = NULL WHERE reuniao_id = $1', [reuniaoId]);
  await auditar(db, { organizacaoId: r.organizacao_id, usuarioId: i.usuarioId, acao: 'pauta.reuniao_cancelada', entidade: 'projeto', entidadeId: r.projeto_id });
  return { ok: true };
}
