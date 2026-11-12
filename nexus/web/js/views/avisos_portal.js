/**
 * Avisos ao cliente: nova ação encontrada pelo Sentinela vira aviso no portal do cliente.
 * Equipe: revisa o texto e publica (ou liga o envio automático para ação confirmada).
 * Cliente: vê o aviso no início do portal, com o número do processo, e marca como lido.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, html, icone, ouvir, relativo } from '../util.js';
import { erroDe, formulario, toast } from '../ui.js';

const detalhe = (d) => [d?.numero, d?.classe, d?.tribunal, d?.ajuizamento ? `ajuizada em ${dataBR(d.ajuizamento)}` : null].filter(Boolean).join(' · ');

export async function secaoAvisosEquipe(ctx) {
  const r = await api.get(`/api/projetos/${ctx.id}/avisos`).catch(() => ({ avisos: [], automatico: false }));
  const publica = pode('portal.publicar');
  const rascunhos = r.avisos.filter((a) => a.situacao === 'rascunho');
  return {
    html: html`<section class="card glass up ${rascunhos.length ? 'aviso-pendente' : ''}"><header class="card__head"><div><h2 class="card__title">Avisos ao cliente ${rascunhos.length ? html`<span class="selo aviso">${rascunhos.length} para revisar</span>` : ''}</h2>
        <p class="card__sub">Quando o Sentinela encontra uma ação nova contra o cliente, o aviso nasce aqui. Revise e publique: ele aparece no início do portal.</p></div>
        ${publica ? html`<label class="toggle" title="Ação confirmada pelo Sentinela já aparece no portal, sem revisão"><input type="checkbox" data-aviso-auto ${r.automatico ? 'checked' : ''}><span></span>Publicar sozinho (ação confirmada)</label>` : ''}</header>
      ${r.avisos.length ? html`<ul class="lista">${r.avisos.map((a) => html`<li><span class="selo ${a.situacao === 'publicado' ? 'ok' : 'aviso'}">${a.situacao === 'publicado' ? (a.lidoEm ? 'lido pelo cliente' : 'publicado') : 'rascunho'}</span>
          <div><b>${a.titulo}</b><small>${detalhe(a.dados)} · ${relativo(a.criadoEm)}</small><small>${a.texto}</small></div>
          ${publica && a.situacao === 'rascunho' ? html`<div class="fim nx-acts"><button class="btn btn--accent btn--sm" data-publicar-aviso="${a.id}">Revisar e publicar</button><button class="btn btn--ghost btn--sm" data-descartar-aviso="${a.id}">Descartar</button></div>` : ''}</li>`)}</ul>`
        : html`<p class="dica">Nenhum aviso. O Sentinela verifica o CNPJ do cliente todos os dias.</p>`}</section>`,
    depois(el) {
      ouvir(el, 'change', '[data-aviso-auto]', async (c) => { try { await api.put(`/api/projetos/${ctx.id}/avisos/automatico`, { automatico: c.checked }); toast(c.checked ? 'Ação confirmada vai direto ao portal' : 'Avisos passam por revisão'); } catch (e) { c.checked = !c.checked; erroDe(e); } });
      ouvir(el, 'click', '[data-publicar-aviso]', async (b) => {
        const a = r.avisos.find((x) => x.id === b.dataset.publicarAviso);
        const ok = await formulario({ titulo: 'Publicar aviso no portal', subtitulo: detalhe(a.dados), rotulo: 'Publicar', largo: true, campos: [{ nome: 'titulo', rotulo: 'Título', valor: a.titulo, obrigatorio: true }, { nome: 'texto', rotulo: 'Texto para o cliente', tipo: 'textarea', valor: a.texto, obrigatorio: true }],
          async enviar(v) { await api.post(`/api/avisos/${a.id}/publicacao`, { titulo: v.titulo, texto: v.texto }); } });
        if (ok) { toast('Aviso publicado no portal'); ctx.recarregar(); }
      });
      ouvir(el, 'click', '[data-descartar-aviso]', async (b) => { try { await api.post(`/api/avisos/${b.dataset.descartarAviso}/descarte`, {}); ctx.recarregar(); } catch (e) { erroDe(e); } });
    },
  };
}

/** Bloco do início do portal do cliente. Vazio quando não há aviso. */
export async function avisosDoCliente() {
  const lista = await api.get('/api/portal/avisos').catch(() => []);
  if (!lista.length) return { html: '', depois() {} };
  const novos = lista.filter((a) => !a.lidoEm).length;
  return {
    html: html`<section class="card glass up portal-avisos ${novos ? 'novo' : ''}"><header class="card__head"><div><h2 class="card__title">${icone('bell')} Avisos do escritório ${novos ? html`<span class="selo aviso">${novos} novo(s)</span>` : ''}</h2></div></header>
      <ul class="lista">${lista.map((a) => html`<li class="${a.lidoEm ? '' : 'nao-lido'}" data-aviso="${a.id}"><div><b>${a.titulo}</b><small>${a.texto}</small>${a.dados?.numero ? html`<small class="mono-sm">Processo ${a.dados.numero}${a.dados.tribunal ? ` · ${a.dados.tribunal}` : ''}</small>` : ''}<small>${relativo(a.publicadoEm)}</small></div>
        ${a.lidoEm ? '' : html`<div class="fim"><button class="btn btn--ghost btn--sm" data-lido="${a.id}">Entendi</button></div>`}</li>`)}</ul></section>`,
    depois(el) { ouvir(el, 'click', '[data-lido]', async (b) => { try { await api.post(`/api/portal/avisos/${b.dataset.lido}/lido`, {}); b.closest('li').classList.remove('nao-lido'); b.remove(); } catch (e) { erroDe(e); } }); },
  };
}

/** Onboarding visto pelo cliente: só o que é dele fazer, como trilha. Some quando não há nada. */
export async function onboardingDoCliente(projetoId) {
  const o = await api.get(`/api/projetos/${projetoId}/onboarding`).catch(() => null);
  if (!o?.iniciado) return '';
  const pend = o.etapas.flatMap((e) => e.itens).filter((x) => !x.feito);
  return html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Seus próximos passos</h2><p class="card__sub">${o.feitos} de ${o.total} concluído(s) do seu lado</p></div><b class="mono-sm">${o.percentual}%</b></header>
    <div class="onb-barra grande"><i style="width:${o.percentual}%"></i></div>
    ${pend.length ? html`<ul class="onb-itens mt">${pend.map((x) => html`<li class="onb-item ${x.atrasado ? 'atrasado' : ''}"><span class="onb-check"></span><div class="onb-item__txt"><b>${x.titulo}</b>${x.descricao ? html`<small>${x.descricao}</small>` : ''}<div class="onb-item__meta"><span class="${x.atrasado ? 'onb-atraso' : ''}">${x.prazo ? `até ${dataBR(x.prazo)}` : 'sem prazo'}</span></div></div><span></span></li>`)}</ul>` : html`<p class="dica mt">Tudo feito do seu lado. Obrigado!</p>`}</section>`;
}
