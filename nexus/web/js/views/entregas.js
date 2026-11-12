/** Acompanhamento das entregas do NGA NEXUS. O servidor só responde ao dono. */
import { api } from '../api.js';
import { html } from '../util.js';
import { cabecalho } from '../ui.js';
const ENTREGUES = new Set(['relatorios', 'portal', 'bi_prazos', 'projetos', 'tarefas', 'painel']);
export default async function entregas() {
  const { modulos } = await api.get('/api/lab/entregas'); const lista = [{ id: 'bi_prazos', nome: 'BI de Prazos', descricao: 'Painel de prazos do escritório, agora dentro do Nexus, lendo os prazos reais da carteira.', pendencia: null }, ...modulos];
  const ok = lista.filter((m) => ENTREGUES.has(m.id)); const beta = lista.filter((m) => !ENTREGUES.has(m.id) && m.estado !== 'nao_construido'); const nao = lista.filter((m) => m.estado === 'nao_construido');
  const card = (m, tom, rot) => html`<article class="card glass"><header class="card__head"><h2 class="card__title">${m.nome}</h2><span class="selo ${tom}">${rot}</span></header><p class="dica">${m.descricao}</p>${m.pendencia && tom !== 'ok' ? html`<small class="muted">${m.pendencia}</small>` : ''}</article>`;
  return { titulo: 'Entregas NEXUS', html: html`${cabecalho({ titulo: 'Entregas do NGA NEXUS', sub: 'Visível apenas no seu acesso.', resumo: [{ rotulo: 'Entregues', valor: ok.length }, { rotulo: 'Em beta', valor: beta.length }, { rotulo: 'Não construídos', valor: nao.length }] })}<h2 class="mini-h mt">Entregue</h2><div class="entrega-grupo">${ok.map((m) => card(m, 'ok', 'Entregue'))}</div><h2 class="mini-h mt">Em beta</h2><div class="entrega-grupo">${beta.map((m) => card(m, 'aviso', 'Beta'))}</div><h2 class="mini-h mt">Não construído</h2><div class="entrega-grupo">${nao.map((m) => card(m, '', 'Não iniciado'))}</div>` };
}
