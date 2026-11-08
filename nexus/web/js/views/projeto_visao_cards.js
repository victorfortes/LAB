/** Cartões do projeto com marcos configuráveis e dados reais. */
import {api} from '../api.js';
import {pode} from '../estado.js';
import {html,raw,avatar,dataBR,relativo,ouvir} from '../util.js';
import {formulario,erroDe,toast} from '../ui.js';
import {editarTarefa,novaTarefa} from './tarefas.js';
const campoMarco=m=>[{nome:'titulo',rotulo:'Marco / entrega',valor:m?.titulo,obrigatorio:true},{nome:'descricao',rotulo:'Detalhes',tipo:'textarea',valor:m?.descricao},{nome:'dataPrevista',rotulo:'Data prevista',tipo:'date',valor:m?.dataPrevista?.slice(0,10)??''},{nome:'visivelCliente',rotulo:'Visibilidade',tipo:'select',valor:m?.visivelCliente?'sim':'nao',opcoes:[{v:'nao',t:'Somente escritório'},{v:'sim',t:'Publicar no portal deste cliente'}]}];
export function cardsVisao(h,d){const edit=pode('projeto.escrever')&&h.situacao!=='encerrado';const tasks=d.tarefas.tarefas.filter(t=>t.status!=='concluida');const podeConcluir=pode('tarefa.escrever')&&h.situacao!=='encerrado';return html`
 <div class="grid-hub project-overview mt">
 <section class="card glass"><header class="card__head"><div><h2 class="card__title">Visão geral</h2><p class="card__sub">Dados deste projeto</p></div><span class="selo ${h.situacao==='encerrado'?'':'ok'}">${h.situacao}</span></header>
 <dl class="overview-details"><div><dt>Cliente</dt><dd>${h.empresas?.map(x=>x.nome_fantasia??x.razao_social).join(' · ')||'Não vinculado'}</dd></div><div><dt>Responsável</dt><dd>${h.responsavel??'Não definido'}</dd></div><div><dt>Início</dt><dd>${h.iniciado_em?dataBR(h.iniciado_em):'Não definido'}</dd></div><div><dt>Entrega prevista</dt><dd>${h.previsao_fim?dataBR(h.previsao_fim):'Sem previsão'}</dd></div><div><dt>Marco atual</dt><dd>${h.faseAtual?.nome??'Não definido'}</dd></div></dl>
 <h3 class="card__title mt">Equipe do projeto</h3><div class="overview-team">${h.equipe?.length?h.equipe.map(u=>html`<a href="#/equipe" class="overview-person">${avatar(u.nome,'md')}<span>${u.nome}<small>${u.papel==='lider'?'Líder':u.papel}</small></span></a>`):html`<p class="dica">Inclua a equipe na aba Equipe.</p>`}</div></section>
 <section class="card glass"><header class="card__head"><div><h2 class="card__title">Marcos e entregas</h2><p class="card__sub">${d.marcos.filter(m=>m.concluidoEm).length} de ${d.marcos.length} concluídos</p></div>${edit?html`<button class="btn btn--ghost btn--sm" data-add-marco>Adicionar marco</button>`:''}</header>
 ${d.marcos.length?html`<ul class="lista">${d.marcos.map(m=>html`<li><input type="checkbox" data-concluir-marco="${m.id}" aria-label="${m.concluidoEm?'Reabrir':'Concluir'} marco: ${m.titulo}" ${m.concluidoEm?raw('checked'):''} ${edit?'':raw('disabled')}><div><b ${m.concluidoEm?raw('style="text-decoration:line-through;opacity:.65"'):''}>${m.titulo}</b><small>${m.dataPrevista?dataBR(m.dataPrevista):'Sem data'} · ${m.concluidoEm?'Concluído':'Previsto'}${m.visivelCliente?' · publicado para o cliente':''}</small>${m.descricao?html`<p class="dica">${m.descricao}</p>`:''}</div>${edit?html`<button class="btn btn--ghost btn--sm" data-editar-marco="${m.id}" aria-label="Editar ${m.titulo}">Editar</button>`:''}</li>`)}</ul>`:html`<p class="dica">Cadastre os marcos específicos deste cliente. Você escolhe o que será mostrado no portal.</p>`}</section>
 <section class="card glass"><header class="card__head"><div><h2 class="card__title">A seguir</h2><p class="card__sub">Agenda exclusiva do projeto</p></div><a class="link" href="#/calendario">Calendário →</a></header>
 ${d.agenda.length?html`<ul class="lista">${d.agenda.map(e=>html`<li><div><b>${e.titulo}</b><small>${dataBR(e.inicio)} · ${new Date(e.inicio).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'})} · ${e.marcador}</small></div>${e.meetUrl?html`<a class="link" href="${e.meetUrl}" target="_blank" rel="noopener">Meet →</a>`:''}</li>`)}</ul>`:html`<p class="dica">Nenhum evento futuro cadastrado neste projeto.</p>`}
 <h3 class="card__title mt">Atividade recente</h3>${d.atividades.length?html`<ul class="lista">${d.atividades.slice(0,6).map(a=>html`<li><div><b>${a.acao.replaceAll('.',' · ').replaceAll('_',' ')}</b><small>${a.autor??'Sistema'} · ${relativo(a.criado_em)}</small></div></li>`)}</ul>`:html`<p class="dica">Nenhuma atividade registrada.</p>`}</section>
 </div>
 <section class="card glass mt overview-tasks"><header class="card__head"><div><h2 class="card__title">A fazer</h2><p class="card__sub">${d.tarefas.resumo.abertas} tarefa(s) aberta(s)</p></div>${podeConcluir?html`<button class="btn btn--ghost" data-todo-nova>Nova tarefa</button>`:''}</header>
 ${tasks.length ? html`<ul class="lista">${tasks.slice(0,12).map(t=>html`<li>
   ${podeConcluir?html`<input type="checkbox" data-todo-concluir="${t.id}" aria-label="Concluir ${t.titulo}">`:''}
   <div>${podeConcluir?html`<button type="button" class="link" data-todo-abrir="${t.id}">${t.titulo}</button>`:html`<b>${t.titulo}</b>`}<small>${[t.responsavel,t.prazo?dataBR(t.prazo):null].filter(Boolean).join(' · ')}</small></div>
   ${t.tipoAtividade==='prazo_processual'?html`<span class="selo aviso">Prazo processual</span>`:t.tipoAtividade==='analise_intimacao'?html`<span class="selo info">Análise de intimação</span>`:''}
 </li>`)}</ul>`:html`<p class="dica">Nenhuma tarefa em aberto.</p>`}
 ${tasks.length>12?html`<button class="link mt" data-aba-ir="tarefas">Ver todas as tarefas →</button>`:''}</section>`;}
