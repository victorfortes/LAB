-- 015 — Projeto como entidade de trabalho: fase e equipe.
--
-- O projeto já era a espinha do sistema — crédito, plano, assembleia, portal,
-- checklist, documento, análise, processo e relatório todos se penduram nele.
-- Faltavam as duas coisas que fazem dele algo que se GERENCIA: em que ponto
-- do procedimento ele está, e quem responde por ele.
--
-- A FASE É LISTA FECHADA, validada na aplicação contra o tipo do projeto
-- (src/domain/projeto/fases.ts). Aqui o banco guarda o identificador e a data
-- de entrada; a sequência legal de cada procedimento vive no domínio, porque
-- é regra jurídica e muda com a lei, não com o schema.
--
-- E UM LÍDER POR PROJETO, garantido por índice. "Todo mundo responde" é como
-- um prazo passa: o índice parcial abaixo torna dois líderes ativos
-- impossíveis, em vez de improváveis.

ALTER TABLE projetos
  ADD COLUMN fase        TEXT,
  ADD COLUMN fase_desde  DATE,
  ADD COLUMN encerrado_em DATE,
  ADD COLUMN motivo_encerramento TEXT,
  -- Resumo do caso em uma frase, para a tela e para o relatório.
  ADD COLUMN resumo      TEXT;

ALTER TABLE projetos
  ADD CONSTRAINT fase_datada CHECK (
    (fase IS NULL AND fase_desde IS NULL) OR (fase IS NOT NULL AND fase_desde IS NOT NULL)
  ),
  -- Encerrar é ato datado e motivado: "encerrado" sem motivo é informação
  -- que ninguém consegue usar seis meses depois.
  ADD CONSTRAINT encerramento_motivado CHECK (
    situacao <> 'encerrado'
    OR (encerrado_em IS NOT NULL AND motivo_encerramento IS NOT NULL)
  );

-- ------------------------------------------------------------------ equipe ---

CREATE TABLE projeto_equipe (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id  UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  papel       TEXT NOT NULL CHECK (papel IN ('lider', 'advogado', 'apoio', 'revisor')),
  desde       DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Saída da equipe. Não se apaga a linha: quem trabalhou no caso em 2024
  -- continua tendo trabalhado nele.
  ate         DATE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT periodo_coerente CHECK (ate IS NULL OR ate >= desde)
);

-- A mesma pessoa não entra duas vezes no mesmo papel enquanto estiver ativa.
CREATE UNIQUE INDEX idx_equipe_ativa
  ON projeto_equipe(projeto_id, usuario_id, papel) WHERE ate IS NULL;

-- Um líder ativo por projeto. "Todo mundo responde" é como um prazo passa.
CREATE UNIQUE INDEX idx_equipe_um_lider
  ON projeto_equipe(projeto_id) WHERE papel = 'lider' AND ate IS NULL;

CREATE INDEX idx_equipe_usuario ON projeto_equipe(usuario_id) WHERE ate IS NULL;

ALTER TABLE projeto_equipe ENABLE ROW LEVEL SECURITY;
ALTER TABLE projeto_equipe FORCE ROW LEVEL SECURITY;

-- Equipe é dado interno do escritório: não há política de portal, e o cliente
-- não alcança a composição do time por caminho nenhum.
CREATE POLICY equipe_isolamento ON projeto_equipe
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

GRANT SELECT, INSERT, UPDATE, DELETE ON projeto_equipe TO nga_app;
