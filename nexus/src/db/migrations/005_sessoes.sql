-- 005 — Sessões.
--
-- Token guardado como hash, nunca em claro: quem ler a tabela (backup, dump,
-- um SELECT indevido) não consegue se passar por ninguém.

CREATE TABLE sessoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  criada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em     TIMESTAMPTZ NOT NULL,
  revogada_em   TIMESTAMPTZ,
  ip            TEXT,
  agente        TEXT
);

CREATE INDEX idx_sessoes_validas ON sessoes(token_hash) WHERE revogada_em IS NULL;

-- A sessão é consultada ANTES de haver usuário autenticado, então não pode
-- depender de `app.usuario_id`. O acesso é limitado pelo privilégio de tabela
-- e pelo fato de o token em claro nunca estar aqui.
GRANT SELECT, INSERT, UPDATE ON sessoes TO nga_app;
