/**
 * Controladoria automatizada.
 *
 * 1. Fila "Agendar em lote": cada publicação do DJEN ainda sem prazo chega com o lançamento sugerido no
 *    padrão do escritório (título, dias, regime, fundamento) e com o responsável sugerido. A controladoria
 *    confere e confirma um ou vários de uma vez; só então vira prazo (validação prévia).
 * 2. Direcionamento da agenda do Astrea: os prazos, eventos e audiências em aberto no Astrea (base do BI de
 *    Prazos) viram tarefas no LAB, no projeto certo e para a pessoa certa (casamento pelo nome do Astrea).
 *    O que foi concluído no Astrea fecha a tarefa. Roda a cada carga da agenda e pelo botão.
 *
 * Responsável sugerido: quem mais lança prazos daquele processo no Astrea; senão, o responsável do processo
 * na carteira importada do Astrea; senão, o responsável do projeto.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { sugerirLancamento, chaveDeNome, limparTexto } from '../domain/controladoria/padroes.ts';
import { agendarPublicacao } from './controladoria.ts';

const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const isoDeBr = (d: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d ?? '').trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

async function mapaDePessoas(db: PoolClient) {
  const { rows } = await db.query<{ id: string; nome: string }>(
    `SELECT DISTINCT u.id, u.nome FROM usuarios u JOIN vinculos v ON v.usuario_id = u.id AND v.revogado_em IS NULL
      JOIN organizacoes o ON o.id = v.organizacao_id AND o.tipo = 'escritorio' WHERE v.papel NOT IN ('integracao','cliente_administrador','cliente_usuario','parceiro_externo')`);
  const exato = new Map<string, { id: string; nome: string }>(); const primeiroUltimo = new Map<string, { id: string; nome: string }[]>();
  for (const u of rows) {
    exato.set(chaveDeNome(u.nome), u);
    const p = chaveDeNome(u.nome).split(' '); const k = `${p[0]} ${p[p.length - 1]}`;
    primeiroUltimo.set(k, [...(primeiroUltimo.get(k) ?? []), u]);
  }
  return (nome: string | null | undefined) => {
    const c = chaveDeNome(nome); if (!c) return null;
    const e = exato.get(c); if (e) return e;
    const p = c.split(' '); const lista = primeiroUltimo.get(`${p[0]} ${p[p.length - 1]}`) ?? [];
    return lista.length === 1 ? lista[0]! : null; // ambíguo não chuta
  };
}

/** Quem mais lança prazos de cada processo no Astrea, e o responsável da carteira importada. */
async function responsaveisPorProcesso(db: PoolClient) {
  const { rows: ag } = await db.query<{ num: string; resp: string; n: number }>(
    `SELECT regexp_replace(numero,'\\D','','g') num, resp, count(*)::int n FROM bi_agenda_linhas WHERE coalesce(resp,'') <> '' AND coalesce(numero,'') <> '' GROUP BY 1,2`);
  const { rows: cart } = await db.query<{ num: string; resp: string }>(
    `SELECT regexp_replace(coalesce(numero_original,''),'\\D','','g') num, responsavel resp FROM astrea_registros WHERE coalesce(responsavel,'') <> ''`).catch(() => ({ rows: [] as { num: string; resp: string }[] }));
  const melhor = new Map<string, { resp: string; n: number }>();
  for (const a of ag) { const m = melhor.get(a.num); if (!m || a.n > m.n) melhor.set(a.num, { resp: a.resp, n: a.n }); }
  const carteira = new Map(cart.filter((c) => c.num).map((c) => [c.num, c.resp]));
  return (num: string) => melhor.get(num)?.resp ?? carteira.get(num) ?? null;
}

/** Liga publicação sem processo ao processo de mesmo número (só dígitos). Só quando há exatamente um processo. */
export async function vincularPorNumero(db: PoolClient) {
  const r = await db.query(`UPDATE publicacoes p SET processo_id = x.id
      FROM (SELECT regexp_replace(numero,'\\D','','g') num, min(id::text)::uuid id FROM processos GROUP BY 1 HAVING count(*) = 1) x
     WHERE p.processo_id IS NULL AND regexp_replace(coalesce(p.numero_processo,''),'\\D','','g') = x.num`);
  return r.rowCount ?? 0;
}

