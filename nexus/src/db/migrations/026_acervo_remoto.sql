-- Arquivos no mesmo PostgreSQL do LAB; RLS acompanha o documento, inclusive publicação/revogação.
CREATE TABLE documento_conteudos (
 documento_id UUID PRIMARY KEY REFERENCES documentos(id) ON DELETE CASCADE,
 conteudo BYTEA NOT NULL,
 hash_sha256 TEXT NOT NULL CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (encode(sha256(conteudo),'hex') = hash_sha256)
);
ALTER TABLE documento_conteudos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_conteudos FORCE ROW LEVEL SECURITY;
CREATE POLICY conteudos_leitura ON documento_conteudos FOR SELECT
 USING (EXISTS (SELECT 1 FROM documentos d WHERE d.id=documento_id));
REVOKE ALL ON documento_conteudos FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON documento_conteudos FROM nga_app;
GRANT SELECT ON documento_conteudos TO nga_app;

-- O envio do portal nasce interno e não é legível ao cliente. Esta função só permite
-- guardar os bytes da linha recém-enviada por ele, com hash e tamanho já registrados.
CREATE FUNCTION guardar_conteudo_documento(p_documento UUID,p_conteudo BYTEA)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d documentos%ROWTYPE;
BEGIN
 SELECT * INTO d FROM documentos WHERE id=p_documento;
 IF NOT FOUND OR d.enviado_por IS DISTINCT FROM app_usuario_id()
    OR NOT d.tem_arquivo OR d.tamanho_bytes<>octet_length(p_conteudo)
    OR d.hash_sha256<>encode(sha256(p_conteudo),'hex')
    OR octet_length(p_conteudo)>52428800 THEN
  RAISE EXCEPTION 'conteúdo não corresponde ao documento autorizado' USING ERRCODE='42501';
 END IF;
 IF NOT (d.organizacao_id IN (SELECT app_organizacoes_visiveis())
     OR (d.origem='portal_cliente' AND d.projeto_id IN (SELECT app_projetos_do_portal()))) THEN
  RAISE EXCEPTION 'projeto não autorizado' USING ERRCODE='42501';
 END IF;
 INSERT INTO documento_conteudos(documento_id,conteudo,hash_sha256)
 VALUES(p_documento,p_conteudo,d.hash_sha256) ON CONFLICT (documento_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION guardar_conteudo_documento(UUID,BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guardar_conteudo_documento(UUID,BYTEA) TO nga_app;
ALTER FUNCTION app_usuario_id() SET search_path = public, pg_temp;
ALTER FUNCTION app_organizacao_id() SET search_path = public, pg_temp;
