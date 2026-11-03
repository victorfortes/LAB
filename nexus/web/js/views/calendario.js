/**
 * Calendário: prazos do CPC e tarefas, no mesmo mês.
 *
 * Os prazos vêm contados em dias úteis forenses (arts. 219, 220 e 224). O que
 * o sistema NÃO sabe — feriado estadual, municipal e suspensão do tribunal —
 * está dito na própria tela, junto do calendário: uma data bonita sem essa
 * ressalva faria o advogado confiar no que não deve.
 */
import { api } from '../api.js';
import { estado } from '../estado.js';
import { dataBR, guardado, hojeISO, html, icone, matiz, ouvir, raw } from '../util.js';
import { cabecalho, vazio } from '../ui.js';
import { ir, navegar } from '../shell.js';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const iso = (a, m, d) => `${a}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export default async function calendario() {
  const hoje = hojeISO();
  const ref = guardado.ler('calMes', null) ?? hoje.slice(0, 7);
  const [ano, mes0] = ref.split('-').map(Number); const mes = mes0 - 1;
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  const [agenda, tar, fer] = await Promise.all([
    api.get(`/api/agenda?ate=${iso(ano, mes, ultimo)}`),
    api.get('/api/tarefas'),
    api.get(`/api/calendario/feriados?ano=${ano}`),
  ]);

  const feriados = new Map(fer.feriados.map((f) => [f.data, f]));
  const prazos = agenda.itens.filter((z) => z.vencimento.startsWith(ref));
  const vencidosAntes = agenda.itens.filter((z) => z.vencido && z.vencimento < `${ref}-01`);
  const tarefas = tar.tarefas.filter((t) => t.prazo && t.prazo.startsWith(ref) && t.status !== 'concluida');
  const porDia = new Map();
  const push = (d, e) => porDia.set(d, [...(porDia.get(d) ?? []), e]);
  for (const z of prazos) push(z.vencimento, { tipo: z.vencido ? 'vencido' : 'prazo', rotulo: z.titulo, dica: `${z.numero}${z.projeto ? ` · ${z.projeto}` : ''}`, alvo: z.projeto_id ? `projetos/${z.projeto_id}/processos` : 'projetos' });
  for (const t of tarefas) push(t.prazo, { tipo: 'tarefa', rotulo: t.titulo, dica: t.projeto, alvo: `projetos/${t.projetoId}/tarefas` });

  const primeiroDow = new Date(ano, mes, 1).getDay();
  const celulas = [];
  for (let i = 0; i < primeiroDow; i++) celulas.push(null);
  for (let d = 1; d <= ultimo; d++) celulas.push(d);
  while (celulas.length % 7) celulas.push(null);

  const ehNaoUtil = (a, m, d) => { const w = new Date(a, m, d).getDay(); const c = iso(a, m, d); return w === 0 || w === 6 || feriados.has(c) || fer.recesso && ((m === 11 && d >= 20) || (m === 0 && d <= 20)); };

  const nav = (delta) => { const d = new Date(ano, mes + delta, 1); guardado.gravar('calMes', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); navegar(); };
  const nPrazos = prazos.length;

  return {
    titulo: 'Calendário',
    html: html`${cabecalho({
      titulo: 'Calendário', sub: `${MESES[mes]} de ${ano} · prazos contados em dias úteis forenses`,
      acoes: html`<div class="seg" role="group"><span class="seg__pill" aria-hidden="true"></span>
        <button type="button" class="seg__btn" data-nav="-1" aria-pressed="false">${icone('chevronLeft')}</button>
        <button type="button" class="seg__btn" data-nav="0" aria-pressed="false"><span>Hoje</span></button>
        <button type="button" class="seg__btn" data-nav="1" aria-pressed="false">${icone('chevron')}</button></div>`,
      resumo: [{ rotulo: 'Prazos no mês', valor: nPrazos }, { rotulo: 'Tarefas com prazo', valor: tarefas.length },
        { rotulo: 'Vencidos', valor: agenda.vencidos, tom: agenda.vencidos ? 'alert' : 'ok' }, { rotulo: 'Vencem hoje', valor: agenda.venceHoje, tom: agenda.venceHoje ? 'warn' : '' }],
    })}
    ${vencidosAntes.length ? html`<div class="card glass up mt" style="border:1px solid #FF6B6B55"><header class="card__head"><div><h2 class="card__title" style="color:var(--lab-red)">${vencidosAntes.length} prazo(s) vencido(s) de meses anteriores</h2><p class="card__sub">Ainda abertos. Um prazo aberto com vencimento no passado é o achado mais importante desta tela.</p></div></header>
      <ul class="lista">${vencidosAntes.map((z) => html`<li style="cursor:pointer" data-ir="${z.projeto_id ? `projetos/${z.projeto_id}/processos` : 'projetos'}"><div><b>${z.titulo}</b><small>${z.numero} · venceu em ${dataBR(z.vencimento)}</small></div><div class="fim"><span class="selo erro">há ${-z.diasUteisRestantes} dia(s) útil(eis)</span></div></li>`)}</ul></div>` : ''}
    <section class="card glass up mt">
      <div class="cal">${DOW.map((d) => html`<div class="cal__dow">${d}</div>`)}
        ${celulas.map((d) => {
          if (!d) return html`<div class="cal__dia fora"></div>`;
          const c = iso(ano, mes, d); const evs = porDia.get(c) ?? []; const f = feriados.get(c);
          return html`<div class="cal__dia ${c === hoje ? 'hoje' : ''} ${ehNaoUtil(ano, mes, d) ? 'nao-util' : ''}"><b>${d}</b>
            ${f ? html`<span class="cal__feriado">${f.nome}</span>` : ''}
            ${evs.slice(0, 3).map((e) => html`<button type="button" class="cal__ev ${e.tipo}" data-ir="${e.alvo}" title="${e.rotulo} — ${e.dica}">${e.rotulo}</button>`)}
            ${evs.length > 3 ? html`<small class="muted">+${evs.length - 3}</small>` : ''}</div>`;
        })}
      </div>
      <div class="flex mt" style="gap:18px"><span class="selo aviso"><i></i>Prazo processual</span><span class="selo info"><i></i>Tarefa</span><span class="selo erro"><i></i>Vencido</span>
        <span class="dica">Dias em cinza: fim de semana, feriado nacional ou recesso (art. 220 do CPC).</span></div>
      <p class="nota mt">${fer.ressalva} Confira o calendário da comarca antes de confiar numa data.</p>
    </section>`,
    depois(raiz) {
      ouvir(raiz, 'click', '[data-nav]', (b) => {
        const v = Number(b.dataset.nav);
        if (v === 0) { guardado.gravar('calMes', null); navegar(); } else nav(v);
      });
      ouvir(raiz, 'click', '[data-ir]', (b) => ir(b.dataset.ir));
    },
  };
}
