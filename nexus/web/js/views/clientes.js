/** Carteira de clientes, vinda das etiquetas do Astrea. Cada cliente abre o seu projeto. */
import { api } from '../api.js';
import { $, $$, html, icone, ouvir } from '../util.js';
import { pode } from '../estado.js';
import { cabecalho, erroDe, formulario, toast, vazio } from '../ui.js';
import { navegar } from '../shell.js';

export default async function clientes() {
  const d = await api.get('/api/clientes');
  const linha = (c) => html`<tr data-nome="${c.etiqueta.toLowerCase()}"><td><a class="link" href="#/projetos/${c.projetoId}/processos">${c.etiqueta}</a><small>${c.tipo === 'reestruturacao' ? 'Reestruturação' : 'Cível e contencioso'}</small></td><td class="num">${c.processos}</td><td class="num">${c.registros}</td><td class="num">${c.arquivados}</td><td class="num">${c.prazosAbertos || '—'}</td><td>${c.equipes.join(', ') || '—'}</td><td>${c.responsaveis.map((r) => r.responsavel).join(', ') || '—'}</td><td>${c.projetoId ? html`<div class="nx-acts">${c.whatsappGrupoUrl ? html`<a class="btn btn--ghost btn--sm" href="${c.whatsappGrupoUrl}" target="_blank" rel="noopener noreferrer" title="Abrir grupo">${icone('comment')}Abrir</a>` : html`<span class="dica">sem link</span>`}${pode('projeto.escrever') ? html`<button class="btn btn--ghost btn--sm" data-whats="${c.projetoId}" data-nome="${c.etiqueta}" data-url="${c.whatsappGrupoUrl ?? ''}" title="Definir link do grupo">${icone('link')}</button>` : ''}</div>` : '—'}</td></tr>`;
  const sem = (l) => html`${l.map((x) => html`<li><div><b>${x.cliente_nome}</b><small>${x.n} registro(s) · ${x.responsavel}${x.equipes.length ? ` · ${x.equipes.join(', ')}` : ''}</small></div></li>`)}`;
  return { titulo: 'Clientes', html: html`${cabecalho({ titulo: 'Clientes', sub: 'Carteira importada das etiquetas do Astrea.', resumo: [{ rotulo: 'Clientes', valor: d.clientes.length }, { rotulo: 'Sem etiqueta', valor: d.semEtiqueta?.n ?? 0, tom: 'warn' }] })}
    ${d.clientes.length ? html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Clientes etiquetados</h2></div><input class="input" style="max-width:280px" data-busca placeholder="Buscar cliente…" aria-label="Buscar cliente"></header><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cliente</th><th class="num">Processos</th><th class="num">Registros</th><th class="num">Arquivados</th><th class="num">Prazos</th><th>Equipe</th><th>Responsáveis</th><th>Grupo WhatsApp</th></tr></thead><tbody>${d.clientes.map(linha)}</tbody></table></div></section>` : html`<section class="card glass up mt">${vazio('users', 'Carteira ainda não importada', 'Os clientes aparecem aqui depois da importação do Astrea.')}</section>`}
    <div class="grid2 mt"><section class="card glass up"><header class="card__head"><div><h2 class="card__title">Sem etiqueta de cliente</h2><p class="card__sub">${d.semEtiqueta?.n ?? 0} registros de ${d.semEtiqueta?.nomes ?? 0} nomes. Etiquete no Astrea para virar projeto.</p></div><input class="input" style="max-width:220px" data-sem placeholder="Nome, título ou número…" aria-label="Buscar registros sem etiqueta"></header><ul class="lista" data-lista-sem></ul></section>
    <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Equipes e responsáveis</h2></div></header><ul class="lista">${d.equipes.map((e) => html`<li><div><b>${e.equipe}</b></div><div class="fim mono-sm">${e.n}</div></li>`)}</ul><h3 class="mini-h">Responsáveis</h3><ul class="lista">${d.pessoas.map((p) => html`<li><div><b>${p.responsavel}</b><small>${p.ativos} ativo(s)</small></div><div class="fim mono-sm">${p.n}</div></li>`)}</ul></section></div>`,
    depois(el) {
      $('[data-busca]', el)?.addEventListener('input', (e) => { const q = e.target.value.toLowerCase().trim(); $$('tr[data-nome]', el).forEach((t) => { t.hidden = q && !t.dataset.nome.includes(q); }); });
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
