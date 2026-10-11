// Edge Function: convida uma pessoa para o escritório. Só administrador ativo pode chamar.
// Usa a chave de serviço (secreta, só existe aqui no servidor). Nunca exponha essa chave no navegador.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('SITE_URL') ?? '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};
const PAPEIS = ['admin', 'advogado', 'visualizador'];
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const servico = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // quem chama? (JWT do navegador) e é administrador ativo?
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '');
  const { data: quem } = await servico.auth.getUser(token);
  if (!quem?.user) return json({ erro: 'nao_autenticado' }, 401);
  const { data: eu } = await servico.from('perfis').select('papel, ativo').eq('user_id', quem.user.id).maybeSingle();
  if (!eu || !eu.ativo || eu.papel !== 'admin') return json({ erro: 'sem_permissao' }, 403);

  let corpo: { nome?: string; email?: string; papel?: string };
  try { corpo = await req.json(); } catch { return json({ erro: 'corpo_invalido' }, 400); }
  const nome = String(corpo.nome ?? '').trim().slice(0, 120);
  const email = String(corpo.email ?? '').trim().toLowerCase();
  const papel = String(corpo.papel ?? '');
  if (!nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !PAPEIS.includes(papel)) return json({ erro: 'dados_invalidos' }, 400);

  const redirectTo = Deno.env.get('SITE_URL') ?? undefined;
  const { data: conv, error } = await servico.auth.admin.inviteUserByEmail(email, { data: { nome }, redirectTo });
  if (error || !conv?.user) return json({ erro: 'convite_falhou' }, 400);

  const { error: e2 } = await servico.from('perfis').upsert(
    { user_id: conv.user.id, email, nome, papel, ativo: true }, { onConflict: 'user_id' });
  if (e2) return json({ erro: 'perfil_falhou' }, 500);
  await servico.from('auditoria').insert({ user_id: quem.user.id, email: quem.user.email, acao: 'usuario_convidar', colecao: 'perfis', doc_id: conv.user.id, meta: { papel } });
  return json({ ok: true });
});
