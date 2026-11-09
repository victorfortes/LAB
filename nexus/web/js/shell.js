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
import { estado, ehCliente, pode, ROTULO_DO_PAPEL } from './estado.js';
import { animarAneis, animarBarras, contar, fundo, lente } from './fx.js';
import { menu, paleta, toast, erroDe } from './ui.js';

const NAV_EQUIPE = [
  { rota: 'painel', rotulo: 'Painel', icone: 'home' },
  { rota: 'tarefas', rotulo: 'Tarefas', icone: 'check', contagem: 'tarefas' },
  { rota: 'calendario', rotulo: 'Calendário', icone: 'calendar' },
  { rota: 'clientes', rotulo: 'Clientes', icone: 'users', permissao: 'cliente.ler' },
  { rota: 'projetos', rotulo: 'Projetos', icone: 'folder' },
  { rota: 'conversas', rotulo: 'Conversas', icone: 'comment' },
  { rota: 'ferramentas', rotulo: 'Ferramentas', icone: 'bolt' },
  { rota: 'controladoria', rotulo: 'Controladoria', icone: 'inbox', permissao: 'controladoria.ler', contagem: 'pubs' },
  { rota: 'relatorios', rotulo: 'Relatórios', icone: 'chart' },
  { rota: 'equipe', rotulo: 'Equipe', icone: 'users' },
  { rota: 'entregas', rotulo: 'Entregas LAB', icone: 'flag', dono: true },
  { rota: 'ajustes', rotulo: 'Ajustes', icone: 'settings' },
];
const NAV_CLIENTE = [
  { rota: 'inicio', rotulo: 'Início', icone: 'home' },
  { rota: 'andamento', rotulo: 'Andamento', icone: 'scale' },
  { rota: 'documentos', rotulo: 'Documentos', icone: 'doc', contagem: 'docs' },
  { rota: 'plano', rotulo: 'Plano de pagamento', icone: 'money' },
  { rota: 'caixa', rotulo: 'Fluxo de caixa', icone: 'chart' },
  { rota: 'relatorios', rotulo: 'Relatórios', icone: 'chart' },
  { rota: 'atas', rotulo: 'Atas de reunião', icone: 'doc' },
  { rota: 'mensagens', rotulo: 'Mensagens', icone: 'comment', contagem: 'msgs' },
];
const nav = () => (ehCliente() ? NAV_CLIENTE : NAV_EQUIPE.filter((n) => (!n.permissao || pode(n.permissao)) && (!n.dono || estado.eu?.podeVerEntregas)));

