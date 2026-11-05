import {test,expect,describe} from 'bun:test';
import {textoPublicacao,prazosExpressos,sugerirPrazo} from '../src/server/publicacao_analise.ts';

describe('Publicação DJEN legível e ancorada',()=>{
 test('decodifica acentos, entidades numéricas e dupla codificação sem executar marcação',()=>{
  expect(textoPublicacao('&lt;p&gt;Intima&amp;ccedil;&amp;atilde;o&nbsp;n&#186; 12&lt;br&gt;Prazo de 5 dias.&lt;/p&gt;<script>alert(1)</script>')).toBe('Intimação nº 12\nPrazo de 5 dias.');
  expect(textoPublicacao('A &amp; B &unknown; &#x1F4C4;')).toBe('A & B &unknown; 📄');
 });
 test('preserva linhas de tabela STJ e espaço entre rótulos e valores, removendo cabeçalho técnico',()=>{
  const source='<?xml version="1.0"?><html><head><title>Arquivo técnico</title><style>table{}</style></head><body><h2>Intimação</h2><table><tr><td>REsp 1234/PR (2026/000001-0)</td></tr><tr><th>RELATOR:</th><td>MINISTRO TESTE</td></tr><tr><th>RECORRENTE:</th><td>EMPRESA &amp; CIA.</td></tr></table><p>Prazo de 5 dias.</p><!--metadados--></body></html>';
  const readable=textoPublicacao(source);
  expect(readable).toContain('REsp 1234/PR (2026/000001-0)\nRELATOR: MINISTRO TESTE\nRECORRENTE: EMPRESA & CIA.');
  expect(readable).not.toContain('Arquivo técnico');expect(readable).not.toContain('table{}');expect(readable).not.toContain('metadados');expect(readable).not.toContain('<?xml');
  const encoded=source.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  expect(textoPublicacao(encoded)).toBe(readable);
 });
 test('extrai dias e trecho exato, inclusive por extenso, sem fabricar prazo legal',()=>{
  expect(prazosExpressos('Manifeste-se no prazo de 15 (quinze) dias úteis.')[0]).toMatchObject({dias:15,regime:'uteis',regimeExplicito:true,trecho:'prazo de 15 (quinze) dias úteis'});
  expect(prazosExpressos('Responda em cinco dias corridos.')[0]).toMatchObject({dias:5,regime:'corridos'});
  expect(prazosExpressos('Intime-se no prazo legal.')).toEqual([]);
 });
 test('dois prazos diferentes impedem o botão de agendamento rápido',async()=>{
  const r=await sugerirPrazo('Prazo de 5 dias para A. Prazo de 15 dias para B.','2026-11-04',{env:{}});
  expect(r.sugestao).toBeNull();expect(r.candidatos).toHaveLength(2);expect(r.fonte).toBe('extracao_literal');
 });
 test('IA chamada de verdade pelo contrato local mas dias inventados nunca viram sugestão',async()=>{
  let body:any;
  const fake:typeof fetch=(async(_url:unknown,init?:RequestInit)=>{body=JSON.parse(String(init?.body));return Response.json({done:true,model:'qwen3:1.7b',message:{content:JSON.stringify({resumo:'Determinação de manifestação.',dias:15,trecho:'prazo de 15 dias'})}});}) as typeof fetch;
  const r=await sugerirPrazo('Intime-se no prazo legal.','2026-11-04',{fetch:fake,env:{NGA_IA_PROVEDOR:'ollama',NGA_MODELO_IA:'qwen3:1.7b'}});
  expect(body.model).toBe('qwen3:1.7b');expect(body.messages[0].content).toContain('DADO NÃO CONFIÁVEL');expect(r.fonte).toBe('ia_local');expect(r.sugestao).toBeNull();expect(r.avisoIA).toContain('descartada');
 });
 test('contagem é determinística e indisponibilidade de IA fica explícita',async()=>{
  const fake:typeof fetch=(async()=>{throw new Error('offline');}) as unknown as typeof fetch;
  const r=await sugerirPrazo('Intimação: prazo de cinco dias úteis.','2026-11-04',{fetch:fake,env:{NGA_IA_PROVEDOR:'ollama'}});
  expect(r.fonte).toBe('extracao_literal');expect(r.avisoIA).toContain('não concluiu');expect(r.sugestao?.dias).toBe(5);expect(r.sugestao?.calculo?.exigeConferencia).toBe(true);expect(r.exigeConfirmacao).toBe(true);
 });
});
