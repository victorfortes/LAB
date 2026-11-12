/**
 * Conferência diária Astrea × Nexus.
 *
 * Duas perguntas, todo dia:
 *  1. Publicações: o que o Astrea recebeu, o Nexus também recebeu do DJEN? E o contrário?
 *  2. Prazos: o prazo que está no Astrea (base do BI de Prazos) existe no Nexus, com a mesma data?
 *
 * O casamento é pelo número do processo (só dígitos) e pela data, com folga de dias úteis entre
 * disponibilização (DJEN) e publicação (Astrea). O que não casa vira item para a controladoria olhar.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { auditar } from '../store/conexao.ts';

const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const isoDeBr = (d: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const diaFlex = z.string().trim().transform((v, c) => { const r = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : isoDeBr(v); if (!r) { c.addIssue({ code: 'custom', message: 'data em AAAA-MM-DD ou DD/MM/AAAA' }); return z.NEVER; } return r; });

export const EsquemaPublicacoesAstrea = z.object({
  publicacoes: z.array(z.object({
    data: diaFlex, numero: z.string().trim().max(60).default(''), tribunal: z.string().trim().max(60).optional(), orgao: z.string().trim().max(300).optional(),
    resumo: z.string().trim().max(4000).optional(), prazo: diaFlex.optional(),
  })).max(5000),
});

export async function receberPublicacoesAstrea(db: PoolClient, organizacaoId: string, d: z.infer<typeof EsquemaPublicacoesAstrea>, usuarioId: string) {
  let novas = 0;
  for (const p of d.publicacoes) {
    const chave = createHash('sha256').update(`${so(p.numero)}|${p.data}|${(p.resumo ?? '').slice(0, 300)}`).digest('hex').slice(0, 32);
    const r = await db.query(`INSERT INTO astrea_publicacoes (organizacao_id, data, numero, tribunal, orgao, resumo, prazo, chave) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organizacao_id, chave) DO NOTHING`,
      [organizacaoId, p.data, p.numero, p.tribunal ?? null, p.orgao ?? null, p.resumo ?? null, p.prazo ?? null, chave]);
    novas += r.rowCount ?? 0;
  }
  const dias = [...new Set(d.publicacoes.map((p) => p.data))].sort();
  for (const x of dias.slice(-10)) await conferirPublicacoes(db, organizacaoId, x);
  await auditar(db, { organizacaoId, usuarioId, acao: 'controladoria.astrea_publicacoes', entidade: 'organizacao', entidadeId: organizacaoId, depois: { recebidas: d.publicacoes.length, novas } });
  return { recebidas: d.publicacoes.length, novas, diasConferidos: dias.slice(-10) };
}

/** Casa as publicações de um dia do Astrea com as do DJEN no Nexus (disponibilização até 3 dias antes). */
export async function conferirPublicacoes(db: PoolClient, organizacaoId: string, d: string) {
  const { rows: astrea } = await db.query<{ id: string; numero: string; orgao: string | null; resumo: string | null; prazo: string | null }>(
    `SELECT id, numero, orgao, left(resumo, 240) AS resumo, prazo::text FROM astrea_publicacoes WHERE organizacao_id = $1 AND data = $2`, [organizacaoId, d]);
  const { rows: nexus } = await db.query<{ id: string; numero: string | null; orgao: string | null; tipo: string | null; data: string; situacao: string; processo_id: string | null }>(
    `SELECT id, numero_processo AS numero, orgao, tipo, data_disponibilizacao::text AS data, situacao, processo_id FROM publicacoes
      WHERE organizacao_id = $1 AND data_disponibilizacao BETWEEN ($2::date - 4) AND $2::date`, [organizacaoId, d]);
  const nexusPorNumero = new Map<string, typeof nexus>();
  for (const n of nexus) nexusPorNumero.set(so(n.numero), [...(nexusPorNumero.get(so(n.numero)) ?? []), n]);
  const usados = new Set<string>(); const soAstrea: typeof astrea = []; let emAmbos = 0;
  for (const a of astrea) {
    const cand = (nexusPorNumero.get(so(a.numero)) ?? []).find((n) => !usados.has(n.id));
    if (so(a.numero) && cand) { usados.add(cand.id); emAmbos++; } else soAstrea.push(a);
  }
  // Só no Nexus: publicação do próprio dia (ou da véspera) que o Astrea não trouxe.
  const soNexus = nexus.filter((n) => !usados.has(n.id) && n.data >= somar(d, -1));
  const detalhe = { soAstrea: soAstrea.slice(0, 200), soNexus: soNexus.slice(0, 200) };
  await db.query(`INSERT INTO conferencias_publicacoes (organizacao_id, dia, astrea, nexus, em_ambos, so_astrea, so_nexus, detalhe) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    ON CONFLICT (organizacao_id, dia) DO UPDATE SET astrea = EXCLUDED.astrea, nexus = EXCLUDED.nexus, em_ambos = EXCLUDED.em_ambos, so_astrea = EXCLUDED.so_astrea, so_nexus = EXCLUDED.so_nexus, detalhe = EXCLUDED.detalhe, criado_em = now()`,
    [organizacaoId, d, astrea.length, nexus.filter((n) => n.data >= somar(d, -1)).length, emAmbos, soAstrea.length, soNexus.length, JSON.stringify(detalhe)]);
  return { dia: d, astrea: astrea.length, emAmbos, soAstrea, soNexus };
}
const somar = (iso: string, n: number) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/**
 * Prazos: Astrea (base do BI) × Nexus (prazos abertos), na janela pedida.
 * Diferença de data é o caso mais perigoso: os dois sistemas dizem "tem prazo", mas em dias diferentes.
 */
