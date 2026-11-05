import {beforeAll,afterAll,test,expect} from 'bun:test';
import {bancoDeTeste,type BancoDeTeste} from './apoio/postgres.ts';
import {Banco} from '../src/store/conexao.ts';
import * as pb from '../src/server/playbook_config.ts';
import * as projetos from '../src/server/projetos.ts';
import type {Identidade} from '../src/security/sessao.ts';
let pg:BancoDeTeste,banco:Banco;
const C='33333333-3333-4333-8333-333333333333';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',UA='aaaaaaaa-0000-4000-8000-000000000001',UB='bbbbbbbb-0000-4000-8000-000000000001',UC='cccccccc-0000-4000-8000-000000000001',UV='dddddddd-0000-4000-8000-000000000001';
const identidade=(usuarioId:string,organizacaoId=A,papel:Identidade['papeis'][number]='socio_administrador'):Identidade=>({usuarioId,nome:'Teste',email:'x@example.invalid',papeis:[papel],organizacoes:[{id:organizacaoId,nome:'Escritório',tipo:'escritorio',papel}]});
const IA=identidade(UA),IB=identidade(UB,B),IV=identidade(UV,A,'advogado');
const no=(nome:string,tipo:'fase'|'etapa'|'tarefa',paiId:string|null=null,gatilho:'manual'|'projeto_criado'|'fase_iniciada'|'documento_cliente_enviado'='manual')=>pb.EsquemaNo.parse({nome,tipo,paiId,gatilho});
beforeAll(async()=>{pg=await bancoDeTeste();banco=new Banco({host:'localhost',port:pg.porta,user:'nga_app',password:'nga_app',database:'nga_teste'});await pg.dono.query(`INSERT INTO organizacoes(id,tipo,nome) VALUES($1,'escritorio','A'),($2,'escritorio','B'),($3,'cliente','Cliente')`,[A,B,C]);for(const[id,email]of[[UA,'a@test.invalid'],[UB,'b@test.invalid'],[UC,'c@test.invalid'],[UV,'v@test.invalid']])await pg.dono.query(`INSERT INTO usuarios(id,email,nome,senha_hash) VALUES($1,$2,$2,'hash-apenas-fixture')`,[id,email]);await pg.dono.query(`INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES($1,$2,'socio_administrador'),($3,$4,'socio_administrador'),($5,$7,'cliente_usuario'),($6,$2,'advogado')`,[UA,A,UB,B,UC,UV,C]);},120000);
afterAll(async()=>{await banco?.encerrar();await pg?.encerrar();});

