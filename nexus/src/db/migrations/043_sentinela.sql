-- 043 — NGA Sentinela: monitoramento de novas ações contra clientes, na própria plataforma.
-- Tudo interno ao escritório: sem política de portal.
CREATE TABLE sentinela_clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  razao_social TEXT NOT NULL, nome_fantasia TEXT, cnpj_matriz TEXT, advogado_responsavel TEXT, equipe TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE, confirmar_por_nome_exato BOOLEAN NOT NULL DEFAULT FALSE, ultima_verificacao TIMESTAMPTZ,
  origem_id INTEGER, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (organizacao_id, origem_id)
);
CREATE TABLE sentinela_nomes (
  cliente_id UUID NOT NULL REFERENCES sentinela_clientes(id) ON DELETE CASCADE, organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  nome TEXT NOT NULL, nome_norm TEXT NOT NULL, tipo TEXT NOT NULL, PRIMARY KEY (cliente_id, nome_norm)
);
CREATE TABLE sentinela_cnpjs (
  cliente_id UUID NOT NULL REFERENCES sentinela_clientes(id) ON DELETE CASCADE, organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  cnpj TEXT NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'), tipo TEXT NOT NULL CHECK (tipo IN ('matriz','filial')), PRIMARY KEY (cliente_id, cnpj)
);
CREATE TABLE sentinela_processos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  numero_processo TEXT NOT NULL, tribunal TEXT, classe TEXT, orgao TEXT, grau TEXT, sistema TEXT, assuntos JSONB, data_ajuizamento DATE,
  datajud_status TEXT NOT NULL DEFAULT 'pendente', primeira_identificacao TIMESTAMPTZ NOT NULL DEFAULT now(), ultima_verificacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, numero_processo)
);
CREATE INDEX idx_sentinela_processos_dj ON sentinela_processos(organizacao_id, datajud_status);
-- O texto integral fica no DJEN: aqui guardamos o início e o link, para o banco não crescer sem necessidade.
CREATE TABLE sentinela_comunicacoes (
  id TEXT NOT NULL, organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  numero_processo TEXT, tribunal TEXT, tipo TEXT, data_disponibilizacao DATE, classe TEXT, orgao TEXT, link TEXT, trecho TEXT,
  destinatarios JSONB NOT NULL DEFAULT '[]', coletado_em TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (organizacao_id, id)
);
CREATE TABLE sentinela_achados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  cliente_id UUID NOT NULL REFERENCES sentinela_clientes(id) ON DELETE CASCADE, processo_id UUID NOT NULL REFERENCES sentinela_processos(id) ON DELETE CASCADE,
  comunicacao_id TEXT, nivel INTEGER NOT NULL, classificacao TEXT NOT NULL CHECK (classificacao IN ('descartada','inconclusiva','provavel','confirmada')),
  polo TEXT, nome_na_fonte TEXT, evidencia JSONB NOT NULL DEFAULT '{}', estado_validacao TEXT NOT NULL, categoria_data TEXT,
  identificada_em TIMESTAMPTZ NOT NULL DEFAULT now(), ultima_verificacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_por UUID REFERENCES usuarios(id) ON DELETE SET NULL, decidido_em TIMESTAMPTZ, justificativa TEXT, UNIQUE (cliente_id, processo_id)
);
CREATE INDEX idx_sentinela_achados_estado ON sentinela_achados(organizacao_id, estado_validacao, identificada_em DESC);
CREATE TABLE sentinela_tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  cliente_id UUID NOT NULL REFERENCES sentinela_clientes(id) ON DELETE CASCADE, dia DATE NOT NULL, chave TEXT NOT NULL, param TEXT NOT NULL, valor TEXT NOT NULL,
  inicio DATE NOT NULL, fim DATE NOT NULL, status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','executando','ok','truncada','falha')),
  pagina INTEGER NOT NULL DEFAULT 1, lidos INTEGER NOT NULL DEFAULT 0, total INTEGER, tentativas INTEGER NOT NULL DEFAULT 0, erro TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (cliente_id, chave, inicio, fim, dia)
);
CREATE INDEX idx_sentinela_tarefas_fila ON sentinela_tarefas(organizacao_id, status, criado_em);
CREATE INDEX idx_sentinela_tarefas_chave ON sentinela_tarefas(cliente_id, chave, status, fim DESC);
CREATE TABLE sentinela_saude (
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT, fonte TEXT NOT NULL, estado TEXT NOT NULL, ultimo_sucesso TIMESTAMPTZ, ultima_falha TIMESTAMPTZ, ultimo_erro TEXT,
  falhas_consecutivas INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (organizacao_id, fonte)
);
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sentinela_clientes','sentinela_nomes','sentinela_cnpjs','sentinela_processos','sentinela_comunicacoes','sentinela_achados','sentinela_tarefas','sentinela_saude'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %1$I_iso ON %1$I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION organizacoes_com_sentinela() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT DISTINCT organizacao_id FROM sentinela_clientes WHERE ativo $$;
REVOKE ALL ON FUNCTION organizacoes_com_sentinela() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organizacoes_com_sentinela() TO nga_app;

-- Progresso da coleta do Radar: uma página por execução, para caber no limite da função.
CREATE TABLE radar_progresso (dia DATE PRIMARY KEY, indice INTEGER NOT NULL DEFAULT 0, pagina INTEGER NOT NULL DEFAULT 1, enviadas INTEGER NOT NULL DEFAULT 0, concluido BOOLEAN NOT NULL DEFAULT FALSE, erro TEXT);
ALTER TABLE radar_progresso ENABLE ROW LEVEL SECURITY;
ALTER TABLE radar_progresso FORCE ROW LEVEL SECURITY;
REVOKE ALL ON radar_progresso FROM nga_app;
CREATE OR REPLACE FUNCTION radar_estado(p_dia DATE) RETURNS radar_progresso
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r radar_progresso;
BEGIN
  INSERT INTO radar_progresso(dia) VALUES (p_dia) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM radar_progresso WHERE dia = p_dia; RETURN r;
END $$;
CREATE OR REPLACE FUNCTION radar_avancar(p_dia DATE, p_indice INTEGER, p_pagina INTEGER, p_enviadas INTEGER, p_concluido BOOLEAN, p_erro TEXT) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE radar_progresso SET indice=p_indice, pagina=p_pagina, enviadas=enviadas+p_enviadas, concluido=p_concluido, erro=left(p_erro,300) WHERE dia=p_dia
$$;
REVOKE ALL ON FUNCTION radar_estado(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION radar_avancar(DATE,INTEGER,INTEGER,INTEGER,BOOLEAN,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION radar_estado(DATE) TO nga_app;
GRANT EXECUTE ON FUNCTION radar_avancar(DATE,INTEGER,INTEGER,INTEGER,BOOLEAN,TEXT) TO nga_app;
