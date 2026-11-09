/**
 * Coleta diária do Radar Concursal: uma página do DJEN por execução, entregue ao site do Radar.
 * O site do Radar é outro sistema: quem autoriza a entrega é o segredo dele (DJEN_INGEST_SECRET).
 */
import type { Banco } from '../store/conexao.ts';
import { CONSULTAS_DESCOBERTA, descobrirNoDjen } from './radar_djen.ts';

const URL_RADAR = 'https://judy-track-pro.lovable.app/api/public/cron/djen-ingest';
const DIAS = 3; const MAX_PAGINAS = 10;
export interface Estado { indice: number; pagina: number; concluido: boolean }

export async function rotinaRadar(banco: Banco, segredo: string | undefined, opcoes: { fetch?: typeof fetch; agora?: Date } = {}) {
  if (!segredo) throw new Error('falta o segredo DJEN_INGEST_SECRET na função');
  const f = opcoes.fetch ?? fetch; const ate = opcoes.agora ?? new Date(); const dia = ate.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const e = await banco.semContexto(async (db) => (await db.query<{ r: string }>('SELECT (radar_estado($1)).* ', [dia])).rows[0] as unknown as Estado);
  if (e.concluido || e.indice >= CONSULTAS_DESCOBERTA.length) return 'concluído';
  const desde = new Date(ate.getTime() - DIAS * 86_400_000);
  const r = await descobrirNoDjen(desde, ate, { fetchImpl: f, consultas: [CONSULTAS_DESCOBERTA[e.indice]!], paginaInicial: e.pagina, maxPaginas: e.pagina });
  if (r.erros.length) { await banco.semContexto((db) => db.query('SELECT radar_avancar($1,$2,$3,0,false,$4)', [dia, e.indice, e.pagina, r.erros.join('; ')])); throw new Error(r.erros[0]); }
  for (let i = 0; i < r.publicacoes.length; i += 40) {
    const resp = await f(URL_RADAR, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${segredo}` }, body: JSON.stringify({ publicacoes: r.publicacoes.slice(i, i + 40) }), signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`Radar recusou a entrega: HTTP ${resp.status}`);
  }
  const mais = e.pagina * 100 < r.totalApi && e.pagina < MAX_PAGINAS;
  const indice = mais ? e.indice : e.indice + 1; const pagina = mais ? e.pagina + 1 : 1;
  await banco.semContexto((db) => db.query('SELECT radar_avancar($1,$2,$3,$4,$5,NULL)', [dia, indice, pagina, r.publicacoes.length, indice >= CONSULTAS_DESCOBERTA.length]));
  return `${r.publicacoes.length} publicação(ões)`;
}