/** Fila de publicações sem prazo, cada uma com o lançamento sugerido. */
export async function filaDeSugestoes(db: PoolClient) {
  await vincularPorNumero(db);
  const { rows } = await db.query<{ id: string; data: string; tribunal: string | null; tipo: string | null; orgao: string | null; numero: string | null; classe: string | null; texto: string | null;
    processo_id: string | null; projeto_id: string | null; projeto: string | null; projeto_resp_id: string | null; projeto_resp: string | null; situacao: string }>(
    `SELECT p.id, p.data_disponibilizacao::text data, p.tribunal, p.tipo, p.orgao, p.numero_processo numero, p.classe, p.texto, p.situacao,
            p.processo_id, pr.projeto_id, pj.nome projeto, pj.responsavel_id projeto_resp_id, u.nome projeto_resp
       FROM publicacoes p LEFT JOIN processos pr ON pr.id = p.processo_id LEFT JOIN projetos pj ON pj.id = pr.projeto_id LEFT JOIN usuarios u ON u.id = pj.responsavel_id
      WHERE p.prazo_id IS NULL AND p.situacao IN ('nova','lida')
      ORDER BY p.data_disponibilizacao DESC, p.comunicacao_id DESC LIMIT 300`);
  const pessoa = await mapaDePessoas(db);
  const respDe = await responsaveisPorProcesso(db);
  const { rows: freq } = await db.query<{ titulo: string; n: number }>(`SELECT upper(titulo) titulo, count(*)::int n FROM bi_agenda_linhas WHERE tipo = 'Prazo' GROUP BY 1`);
  const usoNoEscritorio = new Map(freq.map((f) => [f.titulo, f.n]));
  const itens = rows.map((p) => {
    const s = sugerirLancamento({ texto: p.texto, classe: p.classe, tipo: p.tipo });
    const nomeAstrea = respDe(so(p.numero));
    const doAstrea = pessoa(nomeAstrea);
    const responsavel = doAstrea ? { id: doAstrea.id, nome: doAstrea.nome, origem: 'astrea' } : p.projeto_resp_id ? { id: p.projeto_resp_id, nome: p.projeto_resp, origem: 'projeto' } : null;
    return {
      id: p.id, data: p.data, tribunal: p.tribunal, tipo: p.tipo, orgao: p.orgao, numero: p.numero, classe: p.classe, situacao: p.situacao,
      resumo: limparTexto(p.texto).slice(0, 420), processoId: p.processo_id, projetoId: p.projeto_id, projeto: p.projeto,
      pronto: !!(p.processo_id && p.projeto_id), sugestao: { ...s, usosNoEscritorio: usoNoEscritorio.get(s.titulo.toUpperCase()) ?? 0 },
      responsavel, responsavelAstrea: nomeAstrea,
    };
  });
  return {
    itens,
    resumo: { total: itens.length, prontos: itens.filter((i) => i.pronto).length, semProjeto: itens.filter((i) => !i.pronto).length, altaConfianca: itens.filter((i) => i.sugestao.confianca >= 0.8).length },
  };
}

export const EsquemaConfirmacao = z.object({
  itens: z.array(z.object({
    publicacaoId: z.string().uuid(),
    titulo: z.string().trim().min(1).max(200),
    dias: z.number().int().positive().max(3650),
    regime: z.enum(['uteis', 'corridos']),
    responsavelId: z.string().uuid().nullable().optional(),
  })).min(1).max(100),
});

/** Confirma em lote: cada item vira prazo + tarefa. Um erro não derruba os demais (savepoint por item). */
export async function confirmarEmLote(db: PoolClient, d: z.infer<typeof EsquemaConfirmacao>, i: Identidade) {
  const resultados: { publicacaoId: string; ok: boolean; vencimento?: string; erro?: string }[] = [];
  for (const it of d.itens) {
    await db.query('SAVEPOINT item_lote');
    try {
      const r = await agendarPublicacao(db, it.publicacaoId, { titulo: it.titulo, dias: it.dias, regime: it.regime, feriadosLocais: [], ...(it.responsavelId ? { responsavelId: it.responsavelId } : {}) }, i);
      await db.query('RELEASE SAVEPOINT item_lote');
      resultados.push({ publicacaoId: it.publicacaoId, ok: true, vencimento: String((r as { vencimento?: unknown }).vencimento ?? '').slice(0, 10) });
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT item_lote');
      resultados.push({ publicacaoId: it.publicacaoId, ok: false, erro: (e as Error).message });
    }
  }
  return { confirmados: resultados.filter((r) => r.ok).length, falhas: resultados.filter((r) => !r.ok).length, resultados };
}

