import {describe,test,expect} from 'bun:test';
import {corpoEventoGoogle,EsquemaEvento,cifrarGoogle,decifrarGoogle,criarEvento,lerDocumentoDrive} from '../src/server/google.ts';
import {publicacaoNoPeriodo,hojeSaoPaulo,sincronizarOab,type ItemDjen} from '../src/server/controladoria.ts';

describe('Google Calendar e Drive: contratos reais',()=>{
 test('credencial do cofre vale sem gravar no ambiente do processo',async()=>{
  const g=await import('../src/server/google.ts');const antes=process.env.NGA_GOOGLE_TOKEN_KEY;delete process.env.NGA_GOOGLE_TOKEN_KEY;
  try{expect(()=>g.cifrarGoogle({a:1})).toThrow();g.definirConfiguracaoGoogle({NGA_GOOGLE_CLIENT_ID:'c',NGA_GOOGLE_CLIENT_SECRET:'s',NGA_GOOGLE_REDIRECT_URI:'https://x/r',NGA_GOOGLE_TOKEN_KEY:'cd'.repeat(32)});expect(g.decifrarGoogle(g.cifrarGoogle({a:1}))).toEqual({a:1});expect(process.env.NGA_GOOGLE_TOKEN_KEY).toBeUndefined();}
  finally{g.definirConfiguracaoGoogle({NGA_GOOGLE_CLIENT_ID:'',NGA_GOOGLE_CLIENT_SECRET:'',NGA_GOOGLE_REDIRECT_URI:'',NGA_GOOGLE_TOKEN_KEY:''});if(antes)process.env.NGA_GOOGLE_TOKEN_KEY=antes;}
 });
 test('a função Edge ganha Buffer global, que o Deno não expõe',async()=>{
  const {instalarCompatibilidade}=await import('../supabase/functions/nga-lab-api/compat.ts');const g=globalThis as Record<string,unknown>;const original=g.Buffer;
  try{delete g.Buffer;expect(g.Buffer).toBeUndefined();instalarCompatibilidade();expect(typeof g.Buffer).toBe('function');}finally{g.Buffer=original;}
 });
 test('evento individualizado, marcador e Meet com identificador estável',()=>{
  const id='aaaaaaaa-0000-4000-8000-000000000001';
  const e=EsquemaEvento.parse({projetoId:id,titulo:'Revisão contábil',inicio:'2026-11-04T10:00:00-03:00',fim:'2026-11-04T11:00:00-03:00',marcador:'cliente'});
  const g=corpoEventoGoogle(id,e);
  expect(g.id).toBe(id.replaceAll('-',''));expect(g.extendedProperties.private.ngaProjeto).toBe(id);
  expect(g.conferenceData?.createRequest.requestId).toBe(id);
  expect(corpoEventoGoogle(id,{...e,criarMeet:false}).conferenceData).toBeUndefined();
  expect(EsquemaEvento.safeParse({...e,fim:e.inicio}).success).toBe(false);
  expect(EsquemaEvento.safeParse({...e,projetoId:undefined}).success).toBe(false);
 });
 test('evento fica no projeto com pendência explícita quando Google ainda não está conectado',async()=>{
  const id='aaaaaaaa-0000-4000-8000-000000000001';const statements:string[]=[];
  const db={query:async(sql:string)=>{statements.push(sql);if(sql.startsWith('SELECT p.id'))return{rows:[{id,organizacao_id:'org',nome:'Caso',cliente:'Cliente'}]};if(sql==='SELECT * FROM google_eventos WHERE id=$1')return{rows:[{id,organizacao_id:'org'}]};return{rows:[]};}};
  const e=EsquemaEvento.parse({projetoId:id,titulo:'Reunião',inicio:'2026-11-04T10:00:00-03:00',fim:'2026-11-04T11:00:00-03:00'});
  const result=await criarEvento(db as never,{usuarioId:id} as never,e);
  expect(result.pendente).toBe(true);expect(result.projeto_id).toBe(id);
  expect(statements.some(s=>s.startsWith('INSERT INTO google_eventos'))).toBe(true);
 });
 test('Drive usa acervo remoto sob RLS e confere o hash antes do envio',async()=>{
  const data=Buffer.from('conteúdo remoto');const digest=new Bun.CryptoHasher('sha256').update(data).digest('hex');
  let localRead=false;
  const storage={ler:async()=>{localRead=true;return new Uint8Array();}};
  const db={query:async()=>({rows:[{conteudo:data,hash_sha256:digest}]})};
  const doc={id:'doc',caminho:'chave',hash_sha256:digest};
  expect(await lerDocumentoDrive(db as never,storage as never,doc)).toEqual(new Uint8Array(data));expect(localRead).toBe(false);
  await expect(lerDocumentoDrive(db as never,storage as never,{...doc,hash_sha256:'0'.repeat(64)})).rejects.toThrow('não confere');
  await lerDocumentoDrive({query:async()=>({rows:[]})} as never,storage as never,doc);expect(localRead).toBe(true);
 });
 test('tokens são autenticados e cifrados, sem conteúdo legível no banco',()=>{
  const old={...process.env};
  try{
   process.env.NGA_GOOGLE_CLIENT_ID='test';process.env.NGA_GOOGLE_CLIENT_SECRET='test';process.env.NGA_GOOGLE_REDIRECT_URI='http://localhost/callback';process.env.NGA_GOOGLE_TOKEN_KEY='ab'.repeat(32);
   const sealed=cifrarGoogle({refresh_token:'secret-refresh'});
   expect(sealed).not.toContain('secret-refresh');expect(decifrarGoogle(sealed)).toEqual({refresh_token:'secret-refresh'});
   const b=Buffer.from(sealed,'base64');b[30]=b[30]!^1;expect(()=>decifrarGoogle(b.toString('base64'))).toThrow();
  }finally{for(const k of ['NGA_GOOGLE_CLIENT_ID','NGA_GOOGLE_CLIENT_SECRET','NGA_GOOGLE_REDIRECT_URI','NGA_GOOGLE_TOKEN_KEY']){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
 });
});
describe('DJEN: intervalo e integridade da coleta',()=>{
 const item=(id:number,date:string):ItemDjen=>({id,data_disponibilizacao:date,texto:'Intimação'});
 test('descarta datas fora da consulta e identificadores malformados',()=>{
  expect(publicacaoNoPeriodo(item(1,'2026-11-04'),'2026-11-04','2026-11-04')).toBe(true);
  expect(publicacaoNoPeriodo(item(2,'2026-10-28'),'2026-11-04','2026-11-04')).toBe(false);
  expect(publicacaoNoPeriodo(item(0,'2026-11-04'),'2026-11-04','2026-11-04')).toBe(false);
  expect(hojeSaoPaulo()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
 });
 test('mesma comunicação repetida pela fonte conta uma vez; fora de período não entra',async()=>{
  const inserted:unknown[][]=[];
  const db={query:async(sql:string,args:unknown[])=>{if(sql.includes('INSERT INTO publicacoes'))inserted.push(args);return {rows:[{nova:true}]};}};
  const r=await sincronizarOab(db as never,{id:'id',organizacao_id:'org',nome:'Nome',numero_oab:'111',uf_oab:'PR',ultima_sincronizacao:null},async()=>({count:4,items:[item(1,'2026-11-04'),item(1,'2026-11-04'),item(2,'2026-09-01'),{...item(3,'2026-11-04'),destinatarioadvogados:[{advogado:{numero_oab:'999',uf_oab:'PR'}}]}]}),'2026-11-04',0);
  expect(r.consultadas).toBe(1);expect(r.novas).toBe(1);expect(inserted).toHaveLength(1);
 });
});
