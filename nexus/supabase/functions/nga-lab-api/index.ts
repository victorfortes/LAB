import {supabaseCa} from './ca.ts';
import {instalarCompatibilidade} from './compat.ts';
import {Banco} from '../../../src/store/conexao.ts';
import {criarApp} from '../../../src/server/app.ts';
import {aplicarCabecalhos} from '../../../src/server/cabecalhos.ts';
import {deposito} from '../../../src/server/arquivos.ts';
import {AcervoNaNuvem} from './acervo.ts';
import {processarFilaAnalise} from '../../../src/server/analise_fila.ts';
import {sincronizarAgendado} from '../../../src/server/controladoria.ts';
import {definirConfiguracaoGoogle,processarGoogleAgendado} from '../../../src/server/google.ts';
import {provedorDoAmbiente} from '../../../src/ai/provedor.ts';
import {rotinaSentinela} from '../../../src/server/sentinela.ts';
import {rotinaRadar} from '../../../src/server/radar.ts';
import {rotinaDataJud} from '../../../src/server/andamentos.ts';
import {rotinaSlack} from '../../../src/server/slack.ts';
import {createHash} from 'node:crypto';
instalarCompatibilidade();
const e=Deno.env.toObject();
const database=e.SUPABASE_DB_URL;if(!database)throw Error('Conexão do projeto não disponível');
const dbUrl=new URL(database); dbUrl.searchParams.delete('sslmode'); dbUrl.searchParams.delete('sslrootcert');
const banco=new Banco({host:'',port:5432,user:'nga_app',password:'',database:'postgres',connectionString:dbUrl.href,ssl:{ca:supabaseCa,rejectUnauthorized:true},papelAplicacao:'nga_app',esquema:'nga_lab',max:2});
const segredo=e.NGA_SEGREDO_ARQUIVOS??createHash('sha256').update(e.SUPABASE_SERVICE_ROLE_KEY??JSON.stringify(e.SUPABASE_SECRET_KEYS)).digest('hex');
const dep=deposito(new AcervoNaNuvem(),{NGA_SEGREDO_ARQUIVOS:segredo,NGA_LIMITE_ARQUIVO:String(10*1024*1024)});

let googleConfig:Promise<void>|undefined;
async function prepararGoogle(){
 googleConfig??=banco.semContexto(async(db)=>{
  const {rows}=await db.query<{chave:string;valor:string}>('SELECT * FROM configuracao_google_servidor()');
  const permitidas=new Set(['NGA_GOOGLE_CLIENT_ID','NGA_GOOGLE_CLIENT_SECRET','NGA_GOOGLE_REDIRECT_URI','NGA_GOOGLE_TOKEN_KEY']);
  definirConfiguracaoGoogle(Object.fromEntries(rows.filter(r=>permitidas.has(r.chave)&&r.valor).map(r=>[r.chave,r.valor])));
 }).catch((error)=>{googleConfig=undefined;console.error('Google: configuração do servidor indisponível',(error as Error).message);});
 await googleConfig;
}

// Acima disto o PDF não cabe no limite de CPU da função: sai com motivo na tela, em vez de travar.
const LIMITE_PDF=3*1024*1024;
const SEGREDO_COFRE=e.NGA_COFRE_CHAVE??createHash('sha256').update('cofre:'+segredo).digest('hex');
const app=criarApp({banco,deposito:dep,analiseAutomatica:false,analiseEmWorker:true,exigirTrocaDeSenha:true,limitePdfBytes:LIMITE_PDF,segredoCofre:SEGREDO_COFRE});
const prefix='/nga-lab-api';
const acervo=new AcervoNaNuvem();
const ROTINAS:Record<string,()=>Promise<unknown>>={
 analise:()=>processarFilaAnalise(banco,dep,provedorDoAmbiente(e),{limitePdfBytes:LIMITE_PDF}),
 djen:async()=>(await sincronizarAgendado(banco)).length,
 google:async()=>{await prepararGoogle();return JSON.stringify(await processarGoogleAgendado(banco,acervo))},
 sentinela:async()=>JSON.stringify(await rotinaSentinela(banco)),
 radar:()=>rotinaRadar(banco,e.DJEN_INGEST_SECRET),
 datajud:async()=>JSON.stringify(await rotinaDataJud(banco,{limite:40})),
 slack:async()=>JSON.stringify(await rotinaSlack(banco,SEGREDO_COFRE)),
};
async function executarRotina(req:Request,nome:string):Promise<Response>{
 const negado=new Response('não encontrado',{status:404});
 const chave=req.headers.get('x-nga-rotina');
 if(req.method!=='POST'||!chave||!Object.hasOwn(ROTINAS,nome))return negado;
 const hash=createHash('sha256').update(chave).digest('hex');
 const {rows}=await banco.semContexto(db=>db.query<{ok:boolean}>('SELECT rotina_autorizada($1) AS ok',[hash]));
 if(!rows[0]?.ok)return negado;
 const t=Date.now();let ok=true;let detalhe='';
 try{detalhe=String(await ROTINAS[nome]!())}catch(error){ok=false;detalhe=(error as Error).message;console.error('rotina',nome,detalhe)}
 await banco.semContexto(db=>db.query('SELECT rotina_registrar($1,$2,$3,$4)',[nome,ok,detalhe,Date.now()-t]));
 return Response.json({ok},{status:ok?200:500});
}

Deno.serve({port:Number(e.NGA_EDGE_PORT??8000)},async(req:Request)=>{
 // The Supabase gateway terminates TLS; internal requests may carry an http URL.
 const u=new URL(req.url);u.protocol='https:';const pos=u.pathname.indexOf(prefix);if(pos>=0)u.pathname=u.pathname.slice(pos+prefix.length)||'/';
 if(u.pathname==='/health'){
  try{await banco.semContexto(db=>db.query('SELECT 1'));return Response.json({status:'ok',backend:'Supabase Edge',acervo:'PostgreSQL',autenticacao:'sessão NGA por rota',worker:'separado'})}
  catch(error){console.error('health',error);return Response.json({status:'indisponivel'},{status:503})}
 }
 if(u.pathname.startsWith('/interno/rotina/'))return executarRotina(req,u.pathname.slice('/interno/rotina/'.length));
 if(u.pathname.startsWith('/api/google/'))await prepararGoogle();
 // Existing API authenticates every private route (cookie/Bearer), downloads use signed short-lived grants.
 const r=await app(new Request(u,req));r.headers.set('cache-control','no-store');aplicarCabecalhos(r.headers,{https:true,pagina:false});return r;
});
