-- 020 — Checklists oficiais da NGA (planilhas "RJ e RE", "Gestão de Passivos", "Proteção Patrimonial").
--
-- Três mudanças de estrutura que as planilhas pedem:
--   1. `atribuicao`: quem deve entregar o documento (CLIENTE, CONTABILIDADE, SÓCIOS ou combinação).
--   2. situação "nao_aplicavel": a coluna "N/A" da planilha. É decisão da NGA (identificada, como aprovar).
--   3. tipo de projeto "protecao_patrimonial": a terceira planilha não corresponde a nenhum tipo existente.

ALTER TABLE requisitos ADD COLUMN atribuicao TEXT;

ALTER TABLE requisitos DROP CONSTRAINT requisitos_situacao_check;
ALTER TABLE requisitos ADD CONSTRAINT requisitos_situacao_check
  CHECK (situacao IN ('pendente','enviado','em_analise','aprovado','rejeitado','complementacao','nao_aplicavel'));

ALTER TABLE requisitos DROP CONSTRAINT analise_identificada;
ALTER TABLE requisitos ADD CONSTRAINT analise_identificada CHECK (
  situacao NOT IN ('aprovado','rejeitado','complementacao','nao_aplicavel')
  OR (analisado_por IS NOT NULL AND analisado_em IS NOT NULL)
);

ALTER TABLE projetos DROP CONSTRAINT projetos_tipo_check;
ALTER TABLE projetos ADD CONSTRAINT projetos_tipo_check CHECK (tipo IN (
  'recuperacao_judicial', 'recuperacao_extrajudicial', 'falencia',
  'reestruturacao', 'negociacao_credores', 'investigacao_patrimonial',
  'contencioso_estrategico', 'consultivo', 'protecao_patrimonial'));
