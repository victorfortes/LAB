-- 008 — Gestão financeira da empresa em reestruturação (§6.6).
--
-- Estes dados são DO CLIENTE: ele lança, ele edita. A NGA lê o que o portal
-- autorizar (`portais.mostra_financeiro`). Por isso `organizacao_id` aqui é a
-- organização do CLIENTE, não a da NGA — é o que faz o RLS funcionar nos dois
-- sentidos sem política especial.

CREATE TABLE contas_financeiras (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  -- Saldo de abertura em centavos. Pode ser negativo (conta garantida).
  saldo_inicial  BIGINT NOT NULL DEFAULT 0,
  data_inicial   DATE NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lancamentos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  conta_id       UUID REFERENCES contas_financeiras(id) ON DELETE SET NULL,

  data           DATE NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
  situacao       TEXT NOT NULL CHECK (situacao IN ('previsto', 'realizado')),
  -- Sempre positivo: o sinal vem de `tipo`. Guardar despesa como negativo e
  -- depois somar tudo é a origem clássica do fluxo de caixa errado.
  valor          BIGINT NOT NULL CHECK (valor >= 0),
  categoria      TEXT NOT NULL,
  contraparte    TEXT,
  documento      TEXT,

  -- Quando o lançamento paga uma obrigação do plano, o vínculo fica explícito:
  -- é o que permite cruzar "o que o plano manda pagar" com "o que foi pago".
  obrigacao_id   UUID REFERENCES obrigacoes(id) ON DELETE SET NULL,

  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lancamentos_projeto_data ON lancamentos(projeto_id, data);
CREATE INDEX idx_lancamentos_previstos ON lancamentos(projeto_id, data)
  WHERE situacao = 'previsto';
