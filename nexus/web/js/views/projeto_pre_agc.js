/**
 * Aba QGC, vistas por tipo de projeto:
 *  - Recuperação extrajudicial → "Adesões ao PRE": quem já assinou, por espécie, frente a 1/3 (pedido) e
 *    mais da metade (homologação) do art. 163, com o prazo de 90 dias do § 7º.
 *  - Recuperação judicial → "Simulador da AGC": um voto hipotético por credor e a apuração da lei
 *    (instalação do art. 37, § 2º; classes do art. 45; cram down do art. 58, § 1º).
 * Os números vêm do servidor (centavos inteiros, sem arredondar quórum no navegador).
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, html, icone, ouvir, raw } from '../util.js';
import { confirmar, erroDe, formulario, toast, vazio } from '../ui.js';

const SITUACOES = { pendente: 'Pendente', negociando: 'Negociando', aderiu: 'Aderiu', recusou: 'Recusou' };
const TOM_SITUACAO = { pendente: '', negociando: 'info', aderiu: 'ok', recusou: 'erro' };
const pctBr = (n) => `${String(Math.round(n * 10) / 10).replace('.', ',')}%`;
const barra = (valor, marcas) => html`<div class="qmeter" role="img" aria-label="${pctBr(valor)}"><i style="width:${Math.min(100, Math.max(0, valor))}%"></i>${marcas.map((m) => html`<span class="qmeter__marca" style="left:${m.em}%" title="${m.rotulo}"><em>${m.rotulo}</em></span>`)}</div>`;

// ================================================================== PRE ===

export async function qgcPre(ctx) {
  const d = await api.get(`/api/projetos/${ctx.id}/pre`);
  const escreve = pode('credito.escrever') && ctx.h.situacao !== 'encerrado';
  const especies = [...new Set(d.linhas.map((l) => l.especie))].sort();
  const status = d.podeHomologar ? ['ok', 'Quórum de homologação atingido em todas as espécies', 'Mais da metade de cada espécie abrangida assinou (art. 163, caput).']
    : d.podePedir ? ['info', 'Já é possível pedir a homologação', 'Todas as espécies têm pelo menos 1/3 (art. 163, § 7º). A maioria precisa vir em até 90 dias do pedido.']
      : ['aviso', 'Ainda abaixo de 1/3 em alguma espécie', 'O pedido exige pelo menos 1/3 de cada espécie abrangida (art. 163, § 7º).'];
  const prazo = d.prazo ? html`<div class="qbanner__prazo ${d.prazo.diasRestantes < 0 ? 'erro' : d.prazo.diasRestantes <= 15 ? 'aviso' : ''}"><small>Prazo do § 7º</small><b>${d.prazo.diasRestantes < 0 ? `vencido há ${-d.prazo.diasRestantes} dia(s)` : `${d.prazo.diasRestantes} dia(s)`}</b><i>até ${dataBR(d.prazo.limite)}</i></div>`
    : html`<div class="qbanner__prazo"><small>Prazo do § 7º</small><b>—</b><i>informe a data do pedido</i></div>`;

  const cardEspecie = (e) => html`<article class="card glass qespecie ${e.atingiuMaioria ? 'qespecie--ok' : e.atingiuTerco ? 'qespecie--meio' : ''}">
    <header><h3>${e.especie}</h3><span class="selo ${e.atingiuMaioria ? 'ok' : e.atingiuTerco ? 'info' : 'aviso'}">${e.atingiuMaioria ? 'maioria' : e.atingiuTerco ? '1/3 atingido' : 'abaixo de 1/3'}</span></header>
    <div class="qespecie__num"><b>${pctBr(e.percentual)}</b><small>R$ ${e.aderido} de R$ ${e.total}</small></div>
    ${barra(e.percentual, [{ em: 100 / 3, rotulo: '1/3' }, { em: 50, rotulo: '50%' }])}
    <dl class="qespecie__dl"><div><dt>Falta para 1/3</dt><dd>${e.atingiuTerco ? '—' : `R$ ${e.faltaTerco}`}</dd></div><div><dt>Falta para a maioria</dt><dd>${e.atingiuMaioria ? '—' : `R$ ${e.faltaMaioria}`}</dd></div>
      <div><dt>Negociando</dt><dd>R$ ${e.negociando}</dd></div><div><dt>Recusaram</dt><dd>R$ ${e.recusado}</dd></div></dl>
    ${e.caminho.length ? html`<details class="qespecie__caminho"><summary>Caminho mais curto para a maioria (${e.caminho.length} credor${e.caminho.length > 1 ? 'es' : ''})</summary><ol>${e.caminho.map((c) => html`<li><span>${c.credor}</span><b>R$ ${c.valor}</b>${c.situacao === 'negociando' ? html`<em>negociando</em>` : ''}</li>`)}</ol></details>` : ''}
  </article>`;

  const linha = (l) => html`<tr data-credito="${l.creditoId}" class="${!l.abrangido || l.art43 ? 'qfora' : ''}">
    <td><b>${l.credor}</b><small>${l.documento ?? ''}</small></td>
    <td>${escreve ? html`<input class="input input--tabela" list="pre-especies" data-campo="especie" value="${l.especie}" aria-label="Espécie de ${l.credor}" title="Padrão: ${l.especiePadrao}">` : l.especie}</td>
    <td class="num">${l.valorFormatado}</td>
    <td>${escreve ? html`<select class="select input--tabela qsit qsit--${l.situacao}" data-campo="situacao" aria-label="Situação de ${l.credor}">${Object.entries(SITUACOES).map(([v, t]) => html`<option value="${v}" ${v === l.situacao ? raw('selected') : ''}>${t}</option>`)}</select>`
      : html`<span class="selo ${TOM_SITUACAO[l.situacao]}">${SITUACOES[l.situacao]}</span>`}</td>
    <td>${escreve && l.situacao === 'aderiu' ? html`<input type="date" class="input input--tabela" data-campo="assinadoEm" value="${l.assinadoEm ?? ''}" aria-label="Data da assinatura">` : l.assinadoEm ? dataBR(l.assinadoEm) : '—'}</td>
    <td class="qcheck"><label title="Abrangido pelo plano"><input type="checkbox" data-campo="abrangido" ${l.abrangido ? raw('checked') : ''} ${escreve ? '' : raw('disabled')}><span class="sr-only">Abrangido</span></label></td>
    <td class="qcheck"><label title="Pessoa do art. 43 (não conta no percentual)"><input type="checkbox" data-campo="art43" ${l.art43 ? raw('checked') : ''} ${escreve ? '' : raw('disabled')}><span class="sr-only">Art. 43</span></label></td>
  </tr>`;

  return {
    acoes: escreve ? html`<button type="button" class="btn btn--ghost" data-pre-pedido>${icone('calendar')}Data do pedido</button>` : '',
    html: d.linhas.length ? html`
      <section class="card glass up qbanner qbanner--${status[0]}">
        <div class="qbanner__txt"><span class="nx-eyebrow">Adesões ao PRE</span><h2>${status[1]}</h2><p>${status[2]}</p></div>
        <div class="qbanner__kpis"><div><small>Aderiram</small><b>${d.totais.aderiram}<i>/${d.totais.abrangidos}</i></b></div>${prazo}</div>
      </section>
      <div class="qgrid-especies mt">${d.especies.map(cardEspecie)}</div>
      <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Credores</h2><p class="card__sub">${d.totais.foraDoPlano} fora do plano · ${d.totais.art43} do art. 43 · a alteração salva ao sair do campo</p></div>
        <label class="qfiltro"><span class="sr-only">Filtrar</span><input class="input" type="search" placeholder="Buscar credor" data-pre-busca></label></header>
        <div class="tbl-wrap"><table class="tbl qpre-tabela"><thead><tr><th>Credor</th><th>Espécie</th><th class="num">Valor (R$)</th><th>Situação</th><th>Assinatura</th><th title="Abrangido pelo plano">No plano</th><th title="Pessoa do art. 43">Art. 43</th></tr></thead>
          <tbody>${d.linhas.map(linha)}</tbody></table></div>
        <datalist id="pre-especies">${especies.map((e) => html`<option value="${e}"></option>`)}</datalist></section>
      <details class="card glass up mt qfund"><summary>Fundamentos usados na conta</summary><ul>${d.fundamentos.map((f) => html`<li>${f}</li>`)}</ul></details>`
      : html`<section class="card glass up">${vazio('scale', 'Sem credores no QGC validado', 'As adesões ao PRE partem do QGC validado. Valide as linhas do QGC automático ou importe a relação de credores.', '')}</section>`,
    depois(el) {
      const salvar = async (tr, corpo) => {
        try { await api.put(`/api/projetos/${ctx.id}/pre/adesoes/${tr.dataset.credito}`, corpo); toast('Salvo'); ctx.recarregar(); } catch (e) { erroDe(e); }
      };
      el.addEventListener('change', (e) => {
        const campo = e.target.closest('[data-campo]'); const tr = campo?.closest('[data-credito]'); if (!tr) return;
        const k = campo.dataset.campo;
        const v = campo.type === 'checkbox' ? campo.checked : campo.value.trim() || null;
        if (k === 'especie' && !v) return salvar(tr, { especie: null });
        salvar(tr, { [k]: v });
      });
      ouvir(el, 'input', '[data-pre-busca]', (inp) => {
        const q = inp.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        el.querySelectorAll('.qpre-tabela tbody tr').forEach((tr) => { tr.hidden = !!q && !tr.textContent.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q); });
      });
      ouvir(el, 'click', '[data-pre-pedido]', () => formulario({ titulo: 'Data do pedido de homologação', subtitulo: 'Abre o prazo de 90 dias do art. 163, § 7º. Deixe em branco se o pedido ainda não foi distribuído.', rotulo: 'Salvar',
        campos: [{ nome: 'data', rotulo: 'Data do pedido', tipo: 'date', valor: d.dataPedido ?? '' }],
        async enviar(v) { await api.put(`/api/projetos/${ctx.id}/pre`, { dataPedido: v.data || null }); } }).then((ok) => ok && ctx.recarregar()));
    },
  };
}

// ================================================================== AGC ===

const VOTOS = [['sim', 'Sim'], ['nao', 'Não'], ['abstencao', 'Abst.'], ['ausente', 'Ausente']];

/** Quórum e poder de voto: quem decide cada classe, a partir da relação de credores (QGC validado). */
function poderHtml(classes) {
  if (!classes.length) return '';
  return html`<section class="card glass qpoder"><header class="card__head"><div><h2 class="card__title">Quórum e poder de voto</h2><p class="card__sub">A partir da relação final de credores. Em destaque, o menor grupo de credores que decide cada classe pelo valor.</p></div></header>
    <div class="qpoder__classes">${classes.map((c) => html`<article class="qpoder__classe">
      <header><b>Classe ${c.classe}</b><small>${c.nome}</small><span class="grow"></span><span class="mono-sm">R$ ${c.total} · ${pctBr(c.percentualDoTotal)} do total</span></header>
      <div class="qpoder__kpis"><div><small>Credores</small><b>${c.credores}</b></div>
        <div><small>Maioria por cabeça</small><b>${c.minimoParaCabecas}</b><i>credores</i></div>
        ${c.criterio === 'cumulativo' ? html`<div><small>Decidem pelo valor</small><b>${c.minimoParaValor}</b><i>maior(es) credor(es)</i></div>` : html`<div><small>Critério</small><b>Cabeça</b><i>art. 45, § 2º</i></div>`}
        <div><small>Maior credor</small><b>${pctBr(c.concentracao)}</b><i>da classe</i></div></div>
      <ol class="qpoder__lista">${c.lista.slice(0, 12).map((x) => html`<li class="${x.decisivo && c.criterio === 'cumulativo' ? 'is-decisivo' : ''}"><span class="qpoder__nome">${x.credor}</span>
        <span class="qpoder__barra"><i style="width:${Math.max(2, x.percentualClasse)}%"></i></span><span class="mono-sm">${pctBr(x.percentualClasse)}</span><small class="mono-sm">R$ ${x.valor}</small></li>`)}
        ${c.lista.length > 12 ? html`<li class="qpoder__mais">+ ${c.lista.length - 12} credor(es) menores</li>` : ''}</ol></article>`)}</div></section>`;
}

