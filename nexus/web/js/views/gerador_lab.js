/**
 * Gerador de Relatórios dentro do LAB. O PDF é o do Gerador (mesmo motor, modelo Quantitativo, 4 páginas); esta
 * tela segue a mesma ordem do Gerador: escolher cliente, período e fonte → Processar → conferir os números do
 * período ("O mês em números", no azul do relatório) → abrir, baixar ou guardar no acervo do projeto.
 * O agendamento por cliente (mensal, quinzenal, semanal) gera o mesmo relatório sozinho, pela rotina de hora em hora.
 */
import { api } from '../api.js';
import { html, icone, ouvir, dataBR, plural } from '../util.js';
import { erroDe, toast, vazio } from '../ui.js';

(() => { if (document.querySelector('link[data-gerador-lab]')) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/gerador_lab.css'; l.dataset.geradorLab = ''; document.head.appendChild(l); })();

const FREQ = { mensal: 'Mensal', quinzenal: 'Quinzenal', semanal: 'Semanal' };
const SEMANA = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (v) => Number(v || 0).toLocaleString('pt-BR');
const mesPassado = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString('sv-SE').slice(0, 7); };
const regraTxt = (a) => (a.frequencia === 'semanal' ? `toda ${SEMANA[a.dia]}, com a semana anterior` : a.frequencia === 'quinzenal' ? 'dias 1 e 16, com a quinzena anterior' : `todo dia ${a.dia}, com o mês anterior`);

async function pedirPdf(projetoId, form, acao) {
  const fd = new FormData(form);
  const per = fd.get('periodicidade'); const ref = fd.get(per === 'mensal' ? 'mes' : 'dia');
  if (!ref) throw new Error('Escolha o período.');
  const inicio = per === 'mensal' ? `${ref}-01` : ref; const fonte = fd.get('fonte');
  let opcoes;
  if (fonte === 'astrea') {
    const f = new FormData(); f.set('periodicidade', per); f.set('inicio', inicio); f.set('fonte', 'astrea');
    const arq = form.querySelector('[name=arquivo]').files[0]; if (!arq) throw new Error('Escolha o PDF de fichas exportado do Astrea.');
    f.set('arquivo', arq); opcoes = { method: 'POST', body: f };
  } else opcoes = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ periodicidade: per, inicio, fonte: 'lab' }) };
  const r = await fetch(`/api/projetos/${projetoId}/gerador-lab/${acao}`, { credentials: 'same-origin', ...opcoes });
  if (!r.ok) { const c = await r.json().catch(() => null); throw new Error(c?.erro ?? `erro ${r.status}`); }
  if (acao === 'emissoes') return r.json();
  return { pdf: await r.blob(), resumo: JSON.parse(decodeURIComponent(r.headers.get('x-nga-resumo') || '%7B%7D')), nome: /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] ?? 'relatorio.pdf' };
}

