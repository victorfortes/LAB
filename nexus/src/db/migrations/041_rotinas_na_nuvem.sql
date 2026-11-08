-- 041 — Rotinas de fundo fora do servidor local.
--
-- A função Edge pode ser encerrada no meio por limite de CPU, e aí nem o `catch` roda.
-- A tentativa é contada ao começar a leitura, para um PDF pesado não entrar em ciclo eterno.
ALTER TABLE documento_processamento ADD COLUMN tentativas INTEGER NOT NULL DEFAULT 0;

-- O Raio X lê tudo o que foi juntado ao projeto, do cliente e do escritório, menos relatórios.
CREATE OR REPLACE FUNCTION documentos_de_analise_pendentes(p_limite integer DEFAULT 1)
RETURNS TABLE(documento_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT d.id FROM documentos d
 JOIN projetos p ON p.id=d.projeto_id
 LEFT JOIN documento_processamento dp ON dp.documento_id=d.id
 WHERE d.tem_arquivo AND p.situacao<>'encerrado'
 AND coalesce(d.categoria,'') NOT IN ('relatorio_gerador','relatorio','Relatório')
 AND (dp.documento_id IS NULL OR dp.estado='na_fila'
      OR (dp.estado='lendo' AND dp.tentativas<3 AND dp.atualizado_em<now()-interval '30 minutes'))
 ORDER BY d.criado_em LIMIT greatest(1,least(coalesce(p_limite,1),5))
$$;

-- Quem esgotou as tentativas sai de "lendo" e passa a dizer o motivo na tela.
CREATE OR REPLACE FUNCTION encerrar_leituras_travadas() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n INTEGER;
BEGIN
  UPDATE documento_processamento SET estado='erro', detalhe='a leitura excedeu o limite de processamento: confira o documento manualmente', atualizado_em=now()
   WHERE estado='lendo' AND tentativas>=3 AND atualizado_em<now()-interval '30 minutes';
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION encerrar_leituras_travadas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION encerrar_leituras_travadas() TO nga_app;

-- Chave que autoriza o agendador a acionar as rotinas. Fica só no banco e nunca é lida pela
-- aplicação, que apenas confere o hash. O agendador roda como dono do schema.
CREATE TABLE rotina_chave (
  id    BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  token TEXT NOT NULL DEFAULT (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
);
INSERT INTO rotina_chave DEFAULT VALUES;
ALTER TABLE rotina_chave ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotina_chave FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rotina_chave FROM PUBLIC;
REVOKE ALL ON rotina_chave FROM nga_app;

CREATE OR REPLACE FUNCTION rotina_autorizada(p_hash TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM rotina_chave WHERE encode(sha256(convert_to(token,'UTF8')),'hex') = p_hash)
$$;
REVOKE ALL ON FUNCTION rotina_autorizada(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rotina_autorizada(TEXT) TO nga_app;

-- Histórico: é por aqui que se confere se a rotina realmente rodou.
CREATE TABLE rotina_execucoes (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rotina    TEXT NOT NULL,
  ok        BOOLEAN NOT NULL,
  detalhe   TEXT,
  duracao_ms INTEGER,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rotina_execucoes ON rotina_execucoes(rotina, criado_em DESC);
ALTER TABLE rotina_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotina_execucoes FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION rotina_registrar(p_rotina TEXT, p_ok BOOLEAN, p_detalhe TEXT, p_ms INTEGER) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO rotina_execucoes(rotina, ok, detalhe, duracao_ms) VALUES (p_rotina, p_ok, left(p_detalhe, 500), p_ms);
  DELETE FROM rotina_execucoes WHERE criado_em < now() - interval '30 days';
END $$;
REVOKE ALL ON FUNCTION rotina_registrar(TEXT, BOOLEAN, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rotina_registrar(TEXT, BOOLEAN, TEXT, INTEGER) TO nga_app;