export async function qgcAgc(ctx) {
  const nomeSalvo = sessionStorage.getItem(`agcCenario.${ctx.id}`);
  const d = await api.get(`/api/projetos/${ctx.id}/agc/simulador${nomeSalvo ? `?cenario=${encodeURIComponent(nomeSalvo)}` : ''}`);
  const escreve = pode('credito.escrever') && ctx.h.situacao !== 'encerrado';
  const estado = { nome: d.cenario.nome, convocacao: d.cenario.convocacao, votos: { ...d.cenario.votos }, sujo: false };
  const porClasse = ['I', 'II', 'III', 'IV'].map((k) => [k, d.cabecas.filter((c) => c.classe === k)]).filter(([, l]) => l.length);

  const resultadoHtml = (a) => {
    const [tom, titulo, sub] = !a.instalada ? ['erro', 'A assembleia não se instala', 'Em 1ª convocação, cada classe precisa de presentes com mais da metade do valor (art. 37, § 2º).']
      : a.aprovadoPeloArt45 ? ['ok', 'Plano aprovado', 'Todas as classes votantes aprovaram (art. 45).']
        : a.cramDown.cabivel ? ['info', 'Rejeitado no art. 45, mas cabe cram down', 'Os três incisos do art. 58, § 1º estão atendidos. Falta o juízo do § 2º (sem tratamento diferenciado na classe que rejeitou).']
          : ['aviso', 'Plano rejeitado', 'Nem o art. 45 nem o cram down do art. 58, § 1º são atingidos neste cenário.'];
    const cd = a.cramDown;
    const item = (ok, rotulo, det) => html`<li class="${ok ? 'ok' : ''}"><span class="qdot">${ok ? '✓' : '✕'}</span><div><b>${rotulo}</b><small>${det}</small></div></li>`;
    return html`<section class="card glass qbanner qbanner--${tom}">
        <div class="qbanner__txt"><span class="nx-eyebrow">Resultado do cenário · ${estado.convocacao === 'primeira' ? '1ª' : '2ª'} convocação</span><h2>${titulo}</h2><p>${sub}</p></div>
        <div class="qbanner__kpis"><div><small>Classes aprovadas</small><b>${a.classes.filter((c) => c.aprovada).length}<i>/${a.classes.filter((c) => c.presentes.credores).length}</i></b></div>
          <div><small>Valor favorável (todas)</small><b>${pctBr(cd.incisoI.percentual)}</b></div></div>
      </section>
      <div class="qgrid-classes mt">${a.classes.map((c) => html`<article class="card glass qclasse ${c.aprovada ? 'qclasse--ok' : c.presentes.credores ? 'qclasse--nao' : ''}">
        <header><div><h3>Classe ${c.classe}</h3><small>${c.nome}</small></div><span class="selo ${!c.presentes.credores ? '' : c.aprovada ? 'ok' : 'erro'}">${!c.presentes.credores ? 'sem votos' : c.aprovada ? 'aprova' : 'rejeita'}</span></header>
        <div class="qclasse__linha"><span>Por cabeça <em>${c.sim.credores} de ${c.presentes.credores}</em></span><b>${pctBr(c.percentualCabecas)}</b></div>
        ${barra(c.percentualCabecas, [{ em: 50, rotulo: '50%' }])}
        ${c.criterio === 'cumulativo' ? html`<div class="qclasse__linha"><span>Por valor <em>R$ ${c.sim.valor} de R$ ${c.presentes.valor}</em></span><b>${pctBr(c.percentualValor ?? 0)}</b></div>${barra(c.percentualValor ?? 0, [{ em: 50, rotulo: '50%' }])}` : html`<p class="qclasse__nota">Classe ${c.classe} vota só por cabeça (art. 45, § 2º).</p>`}
        <footer><span title="Art. 37, § 2º">${c.instalada ? '✓' : '✕'} presença ${pctBr(c.presentes.percentualValorDaClasse)} do valor</span>
          ${c.presentes.credores && !c.aprovada ? html`<span class="qfalta">falta ${c.faltaCabecas ? `${c.faltaCabecas} credor(es)` : ''}${c.faltaCabecas && c.criterio === 'cumulativo' && c.faltaValor !== '0,00' ? ' e ' : ''}${c.criterio === 'cumulativo' && c.faltaValor !== '0,00' ? `R$ ${c.faltaValor}` : ''}</span>` : ''}</footer>
      </article>`)}</div>
      ${!a.aprovadoPeloArt45 ? html`<section class="card glass mt qcram"><header class="card__head"><div><h2 class="card__title">Cram down · art. 58, § 1º</h2><p class="card__sub">Os três requisitos são cumulativos e valem na mesma assembleia.</p></div><span class="selo ${cd.cabivel ? 'ok' : 'aviso'}">${cd.cabivel ? 'cabível' : 'não cabível'}</span></header>
        <ul class="qcheck-lista">
          ${item(cd.incisoI.atendido, 'I · Mais da metade do valor de todos os presentes', `R$ ${cd.incisoI.valorSim} de R$ ${cd.incisoI.valorPresente} (${pctBr(cd.incisoI.percentual)})`)}
          ${item(cd.incisoII.atendido, `II · Aprovação de ${cd.incisoII.exigidas} classe(s)`, `${cd.incisoII.classesAprovadas} aprovada(s) de ${cd.incisoII.classesVotantes} votante(s). Lei 14.112/2020: 3 classes; 2, se só 3 votarem; 1, se só 2.`)}
          ${item(cd.incisoIII.atendido, 'III · Mais de 1/3 a favor na classe que rejeitou', cd.incisoIII.classesRejeitantes.length ? cd.incisoIII.classesRejeitantes.map((r) => `Classe ${r.classe}: ${pctBr(r.proporcao)} por cabeça${r.proporcaoValor !== null ? ` e ${pctBr(r.proporcaoValor)} por valor` : ''}`).join(' · ') : 'Nenhuma classe rejeitou.')}
        </ul>${cd.ressalvas.map((r) => html`<p class="dica">${r}</p>`)}</section>` : ''}
      <details class="card glass mt qfund"><summary>Ressalvas da apuração</summary><ul>${a.ressalvas.map((r) => html`<li>${r}</li>`)}</ul></details>`;
  };

  const linhaVoto = (c) => {
    const v = estado.votos[c.chave] ?? 'ausente';
    return html`<li class="qvoto" data-chave="${c.chave}"><div class="qvoto__quem"><b>${c.credor}</b><small>R$ ${c.valor}${c.creditos > 1 ? ` · ${c.creditos} créditos` : ''}${c.desdobrada ? ' · desdobrado (art. 41, § 2º)' : ''}</small></div>
      <div class="qvoto__opcoes" role="radiogroup" aria-label="Voto de ${c.credor}">${VOTOS.map(([k, t]) => html`<button type="button" role="radio" aria-checked="${v === k}" class="qv qv--${k}" data-voto="${k}">${t}</button>`)}</div></li>`;
  };

  return {
    acoes: html`<label class="qcenario"><span class="sr-only">Cenário</span><select class="select" data-agc-cenario>${[...new Set([estado.nome, ...d.cenarios.map((c) => c.nome)])].map((n) => html`<option ${n === estado.nome ? raw('selected') : ''}>${n}</option>`)}<option value="__novo">+ Novo cenário</option></select></label>
      <div class="seg" role="group" aria-label="Convocação"><button type="button" data-agc-conv="primeira" aria-pressed="${estado.convocacao === 'primeira'}">1ª convocação</button><button type="button" data-agc-conv="segunda" aria-pressed="${estado.convocacao === 'segunda'}">2ª</button></div>
      ${escreve ? html`<button type="button" class="btn btn--accent" data-agc-salvar disabled>Salvar cenário</button>` : ''}`,
    html: d.cabecas.length ? html`
      ${d.pendentesDeValidacao ? html`<p class="dica up" style="margin:0 0 12px">${d.pendentesDeValidacao} crédito(s) ainda usam a classe sugerida. ${d.naoSujeitos ? `${d.naoSujeitos} não sujeito(s) ficam fora da votação.` : ''}</p>` : ''}
      <div class="qagc">
        <div class="qagc__resultado" data-agc-resultado>${resultadoHtml(d.apuracao)}</div>
        ${poderHtml(d.poderDeVoto ?? [])}
        <section class="card glass qagc__votos"><header class="card__head"><div><h2 class="card__title">Votos do cenário</h2><p class="card__sub">Toque para mudar. O resultado recalcula na hora.</p></div></header>
          ${porClasse.map(([k, lista]) => html`<div class="qvotos-classe"><div class="qvotos-classe__head"><b>Classe ${k}</b><span>${lista.length} credor(es)</span>
            <span class="grow"></span>${VOTOS.map(([v, t]) => html`<button type="button" class="ibtn-txt" data-todos="${k}:${v}" title="Marcar toda a classe ${k} como ${t}">${t === 'Abst.' ? 'Abst.' : t}</button>`)}</div>
            <ul class="qvotos-lista">${lista.map(linhaVoto)}</ul></div>`)}
        </section>
      </div>`
      : html`<section class="card glass up">${vazio('scale', 'Sem credores votantes', 'O simulador usa o QGC validado. Valide as linhas do QGC automático ou importe a relação de credores.', '')}</section>`,
    depois(el) {
      const box = el.querySelector('[data-agc-resultado]'); const btnSalvar = el.querySelector('[data-agc-salvar]');
      let timer; let seq = 0;
      const recalcular = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const n = ++seq;
          try {
            const r = await api.put(`/api/projetos/${ctx.id}/agc/simulador`, { nome: estado.nome, convocacao: estado.convocacao, votos: estado.votos, rascunho: true });
            if (n === seq && box) box.innerHTML = String(resultadoHtml(r.apuracao));
          } catch (e) { erroDe(e); }
        }, 180);
        estado.sujo = true; if (btnSalvar) btnSalvar.disabled = false;
      };
      const marcar = (chave, voto) => {
        estado.votos[chave] = voto;
        el.querySelectorAll(`[data-chave="${CSS.escape(chave)}"] [data-voto]`).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.voto === voto)));
      };
      ouvir(el, 'click', '[data-voto]', (b) => { marcar(b.closest('[data-chave]').dataset.chave, b.dataset.voto); recalcular(); });
      ouvir(el, 'click', '[data-todos]', (b) => { const [k, v] = b.dataset.todos.split(':'); d.cabecas.filter((c) => c.classe === k).forEach((c) => marcar(c.chave, v)); recalcular(); });
      ouvir(el, 'click', '[data-agc-conv]', (b) => { estado.convocacao = b.dataset.agcConv; el.querySelectorAll('[data-agc-conv]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); recalcular(); });
      ouvir(el, 'click', '[data-agc-salvar]', async (b) => {
        b.disabled = true;
        try { await api.put(`/api/projetos/${ctx.id}/agc/simulador`, { nome: estado.nome, convocacao: estado.convocacao, votos: estado.votos }); estado.sujo = false; toast(`Cenário "${estado.nome}" salvo`); sessionStorage.setItem(`agcCenario.${ctx.id}`, estado.nome); }
        catch (e) { b.disabled = false; erroDe(e); }
      });
      ouvir(el, 'change', '[data-agc-cenario]', async (s) => {
        if (estado.sujo && !(await confirmar('Trocar de cenário?', 'Os votos alterados e não salvos deste cenário serão perdidos.', { rotulo: 'Trocar' }))) { s.value = estado.nome; return; }
        if (s.value === '__novo') {
          let nome;
          const ok = await formulario({ titulo: 'Novo cenário', subtitulo: 'Começa com todos os credores ausentes.', rotulo: 'Criar', campos: [{ nome: 'nome', rotulo: 'Nome do cenário', obrigatorio: true, placeholder: 'Ex.: bancos contra, trabalhistas a favor' }],
            async enviar(v) { nome = v.nome.trim().slice(0, 60); if (escreve) await api.put(`/api/projetos/${ctx.id}/agc/simulador`, { nome, convocacao: 'primeira', votos: {} }); } });
          if (!ok) { s.value = estado.nome; return; }
          sessionStorage.setItem(`agcCenario.${ctx.id}`, nome);
        } else sessionStorage.setItem(`agcCenario.${ctx.id}`, s.value);
        ctx.recarregar();
      });
    },
  };
}
