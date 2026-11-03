/**
 * A casca do NGA LAB: sidebar de vidro, barra superior, roteador.
 *
 * O mesmo sistema serve a equipe e ao cliente — o que muda é a porta. A equipe
 * vê o painel de trabalho, projetos, tarefas e as ferramentas do Lab; o cliente
 * vê só o que é dele, no mesmo visual. Quem decide o que cada um ALCANÇA é o
 * servidor (RLS); a navegação apenas não oferece o que não vai funcionar.
 */
import { $, $$, esc, guardado, html, icone, iniciais, matiz, ouvir, raw } from './util.js';
import { api, aoPerderSessao } from './api.js';
import { estado, ehCliente, ROTULO_DO_PAPEL } from './estado.js';
import { animarAneis, animarBarras, brilho, contar, fundo, lente } from './fx.js';
import { menu, paleta, toast, erroDe } from './ui.js';

const NAV_EQUIPE = [
  { rota: 'painel', rotulo: 'Painel', icone: 'home' },
  { rota: 'tarefas', rotulo: 'Tarefas', icone: 'check', contagem: 'tarefas' },
  { rota: 'calendario', rotulo: 'Calendário', icone: 'calendar' },
  { rota: 'projetos', rotulo: 'Projetos', icone: 'folder' },
  { rota: 'ferramentas', rotulo: 'Ferramentas', icone: 'bolt' },
  { rota: 'relatorios', rotulo: 'Relatórios', icone: 'chart' },
  { rota: 'equipe', rotulo: 'Equipe', icone: 'users' },
  { rota: 'ajustes', rotulo: 'Ajustes', icone: 'settings' },
];
const NAV_CLIENTE = [
  { rota: 'inicio', rotulo: 'Início', icone: 'home' },
  { rota: 'andamento', rotulo: 'Andamento', icone: 'scale' },
  { rota: 'documentos', rotulo: 'Documentos', icone: 'doc', contagem: 'docs' },
  { rota: 'plano', rotulo: 'Plano de pagamento', icone: 'money' },
  { rota: 'caixa', rotulo: 'Fluxo de caixa', icone: 'chart' },
  { rota: 'mensagens', rotulo: 'Mensagens', icone: 'comment' },
];
const nav = () => (ehCliente() ? NAV_CLIENTE : NAV_EQUIPE);

/** Tabela de rotas: [padrão, módulo da view, parâmetros extras]. */
const ROTAS = {
  equipe: [
    ['painel', 'painel'], ['tarefas', 'tarefas'], ['calendario', 'calendario'],
    ['projetos', 'projetos'], ['projetos/:id', 'projeto'], ['projetos/:id/:aba', 'projeto'],
    ['ferramentas', 'ferramentas'], ['ferramentas/:id', 'ferramentas'],
    ['relatorios', 'relatorios'], ['equipe', 'equipe'], ['ajustes', 'ajustes'],
  ],
  cliente: [
    ['inicio', 'portal', { aba: 'inicio' }], ['andamento', 'portal', { aba: 'andamento' }],
    ['documentos', 'portal', { aba: 'documentos' }], ['plano', 'portal', { aba: 'plano' }],
    ['caixa', 'portal', { aba: 'caixa' }], ['mensagens', 'portal', { aba: 'mensagens' }],
  ],
};

function casar(segmentos) {
  const tabela = ehCliente() ? ROTAS.cliente : ROTAS.equipe;
  for (const [padrao, modulo, fixos] of tabela) {
    const p = padrao.split('/');
    if (p.length !== segmentos.length) continue;
    const params = { ...(fixos ?? {}) };
    if (p.every((s, i) => (s.startsWith(':') ? ((params[s.slice(1)] = decodeURIComponent(segmentos[i])), true) : s === segmentos[i]))) {
      return { modulo, params };
    }
  }
  return null;
}

export const rotaAtual = () => {
  const s = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  return s;
};
export const ir = (caminho) => { location.hash = `#/${caminho}`; };

// --------------------------------------------------------------- montar ---

