-- 006 — Funções de autenticação.
--
-- PROBLEMA QUE ISTO RESOLVE
-- `usuarios`, `vinculos` e `organizacoes` têm RLS que depende de
-- `app.usuario_id`. Mas o login acontece ANTES de existir usuário autenticado:
-- a política devolve zero linhas e ninguém consegue entrar.
--
-- A saída errada seria afrouxar a política (ex.: permitir SELECT quando o
-- contexto está vazio) — isso abriria a tabela inteira para qualquer conexão.
-- A saída certa é expor APENAS o necessário, por função SECURITY DEFINER de
-- superfície mínima: uma recebe e-mail e devolve o hash; a outra recebe o hash
-- do token e devolve a identidade. Nenhuma lista usuários.

-- Credenciais por e-mail. Devolve no máximo uma linha, só o que o login usa.
CREATE OR REPLACE FUNCTION auth_credenciais(p_email TEXT)
RETURNS TABLE (id UUID, senha_hash TEXT, ativo BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.senha_hash, u.ativo FROM usuarios u
  WHERE lower(u.email) = lower(p_email)
$$;

-- Identidade a partir do HASH do token (o token em claro nunca chega ao banco).
-- Devolve uma linha por vínculo ativo.
CREATE OR REPLACE FUNCTION auth_identidade(p_token_hash TEXT)
RETURNS TABLE (
  usuario_id UUID, nome TEXT, email TEXT,
  organizacao_id UUID, organizacao_nome TEXT, organizacao_tipo TEXT, papel TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.nome, u.email, o.id, o.nome, o.tipo, v.papel
    FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id AND u.ativo
    JOIN vinculos v ON v.usuario_id = u.id AND v.revogado_em IS NULL
    JOIN organizacoes o ON o.id = v.organizacao_id AND o.arquivado_em IS NULL
   WHERE s.token_hash = p_token_hash
     AND s.revogada_em IS NULL
     AND s.expira_em > now()
$$;

REVOKE ALL ON FUNCTION auth_credenciais(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_identidade(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_credenciais(TEXT) TO nga_app;
GRANT EXECUTE ON FUNCTION auth_identidade(TEXT) TO nga_app;

-- `ultimo_acesso` é gravado no login, quando ainda não há contexto de RLS.
CREATE OR REPLACE FUNCTION auth_marcar_acesso(p_usuario UUID)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE usuarios SET ultimo_acesso = now() WHERE id = p_usuario
$$;
REVOKE ALL ON FUNCTION auth_marcar_acesso(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_marcar_acesso(UUID) TO nga_app;
