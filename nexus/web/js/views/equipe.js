/** Equipe do escritório e em quais projetos cada pessoa atua. */
import { api } from '../api.js';
import { estado, ROTULO_DO_PAPEL } from '../estado.js';
import { avatar, html, matiz } from '../util.js';
import { cabecalho, vazio } from '../ui.js';

export default async function equipe() {
  const [pessoas, projetos, tarefas] = await Promise.all([api.get('/api/escritorio/equipe'), api.get('/api/projetos'), api.get('/api/tarefas')]);
  estado.projetos = projetos;
  const doUsuario = (u) => projetos.filter((p) => p.situacao !== 'encerrado' && p.equipe?.some((e) => e.nome === u.nome));
  const abertas = (u) => tarefas.tarefas.filter((t) => t.responsavelId === u.id && t.status !== 'concluida').length;
  return {
    titulo: 'Equipe',
    html: html`${cabecalho({ titulo: 'Equipe', sub: `${pessoas.length} pessoa(s) no escritório`, resumo: [{ rotulo: 'Pessoas', valor: pessoas.length }, { rotulo: 'Tarefas abertas', valor: tarefas.resumo.abertas }] })}
      <div class="grid3 mt">${pessoas.length ? pessoas.map((u) => html`<section class="card glass up tool"><div class="tool__top">${avatar(u.nome, 'lg')}<div><h3 style="font-size:19px">${u.nome}</h3><span class="dica">${ROTULO_DO_PAPEL[u.papel] ?? u.papel}</span></div></div>
        <p class="mono-sm">${u.email}</p><p class="dica">${abertas(u)} tarefa(s) aberta(s)</p>
        <div class="flex">${doUsuario(u).length ? doUsuario(u).map((p) => html`<a class="pchip hue--${matiz(p.id)}" href="#/projetos/${p.id}"><i></i><span class="tk-ellip">${p.nome}</span></a>`) : html`<span class="dica">Sem projetos ativos</span>`}</div></section>`)
        : html`<section class="card glass up" style="grid-column:1/-1">${vazio('users', 'Sem pessoas', 'Nenhum usuário do escritório encontrado.')}</section>`}</div>`,
  };
}
