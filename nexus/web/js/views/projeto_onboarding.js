/**
 * Onboarding do cliente, visual: uma trilha animada com as etapas (feita, atual, próximas), o que fazer
 * agora, quem faz e até quando, e as tarefas que o projeto já gerou. Itens marcados como "auto" se
 * concluem sozinhos quando o LAB vê o fato (link do grupo salvo, checklist gerado, fatura emitida...).
 * O mesmo conteúdo, em formato compacto, fica no painel lateral do projeto (botão "Onboarding").
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, html, icone, ouvir, raw } from '../util.js';
import { confirmar, erroDe, formulario, toast, vazio } from '../ui.js';

const LADO = { nga: ['NGA', 'info'], cliente: ['Cliente', 'aviso'] };
const STATUS_TAREFA = { a_fazer: 'A fazer', em_andamento: 'Em andamento', em_revisao: 'Em revisão' };
const prazoTxt = (it) => (it.feito ? (it.automatico ? 'concluído pelo sistema' : `feito${it.feitoPor ? ` por ${it.feitoPor}` : ''}`) : it.atrasado ? `atrasado há ${it.diasAtraso} dia(s)` : it.prazo ? `até ${dataBR(it.prazo)}` : 'sem prazo');

/** Trilha das etapas: círculos ligados por uma linha que se preenche até a etapa atual. */
function trilha(o) {
  const idx = Math.max(0, o.etapas.findIndex((e) => e.estado === 'atual'));
  const fim = o.etapas.every((e) => e.estado === 'concluida');
  const pct = o.etapas.length > 1 ? Math.round(((fim ? o.etapas.length - 1 : idx) / (o.etapas.length - 1)) * 100) : 100;
  return html`<div class="onb-trilha" style="--n:${o.etapas.length};--p:${pct}%"><div class="onb-trilha__linha"><i></i></div>
    ${o.etapas.map((e, i) => html`<button type="button" class="onb-passo ${e.estado}" data-ir-etapa="${i}" aria-label="${e.nome}: ${e.feitos} de ${e.total}">
      <span class="onb-passo__bola">${e.estado === 'concluida' ? raw(icone('check')) : i + 1}</span><b>${e.nome}</b><small>${e.feitos}/${e.total}</small></button>`)}</div>`;
}

function anel(p) {
  const r = 52; const c = 2 * Math.PI * r;
  return raw(`<svg class="onb-anel" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" class="fundo"/><circle cx="60" cy="60" r="${r}" class="valor" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-alvo="${c * (1 - p / 100)}"/></svg>`);
}

function itemHtml(it, edita) {
  return html`<li class="onb-item ${it.feito ? 'feito' : ''} ${it.atrasado ? 'atrasado' : ''}" data-item="${it.id}">
    <button type="button" class="onb-check" data-alternar="${it.id}" ${edita && !it.automatico ? '' : 'disabled'} aria-pressed="${it.feito}" aria-label="${it.feito ? 'Desmarcar' : 'Concluir'}: ${it.titulo}">${it.feito ? raw(icone('check')) : ''}</button>
    <div class="onb-item__txt"><b>${it.titulo}</b>${it.descricao ? html`<small>${it.descricao}</small>` : ''}
      <div class="onb-item__meta"><span class="selo ${LADO[it.lado][1]}">${LADO[it.lado][0]}</span>${it.chave ? html`<span class="selo" title="Conclui sozinho quando o LAB vê o fato">auto</span>` : ''}
        <span class="${it.atrasado ? 'onb-atraso' : ''}">${prazoTxt(it)}</span>${it.responsavel ? html`<span>· ${it.responsavel}</span>` : it.lado === 'nga' ? html`<span class="muted">· sem responsável</span>` : ''}</div></div>
    ${edita ? html`<button type="button" class="ibtn ibtn--sm" data-editar-item="${it.id}" aria-label="Editar">${icone('list')}</button>` : ''}</li>`;
}

