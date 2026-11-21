-- 074 — Segundo fator (aplicativo autenticador) para quem administra.
--
-- Quem tem papel de sócio, administração ou coordenação vê todos os clientes;
-- só a senha é pouco para isso. O segredo TOTP é cifrado no servidor
-- (AES-256-GCM, mesma chave do cofre) antes de chegar aqui.
--
-- `mfa_segredo` já existia (001) e nunca foi usado. `mfa_pendente` guarda a
-- chave mostrada na tela até a pessoa confirmar com um código; `mfa_ultimo_passo`
-- recusa o mesmo código duas vezes.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_pendente TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_ativado_em TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_ultimo_passo BIGINT;

-- Papéis que enxergam a carteira inteira: segundo fator obrigatório.
CREATE OR REPLACE FUNCTION auth_mfa_exigido(p_usuario UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM vinculos v WHERE v.usuario_id = p_usuario AND v.revogado_em IS NULL
                   AND v.papel IN ('socio_administrador', 'socio', 'coordenacao'))
$$;

-- Estado de acesso numa consulta só (roda a cada requisição).
CREATE OR REPLACE FUNCTION auth_estado_acesso(p_usuario UUID)
RETURNS TABLE (deve_trocar_senha BOOLEAN, mfa_ativo BOOLEAN, mfa_exigido BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(u.deve_trocar_senha, FALSE),
         u.mfa_ativado_em IS NOT NULL AND u.mfa_segredo IS NOT NULL,
         auth_mfa_exigido(u.id)
    FROM usuarios u WHERE u.id = p_usuario
$$;

CREATE OR REPLACE FUNCTION auth_mfa(p_usuario UUID)
RETURNS TABLE (segredo TEXT, pendente TEXT, ativo BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.mfa_segredo, u.mfa_pendente, u.mfa_ativado_em IS NOT NULL AND u.mfa_segredo IS NOT NULL
    FROM usuarios u WHERE u.id = p_usuario
$$;

-- Marca o passo usado. Falso se o código (ou um anterior) já foi usado.
CREATE OR REPLACE FUNCTION auth_mfa_usar_passo(p_usuario UUID, p_passo BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n INT;
BEGIN
  UPDATE usuarios SET mfa_ultimo_passo = p_passo
   WHERE id = p_usuario AND (mfa_ultimo_passo IS NULL OR mfa_ultimo_passo < p_passo);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

-- Guarda a chave nova até a confirmação. Com o fator já ativo, não troca:
-- perdeu o celular, a administração gera o link de senha, que zera o fator.
CREATE OR REPLACE FUNCTION auth_mfa_preparar(p_usuario UUID, p_segredo TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n INT;
BEGIN
  UPDATE usuarios SET mfa_pendente = p_segredo WHERE id = p_usuario AND mfa_ativado_em IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

-- Confirma a chave pendente. As outras sessões da pessoa caem.
CREATE OR REPLACE FUNCTION auth_mfa_ativar(p_usuario UUID, p_token_atual TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n INT;
BEGIN
  UPDATE usuarios SET mfa_segredo = mfa_pendente, mfa_pendente = NULL, mfa_ativado_em = now()
   WHERE id = p_usuario AND mfa_pendente IS NOT NULL AND mfa_ativado_em IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN
    UPDATE sessoes SET revogada_em = now()
     WHERE usuario_id = p_usuario AND revogada_em IS NULL AND token_hash <> p_token_atual;
    INSERT INTO auditoria (organizacao_id, usuario_id, acao, entidade, entidade_id, origem)
    VALUES (NULL, p_usuario, 'usuario.mfa_ativado', 'usuario', p_usuario, 'api');
  END IF;
  RETURN n = 1;
END $$;

-- O link de senha gerado pela administração também zera o segundo fator:
-- é o caminho de quem perdeu o celular. Só vale com link válido e não usado.
CREATE OR REPLACE FUNCTION equipe_redefinicao_zera_mfa(p_token_hash TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE alvo UUID; org UUID;
BEGIN
  SELECT r.usuario_id, r.organizacao_id INTO alvo, org FROM equipe_redefinicoes r
   WHERE r.token_hash = p_token_hash AND r.usado_em IS NULL AND r.expira_em > now();
  IF alvo IS NULL THEN RETURN; END IF;
  UPDATE usuarios SET mfa_segredo = NULL, mfa_pendente = NULL, mfa_ativado_em = NULL, mfa_ultimo_passo = NULL
   WHERE id = alvo AND (mfa_segredo IS NOT NULL OR mfa_pendente IS NOT NULL);
  IF FOUND THEN
    INSERT INTO auditoria (organizacao_id, usuario_id, acao, entidade, entidade_id, origem)
    VALUES (org, alvo, 'usuario.mfa_zerado', 'usuario', alvo, 'api');
  END IF;
END $$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'auth_mfa_exigido(UUID)', 'auth_estado_acesso(UUID)', 'auth_mfa(UUID)', 'auth_mfa_usar_passo(UUID,BIGINT)',
    'auth_mfa_preparar(UUID,TEXT)', 'auth_mfa_ativar(UUID,TEXT)', 'equipe_redefinicao_zera_mfa(TEXT)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO nga_app', f);
  END LOOP;
END $$;
