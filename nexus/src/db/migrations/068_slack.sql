-- 068 — Slack do escritório: conexão de cada pessoa (token próprio, cifrado), regras de aviso e registro do que foi enviado.

-- O cofre passa a guardar também o app do Slack (client id/secret) e o token do bot.
ALTER TABLE cofre_credenciais DROP CONSTRAINT IF EXISTS cofre_credenciais_servico_check;
ALTER TABLE cofre_credenciais ADD CONSTRAINT cofre_credenciais_servico_check CHECK (servico IN ('astrea','slack_app','slack_bot'));

-- Cada pessoa conecta o próprio Slack: é com o token dela que a aba Slack lê e envia mensagens.
CREATE TABLE slack_usuarios (
  usuario_id     UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  slack_user_id  TEXT NOT NULL,
  team_id        TEXT NOT NULL,
  team_nome      TEXT,
  token          TEXT NOT NULL CHECK (token ~ '^v1:'),
  escopos        TEXT,
  conectado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Estado do OAuth (evita CSRF): expira em 10 minutos.
CREATE TABLE slack_oauth_estados (
  estado         TEXT PRIMARY KEY,
  usuario_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  redirect_uri   TEXT NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Regras de aviso. Destino: mensagem direta ao responsável e/ou um canal.
CREATE TABLE slack_regras (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  evento         TEXT NOT NULL CHECK (evento IN ('prazo_d3','prazo_d1','prazo_hoje','prazo_vencido','tarefa_atribuida','tarefa_hoje','tarefa_atrasada',
                                                 'reuniao_dia','reuniao_30min','sentinela_nova_acao','resumo_diario')),
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  dm_responsavel BOOLEAN NOT NULL DEFAULT TRUE,
  canal_id       TEXT,
  canal_nome     TEXT,
  -- Hora do dia (Brasília) para avisos diários; os de reunião usam o horário do evento.
  hora           INTEGER NOT NULL DEFAULT 8 CHECK (hora BETWEEN 0 AND 23),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, evento)
);
-- Cada aviso enviado tem uma chave única: a rotina pode rodar de novo sem mandar duas vezes.
CREATE TABLE slack_envios (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  chave          TEXT NOT NULL,
  evento         TEXT NOT NULL,
  destino        TEXT NOT NULL,
  texto          TEXT NOT NULL,
  ok             BOOLEAN NOT NULL,
  erro           TEXT,
  enviado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, chave)
);
CREATE INDEX idx_slack_envios ON slack_envios(organizacao_id, enviado_em DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['slack_usuarios','slack_oauth_estados','slack_regras','slack_envios'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %1$I_iso ON %1$I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;
-- O token de cada pessoa só é lido pela própria pessoa (a rotina usa o token do bot, não os pessoais).
CREATE POLICY slack_usuarios_dono ON slack_usuarios AS RESTRICTIVE FOR SELECT USING (usuario_id = nullif(current_setting('app.usuario_id', true), '')::uuid OR app_administra_escritorio(organizacao_id));

-- A rotina roda sem sessão: estas funções entregam só o necessário (organizações com bot e o segredo cifrado do bot).
CREATE FUNCTION slack_organizacoes_com_bot() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT organizacao_id FROM cofre_credenciais WHERE servico = 'slack_bot'
$$;
REVOKE ALL ON FUNCTION slack_organizacoes_com_bot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION slack_organizacoes_com_bot() TO nga_app;

-- Regras padrão para quem já existe: prazos e tarefas por mensagem direta, reuniões 30 min antes.
INSERT INTO slack_regras (organizacao_id, evento, ativo, dm_responsavel, hora)
SELECT o.id, e.evento, e.ativo, TRUE, 8 FROM organizacoes o
 CROSS JOIN (VALUES ('prazo_d3', TRUE), ('prazo_d1', TRUE), ('prazo_hoje', TRUE), ('prazo_vencido', TRUE), ('tarefa_atribuida', TRUE), ('tarefa_hoje', TRUE),
                    ('tarefa_atrasada', FALSE), ('reuniao_dia', TRUE), ('reuniao_30min', TRUE), ('sentinela_nova_acao', TRUE), ('resumo_diario', FALSE)) AS e(evento, ativo)
 WHERE o.tipo = 'escritorio'
ON CONFLICT DO NOTHING;

-- Agenda da rotina do Slack (só onde há pg_cron), copiando o comando da rotina de análise.
DO $$
DECLARE cmd TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  EXECUTE $q$SELECT command FROM cron.job WHERE command LIKE '%/interno/rotina/analise%' ORDER BY jobid LIMIT 1$q$ INTO cmd;
  IF cmd IS NULL THEN RETURN; END IF;
  EXECUTE $q$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nga-rotina-slack'$q$;
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)', 'nga-rotina-slack', '*/5 * * * *', replace(cmd, '/interno/rotina/analise', '/interno/rotina/slack'));
END $$;
