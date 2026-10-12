-- Mínimo do Supabase para rodar as migrações no PGlite (teste local).
-- No Supabase real estes objetos já existem.
create role anon nologin;
create role authenticated nologin;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, aud text, role text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Reproduz os privilégios padrão do Supabase: objetos novos em public nascem acessíveis a anon e authenticated.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
