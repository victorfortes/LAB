-- NGA Gerador de Relatórios · base do banco (Supabase / PostgreSQL)
-- Contrato com o gerador original (módulo "nuvem"): tabela public.documentos
-- (colecao, id, dados jsonb, removido, atualizado_em). Quem pode o quê é decidido
-- aqui, no banco, pelo papel da pessoa em public.perfis. Nada depende da interface.


-- ---------------------------------------------------------------- papéis
do $$ begin
  create type public.papel_nga as enum ('admin', 'advogado', 'visualizador');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- perfis
create table if not exists public.perfis (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  nome          text not null default '',
  papel         public.papel_nga not null default 'visualizador',
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  ultimo_acesso timestamptz
);
create unique index if not exists perfis_email_unico on public.perfis (lower(email));

-- papel de quem está logado; NULL se não tem perfil ou foi desativado
create or replace function public.papel_atual()
returns public.papel_nga
language sql stable security definer set search_path = public, pg_temp as $$
  select p.papel from public.perfis p where p.user_id = auth.uid() and p.ativo
$$;
revoke all on function public.papel_atual() from public;
grant execute on function public.papel_atual() to authenticated;

-- ------------------------------------------------------------- documentos
-- Mesma forma que o gerador já usa: uma coleção por tipo de dado do escritório.
create table if not exists public.documentos (
  colecao       text        not null,
  id            text        not null,
  dados         jsonb       not null default '{}'::jsonb,
  removido      boolean     not null default false,
  criado_em     timestamptz not null default now(),
  criado_por    uuid        references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid       references auth.users (id) on delete set null,
  primary key (colecao, id),
  constraint documentos_colecao_valida check (colecao in
    ('clientes','regras','relatorios','emissoes','pdfs','modelos','projetos','negociacoes','marcos')),
  constraint documentos_tamanho check (octet_length(dados::text) <= 262144)  -- 256 KiB, limite do gerador
);
create index if not exists documentos_atualizado on public.documentos (colecao, atualizado_em);

-- ---------------------------------------------------------------- versões
-- Nunca se sobrescreve em silêncio: a versão anterior de cada documento de
-- cadastro fica guardada. (Pedaços de PDF, coleção "pdfs", não entram.)
create table if not exists public.documentos_versoes (
  colecao   text        not null,
  id        text        not null,
  versao    integer     not null,
  dados     jsonb       not null,
  removido  boolean     not null default false,
  autor     uuid        references auth.users (id) on delete set null,
  em        timestamptz not null default now(),
  primary key (colecao, id, versao)
);

-- ---------------------------------------------------------------- auditoria
create table if not exists public.auditoria (
  evento   bigint generated always as identity primary key,
  em       timestamptz not null default now(),
  user_id  uuid,
  email    text,
  acao     text not null,
  colecao  text,
  doc_id   text,
  meta     jsonb not null default '{}'::jsonb   -- nunca conteúdo de relatório
);
create index if not exists auditoria_em on public.auditoria (em desc);

-- ---------------------------------------------------------------- gatilhos
create or replace function public.documentos_antes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  papel public.papel_nga := public.papel_atual();
  versao integer;
begin
  -- clientes, modelos e relatórios emitidos só podem ser excluídos (exclusão lógica) por administrador,
  -- como a matriz de permissões do gerador original
  if tg_op = 'UPDATE' and new.removido and not old.removido
     and new.colecao in ('clientes','modelos','emissoes','pdfs') and papel is distinct from 'admin' then
    raise exception 'Somente administrador pode excluir % .', new.colecao using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
  else
    new.criado_em := old.criado_em;
    new.criado_por := old.criado_por;
    -- versão anterior preservada para cadastros (não para pedaços de PDF)
    if old.colecao in ('clientes','regras','relatorios','modelos','projetos') and old.id !~ '/' then
      select coalesce(max(v.versao), 0) + 1 into versao from public.documentos_versoes v
        where v.colecao = old.colecao and v.id = old.id;
      insert into public.documentos_versoes (colecao, id, versao, dados, removido, autor, em)
        values (old.colecao, old.id, versao, old.dados, old.removido, old.atualizado_por, old.atualizado_em);
    end if;
  end if;
  new.atualizado_em := clock_timestamp();   -- sempre do servidor: o gerador usa como cursor de sincronização
  new.atualizado_por := auth.uid();
  return new;
end $$;

drop trigger if exists documentos_antes on public.documentos;
create trigger documentos_antes before insert or update on public.documentos
  for each row execute function public.documentos_antes();

create or replace function public.documentos_depois()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare acao text; mail text;
begin
  -- registra só eventos de cadastro (não cada pedaço de PDF) e nunca o conteúdo
  if (case when tg_op = 'DELETE' then old.id else new.id end) ~ '/' then return null; end if;
  if (case when tg_op = 'DELETE' then old.colecao else new.colecao end) = 'pdfs' then return null; end if;   -- pedaços de PDF: sem auditoria por pedaço (a emissão já é auditada)
  if tg_op = 'INSERT' then acao := 'criar';
  elsif tg_op = 'DELETE' then acao := 'excluir_definitivo';
  elsif new.removido and not old.removido then acao := 'excluir';
  elsif old.removido and not new.removido then acao := 'restaurar';
  else acao := 'alterar'; end if;
  select p.email into mail from public.perfis p where p.user_id = auth.uid();
  insert into public.auditoria (user_id, email, acao, colecao, doc_id)
    values (auth.uid(), mail, acao,
            case when tg_op = 'DELETE' then old.colecao else new.colecao end,
            case when tg_op = 'DELETE' then old.id else new.id end);
  return null;
