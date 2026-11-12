/**
 * Slack do escritório dentro do Nexus.
 *
 * 1. App do Slack (client id/secret) guardado cifrado no cofre, pela administração.
 * 2. Cada pessoa conecta o PRÓPRIO Slack (OAuth v2, escopos de usuário): a aba Slack lê e envia com o token dela.
 *    O Slack não deixa ser aberto dentro de outro site (bloqueia iframe), então a aba é um cliente próprio:
 *    conversas, mensagens e envio, pela API oficial.
 * 3. O token do bot (vem na primeira conexão da administração) manda os avisos automáticos: prazos, tarefas,
 *    reuniões e novas ações do Sentinela, por mensagem direta ao responsável e/ou num canal.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { Banco } from '../store/conexao.ts';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { cifrar, decifrar } from './cofre.ts';

export const ESCOPOS_BOT = ['chat:write', 'chat:write.public', 'users:read', 'users:read.email', 'channels:read', 'groups:read', 'im:write'];
export const ESCOPOS_USUARIO = ['channels:read', 'channels:history', 'groups:read', 'groups:history', 'im:read', 'im:history', 'mpim:read', 'mpim:history', 'users:read', 'chat:write'];
export const EQUIPE_NGA = 'T0B6U2U040K';

type Buscar = typeof fetch;
async function slackApi(token: string, metodo: string, params: Record<string, string | number | boolean | undefined> = {}, buscar: Buscar = fetch, post = false) {
  const limpo = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  const r = await buscar(`https://slack.com/api/${metodo}${post ? '' : `?${new URLSearchParams(limpo)}`}`, {
    method: post ? 'POST' : 'GET', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${token}`, ...(post ? { 'content-type': 'application/json; charset=utf-8' } : {}) },
    ...(post ? { body: JSON.stringify(params) } : {}),
  });
  const d = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) as Record<string, any>;
  if (!d.ok) throw new PedidoInvalido(`Slack recusou ${metodo}: ${d.error ?? 'erro desconhecido'}`);
  return d;
}

const orgDe = (i: Identidade) => { const o = i.organizacoes.find((x) => x.tipo === 'escritorio')?.id; if (!o) throw new PedidoInvalido('só a equipe do escritório usa o Slack'); return o; };

// ------------------------------------------------------------------ configuração ---
export const EsquemaApp = z.object({ clientId: z.string().trim().regex(/^\d+\.\d+$/, 'Client ID no formato 123.456'), clientSecret: z.string().trim().min(16).max(200) });
export async function salvarApp(db: PoolClient, d: z.infer<typeof EsquemaApp>, segredo: string, i: Identidade) {
  const org = i.organizacoes.find((o) => o.tipo === 'escritorio' && o.papel === 'socio_administrador')?.id;
  if (!org) throw new PedidoInvalido('só a administração configura o app do Slack');
  await db.query(`INSERT INTO cofre_credenciais (organizacao_id, servico, usuario, segredo, atualizado_por) VALUES ($1,'slack_app',$2,$3,$4)
    ON CONFLICT (organizacao_id, servico) DO UPDATE SET usuario = EXCLUDED.usuario, segredo = EXCLUDED.segredo, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
    [org, d.clientId, cifrar(d.clientSecret, segredo), i.usuarioId]);
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'slack.app_configurado', entidade: 'organizacao', entidadeId: org });
  return { ok: true };
}

export async function estado(db: PoolClient, i: Identidade) {
  const { rows: cof } = await db.query<{ servico: string; usuario: string; atualizado_em: Date }>(`SELECT servico, usuario, atualizado_em FROM cofre_credenciais WHERE servico IN ('slack_app','slack_bot')`);
  const { rows: [eu] } = await db.query<{ slack_user_id: string; team_nome: string | null; conectado_em: Date }>('SELECT slack_user_id, team_nome, conectado_em FROM slack_usuarios WHERE usuario_id = $1', [i.usuarioId]);
  const { rows: [n] } = await db.query<{ n: number }>('SELECT count(*)::int n FROM slack_usuarios');
  return {
    appConfigurado: cof.some((c) => c.servico === 'slack_app'), clientId: cof.find((c) => c.servico === 'slack_app')?.usuario ?? null,
    botConectado: cof.some((c) => c.servico === 'slack_bot'), equipe: cof.find((c) => c.servico === 'slack_bot')?.usuario ?? null,
    euConectado: !!eu, eu: eu ? { slackUserId: eu.slack_user_id, equipe: eu.team_nome, desde: eu.conectado_em } : null,
    pessoasConectadas: n?.n ?? 0, linkWeb: `https://app.slack.com/client/${EQUIPE_NGA}`,
  };
}

const ORIGENS = /^https:\/\/([a-z0-9-]+\.)*(lovable\.app|nga\.adv\.br)$|^http:\/\/localhost(:\d+)?$/;
/** Endereço de autorização do Slack. O retorno vem para `${origem}/api/slack/callback`. */
export async function conectar(db: PoolClient, origem: string, segredo: string, i: Identidade) {
  if (!ORIGENS.test(origem)) throw new PedidoInvalido('origem não autorizada para o retorno do Slack');
  const org = orgDe(i);
  const { rows: [app] } = await db.query<{ usuario: string }>(`SELECT usuario FROM cofre_credenciais WHERE servico = 'slack_app'`);
  if (!app) throw new PedidoInvalido('o app do Slack ainda não foi configurado em Ajustes → Slack');
  void segredo;
  const estado = randomBytes(24).toString('base64url'); const redirect = `${origem}/api/slack/callback`;
  await db.query('DELETE FROM slack_oauth_estados WHERE criado_em < now() - interval \'10 minutes\' OR usuario_id = $1', [i.usuarioId]);
  await db.query('INSERT INTO slack_oauth_estados (estado, usuario_id, organizacao_id, redirect_uri) VALUES ($1,$2,$3,$4)', [estado, i.usuarioId, org, redirect]);
  const admin = i.organizacoes.some((o) => o.tipo === 'escritorio' && o.papel === 'socio_administrador');
  const q = new URLSearchParams({ client_id: app.usuario, user_scope: ESCOPOS_USUARIO.join(','), redirect_uri: redirect, state: estado, team: EQUIPE_NGA });
  // Só a administração instala o bot (escopos de bot); os demais conectam só a própria conta.
  if (admin) q.set('scope', ESCOPOS_BOT.join(','));
  return { url: `https://slack.com/oauth/v2/authorize?${q}` };
}

