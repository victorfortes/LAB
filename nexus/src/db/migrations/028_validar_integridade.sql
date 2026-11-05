-- Valida também as linhas anteriores às regras de isolamento da migração 024.
ALTER TABLE documentos VALIDATE CONSTRAINT documentos_projeto_org_fk;
ALTER TABLE requisitos VALIDATE CONSTRAINT requisitos_projeto_org_fk;
ALTER TABLE mensagens VALIDATE CONSTRAINT mensagens_projeto_org_fk;
ALTER TABLE tarefas VALIDATE CONSTRAINT tarefas_projeto_org_fk;
ALTER TABLE requisitos VALIDATE CONSTRAINT requisitos_documento_projeto_fk;
ALTER TABLE mensagens VALIDATE CONSTRAINT mensagens_requisito_projeto_fk;
ALTER TABLE analises VALIDATE CONSTRAINT analises_documento_projeto_fk;