export async function conferirPrazos(db: PoolClient, de: string, ate: string) {
  const { rows: astrea } = await db.query<{ numero: string; titulo: string; data: string; resp: string; caso: string; status: string }>(
    `SELECT numero, titulo, data, resp, caso, status FROM bi_agenda_linhas WHERE tipo = 'Prazo' AND status NOT ILIKE 'conclu%'`);
  const naJanela = astrea.map((a) => ({ ...a, iso: isoDeBr(a.data) })).filter((a) => a.iso && a.iso >= de && a.iso <= ate);
  const { rows: nexus } = await db.query<{ id: string; numero: string; titulo: string; vencimento: string; projeto: string | null }>(
    `SELECT z.id, p.numero, z.titulo, z.vencimento::text AS vencimento, pj.nome AS projeto FROM prazos z JOIN processos p ON p.id = z.processo_id LEFT JOIN projetos pj ON pj.id = p.projeto_id
      WHERE z.situacao = 'aberto' AND z.vencimento BETWEEN $1 AND $2`, [de, ate]);
  const porNumero = new Map<string, typeof nexus>();
  for (const n of nexus) porNumero.set(so(n.numero), [...(porNumero.get(so(n.numero)) ?? []), n]);
  const usados = new Set<string>();
  const iguais: unknown[] = []; const dataDiferente: unknown[] = []; const soAstrea: unknown[] = []; const semNumero: unknown[] = [];
  for (const a of naJanela) {
    const num = so(a.numero);
    if (!num) { semNumero.push(a); continue; }
    const lista = (porNumero.get(num) ?? []).filter((n) => !usados.has(n.id));
    const mesmo = lista.find((n) => n.vencimento === a.iso);
    if (mesmo) { usados.add(mesmo.id); iguais.push({ astrea: a, nexus: mesmo }); continue; }
    if (lista[0]) { usados.add(lista[0].id); dataDiferente.push({ astrea: a, nexus: lista[0] }); continue; }
    soAstrea.push(a);
  }
  const soNexus = nexus.filter((n) => !usados.has(n.id));
  const total = naJanela.length - semNumero.length;
  return {
    de, ate, astrea: naJanela.length, nexus: nexus.length, iguais: iguais.length,
    concordancia: total ? Math.round((iguais.length / total) * 1000) / 10 : null,
    dataDiferente, soAstrea, soNexus, semNumero: semNumero.length,
  };
}

export async function painel(db: PoolClient, organizacaoId: string, hoje: string) {
  const { rows: dias } = await db.query(`SELECT dia::text, astrea, nexus, em_ambos AS "emAmbos", so_astrea AS "soAstrea", so_nexus AS "soNexus", criado_em AS "conferidoEm" FROM conferencias_publicacoes ORDER BY dia DESC LIMIT 15`);
  const { rows: [ult] } = await db.query<{ recebido_em: Date | null }>('SELECT max(recebido_em) AS recebido_em FROM astrea_publicacoes');
  const { rows: [bi] } = await db.query<{ recebido_em: Date | null; total: number | null }>('SELECT recebido_em, total FROM bi_agenda_cargas ORDER BY recebido_em DESC LIMIT 1');
  const ultimoDia = (dias[0] as { dia?: string } | undefined)?.dia;
  const detalheDia = ultimoDia ? await conferirPublicacoes(db, organizacaoId, ultimoDia) : null;
  const prazos = await conferirPrazos(db, hoje, somar(hoje, 30));
  return { dias, detalheDia, prazos, ultimaCargaPublicacoes: ult?.recebido_em ?? null, ultimaCargaPrazos: bi?.recebido_em ?? null, basePrazos: bi?.total ?? 0 };
}
export { dia as EsquemaDia };
