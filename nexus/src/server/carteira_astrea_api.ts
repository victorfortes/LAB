/**
 * Carteira do Astrea lida pela API (extrator na página do Astrea → rotina diária → aqui).
 *
 * Substitui a planilha "Processos" como fonte do dia a dia: cada processo ativo é gravado/atualizado em
 * `astrea_registros` (chave `api:<id do caso>`) com o CNPJ/CPF do cliente tirado da ficha do contato.
 * Quem sumiu da lista ativa fica com `ativo_no_astrea = false` (não apaga nada).
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';

const t = (max: number) => z.preprocess((v) => (v === null || v === undefined ? '' : String(v)), z.string().trim().max(max));
export const EsquemaCarteira = z.object({
  casos: z.array(z.object({
    id: z.string().trim().min(1).max(40), numero: t(60), titulo: t(1000), cliente: t(500), clienteId: t(40), vara: t(300), acao: t(300), descricao: t(500),
    valor: z.number().nullable().optional(), pasta: t(60), tipo: t(40),
  })).max(20_000),
  clientes: z.record(z.string(), z.object({ nome: t(500), doc: t(30).nullable().optional(), tipo: t(20).nullable().optional() }).nullable()).default({}),
});

const lote = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

export async function receberCarteira(db: PoolClient, org: string, d: z.infer<typeof EsquemaCarteira>, usuarioId: string) {
  const linhas = d.casos.map((c) => {
    const ficha = c.clienteId ? d.clientes[c.clienteId] : null;
    const doc = (ficha?.doc ?? '').replace(/\D/g, '') || (/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/.exec(c.cliente)?.[1] ?? '').replace(/\D/g, '');
    return { chave: `api:${c.id}`, tipo: c.tipo === 'CTE_LAWSUIT' ? 'Processo' : c.tipo === 'CTE_CASE' ? 'Caso' : (c.tipo || 'Processo'), titulo: c.titulo || null,
      cn: (ficha?.nome || c.cliente.replace(/\s*-\s*(CNPJ\s*)?\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s*$/i, '')).slice(0, 500) || null, no: c.numero || null,
      acao: [c.acao, c.descricao].filter(Boolean).join(' · ').slice(0, 300) || null, pasta: c.pasta || null, vara: c.vara || null,
      v: typeof c.valor === 'number' ? Math.round(c.valor * 100) : null, doc: doc.length === 14 || doc.length === 11 ? doc : null, cid: c.clienteId || null };
  });
  let gravados = 0;
  for (const b of lote(linhas, 500)) {
    gravados += (await db.query(
      `INSERT INTO astrea_registros (organizacao_id, chave, tipo, titulo, cliente_nome, numero_original, acao, pasta, vara, valor_causa, cliente_documento, astrea_cliente_id, ativo_no_astrea, lido_api_em)
       SELECT $1, x.chave, x.tipo, x.titulo, x.cn, x.no, x.acao, x.pasta, x.vara, x.v, x.doc, x.cid, true, now()
         FROM jsonb_to_recordset($2::jsonb) AS x(chave text, tipo text, titulo text, cn text, no text, acao text, pasta text, vara text, v bigint, doc text, cid text)
       ON CONFLICT (organizacao_id, chave) DO UPDATE SET titulo = EXCLUDED.titulo, cliente_nome = EXCLUDED.cliente_nome, numero_original = EXCLUDED.numero_original,
         acao = EXCLUDED.acao, pasta = EXCLUDED.pasta, vara = EXCLUDED.vara, valor_causa = EXCLUDED.valor_causa, cliente_documento = coalesce(EXCLUDED.cliente_documento, astrea_registros.cliente_documento),
         astrea_cliente_id = EXCLUDED.astrea_cliente_id, ativo_no_astrea = true, lido_api_em = now()`,
      [org, JSON.stringify(b)])).rowCount ?? 0;
  }
  // Carga com corpo (≥ 500 casos): o que não veio deixou de estar ativo no Astrea.
  const inativados = d.casos.length >= 500 ? (await db.query(
    `UPDATE astrea_registros SET ativo_no_astrea = false WHERE organizacao_id = $1 AND chave LIKE 'api:%' AND ativo_no_astrea AND NOT (chave = ANY($2::text[]))`,
    [org, linhas.map((l) => l.chave)])).rowCount ?? 0 : 0;
  const comDoc = linhas.filter((l) => l.doc?.length === 14).length;
  const resultado = { casos: d.casos.length, gravados, inativados, comCnpj: comDoc, clientes: Object.keys(d.clientes).length };
  await auditar(db, { organizacaoId: org, usuarioId, acao: 'astrea.carteira_api', entidade: 'organizacao', entidadeId: org, depois: resultado });
  return resultado;
}
