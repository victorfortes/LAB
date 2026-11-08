-- 038 — Árvore de tarefas por fase, PMT das negociações, atas e chat.

-- A árvore de tarefas passa a morar na fase do procedimento.
ALTER TABLE tarefas ADD COLUMN fase TEXT CHECK (fase IS NULL OR length(fase) BETWEEN 1 AND 80);
CREATE INDEX idx_tarefas_fase ON tarefas(projeto_id, fase) WHERE fase IS NOT NULL;

-- PMT: cada parcela de um acordo negociado, com o pagamento confrontado.
CREATE TABLE negociacao_pmts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  negociacao_id  UUID NOT NULL REFERENCES negociacoes(id) ON DELETE CASCADE,
  numero         INTEGER NOT NULL CHECK (numero > 0),
  vencimento     DATE NOT NULL,
  valor          BIGINT NOT NULL CHECK (valor >= 0),
  juros          BIGINT NOT NULL DEFAULT 0 CHECK (juros >= 0),
  amortizacao    BIGINT NOT NULL DEFAULT 0 CHECK (amortizacao >= 0),
  saldo_final    BIGINT NOT NULL DEFAULT 0 CHECK (saldo_final >= 0),
  valor_pago     BIGINT CHECK (valor_pago >= 0),
  pago_em        DATE,
  observacao     TEXT CHECK (length(observacao) <= 2000),
  baixado_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (negociacao_id, numero),
  CONSTRAINT pmt_baixa_coerente CHECK ((pago_em IS NULL) = (valor_pago IS NULL))
);
CREATE INDEX idx_pmts_projeto ON negociacao_pmts(projeto_id, vencimento);
ALTER TABLE negociacao_pmts ENABLE ROW LEVEL SECURITY;
ALTER TABLE negociacao_pmts FORCE ROW LEVEL SECURITY;
-- Interno: sem política de portal, o cliente não alcança.
CREATE POLICY pmts_isolamento ON negociacao_pmts
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

-- Atas de reunião. Nasce interna; o cliente só lê a publicada.
CREATE TABLE atas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 300),
  realizada_em   DATE NOT NULL,
  participantes  TEXT NOT NULL DEFAULT '' CHECK (length(participantes) <= 2000),
  pauta          TEXT NOT NULL DEFAULT '' CHECK (length(pauta) <= 10000),
  decisoes       TEXT NOT NULL DEFAULT '' CHECK (length(decisoes) <= 30000),
  encaminhamentos TEXT NOT NULL DEFAULT '' CHECK (length(encaminhamentos) <= 10000),
  publicada      BOOLEAN NOT NULL DEFAULT FALSE,
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_atas_projeto ON atas(projeto_id, realizada_em DESC);
ALTER TABLE atas ENABLE ROW LEVEL SECURITY;
ALTER TABLE atas FORCE ROW LEVEL SECURITY;
CREATE POLICY atas_isolamento ON atas
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
CREATE POLICY atas_portal ON atas FOR SELECT
  USING (publicada AND EXISTS (SELECT 1 FROM portais p WHERE p.projeto_id = atas.projeto_id AND p.ativo
    AND p.organizacao_cliente_id IN (SELECT app_organizacoes_visiveis())));

-- Chat: confirmação de leitura de cada lado e anexo. O anexo é documento do próprio projeto.
ALTER TABLE mensagens ADD COLUMN lida_em TIMESTAMPTZ, ADD COLUMN documento_id UUID REFERENCES documentos(id) ON DELETE SET NULL;
CREATE INDEX idx_mensagens_nao_lidas ON mensagens(projeto_id, lado) WHERE lida_em IS NULL;

-- Marca como lidas as mensagens do OUTRO lado. O portal não tem UPDATE em mensagens, e
-- não deve ter: esta função só muda a data de leitura, e só no projeto que o chamador enxerga.
CREATE OR REPLACE FUNCTION marcar_mensagens_lidas(p_projeto UUID, p_lado_leitor TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projetos pr WHERE pr.id = p_projeto AND (pr.organizacao_id IN (SELECT app_organizacoes_visiveis())
     OR EXISTS (SELECT 1 FROM portais p WHERE p.projeto_id = pr.id AND p.ativo AND p.organizacao_cliente_id IN (SELECT app_organizacoes_visiveis())))) THEN
    RAISE EXCEPTION 'projeto não encontrado' USING ERRCODE = '42501';
  END IF;
  UPDATE mensagens SET lida_em = now() WHERE projeto_id = p_projeto AND lado <> p_lado_leitor AND lida_em IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION marcar_mensagens_lidas(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marcar_mensagens_lidas(UUID, TEXT) TO nga_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON negociacao_pmts, atas TO nga_app;
