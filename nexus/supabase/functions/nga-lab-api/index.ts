import {supabaseCa} from './ca.ts';
import {instalarCompatibilidade} from './compat.ts';
import {Banco} from '../../../src/store/conexao.ts';
import {criarApp} from '../../../src/server/app.ts';
import {deposito} from '../../../src/server/arquivos.ts';
import {AcervoNaNuvem} from './acervo.ts';
import {createHash} from 'node:crypto';
instalarCompatibilidade();
const e=Deno.env.toObject();
const database=e.SUPABASE_DB_URL;if(!database)throw Error('Conexão do projeto não disponível');
const dbUrl=new URL(database); dbUrl.searchParams.delete('sslmode'); dbUrl.searchParams.delete('sslrootcert');
const banco=new Banco({host:'',port:5432,user:'nga_app',password:'',database:'postgres',connectionString:dbUrl.href,ssl:{ca:supabaseCa,rejectUnauthorized:true},papelAplicacao:'nga_app',esquema:'nga_lab',max:2});
const segredo=e.NGA_SEGREDO_ARQUIVOS??createHash('sha256').update(e.SUPABASE_SERVICE_ROLE_KEY??JSON.stringify(e.SUPABASE_SECRET_KEYS)).digest('hex');
const dep=deposito(new AcervoNaNuvem(),{NGA_SEGREDO_ARQUIVOS:segredo,NGA_LIMITE_ARQUIVO:String(10*1024*1024)});
const app=criarApp({banco,deposito:dep,analiseAutomatica:false});
const prefix='/nga-lab-api';
let googleConfig:Promise<void>|undefined;
async function prepararGoogle(){
 googleConfig??=banco.semContexto(async(db)=>{
  const {rows}=await db.query<{chave:string;valor:string}>('SELECT * FROM configuracao_google_servidor()');
  const permitidas=new Set(['NGA_GOOGLE_CLIENT_ID','NGA_GOOGLE_CLIENT_SECRET','NGA_GOOGLE_REDIRECT_URI','NGA_GOOGLE_TOKEN_KEY']);
  for(const r of rows)if(permitidas.has(r.chave)&&r.valor)process.env[r.chave]=r.valor;
 }).catch(()=>{googleConfig=undefined;console.error('Google: configuração do servidor indisponível');});
 await googleConfig;
}

Deno.serve({port:Number(e.NGA_EDGE_PORT??8000)},async(req:Request)=>{
 // The Supabase gateway terminates TLS; internal requests may carry an http URL.
 const u=new URL(req.url);u.protocol='https:';const pos=u.pathname.indexOf(prefix);if(pos>=0)u.pathname=u.pathname.slice(pos+prefix.length)||'/';
 if(u.pathname==='/health'){
  try{await banco.semContexto(db=>db.query('SELECT 1'));return Response.json({status:'ok',backend:'Supabase Edge',acervo:'PostgreSQL',autenticacao:'sessão NGA por rota',worker:'separado'})}
  catch(error){console.error('health',error);return Response.json({status:'indisponivel'},{status:503})}
 }
 if(u.pathname.startsWith('/api/google/'))await prepararGoogle();
 // Existing API authenticates every private route (cookie/Bearer), downloads use signed short-lived grants.
 const r=await app(new Request(u,req));r.headers.set('cache-control','no-store');r.headers.set('x-content-type-options','nosniff');return r;
});
