/**
 * Tarefas: o quadro do dia a dia, no visual do LexPane, com dado real.
 *
 * Arrastar muda o status no servidor; se o servidor recusar, o cartão volta.
 * A urgência vem do PRAZO contado em dias úteis forenses — não de alguém ter
 * marcado "urgente".
 */
import { api } from '../api.js';
import { estado, pode } from '../estado.js';
import { quadroArrastavel } from '../fx.js';
import { avatar, dataCurta, guardado, html, icone, matiz, ouvir, raw } from '../util.js';
import { cabecalho, confirmar, formulario, menu, toast, erroDe, vazio } from '../ui.js';
import { atualizarLateral, navegar, posicionarSeg } from '../shell.js';

export const COLUNAS = [
  { id: 'a_fazer', nome: 'A fazer', cor: 'var(--text-3)' },
  { id: 'em_andamento', nome: 'Em andamento', cor: 'var(--lab-cy)' },
  { id: 'em_revisao', nome: 'Em revisão', cor: 'var(--lab-amber)' },
  { id: 'concluida', nome: 'Concluída', cor: 'var(--lab-green)' },
];
const PRIO = { urgente: ['prio--urgent', 'Urgente', true], alta: ['prio--high', 'Alta'], media: null, baixa: null };

const filtros = { projeto: null, minhas: false, prioridade: null, texto: '' };
let equipeCache = null;
export async function equipe() { return (equipeCache ??= await api.get('/api/escritorio/equipe')); }

function passa(t) {
  if (filtros.projeto && t.projetoId !== filtros.projeto) return false;
  if (filtros.minhas && t.responsavelId !== estado.eu.usuario.id) return false;
  if (filtros.prioridade && t.prioridade !== filtros.prioridade) return false;
  if (filtros.texto && !`${t.titulo} ${t.projeto} ${t.responsavel ?? ''}`.toLowerCase().includes(filtros.texto.toLowerCase())) return false;
  return true;
}

export function cartao(t, { mostrarProjeto = true } = {}) {
  const prio = PRIO[t.prioridade];
  const atrasada = t.situacaoDoPrazo === 'atrasada';
  return html`<article class="tk-card hue--${matiz(t.projetoId)}" draggable="true" data-id="${t.id}" data-tarefa>
    <div class="tk-card__top">
      ${mostrarProjeto ? html`<span class="pchip hue--${matiz(t.projetoId)}"><i></i><span class="tk-ellip">${t.projeto}</span></span>` : ''}
      ${prio ? html`<span class="prio ${prio[0]}">${prio[2] ? icone('flag') : ''}${prio[1]}</span>` : ''}
    </div>
    <h3 class="tk-card__title"><button type="button" class="tk-card__open" data-editar="${t.id}"><span class="tk-card__text">${t.titulo}</span></button></h3>
    <div class="tk-card__foot">
      ${t.prazo ? html`<span class="tk-due ${t.situacaoDoPrazo === 'hoje' ? 'is-today' : ''}" ${atrasada ? raw('style="color:var(--lab-red)"') : ''}>${icone('calendar')}${t.situacaoDoPrazo === 'hoje' ? 'Hoje' : atrasada ? html`Atrasada · ${dataCurta(t.prazo)}` : dataCurta(t.prazo)}</span>` : html`<span class="tk-due muted">sem prazo</span>`}
      <span class="tk-card__who">${t.responsavel ? avatar(t.responsavel, 'xs') : ''}</span></div></article>`;
}

export function htmlQuadro(tarefas, opts) {
  return html`<div class="tk-board">${COLUNAS.map((c) => {
    const itens = tarefas.filter((t) => t.status === c.id);
    return html`<section class="card glass tk-col" data-col-wrap="${c.id}">
      <header class="tk-col__head"><i class="tk-dot" style="background:${raw(c.cor)}"></i><h2 class="tk-col__name">${c.nome}</h2><span class="tk-col__count tnum">${itens.length}</span>
        ${pode('tarefa.escrever') ? html`<button type="button" class="ibtn ibtn--sm tk-col__add" data-nova="${c.id}" aria-label="Adicionar em ${c.nome}">${icone('plus')}</button>` : ''}</header>
      <div class="tk-col__list" data-col="${c.id}">${itens.map((t) => cartao(t, opts))}</div></section>`;
  })}</div>`;
}

