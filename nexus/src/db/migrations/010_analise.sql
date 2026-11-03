-- 010 — Análise documental: texto extraído, análises e achados.
--
-- A GARANTIA MAIS IMPORTANTE DESTA MIGRAÇÃO
-- O §7.7 exige referência verificável e o §18 proíbe dado falso apresentado
-- como real. Aqui isso virou CHECK: achado produzido por modelo de linguagem
-- não entra na tabela sem trecho citado e sem a posição desse trecho no
-- documento (`achado_ancorado`). Não é convenção de código que se perde na
-- próxima refatoração — é o banco que recusa.
--
-- E o tipo do documento segue o mesmo desenho dos créditos: `tipo_sugerido`
-- é da máquina, `tipo_validado` é de pessoa, e as duas colunas não se
-- confundem em consulta alguma.

-- -------------------------------------------------------- texto extraído ---
-- Um documento, um texto. Reextrair substitui (ON CONFLICT), e a origem fica
-- registrada porque análise sobre OCR ruim não vale o mesmo que análise sobre
-- texto nativo — e quem lê o resultado precisa saber de qual se trata.
CREATE TABLE documento_textos (
  documento_id   UUID PRIMARY KEY REFERENCES documentos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  texto          TEXT NOT NULL,
  caracteres     INTEGER NOT NULL CHECK (caracteres >= 0),
  paginas        INTEGER CHECK (paginas > 0),
  origem         TEXT NOT NULL
                   CHECK (origem IN ('texto_enviado', 'pdf_nativo', 'ocr', 'transcricao')),
  -- Confiança declarada pelo extrator, de 0 a 100. NULL quando não se mede.
  confianca      SMALLINT CHECK (confianca BETWEEN 0 AND 100),
  extraido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  extraido_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------- análise ---
CREATE TABLE analises (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  documento_id   UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  projeto_id     UUID REFERENCES projetos(id) ON DELETE CASCADE,

  -- Classificação da MÁQUINA, com o critério que a produziu.
  tipo_sugerido  TEXT NOT NULL,
  certeza        TEXT NOT NULL CHECK (certeza IN ('alta','media','baixa','nenhuma')),
  pontos         INTEGER NOT NULL DEFAULT 0,
  criterio       TEXT,

  -- Classificação de PESSOA. Enquanto for NULL, nada a jusante pode tratar o
  -- tipo como definitivo.
  tipo_validado  TEXT,
  validado_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  validado_em    TIMESTAMPTZ,
  observacao_validacao TEXT,

  -- Estágio de IA: 'nao_executada' é estado legítimo e frequente, não falha.
  -- `motivo_ia` é obrigatório quando a IA não rodou: o §22 manda nomear o
  -- impedimento em vez de deixar o usuário supondo.
  estagio_ia     TEXT NOT NULL DEFAULT 'nao_executada'
                   CHECK (estagio_ia IN ('nao_executada','executada','indisponivel','recusada','falhou')),
  motivo_ia      TEXT,
  modelo_ia      TEXT,
  tokens_entrada INTEGER CHECK (tokens_entrada >= 0),
  tokens_saida   INTEGER CHECK (tokens_saida >= 0),

  -- Resultados determinísticos, guardados como vieram do domínio.
  identificadores JSONB NOT NULL DEFAULT '[]'::jsonb,
  suspeitas       JSONB NOT NULL DEFAULT '[]'::jsonb,
  citacoes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  alternativas    JSONB NOT NULL DEFAULT '[]'::jsonb,

  partes         INTEGER NOT NULL DEFAULT 0 CHECK (partes >= 0),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,

  CONSTRAINT validacao_identificada CHECK (
    (tipo_validado IS NULL AND validado_por IS NULL AND validado_em IS NULL)
    OR (tipo_validado IS NOT NULL AND validado_por IS NOT NULL AND validado_em IS NOT NULL)
  ),
  -- IA que não rodou tem de dizer por quê.
  CONSTRAINT impedimento_nomeado CHECK (
    estagio_ia IN ('executada','nao_executada') OR motivo_ia IS NOT NULL
  ),
  -- IA que rodou tem de dizer qual modelo: sem isso não há como reproduzir
  -- nem auditar o que foi afirmado.
  CONSTRAINT modelo_declarado CHECK (
    estagio_ia <> 'executada' OR modelo_ia IS NOT NULL
  )
);

CREATE INDEX idx_analises_documento ON analises(documento_id, criado_em DESC);
CREATE INDEX idx_analises_projeto ON analises(projeto_id) WHERE tipo_validado IS NULL;

-- ----------------------------------------------------------------- achados ---
CREATE TABLE achados (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analise_id     UUID NOT NULL REFERENCES analises(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  ordem          INTEGER NOT NULL DEFAULT 0,

  categoria      TEXT NOT NULL,
  gravidade      TEXT NOT NULL DEFAULT 'informacao'
                   CHECK (gravidade IN ('informacao','atencao','critico')),
  titulo         TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 300),
  descricao      TEXT,

  -- §7.7: a natureza da afirmação é obrigatória e explícita. Interpretação
  -- apresentada como legislação é o erro que esta coluna existe para evitar.
  natureza       TEXT NOT NULL
                   CHECK (natureza IN ('legislacao','jurisprudencia','doutrina','interpretacao','hipotese','fato_do_documento')),

  -- Onde o achado se apoia no documento.
  trecho_citado  TEXT,
  trecho_inicio  INTEGER CHECK (trecho_inicio >= 0),
  trecho_fim     INTEGER CHECK (trecho_fim >= 0),
  pagina         INTEGER CHECK (pagina > 0),

  -- Fundamento legal, quando houver, com o status da verificação do corpus.
  fundamento_chave  TEXT,
  fundamento_status TEXT CHECK (fundamento_status IN ('verificada','nao_localizada','nao_verificavel')),

  origem         TEXT NOT NULL CHECK (origem IN ('deterministico','ia')),

  -- Triagem do advogado.
  situacao       TEXT NOT NULL DEFAULT 'aberto'
                   CHECK (situacao IN ('aberto','confirmado','descartado')),
  revisado_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  revisado_em    TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- O PORTÃO. Achado vindo de modelo de linguagem só existe ancorado em
  -- trecho real do documento, com a posição conferida pela aplicação
  -- (ver src/domain/analise/trechos.ts). Sem âncora, não entra.
  CONSTRAINT achado_ancorado CHECK (
    origem <> 'ia'
    OR (trecho_citado IS NOT NULL AND length(trecho_citado) >= 12 AND trecho_inicio IS NOT NULL)
  ),
  CONSTRAINT trecho_coerente CHECK (
    trecho_fim IS NULL OR trecho_inicio IS NULL OR trecho_fim > trecho_inicio
  ),
  -- Fundamento NÃO LOCALIZADO no corpus não pode ser apresentado como
  -- legislação: ou vira hipótese, ou não entra.
  CONSTRAINT fundamento_coerente CHECK (
    fundamento_status <> 'nao_localizada' OR natureza IN ('hipotese','interpretacao')
  ),
  CONSTRAINT revisao_identificada CHECK (
    situacao = 'aberto' OR (revisado_por IS NOT NULL AND revisado_em IS NOT NULL)
  )
);

CREATE INDEX idx_achados_analise ON achados(analise_id, ordem);
CREATE INDEX idx_achados_abertos ON achados(organizacao_id, gravidade) WHERE situacao = 'aberto';