/** Tabela de rotas: [padrão, módulo da view, parâmetros extras]. */
const ROTAS = {
  equipe: [
    ['painel', 'painel'], ['tarefas', 'tarefas'], ['calendario', 'calendario'],
    ['projetos', 'projetos'], ['projetos/:id', 'projeto'], ['projetos/:id/:aba', 'projeto'],
    ['ferramentas', 'ferramentas'], ['ferramentas/:id', 'ferramentas'], ['controladoria', 'controladoria'],
    ['relatorios', 'relatorios'], ['equipe', 'equipe'], ['ajustes', 'ajustes'], ['clientes', 'clientes'], ['sentinela', 'sentinela'], ['sentinela/:aba', 'sentinela'], ['sentinela/:aba/:id', 'sentinela'], ['conversas', 'conversas'], ['conversas/:id', 'conversas'], ['entregas', 'entregas'],
  ],
  cliente: [
    ['inicio', 'portal', { aba: 'inicio' }], ['andamento', 'portal', { aba: 'andamento' }],
    ['documentos', 'portal', { aba: 'documentos' }], ['plano', 'portal', { aba: 'plano' }],
    ['caixa', 'portal', { aba: 'caixa' }], ['relatorios', 'portal', { aba: 'relatorios' }], ['mensagens', 'portal', { aba: 'mensagens' }], ['atas', 'portal', { aba: 'atas' }],
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
          <img class="brand__logo" src="/img/nga.png" alt="NGA" width="91" height="35"><span class="brand__name"><em>LAB</em></span></a>
        ${ehCliente() ? html`<div class="faixa-cliente" role="note"><i></i>Portal do cliente<small>${eu.organizacoes?.[0]?.nome ?? ''}</small></div>` : ''}
        <nav class="nav" aria-label="Principal"><div class="nav__track"><span class="nav__lens" aria-hidden="true"></span>
          ${nav().map((n) => html`<a class="nav__item" href="#/${n.rota}" data-route="${n.rota}">${icone(n.icone)}<span>${n.rotulo}</span>${n.contagem ? html`<b class="nav__count" id="cnt-${n.contagem}" hidden></b>` : ''}</a>`)}
        </div></nav>
        <div class="side__group" id="fixados"></div>
        <button type="button" class="side__me" id="btn-me" aria-haspopup="menu">
          <span class="av av--md av--ini av--me hue--${matiz(eu.usuario.nome)}" aria-hidden="true">${iniciais(eu.usuario.nome)}</span>
          <span><b>${eu.usuario.nome}</b><small>${papel}</small></span>${icone('chevronDown')}</button>
      </aside>
      <header class="toolbar">
        <div class="toolbar__title glass glass--chrome"><span id="titulo-compacto">NGA LAB</span>${ehCliente() ? html`<em class="selo-cliente">Portal do cliente</em>` : ''}</div>
        <div class="toolbar__tools glass glass--chrome">
          <button type="button" class="search-pill" id="btn-busca" aria-label="Buscar (⌘K)">${icone('search')}<span>Buscar</span><kbd>⌘K</kbd></button>
          ${ehCliente() ? '' : html`<button type="button" class="tbtn" id="btn-novo" aria-label="Criar" title="Criar">${icone('plus')}</button>`}
          <button type="button" class="tbtn" id="btn-sino" aria-label="Pendências" title="Pendências">${icone('bell')}<i class="sino-ponto" id="sino-ponto" hidden></i></button>
          <button type="button" class="tbtn" id="btn-me-top" aria-label="Conta"><span class="av av--md av--ini av--me hue--${matiz(eu.usuario.nome)}" aria-hidden="true">${iniciais(eu.usuario.nome)}</span></button>
        </div>
      </header>
      <main class="main" id="main" tabindex="-1"></main>
      <nav class="tabbar" aria-label="Principal"><div class="tabbar__bar glass glass--chrome"><div class="tabbar__track"><span class="tabbar__lens" aria-hidden="true"></span>
        ${nav().slice(0, 4).map((n) => html`<a class="tab" href="#/${n.rota}" data-route="${n.rota}">${icone(n.icone)}<span>${n.rotulo.split(' ')[0]}</span></a>`)}
        <button type="button" class="tab" id="btn-mais" aria-haspopup="menu">${icone('dots')}<span>Mais</span></button></div></div></nav>
    </div>
    <div class="pop-layer" aria-live="polite"></div><div class="toasts" id="toasts"></div>`.toString();

  fundo(); ligarPreaquecimento();
  ouvir(document, 'click', '#btn-me, #btn-me-top', (el) => menuConta(el));
  ouvir(document, 'click', '#btn-busca', () => abrirBusca());
  ouvir(document, 'click', '#btn-mais', (el) => menu(el, nav().slice(4).map((n) => ({ rotulo: n.rotulo, icone: n.icone, acao: () => ir(n.rota) })).concat(['-', { rotulo: 'Buscar', icone: 'search', acao: () => abrirBusca() }])));
  ouvir(document, 'click', '#btn-sino', (el) => menuPendencias(el));
  ouvir(document, 'click', '#btn-novo', (el) => menuCriar(el));
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBusca(); }
  });
  addEventListener('hashchange', navegar);
  addEventListener('resize', () => marcarNav());
  aoPerderSessao(() => { toast('Sua sessão expirou. Entre de novo.', 'aviso'); location.reload(); });
  atualizarLateral();
  setInterval(() => { if (!document.hidden) atualizarLateral(); }, 30000);
  navegar();
}

function marca() {
  // O "A" do logo NGA ADV, com a barra em âmbar: a identidade, em miniatura.
  return raw(`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 20 11 4.5h2L19 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.6 14.6h8.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`);
}

// ------------------------------------------------------------- navegação ---

let ficha = 0;
const limpezas = [];
/** Registra algo a desfazer ao sair da tela atual (intervalos, ouvintes). */
export const aoSair = (fn) => { limpezas.push(fn); };
export async function navegar() {
  while (limpezas.length) { try { limpezas.pop()(); } catch { /* já foi */ } }
  const seg = rotaAtual();
  const padrao = ehCliente() ? 'inicio' : 'painel';
  if (seg.length === 0) return ir(padrao);

  const alvo = casar(seg);
  if (!alvo) {
    // Rota de equipe para cliente (ou o contrário): leva ao começo certo.
    if (['painel', 'tarefas', 'projetos', 'calendario', 'ferramentas', 'controladoria', 'relatorios', 'equipe', 'ajustes', 'inicio', 'andamento', 'documentos', 'plano', 'caixa', 'mensagens'].includes(seg[0])) return ir(padrao);
    return renderizar(await naoEncontrada(), ++ficha);
  }
  const minha = ++ficha;
  marcarNav();
  const main = $('#main');
  // O conteúdo anterior fica na tela, esmaecido, enquanto a nova tela carrega; o
  // esqueleto só entra se a espera passar de ~150 ms. Troca rápida não pisca.
  const primeira = !main.firstElementChild;
  main.classList.add('carregando');
  const espera = setTimeout(() => { if (minha === ficha) { main.innerHTML = skeleton(); } }, primeira ? 0 : 150);
  try {
    const mod = await import(`./views/${alvo.modulo}.js`);
    const v = await mod.default(alvo.params);
    clearTimeout(espera);
    if (minha !== ficha) return;       // o usuário já foi para outro lugar
    main.classList.remove('carregando');
    // Sem View Transitions: elas esperam um quadro renderizado e, com a aba em segundo
    // plano ou a máquina ocupada, seguravam a troca por ~1 s (medido). A entrada suave
    // abaixo é só CSS e não bloqueia nada.
    renderizar(v, minha);
    main.classList.remove('entra'); void main.offsetWidth; main.classList.add('entra');
    preaquecerTudo();
  } catch (e) {
    clearTimeout(espera);
    if (minha !== ficha) return;
    main.classList.remove('carregando');
    console.error(e);
    main.innerHTML = html`<div class="empty up"><div class="empty__ico">${icone('alert')}</div><h3>Não foi possível abrir</h3><p>${e.message}</p>
      <button class="btn btn--ghost" data-recarregar>Tentar de novo</button></div>`.toString();
  }
}

document.addEventListener('click', (e) => { if (e.target.closest?.('[data-recarregar]')) location.reload(); });

// ---------------------------------------------------------- pré-aquecimento ---

/** Carrega o módulo da tela e as leituras principais ANTES do clique, quando o ponteiro chega no link. */
function aquecerRota(hash) {
  const seg = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const alvo = casar(seg); if (!alvo) return;
  import(`./views/${alvo.modulo}.js`).catch(() => {});
  if (ehCliente()) return;
  if (alvo.modulo === 'projeto') { api.aquecer(`/api/projetos/${alvo.params.id}`); api.aquecer('/api/projetos/fases'); api.aquecer(`/api/tarefas?projeto=${alvo.params.id}`); }
  else if (alvo.modulo === 'projetos') { api.aquecer('/api/projetos'); api.aquecer('/api/projetos/fases'); }
  else if (alvo.modulo === 'tarefas') api.aquecer('/api/tarefas');
  else if (alvo.modulo === 'painel') { api.aquecer('/api/painel'); api.aquecer('/api/projetos'); }
}
let aquecido = false;
/** Depois da primeira tela, baixa os módulos restantes nos tempos ociosos: nenhuma navegação espera download. */
function preaquecerTudo() {
  if (aquecido) return; aquecido = true;
  const tabela = ehCliente() ? ROTAS.cliente : ROTAS.equipe;
  const modulos = [...new Set(tabela.map((r) => r[1]))];
  const ocioso = window.requestIdleCallback ?? ((f) => setTimeout(f, 800));
  ocioso(() => modulos.forEach((m) => import(`./views/${m}.js`).catch(() => {})));
  ocioso(() => ['projeto_extra', 'projeto_creditos', 'projeto_diagnostico'].forEach((m) => import(`./views/${m}.js`).catch(() => {})));
}
let tempoDoAlvo = 0;
function ligarPreaquecimento() {
  const dispara = (e) => {
    const a = e.target.closest?.('a[href^="#/"]'); const c = e.target.closest?.('[data-proj], [data-card]');
    const hash = a?.getAttribute('href') ?? (c ? `#/projetos/${c.dataset.proj ?? c.dataset.id}` : null);
    if (!hash || Date.now() - tempoDoAlvo < 60) return;
    tempoDoAlvo = Date.now(); aquecerRota(hash);
  };
  document.addEventListener('pointerover', dispara, { passive: true });
  document.addEventListener('focusin', dispara);
  document.addEventListener('touchstart', dispara, { passive: true });
}

