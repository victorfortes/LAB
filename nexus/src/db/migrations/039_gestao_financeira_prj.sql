-- 039 — Contas a pagar e a receber, importações e cenários do PRJ Studio.
--
-- `titulos` segue o desenho da 008: dado DO CLIENTE, com organizacao_id do cliente.
-- A NGA só LÊ, e só se o portal autorizar (mostra_financeiro). Nenhuma política dá
-- escrita ao escritório sobre o registro financeiro do cliente.

CREATE TABLE titulos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id  UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  projeto_id      UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('pagar', 'receber')),
  contraparte     TEXT NOT NULL CHECK (length(btrim(contraparte)) BETWEEN 1 AND 300),
  descricao       TEXT CHECK (length(descricao) <= 1000),
  categoria       TEXT NOT NULL DEFAULT 'Sem categoria' CHECK (length(categoria) <= 120),
  centro_custo    TEXT CHECK (length(centro_custo) <= 120),
  competencia     DATE,
  vencimento      DATE NOT NULL,
  valor_original  BIGINT NOT NULL CHECK (valor_original > 0),
  valor_atualizado BIGINT NOT NULL CHECK (valor_atualizado > 0),
  valor_liquidado BIGINT NOT NULL DEFAULT 0 CHECK (valor_liquidado >= 0),
  situacao        TEXT NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'parcial', 'liquidado', 'cancelado')),
  parcela         INTEGER CHECK (parcela > 0),
  parcelas        INTEGER CHECK (parcelas > 0),
  -- Origem preservada: o ajuste gerencial nunca sobrescreve o dado importado.
  origem          TEXT NOT NULL DEFAULT 'portal' CHECK (origem IN ('portal', 'importacao', 'erp')),
  origem_ref      TEXT,
  ajuste_gerencial JSONB,
  chave_dedupe    TEXT NOT NULL,
  importacao_id   UUID,
  criado_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, chave_dedupe),
  CONSTRAINT liquidado_ate_o_valor CHECK (valor_liquidado <= valor_atualizado)
);
CREATE INDEX idx_titulos_vencimento ON titulos(projeto_id, situacao, vencimento);

-- A baixa vira lançamento realizado ligado ao título: é o que impede a dupla contagem.
ALTER TABLE lancamentos ADD COLUMN titulo_id UUID REFERENCES titulos(id) ON DELETE SET NULL,
  ADD COLUMN origem TEXT NOT NULL DEFAULT 'portal' CHECK (origem IN ('portal', 'importacao', 'erp')),
  ADD COLUMN centro_custo TEXT CHECK (length(centro_custo) <= 120),
  ADD COLUMN chave_dedupe TEXT, ADD COLUMN importacao_id UUID;
CREATE UNIQUE INDEX idx_lancamentos_dedupe ON lancamentos(projeto_id, chave_dedupe) WHERE chave_dedupe IS NOT NULL;

CREATE TABLE fin_importacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  arquivo        TEXT NOT NULL, formato TEXT NOT NULL,
  linhas         INTEGER NOT NULL, importadas INTEGER NOT NULL, duplicadas INTEGER NOT NULL,
  erros          JSONB NOT NULL DEFAULT '[]',
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['titulos', 'fin_importacoes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY %1$I_cliente ON %1$I
      USING (organizacao_id IN (SELECT app_organizacoes_visiveis()) AND EXISTS (
        SELECT 1 FROM portais p WHERE p.ativo AND p.projeto_id = %1$I.projeto_id AND p.organizacao_cliente_id = %1$I.organizacao_id))
      WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()) AND EXISTS (
        SELECT 1 FROM portais p WHERE p.ativo AND p.projeto_id = %1$I.projeto_id AND p.organizacao_cliente_id = %1$I.organizacao_id))$f$, t);
    EXECUTE format($f$CREATE POLICY %1$I_escritorio ON %1$I FOR SELECT
      USING (EXISTS (SELECT 1 FROM portais p JOIN projetos pr ON pr.id = p.projeto_id
        WHERE p.ativo AND p.mostra_financeiro AND p.projeto_id = %1$I.projeto_id AND p.organizacao_cliente_id = %1$I.organizacao_id
          AND pr.organizacao_id IN (SELECT app_organizacoes_visiveis())))$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- Cenários do PRJ são trabalho interno: privados até o compartilhamento expresso.
CREATE TABLE prj_cenarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  versao         INTEGER NOT NULL DEFAULT 1 CHECK (versao > 0),
  parametros     JSONB NOT NULL,
  resumo         JSONB NOT NULL,
  compartilhado  BOOLEAN NOT NULL DEFAULT FALSE,
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, nome, versao)
);
ALTER TABLE prj_cenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE prj_cenarios FORCE ROW LEVEL SECURITY;
CREATE POLICY prj_cenarios_isolamento ON prj_cenarios
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
CREATE POLICY prj_cenarios_portal ON prj_cenarios FOR SELECT
  USING (compartilhado AND EXISTS (SELECT 1 FROM portais p WHERE p.projeto_id = prj_cenarios.projeto_id AND p.ativo
    AND p.organizacao_cliente_id IN (SELECT app_organizacoes_visiveis())));
GRANT SELECT, INSERT, UPDATE, DELETE ON prj_cenarios TO nga_app;
