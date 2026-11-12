/**
 * Andamentos dos processos: busca diária no DataJud (todos os processos da carteira), histórico manual
 * e o resumo dos últimos movimentos, por projeto.
 *
 * A fila é durável (`datajud_monitor`): cada execução consulta um lote, agrupado por tribunal (uma
 * chamada por índice, com vários números), grava o que veio e marca a próxima consulta. Falhou, espera
 * mais; deu certo, volta em ~20 h. Nada aqui apaga andamento: o DataJud só acrescenta.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Banco } from '../store/conexao.ts';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { CHAVE_DATAJUD } from './sentinela.ts';
import { indiceDataJud, lerHitsDataJud, resumir, soDigitos, classificar } from '../domain/processo/andamentos.ts';

const URL = (alias: string) => `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`;
interface ItemDaFila { processo_id: string; numero: string; indice: string | null }

/** Consulta um lote (de qualquer tamanho até ~50) e grava. Devolve quantos andamentos novos entraram. */
/** O DataJud costuma levar 30 a 45 s por consulta: cada chamada espera até 55 s, e não se começa outra depois de `prazoMs`. */
export async function consultarLote(db: PoolClient, itens: ItemDaFila[], buscar: typeof fetch = fetch, prazoMs = 50_000) {
  const inicio = Date.now(); let novos = 0; let consultados = 0; const erros: string[] = [];
  const grupos = new Map<string | null, ItemDaFila[]>();
  for (const i of itens) { const ix = i.indice ?? indiceDataJud(i.numero); grupos.set(ix, [...(grupos.get(ix) ?? []), { ...i, indice: ix }]); }
  for (const [indice, lote] of grupos) {
    if (!indice) {
      for (const i of lote) await db.query('SELECT datajud_registrar($1,NULL,FALSE,NULL,$2,NULL,NULL)', [i.processo_id, 'número sem índice público no DataJud (STF/CNJ ou tribunal desconhecido)']);
      continue;
    }
    if (Date.now() - inicio > prazoMs) break;
    try {
      const r = await buscar(URL(indice), {
        method: 'POST', signal: AbortSignal.timeout(55_000),
        headers: { authorization: `APIKey ${CHAVE_DATAJUD}`, 'content-type': 'application/json' },
        body: JSON.stringify({ size: Math.min(200, lote.length * 4), _source: ['numeroProcesso', 'grau', 'classe', 'orgaoJulgador', 'tribunal', 'assuntos', 'dataAjuizamento', 'movimentos'], query: { terms: { numeroProcesso: lote.map((i) => soDigitos(i.numero)) } } }),
      });
      if (!r.ok) throw new Error(`DataJud ${indice} respondeu HTTP ${r.status}`);
      const d = await r.json() as { hits?: { hits?: { _source: Record<string, any> }[] } };
      const por = new Map<string, { _source: Record<string, any> }[]>();
      for (const h of d.hits?.hits ?? []) { const k = soDigitos(String(h._source.numeroProcesso ?? '')); por.set(k, [...(por.get(k) ?? []), h]); }
      for (const i of lote) {
        const hits = por.get(soDigitos(i.numero)) ?? [];
        const { movimentos, capa } = lerHitsDataJud(hits);
        const { rows } = await db.query<{ n: number }>('SELECT datajud_registrar($1,$2,TRUE,$3,NULL,$4::jsonb,$5::jsonb) AS n', [i.processo_id, indice, hits.length > 0, JSON.stringify(movimentos.slice(0, 400)), hits.length ? JSON.stringify(capa) : null]);
        novos += Number(rows[0]?.n ?? 0); consultados++;
      }
    } catch (e) {
      const msg = (e as Error).message; erros.push(msg);
      for (const i of lote) await db.query('SELECT datajud_registrar($1,$2,FALSE,NULL,$3,NULL,NULL)', [i.processo_id, indice, msg]);
    }
  }
  return { consultados, novos, erros };
}

