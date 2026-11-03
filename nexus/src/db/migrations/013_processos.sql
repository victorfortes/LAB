-- 013 — Processos, partes, movimentações e prazos.
--
-- DUAS GARANTIAS ESTRUTURAIS AQUI
--
-- 1. O NÚMERO DO PROCESSO É CONFERIDO. O CHECK exige a forma do número único
--    da Res. CNJ 65/2008, e a aplicação ainda confere o dígito verificador
--    antes de gravar (src/domain/analise/identificadores.ts). Processo com
--    número errado é consulta que nunca acha nada e prazo que ninguém vê.
--
-- 2. MOVIMENTAÇÃO NASCE INVISÍVEL AO CLIENTE. Mesmo desenho dos documentos
--    (migração 007): `visivel_ao_cliente` começa falso, e virar verdadeiro
--    exige quem publicou, quando e um resumo escrito por gente. O §6.3 pede
--    movimentação "traduzida" para o cliente — e tradução automática de
--    andamento processual é como se promete ao cliente uma vitória que não
--    houve. Aqui a tradução é ato humano, registrado.
--
-- PRAZOS SÃO SÓ DA NGA. Não há política de portal sobre eles, de propósito:
-- prazo é controle interno do escritório, e um prazo perdido visível ao
-- cliente é conversa que se tem pessoalmente, não por listagem automática.

ALTER TABLE portais ADD COLUMN mostra_processos BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE processos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID REFERENCES projetos(id) ON DELETE SET NULL,

  -- Forma canônica NNNNNNN-DD.AAAA.J.TR.OOOO.
  numero         TEXT NOT NULL
                   CHECK (numero ~ '^[0-9]{7}-[0-9]{2}\.[0-9]{4}\.[0-9]\.[0-9]{2}\.[0-9]{4}$'),
  classe         TEXT,
  assunto        TEXT,
  tribunal       TEXT,
  orgao_julgador TEXT,
  comarca        TEXT,
  uf             CHAR(2),
  juizo          TEXT,
  valor_causa    BIGINT CHECK (valor_causa >= 0),
  distribuido_em DATE,
  segredo_justica BOOLEAN NOT NULL DEFAULT FALSE,

  situacao       TEXT NOT NULL DEFAULT 'ativo'
                   CHECK (situacao IN ('ativo','suspenso','baixado','arquivado','extinto')),
  -- Suspensão: na insolvência quase sempre é o stay do art. 6º da LREF, e
  -- saber até quando vale é metade do trabalho.
  suspenso_motivo TEXT,
  suspenso_ate   DATE,

  fonte          TEXT NOT NULL DEFAULT 'manual'
                   CHECK (fonte IN ('manual','datajud','djen','astrea')),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- O mesmo processo não entra duas vezes para a mesma organização.
  UNIQUE (organizacao_id, numero),
  -- Processo suspenso tem de dizer por quê; sem isso a lista de suspensos
  -- vira um conjunto de casos que ninguém sabe por que parou.
  CONSTRAINT suspensao_motivada CHECK (
    situacao <> 'suspenso' OR suspenso_motivo IS NOT NULL
  )
);

CREATE INDEX idx_processos_projeto ON processos(projeto_id);
CREATE INDEX idx_processos_situacao ON processos(organizacao_id, situacao);

-- ------------------------------------------------------------------ partes ---

CREATE TABLE partes_processo (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id    UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  nome           TEXT NOT NULL,
  documento      TEXT,
  tipo_documento TEXT CHECK (tipo_documento IN ('cnpj','cpf')),
  polo           TEXT NOT NULL CHECK (polo IN ('ativo','passivo','terceiro')),
  -- Papel processual: recuperanda, credor, administrador judicial, MP…
  papel          TEXT,
  -- Esta parte é cliente da NGA neste processo?
  eh_cliente     BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_partes_processo ON partes_processo(processo_id, polo);
CREATE INDEX idx_partes_documento ON partes_processo(documento) WHERE documento IS NOT NULL;

-- ----------------------------------------------------------- movimentações ---

CREATE TABLE movimentacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id    UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  data           DATE NOT NULL,
  titulo         TEXT NOT NULL,
  conteudo       TEXT,
  -- Código da Tabela Processual Unificada do CNJ, quando a fonte traz.
  codigo_cnj     INTEGER,
  fonte          TEXT NOT NULL DEFAULT 'manual'
                   CHECK (fonte IN ('manual','datajud','djen','astrea')),
  -- Identificador na origem: é o que evita duplicar a mesma movimentação a
  -- cada sincronização.
  externo_id     TEXT,

  -- Nasce invisível ao cliente. Sempre.
  visivel_ao_cliente BOOLEAN NOT NULL DEFAULT FALSE,
  -- O texto que o cliente lê. Escrito por gente, não gerado.
  resumo_ao_cliente  TEXT,
  publicado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  publicado_em   TIMESTAMPTZ,

  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,

  UNIQUE (processo_id, fonte, externo_id),
  -- Publicar é ato identificado, e sem resumo não se publica: despejar o
  -- andamento cru no portal não é traduzir nada (§6.3).
  CONSTRAINT publicacao_ao_cliente CHECK (
    (NOT visivel_ao_cliente AND publicado_por IS NULL AND publicado_em IS NULL)
    OR (visivel_ao_cliente AND publicado_por IS NOT NULL AND publicado_em IS NOT NULL
        AND resumo_ao_cliente IS NOT NULL AND length(btrim(resumo_ao_cliente)) >= 10)
  )
);

CREATE INDEX idx_movimentacoes_processo ON movimentacoes(processo_id, data DESC);
CREATE INDEX idx_movimentacoes_publicadas
  ON movimentacoes(processo_id, data DESC) WHERE visivel_ao_cliente;

-- ------------------------------------------------------------------ prazos ---

CREATE TABLE prazos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id    UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  movimentacao_id UUID REFERENCES movimentacoes(id) ON DELETE SET NULL,

  titulo         TEXT NOT NULL,
  tipo           TEXT,
  evento         DATE NOT NULL,
  origem         TEXT NOT NULL
                   CHECK (origem IN ('disponibilizacao_dje','publicacao','intimacao_pessoal',
                                     'juntada_ar','citacao','audiencia','manual')),
  dias           INTEGER NOT NULL CHECK (dias > 0),
  regime         TEXT NOT NULL CHECK (regime IN ('uteis','corridos')),
  em_dobro       BOOLEAN NOT NULL DEFAULT FALSE,
  vencimento     DATE NOT NULL,
  -- O cálculo inteiro, com fundamentos e dias pulados. É o que permite
  -- refazer a conta meses depois e saber de onde veio a data.
  calculo        JSONB NOT NULL,

  responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  situacao       TEXT NOT NULL DEFAULT 'aberto'
                   CHECK (situacao IN ('aberto','cumprido','perdido','cancelado')),
  cumprido_em    TIMESTAMPTZ,
  observacao     TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,

  -- Fechar um prazo é ato datado: "cumprido" sem data não vale como controle.
  CONSTRAINT fechamento_datado CHECK (
    situacao = 'aberto' OR cumprido_em IS NOT NULL
  ),
  CONSTRAINT vencimento_posterior CHECK (vencimento >= evento)
);

CREATE INDEX idx_prazos_abertos ON prazos(organizacao_id, vencimento) WHERE situacao = 'aberto';
CREATE INDEX idx_prazos_processo ON prazos(processo_id, vencimento);
