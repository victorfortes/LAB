/**
 * Carteira de clientes: lista à esquerda, o cliente escolhido à direita.
 *
 * O cliente selecionado fica no endereço (#/clientes/NOME), então voltar, recarregar ou mandar o link
 * mantém o lugar. Dentro do cliente, os processos se filtram por busca, tipo e situação sem sair da tela.
 */
import { api } from '../api.js';
import { $, $$, html, icone, ouvir } from '../util.js';
import { pode } from '../estado.js';
import { cabecalho, erroDe, formulario, toast, vazio } from '../ui.js';
import { ir, navegar } from '../shell.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TIPO_FIXO = { reestruturacao: 'Reestruturação', contencioso: 'Cível e contencioso', recuperacao_judicial: 'Recuperação judicial', recuperacao_extrajudicial: 'Recuperação extrajudicial' };
const TIPO = new Proxy(TIPO_FIXO, { get: (o, k) => (typeof k === 'string' && k ? o[k] ?? `${k[0].toUpperCase()}${k.slice(1).replace(/_/g, ' ')}` : undefined) });

function itemCliente(c, sel) {
  return html`<button type="button" class="cli-item ${sel ? 'is-sel' : ''}" data-cliente="${c.etiqueta}" data-busca="${norm(`${c.etiqueta} ${c.equipes.join(' ')} ${c.responsaveis.map((r) => r.responsavel).join(' ')}`)}" data-prazos="${c.prazosAbertos ? 1 : 0}" data-projeto="${c.projetoId ? 1 : 0}" aria-pressed="${sel}">
    <span class="cli-item__av" style="--h:${[...c.etiqueta].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360}">${c.etiqueta.slice(0, 2).toUpperCase()}</span>
    <span class="cli-item__txt"><b>${c.etiqueta}</b><small>${c.projetoId ? TIPO[c.tipo] ?? 'Projeto' : 'Sem projeto'} · ${c.responsaveis[0]?.responsavel ?? 'sem responsável'}</small></span>
    <span class="cli-item__nums"><b>${Math.max(0, c.registros - c.arquivados)}</b><small>ativos</small></span>
    ${c.prazosAbertos ? html`<span class="selo aviso cli-item__pz" title="Prazos abertos">${c.prazosAbertos}</span>` : ''}</button>`;
}

