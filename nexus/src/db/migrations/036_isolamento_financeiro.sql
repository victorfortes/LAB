-- Os dados financeiros pertencem ao par projeto e organização cliente.
ALTER POLICY contas_isolamento ON contas_financeiras
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()) AND EXISTS (
    SELECT 1 FROM portais p WHERE p.ativo AND p.projeto_id = contas_financeiras.projeto_id
      AND p.organizacao_cliente_id = contas_financeiras.organizacao_id))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()) AND EXISTS (
    SELECT 1 FROM portais p WHERE p.ativo AND p.projeto_id = contas_financeiras.projeto_id
      AND p.organizacao_cliente_id = contas_financeiras.organizacao_id));

ALTER POLICY lancamentos_isolamento ON lancamentos
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()) AND EXISTS (
    SELECT 1 FROM portais p WHERE p.ativo AND p.projeto_id = lancamentos.projeto_id
      AND p.organizacao_cliente_id = lancamentos.organizacao_id))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()) AND EXISTS (
    SELECT 1 FROM portais p WHERE p.ativo AND p.projeto_id = lancamentos.projeto_id
      AND p.organizacao_cliente_id = lancamentos.organizacao_id));

ALTER POLICY contas_nga ON contas_financeiras USING (EXISTS (
  SELECT 1 FROM portais p JOIN projetos pr ON pr.id = p.projeto_id
   WHERE p.ativo AND p.mostra_financeiro AND p.projeto_id = contas_financeiras.projeto_id
     AND p.organizacao_cliente_id = contas_financeiras.organizacao_id
     AND pr.organizacao_id IN (SELECT app_organizacoes_visiveis())));

ALTER POLICY lancamentos_nga ON lancamentos USING (EXISTS (
  SELECT 1 FROM portais p JOIN projetos pr ON pr.id = p.projeto_id
   WHERE p.ativo AND p.mostra_financeiro AND p.projeto_id = lancamentos.projeto_id
     AND p.organizacao_cliente_id = lancamentos.organizacao_id
     AND pr.organizacao_id IN (SELECT app_organizacoes_visiveis())));

ALTER TABLE contas_financeiras ADD CONSTRAINT contas_identidade_projeto_org UNIQUE (id, projeto_id, organizacao_id);
ALTER TABLE lancamentos ADD CONSTRAINT lancamentos_conta_projeto_org_fk
  FOREIGN KEY (conta_id, projeto_id, organizacao_id)
  REFERENCES contas_financeiras(id, projeto_id, organizacao_id) ON DELETE SET NULL (conta_id);
