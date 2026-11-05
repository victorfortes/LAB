/** Mapa de trabalho do projeto, notas e tarefas reais; não estima progresso sem vínculo. */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { avatar, dataCurta, html, icone, ouvir, raw } from '../util.js';
import { confirmar, erroDe, formulario, modal, toast, vazio } from '../ui.js';

const RAMOS = [
  { chave:'documentos',nome:'Análise de documentos',folhas:[['contabil','Análise contábil'],['tributaria','Análise tributária'],['juridica','Análise jurídica'],['financeira','Análise financeira']] },
  { chave:'estrategia',nome:'Estratégia e execução',folhas:[['riscos','Riscos e providências'],['pesquisa','Pesquisa e fundamentos'],['entregas','Entregas ao cliente']] },
];
const GATILHOS = { projeto_criado:'Ao criar o projeto',documento_cliente_enviado:'Ao receber documento do cliente' };
const ESTADOS = {a_fazer:'A fazer',em_andamento:'Em andamento',em_revisao:'Em revisão',concluida:'Concluída'};
const interpretar = (texto) => {try {const a=JSON.parse(texto);return Array.isArray(a)?a.filter(x=>typeof x==='string'):[];}catch{return [];}};
export function progressoDasTarefas(tarefas) {
  const total=tarefas.length, feitas=tarefas.filter(t=>t.status==='concluida').length;
  return { total,feitas,percentual:total?Math.round(feitas/total*100):null,
    estado:total&&feitas===total?'concluido':tarefas.some(t=>t.status!=='a_fazer')?'andamento':'pendente' };
}

