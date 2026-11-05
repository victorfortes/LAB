import { afterAll, beforeAll, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import * as config from '../src/server/projeto_config.ts';
import { diagnostico } from '../src/server/diagnostico.ts';
import type { Identidade } from '../src/security/sessao.ts';
let pg:BancoDeTeste;let banco:Banco;
const org='11111111-1111-4111-8111-111111111111', user='22222222-2222-4222-8222-222222222222';
const a='33333333-3333-4333-8333-333333333333', b='44444444-4444-4444-8444-444444444444';
const ident:Identidade={usuarioId:user,nome:'Teste',email:'teste@example.com',papeis:['socio_administrador'],organizacoes:[{id:org,nome:'NGA',tipo:'escritorio',papel:'socio_administrador'}]};
beforeAll(async()=>{
 pg=await bancoDeTeste();banco=new Banco({host:'localhost',port:pg.porta,user:'nga_app',password:'nga_app',database:'nga_teste'});
 await pg.dono.query("INSERT INTO organizacoes(id,tipo,nome) VALUES($1,'escritorio','NGA')",[org]);
 await pg.dono.query("INSERT INTO usuarios(id,nome,email,senha_hash) VALUES($1,'Teste','teste@example.com','teste-inutilizavel')",[user]);
 await pg.dono.query("INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES($1,$2,'socio_administrador')",[user,org]);
 await pg.dono.query("INSERT INTO projetos(id,organizacao_id,nome,tipo) VALUES($1,$3,'A','consultivo'),($2,$3,'B','consultivo')",[a,b,org]);
},120000);
afterAll(async()=>{await banco?.encerrar();await pg?.encerrar();});
test('notas do playbook ficam no projeto escolhido',async()=>{
 await banco.comoUsuario(user,db=>config.salvarNota(db,a,config.EsquemaNota.parse({chave:'contabil',resumo:'Só A',pontosAtencao:'conferir balanço'}),ident));
 expect(await banco.comoUsuario(user,db=>config.notas(db,b))).toEqual([]);
 expect((await banco.comoUsuario(user,db=>config.notas(db,a)))[0].resumo).toBe('Só A');
});
test('documento de outro projeto não pode ser anexado a requisito ou mensagem',async()=>{
 const doc=(await pg.dono.query("INSERT INTO documentos(organizacao_id,projeto_id,titulo,caminho,origem) VALUES($1,$2,'A','a','interno') RETURNING id",[org,a])).rows[0].id;
 const req=(await pg.dono.query("INSERT INTO requisitos(organizacao_id,projeto_id,categoria,titulo) VALUES($1,$2,'Contábil','B') RETURNING id",[org,b])).rows[0].id;
 await expect(pg.dono.query('UPDATE requisitos SET documento_id=$2 WHERE id=$1',[req,doc])).rejects.toThrow();
 await expect(pg.dono.query("INSERT INTO mensagens(organizacao_id,projeto_id,requisito_id,autor_id,lado,texto) VALUES($1,$2,$3,$4,'nga','erro')",[org,a,req,user])).rejects.toThrow();
});
test('documento do cliente gera tarefa só no próprio projeto e diagnóstico ignora documento do escritório',async()=>{
 await banco.comoUsuario(user,db=>config.criarAutomacao(db,a,config.EsquemaAutomacao.parse({nome:'Conferir envio',gatilho:'documento_cliente_enviado',tituloTarefa:'Analisar documentos',diasUteis:2}),ident));
 await pg.dono.query("INSERT INTO documentos(organizacao_id,projeto_id,titulo,caminho,origem) VALUES($1,$2,'Cliente A','a','portal_cliente'),($1,$3,'Cliente B','b','portal_cliente'),($1,$2,'Interno A','c','interno')",[org,a,b]);
 const ts=await pg.dono.query("SELECT projeto_id,titulo FROM tarefas WHERE origem='automacao'");expect(ts.rows).toEqual([{projeto_id:a,titulo:'Analisar documentos'}]);
 const diag=await banco.comoUsuario(user,db=>diagnostico(db,a));expect(diag.documentos.map(d=>d.titulo)).toEqual(['Cliente A']);
});
test('regra do escritório gera tarefas ao criar novo projeto',async()=>{
 await banco.comoUsuario(user,db=>config.criarAutomacao(db,a,config.EsquemaAutomacao.parse({nome:'Abertura',gatilho:'projeto_criado',tituloTarefa:'Solicitar documentação',escopo:'escritorio'}),ident));
 const p=(await pg.dono.query("INSERT INTO projetos(organizacao_id,nome,tipo) VALUES($1,'Novo','consultivo') RETURNING id",[org])).rows[0].id;
 expect((await pg.dono.query("SELECT titulo FROM tarefas WHERE projeto_id=$1 AND origem='automacao'",[p])).rows).toEqual([{titulo:'Solicitar documentação'}]);
});