/** Os números do período no mesmo azul, dourado e cartões da página 2 do relatório. */
function folhaDoMes(r) {
  const t = r.porTipo ?? {}; const tipos = [['Tarefas', t.tarefas], ['Prazos', t.prazos], ['Andamentos', t.andamentos], ['Históricos', t.historicos], ['Eventos', t.eventos]];
  const max = Math.max(1, ...tipos.map((x) => x[1] || 0)); const cores = ['#BE8E57', '#4E93B5', '#6FB0CE', '#8FC3DB', '#A9CFE3'];
  const media = r.movimentados ? (r.registros / r.movimentados).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00';
  return html`<div class="gl-folha">
    <div class="gl-folha__topo"><span class="gl-marca">NGA ADV</span><span class="gl-kicker">VOLUME E MOVIMENTAÇÃO</span></div>
    <div class="gl-folha__tit"><h3>${r.periodo?.rotulo ? 'O período em números' : 'O mês em números'}</h3><span>${(r.cliente ?? '').toUpperCase()}</span></div>
    <p class="gl-folha__sub">${r.periodo?.descricao ?? ''} · ${r.fonte === 'astrea' ? 'registros do PDF do Astrea' : 'registros do LAB (DataJud, prazos, tarefas, reuniões e históricos)'}</p>
    <div class="gl-kpis">
      <div style="--c:#BE8E57"><b>${inteiro(r.registros)}</b><span>registros no ${r.fonte === 'astrea' ? 'Astrea' : 'LAB'}</span></div>
      <div style="--c:#BE8E57"><b>${inteiro(r.movimentados)}</b><span>processos movimentados</span></div>
      <div style="--c:#6FB0CE"><b>${media}</b><span>registros por processo</span></div>
      <div style="--c:#8FC3DB"><b>${r.ativos == null ? 'n/d' : inteiro(r.ativos)}</b><span>processos ativos na carteira</span></div>
    </div>
    <div class="gl-dupla"><div><h4>Registros por tipo</h4>${tipos.map(([n, v], i) => html`<div class="gl-barra"><span>${n.toUpperCase()}</span><i><em style="width:${Math.round(((v || 0) / max) * 100)}%;background:${cores[i]}"></em></i><b>${v || 0}</b></div>`)}</div>
      <div class="gl-valor"><small>VALOR TOTAL DAS CAUSAS CADASTRADAS</small><b>${moeda(r.valorCausas)}</b>${r.pecas != null ? html`<small class="gl-pecas">Peças protocoladas no período: ${r.pecas}</small>` : ''}</div></div>
    ${(r.avisos ?? []).length ? html`<ul class="gl-avisos">${r.avisos.map((a) => html`<li>${a}</li>`)}</ul>` : ''}
  </div>`;
}

const camposDoPedido = (opcoesProjeto) => html`
  ${opcoesProjeto ? html`<label class="gl-campo gl-campo--largo"><span>Cliente / projeto</span><select class="input" name="projeto" required><option value="">Escolha…</option>${opcoesProjeto}</select></label>` : ''}
  <label class="gl-campo"><span>Periodicidade</span><select class="input" name="periodicidade"><option value="mensal">Mensal</option><option value="quinzenal">Quinzenal</option><option value="semanal">Semanal</option></select></label>
  <label class="gl-campo" data-gl-mes><span>Mês</span><input class="input" type="month" name="mes" value="${mesPassado()}"></label>
  <label class="gl-campo" data-gl-dia hidden><span>Dia do período</span><input class="input" type="date" name="dia"></label>
  <label class="gl-campo"><span>Fonte dos dados</span><select class="input" name="fonte"><option value="lab">Dados do LAB</option><option value="astrea">PDF do Astrea</option></select></label>
  <label class="gl-campo gl-campo--largo" data-gl-arquivo hidden><span>PDF de fichas exportado do Astrea</span><input class="input" type="file" name="arquivo" accept="application/pdf"></label>`;