end $$;

drop trigger if exists documentos_depois on public.documentos;
create trigger documentos_depois after insert or update or delete on public.documentos
  for each row execute function public.documentos_depois();

-- não deixa o escritório ficar sem administrador
create or replace function public.perfis_protege_admin()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare restantes integer;
begin
  if (tg_op = 'DELETE' and old.papel = 'admin' and old.ativo)
     or (tg_op = 'UPDATE' and old.papel = 'admin' and old.ativo and (new.papel <> 'admin' or not new.ativo)) then
    select count(*) into restantes from public.perfis p where p.papel = 'admin' and p.ativo and p.user_id <> old.user_id;
    if restantes = 0 then raise exception 'O escritório precisa de pelo menos um administrador ativo.' using errcode = 'P0001'; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists perfis_protege_admin on public.perfis;
create trigger perfis_protege_admin before update or delete on public.perfis
  for each row execute function public.perfis_protege_admin();

create or replace function public.perfis_auditoria()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare mail text;
begin
  select p.email into mail from public.perfis p where p.user_id = auth.uid();
  insert into public.auditoria (user_id, email, acao, colecao, doc_id, meta)
    values (auth.uid(), mail,
            case tg_op when 'INSERT' then 'usuario_criar' when 'DELETE' then 'usuario_excluir' else 'usuario_alterar' end,
            'perfis', coalesce(new.user_id, old.user_id)::text,
            case when tg_op = 'UPDATE' then jsonb_build_object('papel_de', old.papel, 'papel_para', new.papel, 'ativo_de', old.ativo, 'ativo_para', new.ativo) else '{}'::jsonb end);
  return null;
end $$;
drop trigger if exists perfis_auditoria on public.perfis;
create trigger perfis_auditoria after insert or update or delete on public.perfis
  for each row execute function public.perfis_auditoria();

-- a pessoa registra o próprio acesso (único campo que ela mesma altera em perfis)
create or replace function public.registrar_acesso()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare mail text;
begin
  if auth.uid() is null or public.papel_atual() is null then return; end if;
  update public.perfis set ultimo_acesso = now() where user_id = auth.uid();
  select p.email into mail from public.perfis p where p.user_id = auth.uid();
  insert into public.auditoria (user_id, email, acao) values (auth.uid(), mail, 'acesso');
end $$;
revoke all on function public.registrar_acesso() from public;
grant execute on function public.registrar_acesso() to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.perfis             enable row level security;
alter table public.documentos         enable row level security;
alter table public.documentos_versoes enable row level security;
alter table public.auditoria          enable row level security;
alter table public.perfis             force row level security;
alter table public.documentos         force row level security;
alter table public.documentos_versoes force row level security;
alter table public.auditoria          force row level security;

-- perfis: cada um vê o próprio; administrador vê e altera todos. Ninguém muda o próprio papel.
drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated
  using (user_id = auth.uid() or public.papel_atual() = 'admin');
drop policy if exists perfis_admin_inserir on public.perfis;
create policy perfis_admin_inserir on public.perfis for insert to authenticated
  with check (public.papel_atual() = 'admin');
drop policy if exists perfis_admin_alterar on public.perfis;
create policy perfis_admin_alterar on public.perfis for update to authenticated
  using (public.papel_atual() = 'admin' and user_id <> auth.uid())
  with check (public.papel_atual() = 'admin' and user_id <> auth.uid());
drop policy if exists perfis_admin_excluir on public.perfis;
create policy perfis_admin_excluir on public.perfis for delete to authenticated
  using (public.papel_atual() = 'admin' and user_id <> auth.uid());

-- documentos: ler = qualquer perfil ativo; gravar = admin e advogado; apagar de vez = admin
drop policy if exists documentos_ler on public.documentos;
create policy documentos_ler on public.documentos for select to authenticated
  using (public.papel_atual() is not null);
drop policy if exists documentos_inserir on public.documentos;
create policy documentos_inserir on public.documentos for insert to authenticated
  with check (public.papel_atual() in ('admin', 'advogado'));
drop policy if exists documentos_alterar on public.documentos;
create policy documentos_alterar on public.documentos for update to authenticated
  using (public.papel_atual() in ('admin', 'advogado'))
  with check (public.papel_atual() in ('admin', 'advogado'));
drop policy if exists documentos_excluir on public.documentos;
create policy documentos_excluir on public.documentos for delete to authenticated
  using (public.papel_atual() = 'admin');

drop policy if exists versoes_ler on public.documentos_versoes;
create policy versoes_ler on public.documentos_versoes for select to authenticated
  using (public.papel_atual() in ('admin', 'advogado'));

drop policy if exists auditoria_ler on public.auditoria;
create policy auditoria_ler on public.auditoria for select to authenticated
  using (public.papel_atual() = 'admin');

-- privilégios mínimos: nada para anon; authenticated só o que as políticas liberam
revoke all on public.perfis, public.documentos, public.documentos_versoes, public.auditoria from anon, public;
grant select, insert, update, delete on public.documentos to authenticated;
grant select, insert, update, delete on public.perfis to authenticated;
grant select on public.documentos_versoes, public.auditoria to authenticated;