export async function abaPlaybook(ctx) {
  const base=`/api/projetos/${ctx.id}`;
  const [notas,regras,dados]=await Promise.all([api.get(`${base}/playbook/notas`),api.get(`${base}/automacoes`),api.get(`/api/tarefas?projeto=${ctx.id}&concluidas=1`)]);
  const editar=pode('projeto.escrever'); const tarefas=dados.tarefas.filter(t=>t.projetoId===ctx.id);
  const porChave=new Map(notas.map(n=>[n.chave,n]));
  const ramos=RAMOS.map(r=>({...r,folhas:r.folhas.map(([id,nome])=>({chave:`${r.chave}.${id}`,nome}))}));
  for(const n of notas) {if(!n.chave.startsWith('personalizado.'))continue;const [,ramo,...titulo]=n.chave.split('.');ramos.find(r=>r.chave===ramo)?.folhas.push({chave:n.chave,nome:titulo.join('.')});}
  const vinculadas=(chave)=>{const ids=interpretar(porChave.get(`vinculos.${chave}`)?.resumo);return tarefas.filter(t=>ids.includes(t.id));};
  const altura=Math.max(420,...ramos.map(r=>r.folhas.length*96+70)),centro=altura/2-32;
  const grupo=(r)=>r.folhas.flatMap(f=>vinculadas(f.chave));
  const unicas=(ts)=>[...new Map(ts.map(t=>[t.id,t])).values()];
  const nos=[{chave:'marcos.abertura',nome:'Início do projeto',x:20,y:centro,tarefas:tarefas.filter(t=>t.chavePlaybook?.startsWith('abertura.')),icone:'flag'},
    {chave:'marcos.analise',nome:'Análise inicial',x:250,y:centro,tarefas:unicas(grupo(ramos[0])),icone:'doc'},
    ...ramos[0].folhas.map((f,i)=>({...f,x:495,y:(altura-ramos[0].folhas.length*96)/2+i*96+16,tarefas:vinculadas(f.chave)})),
    {chave:'marcos.sintese',nome:'Consolidar diagnóstico',x:760,y:centro,tarefas:unicas(grupo(ramos[0])),icone:'sparkle'},
    ...ramos[1].folhas.map((f,i)=>({...f,x:1020,y:(altura-ramos[1].folhas.length*96)/2+i*96+16,tarefas:vinculadas(f.chave)})),
    {chave:'marcos.revisao',nome:'Revisão final',x:1285,y:centro,tarefas,icone:'check'},
    {chave:'marcos.entrega',nome:'Entrega ao cliente',x:1520,y:centro,tarefas:vinculadas('estrategia.entregas'),icone:'send'}];
  const porNo=new Map(nos.map(n=>[n.chave,n]));
  const arestas=[['marcos.abertura','marcos.analise'],...ramos[0].folhas.flatMap(f=>[['marcos.analise',f.chave],[f.chave,'marcos.sintese']]),...ramos[1].folhas.flatMap(f=>[['marcos.sintese',f.chave],[f.chave,'marcos.revisao']]),['marcos.revisao','marcos.entrega']];
  const conexao=([de,para])=>{const a=porNo.get(de),b=porNo.get(para),x1=a.x+196,y1=a.y+32,x2=b.x,y2=b.y+32,curva=Math.max(20,(x2-x1)/2);return html`<path d="M ${x1} ${y1} C ${x1+curva} ${y1}, ${x2-curva} ${y2}, ${x2} ${y2}"/>`;};
  const total=progressoDasTarefas(tarefas);
  return {
    html:html`<section class="card glass up mind-playbook"><header class="card__head"><div><span class="mind-eyebrow">PROJETO · FLUXO DE TRABALHO</span><h2 class="card__title">Playbook do projeto</h2><p class="card__sub">Um caminho comum, análises em paralelo e revisão conjunta. Abra os nós para registrar conclusões e vincular tarefas.</p></div>${editar?html`<button type="button" class="btn btn--ghost" data-ramo>${icone('plus')}Nova análise</button>`:''}</header>
      <div class="mind-summary"><span class="mind-team">${ctx.h.equipe?.length?ctx.h.equipe.map(m=>html`<span class="mind-person">${avatar(m.nome,'xs')}${m.nome}</span>`):html`<span class="dica">Equipe ainda não definida</span>`}</span><span class="mind-summary__progress">${total.total?`${total.feitas}/${total.total} tarefas concluídas`:'Vincule tarefas para acompanhar o avanço'}</span></div>
      <div class="mind-viewport" tabindex="0" role="region" aria-label="Mapa horizontal do playbook; role para explorar"><div class="mind-canvas" style="height:${altura}px;width:1740px"><svg class="mind-connections" viewBox="0 0 1740 ${altura}" aria-hidden="true">${arestas.map(conexao)}</svg>
        ${nos.map(n=>{const pr=progressoDasTarefas(n.tarefas),nota=porChave.get(n.chave);return html`<button type="button" class="mind-node is-${pr.estado}" data-nota="${n.chave}" style="left:${n.x}px;top:${n.y}px" aria-label="${n.nome} · ${pr.total?`${pr.feitas} de ${pr.total} tarefas concluídas`:'sem tarefas vinculadas'}"><span class="mind-node__line"><i class="mind-node__status" aria-hidden="true">${pr.estado==='concluido'?icone('check'):''}</i><b>${n.nome}</b>${nota?.resumo?html`<span class="mind-node__note" title="Resumo registrado">${icone('doc')}</span>`:''}</span><small>${pr.total?`${pr.feitas}/${pr.total} tarefas · ${pr.percentual}%`:'Sem tarefas vinculadas'}</small>${pr.total?html`<span class="mind-node__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pr.percentual}" aria-label="Tarefas concluídas em ${n.nome}"><i style="width:${pr.percentual}%"></i></span>`:''}</button>`;})}</div></div>
      <div class="mind-legend"><span><i class="mind-dot is-pendente"></i>A fazer / sem vínculo</span><span><i class="mind-dot is-andamento"></i>Em andamento</span><span><i class="mind-dot is-concluido"></i>Concluído</span><span class="dica">O percentual usa as tarefas vinculadas; uma nota, sozinha, não conclui a análise.</span></div>
      <div class="mind-selected" data-no-detalhe><span>${icone('list')}</span><div><b>Selecione uma análise</b><p>Resumo, pontos de atenção, responsáveis e tarefas ficam vinculados exclusivamente a este projeto.</p></div></div></section>
      <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Tarefas automáticas</h2><p class="card__sub">Regras deste projeto e do escritório. O playbook gera as tarefas quando o gatilho acontece.</p></div>${editar?html`<button class="btn btn--accent" data-regra-nova>Nova regra</button>`:''}</header>
      ${regras.length?html`<ul class="lista">${regras.map(r=>html`<li><div><b>${r.nome}</b><small>${r.escopo==='escritorio'?'Todos os projetos do escritório':'Somente este projeto'} · ${GATILHOS[r.gatilho]??r.gatilho} · ${r.tituloTarefa} · ${r.diasUteis} dia(s) útil(eis)</small></div><span class="selo ${r.ativo?'ok':''}">${r.ativo?'Ativa':'Pausada'}</span>${editar?html`<button class="btn btn--ghost" data-regra="${r.id}">Editar</button><button class="btn btn--ghost" data-excluir-regra="${r.id}">Excluir</button>`:''}</li>`)}</ul>`:vazio('check','Nenhuma regra personalizada','O playbook das fases continua ativo. Adicione uma regra para organizar o trabalho quando o cliente enviar documentos.')}</section>`,
    depois(el) {
      ouvir(el,'click','[data-nota]',async b=>{
        const n=porNo.get(b.dataset.nota),nota=porChave.get(n.chave)??{},pr=progressoDasTarefas(n.tarefas);
        for(const botao of el.querySelectorAll('[data-nota]'))botao.classList.toggle('is-selected',botao===b);
        el.querySelector('[data-no-detalhe]').innerHTML=String(html`<span>${icone(n.icone??'doc')}</span><div><b>${n.nome}</b><p>${nota.resumo||'Registre o resumo desta etapa e os pontos que precisam de acompanhamento.'}</p><small>${pr.total?`${pr.feitas}/${pr.total} tarefas concluídas`:'Sem tarefas vinculadas'}</small></div>`);
        const vinculaveis=!n.chave.startsWith('marcos.');const ids=n.tarefas.map(t=>t.id);
        await modal({titulo:n.nome,subtitulo:ctx.h.nome,largo:true,corpo:String(html`<div class="mind-note"><label class="field"><span>Resumo da análise</span><textarea class="textarea" data-resumo maxlength="12000" ${editar?'':raw('readonly')}>${nota.resumo??''}</textarea></label><label class="field"><span>Pontos de atenção</span><textarea class="textarea" data-pontos maxlength="12000" ${editar?'':raw('readonly')}>${nota.pontosAtencao??''}</textarea></label><h3 class="mini-h">${vinculaveis?'Tarefas vinculadas a esta análise':'Tarefas desta etapa'}</h3>${!tarefas.length?html`<p class="dica">Crie tarefas na aba Tarefas e vincule-as à análise. Não há progresso a calcular enquanto ela não tiver tarefas.</p>`:html`<div class="mind-task-links">${(vinculaveis?tarefas:n.tarefas).map(t=>html`<label class="mind-task-link">${vinculaveis?html`<input type="checkbox" data-vinculo value="${t.id}" ${ids.includes(t.id)?raw('checked'):''} ${editar?'':raw('disabled')}>`:icone(t.status==='concluida'?'check':'list')}<span><b>${t.titulo}</b><small>${t.responsavel??'Sem responsável'}${t.prazo?` · ${dataCurta(t.prazo)}`:''} · ${ESTADOS[t.status]??t.status}</small></span></label>`)}</div>`}</div>`),acoes:[{id:'cancelar',rotulo:'Cancelar'},...(editar?[{id:'salvar',rotulo:'Salvar análise',tipo:'primario'}]:[])],aoAbrir(m){m.addEventListener('acao',async e=>{if(e.detail.id==='cancelar')return m.fechar(null);const btn=e.detail.botao;btn.disabled=true;try{await api.put(`${base}/playbook/notas`,{chave:n.chave,resumo:m.querySelector('[data-resumo]').value,pontosAtencao:m.querySelector('[data-pontos]').value});if(vinculaveis)await api.put(`${base}/playbook/notas`,{chave:`vinculos.${n.chave}`,resumo:JSON.stringify([...m.querySelectorAll('[data-vinculo]:checked')].map(i=>i.value)),pontosAtencao:''});toast('Análise salva neste projeto');m.fechar(true);ctx.recarregar();}catch(er){m.erro(er.message);btn.disabled=false;}});}});
      });
      ouvir(el,'click','[data-ramo]',async()=>{const ok=await formulario({titulo:'Adicionar análise ao playbook',campos:[{nome:'ramo',rotulo:'Etapa',tipo:'select',opcoes:RAMOS.map(r=>({v:r.chave,t:r.nome}))},{nome:'titulo',rotulo:'Nome da análise',obrigatorio:true},{nome:'resumo',rotulo:'Resumo',tipo:'textarea'},{nome:'pontosAtencao',rotulo:'Pontos de atenção',tipo:'textarea'}],enviar:async v=>{const chave=`personalizado.${v.ramo}.${v.titulo}`;if(chave.length>110)throw new Error('Use um nome de análise com até 80 caracteres.');await api.put(`${base}/playbook/notas`,{chave,resumo:v.resumo??'',pontosAtencao:v.pontosAtencao??''});toast('Análise adicionada');}});if(ok)ctx.recarregar();});
      ouvir(el,'click','[data-regra-nova], [data-regra]',b=>editarRegra(ctx,regras.find(r=>r.id===b.dataset.regra)));
      ouvir(el,'click','[data-excluir-regra]',async b=>{if(!await confirmar('Excluir regra?','As tarefas já criadas são preservadas.'))return;try{await api.del(`/api/automacoes/${b.dataset.excluirRegra}`);toast('Regra excluída');ctx.recarregar();}catch(e){erroDe(e);}});
    },
  };
}

