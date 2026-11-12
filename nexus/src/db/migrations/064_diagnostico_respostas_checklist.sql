-- 064 — O diagnóstico também guarda as respostas do cliente ao checklist (planilha).
ALTER TABLE diagnostico_extracoes DROP CONSTRAINT IF EXISTS diagnostico_extracoes_tipo_check;
ALTER TABLE diagnostico_extracoes ADD CONSTRAINT diagnostico_extracoes_tipo_check
  CHECK (tipo IN ('balanco', 'dre_contabil', 'dre_gerencial', 'faturamento', 'extrato', 'passivo_fonte', 'clientes_abc', 'partes_relacionadas', 'checklist_respostas'));
