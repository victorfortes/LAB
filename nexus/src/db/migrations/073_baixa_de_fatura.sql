-- 073 — Baixa de fatura sem anexar arquivo.
--
-- Antes, "paga" exigia comprovante anexado. Agora o financeiro pode dar BAIXA informando data, forma de
-- pagamento e valor recebido (PIX conferido no extrato, compensação, dinheiro...). O comprovante continua
-- aceito e recomendado, mas deixa de ser obrigatório quando há baixa registrada por pessoa do escritório.
ALTER TABLE faturas
  ADD COLUMN baixa_forma TEXT CHECK (baixa_forma IS NULL OR baixa_forma IN ('pix', 'boleto', 'transferencia', 'dinheiro', 'cartao', 'compensacao', 'outro')),
  ADD COLUMN baixa_valor_centavos BIGINT CHECK (baixa_valor_centavos IS NULL OR baixa_valor_centavos > 0),
  ADD COLUMN baixa_observacao TEXT CHECK (baixa_observacao IS NULL OR length(baixa_observacao) <= 1000),
  ADD COLUMN baixa_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN baixa_em TIMESTAMPTZ;

ALTER TABLE faturas DROP CONSTRAINT paga_com_comprovante;
ALTER TABLE faturas ADD CONSTRAINT paga_com_comprovante_ou_baixa CHECK (
  situacao <> 'paga' OR (pago_em IS NOT NULL AND (comprovante_id IS NOT NULL OR (baixa_forma IS NOT NULL AND baixa_por IS NOT NULL))));
