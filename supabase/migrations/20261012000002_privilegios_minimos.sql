-- Menor privilégio: o Supabase concede, por padrão (ALTER DEFAULT PRIVILEGES), execução de funções e todos os
-- privilégios de tabela a anon/authenticated. Aqui isso é desfeito e só o necessário é concedido.

-- funções: nada para anon; as duas funções de uso do app só para authenticated; funções de gatilho para ninguém
revoke all on function public.papel_atual()           from public, anon;
revoke all on function public.registrar_acesso()      from public, anon;
grant execute on function public.papel_atual()        to authenticated;
grant execute on function public.registrar_acesso()   to authenticated;
revoke all on function public.documentos_antes()        from public, anon, authenticated;
revoke all on function public.documentos_depois()       from public, anon, authenticated;
revoke all on function public.perfis_protege_admin()    from public, anon, authenticated;
revoke all on function public.perfis_auditoria()        from public, anon, authenticated;

-- tabelas: remove os privilégios padrão (inclui TRUNCATE, REFERENCES, TRIGGER) e concede só o que as políticas usam
revoke all on public.perfis, public.documentos, public.documentos_versoes, public.auditoria from anon, authenticated, public;
grant select, insert, update, delete on public.documentos to authenticated;
grant select, insert, update, delete on public.perfis     to authenticated;
grant select on public.documentos_versoes, public.auditoria to authenticated;

-- tabelas futuras não nascem expostas por engano
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
