-- 070 — Aba QGC: controle de adesões ao plano de recuperação extrajudicial (arts. 161 a 163)
--        e cenários de simulação do quórum da AGC na recuperação judicial (arts. 37, 41, 45 e 58).
--
-- Tudo interno do escritório: o cliente não vê nenhuma das tabelas.

-- ---------------------------------------------------------------- PRE ---
-- Parâmetros do plano: a data do pedido abre o prazo de 90 dias do art. 163, § 7º.
CREATE TABLE pre_planos (
  projeto_id     UUID PRIMARY KEY REFERENCES projetos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  data_pedido    DATE,
  observacao     TEXT CHECK (length(observacao) <= 2000),
  atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma linha por crédito do QGC validado que a equipe já tocou. Crédito sem linha = pendente, na espécie padrão.
CREATE TABLE pre_adesoes (
  credito_id     UUID PRIMARY KEY REFERENCES creditos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  -- Espécie (art. 83) ou grupo de credores de mesma natureza (art. 163, § 1º). NULL = a padrão pela natureza.
  especie        TEXT CHECK (length(especie) BETWEEN 1 AND 80),
  abrangido      BOOLEAN,
  situacao       TEXT NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'negociando', 'aderiu', 'recusou')),
  assinado_em    DATE,
  -- Pessoas do art. 43 (sócios, controladores, coligadas): não contam no percentual (art. 163, § 3º, II).
  art43          BOOLEAN NOT NULL DEFAULT FALSE,
  observacao     TEXT CHECK (length(observacao) <= 1000),
  atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pre_adesoes_projeto ON pre_adesoes(projeto_id);

-- ---------------------------------------------------------------- AGC ---
-- Cenário de votação: { "<classe>:<credor_id>": "sim" | "nao" | "abstencao" | "ausente" }.
CREATE TABLE agc_cenarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  convocacao     TEXT NOT NULL DEFAULT 'primeira' CHECK (convocacao IN ('primeira', 'segunda')),
  votos          JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(votos) = 'object'),
  atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, nome)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pre_planos', 'pre_adesoes', 'agc_cenarios'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t || '_isolamento', t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE USING (NOT app_equipe_restrita() OR projeto_id IN (SELECT app_projetos_da_pessoa()))', t || '_equipe_restrita', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;
