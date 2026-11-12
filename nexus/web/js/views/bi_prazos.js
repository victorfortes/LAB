/**
 * BI de Prazos: o painel de controle dos prazos do escritório, dentro do Nexus.
 *
 * Substitui o painel avulso alimentado por planilha do Astrea: aqui os dados são os prazos reais do banco
 * (agenda da controladoria), com a contagem em dias úteis forenses. Mesmos filtros de sempre — responsável,
 * projeto, tipo, mês, situação e busca — e leitura por responsável, mês e projeto.
 */
import { api } from '../api.js';
import { dataBR, guardado, hojeISO, html, icone, ouvir } from '../util.js';
import { cabecalho, vazio } from '../ui.js';
import { animarBarras, contar } from '../fx.js';
import { ir } from '../shell.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesDe = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
const ate = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toLocaleDateString('sv-SE'); };

export default async function biPrazos() {
  const a = await api.get(`/api/agenda?ate=${ate()}`);
  const itens = a.itens;
  const filtros = guardado.ler('biPrazos', { resp: '', proj: '', tipo: '', mes: '', sit: '', q: '' });
  const uniq = (k) => [...new Set(itens.map((i) => i[k]).filter(Boolean))].sort((x, y) => String(x).localeCompare(String(y), 'pt-BR'));
  const meses = [...new Set(itens.map((i) => i.vencimento.slice(0, 7)))].sort();
  return {
    titulo: 'BI de Prazos',
    html: html`${cabecalho({ titulo: 'BI de Prazos', sub: `Prazos abertos da carteira · atualizado em ${dataBR(hojeISO())}`,
      resumo: [{ rotulo: 'Abertos', valor: itens.length }, { rotulo: 'Vencidos', valor: a.vencidos, tom: a.vencidos ? 'alert' : '' }, { rotulo: 'Vencem hoje', valor: a.venceHoje, tom: a.venceHoje ? 'warn' : '' }] })}
      <form class="tk-bar glass mt" data-filtros>
        <label class="field"><span>Responsável</span><select class="select" name="resp"><option value="">Todos</option>${uniq('responsavel').map((x) => html`<option>${x}</option>`)}</select></label>
        <label class="field"><span>Projeto</span><select class="select" name="proj"><option value="">Todos</option>${uniq('projeto').map((x) => html`<option>${x}</option>`)}</select></label>
        <label class="field"><span>Tipo</span><select class="select" name="tipo"><option value="">Todos</option>${uniq('tipo').map((x) => html`<option>${x}</option>`)}</select></label>
        <label class="field"><span>Mês</span><select class="select" name="mes"><option value="">Todos</option>${meses.map((m) => html`<option value="${m}">${mesDe(`${m}-01`)}</option>`)}</select></label>
        <label class="field"><span>Situação</span><select class="select" name="sit"><option value="">Todas</option><option value="vencido">Vencidos</option><option value="semana">Próximos 7 dias</option><option value="avencer">A vencer</option></select></label>
        <label class="field grow"><span>Buscar caso ou processo</span><input class="input" type="search" name="q" placeholder="Número, título ou projeto"></label>
        <button class="btn btn--ghost" type="button" data-limpar>Limpar</button></form>
      <div id="bi-corpo" class="mt"></div>
      <p class="dica mt">${a.ressalva}</p>`,
    depois(el) {
      const form = el.querySelector('[data-filtros]');
      for (const [k, v] of Object.entries(filtros)) if (form.elements[k]) form.elements[k].value = v;
      const desenhar = () => {
        const f = Object.fromEntries(new FormData(form)); guardado.gravar('biPrazos', f);
        const q = (f.q ?? '').toLowerCase().trim();
        const lista = itens.filter((i) => (!f.resp || i.responsavel === f.resp) && (!f.proj || i.projeto === f.proj) && (!f.tipo || i.tipo === f.tipo) && (!f.mes || i.vencimento.startsWith(f.mes))
          && (!f.sit || (f.sit === 'vencido' ? i.vencido : f.sit === 'semana' ? !i.vencido && i.diasUteisRestantes <= 5 : !i.vencido))
          && (!q || `${i.numero} ${i.titulo} ${i.projeto ?? ''} ${i.classe ?? ''}`.toLowerCase().includes(q)));
        const conta = (chave) => { const m = new Map(); for (const i of lista) { const k = chave(i); m.set(k, (m.get(k) ?? 0) + 1); } return [...m].sort((x, y) => y[1] - x[1]); };
        const barras = (titulo, sub, dados, tom = 'amber') => { const max = Math.max(1, ...dados.map((d) => d[1])); return html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">${titulo}</h2><p class="card__sub">${sub}</p></div></header>
          ${dados.length ? html`<ul class="nx-bars">${dados.slice(0, 8).map(([nome, n]) => html`<li><span class="nx-bars__nome" title="${nome}">${nome}</span><span class="nx-bars__trilho"><i class="nx-bars__bar nx-bars__bar--${tom}" data-w="${Math.round((n / max) * 100)}" style="width:0"></i></span><b>${n}</b></li>`)}</ul>` : html`<p class="dica">Sem dados neste filtro.</p>`}</section>`; };
        const porMes = conta((i) => i.vencimento.slice(0, 7)).sort((x, y) => x[0].localeCompare(y[0])).map(([m, n]) => [mesDe(`${m}-01`), n]);
        const venc = lista.filter((i) => i.vencido).length; const sem = lista.filter((i) => !i.vencido && i.diasUteisRestantes <= 5).length;
        el.querySelector('#bi-corpo').innerHTML = String(html`
          <div class="nx-kpis nx-kpis--3"><div class="nx-kpi"><span class="nx-kpi__label">No filtro</span><b class="nx-kpi__big" data-n="${lista.length}">0</b><small>prazos abertos</small></div>
            <div class="nx-kpi ${venc ? 'is-alert' : ''}"><span class="nx-kpi__label">Vencidos</span><b class="nx-kpi__big" data-n="${venc}">0</b><small>exigem ação imediata</small></div>
            <div class="nx-kpi"><span class="nx-kpi__label">Próximos 5 dias úteis</span><b class="nx-kpi__big" data-n="${sem}">0</b><small>vencem logo</small></div></div>
          <div class="grid3 mt">${barras('Por responsável', 'Quem carrega mais prazos', conta((i) => i.responsavel ?? 'Sem responsável'))}${barras('Por mês', 'Distribuição dos vencimentos', porMes, 'cy')}${barras('Por projeto', 'Onde os prazos se concentram', conta((i) => i.projeto ?? 'Sem projeto'), 'green')}</div>
          <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Prazos</h2><p class="card__sub">${lista.length} no filtro, do mais próximo ao mais distante</p></div></header>
            ${lista.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vencimento</th><th>Prazo</th><th>Processo</th><th>Projeto</th><th>Responsável</th><th class="num">Dias úteis</th></tr></thead>
              <tbody>${lista.slice(0, 300).map((i) => html`<tr class="${i.vencido ? 'vencido' : ''}" ${i.projeto_id ? html`data-ir="projetos/${i.projeto_id}/processos" style="cursor:pointer"` : ''}><td>${dataBR(i.vencimento)}</td><td>${i.titulo}<small>${i.tipo ?? ''}</small></td><td class="mono-sm">${i.numero}</td><td>${i.projeto ?? '—'}</td><td>${i.responsavel ?? '—'}</td>
                <td class="num">${i.vencido ? html`<span class="selo erro">${-i.diasUteisRestantes}d atraso</span>` : i.diasUteisRestantes}</td></tr>`)}</tbody></table></div>${lista.length > 300 ? html`<p class="dica mt">Mostrando os 300 primeiros. Use os filtros para refinar.</p>` : ''}` : vazio('calendar', 'Nenhum prazo neste filtro', 'Ajuste os filtros acima.')}</section>`);
        contar(el); animarBarras(el);
      };
      form.addEventListener('input', desenhar);
      form.addEventListener('submit', (e) => e.preventDefault());
      ouvir(el, 'click', '[data-limpar]', () => { form.reset(); desenhar(); });
      ouvir(el, 'click', '[data-ir]', (tr) => ir(tr.dataset.ir));
      desenhar(); void icone;
    },
  };
}
