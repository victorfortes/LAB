-- 042 — Carteira importada do Astrea.
--
-- O Astrea tem registro que o cadastro de processos não aceita: caso sem número, número
-- de tribunal superior, número antigo. Esta tabela guarda TODOS, como vieram; `processos`
-- recebe só o que tem número CNJ válido. Interna: sem política de portal.
ALTER TABLE projetos ADD COLUMN etiqueta_astrea TEXT;
CREATE UNIQUE INDEX idx_projetos_etiqueta_astrea ON projetos(organizacao_id, etiqueta_astrea) WHERE etiqueta_astrea IS NOT NULL;

CREATE TABLE astrea_registros (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id   UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id       UUID REFERENCES projetos(id) ON DELETE SET NULL,
  processo_id      UUID REFERENCES processos(id) ON DELETE SET NULL,
  chave            TEXT NOT NULL,
  tipo             TEXT NOT NULL,
  titulo           TEXT,
  cliente_nome     TEXT,
  cliente_etiqueta TEXT,
  papel_cliente    TEXT,
  outros_envolvidos TEXT,
  numero_original  TEXT,
  acao             TEXT,
  pasta            TEXT,
  equipe           TEXT,
  fase             TEXT,
  responsavel      TEXT,
  etiquetas        TEXT[] NOT NULL DEFAULT '{}',
  vara             TEXT,
  foro             TEXT,
  valor_causa      BIGINT,
  distribuido_em   DATE,
  ultimo_historico TEXT,
  url_processo     TEXT,
  importado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, chave)
);
CREATE INDEX idx_astrea_etiqueta ON astrea_registros(organizacao_id, cliente_etiqueta);
CREATE INDEX idx_astrea_projeto ON astrea_registros(projeto_id);
ALTER TABLE astrea_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE astrea_registros FORCE ROW LEVEL SECURITY;
CREATE POLICY astrea_isolamento ON astrea_registros
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
GRANT SELECT, INSERT, UPDATE, DELETE ON astrea_registros TO nga_app;
