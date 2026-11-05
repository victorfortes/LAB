-- Gestão de equipe estritamente administrativa; credenciais nunca aparecem em listagens.
CREATE FUNCTION app_administra_escritorio(p_org UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM vinculos v JOIN usuarios u ON u.id=v.usuario_id JOIN organizacoes o ON o.id=v.organizacao_id
 WHERE v.organizacao_id=p_org AND v.usuario_id=app_usuario_id() AND v.papel='socio_administrador'
 AND v.revogado_em IS NULL AND u.ativo AND o.tipo='escritorio' AND o.arquivado_em IS NULL)
$$;
REVOKE ALL ON FUNCTION app_administra_escritorio(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_administra_escritorio(UUID) TO nga_app;

CREATE FUNCTION gerir_pessoa_equipe(p_org UUID,p_usuario UUID,p_nome TEXT,p_email TEXT,p_papel TEXT,p_acao TEXT,p_hash TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE alvo UUID; papel_atual TEXT;
BEGIN
 IF NOT app_administra_escritorio(p_org) THEN RAISE EXCEPTION 'administração da equipe não autorizada' USING ERRCODE='42501'; END IF;
 IF p_papel IS NOT NULL AND p_papel NOT IN ('socio_administrador','socio','advogado','controladoria','financeiro','administrativo','estagiario') THEN RAISE EXCEPTION 'papel interno inválido'; END IF;
 IF p_acao='convidar' THEN
  IF p_papel IS NULL OR length(btrim(p_nome)) NOT BETWEEN 2 AND 200 OR length(p_email)>200 OR p_email NOT LIKE '%@%' OR p_hash IS NULL OR p_hash NOT LIKE '$argon2id$%' THEN RAISE EXCEPTION 'dados da pessoa inválidos'; END IF;
  IF EXISTS(SELECT 1 FROM usuarios WHERE lower(email)=lower(p_email)) THEN RAISE EXCEPTION 'e-mail já cadastrado; gerencie o acesso existente'; END IF;
  INSERT INTO usuarios(nome,email,senha_hash) VALUES(btrim(p_nome),lower(btrim(p_email)),p_hash) RETURNING id INTO alvo;
  INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES(alvo,p_org,p_papel);
  RETURN alvo;
 END IF;
 alvo:=p_usuario;
 IF NOT EXISTS(SELECT 1 FROM vinculos WHERE usuario_id=alvo AND organizacao_id=p_org AND papel NOT IN ('cliente_administrador','cliente_usuario','integracao','parceiro_externo')) THEN RAISE EXCEPTION 'pessoa não pertence a esta equipe' USING ERRCODE='42501'; END IF;
 IF p_acao='revogar' AND alvo=app_usuario_id() THEN RAISE EXCEPTION 'não é permitido revogar seu próprio acesso'; END IF;
 IF EXISTS(SELECT 1 FROM vinculos WHERE usuario_id=alvo AND organizacao_id=p_org AND papel='socio_administrador' AND revogado_em IS NULL)
  AND (p_acao='revogar' OR (p_acao='alterar' AND p_papel<>'socio_administrador'))
  AND (SELECT count(DISTINCT v.usuario_id) FROM vinculos v JOIN usuarios u ON u.id=v.usuario_id WHERE v.organizacao_id=p_org AND v.papel='socio_administrador' AND v.revogado_em IS NULL AND u.ativo)<=1 THEN
  RAISE EXCEPTION 'mantenha pelo menos um sócio administrador ativo';
 END IF;
 IF p_acao='revogar' THEN
  UPDATE vinculos SET revogado_em=now() WHERE usuario_id=alvo AND organizacao_id=p_org AND revogado_em IS NULL;
  UPDATE projeto_equipe SET ate=CURRENT_DATE WHERE usuario_id=alvo AND organizacao_id=p_org AND ate IS NULL;
 ELSIF p_acao='alterar' THEN
  IF p_papel IS NULL THEN RAISE EXCEPTION 'informe o papel'; END IF;
  UPDATE vinculos SET revogado_em=now() WHERE usuario_id=alvo AND organizacao_id=p_org AND revogado_em IS NULL;
  INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES(alvo,p_org,p_papel) ON CONFLICT(usuario_id,organizacao_id,papel) DO UPDATE SET revogado_em=NULL;
  UPDATE usuarios SET ativo=true WHERE id=alvo;
 ELSE RAISE EXCEPTION 'ação de gestão inválida'; END IF;
 UPDATE sessoes SET revogada_em=now() WHERE usuario_id=alvo AND revogada_em IS NULL;
 UPDATE equipe_redefinicoes SET usado_em=now() WHERE usuario_id=alvo AND organizacao_id=p_org AND usado_em IS NULL;
 RETURN alvo;
END $$;
REVOKE ALL ON FUNCTION gerir_pessoa_equipe(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gerir_pessoa_equipe(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT) TO nga_app;

CREATE FUNCTION listar_gestao_equipe(p_org UUID) RETURNS TABLE(id UUID,nome TEXT,email TEXT,papel TEXT,ativo BOOLEAN,ultimo_acesso TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT DISTINCT ON (u.id) u.id,u.nome,u.email,v.papel,(u.ativo AND v.revogado_em IS NULL),u.ultimo_acesso
 FROM usuarios u JOIN vinculos v ON v.usuario_id=u.id WHERE v.organizacao_id=p_org AND v.papel NOT IN ('cliente_administrador','cliente_usuario','integracao','parceiro_externo')
 AND app_administra_escritorio(p_org)
 ORDER BY u.id,(v.revogado_em IS NULL) DESC,CASE WHEN v.papel='socio_administrador' THEN 0 ELSE 1 END,v.criado_em DESC
$$;
REVOKE ALL ON FUNCTION listar_gestao_equipe(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION listar_gestao_equipe(UUID) TO nga_app;

CREATE TABLE equipe_redefinicoes (
 token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64), usuario_id UUID NOT NULL REFERENCES usuarios(id), organizacao_id UUID NOT NULL REFERENCES organizacoes(id),
 criado_por UUID NOT NULL REFERENCES usuarios(id), expira_em TIMESTAMPTZ NOT NULL DEFAULT now()+interval '30 minutes', usado_em TIMESTAMPTZ, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE equipe_redefinicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipe_redefinicoes FORCE ROW LEVEL SECURITY;
CREATE POLICY redefinicoes_admin ON equipe_redefinicoes USING(app_administra_escritorio(organizacao_id)) WITH CHECK(app_administra_escritorio(organizacao_id));
REVOKE ALL ON equipe_redefinicoes FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON equipe_redefinicoes TO nga_app;
CREATE FUNCTION definir_senha_equipe(p_token_hash TEXT,p_senha_hash TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r equipe_redefinicoes%ROWTYPE;
BEGIN
 SELECT * INTO r FROM equipe_redefinicoes WHERE token_hash=p_token_hash AND usado_em IS NULL AND expira_em>now() FOR UPDATE;
 IF NOT FOUND OR p_senha_hash IS NULL OR p_senha_hash NOT LIKE '$argon2id$%' OR NOT app_administra_escritorio(r.organizacao_id) AND app_usuario_id() IS NOT NULL THEN
  RAISE EXCEPTION 'link inválido ou expirado' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM vinculos v JOIN usuarios u ON u.id=v.usuario_id WHERE v.usuario_id=r.usuario_id AND v.organizacao_id=r.organizacao_id AND v.revogado_em IS NULL AND u.ativo) THEN
  RAISE EXCEPTION 'link inválido ou expirado' USING ERRCODE='42501';
 END IF;
 UPDATE usuarios SET senha_hash=p_senha_hash WHERE id=r.usuario_id;
 UPDATE equipe_redefinicoes SET usado_em=now() WHERE usuario_id=r.usuario_id AND usado_em IS NULL;
 UPDATE sessoes SET revogada_em=now() WHERE usuario_id=r.usuario_id AND revogada_em IS NULL;
 INSERT INTO auditoria(organizacao_id,usuario_id,acao,entidade,entidade_id,origem) VALUES(r.organizacao_id,r.usuario_id,'equipe.senha_definida','usuario',r.usuario_id,'api');
END $$;
REVOKE ALL ON FUNCTION definir_senha_equipe(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION definir_senha_equipe(TEXT,TEXT) TO nga_app;

CREATE TABLE projeto_marcos (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), projeto_id UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE, organizacao_id UUID NOT NULL REFERENCES organizacoes(id),
 titulo TEXT NOT NULL CHECK(length(btrim(titulo)) BETWEEN 1 AND 300), descricao TEXT NOT NULL DEFAULT '' CHECK(length(descricao)<=5000),
 data_prevista DATE, concluido_em TIMESTAMPTZ, visivel_cliente BOOLEAN NOT NULL DEFAULT false, criado_por UUID REFERENCES usuarios(id), criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(projeto_id,organizacao_id) REFERENCES projetos(id,organizacao_id)
);
ALTER TABLE projeto_marcos ENABLE ROW LEVEL SECURITY;
ALTER TABLE projeto_marcos FORCE ROW LEVEL SECURITY;
CREATE POLICY marcos_escritorio ON projeto_marcos USING(organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK(organizacao_id IN (SELECT app_organizacoes_visiveis()));
CREATE POLICY marcos_portal ON projeto_marcos FOR SELECT USING(visivel_cliente AND projeto_id IN (SELECT app_projetos_do_portal()));
GRANT SELECT,INSERT,UPDATE,DELETE ON projeto_marcos TO nga_app;
CREATE INDEX projeto_marcos_projeto ON projeto_marcos(projeto_id,data_prevista);
