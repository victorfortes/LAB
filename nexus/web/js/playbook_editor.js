/** Shared structure editor; every node and trigger comes from the office/project database. */
import { api } from './api.js';
import { html, icone, ouvir, raw } from './util.js';
import { confirmar, erroDe, formulario, toast } from './ui.js';
export const TIPOS_NO={fase:'Fase do procedimento',etapa:'Etapa de trabalho',tarefa:'Tarefa'};
export const GATILHOS_NO={manual:'Ao aplicar manualmente',projeto_criado:'Ao criar/aplicar o projeto',fase_iniciada:'Ao entrar na fase',documento_cliente_enviado:'Ao receber documento do cliente'};
export function ordenarArvore(nos){const ativos=nos.filter(n=>!n.arquivado),ids=new Set(ativos.map(n=>n.id)),saida=[];const visitar=(pai,prof)=>{for(const n of ativos.filter(n=>(ids.has(n.paiId)?n.paiId:null)===pai).sort((a,b)=>a.ordem-b.ordem||a.nome.localeCompare(b.nome))){saida.push({...n,profundidade:prof});visitar(n.id,prof+1);}};visitar(null,0);return saida;}
export function htmlEstrutura(nos,{editar=false,selecionar=false,tarefas=[]}={}){const ordem=ordenarArvore(nos);return html`<div class="pb-structure">${ordem.map(n=>{const ts=tarefas.filter(t=>t.playbook_no_id===n.id||t.playbookNoId===n.id),feitas=ts.filter(t=>t.status==='concluida').length;return html`<div class="pb-node" style="--nivel:${n.profundidade}"><span class="pb-node__connector" aria-hidden="true"></span><div class="pb-node__main"><span class="pb-node__type ${n.tipo}">${icone(n.tipo==='fase'?'flag':n.tipo==='etapa'?'list':'check')}${TIPOS_NO[n.tipo]}</span><b>${n.nome}</b>${n.descricao?html`<p>${n.descricao}</p>`:''}${n.tipo==='tarefa'?html`<small>${GATILHOS_NO[n.gatilho]??n.gatilho} · ${n.diasUteis} dia(s) útil(eis) · ${n.prioridade}</small>`:''}${ts.length?html`<span class="selo ${feitas===ts.length?'ok':'info'}">${feitas}/${ts.length} concluídas</span>`:''}</div><div class="pb-node__actions">${selecionar?html`<button class="btn btn--ghost btn--sm" data-pb-detalhes="${n.id}">Detalhes</button>`:''}${editar?html`<button class="ibtn ibtn--sm" data-pb-filho="${n.id}" title="Adicionar filho" aria-label="Adicionar filho em ${n.nome}">${icone('plus')}</button><button class="btn btn--ghost btn--sm" data-pb-editar="${n.id}">Editar</button><button class="ibtn ibtn--sm" data-pb-remover="${n.id}" title="Arquivar" aria-label="Arquivar ${n.nome}">${icone('trash')}</button>`:''}</div></div>`;})}</div>`;}
export async function editarNo({no={},nos,endpoint,paiId,depois}){
 const ativos=ordenarArvore(nos).filter(n=>n.id!==no.id);
 const ok=await formulario({titulo:no.id?'Editar nó do playbook':'Novo nó do playbook',largo:true,campos:[
  {nome:'nome',rotulo:'Nome',obrigatorio:true,valor:no.nome},
  {nome:'tipo',rotulo:'Tipo',tipo:'select',valor:no.tipo??'etapa',metade:true,opcoes:Object.entries(TIPOS_NO).map(([v,t])=>({v,t}))},
  {nome:'paiId',rotulo:'Nó pai',tipo:'select',valor:paiId??no.paiId??'',metade:true,opcoes:[{v:'',t:'Raiz (sem pai)'},...ativos.map(n=>({v:n.id,t:`${'— '.repeat(n.profundidade)}${n.nome} (${TIPOS_NO[n.tipo]})`}))]},
  {nome:'ordem',rotulo:'Ordem entre os nós',tipo:'number',min:0,valor:no.ordem??ativos.length*10,metade:true},
  {nome:'gatilho',rotulo:'Gerar tarefa quando',tipo:'select',valor:no.gatilho??'manual',metade:true,opcoes:Object.entries(GATILHOS_NO).map(([v,t])=>({v,t})),dica:'O gatilho se aplica a nós do tipo Tarefa. Filhas são vinculadas à tarefa mãe gerada.'},
  {nome:'diasUteis',rotulo:'Prazo operacional em dias úteis',dica:'Segunda a sexta; confira os feriados. Não substitui prazo processual.',tipo:'number',min:0,valor:no.diasUteis??1,metade:true},
  {nome:'prioridade',rotulo:'Prioridade',tipo:'select',valor:no.prioridade??'media',metade:true,opcoes:['baixa','media','alta','urgente'].map(v=>({v,t:v}))},
  {nome:'descricao',rotulo:'Descrição e orientações',tipo:'textarea',valor:no.descricao}],
  enviar:async v=>{const dados={...v,paiId:v.paiId??null,ordem:v.ordem??0};if(no.id)await api.patch(`/api/playbook-nos/${no.id}`,dados);else await api.post(endpoint,dados);toast('Estrutura salva');},
 });if(ok)depois?.();
}
export function ligarEditor(raiz,{nos,endpoint,depois}){
 ouvir(raiz,'click','[data-pb-adicionar]',()=>editarNo({nos,endpoint,depois}));
 ouvir(raiz,'click','[data-pb-filho]',b=>editarNo({nos,endpoint,paiId:b.dataset.pbFilho,depois}));
 ouvir(raiz,'click','[data-pb-editar]',b=>editarNo({no:nos.find(n=>n.id===b.dataset.pbEditar),nos,endpoint,depois}));
 ouvir(raiz,'click','[data-pb-remover]',async b=>{const n=nos.find(n=>n.id===b.dataset.pbRemover);if(!await confirmar('Arquivar este nó e seus filhos?',`“${n.nome}” sairá da estrutura ativa. Tarefas e histórico já gerados serão preservados.`,{rotulo:'Arquivar'}))return;try{await api.del(`/api/playbook-nos/${n.id}`);toast('Nó arquivado');depois?.();}catch(e){erroDe(e);}});
}