/** Liga arrastar e abrir. `recarregar` repinta a tela depois de qualquer mudança. */
export function ligarQuadro(raiz, tarefas, recarregar, projetoFixo) {
  // Registrar mesmo no estado vazio/lista; filtrar não pode duplicar handlers.
  if (!raiz.__tarefasLigadas) {
    raiz.__tarefasLigadas = true;
    ouvir(raiz, 'click', '[data-editar]', (b) => editarTarefa(raiz.__tarefasAtuais.find((t) => t.id === b.dataset.editar), recarregar));
    ouvir(raiz, 'click', '[data-nova]', (b) => novaTarefa(recarregar, projetoFixo, b.dataset.nova).catch(erroDe));
  }
  raiz.__tarefasAtuais = tarefas;
  const board = raiz.querySelector('.tk-board'); if (!board || board.__arrastavel) return;
  board.__arrastavel = true;
  quadroArrastavel(board, {
    item: '.tk-card', coluna: '.tk-col', lista: '.tk-col__list',
    aoSoltar: async (id, status) => {
      try { await api.patch(`/api/tarefas/${id}`, { status }); if (status === 'concluida') toast('Tarefa concluída'); atualizarLateral(); }
      catch (e) { erroDe(e); throw e; }
    },
  });
}

export default async function tarefas() {
  const dados = await api.get('/api/tarefas');
  estado.tarefas = dados.tarefas;
  const visao = guardado.ler('tarVisaoV2', 'lista');
  const todas = dados.tarefas; const lista = todas.filter(passa);
  const r = dados.resumo;
  const semana = todas.filter((t) => t.situacaoDoPrazo === 'esta_semana' || t.situacaoDoPrazo === 'hoje').length;
  const nProj = new Set(todas.filter((t) => t.status !== 'concluida').map((t) => t.projetoId)).size;
  const projAtual = filtros.projeto ? estado.projetos.find((p) => p.id === filtros.projeto)?.nome : null;

  const seg = html`<div class="seg" role="group" aria-label="Visualização"><span class="seg__pill" aria-hidden="true"></span>
    <button type="button" class="seg__btn" data-visao="quadro" aria-pressed="${visao === 'quadro'}">${icone('board')}<span>Quadro</span></button>
    <button type="button" class="seg__btn" data-visao="lista" aria-pressed="${visao === 'lista'}">${icone('list')}<span>Lista</span></button></div>`;

  return {
    titulo: 'Tarefas',
    html: html`${cabecalho({
      titulo: 'Tarefas', sub: `${r.abertas} em aberto em ${nProj} ${nProj === 1 ? 'projeto' : 'projetos'} · ${visao==='lista'?'análise de intimações e prazos processuais separados':'arraste os cartões entre as colunas'}`,
      acoes: html`${seg}${pode('tarefa.escrever') ? html`<button type="button" class="btn btn--accent" data-nova="a_fazer">${icone('plus')}Nova tarefa</button>` : ''}`,
      resumo: [{ rotulo: 'Em aberto', valor: r.abertas }, { rotulo: 'Para esta semana', valor: semana }, { rotulo: 'Atrasadas', valor: r.atrasadas, tom: r.atrasadas ? 'alert' : 'ok' }, { rotulo: 'Concluídas', valor: r.concluidas }],
    })}
    <div class="tk-bar glass up" style="margin:18px 0">
      <div class="tk-bar__chips" role="group" aria-label="Filtros">
        <button type="button" class="tk-chip ${filtros.projeto ? 'is-on' : ''}" data-f="projeto"><span class="tk-chip__lead">${icone('folder')}</span><span class="tk-chip__label">${projAtual ?? 'Todos os projetos'}</span>${icone('chevronDown')}</button>
        <button type="button" class="tk-chip ${filtros.minhas ? 'is-on' : ''}" data-f="minhas">${avatar(estado.eu.usuario.nome, 'xs')}<span>Só minhas</span></button>
        <button type="button" class="tk-chip ${filtros.prioridade ? 'is-on' : ''}" data-f="prioridade">${icone('flag')}<span class="tk-chip__label">${filtros.prioridade ? `Prioridade ${filtros.prioridade}` : 'Qualquer prioridade'}</span>${icone('chevronDown')}</button>
      </div>
      <label class="tk-find">${icone('search')}<span class="sr-only">Filtrar</span><input class="tk-find__input" id="tk-find" type="search" placeholder="Filtrar tarefas…" value="${filtros.texto}" autocomplete="off"></label>
      <button type="button" class="btn btn--ghost btn--sm tk-clear" data-f="limpar">Limpar</button>
    </div>
    <div id="tarefas-corpo">${corpo(visao, lista, todas)}</div>`,
    depois(raiz) {
      const recarregar = () => navegar();
      ouvir(raiz, 'click', '[data-visao]', (b) => { guardado.gravar('tarVisaoV2', b.dataset.visao); navegar(); });
      ouvir(raiz, 'click', '[data-f]', (b) => {
        const f = b.dataset.f;
        if (f === 'minhas') { filtros.minhas = !filtros.minhas; navegar(); }
        else if (f === 'limpar') { Object.assign(filtros, { projeto: null, minhas: false, prioridade: null, texto: '' }); navegar(); }
        else if (f === 'projeto') menu(b, [{ rotulo: 'Todos os projetos', acao: () => { filtros.projeto = null; navegar(); } }, '-',
          ...estado.projetos.filter((p) => p.situacao !== 'encerrado').map((p) => ({ rotulo: p.nome, icone: 'folder', acao: () => { filtros.projeto = p.id; navegar(); } }))]);
        else menu(b, [{ rotulo: 'Qualquer prioridade', acao: () => { filtros.prioridade = null; navegar(); } }, '-',
          ...['urgente', 'alta', 'media', 'baixa'].map((p) => ({ rotulo: p[0].toUpperCase() + p.slice(1), icone: 'flag', acao: () => { filtros.prioridade = p; navegar(); } }))]);
      });
      const busca = raiz.querySelector('#tk-find');
      busca.addEventListener('input', () => {
        filtros.texto = busca.value;
        const alvo = raiz.querySelector('#tarefas-corpo'); alvo.innerHTML = String(corpo(visao, todas.filter(passa), todas));
        ligarQuadro(raiz, todas, recarregar);
      });
      ligarQuadro(raiz, todas, recarregar);
      ouvir(raiz, 'click', '[data-publicacao]', (b) => import('./controladoria.js').then(m=>m.abrirPublicacao(b.dataset.publicacao)).catch(erroDe));
      ouvir(raiz, 'change', '[data-status-tarefa]', async(b)=>{try{b.disabled=true;await api.patch(`/api/tarefas/${b.dataset.statusTarefa}`,{status:b.value});atualizarLateral();navegar();}catch(e){b.disabled=false;erroDe(e);}});
      ouvir(raiz, 'click', '[data-concluir]', async(b)=>{try{b.disabled=true;await api.patch(`/api/tarefas/${b.dataset.concluir}`,{status:'concluida'});toast('Atividade concluída');atualizarLateral();navegar();}catch(e){b.disabled=false;erroDe(e);}});
      ouvir(raiz, 'click', '[data-editar-linha]', (b) => editarTarefa(todas.find((t) => t.id === b.dataset.editarLinha), recarregar));
    },
  };
}

