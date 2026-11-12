-- 048 — Cada pessoa vê só os projetos em que trabalha.
--
-- Até aqui o isolamento era por organização: todo advogado da NGA via todos os
-- projetos da NGA. Agora:
--   - Administrador, sócio, coordenação e controladoria continuam vendo tudo
--     (a controladoria distribui publicações de todos os clientes).
--   - Advogado, estagiário, administrativo e financeiro veem só os projetos em
--     que estão na equipe ativa ou que estão sob sua responsabilidade.
--   - Cliente e usuário de integração seguem pelas regras próprias (portal e
--     credencial), sem mudança.
--
-- As políticas abaixo são RESTRICTIVE: somam-se como E às políticas que já
-- existem, então nada que hoje é proibido passa a ser permitido.

CREATE FUNCTION app_equipe_restrita() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM vinculos v WHERE v.usuario_id = app_usuario_id() AND v.revogado_em IS NULL
                   AND v.papel IN ('advogado','estagiario','administrativo','financeiro'))
     AND NOT EXISTS (SELECT 1 FROM vinculos v WHERE v.usuario_id = app_usuario_id() AND v.revogado_em IS NULL
                   AND v.papel IN ('socio_administrador','socio','coordenacao','controladoria','integracao'))
$$;
REVOKE ALL ON FUNCTION app_equipe_restrita() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_equipe_restrita() TO nga_app;

-- Lê só `projeto_equipe`, que fica fora da trava abaixo: consultar `projetos`
-- aqui faria a política chamar a si mesma. O responsável pelo projeto entra
-- direto na política de `projetos` e, ao criar, já vira líder da equipe.
CREATE FUNCTION app_projetos_da_pessoa() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.projeto_id FROM projeto_equipe e WHERE e.usuario_id = app_usuario_id() AND e.ate IS NULL
$$;
REVOKE ALL ON FUNCTION app_projetos_da_pessoa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_projetos_da_pessoa() TO nga_app;

CREATE POLICY projetos_equipe_restrita ON projetos AS RESTRICTIVE
  USING (NOT app_equipe_restrita() OR responsavel_id = app_usuario_id() OR id IN (SELECT app_projetos_da_pessoa()))
  WITH CHECK (NOT app_equipe_restrita() OR responsavel_id = app_usuario_id() OR id IN (SELECT app_projetos_da_pessoa()));

-- Toda tabela protegida por RLS que pende de um projeto recebe a mesma trava.
-- Linhas sem projeto (tarefa avulsa, publicação ainda não vinculada) seguem as
-- regras que já tinham. `projeto_equipe` fica de fora: é dela que a trava lê.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'projeto_id' AND NOT a.attisdropped
     WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relrowsecurity
       AND c.relname NOT IN ('projetos', 'projeto_equipe')
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE USING (projeto_id IS NULL OR NOT app_equipe_restrita() OR projeto_id IN (SELECT app_projetos_da_pessoa()))',
      t || '_equipe_restrita', t);
  END LOOP;
END $$;
