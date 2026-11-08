/** Google OAuth web-server flow. No access/refresh token ever leaves the server. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Banco } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { ArquivoCorrompido, type Armazenamento } from '../store/arquivos.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/drive'];
/** Pastas já existentes no Drive do escritório. `drive.file` não enxerga pasta criada por gente: daí o escopo `drive`, que exige reconectar a conta. */
export const PASTA_REESTRUTURACAO = '1-JlcrOlJlTWVX_UGHR-XTkdB8jXD8HGK';
export const PASTA_CIVEL = '1VEWVDDC1jGq36nOEMVl-0uJoVmgoyX26';
const TIPOS_REESTRUTURACAO = new Set(['recuperacao_judicial','recuperacao_extrajudicial','falencia','reestruturacao','negociacao_credores']);
export const pastaDoTipo = (tipo: string) => (TIPOS_REESTRUTURACAO.has(tipo) ? PASTA_REESTRUTURACAO : PASTA_CIVEL);
const REQUIRED = ['NGA_GOOGLE_CLIENT_ID','NGA_GOOGLE_CLIENT_SECRET','NGA_GOOGLE_REDIRECT_URI','NGA_GOOGLE_TOKEN_KEY'] as const;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
function config() {
  const faltantes = REQUIRED.filter((k) => !process.env[k]);
  if (process.env.NGA_GOOGLE_TOKEN_KEY && !/^[0-9a-f]{64}$/i.test(process.env.NGA_GOOGLE_TOKEN_KEY)) faltantes.push('NGA_GOOGLE_TOKEN_KEY');
  return { configurado: faltantes.length === 0, faltantes };
}
function key() {
  if (!config().configurado) throw new PedidoInvalido('Configure a conexão Google em Integrações antes de continuar.');
  return Buffer.from(process.env.NGA_GOOGLE_TOKEN_KEY!, 'hex');
}
export function cifrarGoogle(valor: unknown): string {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(valor),'utf8'),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),bytes]).toString('base64');
}
export function decifrarGoogle<T>(valor: string): T {
  const bytes = Buffer.from(valor,'base64'); const cipher = createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));
  cipher.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8')) as T;
}
function org(i: Identidade) {
  const id = i.organizacoes.find((o) => o.tipo === 'escritorio')?.id;
  if (!id) throw new PedidoInvalido('A conexão Google pertence ao escritório.'); return id;
}
export async function status(db: PoolClient, i: Identidade) {
  const c = config(); const organizacaoId = org(i);
  const { rows } = await db.query('SELECT criado_em FROM google_conexoes WHERE organizacao_id=$1',[organizacaoId]);
  const { rows: fila } = await db.query('SELECT count(*)::int AS pendentes FROM google_fila WHERE estado=\'pendente\'');
  return { ...c, conectado: rows.length > 0, pendentes: fila[0]?.pendentes ?? 0,
    redirectUri: process.env.NGA_GOOGLE_REDIRECT_URI ?? 'http://localhost:8790/api/google/callback',
    instrucoes: ['No Google Cloud, crie um projeto e habilite Google Calendar API e Google Drive API.',
      'Configure a tela de consentimento e um cliente OAuth do tipo Aplicativo da Web.',
      'Cadastre a URI de redirecionamento exibida nesta tela.',
      'Configure as quatro variáveis no ambiente do servidor. NGA_GOOGLE_TOKEN_KEY deve conter 64 caracteres hexadecimais aleatórios.',
      'Reinicie o servidor e clique em Conectar Google. Autorize a conta do escritório.'],
    documentacao: ['https://developers.google.com/identity/protocols/oauth2/web-server','https://console.cloud.google.com/apis/credentials'] };
}
export async function conectar(db: PoolClient, i: Identidade) {
  key(); const nonce = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
  await db.query('DELETE FROM google_oauth_estados WHERE expira_em < now()');
  await db.query('INSERT INTO google_oauth_estados(hash,usuario_id,organizacao_id,verificador) VALUES($1,$2,$3,$4)',[hash(nonce),i.usuarioId,org(i),verifier]);
  const p = new URLSearchParams({client_id:process.env.NGA_GOOGLE_CLIENT_ID!,redirect_uri:process.env.NGA_GOOGLE_REDIRECT_URI!,response_type:'code',scope:SCOPES.join(' '),access_type:'offline',prompt:'consent',state:nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + p };
}
interface Tokens { access_token: string; refresh_token?: string; expires_in?: number; expires_at?: number }
async function exchange(data: Record<string,string>): Promise<Tokens> {
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...data,client_id:process.env.NGA_GOOGLE_CLIENT_ID!,client_secret:process.env.NGA_GOOGLE_CLIENT_SECRET!}),signal:AbortSignal.timeout(20000)});
  if (!r.ok) throw new PedidoInvalido('O Google recusou a autorização. Reconecte a conta nas Integrações.');
  return await r.json() as Tokens;
}
export async function callback(db: PoolClient, i: Identidade, code: string, state: string) {
  key();
  const { rows } = await db.query<{verificador:string;organizacao_id:string}>('DELETE FROM google_oauth_estados WHERE hash=$1 AND usuario_id=$2 AND expira_em>now() RETURNING verificador,organizacao_id',[hash(state),i.usuarioId]);
  if (!rows[0]) throw new PedidoInvalido('Autorização expirada ou inválida. Inicie novamente.');
  const t = await exchange({code,redirect_uri:process.env.NGA_GOOGLE_REDIRECT_URI!,grant_type:'authorization_code',code_verifier:rows[0].verificador});
  if (!t.refresh_token) throw new PedidoInvalido('O Google não forneceu autorização permanente. Revogue o acesso anterior e conecte novamente.');
  await db.query('INSERT INTO google_conexoes(organizacao_id,usuario_id,credencial) VALUES($1,$2,$3) ON CONFLICT(organizacao_id) DO UPDATE SET usuario_id=EXCLUDED.usuario_id,credencial=EXCLUDED.credencial,criado_em=now()',[rows[0].organizacao_id,i.usuarioId,cifrarGoogle({...t,expires_at:Date.now()+(t.expires_in??3600)*1000})]);
  return { conectado:true };
}
async function token(db: PoolClient, organizacaoId: string) {
  const { rows } = await db.query<{credencial:string}>('SELECT credencial FROM google_conexoes WHERE organizacao_id=$1',[organizacaoId]);
  if (!rows[0]) throw new PedidoInvalido('Conecte a conta Google do escritório em Integrações.');
  let t = decifrarGoogle<Tokens>(rows[0].credencial);
  if ((t.expires_at??0)<Date.now()+60000) {
    const renewed = await exchange({grant_type:'refresh_token',refresh_token:t.refresh_token!});
    t={...t,...renewed,expires_at:Date.now()+(renewed.expires_in??3600)*1000};
    await db.query('UPDATE google_conexoes SET credencial=$2 WHERE organizacao_id=$1',[organizacaoId,cifrarGoogle(t)]);
  } return t.access_token;
}
export async function googleJson(access: string, url: string, init: RequestInit={}) {
  const r=await fetch(url,{...init,headers:{authorization:`Bearer ${access}`,...init.headers},signal:AbortSignal.timeout(30000)});
  if (!r.ok) throw new PedidoInvalido(`Google respondeu HTTP ${r.status}. Confira a conexão e as APIs habilitadas.`);
  return await r.json() as Record<string,any>;
}
async function projeto(db: PoolClient,id:string) {
  const { rows }=await db.query<{id:string;organizacao_id:string;nome:string;tipo:string;cliente:string}>(`SELECT p.id,p.organizacao_id,p.nome,p.tipo,coalesce((SELECT o.nome FROM portais po JOIN organizacoes o ON o.id=po.organizacao_cliente_id WHERE po.projeto_id=p.id AND po.ativo ORDER BY po.criado_em LIMIT 1),p.nome) AS cliente FROM projetos p WHERE p.id=$1`,[id]);
  if (!rows[0]) throw new NaoEncontrado('Projeto não encontrado.'); return rows[0];
}
export const EsquemaEvento = z.object({projetoId:z.string().uuid(),titulo:z.string().trim().min(1).max(300),inicio:z.iso.datetime({offset:true}),fim:z.iso.datetime({offset:true}),descricao:z.string().max(5000).default(''),marcador:z.enum(['reuniao','prazo','audiencia','interno','cliente','lembrete']).default('reuniao'),criarMeet:z.boolean().default(true)}).refine((e)=>new Date(e.fim)>new Date(e.inicio),'O fim deve ser posterior ao início.');
export function corpoEventoGoogle(id:string,e:z.infer<typeof EsquemaEvento>) {
  return {id:id.replaceAll('-',''),summary:e.titulo,description:e.descricao,start:{dateTime:e.inicio,timeZone:'America/Sao_Paulo'},end:{dateTime:e.fim,timeZone:'America/Sao_Paulo'},colorId:({reuniao:'9',prazo:'11',audiencia:'6',interno:'8',cliente:'2',lembrete:'5'})[e.marcador],extendedProperties:{private:{ngaProjeto:e.projetoId,ngaMarcador:e.marcador}},...(e.criarMeet?{conferenceData:{createRequest:{requestId:id,conferenceSolutionKey:{type:'hangoutsMeet'}}}}:{})};
}
export async function criarEvento(db:PoolClient,i:Identidade,e:z.infer<typeof EsquemaEvento>) {
  const p=await projeto(db,e.projetoId); const id=crypto.randomUUID();
  // Save before dispatch. Retrying the same local event uses its stable Google ID.
  await db.query('INSERT INTO google_eventos(id,organizacao_id,projeto_id,titulo,inicio,fim,descricao,marcador,criar_meet,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,p.organizacao_id,p.id,e.titulo,e.inicio,e.fim,e.descricao,e.marcador,e.criarMeet,i.usuarioId]);
  try { return await sincronizarEvento(db,id); }
  catch(error) {
    const message=(error as Error).message.slice(0,300);
    await db.query('UPDATE google_eventos SET erro=$2 WHERE id=$1',[id,message]);
    return {id,projeto_id:e.projetoId,titulo:e.titulo,inicio:e.inicio,fim:e.fim,marcador:e.marcador,pendente:true,erro:message};
  }
}
export async function sincronizarEvento(db:PoolClient,id:string) {
  const {rows}=await db.query('SELECT * FROM google_eventos WHERE id=$1',[id]);const r=rows[0];
  if(!r)throw new NaoEncontrado('Evento não encontrado.');if(r.google_id && (!r.criar_meet || r.meet_url))return r;
  const access=await token(db,r.organizacao_id);
  const body=corpoEventoGoogle(id,{projetoId:r.projeto_id,titulo:r.titulo,inicio:new Date(r.inicio).toISOString(),fim:new Date(r.fim).toISOString(),descricao:r.descricao,marcador:r.marcador,criarMeet:r.criar_meet});
  let remote:Record<string,any>;
  try {remote=r.google_id?await googleJson(access,'https://www.googleapis.com/calendar/v3/calendars/primary/events/'+encodeURIComponent(r.google_id)):await googleJson(access,'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
  catch(error){
    if(!(error as Error).message.includes('HTTP 409'))throw error;
    remote=await googleJson(access,'https://www.googleapis.com/calendar/v3/calendars/primary/events/'+id.replaceAll('-',''));
  }
  const meet=remote.hangoutLink??remote.conferenceData?.entryPoints?.find((x:any)=>x.entryPointType==='video')?.uri??null;
  await db.query('UPDATE google_eventos SET google_id=$2,meet_url=$3,google_url=$4,erro=NULL WHERE id=$1',[id,remote.id,meet,remote.htmlLink]);
  return {id,...remote,meet_url:meet};
}
export async function listarEventos(db:PoolClient,projetoId?:string) {
  return (await db.query('SELECT * FROM google_eventos WHERE ($1::uuid IS NULL OR projeto_id=$1) ORDER BY inicio',[projetoId??null])).rows;
}
async function folder(access:string,name:string,tag:string,parent?:string) {
  const query=`trashed=false and appProperties has { key='ngaChave' and value='${tag}' }`;
  const found=await googleJson(access,'https://www.googleapis.com/drive/v3/files?'+new URLSearchParams({q:query,fields:'files(id)'}));
  if(found.files?.[0])return found.files[0].id as string;
  const r=await googleJson(access,'https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',appProperties:{ngaChave:tag},...(parent?{parents:[parent]}:{})})});return r.id as string;
}
export async function criarPastas(db:PoolClient,id:string) {
  const p=await projeto(db,id); await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`google-drive:${id}`]);
  const {rows}=await db.query('SELECT * FROM google_drive_pastas WHERE projeto_id=$1',[id]);if(rows[0])return rows[0];
  const access=await token(db,p.organizacao_id);
  const client=await folder(access,p.cliente,`cliente:${p.organizacao_id}:${hash(p.cliente).slice(0,24)}`,pastaDoTipo(p.tipo));
  const project=await folder(access,p.nome,`projeto:${id}`,client);const pastas:Record<string,string>={};
  for(const [tag,name]of Object.entries({cliente:'01 Documentos do cliente',escritorio:'02 Documentos do escritório',relatorios:'03 Relatórios',processos:'04 Processos'})) pastas[tag]=await folder(access,name,`projeto:${id}:${tag}`,project);
  await db.query('INSERT INTO google_drive_pastas(projeto_id,organizacao_id,pasta_id,pastas) VALUES($1,$2,$3,$4)',[id,p.organizacao_id,project,JSON.stringify(pastas)]);
  return {projeto_id:id,pasta_id:project,pastas,url:`https://drive.google.com/drive/folders/${project}`};
}
/** Read remote bytes under the same document RLS, retaining local legacy fallback. */
export async function lerDocumentoDrive(db:PoolClient,storage:Armazenamento,doc:{id:string;caminho:string;hash_sha256:string}):Promise<Uint8Array> {
  const {rows}=await db.query<{conteudo:Buffer;hash_sha256:string}>('SELECT conteudo,hash_sha256 FROM documento_conteudos WHERE documento_id=$1',[doc.id]);
  const remote=rows[0];
  if(!remote)return storage.ler(doc.caminho,doc.hash_sha256);
  const found=createHash('sha256').update(remote.conteudo).digest('hex');
  if(found!==doc.hash_sha256 || found!==remote.hash_sha256)throw new ArquivoCorrompido(doc.caminho,doc.hash_sha256,found);
  return new Uint8Array(remote.conteudo);
}
export async function sincronizarDocumentos(db:PoolClient,id:string,storage:Armazenamento) {
  const p=await projeto(db,id);const folders=await criarPastas(db,id);const access=await token(db,p.organizacao_id);
  const {rows}=await db.query(`SELECT f.id fila_id,d.* FROM google_fila f JOIN documentos d ON d.id=f.documento_id WHERE f.projeto_id=$1 AND f.estado='pendente' AND d.tem_arquivo ORDER BY f.atualizado_em FOR UPDATE OF f SKIP LOCKED`,[id]);
  let enviados=0;
  for(const d of rows) {
    try {
      const query=`trashed=false and appProperties has { key='ngaDocumento' and value='${d.id}' }`;
      const found=await googleJson(access,'https://www.googleapis.com/drive/v3/files?'+new URLSearchParams({q:query,fields:'files(id)'}));let remote=found.files?.[0];
      if(!remote) {
        const data=await lerDocumentoDrive(db,storage,d);const boundary='nga_'+crypto.randomUUID();
        const meta={name:d.nome_original??d.titulo,parents:[folders.pastas[d.categoria==='relatorio_gerador'?'relatorios':d.categoria==='processo'?'processos':d.origem==='portal_cliente'?'cliente':'escritorio']],appProperties:{ngaDocumento:d.id,ngaProjeto:id,ngaOrigem:d.origem}};
        const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${d.tipo_mime}\r\n\r\n`,new Uint8Array(data),`\r\n--${boundary}--`]);
        remote=await googleJson(access,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'content-type':`multipart/related; boundary=${boundary}`},body});
      }
      await db.query('UPDATE google_fila SET estado=\'concluido\',google_id=$2,erro=NULL,tentativas=tentativas+1,atualizado_em=now() WHERE id=$1',[d.fila_id,remote.id]);enviados++;
    } catch(e) {await db.query('UPDATE google_fila SET erro=$2,tentativas=tentativas+1,atualizado_em=now() WHERE id=$1',[d.fila_id,(e as Error).message.slice(0,300)]);}
  }
  await db.query('UPDATE google_fila SET estado=\'concluido\',erro=NULL,google_id=$2 WHERE projeto_id=$1 AND tipo=\'projeto\'',[id,folders.pasta_id]);
  return {enviados,pasta:folders};
}
let serviceHash:string;
export async function processarGoogleAgendado(banco:Banco,storage:Armazenamento) {
  if(!config().configurado)return;
  const orgs=await banco.semContexto(async(db)=>(await db.query<{id:string}>('SELECT organizacoes_com_google() AS id')).rows);
  serviceHash??=await Bun.password.hash(crypto.randomUUID()+crypto.randomUUID(),{algorithm:'argon2id'});
  for(const o of orgs) {
    const uid=await banco.semContexto(async(db)=>(await db.query<{id:string}>('SELECT usuario_de_servico_da_organizacao($1,$2,$3) AS id',[o.id,'google',serviceHash])).rows[0]!.id);
    await banco.comoUsuario(uid,async(db)=>{
      const events=await db.query<{id:string}>('SELECT id FROM google_eventos WHERE google_id IS NULL OR (criar_meet AND meet_url IS NULL) ORDER BY criado_em LIMIT 20');
      for(const e of events.rows){try{await sincronizarEvento(db,e.id);}catch(error){await db.query('UPDATE google_eventos SET erro=$2 WHERE id=$1',[e.id,(error as Error).message.slice(0,300)]);}}
      const {rows}=await db.query<{projeto_id:string}>('SELECT DISTINCT projeto_id FROM google_fila WHERE estado=\'pendente\' LIMIT 20');
      for(const p of rows) {try{await sincronizarDocumentos(db,p.projeto_id,storage);}catch(e){await db.query('UPDATE google_fila SET erro=$2,tentativas=tentativas+1,atualizado_em=now() WHERE projeto_id=$1 AND estado=\'pendente\'',[p.projeto_id,(e as Error).message.slice(0,300)]);}}
    }).catch(()=>{});
  }
}