/** Bloco Processar → números → PDF. `projetoId` fixo (aba do projeto) ou escolhido (tela Relatórios). */
function blocoGerar({ projetoId = null, projetos = null, aoEmitir = () => {} }) {
  const opcoes = projetos ? projetos.map((p) => html`<option value="${p.id}">${p.nome}</option>`) : null;
  return {
    html: html`<form class="gl-form" data-gl-form novalidate><div class="gl-linha">${camposDoPedido(opcoes)}
        <button class="btn btn--accent" data-gl-processar>${icone('chart')}Processar</button></div></form>
      <div data-gl-resultado hidden></div>`,
    depois(el) {
      const form = el.querySelector('[data-gl-form]'); const saida = el.querySelector('[data-gl-resultado]');
      let ultimo = null;
      const alvo = () => projetoId ?? form.querySelector('[name=projeto]').value;
      const ajustar = () => {
        const per = form.querySelector('[name=periodicidade]').value;
        form.querySelector('[data-gl-mes]').hidden = per !== 'mensal'; form.querySelector('[data-gl-dia]').hidden = per === 'mensal';
        form.querySelector('[data-gl-arquivo]').hidden = form.querySelector('[name=fonte]').value !== 'astrea';
        ultimo = null; saida.hidden = true;
      };
      ouvir(form, 'change', 'select,input', ajustar);
      ouvir(form, 'click', '[data-gl-processar]', async (b, ev) => {
        ev?.preventDefault?.(); if (!alvo()) return toast('Escolha o cliente / projeto.', 'erro');
        b.disabled = true; b.classList.add('is-loading');
        try {
          ultimo = await pedirPdf(alvo(), form, 'previa');
          const r = { ...ultimo.resumo, fonte: form.querySelector('[name=fonte]').value };
          saida.innerHTML = String(html`${folhaDoMes(r)}<div class="gl-acoes"><span class="gl-nota">Relatório de atuação jurídica · modelo Quantitativo do Gerador (4 páginas)</span>
            <button class="btn btn--ghost btn--sm" data-gl-abrir>${icone('eye')}Abrir PDF</button><button class="btn btn--ghost btn--sm" data-gl-baixar>${icone('download')}Baixar</button>
            <button class="btn btn--accent btn--sm" data-gl-salvar>${icone('folder')}Salvar no acervo do projeto</button></div>`);
          saida.hidden = false;
        } catch (e) { erroDe(e); } finally { b.disabled = false; b.classList.remove('is-loading'); }
      });
      form.addEventListener('submit', (e) => e.preventDefault());
      ouvir(saida, 'click', '[data-gl-abrir]', () => { if (ultimo) window.open(URL.createObjectURL(ultimo.pdf), '_blank', 'noopener'); });
      ouvir(saida, 'click', '[data-gl-baixar]', () => { if (!ultimo) return; const a = document.createElement('a'); a.href = URL.createObjectURL(ultimo.pdf); a.download = ultimo.nome; a.click(); });
      ouvir(saida, 'click', '[data-gl-salvar]', async (b) => {
        b.disabled = true;
        try { const e = await pedirPdf(alvo(), form, 'emissoes'); toast(`Guardado no acervo: ${e.titulo}`); aoEmitir(e); } catch (e) { erroDe(e); } finally { b.disabled = false; }
      });
    },
  };
}

function formAgendamento(a) {
  const freq = a?.frequencia ?? '';
  const dias = freq === 'semanal' ? SEMANA.slice(1).map((d, i) => [i + 1, d]) : Array.from({ length: 28 }, (_, i) => [i + 1, `dia ${i + 1}`]);
  return html`<div class="gl-agenda" data-gl-agenda>
    <select class="input" name="frequencia" aria-label="Frequência"><option value="">Sem geração automática</option>${Object.entries(FREQ).map(([v, t]) => html`<option value="${v}" ${v === freq ? 'selected' : ''}>${t}</option>`)}</select>
    <select class="input" name="dia" aria-label="Dia" ${freq && freq !== 'quinzenal' ? '' : 'hidden'}>${dias.map(([v, t]) => html`<option value="${v}" ${v === (a?.dia ?? 1) ? 'selected' : ''}>${t}</option>`)}</select>
    <button class="btn btn--ghost btn--sm" data-gl-agendar>${icone('calendar')}Salvar</button>
    <small>${a?.frequencia ? html`${a.ativo ? '' : 'Pausado · '}Gera ${regraTxt(a)}. Próxima: <b>${dataBR(a.proximaEm)}</b>${a.ultimoErro ? html` · <span class="gl-erro">Falhou: ${a.ultimoErro}</span>` : ''}` : 'O relatório só sai quando alguém processar.'}</small></div>`;
}

