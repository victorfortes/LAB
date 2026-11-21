/**
 * Pauta por EQUIPE — a reunião semanal do escritório.
 *
 * O escritório não faz reunião por cliente: cada equipe (Cível, Empresarial, Trabalhista...) se reúne uma vez
 * por semana e passa por TODOS os clientes dela. Então:
 *  - o projeto pertence a uma ou mais equipes (`projetos.equipes`, vindo do Astrea e editável);
 *  - cada equipe tem a sua cadência (dia da semana, hora, participantes) em `pauta_equipes`;
 *  - a reunião da equipe puxa os itens abertos de todos os clientes dela, mostra o contexto de cada um
 *    (tarefas atrasadas, prazos e audiências da semana, andamentos recentes) e registra decisão item a item;
 *  - virar tarefa cai em Tarefas (e, com data, no Calendário); encerrar grava UMA ATA POR CLIENTE tratado
 *    (aparece em "Reuniões e atas" do projeto) e já agenda a reunião da semana seguinte.
 * Os itens continuam sendo do cliente: a manutenção das informações de cada cliente segue em #/pautas/:projeto.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const HORA = z.string().regex(/^\d{2}:\d{2}$/);
const NOME_EQUIPE = z.string().trim().min(2).max(60);
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const somar = (dataIso: string, dias: number) => new Date(Date.parse(`${dataIso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
/** Próxima data (a partir de `desde`, inclusive) que cai no dia da semana pedido. */
export function proximoDia(desde: string, diaSemana: number) {
  const d = new Date(`${desde}T12:00:00Z`); const delta = (diaSemana - d.getUTCDay() + 7) % 7;
  return somar(desde, delta);
}

export const EsquemaConfigEquipe = z.object({
  diaSemana: z.number().int().min(0).max(6),
  hora: HORA,
  duracaoMin: z.number().int().min(15).max(480).default(60),
  participantes: z.string().trim().max(2000).nullable().optional(),
  ativo: z.boolean().default(true),
});
export const EsquemaReuniaoEquipe = z.object({
  data: DATA, hora: HORA.nullable().optional(),
  titulo: z.string().trim().min(1).max(200).optional(),
  participantes: z.string().trim().max(2000).nullable().optional(),
});
export const EsquemaEquipesDoProjeto = z.object({ equipes: z.array(NOME_EQUIPE).max(8) });

async function orgEscritorio(db: PoolClient) {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM organizacoes WHERE tipo = 'escritorio' ORDER BY criado_em LIMIT 1`);
  if (!rows[0]) throw new PedidoInvalido('escritório não encontrado');
  return rows[0].id;
}

/** Mural das equipes: clientes, itens abertos, críticos, última e próxima reunião, cadência. */
export async function equipes(db: PoolClient) {
  const { rows } = await db.query<Record<string, any>>(`
    WITH eq AS (SELECT DISTINCT unnest(equipes) equipe FROM projetos WHERE situacao IN ('ativo','proposto')
                UNION SELECT equipe FROM pauta_equipes),
    cli AS (SELECT e.equipe, count(p.id)::int clientes, array_agg(p.id) ids FROM eq e LEFT JOIN projetos p ON e.equipe = ANY(p.equipes) AND p.situacao IN ('ativo','proposto') GROUP BY e.equipe)
    SELECT c.equipe, c.clientes,
           (SELECT count(*)::int FROM pauta_itens i WHERE i.projeto_id = ANY(c.ids) AND i.situacao IN ('aberto','discutido') AND (i.equipe IS NULL OR i.equipe = c.equipe)) abertos,
           (SELECT count(*)::int FROM pauta_itens i WHERE i.projeto_id = ANY(c.ids) AND i.situacao IN ('aberto','discutido') AND i.prioridade IN ('alta','urgente') AND (i.equipe IS NULL OR i.equipe = c.equipe)) criticos,
           (SELECT count(*)::int FROM tarefas t WHERE t.projeto_id = ANY(c.ids) AND t.status <> 'concluida' AND t.prazo < $1::date) atrasadas,
           (SELECT count(*)::int FROM tarefas t WHERE t.projeto_id = ANY(c.ids) AND t.status <> 'concluida' AND t.prazo BETWEEN $1::date AND $1::date + 7) semana,
           (SELECT max(r.data) FROM pauta_reunioes r WHERE r.equipe = c.equipe AND r.situacao = 'realizada') ultima,
           (SELECT json_build_object('id', r.id, 'data', r.data, 'hora', r.hora) FROM pauta_reunioes r WHERE r.equipe = c.equipe AND r.situacao = 'agendada' ORDER BY r.data LIMIT 1) proxima,
           (SELECT json_build_object('diaSemana', q.dia_semana, 'hora', q.hora, 'duracaoMin', q.duracao_min, 'participantes', q.participantes, 'ativo', q.ativo) FROM pauta_equipes q WHERE q.equipe = c.equipe) cadencia
      FROM cli c ORDER BY c.clientes DESC, c.equipe`, [hoje()]);
  const { rows: [sem] } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM projetos WHERE situacao IN ('ativo','proposto') AND equipes = '{}'`);
  return { equipes: rows.map((r) => ({ ...r, ultima: iso(r.ultima), proxima: r.proxima ? { ...r.proxima, data: iso(r.proxima.data) } : null })), semEquipe: sem?.n ?? 0 };
}

