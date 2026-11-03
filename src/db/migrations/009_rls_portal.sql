-- 009 — RLS do portal do cliente.
--
-- Duas vias de acesso convivem e NÃO se misturam:
--   1. Membro da organização dona do dado (equipe da NGA) — política da
--      migração 003, que vale para SELECT e escrita.
--   2. Cliente, por um portal ativo — políticas DESTA migração, só de leitura
--      e só do que foi publicado.
--
-- No PostgreSQL, políticas permissivas se somam por OU. Por isso as do portal
-- são FOR SELECT: elas ampliam o que o cliente LÊ sem lhe dar escrita alguma
-- sobre o dado da NGA. As exceções, onde o cliente precisa mesmo escrever,
-- são as tabelas financeiras — que pertencem à organização dele.

-- Projetos que o usuário corrente alcança por portal ativo.
-- SECURITY DEFINER pelo mesmo motivo da migração 003: evitar recursão de RLS.
CREATE OR REPLACE FUNCTION app_projetos_do_portal() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.projeto_id
    FROM portais p
    JOIN vinculos v ON v.organizacao_id = p.organizacao_cliente_id
                   AND v.revogado_em IS NULL
                   AND v.usuario_id = app_usuario_id()
   WHERE p.ativo
$$;

REVOKE ALL ON FUNCTION app_projetos_do_portal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_projetos_do_portal() TO nga_app;

-- O cliente vê o projeto a que o portal lhe dá acesso. Leitura apenas.
CREATE POLICY projetos_portal ON projetos FOR SELECT
  USING (id IN (SELECT app_projetos_do_portal()));

-- E o plano desse projeto.
CREATE POLICY planos_portal ON planos FOR SELECT
  USING (projeto_id IN (SELECT app_projetos_do_portal()));

-- E as obrigações do plano, se o portal as expuser.
CREATE POLICY obrigacoes_portal ON obrigacoes FOR SELECT
  USING (plano_id IN (
    SELECT pl.id FROM planos pl
     JOIN portais po ON po.projeto_id = pl.projeto_id
     WHERE po.ativo AND po.mostra_obrigacoes
       AND pl.projeto_id IN (SELECT app_projetos_do_portal())));

-- ------------------------------------------------------------- documentos ---

ALTER TABLE documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos FORCE ROW LEVEL SECURITY;

-- Equipe da NGA: acesso pleno dentro da própria organização.
CREATE POLICY documentos_isolamento ON documentos
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

-- Cliente: SOMENTE documento publicado, e só do projeto do seu portal.
-- Esta é a linha que impede documento interno de vazar. Se ela cair, o teste
-- `documento interno nunca aparece para o cliente` falha.
CREATE POLICY documentos_portal ON documentos FOR SELECT
  USING (
    visibilidade = 'publicado'
    AND projeto_id IN (
      SELECT po.projeto_id FROM portais po
       WHERE po.ativo AND po.mostra_documentos
         AND po.projeto_id IN (SELECT app_projetos_do_portal()))
  );

-- O cliente ENVIA documento pelo portal: insere como 'interno' e com origem
-- declarada. Publicar é ato da NGA, e o WITH CHECK aqui impede que o próprio
-- envio já nasça publicado.
--
-- ATENÇÃO PARA QUEM FOR ESCREVER O INSERT: nada de `RETURNING`. Com RETURNING,
-- o PostgreSQL aplica também a política de SELECT à linha devolvida — e como
-- documento interno não é visível ao cliente, o comando inteiro falha. O id
-- deve ser gerado pela aplicação antes do INSERT. Não é defeito: é a garantia
-- de que o cliente não lê documento interno, valendo até para a linha que ele
-- mesmo acabou de criar.
CREATE POLICY documentos_portal_envio ON documentos FOR INSERT
  WITH CHECK (
    visibilidade = 'interno'
    AND origem = 'portal_cliente'
    AND projeto_id IN (SELECT app_projetos_do_portal())
  );

