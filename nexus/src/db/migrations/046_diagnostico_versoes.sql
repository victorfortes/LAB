-- 046 — Diagnóstico inicial versionado: posição do cliente, extrações estruturadas por documento e versões do relatório.

ALTER TABLE projetos ADD COLUMN posicao_cliente TEXT NOT NULL DEFAULT 'devedor' CHECK (posicao_cliente IN ('devedor', 'credor'));

-- Números extraídos de um documento, SEMPRE com a referência de onde saíram (arquivo e página/aba).
CREATE TABLE diagnostico_extracoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL,
  documento_id   UUID REFERENCES documentos(id) ON DELETE SET NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('balanco', 'dre_contabil', 'dre_gerencial', 'faturamento', 'extrato', 'passivo_fonte', 'clientes_abc', 'partes_relacionadas')),
  referencia     TEXT NOT NULL CHECK (length(btrim(referencia)) BETWEEN 1 AND 300),
  dados          JSONB NOT NULL CHECK (pg_column_size(dados) < 4000000),
  qualidade      TEXT NOT NULL DEFAULT 'boa' CHECK (qualidade IN ('boa', 'regular', 'ruim', 'ilegivel')),
  origem         TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'planilha', 'modelo')),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (projeto_id, organizacao_id) REFERENCES projetos(id, organizacao_id) ON DELETE CASCADE
);
CREATE INDEX idx_diag_extracoes ON diagnostico_extracoes(projeto_id, tipo);

CREATE TABLE diagnostico_versoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL,
  numero         INTEGER NOT NULL,
  gerado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  gerado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  motivo         TEXT NOT NULL DEFAULT 'manual' CHECK (motivo IN ('manual', 'rodada_de_entrega')),
  documentos     JSONB NOT NULL,   -- os documentos considerados, com a qualidade da leitura de cada um
  resultado      JSONB NOT NULL CHECK (pg_column_size(resultado) < 8000000),
  UNIQUE (projeto_id, numero),
  FOREIGN KEY (projeto_id, organizacao_id) REFERENCES projetos(id, organizacao_id) ON DELETE CASCADE
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['diagnostico_extracoes', 'diagnostico_versoes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    -- Sigilo: dado de um cliente nunca aparece no diagnóstico de outro; e o cliente não alcança o diagnóstico.
    EXECUTE format($f$CREATE POLICY %1$I_isolamento ON %1$I
      USING (organizacao_id IN (SELECT app_organizacoes_visiveis()) AND (NOT app_financeiro_restrito() OR projeto_id IN (SELECT app_projetos_do_financeiro())))
      WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- Registro de planilhas já lidas (para não ler de novo) e dos avisos da leitura de cada uma.
CREATE TABLE diagnostico_leituras (
  documento_id   UUID PRIMARY KEY REFERENCES documentos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL,
  extracoes      INTEGER NOT NULL DEFAULT 0,
  avisos         JSONB NOT NULL DEFAULT '[]',
  lido_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (projeto_id, organizacao_id) REFERENCES projetos(id, organizacao_id) ON DELETE CASCADE
);
ALTER TABLE diagnostico_leituras ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostico_leituras FORCE ROW LEVEL SECURITY;
CREATE POLICY diagnostico_leituras_isolamento ON diagnostico_leituras
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()) AND (NOT app_financeiro_restrito() OR projeto_id IN (SELECT app_projetos_do_financeiro())))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
GRANT SELECT, INSERT, UPDATE, DELETE ON diagnostico_leituras TO nga_app;
