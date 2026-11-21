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
import { avatar, dataBR, dataCurta, debounce, guardado, html, icone, matiz, ouvir, raw, relativo } from '../util.js';
import { cabecalho, confirmar, formulario, menu, modal, toast, erroDe, vazio } from '../ui.js';
import { atualizarLateral, navegar, posicionarSeg } from '../shell.js';

export const COLUNAS = [
  { id: 'a_fazer', nome: 'A fazer', cor: 'var(--text-3)' },
  { id: 'em_andamento', nome: 'Em andamento', cor: 'var(--lab-cy)' },
  { id: 'em_revisao', nome: 'Em revisão', cor: 'var(--lab-amber)' },
  { id: 'concluida', nome: 'Concluída', cor: 'var(--lab-green)' },
];
const PRIO = { urgente: ['prio--urgent', 'Urgente', true], alta: ['prio--high', 'Alta'], media: null, baixa: null };
/** O que cada item É: prazo processual, tarefa interna, evento/audiência (agenda) ou análise de intimação. */
export const TIPOS = {
  prazo: { nome: 'Prazo', plural: 'Prazos', icone: 'clock', cls: 'tp--prazo' },
  tarefa: { nome: 'Tarefa', plural: 'Tarefas', icone: 'check', cls: 'tp--tarefa' },
  evento: { nome: 'Evento', plural: 'Eventos', icone: 'calendar', cls: 'tp--evento' },
  audiencia: { nome: 'Audiência', plural: 'Audiências', icone: 'scale', cls: 'tp--audiencia' },
  analise: { nome: 'Análise de intimação', plural: 'Análises', icone: 'search', cls: 'tp--analise' },
};
const tipoDe = (t) => TIPOS[t.tipo] ? t.tipo : t.tipoAtividade === 'analise_intimacao' ? 'analise' : t.tipoAtividade === 'prazo_processual' ? 'prazo' : 'tarefa';
const seloTipo = (t) => { const k = tipoDe(t); const x = TIPOS[k]; return html`<span class="tp ${x.cls}">${icone(x.icone)}${x.nome}${t.hora ? ` · ${t.hora}` : ''}</span>`; };
const vinculo = (t) => t.processo ? html`<span class="tk-vinc mono-sm" title="Processo">${icone('scale')}${t.processo}</span>` : t.caso ? html`<span class="tk-vinc" title="Caso">${icone('folder')}${t.caso}</span>` : '';

const filtros = { projeto: null, minhas: false, prioridade: null, texto: '', tipo: null, arquivadas: false };
let equipeCache = null;
export async function equipe() { return (equipeCache ??= await api.get('/api/escritorio/equipe')); }

function passa(t) {
  if (filtros.projeto && t.projetoId !== filtros.projeto) return false;
  if (filtros.minhas && t.responsavelId !== estado.eu.usuario.id) return false;
  if (filtros.prioridade && t.prioridade !== filtros.prioridade) return false;
  if (filtros.tipo && (filtros.tipo === 'agenda' ? !['evento', 'audiencia'].includes(tipoDe(t)) : tipoDe(t) !== filtros.tipo)) return false;
  if (filtros.texto && !`${t.titulo} ${t.projeto} ${t.responsavel ?? ''} ${t.processo ?? ''} ${t.caso ?? ''}`.toLowerCase().includes(filtros.texto.toLowerCase())) return false;
  return true;
}

