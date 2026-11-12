-- 047 — Vários documentos por item do checklist.
--
-- Itens como "balanços dos últimos três exercícios" pedem mais de um arquivo.
-- `requisitos.documento_id` continua apontando o envio mais recente (o resto do
-- sistema lê dali); a lista completa mora aqui.

CREATE TABLE requisito_documentos (
  requisito_id   UUID NOT NULL REFERENCES requisitos(id) ON DELETE CASCADE,
  documento_id   UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  enviado_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  enviado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cópia do nome e do tamanho: o cliente não lê a linha de `documentos` que
  -- ele mesmo enviou (ela nasce interna), mas precisa ver o que já mandou.
  titulo         TEXT,
  tamanho_bytes  BIGINT,
  PRIMARY KEY (requisito_id, documento_id)
);

CREATE INDEX idx_requisito_documentos_projeto ON requisito_documentos(projeto_id);

-- O que já existia vira a primeira linha de cada item.
INSERT INTO requisito_documentos (requisito_id, documento_id, organizacao_id, projeto_id, enviado_em, titulo, tamanho_bytes)
SELECT r.id, r.documento_id, r.organizacao_id, r.projeto_id, r.atualizado_em, d.titulo, d.tamanho_bytes
  FROM requisitos r JOIN documentos d ON d.id = r.documento_id
ON CONFLICT DO NOTHING;

CREATE FUNCTION app_requisito_documento_copiar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  SELECT d.titulo, d.tamanho_bytes INTO NEW.titulo, NEW.tamanho_bytes
    FROM documentos d WHERE d.id = NEW.documento_id AND d.projeto_id = NEW.projeto_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_requisito_documento_copiar() FROM PUBLIC;
CREATE TRIGGER requisito_documento_copiar BEFORE INSERT ON requisito_documentos
  FOR EACH ROW EXECUTE FUNCTION app_requisito_documento_copiar();

ALTER TABLE requisito_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisito_documentos FORCE ROW LEVEL SECURITY;

CREATE POLICY requisito_documentos_isolamento ON requisito_documentos
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

-- O cliente vê e acrescenta arquivos só no próprio projeto.
CREATE POLICY requisito_documentos_portal ON requisito_documentos FOR SELECT
  USING (projeto_id IN (SELECT app_projetos_do_portal()));
CREATE POLICY requisito_documentos_portal_envio ON requisito_documentos FOR INSERT
  WITH CHECK (projeto_id IN (SELECT app_projetos_do_portal()));

GRANT SELECT, INSERT, DELETE ON requisito_documentos TO nga_app;