export function ligarVisao(el,ctx,d){
 ouvir(el,'click','[data-todo-nova]',()=>novaTarefa(()=>ctx.recarregar(),ctx.id));
 ouvir(el,'click','[data-todo-abrir]',b=>{
   const tarefa=d.tarefas.tarefas.find(t=>t.id===b.dataset.todoAbrir);
   if(tarefa)editarTarefa(tarefa,()=>ctx.recarregar());
 });
 ouvir(el,'change','[data-todo-concluir]',async b=>{
   b.disabled=true;
   try{await api.patch(`/api/tarefas/${b.dataset.todoConcluir}`,{status:'concluida'});toast('Tarefa concluída');await ctx.recarregar();}
   catch(e){b.disabled=false;b.checked=false;erroDe(e);}
 });
 ouvir(el,'click','[data-add-marco],[data-editar-marco]',async b=>{const m=d.marcos.find(m=>m.id===b.dataset.editarMarco);const ok=await formulario({titulo:m?'Editar marco':'Novo marco do projeto',campos:campoMarco(m),async enviar(v){const dados={titulo:v.titulo,descricao:v.descricao??'',dataPrevista:v.dataPrevista??null,visivelCliente:v.visivelCliente==='sim'};if(m)await api.patch(`/api/projeto-marcos/${m.id}`,dados);else await api.post(`/api/projetos/${ctx.id}/marcos`,dados);toast('Marco salvo');}});if(ok&&ctx.ativo)ctx.recarregar();});
 ouvir(el,'change','[data-concluir-marco]',async b=>{try{b.disabled=true;await api.patch(`/api/projeto-marcos/${b.dataset.concluirMarco}`,{concluido:b.checked});if(ctx.ativo)ctx.recarregar();}catch(e){b.checked=!b.checked;b.disabled=false;erroDe(e);}});
}
