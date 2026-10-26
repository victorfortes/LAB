// Edge Function: o administrador cria usuários em lote (com senha temporária) ou gera nova senha temporária.
// Não depende de e-mail (SMTP). Só administrador ativo pode chamar. A senha temporária volta uma única vez na resposta;
// a pessoa é obrigada a trocá-la no primeiro acesso (user_metadata.trocar_senha). A chave de serviço só existe aqui.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';

const ORIGENS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://relatoriosnga.lovable.app,https://report-loom-forge.lovable.app').split(',').map((s) => s.trim());
const PAPEIS = ['admin', 'advogado', 'visualizador'];
const MAX_LOTE = 50;

function cors(req: Request) {
  const o = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGENS.includes(o) ? o : ORIGENS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const resp = (req: Request, corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

// 16 caracteres, sem os ambíguos (0/O, 1/l/I), com sorteio criptográfico sem viés
function senhaTemporaria(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const limite = 256 - (256 % alfabeto.length);
  let s = '';
  while (s.length < 16) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    for (const x of b) { if (x < limite && s.length < 16) s += alfabeto[x % alfabeto.length]; }
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return resp(req, { erro: 'metodo' }, 405);

  const servico = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '');
  const { data: quem } = await servico.auth.getUser(token);
  if (!quem?.user) return resp(req, { erro: 'nao_autenticado' }, 401);
  const { data: eu } = await servico.from('perfis').select('papel, ativo').eq('user_id', quem.user.id).maybeSingle();
  if (!eu || !eu.ativo || eu.papel !== 'admin') return resp(req, { erro: 'sem_permissao' }, 403);

  let corpo: { acao?: string; usuarios?: { nome?: string; email?: string; papel?: string }[]; email?: string };
  try { corpo = await req.json(); } catch { return resp(req, { erro: 'corpo_invalido' }, 400); }
  const auditar = (acao: string, doc: string, meta: Record<string, unknown> = {}) =>
    servico.from('auditoria').insert({ user_id: quem.user.id, email: quem.user.email, acao, colecao: 'perfis', doc_id: doc, meta });

  if (corpo.acao === 'criar') {
    const lista = Array.isArray(corpo.usuarios) ? corpo.usuarios.slice(0, MAX_LOTE) : [];
    if (!lista.length) return resp(req, { erro: 'lista_vazia' }, 400);
    const saida: { email: string; nome: string; papel: string; resultado: string; senha_temporaria?: string }[] = [];
    for (const u of lista) {
      const nome = String(u.nome ?? '').trim().slice(0, 120);
      const email = String(u.email ?? '').trim().toLowerCase();
      const papel = String(u.papel ?? '');
      if (!nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !PAPEIS.includes(papel)) { saida.push({ email, nome, papel, resultado: 'dados_invalidos' }); continue; }
      const senha = senhaTemporaria();
      const { data: novo, error } = await servico.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome, trocar_senha: true } });
      if (error || !novo?.user) { saida.push({ email, nome, papel, resultado: /already|registered|exists/i.test(error?.message ?? '') ? 'ja_existe' : 'falhou' }); continue; }
      const { error: e2 } = await servico.from('perfis').upsert({ user_id: novo.user.id, email, nome, papel, ativo: true }, { onConflict: 'user_id' });
      if (e2) { saida.push({ email, nome, papel, resultado: 'perfil_falhou' }); continue; }
      await auditar('usuario_criar', novo.user.id, { papel });
      saida.push({ email, nome, papel, resultado: 'criado', senha_temporaria: senha });
    }
    return resp(req, { ok: true, usuarios: saida });
  }

  if (corpo.acao === 'redefinir') {
    const email = String(corpo.email ?? '').trim().toLowerCase();
    const { data: alvo } = await servico.from('perfis').select('user_id, nome').eq('email', email).maybeSingle();
    if (!alvo) return resp(req, { erro: 'nao_encontrado' }, 404);
    if (alvo.user_id === quem.user.id) return resp(req, { erro: 'use_trocar_senha' }, 400);   // o administrador troca a própria senha pelo fluxo normal
    const senha = senhaTemporaria();
    const { error } = await servico.auth.admin.updateUserById(alvo.user_id, { password: senha, user_metadata: { nome: alvo.nome, trocar_senha: true } });
    if (error) return resp(req, { erro: 'falhou' }, 500);
    await auditar('usuario_redefinir_senha', alvo.user_id);
    return resp(req, { ok: true, email, senha_temporaria: senha });
  }
  return resp(req, { erro: 'acao_invalida' }, 400);
});
