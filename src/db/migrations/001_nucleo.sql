-- 001 — Núcleo: organizações, pessoas, clientes, grupo econômico, projetos.
--
-- Princípios desta base:
--  * Dinheiro é BIGINT em centavos. Nunca FLOAT, nunca NUMERIC com escala solta.
--  * Entidade de negócio é tabela relacional. JSONB só para o que é mesmo
--    heterogêneo (metadados de origem, payload de integração).
--  * Todo acesso passa por RLS; o frontend não é fronteira de segurança.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- tenancy ---

-- A NGA é um tenant; cada cliente com portal é outro. O isolamento entre eles
-- é a garantia mais importante do sistema.
CREATE TABLE organizacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          TEXT NOT NULL CHECK (tipo IN ('escritorio', 'cliente', 'parceiro')),
  nome          TEXT NOT NULL,
  cnpj          TEXT UNIQUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  arquivado_em  TIMESTAMPTZ
);

CREATE TABLE usuarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  nome           TEXT NOT NULL,
  senha_hash     TEXT NOT NULL,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_segredo    TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acesso  TIMESTAMPTZ
);

-- Perfis do §13 do briefing. Um usuário pode ter papéis diferentes em
-- organizações diferentes (sócio na NGA, nada no portal do cliente).
CREATE TABLE vinculos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  papel          TEXT NOT NULL CHECK (papel IN (
                   'socio_administrador', 'socio', 'advogado', 'controladoria',
                   'financeiro', 'administrativo', 'estagiario',
                   'cliente_administrador', 'cliente_usuario', 'parceiro_externo')),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revogado_em    TIMESTAMPTZ,
  UNIQUE (usuario_id, organizacao_id, papel)
);

CREATE INDEX idx_vinculos_usuario ON vinculos(usuario_id) WHERE revogado_em IS NULL;

-- ------------------------------------------------------- clientes e grupos ---

-- Uma empresa é cadastrada UMA vez e reaproveitada por todos os módulos (§20).
CREATE TABLE empresas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  cnpj           TEXT,
  razao_social   TEXT NOT NULL,
  nome_fantasia  TEXT,
  situacao       TEXT,
  endereco       JSONB,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- O CNPJ é único dentro da organização, mas empresas sem CNPJ (estrangeiras,
  -- entes despersonalizados) também precisam caber.
  UNIQUE (organizacao_id, cnpj)
);

CREATE TABLE grupos_economicos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  nome           TEXT NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma empresa pode integrar mais de um grupo conforme a relação juridicamente
-- pertinente (§20), por isso a relação é N:N e carrega o fundamento.
CREATE TABLE empresas_grupos (
  grupo_id    UUID NOT NULL REFERENCES grupos_economicos(id) ON DELETE CASCADE,
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  relacao     TEXT NOT NULL CHECK (relacao IN (
                'controladora', 'controlada', 'coligada', 'mesma_direcao',
                'socio_comum', 'indicada_por_analise')),
  fundamento  TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (grupo_id, empresa_id)
);

-- --------------------------------------------------------------- projetos ---

CREATE TABLE projetos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  grupo_id       UUID REFERENCES grupos_economicos(id) ON DELETE SET NULL,
  nome           TEXT NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN (
                   'recuperacao_judicial', 'recuperacao_extrajudicial', 'falencia',
                   'reestruturacao', 'negociacao_credores', 'investigacao_patrimonial',
                   'contencioso_estrategico', 'consultivo')),
  situacao       TEXT NOT NULL DEFAULT 'ativo'
                   CHECK (situacao IN ('proposto', 'ativo', 'suspenso', 'encerrado')),
  prioridade     SMALLINT NOT NULL DEFAULT 3 CHECK (prioridade BETWEEN 1 AND 5),
  responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  iniciado_em    DATE,
  previsao_fim   DATE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projetos_org ON projetos(organizacao_id, situacao);

CREATE TABLE projetos_empresas (
  projeto_id UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  papel      TEXT NOT NULL CHECK (papel IN ('recuperanda', 'devedora', 'credora', 'relacionada')),
  PRIMARY KEY (projeto_id, empresa_id)
);

-- --------------------------------------------------------------- auditoria ---

-- Append-only. O §13 exige trilha; a trilha só vale se não puder ser reescrita.
CREATE TABLE auditoria (
  id             BIGSERIAL PRIMARY KEY,
  organizacao_id UUID REFERENCES organizacoes(id) ON DELETE SET NULL,
  usuario_id     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  acao           TEXT NOT NULL,
  entidade       TEXT NOT NULL,
  entidade_id    TEXT,
  antes          JSONB,
  depois         JSONB,
  origem         TEXT,
  ocorrido_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auditoria_entidade ON auditoria(entidade, entidade_id, ocorrido_em DESC);
CREATE INDEX idx_auditoria_org ON auditoria(organizacao_id, ocorrido_em DESC);

CREATE RULE auditoria_sem_update AS ON UPDATE TO auditoria DO INSTEAD NOTHING;
CREATE RULE auditoria_sem_delete AS ON DELETE TO auditoria DO INSTEAD NOTHING;
