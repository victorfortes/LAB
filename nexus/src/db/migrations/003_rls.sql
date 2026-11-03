-- 003 — Row Level Security.
--
-- O §12.3 do briefing é explícito: não confiar no frontend. Aqui o isolamento
-- é do banco. Mesmo que uma consulta vaze para o lugar errado da aplicação, o
-- PostgreSQL não devolve linha de outra organização.
--
-- Contexto por conexão: `app.organizacao_id` e `app.usuario_id`, definidos a
-- cada requisição com SET LOCAL dentro da transação.

CREATE OR REPLACE FUNCTION app_organizacao_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.organizacao_id', TRUE), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_usuario_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.usuario_id', TRUE), '')::UUID
$$;

-- Organizações que o usuário corrente enxerga, por vínculo não revogado.
--
-- SECURITY DEFINER é obrigatório aqui, não conveniência. Sem ele a política de
-- `empresas` chama esta função, que lê `vinculos`, cuja própria política chama
-- esta função de novo: o PostgreSQL entra em recursão e devolve
-- "stack depth limit exceeded". Com SECURITY DEFINER a leitura de `vinculos`
-- roda como o dono do schema e o ciclo se fecha.
--
-- O risco de SECURITY DEFINER é search_path: fixá-lo impede que alguém crie um
-- `vinculos` falso num schema à frente e sequestre a função.
CREATE OR REPLACE FUNCTION app_organizacoes_visiveis() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT v.organizacao_id FROM vinculos v
  WHERE v.usuario_id = app_usuario_id() AND v.revogado_em IS NULL
$$;

-- Ninguém além da aplicação precisa chamá-la.
REVOKE ALL ON FUNCTION app_organizacoes_visiveis() FROM PUBLIC;

-- Tabelas com coluna `organizacao_id`: política uniforme.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'empresas', 'grupos_economicos', 'projetos', 'credores', 'creditos',
    'planos', 'obrigacoes', 'assembleias'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %1$I_isolamento ON %1$I
        USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
        WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))
    $f$, t);
  END LOOP;
END $$;

-- Tabelas que herdam a organização por referência.
ALTER TABLE empresas_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas_grupos FORCE ROW LEVEL SECURITY;
CREATE POLICY empresas_grupos_isolamento ON empresas_grupos
  USING (grupo_id IN (SELECT g.id FROM grupos_economicos g
                       WHERE g.organizacao_id IN (SELECT app_organizacoes_visiveis())))
  WITH CHECK (grupo_id IN (SELECT g.id FROM grupos_economicos g
                       WHERE g.organizacao_id IN (SELECT app_organizacoes_visiveis())));

ALTER TABLE projetos_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE projetos_empresas FORCE ROW LEVEL SECURITY;
CREATE POLICY projetos_empresas_isolamento ON projetos_empresas
  USING (projeto_id IN (SELECT p.id FROM projetos p
                         WHERE p.organizacao_id IN (SELECT app_organizacoes_visiveis())))
  WITH CHECK (projeto_id IN (SELECT p.id FROM projetos p
                         WHERE p.organizacao_id IN (SELECT app_organizacoes_visiveis())));

ALTER TABLE condicoes_pagamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE condicoes_pagamento FORCE ROW LEVEL SECURITY;
CREATE POLICY condicoes_isolamento ON condicoes_pagamento
  USING (plano_id IN (SELECT pl.id FROM planos pl
                       WHERE pl.organizacao_id IN (SELECT app_organizacoes_visiveis())))
  WITH CHECK (plano_id IN (SELECT pl.id FROM planos pl
                       WHERE pl.organizacao_id IN (SELECT app_organizacoes_visiveis())));

ALTER TABLE votos ENABLE ROW LEVEL SECURITY;
ALTER TABLE votos FORCE ROW LEVEL SECURITY;
CREATE POLICY votos_isolamento ON votos
  USING (assembleia_id IN (SELECT a.id FROM assembleias a
                            WHERE a.organizacao_id IN (SELECT app_organizacoes_visiveis())))
  WITH CHECK (assembleia_id IN (SELECT a.id FROM assembleias a
                            WHERE a.organizacao_id IN (SELECT app_organizacoes_visiveis())));

ALTER TABLE apuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE apuracoes FORCE ROW LEVEL SECURITY;
CREATE POLICY apuracoes_isolamento ON apuracoes
  USING (assembleia_id IN (SELECT a.id FROM assembleias a
                            WHERE a.organizacao_id IN (SELECT app_organizacoes_visiveis())))
  WITH CHECK (assembleia_id IN (SELECT a.id FROM assembleias a
                            WHERE a.organizacao_id IN (SELECT app_organizacoes_visiveis())));

-- Auditoria: inserção livre para o usuário autenticado, leitura restrita à
-- própria organização. As RULEs da migração 001 já impedem UPDATE e DELETE.
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;
CREATE POLICY auditoria_leitura ON auditoria FOR SELECT
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()));
CREATE POLICY auditoria_insercao ON auditoria FOR INSERT
  WITH CHECK (TRUE);

-- Um usuário enxerga a si mesmo e a quem compartilha organização com ele.
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;
CREATE POLICY usuarios_visibilidade ON usuarios FOR SELECT
  USING (
    id = app_usuario_id()
    OR id IN (
      SELECT v.usuario_id FROM vinculos v
      WHERE v.revogado_em IS NULL
        AND v.organizacao_id IN (SELECT app_organizacoes_visiveis())
    )
  );

ALTER TABLE vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinculos FORCE ROW LEVEL SECURITY;
CREATE POLICY vinculos_visibilidade ON vinculos FOR SELECT
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()));

ALTER TABLE organizacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizacoes FORCE ROW LEVEL SECURITY;
CREATE POLICY organizacoes_visibilidade ON organizacoes FOR SELECT
  USING (id IN (SELECT app_organizacoes_visiveis()));
