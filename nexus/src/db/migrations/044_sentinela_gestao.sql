-- 044 — NGA Sentinela: devolve à plataforma o que o sistema original tinha além da fila de conferência.
ALTER TABLE sentinela_clientes
  ADD COLUMN grupo_economico TEXT,
  ADD COLUMN tribunais_prioritarios JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN frequencia_horas INTEGER NOT NULL DEFAULT 24 CHECK (frequencia_horas >= 24);
ALTER TABLE sentinela_achados
  ADD COLUMN responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN prioridade TEXT CHECK (prioridade IN ('alta','media','baixa'));

CREATE TABLE sentinela_analises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  processo_id UUID NOT NULL REFERENCES sentinela_processos(id) ON DELETE CASCADE,
  gerada_em TIMESTAMPTZ NOT NULL DEFAULT now(), modelo TEXT NOT NULL DEFAULT 'regras', campos JSONB NOT NULL, resumo TEXT NOT NULL,
  prioridade TEXT NOT NULL CHECK (prioridade IN ('alta','media','baixa')), urgencia_aparente BOOLEAN NOT NULL DEFAULT FALSE,
  requer_analise_imediata BOOLEAN NOT NULL DEFAULT FALSE, documentos JSONB NOT NULL DEFAULT '{}', origem_id INTEGER, UNIQUE (organizacao_id, origem_id)
);
CREATE INDEX idx_sentinela_analises_proc ON sentinela_analises(processo_id, gerada_em DESC);

CREATE TABLE sentinela_controle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  cliente_id UUID NOT NULL REFERENCES sentinela_clientes(id) ON DELETE CASCADE, numero_processo TEXT NOT NULL CHECK (numero_processo ~ '^[0-9]{20}$'),
  observacao TEXT, criado_por TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), resultado TEXT, detalhe TEXT, verificado_em TIMESTAMPTZ,
  verificar BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE (cliente_id, numero_processo)
);
CREATE INDEX idx_sentinela_controle_fila ON sentinela_controle(organizacao_id) WHERE verificar;

CREATE TABLE sentinela_alertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  chave_dedup TEXT NOT NULL, tipo TEXT NOT NULL, canal TEXT NOT NULL DEFAULT 'interno', achado_id UUID REFERENCES sentinela_achados(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'enviado', erro TEXT, payload JSONB NOT NULL DEFAULT '{}', lido BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (organizacao_id, chave_dedup)
);
CREATE INDEX idx_sentinela_alertas_org ON sentinela_alertas(organizacao_id, criado_em DESC);

CREATE TABLE sentinela_validacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  achado_id UUID NOT NULL REFERENCES sentinela_achados(id) ON DELETE CASCADE, usuario TEXT NOT NULL, decisao TEXT NOT NULL,
  classificacao_anterior TEXT, justificativa TEXT, decidida_em TIMESTAMPTZ NOT NULL DEFAULT now(), origem_id INTEGER, UNIQUE (organizacao_id, origem_id)
);
CREATE INDEX idx_sentinela_validacoes_achado ON sentinela_validacoes(achado_id, decidida_em);

CREATE TABLE sentinela_config (
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT, chave TEXT NOT NULL, valor JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (organizacao_id, chave)
);
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sentinela_analises','sentinela_controle','sentinela_alertas','sentinela_validacoes','sentinela_config'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %1$I_iso ON %1$I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- O histórico das rotinas é restrito; a tela só precisa saber quando o Sentinela rodou pela última vez.
CREATE OR REPLACE FUNCTION sentinela_ultima_rotina() RETURNS TABLE(criado_em TIMESTAMPTZ, ok BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.criado_em, r.ok FROM rotina_execucoes r WHERE r.rotina = 'sentinela' ORDER BY r.criado_em DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION sentinela_ultima_rotina() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sentinela_ultima_rotina() TO nga_app;