async function editarRegra(ctx, r = {}) {
  const ok = await formulario({ titulo: r.id ? 'Editar regra automática' : 'Nova regra automática', subtitulo: ctx.h.nome,
    campos: [{ nome: 'nome', rotulo: 'Nome da regra', obrigatorio: true, valor: r.nome },
      { nome: 'escopo', rotulo: 'Aplicar a', tipo: 'select', valor: r.escopo ?? 'projeto', opcoes: [{ v:'projeto',t:'Somente este projeto' },{ v:'escritorio',t:'Todos os projetos do escritório (inclusive novos)' }] },
      { nome: 'gatilho', rotulo: 'Quando disparar', tipo: 'select', valor: r.gatilho ?? 'documento_cliente_enviado', opcoes: Object.entries(GATILHOS).map(([v,t]) => ({ v,t })) },
      { nome: 'tituloTarefa', rotulo: 'Tarefa a criar', obrigatorio: true, valor: r.tituloTarefa, placeholder: 'Conferir o documento recebido e responder ao cliente' },
      { nome: 'diasUteis', rotulo: 'Prazo em dias úteis após o gatilho', tipo: 'number', valor: r.diasUteis ?? 2, min: 0, obrigatorio: true },
      { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', valor: r.prioridade ?? 'media', opcoes: ['baixa','media','alta','urgente'].map((v) => ({ v,t:v })) },
      { nome: 'ativo', rotulo: 'Estado', tipo: 'select', valor: r.ativo === false ? 'nao' : 'sim', opcoes: [{ v:'sim',t:'Ativa' },{ v:'nao',t:'Pausada' }] }],
    enviar: async (v) => { if (v.gatilho === 'projeto_criado' && v.escopo !== 'escritorio') throw new Error('Para novos projetos, escolha o escopo Todos os projetos do escritório.'); const dados = { ...v, ativo: v.ativo === 'sim' }; if (r.id) { if (v.escopo !== r.escopo) throw new Error('Crie uma nova regra para alterar o escopo.'); delete dados.escopo; await api.patch(`/api/automacoes/${r.id}`, dados); } else await api.post(`/api/projetos/${ctx.id}/automacoes`, dados); toast('Regra salva'); },
  }); if (ok) ctx.recarregar();
}
