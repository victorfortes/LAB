-- 004 — Papel de aplicação.
--
-- POR QUE ISTO EXISTE
-- `FORCE ROW LEVEL SECURITY` faz a política valer para o DONO da tabela, mas
-- NÃO para um superusuário: o PostgreSQL deixa o superusuário furar RLS
-- incondicionalmente, e não há política que impeça isso.
--
-- Logo, toda a garantia de isolamento do §12.3 depende de a aplicação conectar
-- com um papel comum. Se o servidor conectar como superusuário, o RLS desta
-- base vira decoração e um cliente passa a enxergar dados de outro.
--
-- A aplicação usa `nga_app`. Migrations e manutenção usam o dono do schema.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nga_app') THEN
    CREATE ROLE nga_app LOGIN;
  END IF;
END $$;

-- Explicitamente sem bypass de RLS, mesmo que algum script futuro tente dar.
ALTER ROLE nga_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA public TO nga_app;

-- As políticas de RLS da migração 003 CHAMAM estas funções, e a política roda
-- como o usuário que consulta. Sem EXECUTE, toda consulta da aplicação morre
-- em "permission denied for function" — o isolamento não falha aberto, falha
-- fechado, mas a aplicação inteira para.
GRANT EXECUTE ON FUNCTION app_organizacoes_visiveis() TO nga_app;
GRANT EXECUTE ON FUNCTION app_usuario_id() TO nga_app;
GRANT EXECUTE ON FUNCTION app_organizacao_id() TO nga_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nga_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nga_app;

-- A trilha de auditoria não se apaga nem se reescreve: além das RULEs da
-- migração 001, o papel da aplicação sequer recebe o privilégio.
REVOKE UPDATE, DELETE ON auditoria FROM nga_app;
REVOKE UPDATE, DELETE ON apuracoes FROM nga_app;

-- Tabelas criadas por migrations futuras já nascem acessíveis à aplicação.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nga_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nga_app;
