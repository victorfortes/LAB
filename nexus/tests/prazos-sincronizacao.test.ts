import{test,expect}from'bun:test';
import{receberPrazos,EsquemaPrazosRecebidos}from'../src/server/integracoes.ts';
import type{Integracao}from'../src/security/integracao.ts';
const credential:Integracao={id:'cred',organizacaoId:'org',usuarioId:'servico',nome:'NGA Prazos',aplicacao:'prazos',escopos:['prazos']};
const data=()=>EsquemaPrazosRecebidos.parse({prazos:[{numeroProcesso:'0001234-56.2024.8.16.0001',titulo:'Manifestação',evento:'2026-11-04',dias:5,regime:'uteis',externoId:'astrea:A1',astreaId:'A1',confirmadoPorLeitura:true,vencimentoConfirmado:'2026-11-10',tarefasAcompanhamento:[{tipo:'analise',titulo:'Analisar intimação',data:'2026-11-05'},{tipo:'protocolo',titulo:'Conferir protocolo',data:'2026-11-11'}]}]});
test('recepção Astrea individualizada mantém vencimento conferido, sinaliza divergência e não duplica tarefas',async()=>{
 const deadlines:Array<unknown[]>=[],tasks:Array<unknown[]>=[];
 const db={query:async(sql:string,args:unknown[])=>{
  if(sql.startsWith('SELECT id,projeto_id FROM processos'))return{rows:[{id:'processo',projeto_id:'projeto'}]};
  if(sql.includes("calculo->>'externoId'"))return{rows:deadlines.length?[{id:'prazo'}]:[]};
  if(sql.includes('INSERT INTO prazos')){deadlines.push(args);return{rows:[{id:'prazo'}]};}
  if(sql.includes('INSERT INTO tarefas'))tasks.push(args);
  return{rows:[]};
 }};
 const first=await receberPrazos(db as never,credential,data());expect(first.criados).toBe(1);expect(first.recusados).toEqual([]);
 expect(deadlines[0]![8]).toBe('2026-11-10');const meta=JSON.parse(String(deadlines[0]![9]));expect(meta.confirmadoPorLeitura).toBe(true);expect(meta.divergenciaDeContagem).toBe(true);expect(meta.vencimentoCalculado).not.toBe(meta.vencimentoAstrea);
 expect(tasks).toHaveLength(3);expect(tasks.every(t=>t[1]==='projeto')).toBe(true);expect(tasks.every(t=>t[4]===null)).toBe(true);
 const again=await receberPrazos(db as never,credential,data());expect(again.repetidos).toBe(1);expect(deadlines).toHaveLength(1);expect(tasks).toHaveLength(3);
});
test('vencimento confirmado exige credencial Prazos, confirmação identificada e processo com projeto',async()=>{
 const db={query:async()=>({rows:[{id:'processo',projeto_id:null}]})};
 const orphan=await receberPrazos(db as never,credential,data());expect(orphan.criados).toBe(0);expect(orphan.recusados[0]?.motivo).toContain('sem projeto');
 const wrong=await receberPrazos(db as never,{...credential,aplicacao:'outra'},data());expect(wrong.criados).toBe(0);expect(wrong.recusados[0]?.motivo).toContain('credencial Prazos');
});

test('vínculo manual de publicação não move processo que pertence a outro projeto',async()=>{
 const{vincularProjetoDaPublicacao}=await import('../src/server/controladoria.ts');let mutated=false;
 const db={query:async(sql:string)=>{
  if(sql.startsWith('SELECT * FROM publicacoes'))return{rows:[{id:'pub',organizacao_id:'org',numero_processo:'00012345620248160001'}]};
  if(sql.startsWith('SELECT id,organizacao_id FROM projetos'))return{rows:[{id:'destino',organizacao_id:'org'}]};
  if(sql.startsWith('SELECT id,projeto_id FROM processos'))return{rows:[{id:'processo',projeto_id:'outro-cliente'}]};
  if(sql.startsWith('UPDATE')||sql.startsWith('INSERT'))mutated=true;return{rows:[]};
 }};
 await expect(vincularProjetoDaPublicacao(db as never,'pub','destino',{} as never)).rejects.toThrow('outro projeto');expect(mutated).toBe(false);
});