/** Catálogo de padrões do escritório (o que a agenda do Astrea mostra), para a tela de conferência. */
export async function padroes(db: PoolClient) {
  const { rows } = await db.query<{ titulo: string; n: number; abertos: number }>(
    `SELECT titulo, count(*)::int n, count(*) FILTER (WHERE status NOT ILIKE 'conclu%')::int abertos FROM bi_agenda_linhas WHERE tipo = 'Prazo' GROUP BY 1 ORDER BY 2 DESC LIMIT 60`);
  const { rows: resp } = await db.query<{ resp: string; n: number; abertos: number }>(
    `SELECT coalesce(nullif(resp,''),'(sem responsável)') resp, count(*)::int n, count(*) FILTER (WHERE status NOT ILIKE 'conclu%')::int abertos FROM bi_agenda_linhas GROUP BY 1 ORDER BY 2 DESC`);
  const pessoa = await mapaDePessoas(db);
  const acao = (t: string) => (t.split(/\s+-\s+/)[0] ?? t).trim().toUpperCase();
  const porAcao = new Map<string, number>();
  for (const r of rows) porAcao.set(acao(r.titulo), (porAcao.get(acao(r.titulo)) ?? 0) + r.n);
  return {
    titulos: rows, acoes: [...porAcao.entries()].map(([a, n]) => ({ acao: a, n })).sort((a, b) => b.n - a.n),
    responsaveis: resp.map((r) => ({ ...r, noLab: pessoa(r.resp)?.nome ?? null })),
  };
}

/** Linha da agenda do Astrea que já não serve como tarefa: concluída, ou vencida há mais de `diasPodre` sem baixa. */
export const TIPO_DA_AGENDA: Record<string, 'prazo' | 'evento' | 'audiencia'> = { Prazo: 'prazo', Evento: 'evento', 'Audiência': 'audiencia' };
export const DIAS_PODRE_PADRAO = 30;
const MOTIVO_SAIU = 'Saiu da agenda do Astrea (concluído, excluído ou remarcado lá).';
const motivoPodre = (dias: number) => `Vencido há mais de ${dias} dias no Astrea sem baixa: arquivado na limpeza automática.`;

/**
 * Direciona a agenda do Astrea para o LAB, e MANTÉM o que já foi direcionado em dia.
 *
 * A cada carga (automação diária ou botão):
 *  - prazo, evento e audiência em aberto viram item no projeto do processo (ou do caso), com o TIPO certo
 *    (prazo, evento, audiência), o processo/caso ligado e o responsável do Astrea;
 *  - o que já existe é atualizado (título, data, hora, responsável, tipo);
 *  - concluído no Astrea fecha a tarefa; o que sumiu da agenda (remarcado, excluído, baixado) é arquivado;
 *  - vencido há mais de `diasPodre` dias sem baixa no Astrea não vira tarefa e, se já virou, é arquivado.
 * Arquivar não apaga: a tarefa sai do quadro e fica no filtro "Arquivadas", com o motivo, e pode ser reaberta.
 * Idempotente pela chave (processo | título | data | tipo).
 */
