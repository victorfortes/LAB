-- 061 — Fechamento financeiro mensal informado pelo cliente.
--
-- Poucos números por mês, digitados no portal ou importados da planilha modelo,
-- para a NGA acompanhar a saúde financeira da empresa. Campo vazio é "não
-- informado" (NULL), nunca zero.

CREATE TABLE fechamentos_mensais (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id  UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id      UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  competencia     DATE NOT NULL CHECK (extract(day FROM competencia) = 1),
  faturamento     BIGINT CHECK (faturamento >= 0),
  deducoes        BIGINT CHECK (deducoes >= 0),
  custos          BIGINT CHECK (custos >= 0),
  folha           BIGINT CHECK (folha >= 0),
  despesas        BIGINT CHECK (despesas >= 0),
  financeiras     BIGINT CHECK (financeiras >= 0),
  -- Caixa pode ser negativo (conta garantida usada).
  caixa           BIGINT,
  receber         BIGINT CHECK (receber >= 0),
  pagar           BIGINT CHECK (pagar >= 0),
  divida_bancaria BIGINT CHECK (divida_bancaria >= 0),
  tributos_atraso BIGINT CHECK (tributos_atraso >= 0),
  empregados      INTEGER CHECK (empregados >= 0),
  observacao      TEXT CHECK (length(observacao) <= 4000),
  enviado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  enviado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  conferido_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  conferido_em    TIMESTAMPTZ,
  UNIQUE (projeto_id, competencia)
);

ALTER TABLE fechamentos_mensais ENABLE ROW LEVEL SECURITY;
ALTER TABLE fechamentos_mensais FORCE ROW LEVEL SECURITY;

CREATE POLICY fechamentos_isolamento ON fechamentos_mensais
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

CREATE POLICY fechamentos_equipe_restrita ON fechamentos_mensais AS RESTRICTIVE
  USING (NOT app_equipe_restrita() OR projeto_id IN (SELECT app_projetos_da_pessoa()));

-- O cliente lê e informa os números do próprio projeto, se o portal libera o financeiro.
CREATE FUNCTION app_projetos_financeiro_do_portal() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.projeto_id FROM portais po
   WHERE po.ativo AND po.mostra_financeiro AND po.projeto_id IN (SELECT app_projetos_do_portal())
$$;
REVOKE ALL ON FUNCTION app_projetos_financeiro_do_portal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_projetos_financeiro_do_portal() TO nga_app;

CREATE POLICY fechamentos_portal_ler ON fechamentos_mensais FOR SELECT
  USING (projeto_id IN (SELECT app_projetos_financeiro_do_portal()));
CREATE POLICY fechamentos_portal_inserir ON fechamentos_mensais FOR INSERT
  WITH CHECK (projeto_id IN (SELECT app_projetos_financeiro_do_portal()));
-- Depois de conferido pela NGA, o mês fica travado para o cliente.
CREATE POLICY fechamentos_portal_corrigir ON fechamentos_mensais FOR UPDATE
  USING (projeto_id IN (SELECT app_projetos_financeiro_do_portal()) AND conferido_em IS NULL)
  WITH CHECK (projeto_id IN (SELECT app_projetos_financeiro_do_portal()));

GRANT SELECT, INSERT, UPDATE ON fechamentos_mensais TO nga_app;
