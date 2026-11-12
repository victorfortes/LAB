-- 060 — QGC preliminar a partir do balancete.
--
-- Cada linha é o passivo de uma conta do balancete, com a natureza e a classe
-- SUGERIDAS. É rascunho de trabalho: a equipe edita, descarta ou valida. Validar
-- cria o credor e o crédito no QGC validado (tabela `creditos`), onde a classe
-- ainda passa pela validação humana de sempre.

CREATE TABLE qgc_preliminar (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  -- Arquivo de onde a linha veio; NULL quando foi incluída à mão.
  documento_id   UUID REFERENCES documentos(id) ON DELETE SET NULL,
  referencia     TEXT,
  codigo         TEXT,
  conta          TEXT,
  grupo          TEXT,
  credor         TEXT NOT NULL CHECK (length(credor) BETWEEN 1 AND 300),
  documento_credor TEXT,
  natureza       TEXT NOT NULL,
  classe_sugerida TEXT CHECK (classe_sugerida IN ('I', 'II', 'III', 'IV')),
  sujeito_sugerido BOOLEAN,
  valor          BIGINT NOT NULL CHECK (valor >= 0),
  motivo         TEXT,
  hipotese       BOOLEAN NOT NULL DEFAULT FALSE,
  situacao       TEXT NOT NULL DEFAULT 'preliminar' CHECK (situacao IN ('preliminar', 'validado', 'descartado')),
  editado        BOOLEAN NOT NULL DEFAULT FALSE,
  credito_id     UUID REFERENCES creditos(id) ON DELETE SET NULL,
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT validado_tem_credito CHECK (situacao <> 'validado' OR credito_id IS NOT NULL)
);

CREATE INDEX idx_qgc_preliminar_projeto ON qgc_preliminar(projeto_id, situacao);

ALTER TABLE qgc_preliminar ENABLE ROW LEVEL SECURITY;
ALTER TABLE qgc_preliminar FORCE ROW LEVEL SECURITY;

-- Interno do escritório: o cliente não vê o rascunho do QGC.
CREATE POLICY qgc_preliminar_isolamento ON qgc_preliminar
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

-- Mesma trava de equipe da migração 048.
CREATE POLICY qgc_preliminar_equipe_restrita ON qgc_preliminar AS RESTRICTIVE
  USING (NOT app_equipe_restrita() OR projeto_id IN (SELECT app_projetos_da_pessoa()));

GRANT SELECT, INSERT, UPDATE, DELETE ON qgc_preliminar TO nga_app;