export async function direcionarAgenda(db: PoolClient, organizacaoId: string, usuarioId: string | null, opcoes: { diasPodre?: number; hoje?: string } = {}) {
  const diasPodre = opcoes.diasPodre ?? DIAS_PODRE_PADRAO;
  const hoje = opcoes.hoje ?? new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const corte = new Date(Date.parse(`${hoje}T12:00:00Z`) - diasPodre * 86_400_000).toISOString().slice(0, 10);
  const { rows: agenda } = await db.query<{ tipo: string; data: string; hora: string | null; titulo: string; numero: string; resp: string; status: string; juizo: string | null; caso: string | null }>(
    `SELECT tipo, data, hora, titulo, numero, resp, status, juizo, caso FROM bi_agenda_linhas WHERE organizacao_id = $1`, [organizacaoId]);
  const { rows: procs } = await db.query<{ num: string; id: string; projeto_id: string; responsavel_id: string | null }>(
    `SELECT regexp_replace(pr.numero,'\\D','','g') num, pr.id, pr.projeto_id, pj.responsavel_id FROM processos pr JOIN projetos pj ON pj.id = pr.projeto_id WHERE pr.organizacao_id = $1 AND pr.projeto_id IS NOT NULL`, [organizacaoId]);
  const projetoDe = new Map(procs.map((p) => [p.num, p]));
  // Caso sem número (consultivo, administrativo): casa pelo título do caso na carteira importada do Astrea.
  const { rows: casos } = await db.query<{ titulo: string; projeto_id: string; responsavel_id: string | null }>(
    `SELECT DISTINCT ON (lower(btrim(a.titulo))) lower(btrim(a.titulo)) titulo, a.projeto_id, pj.responsavel_id FROM astrea_registros a JOIN projetos pj ON pj.id = a.projeto_id
      WHERE a.organizacao_id = $1 AND a.projeto_id IS NOT NULL AND coalesce(a.titulo,'') <> ''`, [organizacaoId]).catch(() => ({ rows: [] as { titulo: string; projeto_id: string; responsavel_id: string | null }[] }));
  const casoDe = new Map(casos.map((c) => [c.titulo, c]));
  const pessoa = await mapaDePessoas(db);
  let criadas = 0, atualizadas = 0, concluidas = 0, semProjeto = 0, semResponsavel = 0, ignoradasPodres = 0;
  const pessoasSemCadastro = new Set<string>();
  const vivas = new Set<string>();
  const podres = new Set<string>();
  for (const a of agenda) {
    const num = so(a.numero); const proc = num ? projetoDe.get(num) : undefined;
    const caso = !proc && a.caso ? casoDe.get(a.caso.trim().toLowerCase()) : undefined;
    const projetoId = proc?.projeto_id ?? caso?.projeto_id;
    const iso = isoDeBr(a.data);
    const concluido = /conclu/i.test(a.status ?? '');
    if (!projetoId || !iso) { if (!concluido) semProjeto++; continue; }
    const chave = 'astrea:' + createHash('sha256').update(`${num}|${a.titulo}|${a.data}|${a.tipo}`).digest('hex').slice(0, 24);
    if (concluido) {
      const r = await db.query(`UPDATE tarefas SET status = 'concluida', concluida_em = now(), atualizado_em = now(), conclusao_nota = coalesce(conclusao_nota, 'Concluído no Astrea.')
        WHERE projeto_id = $1 AND chave_playbook = $2 AND status <> 'concluida'`, [projetoId, chave]);
      concluidas += r.rowCount ?? 0; continue;
    }
    if (iso < corte) { podres.add(chave); ignoradasPodres++; continue; }
    vivas.add(chave);
    const quem = pessoa(a.resp);
    if (!quem) { semResponsavel++; if (a.resp) pessoasSemCadastro.add(a.resp); }
    const tipo = TIPO_DA_AGENDA[a.tipo] ?? 'prazo';
    const titulo = (a.titulo || a.tipo).slice(0, 300);
    const descricao = [`Lançado no Astrea (${a.tipo}${a.hora ? `, ${a.hora}` : ''}).`, a.caso ? `${num ? 'Processo' : 'Caso'}: ${a.caso}.` : null, a.juizo ? `Juízo: ${a.juizo}.` : null, a.resp ? `Responsável no Astrea: ${a.resp}.` : null].filter(Boolean).join(' ');
    const r = await db.query<{ novo: boolean }>(
      `INSERT INTO tarefas (organizacao_id, projeto_id, titulo, descricao, prioridade, responsavel_id, prazo, origem, chave_playbook, criado_por, tipo, hora, processo_id, caso)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'automacao',$8,$9,$10,$11,$12,$13)
       ON CONFLICT (projeto_id, chave_playbook) WHERE chave_playbook IS NOT NULL
       DO UPDATE SET titulo = EXCLUDED.titulo, prazo = EXCLUDED.prazo, descricao = EXCLUDED.descricao, tipo = EXCLUDED.tipo, hora = EXCLUDED.hora,
                     processo_id = coalesce(EXCLUDED.processo_id, tarefas.processo_id), caso = EXCLUDED.caso,
                     responsavel_id = coalesce(EXCLUDED.responsavel_id, tarefas.responsavel_id), atualizado_em = now(),
                     -- Voltou para a agenda (reaberto no Astrea): sai do arquivo.
                     status = CASE WHEN tarefas.arquivada_em IS NOT NULL THEN 'a_fazer' ELSE tarefas.status END,
                     concluida_em = CASE WHEN tarefas.arquivada_em IS NOT NULL THEN NULL ELSE tarefas.concluida_em END,
                     arquivada_em = NULL, arquivada_motivo = NULL
         WHERE tarefas.arquivada_em IS NOT NULL OR (tarefas.status <> 'concluida' AND (tarefas.prazo IS DISTINCT FROM EXCLUDED.prazo OR tarefas.titulo IS DISTINCT FROM EXCLUDED.titulo
               OR tarefas.tipo IS DISTINCT FROM EXCLUDED.tipo OR tarefas.hora IS DISTINCT FROM EXCLUDED.hora OR tarefas.processo_id IS DISTINCT FROM coalesce(EXCLUDED.processo_id, tarefas.processo_id)
               OR tarefas.descricao IS DISTINCT FROM EXCLUDED.descricao OR tarefas.responsavel_id IS DISTINCT FROM coalesce(EXCLUDED.responsavel_id, tarefas.responsavel_id)))
       RETURNING (xmax = 0) AS novo`,
      [organizacaoId, projetoId, titulo, descricao, tipo === 'prazo' ? 'alta' : 'media', quem?.id ?? proc?.responsavel_id ?? caso?.responsavel_id ?? null, iso, chave, usuarioId, tipo, a.hora || null, proc?.id ?? null, num ? null : (a.caso ?? '').slice(0, 500) || null]);
    if (r.rows[0]?.novo) criadas++; else if (r.rowCount) atualizadas++;
  }
  // Tudo o que veio do Astrea, segue aberto e não está mais vivo na agenda: arquiva com o motivo.
  const { rows: abertas } = await db.query<{ id: string; chave_playbook: string }>(
    `SELECT id, chave_playbook FROM tarefas WHERE organizacao_id = $1 AND chave_playbook LIKE 'astrea:%' AND status <> 'concluida'`, [organizacaoId]);
  const arquivar = (ids: string[], motivo: string) => ids.length
    ? db.query(`UPDATE tarefas SET status = 'concluida', concluida_em = now(), concluida_por = NULL, arquivada_em = now(), arquivada_motivo = $2, atualizado_em = now() WHERE id = ANY($1::uuid[])`, [ids, motivo]).then((r) => r.rowCount ?? 0)
    : Promise.resolve(0);
  // Só arquiva o que "sumiu" quando a carga tem corpo: agenda vazia é falha de exportação, não baixa geral.
  const cargaConfiavel = agenda.length >= 20;
  const arquivadasPodres = await arquivar(abertas.filter((t) => podres.has(t.chave_playbook)).map((t) => t.id), motivoPodre(diasPodre));
  const arquivadasSumidas = cargaConfiavel ? await arquivar(abertas.filter((t) => !podres.has(t.chave_playbook) && !vivas.has(t.chave_playbook)).map((t) => t.id), MOTIVO_SAIU) : 0;
  const resultado = { linhas: agenda.length, criadas, atualizadas, concluidas, arquivadasPodres, arquivadasSumidas, ignoradasPodres, diasPodre, semProjeto, semResponsavel, pessoasSemCadastro: [...pessoasSemCadastro] };
  await auditar(db, { organizacaoId, usuarioId, acao: 'controladoria.agenda_direcionada', entidade: 'organizacao', entidadeId: organizacaoId, depois: resultado });
  return resultado;
}