function ligarAgendamento(raiz, seletor, recarregar) {
  ouvir(raiz, 'change', `${seletor}[data-gl-agenda] [name=frequencia]`, (s) => {
    const caixa = s.closest('[data-gl-agenda]'); const dia = caixa.querySelector('[name=dia]');
    dia.hidden = !s.value || s.value === 'quinzenal';
    const semanal = s.value === 'semanal'; const atual = Number(dia.value) || 1;
    dia.innerHTML = (semanal ? SEMANA.slice(1).map((d, i) => [i + 1, d]) : Array.from({ length: 28 }, (_, i) => [i + 1, `dia ${i + 1}`]))
      .map(([v, t]) => `<option value="${v}" ${v === (semanal ? Math.min(atual, 7) : atual) ? 'selected' : ''}>${t}</option>`).join('');
  });
  ouvir(raiz, 'click', `${seletor}[data-gl-agenda] [data-gl-agendar]`, async (b) => {
    const caixa = b.closest('[data-gl-agenda]'); const pid = caixa.closest('[data-projeto]').dataset.projeto;
    const frequencia = caixa.querySelector('[name=frequencia]').value; const dia = Number(caixa.querySelector('[name=dia]').value) || 1;
    b.disabled = true;
    try {
      if (frequencia) { const a = await api.put(`/api/projetos/${pid}/gerador-lab/agendamento`, { frequencia, dia, ativo: true }); toast(`Agendado: ${FREQ[frequencia].toLowerCase()}, próxima em ${dataBR(a.proximaEm)}.`); }
      else { await api.del(`/api/projetos/${pid}/gerador-lab/agendamento`).catch((e) => { if (e.status !== 404) throw e; }); toast('Geração automática desligada.'); }
      await recarregar();
    } catch (e) { erroDe(e); } finally { b.disabled = false; }
  });
}