/** Rotina agendada (sem sessão): pega o lote vencido da fila e consulta. */
export async function rotinaDataJud(banco: Banco, opcoes: { fetch?: typeof fetch; limite?: number } = {}) {
  return banco.semContexto(async (db) => {
    const { rows } = await db.query<ItemDaFila>('SELECT processo_id, numero, indice FROM datajud_fila($1)', [opcoes.limite ?? 40]);
    if (!rows.length) return { consultados: 0, novos: 0, erros: [] as string[] };
    return consultarLote(db, rows, opcoes.fetch);
  });
}

/** Botão "Buscar andamentos agora" do projeto: consulta já os processos dele. */
export async function atualizarProjeto(db: PoolClient, projetoId: string, buscar?: typeof fetch) {
  const { rows } = await db.query<ItemDaFila>(`SELECT p.id AS processo_id, p.numero, m.indice FROM processos p LEFT JOIN datajud_monitor m ON m.processo_id = p.id WHERE p.projeto_id = $1 ORDER BY m.ultima_consulta NULLS FIRST LIMIT 40`, [projetoId]);
  if (!rows.length) throw new PedidoInvalido('este projeto não tem processo cadastrado');
  // Todos os processos do projeto passam à frente na fila; os que não couberem nesta chamada saem na próxima rodada (5 min).
  await db.query('UPDATE datajud_monitor SET proxima = now() WHERE processo_id IN (SELECT id FROM processos WHERE projeto_id = $1)', [projetoId]);
  const r = await consultarLote(db, rows, buscar, 30_000);
  return { ...r, naFila: rows.length - r.consultados };
}

