/**
 * Reuniões do projeto com o controle da pauta: a pauta é escrita no convite (Calendário → Nova reunião) e,
 * aqui, cada item é marcado como tratado, com a decisão tomada. Ao fim, a pauta vira ata com um clique.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, html, icone, ouvir } from '../util.js';
import { erroDe, toast, vazio } from '../ui.js';
import { abaAtas } from './projeto_atas.js';
import { novoEvento } from './calendario.js';

const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function cartao(e, edita) {
  const pauta = e.pauta ?? []; const feitos = pauta.filter((p) => p.feito).length;
  const passou = new Date(e.fim) < new Date(); const agora = new Date(e.inicio) <= new Date() && !passou;
  const total = pauta.reduce((s, p) => s + (p.minutos ?? 0), 0);
  return html`<article class="card glass reuniao ${agora ? 'reuniao--agora' : ''}" data-reuniao="${e.id}">
    <header class="reuniao__head"><div class="reuniao__data"><b>${dataBR(e.inicio).slice(0, 5)}</b><small>${hora(e.inicio)}</small></div>
      <div class="grow"><h3>${e.titulo}</h3><small>${agora ? 'acontecendo agora' : passou ? 'realizada' : 'agendada'} · ${pauta.length} item(ns) de pauta${total ? ` · ${total} min` : ''}${e.convidados?.length ? ` · ${e.convidados.length} convidado(s)` : ''}</small></div>
      ${pauta.length ? html`<div class="reuniao__prog" style="--p:${Math.round((feitos / pauta.length) * 100)}"><span>${feitos}/${pauta.length}</span></div>` : ''}
      <div class="nx-acts">${e.meet_url ? html`<a class="btn btn--accent btn--sm" href="${e.meet_url}" target="_blank" rel="noopener noreferrer">${icone('video')}Meet</a>` : ''}</div></header>
    ${pauta.length ? html`<ol class="reuniao__pauta">${pauta.map((p, i) => html`<li class="${p.feito ? 'feito' : ''}">
        <label class="reuniao__check"><input type="checkbox" data-feito="${i}" ${p.feito ? 'checked' : ''} ${edita ? '' : 'disabled'}><span>${p.texto}</span></label>
        <small>${p.responsavel ?? ''}${p.minutos ? ` · ${p.minutos} min` : ''}</small>
        ${edita ? html`<input class="input input--sm" data-decisao="${i}" value="${p.decisao ?? ''}" placeholder="Decisão ou encaminhamento (opcional)">` : p.decisao ? html`<small class="pauta-decisao">Decisão: ${p.decisao}</small>` : ''}</li>`)}</ol>
      ${edita ? html`<div class="nx-acts mt"><button class="btn btn--ghost btn--sm" data-item-pauta>${icone('plus')}Item de pauta</button><button class="btn btn--ghost btn--sm" data-salvar-pauta>Salvar decisões</button>${passou || agora ? html`<button class="btn btn--accent btn--sm" data-gerar-ata>${icone('doc')}Gerar ata desta reunião</button>` : ''}</div>` : ''}`
      : html`<p class="dica">Sem pauta. ${edita ? html`<button class="link" data-item-pauta>Adicionar item</button>` : ''}</p>`}</article>`;
}

export async function abaReunioesEAtas(ctx) {
  const edita = pode('tarefa.escrever');
  const [eventos, atas] = await Promise.all([api.get(`/api/google/eventos?projetoId=${ctx.id}`).catch(() => []), abaAtas(ctx)]);
  const agora = Date.now();
  const proximas = eventos.filter((e) => new Date(e.fim).getTime() >= agora).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const passadas = eventos.filter((e) => new Date(e.fim).getTime() < agora).sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 6);
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Reuniões e pauta</h2><p class="card__sub">A pauta vai no convite. Aqui você marca o que foi tratado, registra as decisões e gera a ata.</p></div>
        ${edita ? html`<button class="btn btn--accent" data-nova-reuniao>${icone('plus')}Nova reunião com pauta</button>` : ''}</header>
      ${proximas.length || passadas.length ? html`${proximas.length ? html`<h3 class="mini-h">Próximas</h3><div class="reunioes">${proximas.map((e) => cartao(e, edita))}</div>` : ''}
        ${passadas.length ? html`<h3 class="mini-h mt">Realizadas</h3><div class="reunioes">${passadas.map((e) => cartao(e, edita))}</div>` : ''}`
        : vazio('calendar', 'Nenhuma reunião marcada', 'Marque a reunião com a pauta: o convite chega para a equipe e para o cliente com os itens que serão tratados.')}</section>
      <div class="mt">${atas.html}</div>`,
    depois(el) {
      atas.depois?.(el);
      const ler = (card) => { const e = eventos.find((x) => x.id === card.dataset.reuniao); return (e.pauta ?? []).map((p, i) => ({ ...p, feito: card.querySelector(`[data-feito="${i}"]`)?.checked ?? p.feito, decisao: card.querySelector(`[data-decisao="${i}"]`)?.value.trim() || undefined })); };
      const salvar = async (card, pauta, aviso = true) => {
        try { const r = await api.put(`/api/google/eventos/${card.dataset.reuniao}/pauta`, { pauta }); eventos.find((x) => x.id === card.dataset.reuniao).pauta = pauta; if (aviso) toast(r.google === 'atualizado' ? 'Pauta salva e convite atualizado' : r.google.startsWith?.('não') ? `Pauta salva. ${r.google}` : 'Pauta salva'); return true; }
        catch (e) { erroDe(e); return false; }
      };
      ouvir(el, 'click', '[data-nova-reuniao]', async () => { await novoEvento(new Date().toLocaleDateString('sv-SE'), null, ctx.id); ctx.recarregar(); });
      ouvir(el, 'change', '[data-feito]', async (c) => { const card = c.closest('[data-reuniao]'); c.closest('li').classList.toggle('feito', c.checked); await salvar(card, ler(card), false); });
      ouvir(el, 'click', '[data-salvar-pauta]', (b) => { const card = b.closest('[data-reuniao]'); salvar(card, ler(card)); });
      ouvir(el, 'click', '[data-item-pauta]', async (b) => {
        const card = b.closest('[data-reuniao]'); const texto = prompt('Novo item de pauta'); if (!texto?.trim()) return;
        if (await salvar(card, [...ler(card), { texto: texto.trim().slice(0, 300), feito: false }])) ctx.recarregar();
      });
      ouvir(el, 'click', '[data-gerar-ata]', async (b) => {
        const card = b.closest('[data-reuniao]'); const e = eventos.find((x) => x.id === card.dataset.reuniao); const pauta = ler(card);
        await salvar(card, pauta, false);
        try {
          await api.post(`/api/projetos/${ctx.id}/atas`, { titulo: e.titulo, realizadaEm: new Date(e.inicio).toLocaleDateString('sv-SE'), participantes: (e.convidados ?? []).join(', '),
            pauta: pauta.map((p, i) => `${i + 1}. ${p.texto}${p.feito ? '' : ' (não tratado)'}`).join('\n'), decisoes: pauta.filter((p) => p.decisao).map((p) => `${p.texto}: ${p.decisao}`).join('\n'), encaminhamentos: '', publicada: false });
          toast('Ata criada a partir da pauta. Revise antes de publicar ao cliente.'); ctx.recarregar();
        } catch (er) { erroDe(er); }
      });
    },
  };
}
