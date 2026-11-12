-- 062 — Extrações do diagnóstico também vêm de PDF com texto (balanço e DRE).
-- A leitura de PDF entra com qualidade "regular" e origem própria, para a tela
-- mostrar que o número precisa de conferência contra o documento.
ALTER TABLE diagnostico_extracoes DROP CONSTRAINT IF EXISTS diagnostico_extracoes_origem_check;
ALTER TABLE diagnostico_extracoes ADD CONSTRAINT diagnostico_extracoes_origem_check
  CHECK (origem IN ('manual', 'planilha', 'modelo', 'pdf_texto'));
