/** Carteira de clientes, vinda das etiquetas do Astrea. Cada cliente abre o seu projeto. */
import { api } from '../api.js';
import { $, $$, html, icone, ouvir } from '../util.js';
import { pode } from '../estado.js';
import { cabecalho, erroDe, formulario, toast, vazio } from '../ui.js';
import { navegar } from '../shell.js';

const tagDoProcesso = (x) => html`<span class="selo ${x.arquivado ? '' : 'info'}">${x.acao || x.tipo || 'Sem tipo'}</span>`;
const listaDeProcessos = (r, titulo) => html`<section class="cli-procs"><header class="cli-procs__head"><div><h3 class="mini-h">${titulo}</h3>
    <div class="cli-procs__tipos">${r.tipos.slice(0, 8).map((t) => html`<button type="button" class="chip" data-tipo-proc="${t.tipo}">${t.tipo} <b>${t.n}</b></button>`)}</div></div>
    <button type="button" class="btn btn--ghost btn--sm" data-fechar-procs>Fechar</button></header>
  ${r.processos.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Processo</th><th>Tipo</th><th>Cliente / projeto</th><th>Fase</th><th>Responsável</th></tr></thead><tbody>
    ${r.processos.map((x) => html`<tr data-tipo-linha="${x.acao || x.tipo || 'Sem tipo'}" class="${x.arquivado ? 'muted' : ''}"><td><b>${x.titulo ?? '—'}</b><small class="mono-sm">${x.numero ?? 'sem número'}${x.papelCliente ? ` · cliente ${String(x.papelCliente).toLowerCase()}` : ''}</small></td>
      <td>${tagDoProcesso(x)}<small>${x.tipo ?? ''}</small></td>
      <td>${x.cliente ?? '—'}${x.projetoId ? html`<small><a class="link" href="#/projetos/${x.projetoId}/processos">${x.projeto ?? 'abrir projeto'}</a></small>` : ''}</td>
      <td>${x.fase ?? '—'}</td><td>${x.responsavel ?? '—'}</td></tr>`)}</tbody></table></div>${r.processos.length >= 500 ? html`<p class="dica">Mostrando os 500 primeiros. Refine a busca.</p>` : ''}`
    : html`<p class="dica">Nenhum processo encontrado.</p>`}</section>`;

export default async function clientes() {
  const d = await api.get('/api/clientes');
  const linha = (c) => html`<tr data-nome="${c.etiqueta.toLowerCase()}" data-cliente="${c.etiqueta}" class="tr-clicavel" title="Ver os processos de ${c.etiqueta}"><td><b>${c.etiqueta}</b><small>${c.tipo === 'reestruturacao' ? 'Reestruturação' : 'Cível e contencioso'}</small></td><td class="num">${c.processos}</td><td class="num">${c.registros}</td><td class="num">${c.arquivados}</td><td class="num">${c.prazosAbertos || '—'}</td><td>${c.equipes.join(', ') || '—'}</td><td>${c.responsaveis.map((r) => r.responsavel).join(', ') || '—'}</td><td>${c.projetoId ? html`<div class="nx-acts">${c.whatsappGrupoUrl ? html`<a class="btn btn--ghost btn--sm" href="${c.whatsappGrupoUrl}" target="_blank" rel="noopener noreferrer" title="Abrir grupo">${icone('comment')}Abrir</a>` : html`<span class="dica">sem link</span>`}${pode('projeto.escrever') ? html`<button class="btn btn--ghost btn--sm" data-whats="${c.projetoId}" data-nome="${c.etiqueta}" data-url="${c.whatsappGrupoUrl ?? ''}" title="Definir link do grupo">${icone('link')}</button>` : ''}</div>` : '—'}</td></tr>`;
  const sem = (l) => html`${l.map((x) => html`<li><div><b>${x.cliente_nome}</b><small>${x.n} registro(s) · ${x.responsavel}${x.equipes.length ? ` · ${x.equipes.join(', ')}` : ''}</small></div></li>`)}`;
  return { titulo: 'Clientes', html: html`${cabecalho({ titulo: 'Clientes', sub: 'Carteira importada das etiquetas do Astrea.', resumo: [{ rotulo: 'Clientes', valor: d.clientes.length }, { rotulo: 'Sem etiqueta', valor: d.semEtiqueta?.n ?? 0, tom: 'warn' }] })}
    ${d.clientes.length ? html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Clientes etiquetados</h2><p class="card__sub">Clique no cliente para ver todos os processos dele.</p></div>
      <div class="cli-filtros"><label class="proj-filtros__busca">${icone('search')}<input class="input" type="search" data-busca placeholder="Cliente, projeto, ação ou nº do processo" aria-label="Buscar cliente, projeto ou processo" autocomplete="off"></label></div></header>
      <div data-resultado-processos></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cliente</th><th class="num">Processos</th><th class="num">Registros</th><th class="num">Arquivados</th><th class="num">Prazos</th><th>Equipe</th><th>Responsáveis</th><th>Grupo WhatsApp</th></tr></thead><tbody>${d.clientes.map(linha)}</tbody></table></div></section>` : html`<section class="card glass up mt">${vazio('users', 'Carteira ainda não importada', 'Os clientes aparecem aqui depois da importação do Astrea.')}</section>`}
    <div class="grid2 mt"><section class="card glass up"><header class="card__head"><div><h2 class="card__title">Sem etiqueta de cliente</h2><p class="card__sub">${d.semEtiqueta?.n ?? 0} registros de ${d.semEtiqueta?.nomes ?? 0} nomes. Etiquete no Astrea para virar projeto.</p></div><input class="input" style="max-width:220px" data-sem placeholder="Nome, título ou número…" aria-label="Buscar registros sem etiqueta"></header><ul class="lista" data-lista-sem></ul></section>
    <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Equipes e responsáveis</h2></div></header><ul class="lista">${d.equipes.map((e) => html`<li><div><b>${e.equipe}</b></div><div class="fim mono-sm">${e.n}</div></li>`)}</ul><h3 class="mini-h">Responsáveis</h3><ul class="lista">${d.pessoas.map((p) => html`<li><div><b>${p.responsavel}</b><small>${p.ativos} ativo(s)</small></div><div class="fim mono-sm">${p.n}</div></li>`)}</ul></section></div>`,
    depois(el) {
      const caixa = $('[data-resultado-processos]', el);
      const mostrar = async (params, titulo) => {
        try { const r = await api.get(`/api/clientes/processos?${new URLSearchParams(params)}`); caixa.innerHTML = String(listaDeProcessos(r, titulo)); caixa.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (er) { erroDe(er); }
      };
      let tb = 0;
      $('[data-busca]', el)?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        $$('tr[data-nome]', el).forEach((t) => { t.hidden = q && !t.dataset.nome.includes(q); });
        clearTimeout(tb);
        // Com 3 letras ou um pedaço do número, procura também nos processos e projetos.
        if (q.length >= 3) tb = setTimeout(() => mostrar({ q }, `Processos para "${e.target.value.trim()}"`), 300); else caixa.innerHTML = '';
      });
      ouvir(el, 'click', 'tr[data-cliente]', (tr, ev) => { if (ev.target.closest('a, button')) return; $$('tr[data-cliente]', el).forEach((t) => t.classList.toggle('is-sel', t === tr)); mostrar({ cliente: tr.dataset.cliente }, `Processos de ${tr.dataset.cliente}`); });
      ouvir(el, 'click', '[data-fechar-procs]', () => { caixa.innerHTML = ''; $$('tr.is-sel', el).forEach((t) => t.classList.remove('is-sel')); });
      ouvir(el, 'click', '[data-tipo-proc]', (b) => {
        const ativo = b.getAttribute('aria-pressed') === 'true';
        $$('[data-tipo-proc]', caixa).forEach((x) => x.setAttribute('aria-pressed', String(!ativo && x === b)));
        $$('tr[data-tipo-linha]', caixa).forEach((t) => { t.hidden = !ativo && t.dataset.tipoLinha !== b.dataset.tipoProc; });
      });
      const alvo = $('[data-lista-sem]', el); let t = 0; const buscar = async (q) => { alvo.innerHTML = String(sem(await api.get(`/api/clientes/sem-etiqueta?q=${encodeURIComponent(q)}`))); };
      $('[data-sem]', el).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => buscar(e.target.value.trim()), 250); }); buscar('');
      ouvir(el, 'click', '[data-whats]', async (b) => {
        const ok = await formulario({ titulo: `Grupo de WhatsApp · ${b.dataset.nome}`, subtitulo: 'O cliente acessa o grupo pelo botão no portal.', rotulo: 'Salvar link', campos: [{ nome: 'url', rotulo: 'Link do grupo', tipo: 'url', valor: b.dataset.url, placeholder: 'https://chat.whatsapp.com/...', dica: 'Deixe em branco para remover.' }],
          async enviar(v) { await api.patch(`/api/projetos/${b.dataset.whats}/dados-do-cliente`, { whatsappGrupoUrl: v.url ?? '' }); } });
        if (ok) { toast('Link do grupo salvo'); navegar(); }
      });
      void erroDe;
    } };
}
