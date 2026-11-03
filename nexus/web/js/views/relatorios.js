/** Relatórios: a porta de entrada leva ao projeto, onde o relatório é gerado com os números dele. */
import { api } from '../api.js';
import { estado } from '../estado.js';
import { html, icone, matiz, ouvir } from '../util.js';
import { cabecalho, vazio } from '../ui.js';
import { ir } from '../shell.js';

export default async function relatorios() {
  const lista = (estado.projetos.length ? estado.projetos : (estado.projetos = await api.get('/api/projetos'))).filter((p) => p.situacao !== 'encerrado');
  return {
    titulo: 'Relatórios',
    html: html`${cabecalho({ titulo: 'Relatórios', sub: 'PDFs com números do banco. Cada um termina dizendo o que não afirma, e só vai ao cliente quando você publica.' })}
      <div class="grid3 mt">${lista.length ? lista.map((p) => html`<section class="card glass up tool hue--${matiz(p.id)}"><div class="tool__top"><span class="tool__ico">${icone('chart')}</span><div><h3>${p.nome}</h3><span class="dica">${p.faseAtual?.nome ?? p.rotuloDoTipo}</span></div></div>
        <div class="tool__acts"><button type="button" class="btn btn--accent" data-gerar="${p.id}">Gerar relatório</button></div></section>`)
        : html`<section class="card glass up" style="grid-column:1/-1">${vazio('folder', 'Nenhum projeto ativo', 'Os relatórios são gerados por projeto.')}</section>`}</div>`,
    depois: (el) => ouvir(el, 'click', '[data-gerar]', (b) => ir(`projetos/${b.dataset.gerar}/relatorios`)),
  };
}
