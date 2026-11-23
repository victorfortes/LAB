-- 080: leitores de documentos do diagnóstico (22/11/2026). Extrato em PDF, contrato de crédito, SCR, vigência de
-- licença/apólice e planilhas de endividamento, QGC, curva ABC de fornecedores, serviço da dívida e fluxo de caixa.
-- Origem nova: texto reconhecido por OCR no navegador (documento digitalizado).
ALTER TABLE diagnostico_extracoes DROP CONSTRAINT IF EXISTS diagnostico_extracoes_tipo_check;
ALTER TABLE diagnostico_extracoes ADD CONSTRAINT diagnostico_extracoes_tipo_check
  CHECK (tipo IN ('balanco', 'dre_contabil', 'dre_gerencial', 'faturamento', 'extrato', 'passivo_fonte', 'clientes_abc', 'partes_relacionadas', 'checklist_respostas',
                  'contrato_credito', 'scr', 'vigencia', 'endividamento', 'qgc', 'fornecedores_abc', 'servico_divida', 'fluxo_projetado', 'matricula', 'contrato_social'));
ALTER TABLE diagnostico_extracoes DROP CONSTRAINT IF EXISTS diagnostico_extracoes_origem_check;
ALTER TABLE diagnostico_extracoes ADD CONSTRAINT diagnostico_extracoes_origem_check
  CHECK (origem IN ('manual', 'planilha', 'modelo', 'pdf_texto', 'pdf_ocr'));