function painelDoCliente(c, r) {
  const ativos = r.processos.filter((x) => !x.arquivado); const arq = r.processos.length - ativos.length;
  const fases = new Map(); for (const x of ativos) fases.set(x.fase || 'Sem fase', (fases.get(x.fase || 'Sem fase') ?? 0) + 1);
  return html`<header class="cli-det__head"><div><p class="eyebrow">${c.projetoId ? TIPO[c.tipo] ?? 'Projeto' : 'Cliente sem projeto no LAB'}</p><h2>${c.etiqueta}</h2>
      <p class="card__sub">${c.equipes.join(' · ') || 'sem equipe'}${c.responsaveis.length ? html` · ${c.responsaveis.slice(0, 3).map((x) => x.responsavel).join(', ')}` : ''}</p></div>
    <div class="nx-acts">${c.projetoId ? html`<a class="btn btn--accent btn--sm" href="#/projetos/${c.projetoId}">${icone('folder')}Abrir projeto</a><a class="btn btn--ghost btn--sm" href="#/projetos/${c.projetoId}/processos">${icone('file')}Processos e prazos</a>` : ''}
      ${c.whatsappGrupoUrl ? html`<a class="btn btn--ghost btn--sm" href="${c.whatsappGrupoUrl}" target="_blank" rel="noopener noreferrer">${icone('comment')}WhatsApp</a>` : ''}
      ${c.projetoId && pode('projeto.escrever') ? html`<button class="ibtn ibtn--sm" data-whats="${c.projetoId}" data-nome="${c.etiqueta}" data-url="${c.whatsappGrupoUrl ?? ''}" title="Link do grupo de WhatsApp" aria-label="Definir link do grupo">${icone('link')}</button>` : ''}</div></header>
  <div class="kpis cli-det__kpis"><div class="kpi card glass"><small>Processos ativos</small><b>${ativos.length}</b></div><div class="kpi card glass"><small>Arquivados</small><b>${arq}</b></div>
    <div class="kpi card glass ${c.prazosAbertos ? 'alerta' : ''}"><small>Prazos abertos</small><b>${c.prazosAbertos}</b></div><div class="kpi card glass"><small>Registros no Astrea</small><b>${c.registros}</b></div></div>
  ${fases.size ? html`<div class="cli-fases">${[...fases].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => html`<span class="cli-fase"><i style="width:${Math.max(6, Math.round((n / ativos.length) * 100))}%"></i><span>${f}</span><b>${n}</b></span>`)}</div>` : ''}
  <div class="cli-det__filtros"><label class="proj-filtros__busca">${icone('search')}<input class="input" type="search" data-q-proc placeholder="Buscar neste cliente: número, título, ação, vara…" aria-label="Buscar processos do cliente"></label>
    <div class="cli-seg" role="group" aria-label="Situação"><button type="button" class="is-on" data-sit="ativos">Ativos</button><button type="button" class="" data-sit="todos">Todos</button><button type="button" class="" data-sit="arquivados">Arquivados</button></div></div>
  <div class="cli-procs__tipos">${r.tipos.slice(0, 10).map((t) => html`<button type="button" class="chip" data-tipo-proc="${t.tipo}" aria-pressed="false">${t.tipo} <b>${t.n}</b></button>`)}</div>
  <p class="dica" data-contagem></p>
  ${r.processos.length ? html`<ul class="cli-procs-lista">${r.processos.map((x) => html`<li class="cli-proc ${x.arquivado ? 'is-arq' : ''}" data-arq="${x.arquivado ? 1 : 0}" data-tipo-linha="${x.acao || x.tipo || 'Sem tipo'}" data-txt="${norm(`${x.numero} ${x.titulo} ${x.acao} ${x.tipo} ${x.vara} ${x.foro} ${x.fase} ${x.responsavel}`)}">
      <div class="cli-proc__main"><b>${x.titulo ?? 'Sem título'}</b><small><button type="button" class="link mono-sm" data-copiar="${x.numero ?? ''}" title="Copiar número">${x.numero ?? 'sem número'}</button>${x.papelCliente ? ` · cliente ${x.papelCliente.toLowerCase()}` : ''}${x.vara ? ` · ${x.vara}` : ''}${x.foro ? ` · ${x.foro}` : ''}</small></div>
      <span class="selo ${x.arquivado ? '' : 'info'}">${x.acao || x.tipo || 'Sem tipo'}</span>
      <span class="cli-proc__fase">${x.fase ?? '—'}<small>${x.responsavel ?? ''}${x.ultimoHistorico ? ` · ${String(x.ultimoHistorico).slice(0, 48)}` : ''}</small></span>
      ${x.projetoId ? html`<a class="ibtn ibtn--sm" href="#/projetos/${x.projetoId}/processos" title="Abrir no projeto" aria-label="Abrir no projeto">${icone('chevron')}</a>` : html`<span></span>`}</li>`)}</ul>
    ${r.processos.length >= 500 ? html`<p class="dica">Mostrando os 500 primeiros. Use a busca para achar o resto.</p>` : ''}` : html`<p class="dica">Nenhum processo deste cliente na carteira importada.</p>`}`;
}