/**
 * A mesa da reunião semanal da equipe: clientes (com saúde), itens em aberto agrupados por cliente, contexto
 * de cada cliente (tarefas atrasadas, o que vence em 7 dias, últimos andamentos), reunião em curso e histórico.
 */
export async function daEquipe(db: PoolClient, equipe: string) {
  const h = hoje();
  const { rows: clientes } = await db.query<Record<string, any>>(`
    SELECT p.id, p.nome, p.tipo, p.fase, p.equipes, coalesce(u.nome, '—') responsavel,
           (SELECT count(*)::int FROM tarefas t WHERE t.projeto_id = p.id AND t.status <> 'concluida' AND t.prazo < $2::date) atrasadas,
           (SELECT count(*)::int FROM tarefas t WHERE t.projeto_id = p.id AND t.status <> 'concluida') abertas,
           (SELECT max(r.data) FROM pauta_reunioes r JOIN pauta_itens i ON i.reuniao_id = r.id WHERE i.projeto_id = p.id AND r.situacao = 'realizada') ultima_pauta,
           (SELECT max(realizada_em) FROM atas a WHERE a.projeto_id = p.id) ultima_ata
      FROM projetos p LEFT JOIN usuarios u ON u.id = p.responsavel_id
     WHERE $1 = ANY(p.equipes) AND p.situacao IN ('ativo','proposto') ORDER BY p.nome`, [equipe, h]);
  const ids = clientes.map((c) => c.id as string);
  const [itens, contexto, reunioes, cad, pessoas] = await Promise.all([
    db.query(`SELECT i.id, i.projeto_id "projetoId", i.titulo, i.detalhe, i.categoria, i.prioridade, i.situacao, i.decisao, i.responsavel_id "responsavelId", u.nome responsavel,
                     i.reuniao_id "reuniaoId", i.tarefa_id "tarefaId", t.status "tarefaStatus", t.prazo "tarefaPrazo", i.vezes_em_pauta "vezesEmPauta", i.criado_em "criadoEm", i.equipe
                FROM pauta_itens i LEFT JOIN usuarios u ON u.id = i.responsavel_id LEFT JOIN tarefas t ON t.id = i.tarefa_id
               WHERE i.projeto_id = ANY($1::uuid[]) AND (i.equipe IS NULL OR i.equipe = $2)
                 AND (i.situacao IN ('aberto','discutido') OR i.resolvido_em > now() - interval '8 days')
               ORDER BY CASE i.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, i.ordem, i.criado_em`, [ids, equipe]),
    // O que a equipe precisa ver de cada cliente sem abrir o projeto: atrasado, próximos 7 dias e o último andamento.
    db.query(`SELECT t.projeto_id "projetoId", t.id, t.titulo, t.tipo, t.prazo, t.hora, t.status, u.nome responsavel, (t.prazo < $2::date) atrasada
                FROM tarefas t LEFT JOIN usuarios u ON u.id = t.responsavel_id
               WHERE t.projeto_id = ANY($1::uuid[]) AND t.status <> 'concluida' AND t.prazo IS NOT NULL AND t.prazo <= $2::date + 7
               ORDER BY t.prazo, t.hora NULLS LAST LIMIT 400`, [ids, h]),
    db.query(`SELECT r.id, r.titulo, r.data, r.hora, r.situacao, r.participantes, r.resumo, r.realizada_em "realizadaEm",
                     (SELECT count(*)::int FROM pauta_itens i WHERE i.reuniao_id = r.id) itens,
                     (SELECT count(*)::int FROM atas a WHERE a.pauta_reuniao_id = r.id) atas
                FROM pauta_reunioes r WHERE r.equipe = $1 ORDER BY r.data DESC LIMIT 20`, [equipe]),
    db.query(`SELECT dia_semana "diaSemana", hora, duracao_min "duracaoMin", participantes, ativo FROM pauta_equipes WHERE equipe = $1`, [equipe]),
    db.query(`SELECT DISTINCT u.id, u.nome FROM projeto_equipe e JOIN usuarios u ON u.id = e.usuario_id WHERE e.projeto_id = ANY($1::uuid[]) AND e.ate IS NULL ORDER BY u.nome`, [ids]),
  ]);
  const { rows: andam } = await db.query<{ projeto_id: string; data: string; titulo: string; numero: string }>(
    `SELECT DISTINCT ON (pr.projeto_id) pr.projeto_id, x.data::text, x.titulo, pr.numero FROM movimentacoes x JOIN processos pr ON pr.id = x.processo_id
      WHERE pr.projeto_id = ANY($1::uuid[]) AND x.data > $2::date - 15 ORDER BY pr.projeto_id, x.data DESC`, [ids, h]);
  const ultimoAnd = new Map(andam.map((a) => [a.projeto_id, a]));
  const porCliente = new Map<string, unknown[]>(); for (const c of contexto.rows as any[]) porCliente.set(c.projetoId, [...(porCliente.get(c.projetoId) ?? []), c]);
  const abertosPor = new Map<string, number>(); for (const i of itens.rows as any[]) if (['aberto', 'discutido'].includes(i.situacao)) abertosPor.set(i.projetoId, (abertosPor.get(i.projetoId) ?? 0) + 1);
  const ref = Date.parse(`${h}T12:00:00Z`);
  return {
    equipe,
    cadencia: cad.rows[0] ?? null,
    reuniaoAtual: (reunioes.rows as any[]).find((r) => r.situacao === 'agendada') ?? null,
    reunioes: (reunioes.rows as any[]).map((r) => ({ ...r, data: iso(r.data) })),
    pessoas: pessoas.rows,
    clientes: clientes.map((c) => {
      const ult = c.ultima_pauta ?? c.ultima_ata; const dias = ult ? Math.round((ref - Date.parse(`${iso(ult)}T12:00:00Z`)) / 86_400_000) : null;
      const ctx = (porCliente.get(c.id) ?? []) as any[];
      const saude = c.atrasadas > 0 || ctx.some((x) => x.atrasada) ? 'critico' : (abertosPor.get(c.id) ?? 0) > 0 || ctx.length ? 'atencao' : 'ok';
      return { id: c.id, nome: c.nome, tipo: c.tipo, fase: c.fase, equipes: c.equipes, responsavel: c.responsavel, atrasadas: c.atrasadas, abertas: c.abertas,
        itensAbertos: abertosPor.get(c.id) ?? 0, diasSemPauta: dias, saude, semana: ctx.map((x) => ({ ...x, prazo: iso(x.prazo) })), ultimoAndamento: ultimoAnd.get(c.id) ?? null };
    }),
    itens: (itens.rows as any[]).map((i) => ({ ...i, tarefaPrazo: iso(i.tarefaPrazo) })),
  };
}

