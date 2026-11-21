-- 076 — Cumprimento de tarefa: juntar a peça pelo LAB e resumir sozinho.
--
-- O advogado cumpre o prazo DENTRO do sistema: lê o contexto do processo, sobe
-- a peça (que vira documento do projeto e já sincroniza para o Drive) e conclui
-- a tarefa. Ao concluir, o sistema lê a peça e grava um resumo como andamento do
-- processo.
--
-- Mas o resumo é HONESTO (§22): sem chave de IA ele NÃO é inventado. O andamento
-- nasce com "resumo pendente — IA não configurada" e o motivo exato; quando a
-- chave existir, a rotina de reprocessamento lê a peça e preenche o resumo
-- sozinha. Por isso precisamos de duas coisas:
--
--   1. Guardar o resumo que o estágio de IA produziu, na própria análise. Até
--      aqui o `resumo` saía só na resposta HTTP e se perdia; agora fica gravado,
--      auditável e consultável — inclusive para preencher o andamento depois.
--   2. Um registro de cada peça cumprida, ligando tarefa → documento → processo
--      → andamento, com o estado do resumo ('gerado' ou 'pendente'). É o que a
--      rotina varre para completar o que faltou quando a IA passar a existir.

ALTER TABLE analises ADD COLUMN IF NOT EXISTS resumo TEXT;

-- Uma linha por peça juntada ao cumprir a tarefa. O andamento pode ser uma
-- movimentação (quando há processo) ou um histórico do projeto (quando não há);
-- `processo_id` diz qual, e `andamento_id` aponta para a linha correspondente.
CREATE TABLE peca_cumprimento (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id  UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  tarefa_id       UUID REFERENCES tarefas(id) ON DELETE SET NULL,
  projeto_id      UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  processo_id     UUID REFERENCES processos(id) ON DELETE SET NULL,
  documento_id    UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  -- Movimentação (com processo) ou histórico do projeto (sem processo). Guardado
  -- sem FK porque aponta para uma de duas tabelas, conforme `processo_id`.
  andamento_id    UUID,
  -- 'gerado' = o resumo da IA já está no andamento; 'pendente' = o andamento tem
  -- o aviso de IA não configurada e espera a rotina preencher.
  estado          TEXT NOT NULL DEFAULT 'pendente'
                    CHECK (estado IN ('gerado','pendente')),
  -- Quando pendente, por quê (o impedimento nomeado do §22).
  motivo          TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Uma peça por documento: concluir a mesma tarefa de novo não duplica andamento.
  UNIQUE (documento_id)
);

CREATE INDEX idx_peca_cumprimento_pendente ON peca_cumprimento(criado_em)
  WHERE estado = 'pendente';

ALTER TABLE peca_cumprimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE peca_cumprimento FORCE ROW LEVEL SECURITY;
-- Trabalho interno, como a análise: sem política de portal, o cliente não alcança.
CREATE POLICY peca_cumprimento_isolamento ON peca_cumprimento
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

GRANT SELECT, INSERT, UPDATE, DELETE ON peca_cumprimento TO nga_app;

-- Lista as peças cujo resumo ficou pendente, por cima do RLS (como a fila de
-- análise). A rotina de reprocessamento as processa uma a uma, já dentro do
-- contexto da organização dona de cada documento.
CREATE OR REPLACE FUNCTION pecas_com_resumo_pendente(p_limite integer DEFAULT 5)
RETURNS TABLE(id uuid, documento_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pc.id, pc.documento_id FROM peca_cumprimento pc
  JOIN documentos d ON d.id = pc.documento_id AND d.tem_arquivo
  WHERE pc.estado = 'pendente'
  ORDER BY pc.criado_em LIMIT greatest(1, least(coalesce(p_limite, 5), 20))
$$;
REVOKE ALL ON FUNCTION pecas_com_resumo_pendente(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pecas_com_resumo_pendente(integer) TO nga_app;