export async function estado(db: PoolClient) {
  const { rows: [r] } = await db.query<Record<string, number | string | null>>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE ativo)::int AS ativos,
      count(*) FILTER (WHERE ultimo_sucesso IS NOT NULL)::int AS consultados, count(*) FILTER (WHERE encontrado)::int AS encontrados,
      count(*) FILTER (WHERE ultimo_erro IS NOT NULL)::int AS com_erro, count(*) FILTER (WHERE ultimo_sucesso > now() - interval '36 hours')::int AS em_dia,
      max(ultimo_sucesso) AS ultima, coalesce(sum(movimentos), 0)::int AS movimentos FROM datajud_monitor`);
  return r;
}

// --------------------------------------------------------------- histórico ---
export const EsquemaHistorico = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  titulo: z.string().trim().min(2).max(300),
  texto: z.string().trim().max(8000).optional(),
  processoId: z.string().uuid().nullable().optional(),
});

export async function historicoDoProjeto(db: PoolClient, projetoId: string, hoje: string, dias = 30) {
  const { rows: pj } = await db.query<{ id: string }>('SELECT id FROM projetos WHERE id = $1', [projetoId]);
  if (!pj[0]) throw new NaoEncontrado('projeto não encontrado');
  const { rows: processos } = await db.query<{ id: string; numero: string; classe: string | null; ultimo: string | null; ultima_consulta: Date | null; ultimo_sucesso: Date | null; encontrado: boolean | null; ultimo_erro: string | null; movimentos: number | null }>(
    `SELECT p.id, p.numero, p.classe, (SELECT max(data)::text FROM movimentacoes x WHERE x.processo_id = p.id) AS ultimo,
            m.ultima_consulta, m.ultimo_sucesso, m.encontrado, m.ultimo_erro, m.movimentos
       FROM processos p LEFT JOIN datajud_monitor m ON m.processo_id = p.id WHERE p.projeto_id = $1 ORDER BY ultimo DESC NULLS LAST`, [projetoId]);
  const { rows: movs } = await db.query<{ id: string; data: string; titulo: string; conteudo: string | null; fonte: string; processo: string; processo_id: string; autor: string | null }>(
    `SELECT x.id, x.data::text, x.titulo, x.conteudo, x.fonte, p.numero AS processo, p.id AS processo_id, u.nome AS autor FROM movimentacoes x JOIN processos p ON p.id = x.processo_id LEFT JOIN usuarios u ON u.id = x.criado_por
      WHERE p.projeto_id = $1 ORDER BY x.data DESC, x.criado_em DESC LIMIT 400`, [projetoId]);
  const { rows: man } = await db.query<{ id: string; data: string; titulo: string; texto: string | null; autor: string | null }>(
    `SELECT h.id, h.data::text, h.titulo, h.texto, u.nome AS autor FROM projeto_historicos h LEFT JOIN usuarios u ON u.id = h.criado_por WHERE h.projeto_id = $1 ORDER BY h.data DESC, h.criado_em DESC LIMIT 200`, [projetoId]);
  const itens = [
    ...movs.map((m) => ({ id: m.id, tipo: 'movimentacao' as const, data: m.data, titulo: m.titulo, conteudo: m.conteudo, fonte: m.fonte, processo: m.processo, processoId: m.processo_id, autor: m.autor, ...classificar(m.titulo) })),
    ...man.map((h) => ({ id: h.id, tipo: 'historico' as const, data: h.data, titulo: h.titulo, conteudo: h.texto, fonte: 'manual', processo: null, processoId: null, autor: h.autor, categoria: 'Registro manual', peso: 'relevante' as const })),
  ].sort((a, b) => b.data.localeCompare(a.data));
  return {
    processos: processos.map((p) => ({ id: p.id, numero: p.numero, classe: p.classe, ultimo: p.ultimo, ultimaConsulta: p.ultima_consulta, ultimoSucesso: p.ultimo_sucesso, encontrado: p.encontrado, erro: p.ultimo_erro, movimentos: p.movimentos ?? 0 })),
    itens, resumo: resumir(itens, processos.map((p) => ({ numero: p.numero, ultimo: p.ultimo })), hoje, dias),
  };
}

export async function registrarHistorico(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaHistorico>, i: Identidade) {
  const { rows: pj } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  if (!pj[0]) throw new NaoEncontrado('projeto não encontrado');
  let id: string;
  if (d.processoId) {
    const { rows: p } = await db.query<{ id: string }>('SELECT id FROM processos WHERE id = $1 AND projeto_id = $2', [d.processoId, projetoId]);
    if (!p[0]) throw new PedidoInvalido('o processo escolhido não é deste projeto');
    id = (await db.query<{ id: string }>(`INSERT INTO movimentacoes (processo_id, organizacao_id, data, titulo, conteudo, fonte, externo_id, criado_por) VALUES ($1,$2,$3,$4,$5,'manual',gen_random_uuid()::text,$6) RETURNING id`,
      [d.processoId, pj[0].organizacao_id, d.data, d.titulo, d.texto || null, i.usuarioId])).rows[0]!.id;
  } else {
    id = (await db.query<{ id: string }>('INSERT INTO projeto_historicos (organizacao_id, projeto_id, data, titulo, texto, criado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [pj[0].organizacao_id, projetoId, d.data, d.titulo, d.texto || null, i.usuarioId])).rows[0]!.id;
  }
  await auditar(db, { organizacaoId: pj[0].organizacao_id, usuarioId: i.usuarioId, acao: 'projeto.historico_registrado', entidade: 'projeto', entidadeId: projetoId, depois: { titulo: d.titulo, processo: d.processoId ?? null } });
  return { id };
}

/** Só o registro manual se apaga: andamento vindo do tribunal é fato do processo. */
export async function excluirHistorico(db: PoolClient, id: string, i: Identidade) {
  const a = await db.query<{ organizacao_id: string; projeto_id: string }>('DELETE FROM projeto_historicos WHERE id = $1 RETURNING organizacao_id, projeto_id', [id]);
  const b = a.rows[0] ? a : await db.query<{ organizacao_id: string; projeto_id: string }>(`DELETE FROM movimentacoes x USING processos p WHERE x.id = $1 AND x.fonte = 'manual' AND NOT x.visivel_ao_cliente AND p.id = x.processo_id RETURNING x.organizacao_id, p.projeto_id`, [id]);
  if (!b.rows[0]) throw new NaoEncontrado('registro manual não encontrado (andamento do tribunal não se apaga)');
  await auditar(db, { organizacaoId: b.rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'projeto.historico_excluido', entidade: 'projeto', entidadeId: b.rows[0].projeto_id });
  return { ok: true };
}
