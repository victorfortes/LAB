-- Short-lived opaque tickets; never JWTs, passwords or application credentials in browser URLs.
CREATE TABLE ferramenta_sso_tickets (
 hash TEXT PRIMARY KEY CHECK(hash ~ '^[0-9a-f]{64}$'),
 usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
 organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
 ferramenta TEXT NOT NULL CHECK(ferramenta IN('prazos','sentinela')),
 state_hash TEXT CHECK(state_hash ~ '^[0-9a-f]{64}$'),
 expira_em TIMESTAMPTZ NOT NULL DEFAULT now()+interval '60 seconds',
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ferramenta_sso_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ferramenta_sso_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY sso_tickets_usuario ON ferramenta_sso_tickets
 USING(usuario_id=app_usuario_id() AND organizacao_id IN(SELECT app_organizacoes_visiveis()))
 WITH CHECK(usuario_id=app_usuario_id() AND organizacao_id IN(SELECT app_organizacoes_visiveis()));
REVOKE ALL ON ferramenta_sso_tickets FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON ferramenta_sso_tickets TO nga_app;
-- Private, narrow lookup before a tool has a LAB cookie. The API verifies its distinct server secret first.
-- The high-entropy ticket and tool nonce are both required; consumption is atomic and rechecks revocation.
CREATE FUNCTION consumir_sso_ferramenta(p_hash TEXT,p_ferramenta TEXT,p_state_hash TEXT)
RETURNS TABLE(usuario_id UUID,email TEXT,nome TEXT,organizacao_id UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
 WITH consumed AS (
  DELETE FROM ferramenta_sso_tickets t USING usuarios u
   WHERE t.hash=p_hash AND t.ferramenta=p_ferramenta AND t.state_hash=p_state_hash
     AND t.expira_em>now() AND u.id=t.usuario_id AND u.ativo
     AND EXISTS(SELECT 1 FROM vinculos v JOIN organizacoes o ON o.id=v.organizacao_id
       WHERE v.usuario_id=u.id AND v.organizacao_id=t.organizacao_id AND v.revogado_em IS NULL
         AND o.tipo='escritorio' AND v.papel NOT IN('integracao','parceiro_externo','cliente_usuario','cliente_administrador'))
  RETURNING t.usuario_id,t.organizacao_id
 ) SELECT u.id,u.email,u.nome,c.organizacao_id FROM consumed c JOIN usuarios u ON u.id=c.usuario_id
$$;
REVOKE ALL ON FUNCTION consumir_sso_ferramenta(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consumir_sso_ferramenta(TEXT,TEXT,TEXT) TO nga_app;
