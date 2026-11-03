-- 002 — Domínio de insolvência.
--
-- Esta é a lacuna central do Nexus atual: buscando
-- `creditor|credores|habilitac|quirograf|assembleia|agc|plano_recuper` no bundle
-- inteiro da aplicação em produção, há ZERO ocorrências. É exatamente a
-- especialidade da NGA e não existia modelagem alguma para ela.
--
-- Valores sempre em BIGINT de centavos, pareados com `src/domain/shared/dinheiro.ts`.

-- --------------------------------------------------------------- credores ---

CREATE TABLE credores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  -- Quando o credor também é empresa cadastrada, aponta para ela; evita o
  -- cadastro paralelo que o §20 proíbe.
  empresa_id     UUID REFERENCES empresas(id) ON DELETE SET NULL,
  nome           TEXT NOT NULL,
  documento      TEXT,
  me_epp         BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credores_projeto ON credores(projeto_id);

-- ---------------------------------------------------------------- créditos ---

CREATE TABLE creditos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id  UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id      UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  credor_id       UUID NOT NULL REFERENCES credores(id) ON DELETE RESTRICT,

  valor           BIGINT NOT NULL CHECK (valor >= 0),
  natureza        TEXT NOT NULL CHECK (natureza IN (
                    'trabalhista', 'acidente_trabalho', 'garantia_real', 'quirografario',
                    'privilegio_especial', 'privilegio_geral', 'subordinado', 'me_epp',
                    'tributario', 'proprietario_fiduciario', 'arrendamento_mercantil',
                    'reserva_dominio', 'promitente_vendedor_irrevogavel',
                    'adiantamento_contrato_cambio', 'posterior_ao_pedido')),
  valor_bem_gravado BIGINT CHECK (valor_bem_gravado >= 0),

  -- Enquadramento SUGERIDO pelo domínio. Separado do validado de propósito:
  -- o §7.7 e o §6.6 do briefing proíbem que a sujeição concursal se decida
  -- sozinha. Enquanto `classe_validada` for NULL, nada a jusante pode tratar a
  -- classe como definitiva.
  classe_sugerida TEXT CHECK (classe_sugerida IN ('I', 'II', 'III', 'IV')),
  sujeito_sugerido BOOLEAN,
  fundamentos     JSONB,
  ressalvas       JSONB,

  classe_validada TEXT CHECK (classe_validada IN ('I', 'II', 'III', 'IV')),
  sujeito_validado BOOLEAN,
  validado_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  validado_em     TIMESTAMPTZ,
  observacao_validacao TEXT,

  origem          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (origem IN ('manual', 'edital', 'importacao', 'analise_documental')),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Quem valida, assina: as duas colunas andam juntas ou nenhuma anda.
  CONSTRAINT validacao_completa CHECK (
    (classe_validada IS NULL AND validado_por IS NULL AND validado_em IS NULL)
    OR (classe_validada IS NOT NULL AND validado_por IS NOT NULL AND validado_em IS NOT NULL)
  ),
  -- Garantia real sem avaliação do bem não permite o desdobramento do
  -- art. 41, § 2º; o valor só é exigido quando a classe foi validada como II.
  CONSTRAINT garantia_avaliada CHECK (
    classe_validada IS DISTINCT FROM 'II' OR valor_bem_gravado IS NOT NULL
  )
);

CREATE INDEX idx_creditos_projeto ON creditos(projeto_id);
CREATE INDEX idx_creditos_pendentes ON creditos(projeto_id) WHERE classe_validada IS NULL;

-- ----------------------------------------------------------------- planos ---

CREATE TABLE planos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  -- Modificativos encadeiam no plano que alteram: é o que permite a
  -- comparação do §21.4.
  altera_plano_id UUID REFERENCES planos(id) ON DELETE SET NULL,
  versao         INTEGER NOT NULL DEFAULT 1,
  titulo         TEXT NOT NULL,
  data_base      DATE NOT NULL,
  apresentado_em DATE,
  homologado_em  DATE,
  situacao       TEXT NOT NULL DEFAULT 'minuta'
                   CHECK (situacao IN ('minuta', 'apresentado', 'aprovado', 'homologado', 'rejeitado')),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, versao)
);