export function cartao(t, { mostrarProjeto = true } = {}) {
  const prio = PRIO[t.prioridade];
  const atrasada = t.situacaoDoPrazo === 'atrasada';
  return html`<article class="tk-card hue--${matiz(t.projetoId)} ${t.status === 'concluida' ? 'is-done' : ''}" draggable="true" data-id="${t.id}" data-tarefa>
    <div class="tk-card__top">
      ${seloTipo(t)}
      ${mostrarProjeto ? html`<span class="pchip hue--${matiz(t.projetoId)}"><i></i><span class="tk-ellip">${t.projeto}</span></span>` : ''}
      ${prio ? html`<span class="prio ${prio[0]}">${prio[2] ? icone('flag') : ''}${prio[1]}</span>` : ''}
    </div>
    <h3 class="tk-card__title"><button type="button" class="tk-card__open" data-editar="${t.id}"><span class="tk-card__text">${t.titulo}</span></button></h3>
    ${vinculo(t) ? html`<div class="tk-card__vinc">${vinculo(t)}</div>` : ''}
    <div class="tk-card__foot">
      ${t.prazo ? html`<span class="tk-due ${t.situacaoDoPrazo === 'hoje' ? 'is-today' : ''}" ${atrasada ? raw('style="color:var(--lab-red)"') : ''}>${icone('calendar')}${t.situacaoDoPrazo === 'hoje' ? 'Hoje' : atrasada ? html`Atrasada · ${dataCurta(t.prazo)}` : dataCurta(t.prazo)}</span>` : html`<span class="tk-due muted">sem prazo</span>`}
      <span class="tk-card__who">${t.status !== 'concluida' && pode('tarefa.escrever') ? html`<button type="button" class="tk-check" data-concluir="${t.id}" title="Concluir" aria-label="Concluir ${t.titulo}">${icone('check')}</button>` : ''}${t.responsavel ? avatar(t.responsavel, 'xs') : ''}</span></div></article>`;
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

/**
 * Concluir rápido, sem esperar o servidor para responder na tela: o cartão/linha some do aberto na hora,
 * o servidor confirma em segundo plano e o aviso traz "Desfazer". Se o servidor recusar, volta como estava.
 */
export async function concluirRapido(t, { aoMudar, nota } = {}) {
  if (!t || t.status === 'concluida') return;
  const antes = t.status;
  Object.assign(t, { status: 'concluida', situacaoDoPrazo: 'concluida', concluidaEm: new Date().toISOString() });
  aoMudar?.(t);
  try {
    await api.patch(`/api/tarefas/${t.id}`, { status: 'concluida', ...(nota ? { conclusaoNota: nota } : {}) });
    atualizarLateral();
    toast(`${TIPOS[tipoDe(t)].nome} concluíd${tipoDe(t) === 'prazo' || tipoDe(t) === 'evento' ? 'o' : 'a'}`, 'ok', 5000, { rotulo: 'Desfazer', fn: async () => {
      Object.assign(t, { status: antes, concluidaEm: null, situacaoDoPrazo: null }); aoMudar?.(t);
      try { await api.patch(`/api/tarefas/${t.id}`, { status: antes }); atualizarLateral(); } catch (e) { erroDe(e); }
    } });
  } catch (e) { Object.assign(t, { status: antes, concluidaEm: null }); aoMudar?.(t); erroDe(e); }
}

/** Liga arrastar, abrir e concluir. `recarregar` repinta a tela depois de mudanças que pedem servidor. */
export function ligarQuadro(raiz, tarefas, recarregar, projetoFixo, aoMudarLocal) {
  // Registrar mesmo no estado vazio/lista; filtrar não pode duplicar handlers.
  raiz.__aoMudar = aoMudarLocal ?? ((t) => { const c = raiz.querySelector(`.tk-card[data-id="${t.id}"]`); if (c) { const novo = document.createElement('div'); novo.innerHTML = String(cartao(t, { mostrarProjeto: !projetoFixo })); const col = raiz.querySelector(`[data-col="${t.status}"]`); c.remove(); col?.prepend(novo.firstElementChild); contarColunas(raiz); } });
  if (!raiz.__tarefasLigadas) {
    raiz.__tarefasLigadas = true;
    ouvir(raiz, 'click', '[data-editar]', (b) => abrirTarefa(raiz.__tarefasAtuais.find((t) => t.id === b.dataset.editar), { aoMudar: (t) => raiz.__aoMudar(t), aoExcluir: () => recarregar() }));
    ouvir(raiz, 'click', '[data-nova]', (b) => novaTarefa(recarregar, projetoFixo, b.dataset.nova).catch(erroDe));
    ouvir(raiz, 'click', '[data-concluir]', (b, e) => { e.stopPropagation(); concluirRapido(raiz.__tarefasAtuais.find((t) => t.id === b.dataset.concluir), { aoMudar: (t) => raiz.__aoMudar(t) }); });
  }
  raiz.__tarefasAtuais = tarefas;
  const board = raiz.querySelector('.tk-board'); if (!board || board.__arrastavel) return;
  board.__arrastavel = true;
  quadroArrastavel(board, {
    item: '.tk-card', coluna: '.tk-col', lista: '.tk-col__list',
    aoSoltar: async (id, status) => {
      const t = raiz.__tarefasAtuais.find((x) => x.id === id); const antes = t?.status;
      if (t) t.status = status; contarColunas(raiz);
      try { await api.patch(`/api/tarefas/${id}`, { status }); if (status === 'concluida') toast('Concluída', 'ok', 4000, { rotulo: 'Desfazer', fn: async () => { if (t) { t.status = antes; raiz.__aoMudar(t); } await api.patch(`/api/tarefas/${id}`, { status: antes }).catch(erroDe); } }); atualizarLateral(); }
      catch (e) { if (t) t.status = antes; erroDe(e); throw e; }
    },
  });
}
function contarColunas(raiz) { raiz.querySelectorAll('[data-col-wrap]').forEach((c) => { const n = c.querySelectorAll('.tk-card').length; const el = c.querySelector('.tk-col__count'); if (el) el.textContent = n; }); }

export default async function tarefas() {
  const dados = await api.get(`/api/tarefas${filtros.arquivadas ? '?arquivadas=1' : ''}`);
  estado.tarefas = dados.tarefas;
  const visao = guardado.ler('tarVisaoV2', 'lista');
  const todas = dados.tarefas; const lista = todas.filter(passa);
  const r = dados.resumo;
  const abertas = todas.filter((t) => t.status !== 'concluida');
  const semana = abertas.filter((t) => t.situacaoDoPrazo === 'esta_semana' || t.situacaoDoPrazo === 'hoje').length;
  const nProj = new Set(abertas.map((t) => t.projetoId)).size;
  const projAtual = filtros.projeto ? estado.projetos.find((p) => p.id === filtros.projeto)?.nome : null;
  const nTipo = (k) => abertas.filter((t) => (k === 'agenda' ? ['evento', 'audiencia'].includes(tipoDe(t)) : tipoDe(t) === k)).length;
  const podeLimpar = pode('controladoria.gerir') || pode('admin.gerir');

  const seg = html`<div class="seg" role="group" aria-label="Visualização"><span class="seg__pill" aria-hidden="true"></span>
    <button type="button" class="seg__btn" data-visao="quadro" aria-pressed="${visao === 'quadro'}">${icone('board')}<span>Quadro</span></button>
    <button type="button" class="seg__btn" data-visao="lista" aria-pressed="${visao === 'lista'}">${icone('list')}<span>Lista</span></button></div>`;

  return {
    titulo: 'Tarefas',
    html: html`${cabecalho({
      titulo: filtros.arquivadas ? 'Tarefas arquivadas' : 'Tarefas e prazos', sub: filtros.arquivadas ? 'O que saiu do quadro pela limpeza ou porque saiu da agenda do Astrea. Nada foi apagado: reabra quando precisar.' : `${r.abertas} em aberto em ${nProj} ${nProj === 1 ? 'projeto' : 'projetos'} · clique num item para abrir; o ✓ conclui na hora`,
      acoes: html`${seg}${podeLimpar && !filtros.arquivadas ? html`<button type="button" class="btn btn--ghost" data-limpeza>${icone('sparkle')}Limpeza</button>` : ''}${pode('tarefa.escrever') ? html`<button type="button" class="btn btn--accent" data-nova="a_fazer">${icone('plus')}Nova</button>` : ''}`,
      resumo: [{ rotulo: 'Em aberto', valor: r.abertas }, { rotulo: 'Para esta semana', valor: semana }, { rotulo: 'Atrasadas', valor: r.atrasadas, tom: r.atrasadas ? 'alert' : 'ok' }, { rotulo: 'Concluídas', valor: r.concluidas }],
    })}
    <div class="tk-tipos up" role="group" aria-label="Tipo">
      ${[[null, 'Tudo', abertas.length, 'list'], ['prazo', 'Prazos', nTipo('prazo'), 'clock'], ['tarefa', 'Tarefas', nTipo('tarefa'), 'check'], ['agenda', 'Eventos e audiências', nTipo('agenda'), 'calendar'], ['analise', 'Análise de intimação', nTipo('analise'), 'search']]
        .map(([k, rot, n, ic]) => html`<button type="button" class="tk-tipo ${k ? TIPOS[k === 'agenda' ? 'evento' : k].cls : ''}" data-tipo="${k ?? ''}" aria-pressed="${filtros.tipo === k}">${icone(ic)}<span>${rot}</span><b>${n}</b></button>`)}
      <button type="button" class="tk-tipo tk-tipo--arq" data-arquivadas aria-pressed="${filtros.arquivadas}">${icone('inbox')}<span>Arquivadas</span></button>
    </div>
    <div class="tk-bar glass up" style="margin:12px 0 18px">
      <div class="tk-bar__chips" role="group" aria-label="Filtros">
        <button type="button" class="tk-chip ${filtros.projeto ? 'is-on' : ''}" data-f="projeto"><span class="tk-chip__lead">${icone('folder')}</span><span class="tk-chip__label">${projAtual ?? 'Todos os projetos'}</span>${icone('chevronDown')}</button>
        <button type="button" class="tk-chip ${filtros.minhas ? 'is-on' : ''}" data-f="minhas">${avatar(estado.eu.usuario.nome, 'xs')}<span>Só minhas</span></button>
        <button type="button" class="tk-chip ${filtros.prioridade ? 'is-on' : ''}" data-f="prioridade">${icone('flag')}<span class="tk-chip__label">${filtros.prioridade ? `Prioridade ${filtros.prioridade}` : 'Qualquer prioridade'}</span>${icone('chevronDown')}</button>
      </div>
      <label class="tk-find">${icone('search')}<span class="sr-only">Filtrar</span><input class="tk-find__input" id="tk-find" type="search" placeholder="Título, processo, cliente…" value="${filtros.texto}" autocomplete="off"></label>
      <button type="button" class="btn btn--ghost btn--sm tk-clear" data-f="limpar">Limpar</button>
    </div>
    <div id="tarefas-corpo">${corpo(visao, lista, todas)}</div>`,
    depois(raiz) {
      const recarregar = () => navegar();
      const repintar = () => { raiz.querySelector('#tarefas-corpo').innerHTML = String(corpo(visao, todas.filter(passa), todas)); ligarQuadro(raiz, todas, recarregar, undefined, aoMudar); };
      // Mudança local (concluir, editar no painel): repinta só o corpo, sem ir ao servidor.
      const aoMudar = () => repintar();
      ouvir(raiz, 'click', '[data-visao]', (b) => { guardado.gravar('tarVisaoV2', b.dataset.visao); navegar(); });
      ouvir(raiz, 'click', '[data-tipo]', (b) => { filtros.tipo = b.dataset.tipo || null; raiz.querySelectorAll('[data-tipo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); repintar(); });
      ouvir(raiz, 'click', '[data-arquivadas]', () => { filtros.arquivadas = !filtros.arquivadas; navegar(); });
      ouvir(raiz, 'click', '[data-limpeza]', () => abrirLimpeza(recarregar).catch(erroDe));
      ouvir(raiz, 'click', '[data-f]', (b) => {
        const f = b.dataset.f;
        if (f === 'minhas') { filtros.minhas = !filtros.minhas; b.classList.toggle('is-on', filtros.minhas); repintar(); }
        else if (f === 'limpar') { Object.assign(filtros, { projeto: null, minhas: false, prioridade: null, texto: '', tipo: null }); navegar(); }
        else if (f === 'projeto') menu(b, [{ rotulo: 'Todos os projetos', acao: () => { filtros.projeto = null; navegar(); } }, '-',
          ...estado.projetos.filter((p) => p.situacao !== 'encerrado').map((p) => ({ rotulo: p.nome, icone: 'folder', acao: () => { filtros.projeto = p.id; navegar(); } }))]);
        else menu(b, [{ rotulo: 'Qualquer prioridade', acao: () => { filtros.prioridade = null; navegar(); } }, '-',
          ...['urgente', 'alta', 'media', 'baixa'].map((p) => ({ rotulo: p[0].toUpperCase() + p.slice(1), icone: 'flag', acao: () => { filtros.prioridade = p; navegar(); } }))]);
      });
      const busca = raiz.querySelector('#tk-find');
      busca.addEventListener('input', debounce(() => { filtros.texto = busca.value; repintar(); }, 120));
      ligarQuadro(raiz, todas, recarregar, undefined, aoMudar);
      ouvir(raiz, 'click', '[data-publicacao]', (b) => import('./controladoria.js').then(m=>m.abrirPublicacao(b.dataset.publicacao)).catch(erroDe));
      ouvir(raiz, 'change', '[data-status-tarefa]', async (b) => {
        const t = todas.find((x) => x.id === b.dataset.statusTarefa); if (!t) return;
        if (b.value === 'concluida') return concluirRapido(t, { aoMudar });
        const antes = t.status; t.status = b.value;
        try { await api.patch(`/api/tarefas/${t.id}`, { status: b.value }); atualizarLateral(); } catch (e) { t.status = antes; b.value = antes; erroDe(e); }
      });
      ouvir(raiz, 'click', '[data-editar-linha]', (b) => abrirTarefa(todas.find((t) => t.id === b.dataset.editarLinha), { aoMudar, aoExcluir: recarregar }));
      ouvir(raiz, 'click', '[data-cumprir]', (b) => cumprirTarefa(todas.find((t) => t.id === b.dataset.cumprir), recarregar).catch(erroDe));
      ouvir(raiz, 'click', '[data-reabrir]', async (b) => { try { await api.post('/api/tarefas/desarquivar', { ids: [b.dataset.reabrir] }); toast('Reaberta: voltou ao quadro'); recarregar(); } catch (e) { erroDe(e); } });
      // Seleção em lote (lista): concluir ou arquivar várias de uma vez.
      const barra = () => { const sel = raiz.querySelectorAll('[data-sel]:checked').length; const b = raiz.querySelector('[data-lote]'); if (b) { b.hidden = !sel; b.querySelector('b').textContent = sel; } };
      ouvir(raiz, 'change', '[data-sel], [data-sel-todas]', (c) => { if (c.matches('[data-sel-todas]')) raiz.querySelectorAll('[data-sel]').forEach((x) => { x.checked = c.checked; }); barra(); });
      ouvir(raiz, 'click', '[data-lote-acao]', async (b) => {
        const ids = [...raiz.querySelectorAll('[data-sel]:checked')].map((x) => x.dataset.sel); if (!ids.length) return;
        const acao = b.dataset.loteAcao;
        if (acao === 'arquivar' && !(await confirmar(`Arquivar ${ids.length} item(ns)?`, 'Saem do quadro e ficam em "Arquivadas", com o motivo. Nada é apagado e dá para reabrir.', { rotulo: 'Arquivar' }))) return;
        b.disabled = true;
        try {
          if (acao === 'concluir') { for (const id of ids) await api.patch(`/api/tarefas/${id}`, { status: 'concluida' }); toast(`${ids.length} concluída(s)`); }
          else { const r2 = await api.post('/api/tarefas/arquivar', { ids }); toast(`${r2.arquivadas} arquivada(s)`, 'ok', 6000, { rotulo: 'Desfazer', fn: () => api.post('/api/tarefas/desarquivar', { ids }).then(recarregar).catch(erroDe) }); }
          atualizarLateral(); recarregar();
        } catch (e) { b.disabled = false; erroDe(e); }
      });
    },
  };
}

function corpo(visao, lista, todas) {
  if (!todas.length) return html`<section class="card glass up">${vazio(filtros.arquivadas ? 'inbox' : 'check', filtros.arquivadas ? 'Nada arquivado' : 'Nenhuma tarefa ainda',
    filtros.arquivadas ? 'Quando a limpeza ou a agenda do Astrea tirar algo do quadro, aparece aqui com o motivo.' : 'Tarefa é o trabalho do dia a dia dentro de um projeto: quem faz, até quando, em que ponto está.',
    pode('tarefa.escrever') && !filtros.arquivadas ? '<button class="btn btn--accent" data-nova="a_fazer">Criar a primeira tarefa</button>' : '')}</section>`;
  if (!lista.length) return html`<section class="card glass up">${vazio('filter', 'Nada com esses filtros', 'Troque o tipo ou limpe os filtros.')}</section>`;
  if (visao === 'quadro' && !filtros.arquivadas) return htmlQuadro(lista);
  const escreve = pode('tarefa.escrever');
  return html`<section class="card glass up task-list">
    ${escreve && !filtros.arquivadas ? html`<div class="tk-lote" data-lote hidden><b>0</b> selecionada(s)<button class="btn btn--accent btn--sm" data-lote-acao="concluir">${icone('check')}Concluir</button><button class="btn btn--ghost btn--sm" data-lote-acao="arquivar">${icone('inbox')}Arquivar</button></div>` : ''}
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${escreve && !filtros.arquivadas ? html`<th class="tk-selcol"><input type="checkbox" data-sel-todas aria-label="Selecionar todas"></th>` : ''}<th>Atividade</th><th>Projeto / processo</th><th>Responsável</th><th>Data</th><th>Situação</th><th></th></tr></thead>
    <tbody>${lista.map((t) => html`<tr class="${t.status === 'concluida' ? 'is-done' : ''}">${escreve && !filtros.arquivadas ? html`<td class="tk-selcol"><input type="checkbox" data-sel="${t.id}" aria-label="Selecionar ${t.titulo}"></td>` : ''}
      <td class="task-title">${seloTipo(t)}<button class="link" data-editar-linha="${t.id}"><b>${t.titulo}</b></button>${t.publicacaoId?html`<button class="link task-origin" type="button" data-publicacao="${t.publicacaoId}">Abrir intimação e análise</button>`:''}${t.arquivadaMotivo ? html`<span class="task-type">${t.arquivadaMotivo}</span>` : ''}</td>
      <td><span class="pchip hue--${matiz(t.projetoId)}"><i></i>${t.projeto}</span>${t.processo?html`<div class="mono-sm mt">${t.processo}</div>`:t.caso?html`<div class="task-type mt">Caso: ${t.caso}</div>`:''}</td><td>${t.responsavel??'Sem responsável'}</td>
      <td class="mono-sm" ${t.situacaoDoPrazo==='atrasada'?raw('style="color:var(--lab-red)"'):''}>${t.prazo?dataCurta(t.prazo):'Sem data'}${t.hora?` ${t.hora}`:''}<span class="task-type">${tipoDe(t)==='prazo'?'Vencimento':tipoDe(t)==='analise'?'Analisar até':tipoDe(t)==='tarefa'?'Entrega':'Data do ato'}</span></td>
      <td>${filtros.arquivadas ? html`<span class="selo">Arquivada ${relativo(t.arquivadaEm)}</span>` : escreve?html`<select class="select" data-status-tarefa="${t.id}" aria-label="Situação de ${t.titulo}">${COLUNAS.map(c=>html`<option value="${c.id}" ${c.id===t.status?raw('selected'):''}>${c.nome}</option>`)}</select>`:html`<span class="selo">${COLUNAS.find(c=>c.id===t.status)?.nome??t.status}</span>`}</td>
      <td class="tk-acts">${filtros.arquivadas && escreve ? html`<button class="btn btn--ghost btn--sm" type="button" data-reabrir="${t.id}">Reabrir</button>` : escreve&&t.status!=='concluida'?html`${t.processo?html`<button class="ibtn" type="button" data-cumprir="${t.id}" aria-label="Cumprir ${t.titulo}" title="Cumprir: juntar a peça e concluir">${icone('upload')}</button>`:''}<button class="ibtn tk-check" type="button" data-concluir="${t.id}" aria-label="Concluir ${t.titulo}" title="Concluir">${icone('check')}</button>`:''}</td></tr>`)}</tbody></table></div></section>`;
}

/** Limpeza do que apodreceu: prévia por grupo, escolher o corte em dias, arquivar (com desfazer). */
async function abrirLimpeza(recarregar) {
  let dias = 30;
  const previa = (d) => api.post('/api/tarefas/limpeza', { dias: d, grupos: ['astrea', 'analise', 'outras'], previa: true });
  let p = await previa(dias);
  const GR = { astrea: ['Vindas do Astrea', 'Prazos, eventos e audiências da agenda do Astrea que ninguém deu baixa.'], analise: ['Análises de intimação', 'Intimações do DJEN esperando triagem. Atenção: arquivar não conclui a intimação na Controladoria.'], outras: ['Demais tarefas', 'Tarefas internas vencidas.'] };
  const desenhar = (el) => {
    el.querySelector('[data-grupos]').innerHTML = String(html`${Object.entries(GR).map(([k, [rot, dica]]) => html`<label class="limpa-g"><input type="checkbox" name="g" value="${k}" ${k === 'astrea' ? raw('checked') : ''}>
      <span><b>${rot}</b><small>${dica}</small>${(p.exemplos[k] ?? []).length ? html`<ul>${p.exemplos[k].map((x) => html`<li>${dataBR(x.prazo)} · ${x.titulo} <i>${x.projeto}</i></li>`)}</ul>` : ''}</span><em class="limpa-g__n">${p.contagem[k]}</em></label>`)}`);
  };
  await modal({
    titulo: 'Limpeza de tarefas vencidas', subtitulo: 'Tira do quadro o que venceu há muito tempo e ninguém deu baixa. Nada é apagado: vai para "Arquivadas" com o motivo e dá para desfazer.', largo: true,
    corpo: html`<div class="limpa"><label class="field"><span>Vencidas há mais de <b data-dias-txt>${dias}</b> dias</span><input type="range" min="7" max="120" step="1" value="${dias}" data-dias></label>
      <p class="dica">Daqui em diante isto também acontece sozinho: a cada carga da agenda do Astrea, o que foi concluído lá fecha aqui, o que saiu da agenda é arquivado e o que está vencido há mais de 30 dias não entra.</p>
      <div data-grupos class="limpa-gs"></div></div>`,
    acoes: [{ id: 'n', rotulo: 'Cancelar' }, { id: 's', rotulo: 'Arquivar selecionadas', tipo: 'primario' }],
    aoAbrir(el) {
      desenhar(el);
      const faixa = el.querySelector('[data-dias]');
      faixa.addEventListener('input', () => { el.querySelector('[data-dias-txt]').textContent = faixa.value; });
      faixa.addEventListener('change', async () => { dias = Number(faixa.value); try { p = await previa(dias); desenhar(el); } catch (e) { el.erro(e.message); } });
      el.addEventListener('acao', async (e) => {
        if (e.detail.id !== 's') return el.fechar(null);
        const grupos = [...el.querySelectorAll('[name=g]:checked')].map((x) => x.value);
        if (!grupos.length) return el.erro('Marque ao menos um grupo.');
        e.detail.botao.disabled = true;
        try {
          const r = await api.post('/api/tarefas/limpeza', { dias, grupos, previa: false });
          el.fechar(true); atualizarLateral(); recarregar();
          toast(`${r.arquivadas} item(ns) arquivado(s)`, 'ok', 8000, { rotulo: 'Desfazer', fn: () => api.post('/api/tarefas/desarquivar', { ids: r.ids }).then(() => { toast('Limpeza desfeita'); atualizarLateral(); recarregar(); }).catch(erroDe) });
        } catch (er) { e.detail.botao.disabled = false; el.erro(er.message); }
      });
    },
  });
}

async function camposDaTarefa(t = {}, projetoFixo) {
  const eq = await equipe();
  const ativos = estado.projetos.filter((p) => p.situacao !== 'encerrado');
  return [
    ...(projetoFixo || t.id ? [] : [{ nome: 'projetoId', rotulo: 'Projeto', tipo: 'select', obrigatorio: true, valor: filtros.projeto ?? ativos[0]?.id, opcoes: ativos.map((p) => ({ v: p.id, t: p.nome })) }]),
    { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', metade: true, valor: t.tipo ?? 'tarefa', opcoes: Object.entries(TIPOS).filter(([k]) => k !== 'analise').map(([v, x]) => ({ v, t: x.nome })) },
    { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', metade: true, valor: t.prioridade ?? 'media', opcoes: [{ v: 'baixa', t: 'Baixa' }, { v: 'media', t: 'Média' }, { v: 'alta', t: 'Alta' }, { v: 'urgente', t: 'Urgente' }] },
    { nome: 'titulo', rotulo: 'O que precisa ser feito', obrigatorio: true, valor: t.titulo, placeholder: 'Ex.: Revisar minuta do plano' },
    { nome: 'descricao', rotulo: 'Detalhes', tipo: 'textarea', valor: t.descricao ?? '' },
    { nome: 'responsavelId', rotulo: 'Responsável', tipo: 'select', metade: true, valor: t.responsavelId ?? estado.eu.usuario.id, opcoes: eq.map((u) => ({ v: u.id, t: u.nome })) },
    { nome: 'prazo', rotulo: 'Data', tipo: 'date', metade: true, valor: t.prazo ?? '' },
    { nome: 'hora', rotulo: 'Hora (eventos e audiências)', tipo: 'time', metade: true, valor: t.hora ?? '' },
    { nome: 'status', rotulo: 'Situação', tipo: 'select', metade: true, valor: t.status ?? 'a_fazer', opcoes: COLUNAS.map((c) => ({ v: c.id, t: c.nome })) },
  ];
}

export async function novaTarefa(depois, projetoFixo, status = 'a_fazer') {
  if (!estado.projetos.length) { try { estado.projetos = await api.get('/api/projetos'); } catch (e) { return erroDe(e); } }
  if (!projetoFixo && !estado.projetos.some((p) => p.situacao !== 'encerrado')) return toast('Crie um projeto antes de criar tarefas.', 'aviso');
  const campos = await camposDaTarefa({ status, tipo: filtros.tipo && filtros.tipo !== 'agenda' && filtros.tipo !== 'analise' ? filtros.tipo : 'tarefa' }, projetoFixo);
  return formulario({
    titulo: 'Novo item', subtitulo: 'Tarefa interna, prazo processual, evento ou audiência', rotulo: 'Criar', campos,
    async enviar(v) {
      await api.post(`/api/projetos/${projetoFixo ?? v.projetoId}/tarefas`, {
        titulo: v.titulo, descricao: v.descricao, responsavelId: v.responsavelId, prazo: v.prazo ?? null,
        prioridade: v.prioridade, status: v.status, tipo: v.tipo, hora: v.hora || null,
      });
      toast(`${TIPOS[v.tipo]?.nome ?? 'Tarefa'} criad${v.tipo === 'prazo' || v.tipo === 'evento' ? 'o' : 'a'}`); atualizarLateral(); depois?.();
    },
  });
}

/** Compatibilidade: telas antigas chamam `editarTarefa(t, depois)`. Abre o painel; `depois` só roda se algo mudou. */
export function editarTarefa(t, depois) { return abrirTarefa(t, { aoExcluir: () => depois?.(), aoFechar: (mudou) => { if (mudou) depois?.(); } }); }

/**
 * Painel da tarefa (lateral). Salva cada campo sozinho, ao sair dele: não há "Salvar" e fechar é instantâneo,
 * porque nada recarrega a tela — quem abriu recebe `aoMudar(t)` com o objeto já atualizado.
 */
export async function abrirTarefa(t, { aoMudar: aoMudarFora, aoExcluir, aoFechar } = {}) {
  if (!t) return;
  let mudou = false; const aoMudar = (x) => { mudou = true; aoMudarFora?.(x); };
  document.querySelector('.tk-drawer')?.__fechar?.();
  const eq = await equipe().catch(() => []);
  const escreve = pode('tarefa.escrever');
  const k = tipoDe(t);
  const el = document.createElement('aside'); el.className = 'tk-drawer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-label', t.titulo);
  const fundo = document.createElement('div'); fundo.className = 'tk-drawer__fundo';
  const pintar = () => {
    const conc = t.status === 'concluida';
    el.innerHTML = String(html`<header class="tk-drawer__head">
        <div class="tk-drawer__meta">${seloTipo(t)}<span class="pchip hue--${matiz(t.projetoId)}"><i></i>${t.projeto}</span>${t.doAstrea ? html`<span class="selo">Astrea</span>` : ''}</div>
        <button class="ibtn ibtn--sm" type="button" data-x aria-label="Fechar (Esc)">${icone('x')}</button></header>
      <div class="tk-drawer__body">
        ${escreve ? html`<textarea class="tk-drawer__titulo" data-campo="titulo" rows="1" aria-label="Título">${t.titulo}</textarea>` : html`<h2 class="tk-drawer__titulo">${t.titulo}</h2>`}
        ${vinculo(t) ? html`<div class="tk-drawer__vinc">${vinculo(t)}</div>` : ''}
        ${t.arquivadaEm ? html`<div class="tk-drawer__aviso">${icone('inbox')}<div><b>Arquivada ${relativo(t.arquivadaEm)}</b><small>${t.arquivadaMotivo ?? ''}</small></div>${escreve ? html`<button class="btn btn--ghost btn--sm" data-reabrir-drawer>Reabrir</button>` : ''}</div>` : ''}
        ${escreve && !t.arquivadaEm ? html`<div class="tk-drawer__acao">
          ${conc ? html`<button class="btn btn--ghost tk-done-btn is-done" data-reabrir-status>${icone('check')}Concluída${t.concluidaEm ? ` ${relativo(t.concluidaEm)}` : ''}${t.concluidaPor ? ` por ${t.concluidaPor}` : ''} · reabrir</button>`
            : html`<button class="btn tk-done-btn" data-concluir-drawer>${icone('check')}Concluir ${TIPOS[k].nome.toLowerCase()}</button>`}
          ${!conc ? html`<div class="tk-status" role="group" aria-label="Situação">${COLUNAS.filter((c) => c.id !== 'concluida').map((c) => html`<button type="button" data-status="${c.id}" aria-pressed="${t.status === c.id}"><i style="background:${raw(c.cor)}"></i>${c.nome}</button>`)}</div>` : ''}
          ${!conc && t.processo ? html`<button class="btn btn--ghost btn--sm" data-cumprir-drawer>${icone('upload')}Cumprir juntando a peça</button>` : ''}
        </div>` : ''}
        ${conc && escreve ? html`<label class="field"><span>O que foi feito</span><textarea class="textarea" data-campo="conclusaoNota" rows="2" placeholder="Ex.: Protocolada a manifestação; aguardando decisão.">${t.conclusaoNota ?? ''}</textarea></label>` : t.conclusaoNota ? html`<p class="dica"><b>O que foi feito:</b> ${t.conclusaoNota}</p>` : ''}
        <div class="tk-drawer__grid">
          <label class="field"><span>Responsável</span><select class="select" data-campo="responsavelId" ${escreve ? '' : raw('disabled')}><option value="">Sem responsável</option>${eq.map((u) => html`<option value="${u.id}" ${u.id === t.responsavelId ? raw('selected') : ''}>${u.nome}</option>`)}</select></label>
          <label class="field"><span>${k === 'prazo' ? 'Vencimento' : k === 'tarefa' ? 'Entrega' : 'Data'}</span><input class="input" type="date" data-campo="prazo" value="${t.prazo ?? ''}" ${escreve ? '' : raw('disabled')}></label>
          <label class="field"><span>Tipo</span><select class="select" data-campo="tipo" ${escreve ? '' : raw('disabled')}>${Object.entries(TIPOS).map(([v, x]) => html`<option value="${v}" ${v === k ? raw('selected') : ''}>${x.nome}</option>`)}</select></label>
          ${['evento', 'audiencia'].includes(k) ? html`<label class="field"><span>Hora</span><input class="input" type="time" data-campo="hora" value="${t.hora ?? ''}" ${escreve ? '' : raw('disabled')}></label>`
            : html`<label class="field"><span>Prioridade</span><select class="select" data-campo="prioridade" ${escreve ? '' : raw('disabled')}>${['baixa', 'media', 'alta', 'urgente'].map((p) => html`<option value="${p}" ${p === t.prioridade ? raw('selected') : ''}>${p === 'media' ? 'Média' : p[0].toUpperCase() + p.slice(1)}</option>`)}</select></label>`}
        </div>
        <label class="field"><span>Detalhes</span><textarea class="textarea" data-campo="descricao" rows="5" placeholder="Contexto, links, o que falta…" ${escreve ? '' : raw('disabled')}>${t.descricao ?? ''}</textarea></label>
        ${t.publicacaoId ? html`<button class="btn btn--ghost btn--sm" data-pub-drawer>${icone('search')}Abrir a intimação de origem</button>` : ''}
        <p class="tk-drawer__rodape">Criada ${relativo(t.criadoEm)}${t.doAstrea ? ' pela agenda do Astrea' : ''} · <span data-salvo>alterações salvam sozinhas</span></p>
      </div>
      ${escreve ? html`<footer class="tk-drawer__foot"><button class="btn btn--ghost btn--sm perigo-btn" data-excluir>${icone('trash')}Excluir</button><button class="btn btn--ghost btn--sm" data-abrir-projeto>${icone('folder')}Abrir projeto</button></footer>` : ''}`);
    ajustarTitulo();
  };
  const ajustarTitulo = () => requestAnimationFrame(() => { const ta = el.querySelector('.tk-drawer__titulo'); if (ta?.tagName === 'TEXTAREA') { ta.style.height = 'auto'; ta.style.height = `${Math.max(36, ta.scrollHeight)}px`; } });
  const salvo = (txt) => { const s = el.querySelector('[data-salvo]'); if (s) { s.textContent = txt; s.classList.toggle('ok', txt === 'salvo'); } };
  const salvar = async (campo, valor) => {
    const antes = t[campo]; if ((antes ?? '') === (valor ?? '')) return;
    t[campo] = valor; salvo('salvando…'); aoMudar?.(t);
    try { await api.patch(`/api/tarefas/${t.id}`, { [campo]: valor === '' ? null : valor }); salvo('salvo'); if (campo === 'tipo') pintar(); }
    catch (e) { t[campo] = antes; aoMudar?.(t); salvo('não salvou'); erroDe(e); pintar(); }
  };
  let fechado = false;
  const fechar = () => { if (fechado) return; fechado = true; document.removeEventListener('keydown', tecla); aoFechar?.(mudou); el.classList.remove('aberta'); fundo.classList.remove('on'); setTimeout(() => { el.remove(); fundo.remove(); }, 220); };
  const tecla = (e) => { if (e.key === 'Escape' && !document.querySelector('.lab-modal')) { e.preventDefault(); fechar(); } };
  el.__fechar = fechar;
  pintar(); document.body.append(fundo, el);
  requestAnimationFrame(() => { el.classList.add('aberta'); fundo.classList.add('on'); });
  document.addEventListener('keydown', tecla);
  fundo.addEventListener('click', fechar);
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.matches('[data-x]')) return fechar();
    // Tela responde na hora; o servidor confirma por trás (e, se recusar, volta e repinta).
    if (b.matches('[data-concluir-drawer]')) { const p = concluirRapido(t, { aoMudar }); pintar(); await p; return pintar(); }
    if (b.matches('[data-reabrir-status]')) { const p = salvarStatus('a_fazer'); pintar(); await p; return pintar(); }
    if (b.matches('[data-status]')) { const p = salvarStatus(b.dataset.status); pintar(); await p; return pintar(); }
    if (b.matches('[data-cumprir-drawer]')) { fechar(); return cumprirTarefa(t, () => aoExcluir?.()).catch(erroDe); }
    if (b.matches('[data-pub-drawer]')) return import('./controladoria.js').then((m) => m.abrirPublicacao(t.publicacaoId)).catch(erroDe);
    if (b.matches('[data-abrir-projeto]')) { fechar(); location.hash = `#/projetos/${t.projetoId}/tarefas`; return; }
    if (b.matches('[data-reabrir-drawer]')) { try { await api.post('/api/tarefas/desarquivar', { ids: [t.id] }); fechar(); toast('Reaberta: voltou ao quadro'); aoExcluir?.(); } catch (er) { erroDe(er); } return; }
    if (b.matches('[data-excluir]') && await confirmar('Excluir?', `"${t.titulo}" será apagada. Fica registrado na auditoria.`, { rotulo: 'Excluir', perigo: true })) {
      try { await api.del(`/api/tarefas/${t.id}`); fechar(); toast('Excluída'); atualizarLateral(); aoExcluir?.(); } catch (er) { erroDe(er); }
    }
  });
  const salvarStatus = async (status) => {
    const antes = t.status; if (antes === status) return;
    Object.assign(t, { status, concluidaEm: status === 'concluida' ? new Date().toISOString() : null }); aoMudar?.(t);
    try { await api.patch(`/api/tarefas/${t.id}`, { status }); atualizarLateral(); } catch (e) { t.status = antes; aoMudar?.(t); erroDe(e); }
  };
  // Campos: salvam ao sair (change) e, no texto, também após uma pausa na digitação.
  el.addEventListener('change', (e) => { const c = e.target.closest('[data-campo]'); if (c) salvar(c.dataset.campo, c.value.trim()); });
  const digitando = debounce((c) => salvar(c.dataset.campo, c.value.trim()), 900);
  el.addEventListener('input', (e) => {
    const c = e.target.closest('textarea[data-campo]'); if (!c) return;
    if (c.classList.contains('tk-drawer__titulo')) { c.style.height = 'auto'; c.style.height = `${c.scrollHeight}px`; if (!c.value.trim()) return; }
    salvo('editando…'); digitando(c);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('tk-drawer__titulo')) { e.preventDefault(); e.target.blur(); } });
  queueMicrotask(() => el.querySelector('[data-concluir-drawer], [data-x]')?.focus());
}

/**
 * Cumprir tarefa: o advogado faz tudo pelo LAB, sem abrir o processo eletrônico.
 * Puxa o contexto (processo, intimação de origem, últimos andamentos), sobe a
 * peça como documento do projeto e conclui — o resumo é gravado como andamento.
 */
export async function cumprirTarefa(t, depois) {
  if (!t) return;
  const [and, pub] = await Promise.all([
    api.get(`/api/projetos/${t.projetoId}/andamentos?dias=120`).catch(() => null),
    t.publicacaoId ? api.get(`/api/controladoria/publicacoes/${t.publicacaoId}/detalhe`).catch(() => null) : Promise.resolve(null),
  ]);
  const itens = and?.itens ?? [];
  const doProcesso = t.processo ? itens.filter((m) => m.processo === t.processo) : itens;
  const andItens = (doProcesso.length ? doProcesso : itens).slice(0, 6);

  await modal({
    titulo: 'Cumprir tarefa', largo: true,
    subtitulo: `${t.projeto}${t.processo ? ` · ${t.processo}` : ''}`,
    corpo: html`<div class="cumprir">
      <section class="card glass up" style="margin-bottom:14px">
        <div class="flex" style="flex-wrap:wrap;gap:8px">
          <span class="pchip hue--${matiz(t.projetoId)}"><i></i>${t.projeto}</span>
          ${t.processo ? html`<span class="selo info mono-sm">${t.processo}</span>` : html`<span class="selo aviso">Sem processo vinculado</span>`}
          ${t.prazo ? html`<span class="selo ${t.situacaoDoPrazo === 'atrasada' ? 'alert' : ''}">${icone('calendar')}Prazo ${dataCurta(t.prazo)}</span>` : ''}
        </div>
        <p class="dica" style="margin-top:8px"><b>${t.titulo}</b></p>
        ${t.publicacaoId ? html`<button class="link" type="button" data-abrir-pub>${icone('search')}Abrir a intimação que gerou o prazo</button>` : ''}
        ${pub ? html`<details style="margin-top:8px"><summary class="link">Ver a intimação (${pub.tipo ?? 'publicação'}${pub.tribunal ? ` · ${pub.tribunal}` : ''})</summary><div class="pub-reader__text" style="max-height:170px;overflow:auto;margin-top:8px">${pub.texto_legivel ?? pub.texto ?? 'Sem texto disponível.'}</div></details>` : ''}
      </section>
      <section style="margin-bottom:14px">
        <h3 class="mini-h">Últimos andamentos do processo</h3>
        ${andItens.length ? html`<ul class="lista">${andItens.map((m) => html`<li><div><b>${m.titulo}</b><small>${dataCurta(m.data)}${m.conteudo ? ` · ${m.conteudo.slice(0, 140)}` : ''}</small></div></li>`)}</ul>` : html`<p class="dica">Nenhum andamento recente carregado. Use “Buscar andamentos agora” na tela do processo se precisar atualizar.</p>`}
      </section>
      <section>
        <h3 class="mini-h">Juntar a peça</h3>
        <label class="drop" id="cp-drop" tabindex="0"><input type="file" id="cp-arq" hidden accept=".pdf,.docx,.doc,.txt,.csv,.xlsx">${icone('upload')}<b>Selecione a peça (PDF, Word ou texto)</b><small>Vira documento do projeto e sincroniza para a pasta do cliente no Drive.</small></label>
        <div id="cp-sel" class="dica" style="margin-top:6px"></div>
        <p class="dica">Ao concluir, o sistema lê a peça e grava um resumo como andamento do processo. Sem IA configurada, o resumo fica pendente com o motivo e preenche sozinho quando a chave existir — nunca inventamos um resumo.</p>
        <div id="cp-res" aria-live="polite"></div>
      </section>
    </div>`,
    acoes: [{ id: 'fechar', rotulo: 'Fechar' }, { id: 'cumprir', rotulo: 'Concluir e juntar peça', tipo: 'primario' }],
    aoAbrir(el) {
      let arquivo = null; let feito = false;
      const entrada = el.querySelector('#cp-arq'); const sel = el.querySelector('#cp-sel'); const res = el.querySelector('#cp-res'); const drop = el.querySelector('#cp-drop');
      drop.addEventListener('click', () => entrada.click());
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.click(); } });
      entrada.addEventListener('change', () => { arquivo = entrada.files[0] ?? null; sel.textContent = arquivo ? `Selecionado: ${arquivo.name}` : ''; });
      el.querySelector('[data-abrir-pub]')?.addEventListener('click', () => import('./controladoria.js').then((m) => m.abrirPublicacao(t.publicacaoId)).catch(erroDe));
      el.addEventListener('acao', async (e) => {
        if (e.detail.id === 'fechar') return el.fechar(feito);
        if (e.detail.id !== 'cumprir') return;
        if (!arquivo) { el.erro('Selecione a peça antes de concluir.'); return; }
        const btn = e.detail.botao; btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Juntando…'; el.erro('');
        try {
          const fd = new FormData(); fd.append('arquivo', arquivo); fd.append('titulo', arquivo.name); fd.append('categoria', 'Peça processual');
          const doc = await api.enviar(`/api/projetos/${t.projetoId}/documentos`, fd);
          const r = await api.post(`/api/tarefas/${t.id}/cumprir`, { documentoId: doc.documentoId });
          feito = true;
          res.innerHTML = String(html`<p class="selo ok" style="margin-top:10px">Peça juntada e tarefa concluída.</p>${r.estado === 'gerado'
            ? html`<h4 class="mini-h">Resumo gravado no processo</h4><p>${r.resumo}</p><p class="dica">Resumo gerado por IA — confira antes de usar.</p>`
            : html`<p class="selo aviso" style="margin-top:8px">Resumo pendente — IA não configurada.</p><p class="dica">${r.motivo ?? ''} O resumo preenche este andamento sozinho quando a chave da IA existir.</p>`}`);
          toast('Tarefa cumprida'); atualizarLateral();
          btn.textContent = 'Concluído';
          setTimeout(() => { el.fechar(true); depois?.(); }, 1800);
        } catch (err) { btn.disabled = false; btn.textContent = txt; el.erro(err.message); }
      });
    },
  });
}