-- -------------------------------------------------------------- requisitos ---

ALTER TABLE requisitos ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisitos FORCE ROW LEVEL SECURITY;

CREATE POLICY requisitos_isolamento ON requisitos
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

-- O cliente lê o próprio checklist.
CREATE POLICY requisitos_portal ON requisitos FOR SELECT
  USING (projeto_id IN (SELECT app_projetos_do_portal()));

-- E o atualiza ao enviar documento. A máquina de situações do domínio é que
-- impede "aprovado"; aqui o banco garante que ele só mexe no próprio projeto.
CREATE POLICY requisitos_portal_envio ON requisitos FOR UPDATE
  USING (projeto_id IN (SELECT app_projetos_do_portal()))
  WITH CHECK (projeto_id IN (SELECT app_projetos_do_portal()));

-- --------------------------------------------------------------- mensagens ---

ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens FORCE ROW LEVEL SECURITY;

CREATE POLICY mensagens_isolamento ON mensagens
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

CREATE POLICY mensagens_portal ON mensagens FOR SELECT
  USING (projeto_id IN (SELECT app_projetos_do_portal()));

-- O cliente escreve como 'cliente'; não consegue forjar mensagem da NGA.
CREATE POLICY mensagens_portal_envio ON mensagens FOR INSERT
  WITH CHECK (lado = 'cliente' AND projeto_id IN (SELECT app_projetos_do_portal()));

-- ----------------------------------------------------- financeiro do cliente ---
-- Estas tabelas são da organização do CLIENTE, então a política comum da
-- migração 003 já basta: ele é membro da própria organização.

ALTER TABLE contas_financeiras ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_financeiras FORCE ROW LEVEL SECURITY;
CREATE POLICY contas_isolamento ON contas_financeiras
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

ALTER TABLE lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE lancamentos FORCE ROW LEVEL SECURITY;
CREATE POLICY lancamentos_isolamento ON lancamentos
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

-- A NGA LÊ o financeiro quando o cliente autorizou pelo portal (§6.6, "a
-- equipe interna deverá visualizar as informações autorizadas pelo cliente").
-- Leitura apenas: a NGA não lança no caixa do cliente.
CREATE POLICY lancamentos_nga ON lancamentos FOR SELECT
  USING (projeto_id IN (
    SELECT po.projeto_id FROM portais po
     JOIN projetos pr ON pr.id = po.projeto_id
     WHERE po.ativo AND po.mostra_financeiro
       AND pr.organizacao_id IN (SELECT app_organizacoes_visiveis())));

CREATE POLICY contas_nga ON contas_financeiras FOR SELECT
  USING (projeto_id IN (
    SELECT po.projeto_id FROM portais po
     JOIN projetos pr ON pr.id = po.projeto_id
     WHERE po.ativo AND po.mostra_financeiro
       AND pr.organizacao_id IN (SELECT app_organizacoes_visiveis())));

-- Portais: a equipe da NGA administra; o cliente vê o próprio.
ALTER TABLE portais ENABLE ROW LEVEL SECURITY;
ALTER TABLE portais FORCE ROW LEVEL SECURITY;
CREATE POLICY portais_nga ON portais
  USING (projeto_id IN (SELECT p.id FROM projetos p
          WHERE p.organizacao_id IN (SELECT app_organizacoes_visiveis())))
  WITH CHECK (projeto_id IN (SELECT p.id FROM projetos p
          WHERE p.organizacao_id IN (SELECT app_organizacoes_visiveis())));
CREATE POLICY portais_cliente ON portais FOR SELECT
  USING (organizacao_cliente_id IN (SELECT app_organizacoes_visiveis()));

GRANT SELECT, INSERT, UPDATE, DELETE ON portais, documentos, requisitos, mensagens,
  contas_financeiras, lancamentos TO nga_app;
