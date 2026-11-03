-- 014 — RLS de processos.
--
-- O cliente alcança, pelo portal e só em leitura:
--   - o processo ligado ao projeto dele, se o portal expuser processos;
--   - as partes desse processo (que são públicas nos autos, salvo segredo);
--   - as movimentações MARCADAS como visíveis, com o resumo escrito pela NGA.
--
-- O cliente NÃO alcança, por caminho algum:
--   - movimentação não publicada, que é o andamento cru;
--   - PRAZO. Nenhum. Prazo é controle interno do escritório — e um prazo
--     perdido aparecendo numa listagem para o cliente é a pior forma
--     possível de ele descobrir.
--
-- Processo em segredo de justiça fica fora do portal mesmo quando o portal
-- expõe processos: segredo é do juízo, não do escritório, e a plataforma não
-- tem como saber a quem o juízo estendeu o acesso.

ALTER TABLE processos ENABLE ROW LEVEL SECURITY;
ALTER TABLE processos FORCE ROW LEVEL SECURITY;

CREATE POLICY processos_isolamento ON processos
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

CREATE POLICY processos_portal ON processos FOR SELECT
  USING (
    NOT segredo_justica
    AND projeto_id IN (
      SELECT po.projeto_id FROM portais po
       WHERE po.ativo AND po.mostra_processos
         AND po.projeto_id IN (SELECT app_projetos_do_portal()))
  );

-- ------------------------------------------------------------------ partes ---

ALTER TABLE partes_processo ENABLE ROW LEVEL SECURITY;
ALTER TABLE partes_processo FORCE ROW LEVEL SECURITY;

CREATE POLICY partes_isolamento ON partes_processo
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

CREATE POLICY partes_portal ON partes_processo FOR SELECT
  USING (processo_id IN (
    SELECT pr.id FROM processos pr
     WHERE NOT pr.segredo_justica
       AND pr.projeto_id IN (
         SELECT po.projeto_id FROM portais po
          WHERE po.ativo AND po.mostra_processos
            AND po.projeto_id IN (SELECT app_projetos_do_portal()))));

-- ----------------------------------------------------------- movimentações ---

ALTER TABLE movimentacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes FORCE ROW LEVEL SECURITY;

CREATE POLICY movimentacoes_isolamento ON movimentacoes
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

-- A linha que impede andamento cru de vazar. Se ela cair, o teste
-- `movimentação não publicada nunca aparece para o cliente` falha.
CREATE POLICY movimentacoes_portal ON movimentacoes FOR SELECT
  USING (
    visivel_ao_cliente
    AND processo_id IN (
      SELECT pr.id FROM processos pr
       WHERE NOT pr.segredo_justica
         AND pr.projeto_id IN (
           SELECT po.projeto_id FROM portais po
            WHERE po.ativo AND po.mostra_processos
              AND po.projeto_id IN (SELECT app_projetos_do_portal())))
  );

-- ------------------------------------------------------------------ prazos ---
-- Sem política de portal: o cliente não alcança prazo por via nenhuma.

ALTER TABLE prazos ENABLE ROW LEVEL SECURITY;
ALTER TABLE prazos FORCE ROW LEVEL SECURITY;

CREATE POLICY prazos_isolamento ON prazos
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON processos, partes_processo, movimentacoes, prazos TO nga_app;
