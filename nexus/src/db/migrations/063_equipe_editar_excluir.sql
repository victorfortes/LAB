-- 063 — Administração de cadastros da equipe: corrigir nome e e-mail e excluir cadastro.
--
-- "Excluir" não apaga a linha de `usuarios`: o histórico (auditoria, tarefas,
-- atas, quem validou o quê) continua apontando para a pessoa. O cadastro é
-- desativado, perde todo vínculo, sessão e link pendente, sai das equipes e o
-- e-mail é liberado para ser usado de novo.

CREATE FUNCTION editar_pessoa_equipe(p_org UUID, p_usuario UUID, p_nome TEXT, p_email TEXT, p_excluir BOOLEAN DEFAULT false) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_administra_escritorio(p_org) THEN RAISE EXCEPTION 'administração da equipe não autorizada' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vinculos WHERE usuario_id = p_usuario AND organizacao_id = p_org
                   AND papel NOT IN ('cliente_administrador','cliente_usuario','integracao','parceiro_externo')) THEN
    RAISE EXCEPTION 'pessoa não pertence a esta equipe' USING ERRCODE = '42501';
  END IF;

  IF p_excluir THEN
    IF p_usuario = app_usuario_id() THEN RAISE EXCEPTION 'não é permitido excluir o próprio cadastro'; END IF;
    IF EXISTS (SELECT 1 FROM vinculos WHERE usuario_id = p_usuario AND organizacao_id = p_org AND papel = 'socio_administrador' AND revogado_em IS NULL)
       AND (SELECT count(DISTINCT v.usuario_id) FROM vinculos v JOIN usuarios u ON u.id = v.usuario_id
             WHERE v.organizacao_id = p_org AND v.papel = 'socio_administrador' AND v.revogado_em IS NULL AND u.ativo) <= 1 THEN
      RAISE EXCEPTION 'mantenha pelo menos um sócio administrador ativo';
    END IF;
    UPDATE vinculos SET revogado_em = now() WHERE usuario_id = p_usuario AND revogado_em IS NULL;
    UPDATE projeto_equipe SET ate = greatest(CURRENT_DATE, desde) WHERE usuario_id = p_usuario AND ate IS NULL;
    UPDATE projetos SET responsavel_id = NULL WHERE responsavel_id = p_usuario;
    UPDATE sessoes SET revogada_em = now() WHERE usuario_id = p_usuario AND revogada_em IS NULL;
    UPDATE equipe_redefinicoes SET usado_em = now() WHERE usuario_id = p_usuario AND usado_em IS NULL;
    UPDATE usuarios SET ativo = false, email = 'excluido+' || replace(id::text, '-', '') || '@nga.invalid' WHERE id = p_usuario;
    RETURN p_usuario;
  END IF;

  IF p_nome IS NOT NULL AND length(btrim(p_nome)) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'nome inválido'; END IF;
  IF p_email IS NOT NULL THEN
    IF length(p_email) > 200 OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'e-mail inválido'; END IF;
    IF EXISTS (SELECT 1 FROM usuarios WHERE lower(email) = lower(btrim(p_email)) AND id <> p_usuario) THEN RAISE EXCEPTION 'e-mail já usado por outro cadastro'; END IF;
  END IF;
  UPDATE usuarios SET nome = coalesce(btrim(p_nome), nome), email = coalesce(lower(btrim(p_email)), email) WHERE id = p_usuario;
  -- Trocar o e-mail de login encerra as sessões abertas: a pessoa entra de novo com o e-mail novo.
  IF p_email IS NOT NULL THEN UPDATE sessoes SET revogada_em = now() WHERE usuario_id = p_usuario AND revogada_em IS NULL; END IF;
  RETURN p_usuario;
END $$;
REVOKE ALL ON FUNCTION editar_pessoa_equipe(UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION editar_pessoa_equipe(UUID, UUID, TEXT, TEXT, BOOLEAN) TO nga_app;