function renderizar(v, minha) {
  if (minha !== ficha) return;
  const main = $('#main');
  // Cada tela recebe sua própria raiz: listeners delegados antigos não podem
  // disparar ações de um projeto anterior depois de navegar para outro.
  const vista = document.createElement('div'); vista.className = 'view-root';
  vista.innerHTML = String(v.html); main.replaceChildren(vista);
  $('#titulo-compacto').textContent = v.titulo ?? 'NGA LAB';
  document.title = `${v.titulo ?? 'NGA LAB'} · NGA LAB`;
  $$('.up', main).forEach((el, i) => { if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', Math.min(i, 14)); });
  contar(main); animarAneis(main); animarBarras(main);
  $$('.seg, .tabs', main).forEach(posicionarSeg);
  v.depois?.(vista);
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
  pill.style.height = `${btn.offsetHeight}px`;
  pill.style.width = `${btn.offsetWidth}px`; pill.style.transform = `translate(${btn.offsetLeft}px, ${pill.classList.contains('tabs__pill') ? 0 : 3}px)`;
  pill.style.opacity = 1;
}

// ------------------------------------------------------- lateral e sino ---

export async function atualizarLateral() {
  try {
    if (ehCliente()) {
      estado.portal = await api.get('/api/portal/projetos');
      const salvo = guardado.ler('projetoCliente', null);
      estado.projetoDoCliente = estado.portal.some((p) => p.projeto_id === salvo) ? salvo : estado.portal[0]?.projeto_id ?? null;
      const fix = $('#fixados');
      if (fix) fix.innerHTML = estado.portal.length < 2 ? '' : html`<p class="side__label">Meus processos</p><ul class="pinned">${estado.portal.map((p) => html`<li><a href="#/inicio" data-trocar="${p.projeto_id}"><i class="hue--${matiz(p.projeto_id)}"></i><span>${p.nome}</span></a></li>`)}</ul>`.toString();
      if (fix && !fix.dataset.trocaLigada) {
        fix.dataset.trocaLigada = 'true';
        ouvir(fix, 'click', '[data-trocar]', (a, ev) => { ev.preventDefault(); guardado.gravar('projetoCliente', a.dataset.trocar); estado.projetoDoCliente = a.dataset.trocar; api.limparCache(); navegar(); });
      }
      if (estado.projetoDoCliente) {
        const [check, msgs] = await Promise.all([
          api.get(`/api/projetos/${estado.projetoDoCliente}/checklist`).catch(() => null),
          api.get(`/api/projetos/${estado.projetoDoCliente}/mensagens`).catch(() => [])]);
        const lida = guardado.ler(`msgLidas.${estado.projetoDoCliente}`, '1970-01-01');
        const novas = msgs.filter((m) => m.lado === 'nga' && m.criado_em > lida).length;
        const falta = check?.itens.filter((i) => i.aguardaVoce).length ?? 0;
        estado.pendenciasCliente = { falta, novas };
        const d = $('#cnt-docs'); if (d) { d.textContent = falta; d.hidden = falta === 0; }
        const m = $('#cnt-msgs'); if (m) { m.textContent = novas; m.hidden = novas === 0; }
        const ponto = $('#sino-ponto'); if (ponto) ponto.hidden = falta + novas === 0;
      }
      return;
    }
    const [projetos, tar, painel] = await Promise.all([api.get('/api/projetos'), api.get('/api/tarefas'), api.get('/api/painel')]);
    estado.projetos = projetos; estado.tarefas = tar.tarefas; estado.painel = painel;
    const abertas = tar.resumo.abertas;
    if (pode('controladoria.ler')) { const pub = await api.get('/api/controladoria/publicacoes?situacao=nova').catch(() => null); const c2 = $('#cnt-pubs'); if (c2 && pub) { c2.textContent = pub.resumo.novas; c2.hidden = pub.resumo.novas === 0; } }
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
  if (ehCliente()) {
    const c = estado.pendenciasCliente ?? { falta: 0, novas: 0 };
    const itens = [];
    if (c.falta) itens.push({ rotulo: `${c.falta} documento(s) aguardando você`, icone: 'doc', acao: () => ir('documentos') });
    if (c.novas) itens.push({ rotulo: `${c.novas} mensagem(ns) nova(s) da NGA`, icone: 'comment', acao: () => ir('mensagens') });
    return menu(ancora, itens.length ? itens : [{ rotulo: 'Nada pendente com você.', icone: 'check', acao: () => {} }]);
  }
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
