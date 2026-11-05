/** Caderno de pesquisa privado do projeto. Não apresenta referências inventadas. */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { html, ouvir } from '../util.js';
import { formulario, toast, vazio } from '../ui.js';

export async function abaPesquisa(ctx) {
  const base = `/api/projetos/${ctx.id}`;
  const [notas, docs] = await Promise.all([api.get(`${base}/playbook/notas`), api.get(`${base}/documentos`)]);
  const pesquisa = notas.find((n) => n.chave === 'pesquisa.caderno') ?? {};
  const documentos = Array.isArray(docs) ? docs : docs.documentos ?? [];
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Pesquisa do projeto</h2><p class="card__sub">Perguntas, fontes e conclusões vinculadas a ${ctx.h.nome}.</p></div>${pode('projeto.escrever') ? html`<button class="btn btn--accent" data-caderno>Editar caderno</button>` : ''}</header>
      <h3 class="mini-h">Questão e fundamentos encontrados</h3><p class="dica" style="white-space:pre-wrap">${pesquisa.resumo ?? 'Registre a questão que precisa pesquisar, as fontes consultadas e suas conclusões.'}</p>
      <h3 class="mini-h">Pontos de atenção e referências</h3><p class="dica" style="white-space:pre-wrap">${pesquisa.pontosAtencao ?? 'Inclua links oficiais e o que ainda precisa de conferência.'}</p>
      <form class="chat-in" data-busca-pesquisa><input class="input" name="consulta" placeholder="Tema, expressão ou número do processo" aria-label="Pesquisa em fontes oficiais" required><button class="btn btn--ghost" type="submit">Pesquisar</button></form>
      <div class="project-tools mt" data-fontes></div><div class="mt" data-resultados></div></section>
      <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Documentos deste projeto</h2><p class="card__sub">Acervo para subsidiar a pesquisa.</p></div><button class="link" data-documentos>Abrir documentos →</button></header>
        ${documentos.length ? html`<ul class="lista">${documentos.map((d) => html`<li><div><b>${d.titulo}</b><small>${d.categoria ?? ''}</small></div></li>`)}</ul>` : vazio('doc','Sem documentos','Os documentos enviados a este projeto aparecerão aqui.')}</section>`,
    depois(el) {
      ouvir(el, 'click', '[data-documentos]', () => ctx.irParaAba('documentos'));
      ouvir(el, 'click', '[data-caderno]', async () => {
        const ok = await formulario({ titulo: 'Caderno de pesquisa', subtitulo: ctx.h.nome, campos: [
          { nome:'resumo',rotulo:'Questão, fundamentos e conclusões',tipo:'textarea',valor:pesquisa.resumo },
          { nome:'pontosAtencao',rotulo:'Pontos de atenção e links das fontes',tipo:'textarea',valor:pesquisa.pontosAtencao }],
          enviar: async (v) => { await api.put(`${base}/playbook/notas`, { chave:'pesquisa.caderno',resumo:v.resumo ?? '',pontosAtencao:v.pontosAtencao ?? '' }); toast('Pesquisa salva neste projeto'); },
        }); if (ok) ctx.recarregar();
      });
      el.querySelector('[data-busca-pesquisa]').addEventListener('submit', async (e) => {
        e.preventDefault(); const q = e.target.elements.consulta.value.trim(); if (!q) return;
        const alvo = el.querySelector('[data-resultados]'); alvo.textContent = 'Pesquisando no acervo deste projeto…';
        try { const r = await api.get(`${base}/pesquisa?q=${encodeURIComponent(q)}`); if (el.isConnected && ctx.ativo) alvo.innerHTML = String(html`<h3 class="mini-h">Evidências deste projeto</h3>${r.documentos.length ? html`<ul class="lista">${r.documentos.map((d) => html`<li><div><b>${d.titulo}</b><small>${d.origem === 'portal_cliente' ? 'Cliente' : 'Escritório'}</small><p class="dica">${d.trecho}</p></div></li>`)}</ul>` : html`<p class="dica">Nenhum trecho encontrado.</p>`}${r.achados.map((a) => html`<p class="dica"><b>${a.titulo}</b> · ${a.documento}<br>${a.descricao}</p>`)}`); } catch (er) { alvo.textContent = er.message; }
        const fontes = [['STJ','site:stj.jus.br'],['STF','site:stf.jus.br'],['Legislação federal','site:planalto.gov.br']];
        el.querySelector('[data-fontes]').innerHTML = String(html`${fontes.map(([nome,site]) => html`<a class="btn btn--ghost" target="_blank" rel="noopener noreferrer" href="${'https://www.google.com/search?q='+encodeURIComponent(site+' '+q)}">${nome} ↗</a>`)}`);
      });
    },
  };
}
