import { expect, test } from 'bun:test';
import { ProvedorOllama, ProvedorIndisponivel, RespostaInvalida, provedorDoAmbiente } from '../src/ai/provedor.ts';
const pedido={sistema:'Só cite o documento',tarefa:'Analise',documento:'Documento de teste'};
test('Ollama é selecionável sem credencial externa e só admite serviço local',()=>{
 expect(provedorDoAmbiente({NGA_IA_PROVEDOR:'ollama',NGA_MODELO_IA:'qwen3:1.7b'}).nome).toBe('ollama');
 expect(()=>new ProvedorOllama({modelo:'x',url:'https://exemplo.com'})).toThrow(ProvedorIndisponivel);
 expect(()=>new ProvedorOllama({modelo:'x:cloud'})).toThrow(ProvedorIndisponivel);
 expect(()=>new ProvedorOllama({modelo:'gpt-oss:120b-cloud'})).toThrow(ProvedorIndisponivel);
});
test('resposta local válida mantém modelo e contagem e exige formato estruturado',async()=>{
 const p=new ProvedorOllama({modelo:'qwen3:1.7b',fetch:(async(url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1])=>{
  expect(String(url)).toBe('http://127.0.0.1:11434/api/chat');
  const body=JSON.parse(String(init?.body));expect(body.stream).toBe(false);expect(body.format.required).toContain('achados');
  return Response.json({model:'qwen3:1.7b',done:true,done_reason:'stop',message:{content:JSON.stringify({resumo:'Leitura',achados:[],suspeitas_de_injecao:[]})},prompt_eval_count:20,eval_count:10});
 }) as unknown as typeof fetch});
 const r=await p.analisar(pedido);expect(r.modelo).toBe('ollama/qwen3:1.7b');expect(r.tokensEntrada).toBe(20);
});
test('erro de servidor e resposta fora do esquema não viram análise falsa',async()=>{
 const offline=new ProvedorOllama({modelo:'x',fetch:(async()=>Response.json({error:'missing'},{status:404})) as unknown as typeof fetch});
 await expect(offline.analisar(pedido)).rejects.toThrow(ProvedorIndisponivel);
 const errado=new ProvedorOllama({modelo:'x',fetch:(async()=>Response.json({done:true,message:{content:'{"conclusao":"inventada"}'}})) as unknown as typeof fetch});
 await expect(errado.analisar(pedido)).rejects.toThrow(RespostaInvalida);
});