export const EsquemaConclusao = z.object({ code: z.string().min(5).max(4096), state: z.string().min(10).max(256) });
export async function concluir(db: PoolClient, d: z.infer<typeof EsquemaConclusao>, segredo: string, i: Identidade, buscar: Buscar = fetch) {
  const { rows: [e] } = await db.query<{ organizacao_id: string; redirect_uri: string }>(`DELETE FROM slack_oauth_estados WHERE estado = $1 AND usuario_id = $2 AND criado_em > now() - interval '10 minutes' RETURNING organizacao_id, redirect_uri`, [d.state, i.usuarioId]);
  if (!e) throw new PedidoInvalido('a autorização expirou ou não é desta sessão; conecte de novo');
  const { rows: [app] } = await db.query<{ usuario: string; segredo: string }>(`SELECT usuario, segredo FROM cofre_credenciais WHERE servico = 'slack_app'`);
  if (!app) throw new PedidoInvalido('o app do Slack não está configurado');
  const r = await buscar('https://slack.com/api/oauth.v2.access', { method: 'POST', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: app.usuario, client_secret: decifrar(app.segredo, segredo), code: d.code, redirect_uri: e.redirect_uri }) });
  const t = await r.json() as Record<string, any>;
  if (!t.ok) throw new PedidoInvalido(`o Slack recusou a conexão: ${t.error}`);
  const user = t.authed_user ?? {};
  if (!user.access_token) throw new PedidoInvalido('o Slack não devolveu o token da sua conta');
  await db.query(`INSERT INTO slack_usuarios (usuario_id, organizacao_id, slack_user_id, team_id, team_nome, token, escopos) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (usuario_id) DO UPDATE SET slack_user_id = EXCLUDED.slack_user_id, team_id = EXCLUDED.team_id, team_nome = EXCLUDED.team_nome, token = EXCLUDED.token, escopos = EXCLUDED.escopos, conectado_em = now()`,
    [i.usuarioId, e.organizacao_id, user.id, t.team?.id ?? '', t.team?.name ?? null, cifrar(user.access_token, segredo), user.scope ?? null]);
  if (t.access_token && t.token_type === 'bot') {
    await db.query(`INSERT INTO cofre_credenciais (organizacao_id, servico, usuario, segredo, atualizado_por) VALUES ($1,'slack_bot',$2,$3,$4)
      ON CONFLICT (organizacao_id, servico) DO UPDATE SET usuario = EXCLUDED.usuario, segredo = EXCLUDED.segredo, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
      [e.organizacao_id, t.team?.name ?? t.team?.id ?? 'Slack', cifrar(t.access_token, segredo), i.usuarioId]);
  }
  await auditar(db, { organizacaoId: e.organizacao_id, usuarioId: i.usuarioId, acao: 'slack.conectado', entidade: 'usuario', entidadeId: i.usuarioId, depois: { equipe: t.team?.name, bot: !!t.access_token } });
  return { ok: true, equipe: t.team?.name ?? null, bot: t.token_type === 'bot' };
}

export async function desconectar(db: PoolClient, i: Identidade) {
  await db.query('DELETE FROM slack_usuarios WHERE usuario_id = $1', [i.usuarioId]);
  return { ok: true };
}

// ------------------------------------------------------------- cliente da aba Slack ---
async function meuToken(db: PoolClient, i: Identidade, segredo: string) {
  const { rows: [u] } = await db.query<{ token: string; slack_user_id: string }>('SELECT token, slack_user_id FROM slack_usuarios WHERE usuario_id = $1', [i.usuarioId]);
  if (!u) throw new NaoEncontrado('conecte o seu Slack primeiro');
  return { token: decifrar(u.token, segredo), eu: u.slack_user_id };
}

export async function conversas(db: PoolClient, i: Identidade, segredo: string, buscar: Buscar = fetch) {
  const { token, eu } = await meuToken(db, i, segredo);
  const [lista, pessoas] = await Promise.all([
    slackApi(token, 'conversations.list', { types: 'public_channel,private_channel,im,mpim', exclude_archived: true, limit: 300 }, buscar),
    slackApi(token, 'users.list', { limit: 400 }, buscar),
  ]);
  const nomes = new Map<string, { nome: string; foto?: string }>((pessoas.members ?? []).map((m: any) => [m.id, { nome: m.profile?.display_name || m.real_name || m.name, foto: m.profile?.image_48 }]));
  const canais = (lista.channels ?? []).filter((c: any) => !c.is_im || nomes.get(c.user)).map((c: any) => ({
    id: c.id, tipo: c.is_im ? 'dm' : c.is_mpim ? 'grupo' : c.is_private ? 'privado' : 'canal', membro: c.is_member !== false,
    nome: c.is_im ? nomes.get(c.user)?.nome ?? 'Mensagem direta' : c.is_mpim ? String(c.purpose?.value || c.name).replace(/^mpdm-|--\d+$/g, '').replace(/--/g, ', ') : c.name,
    foto: c.is_im ? nomes.get(c.user)?.foto ?? null : null, atualizado: Number(c.updated ?? 0),
  })).filter((c: { membro: boolean; tipo: string }) => c.membro || c.tipo === 'canal');
  return { eu, conversas: canais, pessoas: Object.fromEntries(nomes) };
}

export async function mensagens(db: PoolClient, i: Identidade, segredo: string, canal: string, buscar: Buscar = fetch) {
  if (!/^[CDG][A-Z0-9]{6,}$/.test(canal)) throw new PedidoInvalido('conversa inválida');
  const { token } = await meuToken(db, i, segredo);
  const h = await slackApi(token, 'conversations.history', { channel: canal, limit: 60 }, buscar);
  return { mensagens: (h.messages ?? []).filter((m: any) => !m.subtype || m.subtype === 'bot_message' || m.subtype === 'thread_broadcast').reverse()
    .map((m: any) => ({ ts: m.ts, usuario: m.user ?? m.bot_id ?? null, bot: m.username ?? m.bot_profile?.name ?? null, texto: String(m.text ?? ''), respostas: m.reply_count ?? 0, arquivos: (m.files ?? []).map((f: any) => f.name) })) };
}

export const EsquemaEnvio = z.object({ canal: z.string().regex(/^[CDG][A-Z0-9]{6,}$/), texto: z.string().trim().min(1).max(4000) });
export async function enviar(db: PoolClient, i: Identidade, segredo: string, d: z.infer<typeof EsquemaEnvio>, buscar: Buscar = fetch) {
  const { token } = await meuToken(db, i, segredo);
  const r = await slackApi(token, 'chat.postMessage', { channel: d.canal, text: d.texto }, buscar, true);
  return { ok: true, ts: r.ts };
}

// ------------------------------------------------------------------- regras de aviso ---
export const EVENTOS: Record<string, string> = {
  prazo_d3: 'Prazo vence em 3 dias úteis', prazo_d1: 'Prazo vence amanhã', prazo_hoje: 'Prazo vence hoje', prazo_vencido: 'Prazo vencido e aberto',
  tarefa_atribuida: 'Tarefa nova atribuída', tarefa_hoje: 'Tarefa vence hoje', tarefa_atrasada: 'Tarefa atrasada',
  reuniao_dia: 'Agenda de reuniões do dia', reuniao_30min: 'Reunião em 30 minutos (com pauta e Meet)',
  sentinela_nova_acao: 'Nova ação contra cliente (Sentinela)', resumo_diario: 'Resumo diário da equipe',
};
const PADRAO: [string, boolean][] = [['prazo_d3', true], ['prazo_d1', true], ['prazo_hoje', true], ['prazo_vencido', true], ['tarefa_atribuida', true], ['tarefa_hoje', true],
  ['tarefa_atrasada', false], ['reuniao_dia', true], ['reuniao_30min', true], ['sentinela_nova_acao', true], ['resumo_diario', false]];
/** Regras padrão para o escritório que ainda não tem (criado depois da migração). */
async function garantirRegras(db: PoolClient, org: string) {
  await db.query(`INSERT INTO slack_regras (organizacao_id, evento, ativo) SELECT $1, x.e, x.a FROM jsonb_to_recordset($2::jsonb) AS x(e text, a boolean) ON CONFLICT DO NOTHING`, [org, JSON.stringify(PADRAO.map(([e, a]) => ({ e, a })))]);
}
export async function regras(db: PoolClient, i?: Identidade) {
  if (i) { const org = i.organizacoes.find((o) => o.tipo === 'escritorio')?.id; if (org) await garantirRegras(db, org); }
  return (await db.query(`SELECT id, evento, ativo, dm_responsavel AS "dmResponsavel", canal_id AS "canalId", canal_nome AS "canalNome", hora FROM slack_regras ORDER BY array_position(ARRAY['prazo_d3','prazo_d1','prazo_hoje','prazo_vencido','tarefa_atribuida','tarefa_hoje','tarefa_atrasada','reuniao_dia','reuniao_30min','sentinela_nova_acao','resumo_diario'], evento)`)).rows
    .map((r: Record<string, unknown>) => ({ ...r, rotulo: EVENTOS[r.evento as string] ?? r.evento }));
}
export const EsquemaRegra = z.object({ ativo: z.boolean().optional(), dmResponsavel: z.boolean().optional(), canalId: z.string().regex(/^[CG][A-Z0-9]{6,}$/).nullable().optional(), canalNome: z.string().max(120).nullable().optional(), hora: z.number().int().min(0).max(23).optional() });
export async function editarRegra(db: PoolClient, id: string, d: z.infer<typeof EsquemaRegra>, i: Identidade) {
  const sets: string[] = []; const args: unknown[] = [id];
  const add = (col: string, v: unknown) => { args.push(v); sets.push(`${col} = $${args.length}`); };
  if (d.ativo !== undefined) add('ativo', d.ativo); if (d.dmResponsavel !== undefined) add('dm_responsavel', d.dmResponsavel);
  if (d.canalId !== undefined) add('canal_id', d.canalId); if (d.canalNome !== undefined) add('canal_nome', d.canalNome); if (d.hora !== undefined) add('hora', d.hora);
  if (!sets.length) throw new PedidoInvalido('nada a alterar');
  const { rows } = await db.query<{ organizacao_id: string; evento: string }>(`UPDATE slack_regras SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1 RETURNING organizacao_id, evento`, args);
  if (!rows[0]) throw new NaoEncontrado('regra não encontrada');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'slack.regra_alterada', entidade: 'organizacao', entidadeId: rows[0].organizacao_id, depois: { evento: rows[0].evento, ...d } });
  return { ok: true };
}
export async function historicoEnvios(db: PoolClient) {
  return (await db.query('SELECT evento, destino, left(texto, 200) AS texto, ok, erro, enviado_em AS "enviadoEm" FROM slack_envios ORDER BY enviado_em DESC LIMIT 60')).rows;
}
/** Canais que o bot enxerga, para escolher o destino dos avisos. */
export async function canaisDoBot(db: PoolClient, segredo: string, buscar: Buscar = fetch) {
  const bot = await tokenDoBot(db, segredo); if (!bot) throw new PedidoInvalido('conecte o Slack como administração para instalar o bot');
  const r = await slackApi(bot, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: 300 }, buscar);
  return (r.channels ?? []).map((c: any) => ({ id: c.id, nome: c.name, privado: !!c.is_private, membro: !!c.is_member }));
}
async function tokenDoBot(db: PoolClient, segredo: string) {
  const { rows: [b] } = await db.query<{ segredo: string }>(`SELECT segredo FROM cofre_credenciais WHERE servico = 'slack_bot'`);
  return b ? decifrar(b.segredo, segredo) : null;
}
export async function testar(db: PoolClient, i: Identidade, segredo: string, buscar: Buscar = fetch) {
  const bot = await tokenDoBot(db, segredo); if (!bot) throw new PedidoInvalido('o bot ainda não foi instalado');
  const destino = await idSlackDe(db, bot, i.usuarioId, buscar);
  if (!destino) throw new PedidoInvalido('não achei sua conta no Slack pelo seu e-mail; conecte o seu Slack na aba Slack');
  await slackApi(bot, 'chat.postMessage', { channel: destino, text: '✅ Teste do NGA Nexus: os avisos automáticos vão chegar aqui.' }, buscar, true);
  return { ok: true };
}

// ------------------------------------------------------------------ rotina de avisos ---
const hojeBr = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const horaBr = (d = new Date()) => Number(d.toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
const br = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const cacheIds = new Map<string, string | null>();

/** Conta do Slack de uma pessoa do Nexus: a que ela conectou ou, se não conectou, a do mesmo e-mail. */
async function idSlackDe(db: PoolClient, bot: string, usuarioId: string, buscar: Buscar) {
  if (cacheIds.has(usuarioId)) return cacheIds.get(usuarioId)!;
  const { rows: [c] } = await db.query<{ slack_user_id: string }>('SELECT slack_user_id FROM slack_usuarios WHERE usuario_id = $1', [usuarioId]);
  let id: string | null = c?.slack_user_id ?? null;
  if (!id) {
    const { rows: [u] } = await db.query<{ email: string }>('SELECT email FROM usuarios WHERE id = $1', [usuarioId]);
    if (u?.email) { try { id = (await slackApi(bot, 'users.lookupByEmail', { email: u.email }, buscar)).user?.id ?? null; } catch { id = null; } }
  }
  cacheIds.set(usuarioId, id); return id;
}

interface Aviso { chave: string; evento: string; usuarioId: string | null; texto: string }

/** O que avisar agora, regra por regra. Pura consulta: quem envia e deduplica é `rotinaSlack`. */
export async function avisosDevidos(db: PoolClient, regrasAtivas: { evento: string; hora: number }[], agora = new Date()): Promise<Aviso[]> {
  const hoje = hojeBr(agora); const h = horaBr(agora); const ativos = new Map(regrasAtivas.map((r) => [r.evento, r]));
  const naHora = (ev: string) => ativos.has(ev) && h >= (ativos.get(ev)!.hora);
  const out: Aviso[] = [];
  const prazos = async (ev: string, cond: string, titulo: (r: any) => string) => {
    if (!naHora(ev)) return;
    const { rows } = await db.query(`SELECT z.id, z.titulo, z.vencimento::text AS venc, z.responsavel_id, p.numero, pj.nome AS projeto, pj.id AS projeto_id, coalesce(z.responsavel_id, pj.responsavel_id) AS para
      FROM prazos z JOIN processos p ON p.id = z.processo_id LEFT JOIN projetos pj ON pj.id = p.projeto_id WHERE z.situacao = 'aberto' AND ${cond}`, [hoje]);
    for (const r of rows) out.push({ chave: `${ev}:${r.id}:${ev === 'prazo_vencido' ? hoje : r.venc}`, evento: ev, usuarioId: r.para, texto: `${titulo(r)}\n*${r.titulo}* · ${r.numero}${r.projeto ? ` · ${r.projeto}` : ''}\nVencimento: ${br(r.venc)}` });
  };
  await prazos('prazo_d3', `z.vencimento = (SELECT d FROM generate_series($1::date + 1, $1::date + 10, '1 day') d WHERE extract(isodow FROM d) < 6 OFFSET 2 LIMIT 1)`, () => '⏳ *Prazo em 3 dias úteis*');
  await prazos('prazo_d1', `z.vencimento = (SELECT d FROM generate_series($1::date + 1, $1::date + 5, '1 day') d WHERE extract(isodow FROM d) < 6 LIMIT 1)`, () => '⚠️ *Prazo vence no próximo dia útil*');
  await prazos('prazo_hoje', 'z.vencimento = $1::date', () => '🔴 *Prazo vence HOJE*');
  await prazos('prazo_vencido', 'z.vencimento < $1::date', () => '🚨 *Prazo vencido e ainda aberto*');
  const tarefas = async (ev: string, cond: string, titulo: string, chaveDia: boolean) => {
    if (ev === 'tarefa_atribuida' ? !ativos.has(ev) : !naHora(ev)) return;
    const { rows } = await db.query(`SELECT t.id, t.titulo, t.prazo::text AS prazo, t.responsavel_id, pj.nome AS projeto FROM tarefas t LEFT JOIN projetos pj ON pj.id = t.projeto_id
      WHERE t.status <> 'concluida' AND t.responsavel_id IS NOT NULL AND ${cond}`, [hoje]);
    for (const r of rows) out.push({ chave: `${ev}:${r.id}${chaveDia ? `:${hoje}` : ''}`, evento: ev, usuarioId: r.responsavel_id, texto: `${titulo}\n*${r.titulo}*${r.projeto ? ` · ${r.projeto}` : ''}${r.prazo ? `\nPrazo: ${br(r.prazo)}` : ''}` });
  };
  await tarefas('tarefa_atribuida', `t.criado_em > now() - interval '1 day'`, '📌 *Tarefa nova para você*', false);
  await tarefas('tarefa_hoje', 't.prazo = $1::date', '📅 *Tarefa vence hoje*', true);
  await tarefas('tarefa_atrasada', 't.prazo < $1::date', '⌛ *Tarefa atrasada*', true);
  const pauta = (p: any[]) => (p ?? []).length ? `\nPauta:\n${(p as { texto: string; responsavel?: string }[]).map((x, i) => `${i + 1}. ${x.texto}${x.responsavel ? ` (${x.responsavel})` : ''}`).join('\n')}` : '';
  if (ativos.has('reuniao_30min')) {
    const { rows } = await db.query(`SELECT g.id, g.titulo, g.inicio, g.meet_url, g.pauta, g.criado_por, pj.nome AS projeto, array(SELECT pe.usuario_id FROM projeto_equipe pe WHERE pe.projeto_id = g.projeto_id AND pe.ate IS NULL) AS equipe
      FROM google_eventos g LEFT JOIN projetos pj ON pj.id = g.projeto_id WHERE g.inicio BETWEEN now() + interval '20 minutes' AND now() + interval '40 minutes'`);
    for (const r of rows) for (const u of [...new Set([r.criado_por, ...(r.equipe ?? [])].filter(Boolean))]) {
      out.push({ chave: `reuniao_30min:${r.id}:${u}`, evento: 'reuniao_30min', usuarioId: u as string, texto: `🗓️ *Reunião em 30 minutos:* ${r.titulo}${r.projeto ? ` · ${r.projeto}` : ''}\n${new Date(r.inicio).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}${r.meet_url ? ` · <${r.meet_url}|Entrar no Meet>` : ''}${pauta(r.pauta)}` });
    }
  }
  if (naHora('reuniao_dia')) {
    const { rows } = await db.query(`SELECT u AS usuario, string_agg(to_char(g.inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') || ' ' || g.titulo, E'\\n' ORDER BY g.inicio) AS lista
      FROM google_eventos g CROSS JOIN LATERAL unnest(array_append(array(SELECT pe.usuario_id FROM projeto_equipe pe WHERE pe.projeto_id = g.projeto_id AND pe.ate IS NULL), g.criado_por)) AS u
      WHERE (g.inicio AT TIME ZONE 'America/Sao_Paulo')::date = $1::date AND u IS NOT NULL GROUP BY u`, [hoje]);
    for (const r of rows) out.push({ chave: `reuniao_dia:${r.usuario}:${hoje}`, evento: 'reuniao_dia', usuarioId: r.usuario, texto: `☀️ *Suas reuniões de hoje*\n${r.lista}` });
  }
  if (ativos.has('sentinela_nova_acao')) {
    const { rows } = await db.query(`SELECT a.id, a.titulo, a.dados, pj.nome AS projeto, pj.responsavel_id FROM portal_avisos a JOIN projetos pj ON pj.id = a.projeto_id
      WHERE a.origem = 'sentinela' AND a.criado_em > now() - interval '2 days'`);
    for (const r of rows) out.push({ chave: `sentinela:${r.id}`, evento: 'sentinela_nova_acao', usuarioId: r.responsavel_id, texto: `🛰️ *Sentinela: nova ação contra ${r.projeto}*\n${r.dados?.classe ?? ''} · ${r.dados?.numero ?? ''} · ${r.dados?.tribunal ?? ''}\nRevise o aviso ao cliente na aba Portal do projeto.` });
  }
  if (naHora('resumo_diario')) {
    const { rows: [r] } = await db.query(`SELECT (SELECT count(*) FROM prazos WHERE situacao = 'aberto' AND vencimento = $1::date)::int AS hoje,
        (SELECT count(*) FROM prazos WHERE situacao = 'aberto' AND vencimento < $1::date)::int AS vencidos,
        (SELECT count(*) FROM tarefas WHERE status <> 'concluida' AND prazo = $1::date)::int AS tarefas,
        (SELECT count(*) FROM google_eventos WHERE (inicio AT TIME ZONE 'America/Sao_Paulo')::date = $1::date)::int AS reunioes`, [hoje]);
    out.push({ chave: `resumo:${hoje}`, evento: 'resumo_diario', usuarioId: null, texto: `📊 *Resumo do dia ${br(hoje)}*\nPrazos hoje: ${r.hoje} · vencidos abertos: ${r.vencidos}\nTarefas para hoje: ${r.tarefas} · reuniões: ${r.reunioes}` });
  }
  return out;
}

/** Rotina agendada (a cada 5 min): calcula, deduplica e envia. Uma organização por vez, com usuário de serviço. */
export async function rotinaSlack(banco: Banco, segredo: string, opcoes: { buscar?: Buscar; agora?: Date; limite?: number } = {}) {
  const buscar = opcoes.buscar ?? fetch; const tot = { enviados: 0, falhas: 0, pulados: 0 };
  const orgs = await banco.semContexto(async (db) => (await db.query<{ o: string }>('SELECT slack_organizacoes_com_bot() AS o')).rows.map((r) => r.o));
  for (const org of orgs) {
    const uid = await banco.semContexto(async (db) => (await db.query<{ u: string }>('SELECT usuario_de_servico_da_organizacao($1,$2,$3) AS u', [org, 'slack', `rotina-${randomBytes(8).toString('hex')}`])).rows[0]!.u);
    await banco.comoUsuario(uid, async (db) => {
      const bot = await tokenDoBot(db, segredo); if (!bot) return;
      await garantirRegras(db, org);
      const rs = (await db.query<{ evento: string; hora: number; dm_responsavel: boolean; canal_id: string | null }>('SELECT evento, hora, dm_responsavel, canal_id FROM slack_regras WHERE ativo')).rows;
      const avisos = await avisosDevidos(db, rs, opcoes.agora);
      const ja = new Set((await db.query<{ chave: string }>('SELECT chave FROM slack_envios WHERE chave = ANY($1)', [avisos.map((a) => a.chave)])).rows.map((r) => r.chave));
      let n = 0;
      for (const a of avisos) {
        if (ja.has(a.chave) || n >= (opcoes.limite ?? 60)) { tot.pulados++; continue; }
        const regra = rs.find((r) => r.evento === a.evento)!; const destinos: string[] = [];
        if (regra.dm_responsavel && a.usuarioId) { const id = await idSlackDe(db, bot, a.usuarioId, buscar); if (id) destinos.push(id); }
        if (regra.canal_id) destinos.push(regra.canal_id);
        if (!destinos.length) { await db.query(`INSERT INTO slack_envios (organizacao_id, chave, evento, destino, texto, ok, erro) VALUES ($1,$2,$3,'-',$4,FALSE,'sem destino: responsável sem conta no Slack e regra sem canal') ON CONFLICT DO NOTHING`, [org, a.chave, a.evento, a.texto]); tot.falhas++; continue; }
        let ok = true; let erro: string | null = null;
        for (const d of destinos) { try { await slackApi(bot, 'chat.postMessage', { channel: d, text: a.texto, unfurl_links: false }, buscar, true); } catch (e) { ok = false; erro = (e as Error).message.slice(0, 300); } }
        await db.query('INSERT INTO slack_envios (organizacao_id, chave, evento, destino, texto, ok, erro) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [org, a.chave, a.evento, destinos.join(','), a.texto, ok, erro]);
        if (ok) tot.enviados++; else tot.falhas++; n++;
      }
    });
  }
  return tot;
}
