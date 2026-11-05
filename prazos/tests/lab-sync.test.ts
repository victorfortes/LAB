import{test,expect}from'bun:test';
import{LabSync,labPayload,labUrl}from'../src/server/lab-sync.ts';
import{Vault}from'../src/security/vault.ts';
import{Writer}from'../src/writer/writer.ts';
import{actor,authorizeWrites,runAll,setup}from'./helpers.ts';
import{join}from'node:path';import{tmpdir}from'node:os';
const testVault=()=>new Vault(join(tmpdir(),'nga-lab-test-'+crypto.randomUUID()+'.json'),async()=>Buffer.alloc(32,3));
async function confirmed(){const{s,repo,astrea,cfg}=await setup();await runAll(s);const r=(await repo.listRecords()).find(x=>x.externalId==='SIM-001')!;await s.workflow.approve(r.id,actor('operator'),true);await authorizeWrites(s);return{s,repo,astrea,cfg,r};}
test('gravação Astrea confirmada dispara entrega idempotente e preserva vencimento relido',async()=>{
 const{s,repo,astrea,cfg,r}=await confirmed();const sent:any[]=[];const vault=testVault();
 const fake:typeof fetch=(async(url:unknown,init?:RequestInit)=>{expect(String(url)).toBe('http://127.0.0.1:8790/api/integracao/prazos');sent.push(JSON.parse(String(init?.body)));return Response.json({criados:1,repetidos:0,recusados:[]});})as typeof fetch;
 const sync=new LabSync(repo,{vault,mode:'live',fetch:fake,env:{}});await sync.configure('http://127.0.0.1:8790','nga_int_'+'x'.repeat(40));
 const writer=new Writer(repo,astrea,{...cfg,onConfirmed:id=>sync.drain({recordId:id})});const out=await writer.write(r.id,actor('admin'));
 expect(out.confirmedInAstrea).toBe(true);expect(sent).toHaveLength(1);
 const schedule=[...astrea.schedules.values()][0]!;expect(sent[0].prazos[0].vencimentoConfirmado).toBe(schedule.dueDate);expect(sent[0].prazos[0].confirmadoPorLeitura).toBe(true);expect(sent[0].prazos[0].tarefasAcompanhamento).toHaveLength(2);
 await sync.drain({force:true});expect(sent).toHaveLength(1);expect((await sync.status()).enviados).toBe(1);
});
test('falha LAB deixa fila durável sem repetir Astrea; nova instância recupera',async()=>{
 const{s,repo,astrea,r}=await confirmed();await s.writer.write(r.id,actor('admin'));const writes=astrea.writes;const vault=testVault();let calls=0;
 const fake:typeof fetch=(async()=>{calls++;return calls===1?new Response('',{status:503}):Response.json({criados:0,repetidos:1,recusados:[]});})as unknown as typeof fetch;
 const first=new LabSync(repo,{vault,mode:'live',fetch:fake,env:{}});await first.configure('https://lab.example','nga_int_'+'y'.repeat(40));await first.drain();expect((await first.status()).pendentes).toBe(1);
 const recovered=new LabSync(repo,{vault,mode:'live',fetch:fake,env:{}});await recovered.drain({force:true});expect((await recovered.status()).enviados).toBe(1);expect(astrea.writes).toBe(writes);
});
test('simulador nunca envia dados para LAB e operação não confirmada não gera payload',async()=>{
 const{s,repo,r}=await confirmed();await s.writer.write(r.id,actor('admin'));let called=false;const sync=new LabSync(repo,{vault:testVault(),mode:'simulated',fetch:(async()=>{called=true;return Response.json({});})as unknown as typeof fetch,env:{}});await sync.drain();expect(called).toBe(false);expect(await repo.listLabDeliveries()).toHaveLength(0);
 const op=(await repo.listAllWriteOps()).find(o=>!o.expected.kind)!;expect(labPayload({...op,status:'divergent'},r)).toBeNull();expect(labPayload({...op,readBack:null},r)).toBeNull();
 expect(()=>labUrl('http://external.example')).toThrow();expect(()=>labUrl('https://user:pass@external.example')).toThrow();
});
