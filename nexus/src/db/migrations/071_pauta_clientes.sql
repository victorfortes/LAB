-- 071 — Pauta por cliente (gestão de reuniões de pauta), para administração, sócios e coordenação.
--
-- A pauta deixa de morar dentro de um único convite do Google: cada cliente tem uma pauta PERMANENTE.
-- O item nasce aberto, entra numa reunião, recebe decisão e, se for o caso, vira tarefa. O que não foi
-- resolvido continua aberto e aparece sozinho na próxima reunião. Só quem tem visão geral usa.

CREATE FUNCTION app_gestao_de_pauta() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM vinculos v WHERE v.usuario_id = app_usuario_id() AND v.revogado_em IS NULL
                   AND v.papel IN ('socio_administrador', 'socio', 'coordenacao'))
$$;
REVOKE ALL ON FUNCTION app_gestao_de_pauta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_gestao_de_pauta() TO nga_app;

CREATE TABLE pauta_reunioes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id    UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id        UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  titulo            TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 200),
  data              DATE NOT NULL,
  situacao          TEXT NOT NULL DEFAULT 'agendada' CHECK (situacao IN ('agendada', 'realizada', 'cancelada')),
  participantes     TEXT CHECK (length(participantes) <= 2000),
  resumo            TEXT CHECK (length(resumo) <= 8000),
  google_evento_id  TEXT,
  ata_id            UUID,
  criado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  realizada_em      TIMESTAMPTZ
);
CREATE INDEX idx_pauta_reunioes_projeto ON pauta_reunioes(projeto_id, data DESC);

CREATE TABLE pauta_itens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id    UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id        UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  titulo            TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 300),
  detalhe           TEXT CHECK (length(detalhe) <= 4000),
  categoria         TEXT NOT NULL DEFAULT 'geral' CHECK (categoria IN ('geral', 'processual', 'negociacao', 'financeiro', 'cliente', 'documentos', 'estrategia')),
  prioridade        TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa', 'media', 'alta', 'urgente')),
  situacao          TEXT NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'discutido', 'encaminhado', 'concluido', 'descartado')),
  decisao           TEXT CHECK (length(decisao) <= 4000),
  responsavel_id    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  reuniao_id        UUID REFERENCES pauta_reunioes(id) ON DELETE SET NULL,
  tarefa_id         UUID REFERENCES tarefas(id) ON DELETE SET NULL,
  ordem             INTEGER NOT NULL DEFAULT 0,
  vezes_em_pauta    INTEGER NOT NULL DEFAULT 0,
  criado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolvido_em      TIMESTAMPTZ
);
CREATE INDEX idx_pauta_itens_projeto ON pauta_itens(projeto_id, situacao);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pauta_reunioes', 'pauta_itens'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t || '_isolamento', t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE USING (app_gestao_de_pauta()) WITH CHECK (app_gestao_de_pauta())', t || '_so_gestao', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- Tarefa que nasce de item de pauta tem origem própria.
ALTER TABLE tarefas DROP CONSTRAINT tarefas_origem_check;
ALTER TABLE tarefas ADD CONSTRAINT tarefas_origem_check CHECK (origem IN ('manual','prazo','requisito','achado','credito','playbook','automacao','pauta'));