const listaEmissoes = (lista) => (lista.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Período</th><th>Fonte</th><th class="num">Registros</th><th class="num">Movimentados</th><th>Gerado</th><th></th></tr></thead><tbody>
  ${lista.map((e) => html`<tr><td><b>${e.descricao}</b><small>${FREQ[e.periodicidade]}</small></td><td>${e.fonte === 'astrea' ? 'PDF do Astrea' : 'LAB'}</td><td class="num">${e.resumo?.registros ?? 0}</td><td class="num">${e.resumo?.movimentados ?? 0}</td>
    <td>${dataBR(e.geradoEm)}<small>${e.automatico ? 'automático' : e.por ?? ''}</small></td><td>${e.documentoId ? html`<a class="btn btn--ghost btn--sm" href="#/documentos/${e.documentoId}" data-gl-doc="${e.documentoId}">${icone('download')}PDF</a>` : ''}</td></tr>`)}</tbody></table></div>`
  : html`<p class="gl-vazio">Nenhum relatório gerado aqui ainda.</p>`);

async function baixarDocumento(id) {
  try { const r = await api.post(`/api/documentos/${id}/link`); window.open(r.url, '_blank', 'noopener'); } catch (e) { erroDe(e); }
}

/** Aba Relatórios do projeto. */
export function secaoGeradorDoProjeto(ctx) {
  const gerar = blocoGerar({ projetoId: ctx.id, aoEmitir: () => recarregar() });
  let el = null;
  async function recarregar() {
    if (!el) return;
    const [lista, agendas] = await Promise.all([api.get(`/api/projetos/${ctx.id}/gerador-lab/emissoes`).catch(() => []), api.get('/api/relatorios/agendamentos').catch(() => [])]);
    const a = agendas.find((x) => x.projetoId === ctx.id && x.id);
    el.querySelector('[data-gl-agenda-slot]').innerHTML = String(formAgendamento(a));
    el.querySelector('[data-gl-emissoes]').innerHTML = String(listaEmissoes(lista));
  }
  return {
    html: html`<section class="card glass up gl" data-projeto="${ctx.id}"><header class="card__head"><div><h2 class="card__title">${icone('relatorio')}Gerador de relatórios · NGA LAB</h2>
        <p class="card__sub">O mesmo relatório do Gerador (modelo Quantitativo), montado com os dados deste projeto no LAB: andamentos do DataJud, prazos, tarefas, reuniões, atas e históricos. Ainda dá para usar o PDF de fichas do Astrea como fonte.</p></div></header>
      ${gerar.html}
      <div class="gl-sub"><h3>Geração automática</h3><div data-gl-agenda-slot>${formAgendamento(null)}</div></div>
      <div class="gl-sub"><h3>Relatórios gerados</h3><div data-gl-emissoes><p class="gl-vazio">Carregando…</p></div></div></section>`,
    depois(raiz) {
      el = raiz.querySelector('.gl'); gerar.depois(el); ligarAgendamento(el, '', recarregar);
      ouvir(el, 'click', '[data-gl-doc]', (a, ev) => { ev?.preventDefault?.(); baixarDocumento(a.dataset.glDoc); });
      recarregar();
    },
  };
}

/** Tela Relatórios: painel do mês, gerar para qualquer cliente e a agenda de todos. */
export async function secaoGeradorGeral(projetos) {
  const agendas = await api.get('/api/relatorios/agendamentos').catch(() => []);
  const ativos = agendas.filter((a) => a.id && a.ativo);
  const mes = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  const noMes = agendas.filter((a) => a.ultimaEmissao && String(a.ultimaEmissao).slice(0, 7) === mes).length;
  const falhas = agendas.filter((a) => a.ultimoErro).length;
  const gerar = blocoGerar({ projetos });
  const linhas = () => html`${agendas.map((a) => html`<tr data-projeto="${a.projetoId}"><td><b>${a.projeto}</b><small>${a.ultimaEmissao ? `último relatório em ${dataBR(a.ultimaEmissao)}` : 'nenhum relatório gerado no LAB'}</small></td>
      <td>${formAgendamento(a.id ? a : null)}</td><td><a class="btn btn--ghost btn--sm" href="#/projetos/${a.projetoId}/relatorios">Abrir</a></td></tr>`)}`;
  return {
    html: html`<section class="card glass up mt gl"><header class="card__head"><div><h2 class="card__title">${icone('relatorio')}Gerador de relatórios · NGA LAB</h2>
        <p class="card__sub">Mesmo motor e mesmo PDF do Gerador (relatório mensal de atuação jurídica, 4 páginas), com os dados do LAB ou com o PDF de fichas do Astrea.</p></div></header>
      <div class="gl-painel"><div><b>${ativos.length}</b><span>${ativos.length === 1 ? 'cliente com geração automática' : 'clientes com geração automática'}</span></div><div><b>${noMes}</b><span>com relatório gerado neste mês</span></div>
        <div><b>${Math.max(0, projetos.length - ativos.length)}</b><span>sem agendamento</span></div><div class="${falhas ? 'is-erro' : ''}"><b>${falhas}</b><span>${plural(falhas, 'falha', 'falhas').replace(/^\d+ /, '')} na última rotina</span></div></div>
      ${gerar.html}</section>
      <section class="card glass up mt gl"><header class="card__head"><div><h2 class="card__title">${icone('calendar')}Agenda por cliente</h2>
        <p class="card__sub">Mensal (no dia escolhido, com o mês anterior), quinzenal (dias 1 e 16, com a quinzena anterior) ou semanal (no dia da semana escolhido, com a semana anterior). O PDF vai para o acervo do projeto; publicar ao cliente continua sendo um ato seu.</p></div></header>
        ${agendas.length ? html`<div class="tbl-wrap"><table class="tbl gl-tabela"><thead><tr><th>Cliente / projeto</th><th>Geração automática</th><th></th></tr></thead><tbody data-gl-linhas>${linhas()}</tbody></table></div>` : vazio('calendar', 'Nenhum projeto ativo', 'Os projetos aparecem aqui para agendar o relatório.')}</section>`,
    depois(el) {
      const [blocoA, blocoB] = el.querySelectorAll('.gl');
      if (blocoA) gerar.depois(blocoA);
      if (blocoB) ligarAgendamento(blocoB, '', async () => { const novas = await api.get('/api/relatorios/agendamentos'); agendas.splice(0, agendas.length, ...novas); blocoB.querySelector('[data-gl-linhas]').innerHTML = String(linhas()); });
    },
  };
}