export default async function clientes({ cliente } = {}) {
  const d = await api.get('/api/clientes');
  const sel = cliente && d.clientes.find((c) => c.etiqueta === cliente) ? cliente : d.clientes[0]?.etiqueta;
  const sem = (l) => html`${l.map((x) => html`<li><div><b>${x.cliente_nome}</b><small>${x.n} registro(s) · ${x.responsavel}${x.equipes.length ? ` · ${x.equipes.join(', ')}` : ''}</small></div></li>`)}`;
  const comPrazo = d.clientes.filter((c) => c.prazosAbertos).length;
  return {
    titulo: 'Clientes',
    html: html`${cabecalho({ titulo: 'Clientes', sub: 'Escolha um cliente à esquerda para ver os processos dele. A busca de cima também acha processo por número.', resumo: [{ rotulo: 'Clientes', valor: d.clientes.length }, { rotulo: 'Com prazo aberto', valor: comPrazo, tom: comPrazo ? 'warn' : '' }, { rotulo: 'Sem etiqueta', valor: d.semEtiqueta?.n ?? 0, tom: 'warn' }] })}
    ${d.clientes.length ? html`<div class="cli-md mt">
      <aside class="cli-lista card glass up"><div class="cli-lista__busca"><label class="proj-filtros__busca">${icone('search')}<input class="input" type="search" data-busca placeholder="Cliente, responsável ou nº do processo" aria-label="Buscar cliente ou processo" autocomplete="off"></label>
          <div class="cli-lista__filtros"><button type="button" class="chip" data-f="prazos" aria-pressed="false">Com prazo</button><button type="button" class="chip" data-f="comprojeto" aria-pressed="false">Com projeto</button><button type="button" class="chip" data-f="semprojeto" aria-pressed="false">Sem projeto</button></div></div>
        <div class="cli-lista__itens" data-itens>${d.clientes.map((c) => itemCliente(c, c.etiqueta === sel))}</div>
        <p class="dica" data-sem-res hidden>Nenhum cliente com esse nome.</p>
        <div data-resultado-processos></div></aside>
      <section class="cli-det card glass up" data-detalhe aria-live="polite"><div class="skel" style="height:320px"></div></section></div>
      <details class="mt"><summary class="link">Registros sem etiqueta, equipes e responsáveis</summary>
      <div class="grid2 mt"><section class="card glass up"><header class="card__head"><div><h2 class="card__title">Sem etiqueta de cliente</h2><p class="card__sub">${d.semEtiqueta?.n ?? 0} registros de ${d.semEtiqueta?.nomes ?? 0} nomes. Etiquete no Astrea para virar projeto.</p></div><input class="input" style="max-width:220px" data-sem placeholder="Nome, título ou número…" aria-label="Buscar registros sem etiqueta"></header><ul class="lista" data-lista-sem></ul></section>
      <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Equipes e responsáveis</h2></div></header><ul class="lista">${d.equipes.map((e) => html`<li><div><b>${e.equipe}</b></div><div class="fim mono-sm">${e.n}</div></li>`)}</ul><h3 class="mini-h">Responsáveis</h3><ul class="lista">${d.pessoas.map((p) => html`<li><div><b>${p.responsavel}</b><small>${p.ativos} ativo(s)</small></div><div class="fim mono-sm">${p.n}</div></li>`)}</ul></section></div></details>`
      : html`<section class="card glass up mt">${vazio('users', 'Carteira ainda não importada', 'Os clientes aparecem aqui depois da importação do Astrea.')}</section>`}`,
    depois(el) {
      if (!d.clientes.length) return;
      const det = $('[data-detalhe]', el); let pedido = 0;
      const filtrarProcessos = () => {
        const q = norm($('[data-q-proc]', det)?.value ?? '').trim(); const sit = $('[data-sit].is-on', det)?.dataset.sit ?? 'ativos';
        const tipo = $('[data-tipo-proc][aria-pressed=true]', det)?.dataset.tipoProc;
        let n = 0; $$('.cli-proc', det).forEach((li) => {
          const ok = (!q || li.dataset.txt.includes(q)) && (sit === 'todos' || (sit === 'ativos' ? li.dataset.arq === '0' : li.dataset.arq === '1')) && (!tipo || li.dataset.tipoLinha === tipo);
          li.hidden = !ok; if (ok) n++;
        });
        const c = $('[data-contagem]', det); if (c) c.textContent = `${n} processo(s) na lista`;
      };
      const abrir = async (etiqueta, empurrar = true) => {
        const c = d.clientes.find((x) => x.etiqueta === etiqueta); if (!c) return;
        $$('.cli-item', el).forEach((b) => { const on = b.dataset.cliente === etiqueta; b.classList.toggle('is-sel', on); b.setAttribute('aria-pressed', String(on)); });
        if (empurrar) history.replaceState(null, '', `#/clientes/${encodeURIComponent(etiqueta)}`);
        const meu = ++pedido; det.innerHTML = '<div class="skel" style="height:320px"></div>';
        try { const r = await api.get(`/api/clientes/processos?${new URLSearchParams({ cliente: etiqueta })}`); if (meu !== pedido) return; det.innerHTML = String(painelDoCliente(c, r)); filtrarProcessos(); if (window.innerWidth < 900) det.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        catch (er) { erroDe(er); }
      };
      abrir(sel, false);
      ouvir(el, 'click', '.cli-item', (b) => abrir(b.dataset.cliente));
      // Setas do teclado percorrem a lista; Enter abre.
      $('[data-itens]', el).addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return; e.preventDefault();
        const vis = $$('.cli-item:not([hidden])', el); const i = vis.indexOf(document.activeElement);
        const prox = vis[Math.max(0, Math.min(vis.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; prox?.focus(); if (prox) abrir(prox.dataset.cliente);
      });
      const filtrosLista = () => {
        const q = norm($('[data-busca]', el).value).trim(); const f = $$('[data-f][aria-pressed=true]', el).map((b) => b.dataset.f);
        let n = 0; $$('.cli-item', el).forEach((b) => { const ok = (!q || b.dataset.busca.includes(q)) && (!f.includes('prazos') || b.dataset.prazos === '1') && (!f.includes('comprojeto') || b.dataset.projeto === '1') && (!f.includes('semprojeto') || b.dataset.projeto === '0'); b.hidden = !ok; if (ok) n++; });
        $('[data-sem-res]', el).hidden = n > 0;
      };
      let tb = 0;
      $('[data-busca]', el).addEventListener('input', (e) => {
        filtrosLista(); clearTimeout(tb);
        const caixa = $('[data-resultado-processos]', el); const q = e.target.value.trim();
        // Número de processo (5+ dígitos) procura em toda a carteira.
        if (q.replace(/\D/g, '').length >= 5) tb = setTimeout(async () => {
          try { const r = await api.get(`/api/clientes/processos?${new URLSearchParams({ q })}`); caixa.innerHTML = String(html`<h3 class="mini-h">Processos com esse número</h3><ul class="lista">${r.processos.slice(0, 8).map((x) => html`<li data-cliente-ir="${x.cliente ?? ''}" style="cursor:pointer"><div><b>${x.titulo ?? '—'}</b><small class="mono-sm">${x.numero} · ${x.cliente ?? 'sem cliente'}</small></div></li>`)}</ul>`); } catch (er) { erroDe(er); }
        }, 300); else caixa.innerHTML = '';
      });
      ouvir(el, 'click', '[data-cliente-ir]', (li) => { if (li.dataset.clienteIr) abrir(li.dataset.clienteIr); });
      ouvir(el, 'click', '[data-f]', (b) => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); filtrosLista(); });
      ouvir(det, 'input', '[data-q-proc]', filtrarProcessos);
      ouvir(det, 'click', '[data-sit]', (b) => { $$('[data-sit]', det).forEach((x) => x.classList.toggle('is-on', x === b)); filtrarProcessos(); });
      ouvir(det, 'click', '[data-tipo-proc]', (b) => { const on = b.getAttribute('aria-pressed') !== 'true'; $$('[data-tipo-proc]', det).forEach((x) => x.setAttribute('aria-pressed', String(on && x === b))); filtrarProcessos(); });
      ouvir(det, 'click', '[data-copiar]', async (b) => { if (!b.dataset.copiar) return; try { await navigator.clipboard.writeText(b.dataset.copiar); toast('Número copiado'); } catch { /* sem permissão de cópia */ } });
      ouvir(det, 'click', '[data-whats]', async (b) => {
        const ok = await formulario({ titulo: `Grupo de WhatsApp · ${b.dataset.nome}`, subtitulo: 'O cliente acessa o grupo pelo botão no portal.', rotulo: 'Salvar link', campos: [{ nome: 'url', rotulo: 'Link do grupo', tipo: 'url', valor: b.dataset.url, placeholder: 'https://chat.whatsapp.com/…' }],
          async enviar(v) { await api.patch(`/api/projetos/${b.dataset.whats}/dados-do-cliente`, { whatsappGrupoUrl: v.url ?? '' }); } });
        if (ok) { toast('Link do grupo salvo'); navegar(); }
      });
      const alvo = $('[data-lista-sem]', el); let t = 0; const buscar = async (q) => { alvo.innerHTML = String(sem(await api.get(`/api/clientes/sem-etiqueta?q=${encodeURIComponent(q)}`))); };
      $('[data-sem]', el).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => buscar(e.target.value.trim()), 250); }); buscar('');
      void ir;
    } };
}
