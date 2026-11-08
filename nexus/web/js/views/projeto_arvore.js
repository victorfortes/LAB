/** Árvore de tarefas dentro de "Fase do procedimento": cada fase tem suas tarefas e subtarefas. */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { $, dataBR, html, icone, ouvir } from '../util.js';
import { erroDe, toast } from '../ui.js';

export async function ligarArvore(ctx, alvo) {
  const fases = ctx.h.fasesDisponiveis ?? []; if (!fases.length || !pode('tarefa.ler')) return;
  let sel = ctx.h.fase ?? fases[0].id; const escreve = pode('tarefa.escrever') && ctx.h.situacao !== 'encerrado';
  const desenhar = async () => {
    const { tarefas } = await api.get(`/api/tarefas?projeto=${ctx.id}`);
    const daFase = tarefas.filter((t) => t.fase === sel); const filhos = (id) => daFase.filter((t) => (t.paiId ?? t.tarefaPaiId ?? null) === id);
    const cont = (f) => { const l = tarefas.filter((t) => t.fase === f); return l.length ? `${l.filter((t) => t.status === 'concluida').length}/${l.length}` : ''; };
    const no = (t) => html`<li class="${t.status === 'concluida' ? 'feita' : ''}"><div class="no">${escreve ? html`<input type="checkbox" data-feita="${t.id}" aria-label="Concluir ${t.titulo}" ${t.status === 'concluida' ? 'checked' : ''}>` : ''}<span>${t.titulo}</span><small>${[t.responsavel, t.prazo ? dataBR(t.prazo) : null].filter(Boolean).join(' · ')}</small>${escreve ? html`<button type="button" class="ibtn ibtn--sm fim" data-sub="${t.id}" aria-label="Adicionar subtarefa a ${t.titulo}" title="Subtarefa">${icone('plus')}</button>` : ''}</div>${filhos(t.id).length ? html`<ul>${filhos(t.id).map(no)}</ul>` : ''}</li>`;
    alvo.innerHTML = String(html`<div class="arvore"><div class="pilulas arvore__fases" role="tablist" aria-label="Tarefas por fase">${fases.map((f) => html`<button type="button" data-af="${f.id}" aria-pressed="${f.id === sel}">${f.nome}${cont(f.id) ? ` · ${cont(f.id)}` : ''}</button>`)}</div>
      ${filhos(null).length ? html`<ul class="mt">${filhos(null).map(no)}</ul>` : html`<p class="dica mt">Nenhuma tarefa nesta fase.</p>`}
      ${escreve ? html`<form data-nova-t><input class="input" name="t" aria-label="Nova tarefa nesta fase" placeholder="Nova tarefa nesta fase…" autocomplete="off" required><button class="btn btn--ghost">Adicionar</button></form>` : ''}</div>`);
    $('[data-nova-t]', alvo)?.addEventListener('submit', async (e) => { e.preventDefault(); try { await api.post(`/api/projetos/${ctx.id}/tarefas`, { titulo: e.target.t.value, fase: sel }); await desenhar(); } catch (x) { erroDe(x); } });
  };
  ouvir(alvo, 'click', '[data-af]', (b) => { sel = b.dataset.af; desenhar(); });
  ouvir(alvo, 'change', '[data-feita]', async (c) => { try { await api.patch(`/api/tarefas/${c.dataset.feita}`, { status: c.checked ? 'concluida' : 'a_fazer' }); await desenhar(); } catch (x) { c.checked = !c.checked; erroDe(x); } });
  ouvir(alvo, 'click', '[data-sub]', async (b) => { const t = prompt('Subtarefa:'); if (!t?.trim()) return; try { await api.post(`/api/projetos/${ctx.id}/tarefas`, { titulo: t.trim(), fase: sel, paiId: b.dataset.sub }); toast('Subtarefa criada'); await desenhar(); } catch (x) { erroDe(x); } });
  await desenhar();
}
