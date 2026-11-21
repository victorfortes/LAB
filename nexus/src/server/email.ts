/**
 * E-mail de saída do escritório. Tudo passa pela fila `emails_saida`: assim nenhum aviso se perde e a tela
 * pode dizer a verdade ("enviado", "aguardando envio", "falhou").
 *
 * Provedor: Microsoft 365 do escritório (Microsoft Graph, permissão de aplicativo Mail.Send), configurado por
 * NGA_EMAIL_TENANT, NGA_EMAIL_CLIENT_ID, NGA_EMAIL_SEGREDO e NGA_EMAIL_REMETENTE (a caixa que envia).
 * Sem essas variáveis o e-mail fica na fila e a rotina envia quando o provedor existir. Nunca fingimos envio.
 */
import type { PoolClient } from 'pg';
import type { Banco } from '../store/conexao.ts';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function provedorConfigurado() {
  return !!(process.env.NGA_EMAIL_TENANT && process.env.NGA_EMAIL_CLIENT_ID && process.env.NGA_EMAIL_SEGREDO && process.env.NGA_EMAIL_REMETENTE);
}

/** Modelo visual único dos e-mails do escritório (sério, sem imagens externas). */
export function modelo(titulo: string, paragrafos: string[], botao?: { texto: string; url: string }) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#14213a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e8f0">
<tr><td style="background:#0e1a2e;padding:18px 24px;color:#fff;font-size:18px;font-weight:bold;letter-spacing:1px">NGA <span style="color:#F0A32E;font-size:11px;letter-spacing:4px">ADVOGADOS</span></td></tr>
<tr><td style="padding:24px"><h1 style="font-size:19px;margin:0 0 14px">${esc(titulo)}</h1>
${paragrafos.map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px">${p}</p>`).join('')}
${botao ? `<p style="margin:20px 0 6px"><a href="${esc(botao.url)}" style="background:#F0A32E;color:#14213a;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px;display:inline-block">${esc(botao.texto)}</a></p>` : ''}
</td></tr><tr><td style="padding:14px 24px;background:#f7f9fc;color:#6b7a90;font-size:12px">Mensagem automática do portal do cliente NGA. Em caso de dúvida, responda pelo grupo do seu caso ou pelos contatos oficiais do escritório.</td></tr>
</table></td></tr></table></body></html>`;
}

export async function enfileirar(db: PoolClient, e: { organizacaoId: string; projetoId?: string | null; para: string[]; assunto: string; html: string; motivo?: string; criadoPor?: string | null }) {
  const para = [...new Set(e.para.map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
  if (!para.length) return { enfileirados: 0, para: [] as string[] };
  await db.query(`INSERT INTO emails_saida (organizacao_id, projeto_id, para, assunto, corpo_html, motivo, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [e.organizacaoId, e.projetoId ?? null, para.join(', ').slice(0, 400), e.assunto.slice(0, 300), e.html, e.motivo ?? null, e.criadoPor ?? null]);
  return { enfileirados: 1, para };
}

let tokenCache: { valor: string; ate: number } | null = null;
async function tokenGraph(buscar: typeof fetch) {
  if (tokenCache && tokenCache.ate > Date.now() + 60_000) return tokenCache.valor;
  const r = await buscar(`https://login.microsoftonline.com/${encodeURIComponent(process.env.NGA_EMAIL_TENANT!)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({ client_id: process.env.NGA_EMAIL_CLIENT_ID!, client_secret: process.env.NGA_EMAIL_SEGREDO!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  if (!r.ok) throw new Error(`Microsoft recusou a credencial do envio (HTTP ${r.status})`);
  const j = await r.json() as { access_token: string; expires_in: number };
  tokenCache = { valor: j.access_token, ate: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

/** Rotina (sem sessão): envia os pendentes pela conta Microsoft do escritório. */
export async function rotinaEmails(banco: Banco, opcoes: { fetch?: typeof fetch } = {}) {
  if (!provedorConfigurado()) return { enviados: 0, motivo: 'envio de e-mail não configurado (NGA_EMAIL_*)' };
  const buscar = opcoes.fetch ?? fetch;
  return banco.semContexto(async (db) => {
    const { rows } = await db.query<{ id: string; para: string; assunto: string; corpo_html: string }>('SELECT * FROM emails_pendentes(20)');
    let enviados = 0; const erros: string[] = [];
    for (const m of rows) {
      try {
        const token = await tokenGraph(buscar);
        const r = await buscar(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.NGA_EMAIL_REMETENTE!)}/sendMail`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(25_000),
          body: JSON.stringify({ message: { subject: m.assunto, body: { contentType: 'HTML', content: m.corpo_html }, toRecipients: m.para.split(',').map((x) => ({ emailAddress: { address: x.trim() } })) }, saveToSentItems: true }),
        });
        if (!r.ok) throw new Error(`Microsoft Graph HTTP ${r.status}`);
        await db.query('SELECT email_resultado($1, TRUE, NULL)', [m.id]); enviados++;
      } catch (e) { erros.push((e as Error).message); await db.query('SELECT email_resultado($1, FALSE, $2)', [m.id, (e as Error).message]); }
    }
    return { enviados, pendentes: rows.length - enviados, erros };
  });
}
