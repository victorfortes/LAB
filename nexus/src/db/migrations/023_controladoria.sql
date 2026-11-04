-- 023 — Controladoria: publicações do DJEN pelas OABs monitoradas do escritório.
--
-- Trabalho INTERNO e restrito (só sócio administrador e controladoria, por permissão): sem política de portal,
-- então nenhum cliente alcança uma publicação — que pode citar outros clientes do escritório.

CREATE TABLE oabs_monitoradas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  nome           TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 2 AND 200),
  numero_oab     TEXT NOT NULL CHECK (numero_oab ~ '^[0-9]{1,8}$'),
  uf_oab         TEXT NOT NULL CHECK (uf_oab ~ '^[A-Z]{2}$'),
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  ultima_sincronizacao TIMESTAMPTZ,
  ultimo_erro    TEXT,
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, numero_oab, uf_oab)
);

CREATE TABLE publicacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  /** Id da comunicação no DJEN: é a chave de deduplicação (a mesma publicação pode casar com duas OABs). */
  comunicacao_id BIGINT NOT NULL,
  oabs           TEXT[] NOT NULL DEFAULT '{}',
  data_disponibilizacao DATE NOT NULL,
  tribunal       TEXT,
  tipo           TEXT,
  orgao          TEXT,
  numero_processo TEXT,
  classe         TEXT,
  texto          TEXT NOT NULL,
  link           TEXT,
  destinatarios  JSONB NOT NULL DEFAULT '[]',
  processo_id    UUID REFERENCES processos(id) ON DELETE SET NULL,

  situacao       TEXT NOT NULL DEFAULT 'nova' CHECK (situacao IN ('nova', 'lida', 'tratada', 'descartada')),
  observacao     TEXT,
  responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  tratada_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  tratada_em     TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, comunicacao_id)
);
CREATE INDEX idx_publicacoes_situacao ON publicacoes(organizacao_id, situacao, data_disponibilizacao DESC);
CREATE INDEX idx_publicacoes_processo ON publicacoes(numero_processo);

ALTER TABLE oabs_monitoradas ENABLE ROW LEVEL SECURITY;
ALTER TABLE oabs_monitoradas FORCE ROW LEVEL SECURITY;
CREATE POLICY oabs_isolamento ON oabs_monitoradas
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
ALTER TABLE publicacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicacoes FORCE ROW LEVEL SECURITY;
CREATE POLICY publicacoes_isolamento ON publicacoes
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
GRANT SELECT, INSERT, UPDATE, DELETE ON oabs_monitoradas, publicacoes TO nga_app;

-- Conta de serviço da rotina agendada (sincronização sem ninguém logado). Uma por organização; só ganha o
-- vínculo `integracao` e nada mais. Superfície mínima, como em 016/019.
CREATE OR REPLACE FUNCTION usuario_de_servico_da_organizacao(p_organizacao UUID, p_apelido TEXT, p_senha_hash TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email TEXT; v_id UUID;
BEGIN
  IF p_apelido !~ '^[a-z-]{3,30}$' THEN RAISE EXCEPTION 'apelido inválido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM organizacoes WHERE id = p_organizacao AND tipo = 'escritorio') THEN
    RAISE EXCEPTION 'organização não encontrada';
  END IF;
  v_email := 'integracao+' || p_apelido || '-' || left(p_organizacao::text, 8) || '@nga.local';
  SELECT id INTO v_id FROM usuarios WHERE email = v_email;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO usuarios (email, nome, senha_hash) VALUES (v_email, 'Rotina: ' || p_apelido, p_senha_hash) RETURNING id INTO v_id;
  INSERT INTO vinculos (usuario_id, organizacao_id, papel) VALUES (v_id, p_organizacao, 'integracao');
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION usuario_de_servico_da_organizacao(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION usuario_de_servico_da_organizacao(UUID, TEXT, TEXT) TO nga_app;

-- Quais organizações têm OAB ativa: a rotina agendada precisa saber sem estar logada (devolve só ids).
CREATE OR REPLACE FUNCTION organizacoes_com_oab_ativa() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT organizacao_id FROM oabs_monitoradas WHERE ativo
$$;
REVOKE ALL ON FUNCTION organizacoes_com_oab_ativa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organizacoes_com_oab_ativa() TO nga_app;