export async function configurarEquipe(db: PoolClient, equipe: string, d: z.infer<typeof EsquemaConfigEquipe>, i: Identidade) {
  const org = await orgEscritorio(db);
  await db.query(`INSERT INTO pauta_equipes (organizacao_id, equipe, dia_semana, hora, duracao_min, participantes, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (organizacao_id, equipe) DO UPDATE SET dia_semana = EXCLUDED.dia_semana, hora = EXCLUDED.hora, duracao_min = EXCLUDED.duracao_min,
      participantes = EXCLUDED.participantes, ativo = EXCLUDED.ativo, atualizado_em = now()`,
    [org, equipe, d.diaSemana, d.hora, d.duracaoMin, d.participantes ?? null, d.ativo]);
  // Já deixa a próxima reunião marcada (se não houver uma agendada).
  let agendada: string | null = null;
  if (d.ativo) {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM pauta_reunioes WHERE equipe = $1 AND situacao = 'agendada' LIMIT 1`, [equipe]);
    if (!rows[0]) agendada = (await agendarReuniaoEquipe(db, equipe, { data: proximoDia(hoje(), d.diaSemana), hora: d.hora, participantes: d.participantes ?? null }, i)).id;
  }
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'pauta.equipe_configurada', entidade: 'organizacao', entidadeId: org, depois: { equipe, ...d } });
  return { ok: true, agendada };
}

/** Agenda a reunião da equipe. Os itens abertos de todos os clientes da equipe entram nela. */
export async function agendarReuniaoEquipe(db: PoolClient, equipe: string, d: z.infer<typeof EsquemaReuniaoEquipe>, i: Identidade) {
  const org = await orgEscritorio(db);
  const { rows: ja } = await db.query<{ id: string }>(`SELECT id FROM pauta_reunioes WHERE equipe = $1 AND situacao = 'agendada' LIMIT 1`, [equipe]);
  if (ja[0]) throw new PedidoInvalido('esta equipe já tem uma reunião agendada: encerre ou cancele antes de marcar outra');
  const { rows: [r] } = await db.query<{ id: string }>(
    `INSERT INTO pauta_reunioes (organizacao_id, projeto_id, equipe, titulo, data, hora, participantes, criado_por) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [org, equipe, d.titulo ?? `Reunião de pauta · ${equipe}`, d.data, d.hora ?? null, d.participantes ?? null, i.usuarioId]);
  await db.query(`UPDATE pauta_itens SET reuniao_id = $2, atualizado_em = now()
     WHERE situacao IN ('aberto','discutido') AND (equipe IS NULL OR equipe = $1) AND reuniao_id IS NULL
       AND projeto_id IN (SELECT id FROM projetos WHERE $1 = ANY(equipes) AND situacao IN ('ativo','proposto'))`, [equipe, r!.id]);
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'pauta.reuniao_equipe_agendada', entidade: 'organizacao', entidadeId: org, depois: { equipe, ...d } });
  return { id: r!.id };
}

