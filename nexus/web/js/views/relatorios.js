/** O gerador original é a ferramenta de relatórios do LAB. */
import { secaoProntidao } from './relatorio_mensal.js';
import { secaoGeradorGeral } from './gerador_lab.js';
import { api } from '../api.js';
import { estado } from '../estado.js';
import { html, ouvir } from '../util.js';
import { cabecalho, vazio } from '../ui.js';
import { ir } from '../shell.js';

export default async function relatorios() {
  const pront = await secaoProntidao();
  const lista = (estado.projetos.length ? estado.projetos : (estado.projetos = await api.get('/api/projetos'))).filter((p) => p.situacao !== 'encerrado');
  const gl = await secaoGeradorGeral(lista);
  return {
    titulo:'Relatórios',
    html:html`${cabecalho({ titulo:'Gerador de relatórios',sub:'O relatório de atuação jurídica do Gerador, agora gerado dentro do LAB com os dados do LAB (ou com o PDF do Astrea) e com agenda por cliente.',acoes:html`<a class="btn btn--ghost" href="/gerador/" target="_blank" rel="noopener">Gerador original (executivo, narrativo, estúdio) ↗</a>` })}${gl.html}${pront.html}
      <section class="card glass mt"><header class="card__head"><div><h2 class="card__title">Relatórios por projeto</h2><p class="card__sub">Selecione o projeto para vincular o PDF gerado e escolher sua publicação.</p></div></header>
        ${lista.length ? html`<ul class="lista">${lista.map((p) => html`<li><div><b>${p.nome}</b><small>${p.rotuloDoTipo}</small></div><button class="btn btn--ghost" data-relatorios="${p.id}">Vincular e publicar PDF</button></li>`)}</ul>` : vazio('folder','Nenhum projeto ativo','Crie o projeto para guardar os relatórios do seu cliente.')}</section>`,
    depois:(el) => { gl.depois(el); ouvir(el,'click','[data-relatorios]',(b) => ir(`projetos/${b.dataset.relatorios}/relatorios`)); },
  };
}
