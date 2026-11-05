/** Administration of reusable procedure/task trees for the office. */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { html, icone, ouvir } from '../util.js';
import { cabecalho, confirmar, formulario, erroDe, toast, vazio } from '../ui.js';
import { navegar } from '../shell.js';
import { htmlEstrutura, ligarEditor } from '../playbook_editor.js';
let selecionado=null;
export default async function adminPlaybooks(){
 if(!pode('admin.gerir'))return{titulo:'Modelos de playbook',html:vazio('lock','Acesso administrativo','A configuração dos modelos pertence ao administrador do escritório.')};
 const modelos=await api.get('/api/admin/playbooks'),catalogo=await api.get('/api/projetos/fases');
 selecionado=modelos.some(m=>m.id===selecionado)?selecionado:modelos[0]?.id;
 const modelo=selecionado?await api.get(`/api/admin/playbooks/${selecionado}`):null;
 return{titulo:'Modelos de playbook',html:html`${cabecalho({titulo:'Modelos de playbook',sub:'Configure fases do procedimento, etapas, tarefas mães e filhas e seus gatilhos. Cada projeto recebe sua própria cópia.',acoes:html`<button class="btn btn--ghost" data-importar>Importar modelos iniciais</button><button class="btn btn--accent" data-modelo-novo>${icone('plus')}Novo modelo</button>`})}
 <div class="pb-admin mt"><aside class="card glass"><h2 class="card__title">Modelos do escritório</h2><div class="pb-models mt">${modelos.map(m=>html`<button type="button" class="pb-model ${m.id===selecionado?'is-selected':''}" data-modelo="${m.id}"><b>${m.nome}</b><small>${m.tipoProjeto??'Uso geral'} · ${m.nos} nós${m.padrao?' · padrão para novos projetos':''}${m.ativo?'':' · arquivado'}</small></button>`)}</div></aside>
 <section class="card glass">${modelo?html`<header class="card__head"><div><h2 class="card__title">${modelo.nome}</h2><p class="card__sub">${modelo.padrao?'Aplicado automaticamente a novos projetos deste tipo.':'Modelo disponível para aplicar a um projeto.'} Alterações futuras não modificam cópias já aplicadas.</p></div><button class="btn btn--ghost" data-modelo-editar>Configurar modelo</button></header><div class="flex"><button class="btn btn--accent" data-pb-adicionar>${icone('plus')}Adicionar fase, etapa ou tarefa</button><span class="dica">Para reordenar, altere a ordem do nó.</span></div>${htmlEstrutura(modelo.nos,{editar:true})}${!modelo.nos.some(n=>!n.arquivado)?vazio('list','Estrutura ainda vazia','Crie as fases e etapas; adicione tarefas mães e depois suas filhas.'):''}`:vazio('list','Nenhum modelo configurado','Crie um modelo em branco ou importe os procedimentos e tarefas iniciais para personalizá-los.')}</section></div>`,
 depois(el){
  ouvir(el,'click','[data-modelo]',b=>{selecionado=b.dataset.modelo;navegar();});
  const editarModelo=async m=>{const ok=await formulario({titulo:m?.id?'Configurar modelo':'Novo modelo de playbook',campos:[{nome:'nome',rotulo:'Nome',obrigatorio:true,valor:m?.nome},{nome:'tipoProjeto',rotulo:'Tipo de projeto',tipo:'select',valor:m?.tipoProjeto??'',opcoes:[{v:'',t:'Uso geral (aplicação manual)'},...catalogo.map(c=>({v:c.tipo,t:c.rotulo}))]},{nome:'padrao',rotulo:'Aplicar automaticamente a novos projetos',tipo:'select',valor:m?.padrao?'sim':'nao',opcoes:[{v:'nao',t:'Não; escolher por projeto'},{v:'sim',t:'Sim, para novos projetos deste tipo'}]},{nome:'ativo',rotulo:'Estado',tipo:'select',valor:m?.ativo===false?'nao':'sim',opcoes:[{v:'sim',t:'Ativo'},{v:'nao',t:'Arquivado (cópias dos projetos preservadas)'}]}],enviar:async v=>{const dados={...v,tipoProjeto:v.tipoProjeto??null,padrao:v.padrao==='sim',ativo:v.ativo==='sim'};const r=m?.id?await api.patch(`/api/admin/playbooks/${m.id}`,dados):await api.post('/api/admin/playbooks',dados);selecionado=r.id;toast('Modelo salvo');}});if(ok)navegar();};
  ouvir(el,'click','[data-modelo-novo]',()=>editarModelo());ouvir(el,'click','[data-modelo-editar]',()=>editarModelo(modelo));
  ouvir(el,'click','[data-importar]',async()=>{if(!await confirmar('Importar modelos iniciais?','Importa fases e tarefas dos procedimentos existentes como modelos editáveis. Não altera os projetos já abertos nem define modelos padrão.'))return;try{const r=await api.post('/api/admin/playbooks/importar-padroes');toast(`${r.criados} modelo(s) importado(s)`);navegar();}catch(e){erroDe(e);}});
  if(modelo)ligarEditor(el,{nos:modelo.nos,endpoint:`/api/admin/playbooks/${modelo.id}/nos`,depois:navegar});
 }};
}