/** Para o Calendário: reuniões de pauta agendadas e recentes (equipe ou cliente). */
export async function reunioesParaAgenda(db: PoolClient) {
  const { rows } = await db.query<Record<string, any>>(`SELECT r.id, r.titulo, r.data, r.hora, r.situacao, r.equipe, r.projeto_id "projetoId",
      (SELECT count(*)::int FROM pauta_itens i WHERE i.reuniao_id = r.id) itens
      FROM pauta_reunioes r WHERE r.situacao <> 'cancelada' AND r.data BETWEEN $1::date - 45 AND $1::date + 120 ORDER BY r.data`, [hoje()]);
  return rows.map((r) => ({ ...r, data: iso(r.data) }));
}

export async function equipesDoProjeto(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaEquipesDoProjeto>, i: Identidade) {
  const lista = [...new Set(d.equipes.map((e) => e.trim()))];
  const { rows } = await db.query<{ organizacao_id: string }>('UPDATE projetos SET equipes = $2 WHERE id = $1 RETURNING organizacao_id', [projetoId, lista]);
  if (!rows[0]) throw new NaoEncontrado('projeto não encontrado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'projeto.equipes', entidade: 'projeto', entidadeId: projetoId, depois: { equipes: lista } });
  return { equipes: lista };
}

export { somar as somarDias };
