import{createHash,randomBytes,timingSafeEqual}from'node:crypto';
import type{PoolClient}from'pg';
import type{Identidade}from'../security/sessao.ts';
import{catalogo}from'./ferramentas.ts';
import{NaoEncontrado,PedidoInvalido}from'./erros.ts';
export const FERRAMENTAS_SSO=['prazos','sentinela']as const;
export type FerramentaSso=typeof FERRAMENTAS_SSO[number];
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const opaque=(v:string)=>/^[A-Za-z0-9_-]{32,128}$/.test(v);
function target(tool:FerramentaSso,path:string){
 const f=catalogo().find(x=>x.id===tool);if(!f?.url)throw new NaoEncontrado('Ferramenta não encontrada.');
 const url=new URL(f.url);if(url.username||url.password||!['http:','https:'].includes(url.protocol))throw new PedidoInvalido('Endereço da ferramenta inválido.');
 if(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new PedidoInvalido('SSO exige HTTPS fora do servidor local.');
 url.pathname=url.pathname.replace(/\/$/,'')+path;url.search='';url.hash='';return url;
}
function secret(tool:FerramentaSso){return process.env['NGA_SSO_'+tool.toUpperCase()+'_SECRET'];}
export function conferirServicoSso(tool:FerramentaSso,bearer:string){
 const expected=secret(tool);return !!expected&&expected.length>=32&&timingSafeEqual(Buffer.from(hash(expected)),Buffer.from(hash(bearer)));
}
export async function emitirAcessoSso(db:PoolClient,i:Identidade,tool:FerramentaSso){
 if(!secret(tool)||secret(tool)!.length<32)throw new PedidoInvalido('SSO desta ferramenta ainda não foi configurado pelo administrador.');
 const office=i.organizacoes.find(o=>o.tipo==='escritorio'&&(!process.env.NGA_SSO_ORGANIZACAO||o.id===process.env.NGA_SSO_ORGANIZACAO));
 if(!office||i.papeis.every(p=>['integracao','parceiro_externo','cliente_usuario','cliente_administrador'].includes(p)))throw new PedidoInvalido('Seu acesso não pertence ao escritório autorizado para esta ferramenta.');
 const ticket=randomBytes(32).toString('base64url');
 await db.query('DELETE FROM ferramenta_sso_tickets WHERE usuario_id=$1 AND expira_em<=now()',[i.usuarioId]);
 await db.query('INSERT INTO ferramenta_sso_tickets(hash,usuario_id,organizacao_id,ferramenta) VALUES($1,$2,$3,$4)',[hash(ticket),i.usuarioId,office.id,tool]);
 const url=target(tool,'/sso/iniciar');url.searchParams.set('ticket',ticket);return{url:url.href,expiraEmSegundos:60};
}
export async function autorizarAcessoSso(db:PoolClient,i:Identidade,tool:FerramentaSso,ticket:string,state:string){
 if(!opaque(ticket)||!opaque(state))throw new PedidoInvalido('Acesso inválido ou expirado.');
 const{rows}=await db.query('UPDATE ferramenta_sso_tickets SET state_hash=$4 WHERE hash=$1 AND usuario_id=$2 AND ferramenta=$3 AND expira_em>now() AND (state_hash IS NULL OR state_hash=$4) RETURNING organizacao_id',[hash(ticket),i.usuarioId,tool,hash(state)]);
 if(!rows[0]||!i.organizacoes.some(o=>o.id===rows[0].organizacao_id&&o.tipo==='escritorio'))throw new PedidoInvalido('Acesso inválido ou expirado.');
 const url=target(tool,'/sso/entrar');url.searchParams.set('ticket',ticket);url.searchParams.set('state',state);return url.href;
}
export async function consumirAcessoSso(db:PoolClient,tool:FerramentaSso,ticket:string,state:string){
 if(!opaque(ticket)||!opaque(state))throw new PedidoInvalido('Acesso inválido ou expirado.');
 const{rows}=await db.query('SELECT * FROM consumir_sso_ferramenta($1,$2,$3)',[hash(ticket),tool,hash(state)]);
 if(!rows[0])throw new PedidoInvalido('Acesso inválido ou expirado.');return{...rows[0],ferramenta:tool};
}