export function montarCasca() {
  const eu = estado.eu;
  const papel = ROTULO_DO_PAPEL[eu.papeis?.[0]] ?? '';
  document.body.innerHTML = html`
    <a class="skip" href="#main">Ir para o conteúdo</a>
    <div class="wall" aria-hidden="true"><div class="wall__grid"></div><div class="wall__glow a"></div><div class="wall__glow b"></div><canvas id="fx"></canvas><div class="wall__scan"></div></div>
    <div class="app">
      <aside class="side glass glass--chrome" aria-label="Navegação">
        <a class="brand" href="#/${ehCliente() ? 'inicio' : 'painel'}" aria-label="NGA LAB">
          <span class="brand__mark" aria-hidden="true">${marca()}</span>
          <span class="brand__name">NGA<em>LAB</em></span></a>
        <nav class="nav" aria-label="Principal"><div class="nav__track"><span class="nav__lens" aria-hidden="true"></span>
          ${nav().map((n) => html`<a class="nav__item" href="#/${n.rota}" data-route="${n.rota}">${icone(n.icone)}<span>${n.rotulo}</span>${n.contagem ? html`<b class="nav__count" id="cnt-${n.contagem}" hidden></b>` : ''}</a>`)}
        </div></nav>
        <div class="side__group" id="fixados"></div>
        <button type="button" class="side__me" id="btn-me" aria-haspopup="menu">
          <span class="av av--md av--ini av--me hue--${matiz(eu.usuario.nome)}" aria-hidden="true">${iniciais(eu.usuario.nome)}</span>
          <span><b>${eu.usuario.nome}</b><small>${papel}</small></span>${icone('chevronDown')}</button>
      </aside>
      <header class="toolbar">
        <div class="toolbar__title glass glass--chrome"><span id="titulo-compacto">NGA LAB</span></div>
        <div class="toolbar__tools glass glass--chrome">
          <button type="button" class="search-pill" id="btn-busca" aria-label="Buscar (⌘K)">${icone('search')}<span>Buscar</span><kbd>⌘K</kbd></button>
          ${ehCliente() ? '' : html`<button type="button" class="tbtn" id="btn-novo" aria-label="Criar" title="Criar">${icone('plus')}</button>`}
          <button type="button" class="tbtn" id="btn-sino" aria-label="Pendências" title="Pendências">${icone('bell')}<i class="sino-ponto" id="sino-ponto" hidden></i></button>
          <button type="button" class="tbtn" id="btn-me-top" aria-label="Conta"><span class="av av--md av--ini av--me hue--${matiz(eu.usuario.nome)}" aria-hidden="true">${iniciais(eu.usuario.nome)}</span></button>
        </div>
      </header>
      <main class="main" id="main" tabindex="-1"></main>
      <nav class="tabbar" aria-label="Principal"><div class="tabbar__bar glass glass--chrome"><div class="tabbar__track"><span class="tabbar__lens" aria-hidden="true"></span>
        ${nav().slice(0, 5).map((n) => html`<a class="tab" href="#/${n.rota}" data-route="${n.rota}">${icone(n.icone)}<span>${n.rotulo.split(' ')[0]}</span></a>`)}</div></div></nav>
    </div>
    <div class="pop-layer" aria-live="polite"></div><div class="toasts" id="toasts"></div>`.toString();

  fundo(); brilho();
  ouvir(document, 'click', '#btn-me, #btn-me-top', (el) => menuConta(el));
  ouvir(document, 'click', '#btn-busca', () => abrirBusca());
  ouvir(document, 'click', '#btn-sino', (el) => menuPendencias(el));
  ouvir(document, 'click', '#btn-novo', (el) => menuCriar(el));
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBusca(); }
  });
  addEventListener('hashchange', navegar);
  addEventListener('resize', () => marcarNav());
  aoPerderSessao(() => { toast('Sua sessão expirou. Entre de novo.', 'aviso'); location.reload(); });
  atualizarLateral();
  navegar();
}

function marca() {
  // O "A" do logo NGA ADV, com a barra em âmbar: a identidade, em miniatura.
  return raw(`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 20 11 4.5h2L19 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.6 14.6h8.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`);
}

// ------------------------------------------------------------- navegação ---

