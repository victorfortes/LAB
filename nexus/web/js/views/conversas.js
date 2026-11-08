/** Caixa de conversas do escritório: um fio por cliente, sem misturar projetos. */
import { api } from '../api.js';
import { $, html, ouvir, relativo } from '../util.js';
import { cabecalho, erroDe, vazio } from '../ui.js';
import { aoSair } from '../shell.js';

export default async function conversas({ id }) {
  const lista = await api.get('/api/conversas'); let atual = id ?? lista[0]?.id ?? null;
  const item = (c) => html`<button type="button" class="conv-l" data-c="${c.id}" aria-current="${c.id === atual}"><div><b>${c.nome}</b><small>${c.ultima ?? 'Sem mensagens'}</small></div>${c.nao_lidas ? html`<span class="conv-n">${c.nao_lidas}</span>` : ''}</button>`;
  return { titulo: 'Conversas', html: html`${cabecalho({ titulo: 'Conversas', sub: 'Atualiza sozinha a cada 5 segundos.' })}<div class="conversas mt"><section class="card glass" data-lista>${lista.length ? lista.map(item) : vazio('comment', 'Nenhum portal ativo', 'As conversas aparecem quando o cliente tem portal.')}</section><section class="card glass"><div class="chat conv-chat" data-fio aria-live="polite"></div><form class="chat-in" data-env><input class="input" name="t" autocomplete="off" aria-label="Mensagem" placeholder="Escreva para o cliente…" required><button class="btn btn--accent">Enviar</button></form></section></div>`,
    depois(el) { const fio = $('[data-fio]', el); let assinatura = '';
      const abrir = async (forcar) => { if (!atual) return; const m = await api.get(`/api/projetos/${atual}/mensagens`); const a = `${atual}:${m[0]?.id}:${m.filter((x) => x.lida_em).length}`; if (a === assinatura && !forcar) return; assinatura = a; fio.innerHTML = String(html`${[...m].reverse().map((x) => html`<div class="msg ${x.lado === 'nga' ? 'meu' : ''}">${x.texto}<small>${x.autor ?? ''} · ${relativo(x.criado_em)}${x.lado === 'nga' ? html` <span class="visto">${x.lida_em ? '✓✓ lida' : '✓ enviada'}</span>` : ''}</small></div>`)}`); fio.scrollTop = fio.scrollHeight; if (m.some((x) => x.lado === 'cliente' && !x.lida_em)) { await api.post(`/api/projetos/${atual}/mensagens/lidas`, {}); const b = el.querySelector(`[data-c="${atual}"] .conv-n`); b?.remove(); } };
      ouvir(el, 'click', '[data-c]', (b) => { atual = b.dataset.c; el.querySelectorAll('[data-c]').forEach((x) => x.setAttribute('aria-current', x === b)); abrir(true); });
      $('[data-env]', el).addEventListener('submit', async (e) => { e.preventDefault(); if (!atual) return; try { await api.post(`/api/projetos/${atual}/mensagens`, { texto: e.target.t.value }); e.target.reset(); abrir(true); } catch (x) { erroDe(x); } });
      abrir(true); const t = setInterval(() => { if (document.visibilityState === 'visible') abrir().catch(() => {}); }, 5000); aoSair(() => clearInterval(t)); } };
}
