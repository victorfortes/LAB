/** O gerador original é a ferramenta de relatórios do LAB. */
import { secaoProntidao } from './relatorio_mensal.js';
import { api } from '../api.js';
import { estado } from '../estado.js';
import { html, ouvir } from '../util.js';
import { cabecalho, vazio } from '../ui.js';
import { ir } from '../shell.js';

export default async function relatorios() {
  const pront = await secaoProntidao();
  const lista = (estado.projetos.length ? estado.projetos : (estado.projetos = await api.get('/api/projetos'))).filter((p) => p.situacao !== 'encerrado');
  return {
    titulo:'Relatórios',
    html:html`${cabecalho({ titulo:'Gerador de relatórios',sub:'Gerador original NGA integrado ao LAB. Gere o PDF e vincule-o ao projeto para publicar no portal.',acoes:html`<a class="btn btn--accent" href="/gerador/" target="_blank" rel="noopener">Abrir gerador em nova aba ↗</a>` })}${pront.html}
      <section class="card glass mt"><header class="card__head"><div><h2 class="card__title">Gerador original NGA</h2><p class="card__sub">A ferramenta completa abre em uma nova aba, com seus modelos, documentos e exportação de PDFs.</p></div></header><a class="btn btn--accent" href="/gerador/" target="_blank" rel="noopener">Abrir gerador de relatórios ↗</a></section>
      <section class="card glass mt"><header class="card__head"><div><h2 class="card__title">Relatórios por projeto</h2><p class="card__sub">Selecione o projeto para vincular o PDF gerado e escolher sua publicação.</p></div></header>
        ${lista.length ? html`<ul class="lista">${lista.map((p) => html`<li><div><b>${p.nome}</b><small>${p.rotuloDoTipo}</small></div><button class="btn btn--ghost" data-relatorios="${p.id}">Vincular e publicar PDF</button></li>`)}</ul>` : vazio('folder','Nenhum projeto ativo','Crie o projeto para guardar os relatórios do seu cliente.')}</section>`,
    depois:(el) => ouvir(el,'click','[data-relatorios]',(b) => ir(`projetos/${b.dataset.relatorios}/relatorios`)),
  };
}