let ficha = 0;
export async function navegar() {
  const seg = rotaAtual();
  const padrao = ehCliente() ? 'inicio' : 'painel';
  if (seg.length === 0) return ir(padrao);

  const alvo = casar(seg);
  if (!alvo) {
    // Rota de equipe para cliente (ou o contrário): leva ao começo certo.
    if (['painel', 'tarefas', 'projetos', 'calendario', 'ferramentas', 'relatorios', 'equipe', 'ajustes', 'inicio', 'andamento', 'documentos', 'plano', 'caixa', 'mensagens'].includes(seg[0])) return ir(padrao);
    return renderizar(await naoEncontrada(), ++ficha);
  }
  const minha = ++ficha;
  marcarNav();
  const main = $('#main');
  main.innerHTML = skeleton();
  try {
    const mod = await import(`./views/${alvo.modulo}.js`);
    const v = await mod.default(alvo.params);
    if (minha !== ficha) return;       // o usuário já foi para outro lugar
    renderizar(v, minha);
  } catch (e) {
    if (minha !== ficha) return;
    console.error(e);
    main.innerHTML = html`<div class="empty up"><div class="empty__ico">${icone('alert')}</div><h3>Não foi possível abrir</h3><p>${e.message}</p>
      <button class="btn btn--ghost" onclick="location.reload()">Tentar de novo</button></div>`.toString();
  }
}

