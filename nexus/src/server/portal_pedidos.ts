/**
 * Pedido avulso de documento e contatos do cliente.
 *
 * O checklist do portal tem duas fontes: o MODELO do procedimento ("Gerar do modelo") e os PEDIDOS do advogado
 * ("preciso do comprovante de residência do sócio"). O pedido vira, na hora: item pendente no checklist do portal,
 * aviso no topo do portal e e-mail para o e-mail pessoal de cada pessoa do cliente (ou o de login, se não houver).
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import * as email from './email.ts';

const URL_PORTAL = () => process.env.NGA_URL_PUBLICA ?? 'https://nga-lab.lovable.app';
const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const EsquemaPedido = z.object({
  titulo: z.string().trim().min(3).max(300),
  detalhe: z.string().trim().max(2000).nullable().optional(),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  categoria: z.string().trim().min(2).max(80).default('Pedidos do advogado'),
  obrigatorio: z.boolean().default(true),
  avisarPorEmail: z.boolean().default(true),
});
export const EsquemaContato = z.object({
  emailPessoal: z.string().trim().email().max(200).nullable(),
  telefone: z.string().trim().max(40).nullable().optional(),
  avisarPorEmail: z.boolean().default(true),
});

/** Pessoas do portal do projeto, com o e-mail para aviso (pessoal, se houver). */
export async function destinatarios(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<{ usuario_id: string | null; usuario_nome: string | null; usuario_email: string | null }>('SELECT usuario_id, usuario_nome, usuario_email FROM portal_do_projeto($1)', [projetoId]);
  const { rows: cont } = await db.query<{ usuario_id: string; email_pessoal: string | null; telefone: string | null; avisar_por_email: boolean }>(
    'SELECT usuario_id, email_pessoal, telefone, avisar_por_email FROM contatos_cliente WHERE projeto_id = $1', [projetoId]);
  const porUsuario = new Map(cont.map((c) => [c.usuario_id, c]));
  return rows.filter((r) => r.usuario_id).map((r) => {
    const c = porUsuario.get(r.usuario_id!);
    return { id: r.usuario_id!, nome: r.usuario_nome, emailLogin: r.usuario_email, emailPessoal: c?.email_pessoal ?? null, telefone: c?.telefone ?? null,
      avisarPorEmail: c?.avisar_por_email ?? true, emailAviso: c?.avisar_por_email === false ? null : (c?.email_pessoal ?? r.usuario_email) };
  });
}

export async function salvarContato(db: PoolClient, projetoId: string, usuarioId: string, d: z.infer<typeof EsquemaContato>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  if (!rows[0]) throw new NaoEncontrado('projeto não encontrado');
  if (!(await destinatarios(db, projetoId)).some((x) => x.id === usuarioId)) throw new PedidoInvalido('esta pessoa não tem acesso ao portal deste projeto');
  await db.query(`INSERT INTO contatos_cliente (organizacao_id, projeto_id, usuario_id, email_pessoal, telefone, avisar_por_email, atualizado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (projeto_id, usuario_id) DO UPDATE SET email_pessoal = EXCLUDED.email_pessoal, telefone = EXCLUDED.telefone, avisar_por_email = EXCLUDED.avisar_por_email, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
    [rows[0].organizacao_id, projetoId, usuarioId, d.emailPessoal, d.telefone ?? null, d.avisarPorEmail, i.usuarioId]);
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'portal.contato_atualizado', entidade: 'projeto', entidadeId: projetoId, depois: { usuario: usuarioId, temEmailPessoal: !!d.emailPessoal } });
  return { ok: true };
}

export async function pedirDocumento(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaPedido>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; nome: string }>('SELECT organizacao_id, nome FROM projetos WHERE id = $1', [projetoId]);
  const p = rows[0]; if (!p) throw new NaoEncontrado('projeto não encontrado');
  const { rows: [r] } = await db.query<{ id: string }>(
    `INSERT INTO requisitos (organizacao_id, projeto_id, categoria, titulo, fundamento, obrigatorio, ordem, origem, pedido_por, pedido_em, prazo, detalhe)
     VALUES ($1,$2,$3,$4,$5,$6, coalesce((SELECT max(ordem) + 1 FROM requisitos WHERE projeto_id = $2), 0), 'pedido', $7, now(), $8, $9) RETURNING id`,
    [p.organizacao_id, projetoId, d.categoria, d.titulo, `Solicitado por ${i.nome ?? 'advogado(a) do caso'}${d.prazo ? `, até ${dataBr(d.prazo)}` : ''}.`, d.obrigatorio, i.usuarioId, d.prazo ?? null, d.detalhe ?? null]);
  // Aviso no topo do portal (já publicado: é pedido do escritório, não notícia de terceiro).
  await db.query(`INSERT INTO portal_avisos (organizacao_id, projeto_id, origem, chave, titulo, texto, dados, situacao, publicado_em, publicado_por)
    VALUES ($1,$2,'manual',$3,$4,$5,$6,'publicado',now(),$7) ON CONFLICT (projeto_id, chave) DO NOTHING`,
    [p.organizacao_id, projetoId, `pedido:${r!.id}`, `Novo documento solicitado: ${d.titulo}`.slice(0, 300),
     `${d.detalhe ? `${d.detalhe} ` : ''}${d.prazo ? `Prazo: ${dataBr(d.prazo)}. ` : ''}Envie pelo checklist de documentos do portal.`.slice(0, 4000), JSON.stringify({ requisitoId: r!.id }), i.usuarioId]);
  let emails = { enfileirados: 0, para: [] as string[] };
  if (d.avisarPorEmail) {
    const para = (await destinatarios(db, projetoId)).map((x) => x.emailAviso).filter((x): x is string => !!x);
    emails = await email.enfileirar(db, { organizacaoId: p.organizacao_id, projetoId, para, motivo: 'pedido_documento', criadoPor: i.usuarioId,
      assunto: `Documento solicitado pela NGA: ${d.titulo}`,
      html: email.modelo('O escritório precisa de um documento', [
        `Para dar andamento ao seu caso (<b>${esc(p.nome)}</b>), precisamos de: <b>${esc(d.titulo)}</b>.`,
        ...(d.detalhe ? [esc(d.detalhe)] : []),
        ...(d.prazo ? [`Prazo para envio: <b>${dataBr(d.prazo)}</b>.`] : []),
        'Envie pelo portal do cliente, no checklist de documentos. O pedido já aparece lá como pendência.',
      ], { texto: 'Abrir o portal', url: URL_PORTAL() }) });
  }
  await auditar(db, { organizacaoId: p.organizacao_id, usuarioId: i.usuarioId, acao: 'checklist.pedido_avulso', entidade: 'projeto', entidadeId: projetoId, depois: { titulo: d.titulo, prazo: d.prazo ?? null, emails: emails.para.length } });
  return { id: r!.id, emails: emails.para, envioConfigurado: email.provedorConfigurado() };
}
