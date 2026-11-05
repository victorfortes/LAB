import {afterAll,beforeAll,expect,test} from 'bun:test';
import {bancoDeTeste,type BancoDeTeste} from './apoio/postgres.ts';
import {Banco} from '../src/store/conexao.ts';
import {criarApp} from '../src/server/app.ts';
import {hashDaSenha} from '../src/security/sessao.ts';
import {ProvedorAusente} from '../src/ai/provedor.ts';
let pg:BancoDeTeste,banco:Banco,app:ReturnType<typeof criarApp>;
const org='f0300000-0000-4000-8000-000000000001',admin='f0300000-0000-4000-8000-000000000002',lawyer='f0300000-0000-4000-8000-000000000003';
let ta:string,tl:string,pA:string,pB:string,id:string,resetToken:string;
const senha='Senha de teste segura 123';
const req=(token:string,url:string,body?:unknown,method=body===undefined?'GET':'POST')=>app(new Request('http://x'+url,{method,headers:{'content-type':'application/json',cookie:`nga_sessao=${token}`},...(body===undefined?{}:{body:JSON.stringify(body)})}));
async function entrar(email:string,password=senha){const r=await app(new Request('http://x/api/sessao',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,senha:password})}));return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')??'')?.[1]??'';}
beforeAll(async()=>{pg=await bancoDeTeste();banco=new Banco({host:'localhost',port:pg.porta,user:'nga_app',password:'nga_app',database:'nga_teste'});app=criarApp({banco,provedor:new ProvedorAusente('teste sem modelo')});const hash=await hashDaSenha(senha);await pg.dono.query("INSERT INTO organizacoes(id,tipo,nome) VALUES($1,'escritorio','NGA')",[org]);await pg.dono.query("INSERT INTO usuarios(id,nome,email,senha_hash) VALUES($1,'Admin','admin@equipe.test',$3),($2,'Advogado','adv@equipe.test',$3)",[admin,lawyer,hash]);await pg.dono.query("INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES($1,$3,'socio_administrador'),($2,$3,'advogado')",[admin,lawyer,org]);ta=await entrar('admin@equipe.test');tl=await entrar('adv@equipe.test');pA=(await(await req(ta,'/api/projetos',{nome:'Projeto A',tipo:'consultivo',semPlaybook:true})).json()).id;pB=(await(await req(ta,'/api/projetos',{nome:'Projeto B',tipo:'consultivo',semPlaybook:true})).json()).id;},120000);
afterAll(async()=>{await banco?.encerrar();await pg?.encerrar();});
test('advogado não administra acessos; admin cria conta sem expor senha',async()=>{expect((await req(tl,'/api/escritorio/gestao-equipe')).status).toBe(403);const r=await req(ta,'/api/escritorio/gestao-equipe',{nome:'Nova Pessoa',email:'nova@equipe.test',papel:'estagiario'});expect(r.status).toBe(201);const d=await r.json();id=d.id;expect(d.senha).toBeUndefined();expect(d.caminho).toContain('/definir-senha?token=');resetToken=new URL(d.caminho,'http://x').searchParams.get('token')!;const a=await pg.dono.query('SELECT token_hash FROM equipe_redefinicoes WHERE usuario_id=$1',[id]);expect(a.rows[0].token_hash).not.toBe(resetToken);});
test('link de acesso é de uso único e não entra na auditoria',async()=>{const r=await req('','/api/equipe/definir-senha',{token:resetToken,senha});expect(r.status).toBe(200);expect((await req('','/api/equipe/definir-senha',{token:resetToken,senha})).status).toBe(400);expect(await entrar('nova@equipe.test')).not.toBe('');expect(JSON.stringify((await pg.dono.query('SELECT * FROM auditoria WHERE entidade_id=$1',[id])).rows)).not.toContain(resetToken);});
test('admin não revoga seu próprio acesso nem transfere último papel administrador',async()=>{expect((await req(ta,`/api/escritorio/gestao-equipe/${admin}`,{revogar:true},'PATCH')).status).not.toBe(200);expect((await req(ta,`/api/escritorio/gestao-equipe/${admin}`,{papel:'advogado'},'PATCH')).status).not.toBe(200);});
test('revogar encerra sessão e permite restaurar acesso sem excluir histórico',async()=>{const before=await entrar('nova@equipe.test');expect((await req(ta,`/api/escritorio/gestao-equipe/${id}`,{revogar:true},'PATCH')).status).toBe(200);expect((await req(before,'/api/eu')).status).toBe(401);expect((await req(ta,`/api/escritorio/gestao-equipe/${id}`,{papel:'advogado'},'PATCH')).status).toBe(200);expect((await pg.dono.query('SELECT count(*)::int n FROM usuarios WHERE id=$1',[id])).rows[0].n).toBe(1);});
test('visão usa tarefas e marcos exclusivos do projeto aberto',async()=>{await req(ta,`/api/projetos/${pA}/tarefas`,{titulo:'Somente A',responsavelId:lawyer});const r=await req(ta,`/api/projetos/${pA}/marcos`,{titulo:'Entrega A',visivelCliente:true});expect(r.status).toBe(201);const ma=(await r.json()).id;const a=await(await req(ta,`/api/projetos/${pA}/visao`)).json(),b=await(await req(ta,`/api/projetos/${pB}/visao`)).json();expect(a.marcos).toHaveLength(1);expect(a.tarefas.tarefas.map((t:any)=>t.titulo)).toEqual(['Somente A']);expect(b.marcos).toEqual([]);expect(b.tarefas.tarefas).toEqual([]);expect((await req(ta,`/api/projeto-marcos/${ma}`,{concluido:true},'PATCH')).status).toBe(200);const eq=await(await req(ta,'/api/escritorio/gestao-equipe')).json();expect(eq.find((u:any)=>u.id===lawyer).carga.abertas).toBe(1);});
test('portal vê apenas marcos publicados e nenhuma tarefa ou atividade interna',async()=>{
 await req(ta,`/api/projetos/${pA}/marcos`,{titulo:'Marco interno',visivelCliente:false});
 const convite=await(await req(ta,`/api/projetos/${pA}/portal/convites`,{nome:'Cliente A',email:'cliente@equipe.test',organizacao:'Cliente A'})).json();
 const tc=await entrar('cliente@equipe.test',convite.senhaTemporaria);
 const visao=await(await req(tc,`/api/projetos/${pA}/visao`)).json();
 expect(visao.marcos.map((m:any)=>m.titulo)).toEqual(['Entrega A']);expect(visao.tarefas.tarefas).toEqual([]);expect(visao.atividades).toEqual([]);
 expect((await req(tc,`/api/projetos/${pA}/marcos`,{titulo:'Tentativa cliente'})).status).toBe(403);
 expect((await req(tc,`/api/projetos/${pB}/visao`)).status).toBe(404);
});
test('gestão não alcança usuário de outro escritório',async()=>{
 const outro='f0300000-0000-4000-8000-000000000010',outroU='f0300000-0000-4000-8000-000000000011';
 await pg.dono.query("INSERT INTO organizacoes(id,tipo,nome) VALUES($1,'escritorio','Outro escritório')",[outro]);
 await pg.dono.query("INSERT INTO usuarios(id,nome,email,senha_hash) VALUES($1,'Outra Pessoa','outro@equipe.test','sem-login')",[outroU]);
 await pg.dono.query("INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES($1,$2,'advogado')",[outroU,outro]);
 expect((await req(ta,`/api/escritorio/gestao-equipe/${outroU}`,{papel:'socio_administrador'},'PATCH')).status).toBe(404);
 expect((await req(ta,`/api/escritorio/gestao-equipe/${outroU}/redefinir-senha`,{})).status).toBe(404);
});
