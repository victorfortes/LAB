-- NGA Prazos — esquema inicial. Idempotente por controle em schema_migrations (scripts/migrate.ts).

CREATE TABLE users (
  id            text PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin','operator','auditor','viewer')),
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE runs (
  id           text PRIMARY KEY,
  status       text NOT NULL CHECK (status IN ('running','awaiting_login','completed','failed','abandoned')),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz NOT NULL DEFAULT now(),
  data         jsonb NOT NULL
);
-- Bloqueio de execução concorrente: no máximo UMA execução ativa.
CREATE UNIQUE INDEX runs_single_active ON runs ((1)) WHERE status IN ('running','awaiting_login');

CREATE TABLE authorized_processes (
  process_number text PRIMARY KEY,
  responsible    text
);

CREATE TABLE records (
  id          text PRIMARY KEY,
  run_id      text NOT NULL REFERENCES runs(id),
  external_id text NOT NULL UNIQUE,       -- impede duplicar a mesma publicação
  state       text NOT NULL,
  version     integer NOT NULL DEFAULT 1, -- controle otimista
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  data        jsonb NOT NULL
);
CREATE INDEX records_run ON records(run_id);
CREATE INDEX records_state ON records(state);

CREATE TABLE comments (
  id         text PRIMARY KEY,
  record_id  text NOT NULL REFERENCES records(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  data       jsonb NOT NULL
);

CREATE TABLE write_authorizations (
  id         text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  data       jsonb NOT NULL
);

-- Chave de idempotência das gravações no Astrea.
CREATE TABLE write_ops (
  key        text PRIMARY KEY,
  record_id  text NOT NULL REFERENCES records(id),
  status     text NOT NULL CHECK (status IN ('pending','confirmed','divergent','failed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  data       jsonb NOT NULL
);

CREATE TABLE corrections (
  id        text PRIMARY KEY,
  record_id text NOT NULL REFERENCES records(id),
  status    text NOT NULL,
  data      jsonb NOT NULL
);

-- Histórico imutável de auditoria (encadeado por hash; ver src/audit/chain.ts).
CREATE TABLE audit_log (
  seq         bigint PRIMARY KEY,
  ts          timestamptz NOT NULL,
  actor       text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  data        jsonb NOT NULL,
  prev_hash   text NOT NULL,
  hash        text NOT NULL UNIQUE
);
CREATE INDEX audit_entity ON audit_log(entity_id);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log é imutável (% bloqueado)', TG_OP;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- Recomendado em produção: a role da aplicação só recebe INSERT/SELECT em audit_log:
--   REVOKE ALL ON audit_log FROM nga_app; GRANT SELECT, INSERT ON audit_log TO nga_app;
