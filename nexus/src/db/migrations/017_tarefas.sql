-- 017 — Tarefas: o trabalho do dia a dia dentro de cada projeto.
--
-- O projeto tem fase (o marco processual) e prazo (o que a lei impõe); faltava
-- o terceiro eixo, o que a equipe PRECISA FAZER para chegar lá. Tarefa é
-- trabalho interno do escritório: não há política de portal, e o cliente não
-- alcança tarefa alguma por caminho nenhum — mesma regra de prazo e equipe.
--
-- `origem`/`origem_id` ligam a tarefa ao que a gerou (um prazo, um item do
-- checklist, um achado crítico), para o painel dizer de onde veio a pendência
-- em vez de listar tarefa solta.

CREATE TABLE tarefas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,

  titulo         TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 300),
  descricao      TEXT,
  status         TEXT NOT NULL DEFAULT 'a_fazer'
                   CHECK (status IN ('a_fazer', 'em_andamento', 'em_revisao', 'concluida')),
  prioridade     TEXT NOT NULL DEFAULT 'media'
                   CHECK (prioridade IN ('baixa', 'media', 'alta', 'urgente')),
  responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  prazo          DATE,

  origem         TEXT NOT NULL DEFAULT 'manual'
                   CHECK (origem IN ('manual', 'prazo', 'requisito', 'achado', 'credito')),
  origem_id      UUID,

  concluida_em   TIMESTAMPTZ,
  concluida_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Concluir é ato datado e identificado; tarefa que não está concluída não
  -- carrega data de conclusão. Sem isto, "reabrir" deixaria lixo para trás.
  CONSTRAINT conclusao_coerente CHECK (
    (status = 'concluida' AND concluida_em IS NOT NULL)
    OR (status <> 'concluida' AND concluida_em IS NULL)
  )
);

CREATE INDEX idx_tarefas_projeto ON tarefas(projeto_id, status);
CREATE INDEX idx_tarefas_responsavel ON tarefas(responsavel_id) WHERE status <> 'concluida';
CREATE INDEX idx_tarefas_prazo ON tarefas(prazo) WHERE status <> 'concluida' AND prazo IS NOT NULL;

ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas FORCE ROW LEVEL SECURITY;

CREATE POLICY tarefas_isolamento ON tarefas
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

GRANT SELECT, INSERT, UPDATE, DELETE ON tarefas TO nga_app;
