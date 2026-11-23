/**
 * Boas-vindas do portal do cliente: no primeiro acesso, os manuais são de leitura obrigatória (rolar até o fim de
 * cada um), seguidos do vídeo de 1 minuto e dos contatos oficiais. A leitura fica registrada por pessoa; os manuais
 * continuam disponíveis na aba "Manuais". Mudou o manual (versão nova)? Ele volta a ser pedido.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Identidade } from '../security/sessao.ts';
import { auditar } from '../store/conexao.ts';

/** Chave e versão de cada manual (o conteúdo fica em web/js/manuais.js). Subir a versão pede nova leitura. */
export const MANUAIS = [
  { chave: 'portal', versao: 1 }, { chave: 'documentos', versao: 1 }, { chave: 'sigilo', versao: 1 }, { chave: 'comunicacao', versao: 1 }, { chave: 'video', versao: 1 },
] as const;
export const EsquemaLeitura = z.object({ chave: z.enum(MANUAIS.map((m) => m.chave) as [string, ...string[]]) });
const Contato = z.object({ tipo: z.enum(['telefone', 'whatsapp', 'email', 'site', 'endereco', 'horario']), rotulo: z.string().trim().min(2).max(80), valor: z.string().trim().min(2).max(200) });
export const EsquemaConfig = z.object({ contatos: z.array(Contato).max(12), videoUrl: z.string().trim().regex(/^(https:\/\/|\/)/).max(500).nullable().optional() });

const PADRAO = [
  { tipo: 'site', rotulo: 'Site do escritório', valor: 'https://nga.adv.br' },
  { tipo: 'horario', rotulo: 'Atendimento', valor: 'Dias úteis, das 9h às 18h' },
];

export async function estado(db: PoolClient, i: Identidade) {
  const { rows } = await db.query<{ chave: string; versao: number; lido_em: Date }>('SELECT chave, versao, lido_em FROM portal_leituras WHERE usuario_id = $1', [i.usuarioId]);
  const lido = new Map(rows.map((r) => [r.chave, r]));
  const { rows: [cfg] } = await db.query<{ contatos: unknown[]; video_url: string | null }>('SELECT * FROM portal_contatos_oficiais()');
  const manuais = MANUAIS.map((m) => ({ chave: m.chave, lido: (lido.get(m.chave)?.versao ?? 0) >= m.versao, lidoEm: lido.get(m.chave)?.lido_em ?? null }));
  return { pendente: manuais.some((m) => !m.lido), manuais, contatos: cfg?.contatos?.length ? cfg.contatos : PADRAO, videoUrl: cfg?.video_url ?? '/video/boas-vindas.webm?v=2311' };
}

export async function registrarLeitura(db: PoolClient, d: z.infer<typeof EsquemaLeitura>, i: Identidade) {
  const versao = MANUAIS.find((m) => m.chave === d.chave)!.versao;
  await db.query(`INSERT INTO portal_leituras (usuario_id, chave, versao) VALUES ($1,$2,$3) ON CONFLICT (usuario_id, chave) DO UPDATE SET versao = EXCLUDED.versao, lido_em = now()`, [i.usuarioId, d.chave, versao]);
  return { ok: true };
}

export async function salvarConfig(db: PoolClient, d: z.infer<typeof EsquemaConfig>, i: Identidade) {
  const org = i.organizacoes.find((o) => o.tipo === 'escritorio')?.id; if (!org) throw new Error('só o escritório configura');
  await db.query(`INSERT INTO portal_config (organizacao_id, contatos, video_url) VALUES ($1,$2,$3) ON CONFLICT (organizacao_id) DO UPDATE SET contatos = EXCLUDED.contatos, video_url = EXCLUDED.video_url, atualizado_em = now()`,
    [org, JSON.stringify(d.contatos), d.videoUrl ?? null]);
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'portal.contatos_oficiais', entidade: 'organizacao', entidadeId: org, depois: { contatos: d.contatos.length } });
  return { ok: true };
}
