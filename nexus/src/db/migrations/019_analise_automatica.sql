-- 019 — Leitura automática dos documentos que o cliente envia.
--
-- O cliente envia pelo portal; quem lê e analisa é trabalho interno (011 não
-- tem política de portal e continua assim). Para a análise rodar sem um
-- advogado clicando, ela precisa de um ator dentro do escritório: uma conta de
-- serviço, com vínculo `integracao`, que só existe para isso e aparece na
-- auditoria com o nome "Análise automática". O que ela grava nasce interno.

CREATE TABLE documento_processamento (
  documento_id   UUID PRIMARY KEY REFERENCES documentos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID REFERENCES projetos(id) ON DELETE CASCADE,
  estado         TEXT NOT NULL CHECK (estado IN ('na_fila', 'lendo', 'analisado', 'sem_texto', 'erro')),
  detalhe        TEXT,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX documento_processamento_projeto ON documento_processamento (projeto_id);

ALTER TABLE documento_processamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_processamento FORCE ROW LEVEL SECURITY;
CREATE POLICY processamento_isolamento ON documento_processamento
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
GRANT SELECT, INSERT, UPDATE, DELETE ON documento_processamento TO nga_app;

-- Devolve a conta de serviço de análise da organização dona do documento,
-- criando-a na primeira vez. Superfície mínima: recebe o id do documento (a
-- organização sai dele), não aceita e-mail nem papel do chamador.
CREATE OR REPLACE FUNCTION usuario_de_analise_automatica(p_documento UUID, p_senha_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org UUID;
  v_email TEXT;
  v_id UUID;
BEGIN
  SELECT organizacao_id INTO v_org FROM documentos WHERE id = p_documento;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'documento não encontrado';
  END IF;

  v_email := 'integracao+analise-automatica-' || left(v_org::text, 8) || '@nga.local';
  SELECT id INTO v_id FROM usuarios WHERE email = v_email;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO usuarios (email, nome, senha_hash)
    VALUES (v_email, 'Análise automática', p_senha_hash) RETURNING id INTO v_id;
  INSERT INTO vinculos (usuario_id, organizacao_id, papel) VALUES (v_id, v_org, 'integracao');
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION usuario_de_analise_automatica(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION usuario_de_analise_automatica(UUID, TEXT) TO nga_app;
