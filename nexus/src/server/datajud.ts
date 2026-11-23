/**
 * Cliente único da API pública do DataJud (CNJ), usado pelos andamentos e pelo Sentinela.
 *
 * O que aprendemos em produção (21/11/2026): a API responde em 30 a 45 s e, quando o Elasticsearch do CNJ
 * está cheio, ela (a) devolve HTTP 429 `es_rejected_execution_exception` ou (b) devolve HTTP 200 com parte
 * dos shards recusados (`_shards.failed` > 0). No caso (b) o processo pode estar justamente num shard que
 * falhou: "não veio" NÃO quer dizer "não existe". Tratar isso como "não encontrado" (como antes) deixava
 * ~1.500 processos marcados errado e a fila castigava o processo pelo erro do DataJud.
 *
 * Regras daqui:
 *  - uma chamada por tribunal, com vários números (`terms`), nunca chamadas em paralelo;
 *  - 429/5xx/tempo esgotado = instabilidade do DataJud: tenta de novo (até 2 vezes, com espera) e, se
 *    persistir, devolve `instavel` para a fila reagendar SEM contar falha do processo;
 *  - shards recusados = resposta incompleta: o que veio vale; o que não veio fica "inconclusivo";
 *  - pausa por tribunal (em memória e no banco) para o Sentinela e os andamentos não insistirem juntos.
 */
import type { PoolClient } from 'pg';
/** Chave pública divulgada pelo CNJ em datajud-wiki.cnj.jus.br/api-publica/acesso. */
export const CHAVE_DATAJUD = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

export const URL_DATAJUD = (alias: string) => `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`;
export const soDigitos = (s: string) => String(s ?? '').replace(/\D/g, '');

export type Hit = { _source: Record<string, any> };
export type RespostaDataJud =
  | { tipo: 'ok'; porNumero: Map<string, Hit[]>; incompleto: boolean; shardsFalhos: number; ms: number }
  | { tipo: 'instavel'; motivo: string; ms: number }
  | { tipo: 'erro'; motivo: string; ms: number };

const pausaLocal = new Map<string, number>();
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tribunal em pausa? Consulta a memória e, se houver banco, a tabela `datajud_pausas` (compartilhada entre execuções). */
export async function emPausa(alias: string, db?: PoolClient | null): Promise<boolean> {
  if ((pausaLocal.get(alias) ?? 0) > Date.now()) return true;
  if (!db) return false;
  const { rows } = await db.query<{ ate: Date }>('SELECT ate FROM datajud_pausas WHERE indice = $1 AND ate > now()', [alias]).catch(() => ({ rows: [] as { ate: Date }[] }));
  if (rows[0]) { pausaLocal.set(alias, new Date(rows[0].ate).getTime()); return true; }
  return false;
}
export async function pausar(alias: string, minutos: number, motivo: string, db?: PoolClient | null) {
  pausaLocal.set(alias, Date.now() + minutos * 60_000);
  // Pausa crescente: se o tribunal recusa de novo logo após a última pausa, a próxima dobra (até 2 h).
  // Sem isso o LAB voltava a bater no TJPR a cada 10-15 min e levava 429 o dia inteiro.
  if (db) {
    const { rows } = await db.query<{ ate: Date }>(`INSERT INTO datajud_pausas (indice, ate, motivo, vezes) VALUES ($1, now() + make_interval(mins => $2), $3, 1)
      ON CONFLICT (indice) DO UPDATE SET
        vezes = CASE WHEN datajud_pausas.ate > now() - interval '45 minutes' THEN datajud_pausas.vezes + 1 ELSE 1 END,
        ate = now() + make_interval(mins => least($2 * power(2, CASE WHEN datajud_pausas.ate > now() - interval '45 minutes' THEN least(datajud_pausas.vezes, 4) ELSE 0 END)::int, 120)),
        motivo = EXCLUDED.motivo
      RETURNING ate`, [alias, minutos, motivo.slice(0, 300)]).catch(() => ({ rows: [] as { ate: Date }[] }));
    if (rows[0]) pausaLocal.set(alias, new Date(rows[0].ate).getTime());
  }
}

export interface OpcoesConsulta {
  campos: string[];
  buscar?: typeof fetch;
  /** Tempo máximo de cada chamada (o DataJud costuma levar 30 a 45 s). */
  timeoutMs?: number;
  /** Quantas vezes repetir em 429/5xx/tempo esgotado. */
  tentativas?: number;
  /** Não começar nova tentativa depois deste instante (ms desde epoch). */
  limite?: number;
  /** Espera entre tentativas (ms). Testes passam 0. */
  pausaEntreTentativas?: number;
}

/** Uma consulta `terms` por número, com repetição e leitura honesta de shards falhos. */
export async function consultar(alias: string, numeros: readonly string[], o: OpcoesConsulta): Promise<RespostaDataJud> {
  const buscar = o.buscar ?? fetch; const inicio = Date.now();
  const tentativas = o.tentativas ?? 2; const timeoutMs = o.timeoutMs ?? 55_000;
  let ultimo = '';
  for (let t = 0; t <= tentativas; t++) {
    if (t > 0) {
      const p = (o.pausaEntreTentativas ?? 6_000) * t;
      if (o.limite && Date.now() + p + 20_000 > o.limite) break;
      await espera(p);
    }
    try {
      const r = await buscar(URL_DATAJUD(alias), {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `APIKey ${CHAVE_DATAJUD}`, 'content-type': 'application/json' },
        body: JSON.stringify({ size: Math.min(1000, numeros.length * 4), _source: o.campos, query: { terms: { numeroProcesso: numeros.map(soDigitos) } } }),
      });
      if (r.status === 429 || r.status >= 500) { ultimo = `DataJud ${alias} sobrecarregado (HTTP ${r.status})`; continue; }
      if (!r.ok) return { tipo: 'erro', motivo: `DataJud ${alias} recusou a consulta (HTTP ${r.status})`, ms: Date.now() - inicio };
      const d = await r.json() as { _shards?: { total?: number; failed?: number }; hits?: { hits?: Hit[] } };
      const porNumero = new Map<string, Hit[]>();
      for (const h of d.hits?.hits ?? []) { const k = soDigitos(String(h._source?.numeroProcesso ?? '')); porNumero.set(k, [...(porNumero.get(k) ?? []), h]); }
      const shardsFalhos = Number(d._shards?.failed ?? 0);
      // Todos os shards falharam e nada veio: é instabilidade, não ausência.
      if (shardsFalhos > 0 && shardsFalhos >= Number(d._shards?.total ?? 1) && porNumero.size === 0) { ultimo = `DataJud ${alias} sem shards disponíveis`; continue; }
      return { tipo: 'ok', porNumero, incompleto: shardsFalhos > 0, shardsFalhos, ms: Date.now() - inicio };
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      ultimo = /timed? ?out|abort/i.test(m) ? `DataJud ${alias} não respondeu em ${Math.round(timeoutMs / 1000)} s` : `DataJud ${alias} fora do ar (${m.slice(0, 80)})`;
    }
  }
  return { tipo: 'instavel', motivo: ultimo || `DataJud ${alias} instável`, ms: Date.now() - inicio };
}
