import type { PoolClient } from 'pg';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { Identidade } from '../security/sessao.ts';
import { hashDaSenha,hashDoToken,tokenNovo } from '../security/sessao.ts';
import { auditar } from '../store/conexao.ts';
import { PedidoInvalido,NaoEncontrado } from './erros.ts';
import * as tarefas from './tarefas.ts';
const papeis=['socio_administrador','socio','advogado','controladoria','financeiro','administrativo','estagiario'] as const;
export const EsquemaPessoa=z.object({nome:z.string().trim().min(2).max(200),email:z.string().trim().toLowerCase().email().max(200),papel:z.enum(papeis)});
export const EsquemaAcesso=z.object({papel:z.enum(papeis).optional(),revogar:z.boolean().optional()}).refine(d=>d.revogar===true || !!d.papel,'informe o acesso desejado');
export const EsquemaSenha=z.object({token:z.string().regex(/^[0-9a-f]{64}$/),senha:z.string().min(12).max(256)});
export const EsquemaMarco=z.object({titulo:z.string().trim().min(1).max(300),descricao:z.string().max(5000).default(''),dataPrevista:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),visivelCliente:z.boolean().default(false)});
export const EsquemaAtualizarMarco=z.object({titulo:z.string().trim().min(1).max(300).optional(),descricao:z.string().max(5000).optional(),dataPrevista:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),visivelCliente:z.boolean().optional(),concluido:z.boolean().optional()}).refine(d=>Object.keys(d).length>0,'nada a alterar');
function org(i:Identidade){const o=i.organizacoes.find(o=>o.tipo==='escritorio'&&o.papel==='socio_administrador');if(!o)throw new PedidoInvalido('somente a administração do escritório pode gerenciar acessos');return o.id;}
export async function listar(db:PoolClient,i:Identidade){
 const o=org(i);const pessoas=(await db.query('SELECT * FROM listar_gestao_equipe($1)',[o])).rows;
 const cargas=(await db.query(`SELECT t.responsavel_id,count(*) FILTER(WHERE t.status<>'concluida')::int abertas,count(*) FILTER(WHERE t.status<>'concluida' AND t.prazo<(now() AT TIME ZONE 'America/Sao_Paulo')::date)::int atrasadas,count(*) FILTER(WHERE t.status='concluida')::int concluidas FROM tarefas t WHERE t.organizacao_id=$1 GROUP BY t.responsavel_id`,[o])).rows;
 const projetos=(await db.query(`SELECT e.usuario_id,p.id,p.nome,e.papel FROM projeto_equipe e JOIN projetos p ON p.id=e.projeto_id WHERE e.organizacao_id=$1 AND e.ate IS NULL AND p.situacao<>'encerrado'`,[o])).rows;
 return pessoas.map(p=>({...p,carga:cargas.find(c=>c.responsavel_id===p.id)??{abertas:0,atrasadas:0,concluidas:0},projetos:projetos.filter(e=>e.usuario_id===p.id)})).sort((a,b)=>a.nome.localeCompare(b.nome));
}
async function link(db:PoolClient,usuarioId:string,i:Identidade){
 const o=org(i);const tem=(await db.query(`SELECT id FROM listar_gestao_equipe($1) WHERE id=$2 AND ativo`,[o,usuarioId])).rows[0];if(!tem)throw new NaoEncontrado('pessoa ativa não encontrada nesta equipe');
 const token=tokenNovo();await db.query('UPDATE equipe_redefinicoes SET usado_em=now() WHERE usuario_id=$1 AND usado_em IS NULL',[usuarioId]);
 await db.query('INSERT INTO equipe_redefinicoes(token_hash,usuario_id,organizacao_id,criado_por) VALUES($1,$2,$3,$4)',[hashDoToken(token),usuarioId,o,i.usuarioId]);
 await auditar(db,{organizacaoId:o,usuarioId:i.usuarioId,acao:'equipe.link_senha_criado',entidade:'usuario',entidadeId:usuarioId});
 return {usuarioId,caminho:`/definir-senha?token=${token}`,expiraEm:new Date(Date.now()+30*60000).toISOString(),aviso:'Link de uso único, válido por 30 minutos. Compartilhe diretamente com a pessoa; não fica salvo em claro.'};
}
async function gerir(db:PoolClient,args:unknown[]){
 try{return await db.query<{id:string}>('SELECT gerir_pessoa_equipe($1,$2,$3,$4,$5,$6,$7) id',args);}
 catch(e){const erro=e as {code?:string;message:string};if(erro.code==='P0001')throw new PedidoInvalido(erro.message);if(erro.code==='42501')throw new NaoEncontrado('pessoa não encontrada nesta equipe');throw e;}
}
export async function convidar(db:PoolClient,d:z.infer<typeof EsquemaPessoa>,i:Identidade){
 const o=org(i);const hash=await hashDaSenha(randomBytes(32).toString('hex'));
 const r=await gerir(db,[o,null,d.nome,d.email,d.papel,'convidar',hash]);
 const id=r.rows[0]!.id;await auditar(db,{organizacaoId:o,usuarioId:i.usuarioId,acao:'equipe.pessoa_criada',entidade:'usuario',entidadeId:id,depois:{nome:d.nome,email:d.email,papel:d.papel}});
 return {id,...await link(db,id,i)};
}
export async function acesso(db:PoolClient,id:string,d:z.infer<typeof EsquemaAcesso>,i:Identidade){
 const o=org(i);await gerir(db,[o,id,null,null,d.papel??null,d.revogar?'revogar':'alterar',null]);
 await auditar(db,{organizacaoId:o,usuarioId:i.usuarioId,acao:d.revogar?'equipe.acesso_revogado':'equipe.acesso_alterado',entidade:'usuario',entidadeId:id,depois:d});return {id};
}
export const gerarLink=link;
export async function definirSenha(db:PoolClient,d:z.infer<typeof EsquemaSenha>){await db.query('SELECT definir_senha_equipe($1,$2)',[hashDoToken(d.token),await hashDaSenha(d.senha)]);return {ok:true};}
export async function visao(db:PoolClient,id:string){
 const p=(await db.query('SELECT id FROM projetos WHERE id=$1',[id])).rows[0];if(!p)throw new NaoEncontrado('projeto não encontrado');
 const marcos=(await db.query('SELECT id,titulo,descricao,data_prevista AS "dataPrevista",concluido_em AS "concluidoEm",visivel_cliente AS "visivelCliente" FROM projeto_marcos WHERE projeto_id=$1 ORDER BY data_prevista NULLS LAST,criado_em',[id])).rows;
 const atividades=(await db.query(`SELECT a.id,a.acao,a.ocorrido_em AS criado_em,u.nome AS autor FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id WHERE a.entidade_id=($1::uuid)::text OR EXISTS(SELECT 1 FROM documentos d WHERE d.projeto_id=$1 AND d.id::text=a.entidade_id) OR EXISTS(SELECT 1 FROM tarefas t WHERE t.projeto_id=$1 AND t.id::text=a.entidade_id) OR EXISTS(SELECT 1 FROM requisitos r WHERE r.projeto_id=$1 AND r.id::text=a.entidade_id) ORDER BY a.ocorrido_em DESC LIMIT 12`,[id])).rows;
 const agenda=(await db.query('SELECT id,titulo,inicio,fim,marcador,meet_url AS "meetUrl" FROM google_eventos WHERE projeto_id=$1 AND fim>=now() ORDER BY inicio LIMIT 8',[id])).rows;
 const burnup=(await db.query(`SELECT dia::date AS dia,count(t.id) FILTER(WHERE (t.criado_em AT TIME ZONE 'America/Sao_Paulo')::date<=dia::date)::int AS total,count(t.id) FILTER(WHERE (t.concluida_em AT TIME ZONE 'America/Sao_Paulo')::date<=dia::date)::int AS concluidas FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date-29,(now() AT TIME ZONE 'America/Sao_Paulo')::date,'1 day'::interval) dia LEFT JOIN tarefas t ON t.projeto_id=$1 GROUP BY dia ORDER BY dia`,[id])).rows;
 return {marcos,atividades,agenda,burnup,tarefas:await tarefas.listar(db,{projetoId:id,incluirConcluidas:true})};
}
export async function criarMarco(db:PoolClient,id:string,d:z.infer<typeof EsquemaMarco>,i:Identidade){const p=(await db.query<{organizacao_id:string}>('SELECT organizacao_id FROM projetos WHERE id=$1',[id])).rows[0];if(!p)throw new NaoEncontrado('projeto não encontrado');const r=await db.query('INSERT INTO projeto_marcos(projeto_id,organizacao_id,titulo,descricao,data_prevista,visivel_cliente,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[id,p.organizacao_id,d.titulo,d.descricao,d.dataPrevista??null,d.visivelCliente,i.usuarioId]);await auditar(db,{organizacaoId:p.organizacao_id,usuarioId:i.usuarioId,acao:'projeto.marco_criado',entidade:'projeto',entidadeId:id,depois:{titulo:d.titulo}});return r.rows[0];}
export async function atualizarMarco(db:PoolClient,id:string,d:z.infer<typeof EsquemaAtualizarMarco>,i:Identidade){const p=(await db.query<{organizacao_id:string;projeto_id:string}>('SELECT organizacao_id,projeto_id FROM projeto_marcos WHERE id=$1',[id])).rows[0];if(!p)throw new NaoEncontrado('marco não encontrado');const cols:Record<string,string>={titulo:'titulo',descricao:'descricao',dataPrevista:'data_prevista',visivelCliente:'visivel_cliente',concluido:'concluido_em'};const args:unknown[]=[id],sets:string[]=[];for(const[k,v]of Object.entries(d)){args.push(k==='concluido'?(v?new Date():null):v);sets.push(`${cols[k]}=$${args.length}`);}await db.query(`UPDATE projeto_marcos SET ${sets.join(',')} WHERE id=$1`,args);await auditar(db,{organizacaoId:p.organizacao_id,usuarioId:i.usuarioId,acao:'projeto.marco_atualizado',entidade:'projeto',entidadeId:p.projeto_id,depois:d});return {id};}

export function paginaSenha(){const nonce=crypto.randomUUID();return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Definir senha · NGA LAB</title><style nonce="${nonce}">body{font:16px system-ui;background:#101722;color:#f1eee5;min-height:95vh;display:grid;place-items:center}main{max-width:400px;padding:36px;border:1px solid #394352;border-radius:22px}label,input,button{display:block;width:100%;box-sizing:border-box;margin:12px 0}input,button{padding:12px;border-radius:12px;border:1px solid #697483}button{background:#d4b474;color:#17202b;font-weight:700}p{line-height:1.5}a{color:#dfc38d}</style><main><p>NGA LAB · Acesso pessoal</p><h1>Defina sua senha</h1><p>Escolha uma senha com pelo menos 12 caracteres. O link funciona uma única vez.</p><form id="f"><label>Nova senha<input name="senha" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><label>Confirme a senha<input name="confirmacao" type="password" autocomplete="new-password" required></label><button>Salvar senha</button></form><p id="r" role="status"></p><a href="/">Ir para o sistema</a></main><script nonce="${nonce}">const f=document.getElementById('f'),r=document.getElementById('r'),token=new URLSearchParams(location.search).get('token');f.addEventListener('submit',async(e)=>{e.preventDefault();if(f.senha.value!==f.confirmacao.value){r.textContent='As senhas não coincidem.';return;}f.querySelector('button').disabled=true;try{const a=await fetch('/api/equipe/definir-senha',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,senha:f.senha.value})});if(!a.ok)throw Error('Link inválido ou expirado. Solicite um novo link à administração.');f.remove();history.replaceState({},'',location.pathname);r.textContent='Senha definida. Você já pode entrar no sistema.';}catch(e){r.textContent=e.message;f.querySelector('button').disabled=false;}});</script></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; connect-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`}});}