function corpo(visao, lista, todas) {
  if (!todas.length) return html`<section class="card glass up">${vazio('check', 'Nenhuma tarefa ainda',
    'Tarefa é o trabalho do dia a dia dentro de um projeto: quem faz, até quando, em que ponto está.',
    pode('tarefa.escrever') ? '<button class="btn btn--accent" data-nova="a_fazer">Criar a primeira tarefa</button>' : '')}</section>`;
  if (visao === 'quadro') return htmlQuadro(lista);
  return html`<section class="card glass up task-list"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Atividade</th><th>Projeto / processo</th><th>Responsável</th><th>Data / vencimento</th><th>Situação</th><th></th></tr></thead>
    <tbody>${lista.map((t) => html`<tr><td class="task-title"><button class="link" data-editar-linha="${t.id}"><b>${t.titulo}</b></button><span class="task-type">${t.tipoAtividade==='analise_intimacao'?'Análise de intimação':t.tipoAtividade==='prazo_processual'?'Cumprimento de prazo processual':'Tarefa do projeto'}${t.prioridade==='urgente'||t.prioridade==='alta'?` · prioridade ${t.prioridade}`:''}</span>${t.publicacaoId?html`<button class="link task-origin" type="button" data-publicacao="${t.publicacaoId}">Abrir intimação e análise</button>`:''}</td>
      <td><span class="pchip hue--${matiz(t.projetoId)}"><i></i>${t.projeto}</span>${t.processo?html`<div class="mono-sm mt">${t.processo}</div>`:''}</td><td>${t.responsavel??'Sem responsável'}</td>
      <td class="mono-sm" ${t.situacaoDoPrazo==='atrasada'?raw('style="color:var(--lab-red)"'):''}>${t.prazo?dataCurta(t.prazo):'Sem data'}<span class="task-type">${t.tipoAtividade==='prazo_processual'?'Vencimento processual':t.tipoAtividade==='analise_intimacao'?'Data de análise interna':'Entrega da tarefa'}</span></td>
      <td>${pode('tarefa.escrever')?html`<select class="select" data-status-tarefa="${t.id}" aria-label="Situação de ${t.titulo}">${COLUNAS.map(c=>html`<option value="${c.id}" ${c.id===t.status?raw('selected'):''}>${c.nome}</option>`)}</select>`:html`<span class="selo">${COLUNAS.find(c=>c.id===t.status)?.nome??t.status}</span>`}</td><td>${pode('tarefa.escrever')&&t.status!=='concluida'?html`<button class="ibtn" type="button" data-concluir="${t.id}" aria-label="Concluir ${t.titulo}">${icone('check')}</button>`:''}</td></tr>`)}</tbody></table></div></section>`;
}

