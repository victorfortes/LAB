-- Rode UMA vez no SQL Editor do Supabase, depois de criar o primeiro usuário em Authentication > Users
-- (Add user > Create new user, com e-mail e senha forte; marque "Auto Confirm"). Troque o e-mail abaixo.
-- Não guarde senhas neste arquivo nem no repositório.
insert into public.perfis (user_id, email, nome, papel, ativo)
select u.id, u.email, 'Administrador', 'admin', true
from auth.users u
where lower(u.email) = lower('TROQUE-PELO-EMAIL-DO-ADMINISTRADOR@exemplo.com.br')
on conflict (user_id) do update set papel = 'admin', ativo = true;