export async function abaOnboarding(ctx) {
  const o = await api.get(`/api/projetos/${ctx.id}/onboarding`); const edita = pode('tarefa.escrever');
  if (!o.iniciado) return {
    html: html`<section class="card glass up onb-vazio">${vazio('flag', 'Onboarding ainda não começou', 'Comece com o roteiro do escritório: boas-vindas, acesso e documentos, contrato e cobrança, diagnóstico e estratégia. Dá para editar cada item depois.',
      edita ? '<button class="btn btn--accent" data-iniciar>Começar o onboarding</button>' : '')}</section>`,
    depois(el) { ouvir(el, 'click', '[data-iniciar]', async (b) => { b.disabled = true; try { await api.post(`/api/projetos/${ctx.id}/onboarding/iniciar`, {}); toast('Onboarding iniciado'); ctx.recarregar(); } catch (e) { b.disabled = false; erroDe(e); } }); },
  };
  const atual = o.etapas.find((e) => e.estado === 'atual');
  return {
    html: html`<section class="card glass up onb-hero">
        <div class="onb-hero__anel">${anel(o.percentual)}<div><b data-pct>${o.percentual}%</b><small>${o.feitos} de ${o.total}</small></div></div>
        <div class="onb-hero__txt"><p class="eyebrow">Onboarding do cliente</p><h2>${atual ? html`Etapa atual: <span>${atual.nome}</span>` : 'Onboarding concluído 🎉'}</h2>
          <p class="dica">${o.atrasados ? html`<b class="onb-atraso">${o.atrasados} item(ns) atrasado(s).</b> ` : ''}${atual ? `Faltam ${atual.total - atual.feitos} item(ns) para avançar.` : 'Tudo feito. O projeto segue nas outras abas.'}</p></div>
        ${o.proximas.length ? html`<div class="onb-agora"><p class="eyebrow">O que fazer agora</p><ol>${o.proximas.slice(0, 3).map((p) => html`<li class="${p.atrasado ? 'onb-atraso' : ''}"><b>${p.titulo}</b><small>${LADO[p.lado][0]} · ${prazoTxt(p)}${p.responsavel ? ` · ${p.responsavel}` : ''}</small></li>`)}</ol></div>` : ''}</section>
      <section class="card glass up mt">${trilha(o)}</section>
      <div class="onb-grid mt">
        <div class="onb-etapas">${o.etapas.map((e, i) => html`<section class="card glass up onb-etapa ${e.estado}" id="onb-etapa-${i}">
            <header><span class="onb-etapa__n">${e.estado === 'concluida' ? raw(icone('check')) : i + 1}</span><div class="grow"><h3>${e.nome}</h3><div class="onb-barra"><i style="width:${Math.round((e.feitos / e.total) * 100)}%"></i></div></div><span class="mono-sm">${e.feitos}/${e.total}</span></header>
            <ul class="onb-itens">${e.itens.map((it) => itemHtml(it, edita))}</ul>
            ${edita ? html`<button class="link" data-novo-item="${e.nome}">+ adicionar tarefa nesta etapa</button>` : ''}</section>`)}</div>
        <aside class="onb-lateral">
          <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Tarefas geradas</h2><p class="card__sub">O que já está na fila da equipe neste projeto</p></div><button class="link" data-aba-ir="tarefas">Abrir →</button></header>
            ${o.tarefas.length ? html`<ul class="cal-lista">${o.tarefas.map((t) => html`<li class="cal-item cal-t--tarefa" data-aba-ir="tarefas"><i></i><div><b>${t.titulo}</b><small>${STATUS_TAREFA[t.status] ?? t.status}${t.prazo ? ` · até ${dataBR(t.prazo)}` : ''}${t.responsavel ? ` · ${t.responsavel}` : ''}</small></div></li>`)}</ul>` : html`<p class="dica">Nenhuma tarefa aberta.</p>`}</section>
          <section class="card glass up mt"><h2 class="card__title">Legenda</h2><ul class="onb-legenda"><li><span class="selo info">NGA</span> a equipe faz</li><li><span class="selo aviso">Cliente</span> aparece no portal do cliente</li><li><span class="selo">auto</span> conclui sozinho quando o LAB vê o fato</li></ul></section>
        </aside></div>`,
    depois(el) { ligar(el, ctx, o); },
  };
}

