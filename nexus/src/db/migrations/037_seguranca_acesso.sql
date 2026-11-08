-- 037 — Endurecimento do acesso.
--
-- Login sem limite de tentativas permite adivinhar senha sem custo. O limite
-- precisa morar no banco: o servidor roda em várias instâncias (Edge), e um
-- contador em memória zeraria a cada instância.
CREATE TABLE login_tentativas (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chave     TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_tentativas ON login_tentativas (chave, criado_em DESC);
ALTER TABLE login_tentativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_tentativas FORCE ROW LEVEL SECURITY;
-- Sem política: só as funções abaixo tocam a tabela.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS deve_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION auth_login_bloqueado(p_email TEXT, p_ip TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (SELECT count(*) FROM login_tentativas
           WHERE chave = 'email:' || lower(p_email) AND criado_em > now() - interval '15 minutes') >= 8
      OR (p_ip IS NOT NULL AND (SELECT count(*) FROM login_tentativas
           WHERE chave = 'ip:' || p_ip AND criado_em > now() - interval '15 minutes') >= 40)
$$;

CREATE OR REPLACE FUNCTION auth_registrar_falha(p_email TEXT, p_ip TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO login_tentativas (chave) VALUES ('email:' || lower(p_email));
  IF p_ip IS NOT NULL THEN INSERT INTO login_tentativas (chave) VALUES ('ip:' || p_ip); END IF;
  DELETE FROM login_tentativas WHERE criado_em < now() - interval '1 day';
END $$;

CREATE OR REPLACE FUNCTION auth_limpar_falhas(p_email TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM login_tentativas WHERE chave = 'email:' || lower(p_email)
$$;

CREATE OR REPLACE FUNCTION auth_exigir_troca_senha(p_email TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE usuarios SET deve_trocar_senha = TRUE WHERE lower(email) = lower(p_email)
$$;

CREATE OR REPLACE FUNCTION auth_deve_trocar_senha(p_usuario UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT deve_trocar_senha FROM usuarios WHERE id = p_usuario), FALSE)
$$;

-- Troca a senha e derruba as demais sessões: quem tinha a senha antiga sai.
CREATE OR REPLACE FUNCTION auth_trocar_senha(p_usuario UUID, p_hash TEXT, p_token_atual TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE usuarios SET senha_hash = p_hash, deve_trocar_senha = FALSE WHERE id = p_usuario;
  UPDATE sessoes SET revogada_em = now()
   WHERE usuario_id = p_usuario AND revogada_em IS NULL AND token_hash <> p_token_atual;
END $$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'auth_login_bloqueado(TEXT,TEXT)', 'auth_registrar_falha(TEXT,TEXT)', 'auth_limpar_falhas(TEXT)',
    'auth_exigir_troca_senha(TEXT)', 'auth_deve_trocar_senha(UUID)', 'auth_trocar_senha(UUID,TEXT,TEXT)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO nga_app', f);
  END LOOP;
END $$;
