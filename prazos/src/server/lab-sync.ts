/** Durable outbox: only Astrea schedules confirmed by read-back may reach LAB. */
import {createHash} from 'node:crypto';
import type {Repo} from '../store/repo.ts';
import type {Rec,WriteOp} from '../store/models.ts';
import type {Vault} from '../security/vault.ts';
import {followUpPlan} from '../writer/tasks.ts';

export function labUrl(value:string){
 const u=new URL(value);const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(u.username||u.password||!(u.protocol==='https:'||(u.protocol==='http:'&&local)))throw new Error('Use HTTPS para o LAB, ou HTTP apenas no endereço local.');
 const prefix=u.pathname.replace(/\/api\/integracao\/prazos\/?$/,'').replace(/\/+$/,'');
 u.pathname=prefix+'/api/integracao/prazos';u.search='';u.hash='';return u.href;
}
export function labPayload(op:WriteOp,record:Rec,options:{holidays?:ReadonlySet<string>;protocolResponsible?:string}={}){
 if(op.status!=='confirmed'||!op.astreaId||op.expected.kind)return null;
 const read=op.readBack;const action=record.analysis.actions.find(a=>a.id===op.actionId);
 if(!read||!action?.deadline||!['dias_uteis','dias_corridos'].includes(action.deadline.unit)||typeof read.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(read.dueDate)||read.processNumber!==record.processNumber)return null;
 const today=new Date(op.updatedAt).toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'});
 const tasks=followUpPlan({amount:action.deadline.amount,endTerm:read.dueDate},typeof read.responsible==='string'?read.responsible:null,{today,holidays:options.holidays??new Set(),protocolResponsible:options.protocolResponsible??'Camilla Rodrigues'});
 return {prazos:[{tarefasAcompanhamento:tasks.map(t=>({tipo:t.kind,titulo:t.title,data:t.dueDate,responsavelNome:t.responsible})),numeroProcesso:record.processNumber,titulo:String(read.title??op.expected.title).slice(0,200),evento:record.availabilityDate,origem:'disponibilizacao_dje',dias:action.deadline.amount,regime:action.deadline.unit==='dias_corridos'?'corridos':'uteis',externoId:`astrea:${op.astreaId}`,vencimentoConfirmado:read.dueDate,astreaId:op.astreaId,responsavelNome:typeof read.responsible==='string'?read.responsible:undefined,confirmadoPorLeitura:true}]};
}
export class LabSync {
 private busy=false;
 constructor(private repo:Repo,private opts:{vault:Vault;mode:'simulated'|'live';holidays?:ReadonlySet<string>;protocolResponsible?:string;fetch?:typeof fetch;env?:Record<string,string|undefined>}){}
 private async credentials(){
  const env=this.opts.env??process.env;
  if(env.NGA_LAB_URL&&env.NGA_LAB_TOKEN)return{email:labUrl(env.NGA_LAB_URL),password:env.NGA_LAB_TOKEN};
  const saved=await this.opts.vault.load('lab');return saved?{...saved,email:labUrl(saved.email)}:null;
 }
 async configure(url:string,token:string){
  const endpoint=labUrl(url);if(token.trim().length<32)throw new Error('Token de integração inválido. Gere uma credencial de Prazos no LAB.');
  await this.opts.vault.save('lab',{email:endpoint,password:token.trim()});
 }
 async status(){
  const rows=await this.repo.listLabDeliveries();const env=this.opts.env??process.env;
  return{configurado:this.opts.vault.has('lab')||!!(env.NGA_LAB_URL&&env.NGA_LAB_TOKEN),habilitado:this.opts.mode==='live',pendentes:rows.filter(x=>x.status==='pending').length,enviados:rows.filter(x=>x.status==='sent').length,falhas:rows.filter(x=>x.error).map(x=>({key:x.key,erro:x.error,tentativas:x.attempts,proximaTentativa:x.nextAttemptAt})).slice(0,30)};
 }
 async enqueueConfirmed(recordId?:string){
  if(this.opts.mode!=='live')return;
  for(const op of (await this.repo.listAllWriteOps()).filter(o=>!recordId||o.recordId===recordId)){
   if(op.status!=='confirmed'||op.expected.kind)continue;
   const record=await this.repo.getRecord(op.recordId);if(!record)continue;
   const payload=labPayload(op,record,this.opts);if(!payload)continue;
   const key=createHash('sha256').update(op.key+'|'+JSON.stringify(payload)).digest('hex');const at=new Date().toISOString();
   await this.repo.enqueueLabDelivery({key,recordId:op.recordId,payload,status:'pending',attempts:0,error:null,nextAttemptAt:at,updatedAt:at});
  }
 }
 async drain(options:{force?:boolean;recordId?:string}={}){
  if(this.busy||this.opts.mode!=='live')return{enviados:0,pendentes:0};this.busy=true;
  let sent=0;
  try{
   await this.enqueueConfirmed(options.recordId);const credentials=await this.credentials();
   if(!credentials)return{enviados:0,pendentes:(await this.repo.listLabDeliveries()).filter(x=>x.status==='pending').length};
   const rows=(await this.repo.listLabDeliveries()).filter(x=>x.status==='pending'&&(!options.recordId||x.recordId===options.recordId)&&(options.force||Date.parse(x.nextAttemptAt)<=Date.now())).slice(0,50);
   for(const d of rows){
    try{
     const r=await(this.opts.fetch??fetch)(credentials.email,{method:'POST',headers:{authorization:`Bearer ${credentials.password}`,'content-type':'application/json'},body:JSON.stringify(d.payload),signal:AbortSignal.timeout(20000)});
     if(!r.ok)throw new Error(`LAB HTTP ${r.status}; confira a conexão e a credencial.`);
     const data=await r.json() as {criados?:number;repetidos?:number;pendentesVinculo?:number;recusados?:Array<{motivo:string}>};
     if(data.recusados?.length)throw new Error(data.recusados.map(x=>x.motivo).join('; ').slice(0,300));
     if((data.criados??0)+(data.repetidos??0)+(data.pendentesVinculo??0)<1)throw new Error('LAB não confirmou recebimento do prazo.');
     await this.repo.updateLabDelivery(d.key,{status:'sent',attempts:d.attempts+1,error:null,updatedAt:new Date().toISOString()});sent++;
     await this.repo.appendAudit({actor:'integracao-lab',action:'lab.prazo_sincronizado',entityType:'record',entityId:d.recordId,data:{key:d.key}});
    }catch(error){
     const message=(error as Error).message.startsWith('LAB')||(error as Error).message.includes('processo não cadastrado')?(error as Error).message:'Falha de conexão com LAB. O prazo permanece na fila para nova tentativa.';
     await this.repo.updateLabDelivery(d.key,{attempts:d.attempts+1,error:message.slice(0,300),nextAttemptAt:new Date(Date.now()+Math.min(3600000,60000*2**Math.min(d.attempts,6))).toISOString(),updatedAt:new Date().toISOString()});
    }
   }
   return{enviados:sent,pendentes:(await this.repo.listLabDeliveries()).filter(x=>x.status==='pending').length};
  }finally{this.busy=false;}
 }
}
