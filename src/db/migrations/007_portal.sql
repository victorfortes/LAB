-- 007 — Portal do cliente: acesso, documentos e checklist.
--
-- A GARANTIA MAIS IMPORTANTE DESTA MIGRAÇÃO
-- O §13 é categórico: "Um documento interno nunca poderá ser disponibilizado
-- automaticamente no portal externo." Aqui isso não é regra de aplicação, é
-- estrutura: `documentos.visibilidade` nasce 'interno', e virar 'publicado'
-- exige quem publicou e quando — com CHECK que não deixa os três saírem de
-- sincronia. A política de RLS do portal filtra por essa coluna, então nem uma
-- consulta errada na aplicação consegue vazar documento interno.

-- O vínculo entre a organização do CLIENTE e o projeto, que pertence à NGA.
-- Sem uma linha aqui, o cliente não enxerga absolutamente nada do projeto.
CREATE TABLE portais (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id        UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  organizacao_cliente_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  -- O que este portal expõe. Desligar é imediato e não depende de deploy.
  mostra_documentos BOOLEAN NOT NULL DEFAULT TRUE,
  mostra_obrigacoes BOOLEAN NOT NULL DEFAULT TRUE,
  mostra_financeiro BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  UNIQUE (projeto_id, organizacao_cliente_id)
);

CREATE INDEX idx_portais_cliente ON portais(organizacao_cliente_id) WHERE ativo;

-- ------------------------------------------------------------- documentos ---

CREATE TABLE documentos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID REFERENCES projetos(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL,
  categoria      TEXT,
  -- Caminho no armazenamento. O arquivo NUNCA é servido por URL pública
  -- permanente (§12.4): o acesso é por URL temporária assinada.
  caminho        TEXT NOT NULL,
  tamanho_bytes  BIGINT CHECK (tamanho_bytes >= 0),
  tipo_mime      TEXT,
  -- Hash do conteúdo: integridade e deduplicação.
  hash_sha256    TEXT,
  versao         INTEGER NOT NULL DEFAULT 1,
  substitui_id   UUID REFERENCES documentos(id) ON DELETE SET NULL,

  -- Nasce interno. Sempre.
  visibilidade   TEXT NOT NULL DEFAULT 'interno'
                   CHECK (visibilidade IN ('interno', 'publicado')),
  publicado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  publicado_em   TIMESTAMPTZ,

  enviado_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  origem         TEXT NOT NULL DEFAULT 'interno'
                   CHECK (origem IN ('interno', 'portal_cliente', 'captura', 'analise')),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Publicar é ato identificado: não existe documento publicado por ninguém.
  CONSTRAINT publicacao_identificada CHECK (
    (visibilidade = 'interno'  AND publicado_por IS NULL AND publicado_em IS NULL)
    OR (visibilidade = 'publicado' AND publicado_por IS NOT NULL AND publicado_em IS NOT NULL)
  )
);

CREATE INDEX idx_documentos_projeto ON documentos(projeto_id);
CREATE INDEX idx_documentos_publicados ON documentos(projeto_id) WHERE visibilidade = 'publicado';

-- --------------------------------------------------------------- checklist ---

CREATE TABLE requisitos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  categoria      TEXT NOT NULL,
  titulo         TEXT NOT NULL,
  fundamento     TEXT,
  obrigatorio    BOOLEAN NOT NULL DEFAULT TRUE,
  ordem          INTEGER NOT NULL DEFAULT 0,

  situacao       TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (situacao IN ('pendente','enviado','em_analise','aprovado','rejeitado','complementacao')),
  -- Documento que atende ao requisito, quando enviado.
  documento_id   UUID REFERENCES documentos(id) ON DELETE SET NULL,
  -- Observação da NGA ao rejeitar ou pedir complementação: é o que o cliente lê.
  observacao     TEXT,
  analisado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  analisado_em   TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Aprovar, rejeitar ou pedir complementação é ato de alguém da NGA.
  CONSTRAINT analise_identificada CHECK (
    situacao NOT IN ('aprovado','rejeitado','complementacao')
    OR (analisado_por IS NOT NULL AND analisado_em IS NOT NULL)
  ),
  -- Não existe item enviado sem documento anexado.
  CONSTRAINT envio_tem_documento CHECK (
    situacao NOT IN ('enviado','em_analise','aprovado') OR documento_id IS NOT NULL
  )
);

CREATE INDEX idx_requisitos_projeto ON requisitos(projeto_id, ordem);

-- ------------------------------------------------------------ comunicação ---

CREATE TABLE mensagens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  requisito_id   UUID REFERENCES requisitos(id) ON DELETE CASCADE,
  autor_id       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  -- De que lado veio: decide quem enxerga e como a interface mostra.
  lado           TEXT NOT NULL CHECK (lado IN ('nga', 'cliente')),
  texto          TEXT NOT NULL CHECK (length(texto) BETWEEN 1 AND 10000),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mensagens_projeto ON mensagens(projeto_id, criado_em DESC);
