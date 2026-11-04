-- 021 — Negociações (quadro "em negociação / stand by / concluídas" de cada projeto).
--
-- A NGA negocia com credores em nome do cliente. A tabela é INTERNA (sem política de portal): ela guarda a
-- estratégia (`notas_internas`). O cliente só enxerga o que a NGA marcou como `visivel_ao_cliente`, e só
-- pelas colunas seguras da função `negociacoes_do_cliente` — nunca pela tabela, para que as notas internas
-- não tenham caminho até ele mesmo que alguém escreva uma consulta nova (§13).

CREATE TABLE negociacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  credor_id      UUID REFERENCES credores(id) ON DELETE SET NULL,

  titulo         TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 300),
  contraparte    TEXT CHECK (contraparte IS NULL OR length(contraparte) <= 300),
  valor          BIGINT CHECK (valor IS NULL OR valor >= 0),
  status         TEXT NOT NULL DEFAULT 'em_negociacao'
                   CHECK (status IN ('em_negociacao', 'stand_by', 'concluida')),
  desfecho       TEXT CHECK (desfecho IS NULL OR desfecho IN ('acordo', 'sem_acordo')),
  prazo          DATE,
  responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ordem          INTEGER NOT NULL DEFAULT 0,

  -- Interno: estratégia, limites, o que se aceita. Nunca sai daqui.
  notas_internas TEXT,
  -- O que o cliente lê, escrito por gente (como o texto das movimentações publicadas).
  resumo_cliente TEXT CHECK (resumo_cliente IS NULL OR length(resumo_cliente) <= 2000),
  visivel_ao_cliente BOOLEAN NOT NULL DEFAULT FALSE,

  concluida_em   TIMESTAMPTZ,
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT negociacao_conclusao_coerente CHECK (
    (status = 'concluida' AND concluida_em IS NOT NULL)
    OR (status <> 'concluida' AND concluida_em IS NULL AND desfecho IS NULL)
  ),
  -- Publicar ao cliente exige o texto que ele vai ler: não existe "visível" sem resumo escrito.
  CONSTRAINT negociacao_visivel_tem_resumo CHECK (
    NOT visivel_ao_cliente OR (resumo_cliente IS NOT NULL AND length(btrim(resumo_cliente)) >= 10)
  )
);

CREATE INDEX idx_negociacoes_projeto ON negociacoes(projeto_id, status, ordem);

ALTER TABLE negociacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE negociacoes FORCE ROW LEVEL SECURITY;
CREATE POLICY negociacoes_isolamento ON negociacoes
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
GRANT SELECT, INSERT, UPDATE, DELETE ON negociacoes TO nga_app;

-- O que o cliente vê: só linhas publicadas, só do projeto do portal dele, só colunas seguras.
CREATE OR REPLACE FUNCTION negociacoes_do_cliente(p_projeto UUID)
RETURNS TABLE (id UUID, titulo TEXT, contraparte TEXT, status TEXT, desfecho TEXT, resumo TEXT, prazo DATE,
               atualizado_em TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT n.id, n.titulo, n.contraparte, n.status, n.desfecho, n.resumo_cliente, n.prazo, n.atualizado_em
    FROM negociacoes n
   WHERE n.projeto_id = p_projeto
     AND n.visivel_ao_cliente
     AND p_projeto IN (SELECT app_projetos_do_portal())
   ORDER BY n.atualizado_em DESC
$$;
REVOKE ALL ON FUNCTION negociacoes_do_cliente(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION negociacoes_do_cliente(UUID) TO nga_app;