-- Condições por classe (ou por subgrupo dentro da classe: credor colaborador,
-- faixa de valor). Pareia com `CondicaoDePagamento` do domínio.
CREATE TABLE condicoes_pagamento (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id       UUID NOT NULL REFERENCES planos(id) ON DELETE CASCADE,
  classe         TEXT NOT NULL CHECK (classe IN ('I', 'II', 'III', 'IV')),
  subgrupo       TEXT,
  desagio        NUMERIC(6,5) NOT NULL DEFAULT 0 CHECK (desagio >= 0 AND desagio < 1),
  carencia_meses INTEGER NOT NULL DEFAULT 0 CHECK (carencia_meses >= 0),
  parcelas       INTEGER NOT NULL CHECK (parcelas > 0),
  periodicidade  TEXT NOT NULL CHECK (periodicidade IN ('mensal','bimestral','trimestral','semestral','anual')),
  juros_ao_ano   NUMERIC(6,5) NOT NULL DEFAULT 0 CHECK (juros_ao_ano >= 0),
  regime_juros   TEXT NOT NULL DEFAULT 'nominal' CHECK (regime_juros IN ('nominal','efetiva')),
  sistema        TEXT NOT NULL CHECK (sistema IN ('price','sac','sem_juros')),
  capitaliza_carencia BOOLEAN NOT NULL DEFAULT FALSE,
  indice_correcao TEXT
);

-- Cronograma materializado: cada obrigação do plano vira linha, porque é dela
-- que saem o calendário, o alerta de vencimento e a prova do descumprimento.
CREATE TABLE obrigacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  plano_id       UUID NOT NULL REFERENCES planos(id) ON DELETE CASCADE,
  credito_id     UUID NOT NULL REFERENCES creditos(id) ON DELETE CASCADE,
  numero         INTEGER NOT NULL CHECK (numero > 0),
  vencimento     DATE NOT NULL,
  saldo_inicial  BIGINT NOT NULL,
  juros          BIGINT NOT NULL DEFAULT 0,
  amortizacao    BIGINT NOT NULL,
  valor          BIGINT NOT NULL,
  saldo_final    BIGINT NOT NULL CHECK (saldo_final >= 0),
  pago_em        DATE,
  valor_pago     BIGINT CHECK (valor_pago >= 0),
  UNIQUE (plano_id, credito_id, numero),
  CONSTRAINT valor_fecha CHECK (valor = amortizacao + juros),
  CONSTRAINT saldo_fecha CHECK (saldo_final = saldo_inicial - amortizacao)
);

CREATE INDEX idx_obrigacoes_vencimento ON obrigacoes(vencimento) WHERE pago_em IS NULL;
CREATE INDEX idx_obrigacoes_plano ON obrigacoes(plano_id);

-- ------------------------------------------------------------------- AGC ---

CREATE TABLE assembleias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  plano_id       UUID REFERENCES planos(id) ON DELETE SET NULL,
  convocacao     TEXT NOT NULL DEFAULT 'primeira' CHECK (convocacao IN ('primeira','segunda')),
  data_hora      TIMESTAMPTZ NOT NULL,
  edital_publicado_em DATE,
  prazo_credenciamento DATE,
  situacao       TEXT NOT NULL DEFAULT 'convocada'
                   CHECK (situacao IN ('convocada','instalada','suspensa','encerrada')),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE votos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assembleia_id  UUID NOT NULL REFERENCES assembleias(id) ON DELETE CASCADE,
  credito_id     UUID NOT NULL REFERENCES creditos(id) ON DELETE RESTRICT,
  -- Classe e valor com que a parcela efetivamente votou, já desdobrada pelo
  -- art. 41, § 2º. Congelados no momento do voto: a apuração tem de poder ser
  -- refeita anos depois, mesmo que o crédito seja retificado por impugnação.
  classe         TEXT NOT NULL CHECK (classe IN ('I','II','III','IV')),
  valor          BIGINT NOT NULL CHECK (valor >= 0),
  voto           TEXT NOT NULL CHECK (voto IN ('sim','nao','abstencao')),
  registrado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  registrado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assembleia_id, credito_id, classe)
);

CREATE INDEX idx_votos_assembleia ON votos(assembleia_id);

-- Apuração registrada: o resultado calculado em determinado instante, com os
-- votos que o produziram. Recalcular depois não pode apagar o que foi apurado
-- na assembleia.
CREATE TABLE apuracoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assembleia_id  UUID NOT NULL REFERENCES assembleias(id) ON DELETE CASCADE,
  resultado      JSONB NOT NULL,
  aprovado_art45 BOOLEAN NOT NULL,
  cram_down_cabivel BOOLEAN NOT NULL,
  apurado_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  apurado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE RULE apuracoes_sem_update AS ON UPDATE TO apuracoes DO INSTEAD NOTHING;
