-- O serviço de administração de usuários (Edge Function gerenciar-usuarios) usa o papel service_role.
-- O Supabase não concede mais privilégios padrão no esquema public a service_role, então sem estes GRANTs
-- a função não lê public.perfis e responde 403 ("Seu acesso não permite administrar usuários") mesmo para administradores.
grant usage on schema public to service_role;
grant select, insert, update on public.perfis to service_role;
grant insert on public.auditoria to service_role;