function renderizar(v, minha) {
  if (minha !== ficha) return;
  const main = $('#main');
  main.innerHTML = String(v.html);
  $('#titulo-compacto').textContent = v.titulo ?? 'NGA LAB';
  document.title = `${v.titulo ?? 'NGA LAB'} · NGA LAB`;
  $$('.up', main).forEach((el, i) => { if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', Math.min(i, 14)); });
  contar(main); animarAneis(main); animarBarras(main);
  $$('.seg, .tabs', main).forEach(posicionarSeg);
  v.depois?.(main);
  main.scrollTop = 0; window.scrollTo({ top: 0 });
}

async function naoEncontrada() {
  return { titulo: 'Não encontrado', html: html`<div class="empty up"><div class="empty__ico">${icone('search')}</div><h3>Página não encontrada</h3>
    <p>Esse endereço não existe nesta área.</p><a class="btn btn--accent" href="#/${ehCliente() ? 'inicio' : 'painel'}">Voltar ao início</a></div>` };
}
const skeleton = () => `<div class="head"><div class="skel" style="width:260px;height:44px"></div><div class="skel" style="width:380px;margin-top:12px"></div></div>
  <div class="grid3" style="margin-top:22px">${'<div class="skel" style="height:190px;border-radius:24px"></div>'.repeat(3)}</div>`;

function marcarNav() {
  const raiz = rotaAtual()[0];
  $$('.nav__item, .tab').forEach((a) => {
    const on = a.dataset.route === raiz; if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  lente($('.nav__track'), '.nav__lens', '.nav__item', (a) => a.dataset.route === raiz);
  lente($('.tabbar__track'), '.tabbar__lens', '.tab', (a) => a.dataset.route === raiz);
}

/** Segmentos e abas: a pílula de vidro desliza até o botão marcado. */
export function posicionarSeg(seg) {
  const pill = $('.seg__pill, .tabs__pill', seg); if (!pill) return;
  const btn = $('[aria-pressed=true], [aria-selected=true]', seg); if (!btn) return;
  pill.style.width = `${btn.offsetWidth}px`; pill.style.transform = `translate(${btn.offsetLeft}px, ${pill.classList.contains('tabs__pill') ? 0 : 3}px)`;
  pill.style.opacity = 1;
}

// ------------------------------------------------------- lateral e sino ---

export async function atualizarLateral() {
  try {
    if (ehCliente()) {
      estado.portal = await api.get('/api/portal/projetos');
      estado.projetoDoCliente = guardado.ler('projetoCliente', null) ?? estado.portal[0]?.projeto_id ?? null;
      const fix = $('#fixados');
      if (fix) fix.innerHTML = estado.portal.length < 2 ? '' : html`<p class="side__label">Meus processos</p><ul class="pinned">${estado.portal.map((p) => html`<li><a href="#/inicio" data-trocar="${p.projeto_id}"><i class="hue--${matiz(p.projeto_id)}"></i><span>${p.nome}</span></a></li>`)}</ul>`.toString();
      ouvir($('#fixados'), 'click', '[data-trocar]', (a) => { guardado.gravar('projetoCliente', a.dataset.trocar); estado.projetoDoCliente = a.dataset.trocar; navegar(); });
      return;
    }
    const [projetos, tar, painel] = await Promise.all([api.get('/api/projetos'), api.get('/api/tarefas'), api.get('/api/painel')]);
    estado.projetos = projetos; estado.tarefas = tar.tarefas; estado.painel = painel;
    const abertas = tar.resumo.abertas;
    const c = $('#cnt-tarefas'); if (c) { c.textContent = abertas; c.hidden = abertas === 0; }
    const pins = guardado.ler('fixados', null);
    const lista = (pins ? projetos.filter((p) => pins.includes(p.id)) : projetos.filter((p) => p.situacao === 'ativo').slice(0, 3));
    const fix = $('#fixados');
    if (fix) {
      fix.innerHTML = lista.length ? html`<p class="side__label">Fixados</p><ul class="pinned">${lista.map((p) => html`<li><a href="#/projetos/${p.id}"><i class="hue--${matiz(p.id)}"></i><span>${p.nome}</span></a></li>`)}</ul>`.toString() : '';
    }
    const ponto = $('#sino-ponto'); if (ponto) ponto.hidden = !(painel.pendencias > 0);
  } catch (e) { console.warn('lateral:', e.message); }
}

function menuConta(ancora) {
  menu(ancora, [
    { rotulo: estado.eu.usuario.email, icone: 'user', acao: () => {} },
    '-',
    { rotulo: 'Sair', icone: 'logout', perigo: true, acao: async () => { await api.del('/api/sessao').catch(() => {}); location.reload(); } },
  ]);
}

function menuPendencias(ancora) {
  const p = estado.painel;
  if (!p) return toast('Carregando…', 'aviso');
  const itens = [];
  if (p.prazosVencidos) itens.push({ rotulo: `${p.prazosVencidos} prazo(s) vencido(s)`, icone: 'alert', perigo: true, acao: () => ir('calendario') });
  if (p.aAnalisar.length) itens.push({ rotulo: `${p.aAnalisar.length} documento(s) para analisar`, icone: 'doc', acao: () => ir('projetos') });
  const cred = p.aValidar.reduce((t, x) => t + x.quantos, 0);
  if (cred) itens.push({ rotulo: `${cred} crédito(s) sem classe validada`, icone: 'scale', acao: () => ir('projetos') });
  if (p.achadosCriticos.length) itens.push({ rotulo: `${p.achadosCriticos.length} achado(s) crítico(s)`, icone: 'shield', perigo: true, acao: () => ir('projetos') });
  if (p.mensagensSemResposta.length) itens.push({ rotulo: `${p.mensagensSemResposta.length} cliente(s) esperando resposta`, icone: 'comment', acao: () => ir('projetos') });
  menu(ancora, itens.length ? itens : [{ rotulo: 'Nada pendente. Mesa limpa.', icone: 'check', acao: () => {} }]);
}

function menuCriar(ancora) {
  menu(ancora, [
    { rotulo: 'Novo projeto', icone: 'folder', acao: () => import('./views/projetos.js').then((m) => m.novoProjeto()) },
    { rotulo: 'Nova tarefa', icone: 'check', acao: () => import('./views/tarefas.js').then((m) => m.novaTarefa()) },
    { rotulo: 'Novo processo', icone: 'scale', acao: () => import('./views/projeto.js').then((m) => m.novoProcessoSolto()) },
  ]);
}

function abrirBusca() {
  paleta(() => {
    const itens = nav().map((n) => ({ grupo: 'Ir para', rotulo: n.rotulo, icone: n.icone, acao: () => ir(n.rota) }));
    if (!ehCliente()) {
      for (const p of estado.projetos) itens.push({ grupo: 'Projetos', rotulo: p.nome, icone: 'folder', extra: p.faseAtual?.nome ?? p.rotuloDoTipo, acao: () => ir(`projetos/${p.id}`) });
      for (const t of estado.tarefas.slice(0, 80)) itens.push({ grupo: 'Tarefas', rotulo: t.titulo, icone: 'check', extra: t.projeto, acao: () => ir(`projetos/${t.projetoId}/tarefas`) });
    }
    return itens;
  });
}