function ligar(el, ctx, o) {
  const anelV = el.querySelector('.onb-anel .valor'); if (anelV) requestAnimationFrame(() => { anelV.style.strokeDashoffset = anelV.dataset.alvo; });
  ouvir(el, 'click', '[data-ir-etapa]', (b) => el.querySelector(`#onb-etapa-${b.dataset.irEtapa}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  ouvir(el, 'click', '[data-aba-ir]', (b) => ctx.irParaAba?.(b.dataset.abaIr));
  ouvir(el, 'click', '[data-alternar]', async (b) => {
    const it = o.etapas.flatMap((e) => e.itens).find((x) => x.id === b.dataset.alternar); if (!it) return;
    const li = b.closest('.onb-item'); li.classList.toggle('feito', !it.feito); li.classList.add('pulso');
    try { await api.patch(`/api/onboarding/itens/${it.id}`, { feito: !it.feito }); if (!it.feito) toast('Feito! ✔'); setTimeout(() => ctx.recarregar(), 450); } catch (e) { erroDe(e); ctx.recarregar(); }
  });
  ouvir(el, 'click', '[data-novo-item]', async (b) => {
    const ok = await formulario({ titulo: `Nova tarefa · ${b.dataset.novoItem}`, rotulo: 'Adicionar', campos: [
      { nome: 'titulo', rotulo: 'O que precisa ser feito', obrigatorio: true }, { nome: 'lado', rotulo: 'Quem faz', tipo: 'select', valor: 'nga', metade: true, opcoes: [{ v: 'nga', t: 'Equipe NGA' }, { v: 'cliente', t: 'Cliente' }] },
      { nome: 'prazo', rotulo: 'Prazo', tipo: 'date', metade: true }],
      async enviar(v) { await api.post(`/api/projetos/${ctx.id}/onboarding/itens`, { etapa: b.dataset.novoItem, titulo: v.titulo, lado: v.lado, prazo: v.prazo || null }); } });
    if (ok) ctx.recarregar();
  });
  ouvir(el, 'click', '[data-editar-item]', async (b) => {
    const it = o.etapas.flatMap((e) => e.itens).find((x) => x.id === b.dataset.editarItem);
    const equipe = ctx.h.equipe ?? [];
    const ok = await formulario({ titulo: 'Editar tarefa do onboarding', rotulo: 'Salvar', campos: [
      { nome: 'titulo', rotulo: 'Tarefa', valor: it.titulo, obrigatorio: true },
      { nome: 'responsavelId', rotulo: 'Responsável', tipo: 'select', valor: it.responsavelId ?? '', metade: true, opcoes: [{ v: '', t: 'Sem responsável' }, ...equipe.map((p) => ({ v: p.usuarioId ?? p.usuario_id ?? p.id, t: p.nome }))] },
      { nome: 'prazo', rotulo: 'Prazo', tipo: 'date', valor: it.prazo ?? '', metade: true },
      { nome: 'excluir', rotulo: 'Excluir esta tarefa?', tipo: 'select', valor: 'nao', opcoes: [{ v: 'nao', t: 'Não' }, { v: 'sim', t: 'Sim, excluir' }] }],
      async enviar(v) {
        if (v.excluir === 'sim') { if (await confirmar('Excluir a tarefa do onboarding?', it.titulo, { rotulo: 'Excluir', perigo: true })) await api.del(`/api/onboarding/itens/${it.id}`); return; }
        await api.patch(`/api/onboarding/itens/${it.id}`, { titulo: v.titulo, responsavelId: v.responsavelId || null, prazo: v.prazo || null });
      } });
    if (ok) ctx.recarregar();
  });
}

/** Painel lateral do projeto: a mesma trilha, compacta, aberta por cima de qualquer aba. */
export async function abrirPainelOnboarding(ctx) {
  document.querySelector('.onb-gaveta')?.remove();
  const g = document.createElement('aside'); g.className = 'onb-gaveta'; g.setAttribute('role', 'dialog'); g.setAttribute('aria-label', 'Onboarding do cliente');
  g.innerHTML = '<div class="skel" style="height:200px"></div>'; document.body.appendChild(g); requestAnimationFrame(() => g.classList.add('aberta'));
  const fechar = () => { g.classList.remove('aberta'); setTimeout(() => g.remove(), 300); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') fechar(); }; document.addEventListener('keydown', esc);
  try {
    const o = await api.get(`/api/projetos/${ctx.id}/onboarding`);
    g.innerHTML = String(html`<header class="onb-gaveta__head"><div><p class="eyebrow">Onboarding</p><h3>${ctx.h.nome}</h3></div><button class="ibtn" data-fechar aria-label="Fechar">${icone('x')}</button></header>
      ${o.iniciado ? html`<div class="onb-gaveta__prog"><div class="onb-barra grande"><i style="width:${o.percentual}%"></i></div><b>${o.percentual}%</b></div>
        <ol class="onb-vertical">${o.etapas.map((e) => html`<li class="${e.estado}"><span class="onb-passo__bola">${e.estado === 'concluida' ? raw(icone('check')) : ''}</span><div><b>${e.nome}</b><small>${e.feitos}/${e.total}${e.estado === 'atual' ? ' · você está aqui' : ''}</small>
          ${e.estado === 'atual' ? html`<ul>${e.itens.filter((x) => !x.feito).map((x) => html`<li class="${x.atrasado ? 'onb-atraso' : ''}">${x.titulo}<small>${LADO[x.lado][0]} · ${prazoTxt(x)}</small></li>`)}</ul>` : ''}</div></li>`)}</ol>
        <button class="btn btn--accent" data-abrir-aba>Abrir o onboarding completo</button>`
        : html`<p class="dica">O onboarding deste projeto ainda não começou.</p><button class="btn btn--accent" data-abrir-aba>Começar</button>`}`);
  } catch (e) { g.innerHTML = ''; erroDe(e); fechar(); return; }
  g.addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) fechar(); if (e.target.closest('[data-abrir-aba]')) { fechar(); ctx.irParaAba('onboarding'); } });
}