test('modelo, snapshot, fases, mãe/filha, gatilhos idempotentes e arquivo preservam histórico',async()=>{
 const m=await banco.comoUsuario(UA,db=>pb.criarModelo(db,pb.EsquemaModelo.parse({nome:'Atendimento completo',tipoProjeto:'consultivo',padrao:true}),IA));
 const fase1=await banco.comoUsuario(UA,db=>pb.criarNo(db,'modelo',m.id,no('Análise inicial','fase'),IA));
 const fase2=await banco.comoUsuario(UA,db=>pb.criarNo(db,'modelo',m.id,{...no('Execução','fase'),ordem:20},IA));
 const etapa=await banco.comoUsuario(UA,db=>pb.criarNo(db,'modelo',m.id,no('Conferência documental','etapa',fase1.id),IA));
 const mae=await banco.comoUsuario(UA,db=>pb.criarNo(db,'modelo',m.id,no('Revisar documentos','tarefa',etapa.id,'fase_iniciada'),IA));
 await banco.comoUsuario(UA,db=>pb.criarNo(db,'modelo',m.id,no('Conferir balanço','tarefa',mae.id,'fase_iniciada'),IA));
 await banco.comoUsuario(UA,db=>pb.criarNo(db,'modelo',m.id,no('Responder ao envio','tarefa',etapa.id,'documento_cliente_enviado'),IA));
 const p=await banco.comoUsuario(UA,db=>projetos.criar(db,projetos.EsquemaProjeto.parse({nome:'Cliente A',tipo:'consultivo'}),IA));
 expect(p.playbook.criadas).toBe(2);
 await pg.dono.query('INSERT INTO portais(projeto_id,organizacao_cliente_id) VALUES($1,$2)',[p.id,C]);
 const portalHub=await banco.comoUsuario(UC,db=>projetos.hub(db,p.id));expect(portalHub.faseAtual?.nome).toBe('Análise inicial');expect(portalHub.fasesDisponiveis).toHaveLength(2);
 expect(await banco.comoUsuario(UC,async db=>(await db.query('SELECT id FROM playbook_nos')).rows)).toHaveLength(0);
 let fluxo=await banco.comoUsuario(UA,db=>pb.lerFluxo(db,p.id));expect(fluxo.nos.filter(n=>!n.arquivado).length).toBe(6);expect(fluxo.tarefas.length).toBe(2);
 const tMae=fluxo.tarefas.find(t=>t.titulo==='Revisar documentos')!,tFilha=fluxo.tarefas.find(t=>t.titulo==='Conferir balanço')!;expect(tFilha.tarefa_pai_id).toBe(tMae.id);
 expect(fluxo.nos.every(n=>n.id!==fase1.id)).toBe(true);
 await banco.comoUsuario(UA,db=>pb.editarNo(db,mae.id,{nome:'Texto novo no modelo'},IA));
 fluxo=await banco.comoUsuario(UA,db=>pb.lerFluxo(db,p.id));expect(fluxo.nos.some(n=>n.nome==='Revisar documentos')).toBe(true);
 const faseAtual=fluxo.nos.find(n=>n.id===fluxo.faseNoId)!,outraFase=fluxo.nos.find(n=>n.nome==='Execução')!;
 await expect(banco.comoUsuario(UA,db=>pb.arquivarNo(db,faseAtual.id,IA))).rejects.toThrow('mova o projeto');
 await banco.comoUsuario(UA,db=>pb.moverFase(db,p.id,outraFase.id,IA));
 const retorno=await banco.comoUsuario(UA,db=>pb.moverFase(db,p.id,faseAtual.id,IA));expect(retorno.criadas).toBe(0);
 await pg.dono.query(`INSERT INTO documentos(organizacao_id,projeto_id,titulo,caminho,origem) VALUES($1,$2,'Documento do cliente','referencia','portal_cliente')`,[A,p.id]);
 fluxo=await banco.comoUsuario(UA,db=>pb.lerFluxo(db,p.id));expect(fluxo.tarefas.filter(t=>t.titulo==='Responder ao envio').length).toBe(1);
 await pg.dono.query(`INSERT INTO documentos(organizacao_id,projeto_id,titulo,caminho,origem) VALUES($1,$2,'Documento interno','referencia','interno')`,[A,p.id]);
 expect((await banco.comoUsuario(UA,db=>pb.lerFluxo(db,p.id))).tarefas.length).toBe(3);
 await banco.comoUsuario(UA,db=>pb.moverFase(db,p.id,outraFase.id,IA));await banco.comoUsuario(UA,db=>pb.arquivarNo(db,faseAtual.id,IA));
 fluxo=await banco.comoUsuario(UA,db=>pb.lerFluxo(db,p.id));expect(fluxo.tarefas.length).toBe(3);expect(fluxo.historico.length).toBe(4);expect(fluxo.nos.find(n=>n.id===faseAtual.id)?.arquivado).toBe(true);
});

test('RLS separa escritórios/clientes e protege modelos administrativos; árvore impede ciclos e pai estrangeiro',async()=>{
 const m=await banco.comoUsuario(UA,db=>pb.criarModelo(db,pb.EsquemaModelo.parse({nome:'Árvore segura'}),IA));
 const pai=await banco.comoUsuario(UA,db=>pb.criarNo(db,'modelo',m.id,no('Fase','fase'),IA));
 const filho=await banco.comoUsuario(UA,db=>pb.criarNo(db,'modelo',m.id,no('Subfase','fase',pai.id),IA));
 await expect(banco.comoUsuario(UA,db=>pb.editarNo(db,pai.id,{paiId:filho.id},IA))).rejects.toThrow('ciclo');
 expect(await banco.comoUsuario(UB,db=>pb.listarModelos(db))).toHaveLength(0);
 expect(await banco.comoUsuario(UC,async db=>(await db.query('SELECT id FROM playbook_nos')).rows)).toHaveLength(0);
 await expect(banco.comoUsuario(UV,db=>pb.criarModelo(db,pb.EsquemaModelo.parse({nome:'Advogado não administra'}),IV))).rejects.toThrow();
 const mb=await banco.comoUsuario(UB,db=>pb.criarModelo(db,pb.EsquemaModelo.parse({nome:'Escritório B'}),IB));
 await expect(banco.comoUsuario(UB,db=>pb.criarNo(db,'modelo',mb.id,no('Pai estrangeiro','etapa',pai.id),IB))).rejects.toThrow('mesmo modelo');
 await expect(banco.comoUsuario(UB,db=>pb.lerModelo(db,m.id))).rejects.toThrow('modelo não encontrado');
 // Direct SQL cannot reparent a node across office/template boundaries either.
 await expect(pg.dono.query('UPDATE playbook_nos SET pai_id=$2 WHERE id=$1',[filho.id,filho.id])).rejects.toThrow();
});

test('importação inicial é idempotente e não muda projetos ou padrões já configurados',async()=>{
 const a=await banco.comoUsuario(UA,db=>pb.importarPadroes(db,IA));expect(a.criados).toBe(9);
 const b=await banco.comoUsuario(UA,db=>pb.importarPadroes(db,IA));expect(b.criados).toBe(0);
 const modelos=await banco.comoUsuario(UA,db=>pb.listarModelos(db));expect(modelos.filter(m=>m.padrao).length).toBe(1);
});