async function camposDaTarefa(t = {}, projetoFixo) {
  const eq = await equipe();
  const ativos = estado.projetos.filter((p) => p.situacao !== 'encerrado');
  return [
    ...(projetoFixo || t.id ? [] : [{ nome: 'projetoId', rotulo: 'Projeto', tipo: 'select', obrigatorio: true, valor: filtros.projeto ?? ativos[0]?.id, opcoes: ativos.map((p) => ({ v: p.id, t: p.nome })) }]),
    { nome: 'titulo', rotulo: 'O que precisa ser feito', obrigatorio: true, valor: t.titulo, placeholder: 'Ex.: Revisar minuta do plano' },
    { nome: 'descricao', rotulo: 'Detalhes', tipo: 'textarea', valor: t.descricao ?? '' },
    { nome: 'responsavelId', rotulo: 'Responsável', tipo: 'select', metade: true, valor: t.responsavelId ?? estado.eu.usuario.id, opcoes: eq.map((u) => ({ v: u.id, t: u.nome })) },
    { nome: 'prazo', rotulo: 'Prazo', tipo: 'date', metade: true, valor: t.prazo ?? '' },
    { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', metade: true, valor: t.prioridade ?? 'media', opcoes: [{ v: 'baixa', t: 'Baixa' }, { v: 'media', t: 'Média' }, { v: 'alta', t: 'Alta' }, { v: 'urgente', t: 'Urgente' }] },
    { nome: 'status', rotulo: 'Coluna', tipo: 'select', metade: true, valor: t.status ?? 'a_fazer', opcoes: COLUNAS.map((c) => ({ v: c.id, t: c.nome })) },
  ];
}

export async function novaTarefa(depois, projetoFixo, status = 'a_fazer') {
  if (!estado.projetos.length) { try { estado.projetos = await api.get('/api/projetos'); } catch (e) { return erroDe(e); } }
  if (!projetoFixo && !estado.projetos.some((p) => p.situacao !== 'encerrado')) return toast('Crie um projeto antes de criar tarefas.', 'aviso');
  const campos = await camposDaTarefa({ status }, projetoFixo);
  return formulario({
    titulo: 'Nova tarefa', rotulo: 'Criar tarefa', campos,
    async enviar(v) {
      await api.post(`/api/projetos/${projetoFixo ?? v.projetoId}/tarefas`, {
        titulo: v.titulo, descricao: v.descricao, responsavelId: v.responsavelId, prazo: v.prazo ?? null,
        prioridade: v.prioridade, status: v.status,
      });
      toast('Tarefa criada'); atualizarLateral(); depois?.();
    },
  });
}

export async function editarTarefa(t, depois) {
  if (!t) return;
  const campos = await camposDaTarefa(t);
  let excluir = false;
  await formulario({
    titulo: 'Tarefa', subtitulo: `${t.projeto} · criada em ${dataCurta(t.criadoEm)}`, rotulo: 'Salvar', campos,
    depois(el) {
      if (!pode('tarefa.escrever')) return;
      const botao = document.createElement('button'); botao.type = 'button'; botao.className = 'btn btn--ghost perigo-btn'; botao.style.marginRight = 'auto'; botao.textContent = 'Excluir';
      el.querySelector('.modal__foot').prepend(botao);
      botao.addEventListener('click', async () => {
        if (await confirmar('Excluir tarefa?', `"${t.titulo}" será apagada. Fica registrado na auditoria.`, { rotulo: 'Excluir', perigo: true })) {
          try { await api.del(`/api/tarefas/${t.id}`); excluir = true; toast('Tarefa excluída'); el.fechar(true); } catch (e) { el.erro(e.message); }
        }
      });
    },
    async enviar(v) {
      await api.patch(`/api/tarefas/${t.id}`, {
        titulo: v.titulo, descricao: v.descricao ?? null, responsavelId: v.responsavelId, prazo: v.prazo ?? null,
        prioridade: v.prioridade, status: v.status,
      });
      toast('Tarefa atualizada');
    },
  });
  atualizarLateral(); depois?.();
  void excluir;
}
