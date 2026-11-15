-- 072 — Gerador de Relatórios dentro do LAB (pedido de 15/11/2026, item 12).
--
-- O relatório de atuação jurídica (mesmo motor e mesmo PDF do Gerador) passa a sair dos dados do LAB.
-- Duas tabelas internas, sem política de portal:
--   relatorio_emissoes      cada PDF gerado (à mão ou pela rotina), com o período, a fonte e o resumo dos números;
--   relatorio_agendamentos  a regra de geração automática por cliente (projeto): mensal, quinzenal ou semanal.
-- A rotina /interno/rotina/relatorios roda de hora em hora (pg_cron, onde houver) e gera o que venceu.

CREATE TABLE relatorio_agendamentos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  frequencia     TEXT NOT NULL CHECK (frequencia IN ('mensal', 'quinzenal', 'semanal')),
  modelo         TEXT NOT NULL DEFAULT 'quantitativo' CHECK (modelo IN ('quantitativo')),
  -- mensal: dia do mês (1 a 28) em que sai o relatório do mês anterior; semanal: dia da semana (1 = segunda ... 7 = domingo)
  -- em que sai o da semana anterior; quinzenal: ignorado (sai no dia 1, com a 2ª quinzena, e no dia 16, com a 1ª).
  dia            SMALLINT NOT NULL DEFAULT 1 CHECK (dia BETWEEN 1 AND 28),
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  proxima_em     DATE NOT NULL,
  ultima_em      TIMESTAMPTZ,
  ultimo_erro    TEXT,
  criado_por     UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (projeto_id),
  CONSTRAINT dia_da_semana CHECK (frequencia <> 'semanal' OR dia BETWEEN 1 AND 7)
);
CREATE INDEX idx_relatorio_agendamentos_vencidos ON relatorio_agendamentos(proxima_em) WHERE ativo;

CREATE TABLE relatorio_emissoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  agendamento_id UUID REFERENCES relatorio_agendamentos(id) ON DELETE SET NULL,
  modelo         TEXT NOT NULL CHECK (modelo IN ('quantitativo')),
  fonte          TEXT NOT NULL CHECK (fonte IN ('lab', 'astrea')),
  periodicidade  TEXT NOT NULL CHECK (periodicidade IN ('mensal', 'quinzenal', 'semanal')),
  periodo_inicio DATE NOT NULL,
  periodo_fim    DATE NOT NULL CHECK (periodo_fim >= periodo_inicio),
  documento_id   UUID REFERENCES documentos(id) ON DELETE SET NULL,
  resumo         JSONB NOT NULL DEFAULT '{}',
  avisos         TEXT[] NOT NULL DEFAULT '{}',
  motor_sha256   TEXT NOT NULL,
  gerado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  gerado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_relatorio_emissoes_projeto ON relatorio_emissoes(projeto_id, gerado_em DESC);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['relatorio_agendamentos', 'relatorio_emissoes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    -- Mesma visibilidade do projeto (inclui a trava por equipe da 048, que mora na política de `projetos`).
    EXECUTE format('CREATE POLICY isolamento ON %I USING (organizacao_id IN (SELECT app_organizacoes_visiveis()) AND projeto_id IN (SELECT id FROM projetos)) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()) AND projeto_id IN (SELECT id FROM projetos))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- A rotina não tem sessão: esta função RESERVA os agendamentos vencidos (marca ultima_em, que vale como trava de
-- 30 minutos contra duas execuções simultâneas) e entrega só o necessário para a rotina agir COMO quem agendou,
-- com o RLS valendo. Quem agendou e foi desativado não gera nada.
CREATE OR REPLACE FUNCTION relatorio_agendamentos_reservar(p_limite INTEGER) RETURNS TABLE (id UUID, projeto_id UUID, usuario_id UUID)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE relatorio_agendamentos a SET ultima_em = now()
   WHERE a.id IN (
     SELECT x.id FROM relatorio_agendamentos x JOIN usuarios u ON u.id = x.criado_por AND u.ativo
      WHERE x.ativo AND x.proxima_em <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
        AND (x.ultima_em IS NULL OR x.ultima_em < now() - interval '30 minutes')
      ORDER BY x.proxima_em LIMIT greatest(1, least(p_limite, 50)) FOR UPDATE OF x SKIP LOCKED)
  RETURNING a.id, a.projeto_id, a.criado_por
$$;
REVOKE ALL ON FUNCTION relatorio_agendamentos_reservar(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION relatorio_agendamentos_reservar(INTEGER) TO nga_app;

-- Falha registrada mesmo quando quem agendou já não enxerga o projeto (saiu da equipe): a tela mostra o motivo.
CREATE OR REPLACE FUNCTION relatorio_agendamento_falhou(p_id UUID, p_erro TEXT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE relatorio_agendamentos SET ultimo_erro = left(p_erro, 500), atualizado_em = now() WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION relatorio_agendamento_falhou(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION relatorio_agendamento_falhou(UUID, TEXT) TO nga_app;

-- Agenda da rotina (só onde há pg_cron), copiando o comando da rotina de análise, como as demais.
DO $$
DECLARE cmd TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  EXECUTE $q$SELECT command FROM cron.job WHERE command LIKE '%/interno/rotina/analise%' ORDER BY jobid LIMIT 1$q$ INTO cmd;
  IF cmd IS NULL THEN RETURN; END IF;
  EXECUTE $q$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nga-rotina-relatorios'$q$;
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)', 'nga-rotina-relatorios', '7 * * * *', replace(cmd, '/interno/rotina/analise', '/interno/rotina/relatorios'));
END $$;
