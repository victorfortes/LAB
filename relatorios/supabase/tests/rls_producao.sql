-- Teste de RLS no banco REAL, sem resíduo e SEM criar contas: as fixtures vivem num sub-bloco que é desfeito
-- (savepoint) ao final; o relatório é devolvido como resultado normal da consulta. Nenhum usuário, perfil ou
-- documento fica gravado. Cole e execute no SQL Editor do Supabase (como postgres).

-- executa "cmd" como o papel do banco (anon/authenticated) e a pessoa uid; devolve 'ok:<linhas>' ou 'erro:<mensagem>'
create function pg_temp.tenta(papel text, uid uuid, cmd text) returns text language plpgsql as $f$
declare r text; c integer;
begin
  execute format('set local role %I', papel);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  begin
    execute cmd;
    get diagnostics c = row_count;
    r := 'ok:' || c;
  exception when others then
    r := 'erro:' || sqlerrm;
  end;
  reset role;
  return r;
end $f$;

create function pg_temp.linha(nome text, cond boolean, det text) returns text language sql as $f$
  select case when coalesce(cond, false) then 'PASS ' || nome || E'\n'
              else 'FAIL ' || nome || '  [' || coalesce(det, '') || ']' || E'\n' end
$f$;

create function pg_temp.executa_teste() returns text language plpgsql as $f$
declare rel text := ''; falhas integer; total integer;
begin
  begin   -- sub-bloco: tudo o que acontece aqui é desfeito no EXCEPTION abaixo
    -- fixtures (superusuário): quatro pessoas com perfis diferentes + uma sem perfil
    insert into auth.users (id, aud, role, email) values
      ('00000000-0000-4000-8000-0000000000a1','authenticated','authenticated','t-admin@teste.invalid'),
      ('00000000-0000-4000-8000-0000000000b1','authenticated','authenticated','t-adv@teste.invalid'),
      ('00000000-0000-4000-8000-0000000000c1','authenticated','authenticated','t-vis@teste.invalid'),
      ('00000000-0000-4000-8000-0000000000d1','authenticated','authenticated','t-ina@teste.invalid'),
      ('00000000-0000-4000-8000-0000000000e1','authenticated','authenticated','t-sem@teste.invalid');
    insert into public.perfis (user_id, email, nome, papel, ativo) values
      ('00000000-0000-4000-8000-0000000000a1','t-admin@teste.invalid','A','admin',true),
      ('00000000-0000-4000-8000-0000000000b1','t-adv@teste.invalid','B','advogado',true),
      ('00000000-0000-4000-8000-0000000000c1','t-vis@teste.invalid','C','visualizador',true),
      ('00000000-0000-4000-8000-0000000000d1','t-ina@teste.invalid','D','advogado',false);

    -- anon (sem login)
    rel := rel || pg_temp.linha('anon nao le documentos', pg_temp.tenta('anon', null, 'select * from public.documentos') like 'erro:permission denied%', pg_temp.tenta('anon', null, 'select * from public.documentos'));
    rel := rel || pg_temp.linha('anon nao grava documentos', pg_temp.tenta('anon', null, $$insert into public.documentos (colecao,id) values ('clientes','x')$$) like 'erro:permission denied%', '');
    rel := rel || pg_temp.linha('anon nao le perfis', pg_temp.tenta('anon', null, 'select * from public.perfis') like 'erro:permission denied%', '');
    rel := rel || pg_temp.linha('anon nao executa registrar_acesso', pg_temp.tenta('anon', null, 'select public.registrar_acesso()') like 'erro:permission denied for function%', pg_temp.tenta('anon', null, 'select public.registrar_acesso()'));
    rel := rel || pg_temp.linha('anon nao executa papel_atual', pg_temp.tenta('anon', null, 'select public.papel_atual()') like 'erro:permission denied for function%', '');

    -- advogado grava; visualizador, inativo e sem perfil nao
    rel := rel || pg_temp.linha('advogado cria cliente', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$insert into public.documentos (colecao,id,dados) values ('clientes','c1','{"v":1}')$$) = 'ok:1', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$select 1$$));
    rel := rel || pg_temp.linha('advogado altera cliente (gera versao)', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$update public.documentos set dados='{"v":2}' where colecao='clientes' and id='c1'$$) = 'ok:1', '');
    rel := rel || pg_temp.linha('visualizador nao cria', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000c1', $$insert into public.documentos (colecao,id) values ('clientes','v1')$$) like 'erro:%row-level security%', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000c1', $$insert into public.documentos (colecao,id) values ('clientes','v1')$$));
    rel := rel || pg_temp.linha('visualizador le', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000c1','select * from public.documentos') = 'ok:1', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000c1','select * from public.documentos'));
    rel := rel || pg_temp.linha('visualizador nao altera', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000c1', $$update public.documentos set dados='{}' where id='c1'$$) = 'ok:0', '');
    rel := rel || pg_temp.linha('inativo nao le', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000d1','select * from public.documentos') = 'ok:0', '');
    rel := rel || pg_temp.linha('sem perfil nao le', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000e1','select * from public.documentos') = 'ok:0', '');
    rel := rel || pg_temp.linha('sem perfil nao grava', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000e1', $$insert into public.documentos (colecao,id) values ('clientes','s1')$$) like 'erro:%row-level security%', '');

    -- exclusoes: so administrador
    rel := rel || pg_temp.linha('advogado nao exclui cliente (logico)', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$update public.documentos set removido=true where colecao='clientes' and id='c1'$$) like 'erro:Somente administrador%', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$update public.documentos set removido=true where colecao='clientes' and id='c1'$$));
    rel := rel || pg_temp.linha('advogado nao apaga fisicamente', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$delete from public.documentos where id='c1'$$) = 'ok:0', '');
    rel := rel || pg_temp.linha('administrador exclui cliente (logico)', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000a1', $$update public.documentos set removido=true where colecao='clientes' and id='c1'$$) = 'ok:1', '');

    -- perfis
    rel := rel || pg_temp.linha('advogado so ve o proprio perfil', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1','select * from public.perfis') = 'ok:1', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1','select * from public.perfis'));
    rel := rel || pg_temp.linha('advogado nao se promove', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$update public.perfis set papel='admin' where user_id='00000000-0000-4000-8000-0000000000b1'$$) = 'ok:0', '');
    rel := rel || pg_temp.linha('administrador nao altera o proprio perfil', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000a1', $$update public.perfis set ativo=false where user_id='00000000-0000-4000-8000-0000000000a1'$$) = 'ok:0', '');
    rel := rel || pg_temp.linha('administrador altera perfil de outra pessoa', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000a1', $$update public.perfis set papel='visualizador' where user_id='00000000-0000-4000-8000-0000000000c1'$$) = 'ok:1', '');

    -- auditoria e versoes
    rel := rel || pg_temp.linha('advogado nao le auditoria', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1','select * from public.auditoria') = 'ok:0', '');
    rel := rel || pg_temp.linha('administrador le auditoria', (select split_part(pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000a1','select * from public.auditoria'),':',2)::int) >= 1, pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000a1','select * from public.auditoria'));
    rel := rel || pg_temp.linha('ninguem altera auditoria', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000a1', $$update public.auditoria set acao='x'$$) like 'erro:permission denied%', '');
    rel := rel || pg_temp.linha('versao anterior foi preservada', (select count(*) from public.documentos_versoes where colecao='clientes' and id='c1') >= 1, (select count(*)::text from public.documentos_versoes));
    rel := rel || pg_temp.linha('visualizador nao le versoes', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000c1','select * from public.documentos_versoes') = 'ok:0', '');
    rel := rel || pg_temp.linha('ninguem grava versoes', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$insert into public.documentos_versoes (colecao,id,versao,dados) values ('clientes','z',1,'{}')$$) like 'erro:%', '');

    -- privilegios, restricoes e funcoes
    rel := rel || pg_temp.linha('authenticated nao faz TRUNCATE', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1','truncate public.documentos') like 'erro:permission denied%', '');
    rel := rel || pg_temp.linha('authenticated nao chama funcao de gatilho', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1','select public.documentos_antes()') like 'erro:permission denied%', '');
    rel := rel || pg_temp.linha('colecao invalida recusada', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$insert into public.documentos (colecao,id) values ('papeis','p')$$) like 'erro:%documentos_colecao_valida%', '');
    rel := rel || pg_temp.linha('documento acima de 256 KiB recusado', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$insert into public.documentos (colecao,id,dados) values ('clientes','g', jsonb_build_object('t', repeat('x', 270000)))$$) like 'erro:%documentos_tamanho%', '');
    rel := rel || pg_temp.linha('registrar_acesso funciona para perfil ativo', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1','select public.registrar_acesso()') = 'ok:1', '');
    rel := rel || pg_temp.linha('upsert do gerador (on conflict) pelo advogado', pg_temp.tenta('authenticated','00000000-0000-4000-8000-0000000000b1', $$insert into public.documentos (colecao,id,dados,removido) values ('regras','r1','{}',false) on conflict (colecao,id) do update set dados=excluded.dados$$) = 'ok:1', '');
    rel := rel || pg_temp.linha('sempre resta um administrador (service role)', (select pg_temp.tenta('postgres', null, $$update public.perfis set papel='advogado' where user_id='00000000-0000-4000-8000-0000000000a1'$$)) like 'erro:%pelo menos um administrador%', '');


    falhas := (length(rel) - length(replace(rel, 'FAIL ', ''))) / 5;
    total  := falhas + (length(rel) - length(replace(rel, 'PASS ', ''))) / 5;
    rel := 'RELATORIO RLS | testes: ' || total || ' | falhas: ' || falhas || E'\n' || rel;
    raise exception using message = '__relatorio__', detail = rel;
  exception when others then
    if sqlerrm = '__relatorio__' then
      get stacked diagnostics rel = pg_exception_detail;
    else
      rel := 'ERRO NO TESTE: ' || sqlerrm;
    end if;
  end;
  return rel;
end $f$;

select pg_temp.executa_teste() as relatorio;
