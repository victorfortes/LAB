/**
 * O hub do projeto — onde tudo é administrado.
 *
 * Um projeto é o caso do escritório. Esta tela junta o que antes eram módulos
 * soltos: fase processual (a trilha de marcos legais), tarefas, créditos,
 * processos e prazos, documentos, portal do cliente, plano e caixa, relatórios
 * e equipe. As abas trocam só o painel — sem recarregar a tela — e o endereço
 * acompanha (`#/projetos/<id>/<aba>`), então dá para copiar o link de uma aba.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { anel, animarAneis, animarBarras, contar } from '../fx.js';
import { $, $$, avatar, dataBR, dataCurta, relativo, html, icone, matiz, ouvir, pilha, raw, reais } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, menu, toast, vazio } from '../ui.js';
import { aoSair, atualizarLateral, ir, navegar, posicionarSeg } from '../shell.js';
import { htmlQuadro, ligarQuadro, novaTarefa } from './tarefas.js';
import { equipe as equipeDoEscritorio } from './tarefas.js';
import * as extra from './projeto_extra.js';
import { abaCreditos } from './projeto_creditos.js';
import { abaDiagnostico } from './projeto_diagnostico.js';
import { abaNegociacoes } from './projeto_negociacoes.js';
import { abaPesquisa } from './projeto_pesquisa.js';
import { cardsVisao, ligarVisao } from './projeto_visao_cards.js';
import { ligarArvore } from './projeto_arvore.js';
import { abaAtas } from './projeto_atas.js';

export { novoProcessoSolto } from './projeto_extra.js';

const ABAS = [
  { id: 'visao', rotulo: 'Visão geral', icone: 'home' },
  { id: 'pesquisa', rotulo: 'Pesquisa', icone: 'search', perm: 'documento.ler' },
  { id: 'diagnostico', rotulo: 'Diagnóstico', icone: 'sparkle', perm: 'analise.executar' },
  { id: 'tarefas', rotulo: 'Tarefas', icone: 'check', perm: 'tarefa.ler', n: (c) => c.tarefas_abertas },
  { id: 'negociacoes', rotulo: 'Negociações', icone: 'target', perm: 'negociacao.ler' },
  { id: 'creditos', rotulo: 'QGC', icone: 'scale', perm: 'credito.ler', n: (c) => c.creditos, alerta: (c) => c.creditos_a_validar },
  { id: 'processos', rotulo: 'Processos e prazos', icone: 'file', perm: 'processo.ler', n: (c) => c.processos, alerta: (c) => c.prazos_abertos },
  { id: 'documentos', rotulo: 'Documentos', icone: 'doc', perm: 'documento.ler', n: (c) => c.documentos, alerta: (c) => c.requisitos_a_analisar },
  { id: 'portal', rotulo: 'Portal do cliente', icone: 'eye', perm: 'documento.ler' },
  { id: 'plano', rotulo: 'Plano e caixa', icone: 'money', perm: 'plano.ler' },
  { id: 'relatorios', rotulo: 'Relatórios', icone: 'chart', perm: 'relatorio.gerar' },
  { id: 'atas', rotulo: 'Atas', icone: 'doc' },
  { id: 'equipe', rotulo: 'Equipe', icone: 'users', n: (c, h) => h.equipe.length },
];

const MODULOS = {
  visao: abaVisao, pesquisa: abaPesquisa, diagnostico: abaDiagnostico, negociacoes: abaNegociacoes, tarefas: abaTarefas, creditos: abaCreditos, processos: extra.abaProcessos,
  documentos: extra.abaDocumentos, portal: extra.abaPortal, plano: extra.abaPlano,
  relatorios: extra.abaRelatorios, equipe: abaEquipe, atas: abaAtas,
};

export default async function projeto({ id, aba }) {
  const [h, catalogo, tarefasAbertas] = await Promise.all([
    api.get(`/api/projetos/${id}`), api.get('/api/projetos/fases'),
    pode('tarefa.ler') ? api.get(`/api/tarefas?projeto=${id}`) : Promise.resolve({ resumo: { abertas: 0 } }),
  ]);
  h.contagens.tarefas_abertas = tarefasAbertas.resumo?.abertas ?? 0;
  const ctx = { id, h, catalogo, aba: null, ficha: 0 };
  const abasVisiveis = () => ABAS.filter((a) => !a.perm || pode(a.perm));
  const inicial = abasVisiveis().some((a) => a.id === aba) ? aba : 'visao';

  const cliente = h.empresas.find((e) => e.papel === 'recuperanda') ?? h.empresas[0];
  const encerrado = h.situacao === 'encerrado';
  const pr = h.progresso;

  const acoes = html`${pode('tarefa.escrever') && !encerrado ? html`<button type="button" class="btn btn--ghost" data-act="tarefa">${icone('plus')}Nova tarefa</button>` : ''}
    ${pode('projeto.escrever') ? html`<button type="button" class="ibtn" data-act="mais" aria-label="Mais ações" title="Mais ações">${icone('dots')}</button>` : ''}`;

  return {
    titulo: h.nome,
    html: html`
      <a class="crumb up" href="#/projetos">${icone('chevronLeft')}Projetos</a>
      ${cabecalho({
        titulo: h.nome,
        sub: `${cliente ? `${cliente.razao_social} · ` : ''}${h.rotuloDoTipo}${encerrado ? ` · encerrado em ${dataBR(h.encerrado_em)}` : ''}`,
        acoes,
        resumo: [
          { rotulo: 'Avanço', valor: pr ? pr.percentual : '—', sufixo: pr ? '%' : '' },
          { rotulo: 'Tarefas abertas', valor: h.contagens.tarefas_abertas },
          { rotulo: 'Prazos abertos', valor: Number(h.contagens.prazos_abertos), tom: Number(h.contagens.prazos_abertos) ? 'warn' : '' },
          { rotulo: 'Pendências', valor: Number(h.contagens.creditos_a_validar) + Number(h.contagens.requisitos_a_analisar), tom: 'warn' },
        ],
      })}
      <section class="card glass up mt" aria-label="Fase do processo">
        <header class="card__head"><div><h2 class="card__title">Fase do procedimento</h2>
          <p class="card__sub">${encerrado ? 'Projeto encerrado.' : pode('projeto.escrever') ? 'Clique numa fase para movimentar o projeto. Avance um passo por vez ou volte para uma fase anterior.' : 'Marcos legais do procedimento.'}</p></div>
          ${pr ? html`<span class="selo ok">${pr.indice} de ${pr.total}</span>` : ''}</header>
        ${trilha(ctx)}
        <div id="arvore-fase"></div>
      </section>
      <div class="tabs glass glass--chrome mt up" role="tablist" id="abas"><span class="tabs__pill" aria-hidden="true"></span>
        ${abasVisiveis().map((a) => html`<button type="button" role="tab" data-aba="${a.id}" aria-selected="${a.id === inicial}">${icone(a.icone)}<span>${a.rotulo}</span>${badge(a, h)}</button>`)}</div>
      <div id="aba" class="mt" aria-live="polite"></div>`,

    depois(raiz) {
      ctx.raiz = raiz; ctx.painel = $('#aba', raiz); ctx.abas = $('#abas', raiz); ctx.ativo = true;
      aoSair(() => { ctx.ativo = false; ctx.ficha++; });
      ouvir(raiz, 'click', '[data-aba]', (b) => abrirAba(ctx, b.dataset.aba));
      // Ao pousar o mouse numa aba, as leituras dela já vão sendo buscadas.
      const quente = { tarefas: [`/api/tarefas?projeto=${id}`], creditos: [`/api/projetos/${id}/creditos`, `/api/projetos/${id}/credores`], processos: [`/api/processos?projeto=${id}`],
        documentos: [`/api/projetos/${id}/documentos`], portal: [`/api/projetos/${id}/portal`, `/api/projetos/${id}/checklist`], plano: [`/api/projetos/${id}/obrigacoes`], relatorios: ['/api/relatorios/tipos'] };
      ouvir(raiz, 'pointerover', '[data-aba]', (b) => (quente[b.dataset.aba] ?? []).forEach((u) => api.aquecer(u)));
      ouvir(raiz, 'click', '[data-act=tarefa]', () => novaTarefa(() => (ctx.aba === 'tarefas' ? ctx.recarregar() : atualizarBadges(ctx)), id));
      ouvir(raiz, 'click', '[data-act=mais]', (b) => menuMais(b, ctx));
      ouvir(raiz, 'click', '[data-fase]', (b) => mudarFase(ctx, b.dataset.fase));
      ctx.recarregar = async () => { await atualizarBadges(ctx); await desenhar(ctx); };
      ctx.irParaAba = (a) => abrirAba(ctx, a);
      abrirAba(ctx, inicial, true);
      ligarArvore(ctx, $('#arvore-fase', raiz)).catch(console.error);
    },
  };
}

const badge = (a, h) => {
  const n = a.n?.(h.contagens, h); const al = a.alerta?.(h.contagens);
  return html`${n ? html`<b>${n}</b>` : ''}${Number(al) ? html`<b class="alerta" title="Precisa de atenção">${al}</b>` : ''}`;
};

function trilha(ctx) {
  const { h, catalogo } = ctx;
  const fases = h.fasesDisponiveis ?? catalogo.find((c) => c.tipo === h.tipo)?.fases ?? [];
  if (!fases.length) return html`<p class="dica">Este tipo de projeto não tem fases fixas.</p>`;
  const atual = fases.findIndex((f) => f.id === h.fase);
  const editavel = pode('projeto.escrever') && h.situacao !== 'encerrado';
  return html`<ol class="trilha" style="list-style:none;margin:0">${fases.map((f, i) => {
    const estado = i < atual ? 'feito' : i === atual ? 'atual' : 'futuro';
    const inner = html`<span class="passo__no">${estado === 'feito' ? icone('check') : i + 1}</span>
      <div class="passo__txt">${f.nome}<small>${f.fundamento ?? ''}</small></div>`;
    return html`<li class="passo ${estado}${editavel && i !== atual ? ' clicavel' : ''}" title="${f.marco}">${editavel && i !== atual
      ? html`<button type="button" data-fase="${f.id}" style="all:unset;cursor:pointer;display:block" aria-label="Mover para ${f.nome}">${inner}</button>` : inner}</li>`;
  })}</ol>`;
}

async function mudarFase(ctx, fase) {
  const nome = ctx.catalogo.find((c) => c.tipo === ctx.h.tipo)?.fases.find((f) => f.id === fase)?.nome ?? fase;
  try {
    await api.post(`/api/projetos/${ctx.id}/fase`, { fase });
    toast(`Fase: ${nome}`); atualizarLateral(); navegar();
  } catch (e) { toast(e.message, 'erro'); }
}

function menuMais(ancora, ctx) {
  const { h } = ctx;
  menu(ancora, [
    h.situacao !== 'encerrado' && { rotulo: 'Encerrar projeto', icone: 'inbox', perigo: true, acao: () => encerrar(ctx) },
    { rotulo: 'Copiar link desta aba', icone: 'link', acao: () => navigator.clipboard?.writeText(location.href).then(() => toast('Link copiado')) },
  ].filter(Boolean));
}

async function encerrar(ctx) {
  if (!(await confirmar('Encerrar este projeto?', 'O encerramento fica registrado com o motivo. As tarefas e o histórico permanecem consultáveis.', { rotulo: 'Continuar', perigo: true }))) return;
  await formulario({
    titulo: 'Encerrar projeto', subtitulo: ctx.h.nome, rotulo: 'Encerrar',
    campos: [{ nome: 'motivo', rotulo: 'Motivo do encerramento', tipo: 'textarea', obrigatorio: true, dica: 'Mínimo de 5 caracteres. Fica na auditoria.' }],
    async enviar(v) { await api.post(`/api/projetos/${ctx.id}/encerramento`, { motivo: v.motivo }); toast('Projeto encerrado'); atualizarLateral(); navegar(); },
  });
}

// ---------------------------------------------------------------- abas ---

async function abrirAba(ctx, aba, primeira = false) {
  if (!ctx.ativo) return;
  ctx.aba = aba;
  if (!primeira) history.replaceState(null, '', `#/projetos/${ctx.id}/${aba}`);
  $$('[data-aba]', ctx.abas).forEach((b) => b.setAttribute('aria-selected', b.dataset.aba === aba));
  posicionarSeg(ctx.abas);
  await desenhar(ctx);
}

async function desenhar(ctx) {
  const painel = ctx.painel; if (!ctx.ativo || !painel?.isConnected) return;
  const minha = ++ctx.ficha;
  // A aba anterior fica esmaecida; o esqueleto só aparece se a espera passar de ~150 ms.
  painel.classList.add('carregando');
  const espera = setTimeout(() => { if (minha === ctx.ficha && painel.isConnected) painel.innerHTML = '<div class="skel" style="height:220px;border-radius:24px"></div>'; }, painel.firstElementChild ? 150 : 0);
  try {
    const r = await MODULOS[ctx.aba](ctx);
    clearTimeout(espera); painel.classList.remove('carregando');
    if (minha !== ctx.ficha || !painel.isConnected) return;
    const vista = document.createElement('div'); vista.className = 'project-tab-root';
    vista.innerHTML = String(r.html); painel.replaceChildren(vista);
    $$('.up', painel).forEach((el, i) => el.style.setProperty('--i', Math.min(i, 10)));
    contar(painel); animarAneis(painel); animarBarras(painel);
    $$('.seg', painel).forEach(posicionarSeg);
    r.depois?.(vista);
  } catch (e) {
    clearTimeout(espera); painel.classList.remove('carregando');
    if (minha !== ctx.ficha || !painel.isConnected) return;
    console.error(e);
    painel.innerHTML = vazio('alert', 'Não foi possível abrir esta aba', e.message).toString();
  }
}

/** Atualiza os contadores das abas sem redesenhar a tela. */
export async function atualizarBadges(ctx) {
  try {
    const [h, t] = await Promise.all([api.get(`/api/projetos/${ctx.id}`), pode('tarefa.ler') ? api.get(`/api/tarefas?projeto=${ctx.id}`) : { resumo: { abertas: 0 } }]);
    if (!ctx.ativo) return;
    h.contagens.tarefas_abertas = t.resumo?.abertas ?? 0; ctx.h = h;
    for (const a of ABAS) {
      const btn = $(`[data-aba=${a.id}]`, ctx.abas); if (!btn) continue;
      $$('b', btn).forEach((b) => b.remove());
      btn.insertAdjacentHTML('beforeend', String(badge(a, h)));
    }
    posicionarSeg(ctx.abas);
  } catch { /* os contadores são conveniência */ }
}

// ----------------------------------------------------------- visão geral ---

async function abaVisao(ctx) {
  const { h } = ctx;
  const [neg, mensagens, visao] = await Promise.all([pode('negociacao.ler') ? api.get(`/api/projetos/${ctx.id}/negociacoes`).catch(() => null) : null, api.get(`/api/projetos/${ctx.id}/mensagens`), api.get(`/api/projetos/${ctx.id}/visao`)]); const c = h.contagens; const pr = h.progresso;
  const pend = [];
  if (Number(c.achados_criticos)) pend.push(['shield', `${c.achados_criticos} achado(s) crítico(s) em aberto`, 'Análise documental', 'erro', 'documentos']);
  if (Number(c.creditos_a_validar)) pend.push(['scale', `${c.creditos_a_validar} crédito(s) sem classe validada`, 'Validação humana exigida', 'aviso', 'creditos']);
  if (Number(c.requisitos_a_analisar)) pend.push(['doc', `${c.requisitos_a_analisar} documento(s) do cliente para analisar`, 'Portal do cliente', 'info', 'portal']);
  if (Number(c.prazos_abertos)) pend.push(['calendar', `${c.prazos_abertos} prazo(s) aberto(s)`, 'Processos e prazos', 'aviso', 'processos']);
  const doc = c.requisitos_obrigatorios ? Math.round((c.requisitos_aprovados / c.requisitos_obrigatorios) * 100) : null;
  return {
    html: html`${cardsVisao(h,visao)}<div class="grid-hub mt">
      <div style="display:grid;gap:var(--gap)">
        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Andamento</h2><p class="card__sub">${h.resumo ?? h.rotuloDoTipo}</p></div></header>
          <div class="cliente-hero">
            <span class="pring" style="--s:112px">${raw(anel(pr?.percentual ?? 0, { tam: 112, traco: 9, cor: 'var(--hue, var(--lab-amber))' }))}<b class="pring__val" style="font-size:24px">${pr ? `${pr.percentual}%` : '—'}</b></span>
            <div class="grow"><small class="muted">${pr?.proxima ? 'PRÓXIMA FASE' : 'FASE'}</small>
              <h3 style="margin:4px 0;font:700 24px var(--font-display)">${pr?.proxima?.nome ?? h.faseAtual?.nome ?? '—'}</h3>
              <p class="dica" style="margin:0">${pr?.proxima?.marco ?? h.faseAtual?.marco ?? ''}</p>
              ${(pr?.proxima?.fundamento ?? h.faseAtual?.fundamento) ? html`<span class="mono-sm">${pr?.proxima?.fundamento ?? h.faseAtual?.fundamento}</span>` : ''}</div>
          </div>
          <div class="grid3 mt" style="grid-template-columns:repeat(3,minmax(0,1fr))">
            ${mini('QGC', c.creditos, 'creditos')}${mini('Processos', c.processos, 'processos')}${mini('Documentos', c.documentos, 'documentos')}
          </div>
        </section>
        ${neg ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Negociações</h2><p class="card__sub">${neg.resumo.acordos ? `${neg.resumo.acordos} acordo(s) fechado(s)` : 'Frentes com credores'}</p></div><button class="link" data-aba-ir="negociacoes">Abrir quadro →</button></header>
          <div class="grid3" style="grid-template-columns:repeat(3,minmax(0,1fr))">
            <div class="stat"><span class="stat__label">Em negociação</span><span class="stat__value"><b data-n="${neg.resumo.emNegociacao}">0</b></span></div>
            <div class="stat"><span class="stat__label">Stand by</span><span class="stat__value"><b data-n="${neg.resumo.standBy}">0</b></span></div>
            <div class="stat"><span class="stat__label">Concluídas</span><span class="stat__value"><b data-n="${neg.resumo.concluidas}">0</b></span></div></div></section>` : ''}
        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Documentação do cliente</h2><p class="card__sub">${c.requisitos ? `${c.requisitos_aprovados} de ${c.requisitos_obrigatorios} obrigatórios aprovados` : 'O checklist ainda não foi gerado para este projeto.'}</p></div>
            <button class="link" data-aba-ir="portal">Abrir portal →</button></header>
          ${doc === null ? html`<p class="dica">Gere o checklist na aba <b>Portal do cliente</b> para o cliente saber o que enviar.</p>`
            : html`<div class="fase-card__bar" style="height:10px"><i data-w="${doc}" style="width:0;transition:width 1.1s var(--ease)"></i></div>
              <p class="mono-sm" style="margin-top:8px">${doc}% aprovado · ${c.documentos_publicados} publicado(s) no portal</p>`}
        </section>
      </div>
      <div style="display:grid;gap:var(--gap)">
        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Pedindo atenção</h2></div></header>
          ${pend.length ? html`<ul class="lista">${pend.map(([ic, t, s, tom, ab]) => html`<li style="cursor:pointer" data-aba-ir="${ab}"><span class="empty__ico" style="width:38px;height:38px;border-radius:12px">${icone(ic)}</span>
            <div><b>${t}</b><small>${s}</small></div><div class="fim"><span class="selo ${tom}">${tom === 'erro' ? 'urgente' : tom === 'aviso' ? 'atenção' : 'rotina'}</span></div></li>`)}</ul>`
            : vazio('check', 'Nada pendente', 'Sem crédito a validar, documento parado ou prazo aberto.')}
        </section>
        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Próximos prazos</h2></div><button class="link" data-aba-ir="processos">Processos →</button></header>
          ${h.proximosPrazos?.length ? html`<ul class="lista">${h.proximosPrazos.map((z) => html`<li><div><b>${z.titulo}</b><small>${z.numero}</small></div>
            <div class="fim"><span class="mono-sm">${dataBR(z.vencimento)}</span></div></li>`)}</ul>` : html`<p class="dica">Nenhum prazo aberto.</p>`}
        </section>
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Conversa com o cliente</h2><p class="card__sub">Conversa exclusiva de ${h.nome}.</p></div><button class="link" data-atualizar-chat>Atualizar</button></header>
          <div class="chat project-chat" data-chat-projeto>${[...mensagens].reverse().map((m) => html`<div class="msg ${m.lado === 'nga' ? 'meu' : ''}">${m.texto}<small>${m.autor ?? (m.lado === 'nga' ? 'NGA' : 'Cliente')} · ${relativo(m.criado_em)}</small></div>`)}</div>
          <form class="chat-in" data-enviar-chat><input class="input" name="texto" placeholder="Escreva para este cliente…" aria-label="Mensagem ao cliente deste projeto" autocomplete="off" required><button class="btn btn--accent" type="submit">${icone('send')}Enviar</button></form>
        </section>
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Onboarding e Drive</h2><p class="card__sub">Kickoff com Meet e pastas em CLIENTES REESTRUTURAÇÃO ou CLIENTES CIVEL.</p></div></header>
          <div class="project-tools">${pode('tarefa.escrever') ? html`<button class="btn btn--accent" data-kickoff>Agendar kickoff</button>` : ''}<button class="btn btn--ghost" data-drive>Preparar pastas</button><button class="btn btn--ghost" data-drive-sync>Sincronizar documentos</button></div><p class="dica" data-drive-estado></p>
        </section>
        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Equipe</h2></div><button class="link" data-aba-ir="equipe">Gerenciar →</button></header>
          <ul class="lista">${h.equipe.map((m) => html`<li>${avatar(m.nome, 'md')}<div><b>${m.nome}</b><small>${ROTULO_EQUIPE[m.papel] ?? m.papel}</small></div></li>`)}</ul>
        </section>
      </div></div>`,
    depois(el) {
      ligarVisao(el,ctx,visao);
      ouvir(el, 'click', '[data-aba-ir]', (b) => ctx.irParaAba(b.dataset.abaIr));
      const chat = $('[data-chat-projeto]', el); chat.scrollTop = chat.scrollHeight;
      ouvir(el, 'click', '[data-atualizar-chat]', () => ctx.recarregar());
      $('[data-enviar-chat]', el).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target, texto = f.elements.texto.value.trim(); if (!texto) return;
        const b = f.querySelector('button'); b.disabled = true;
        try { await api.post(`/api/projetos/${ctx.id}/mensagens`, { texto }); f.reset(); ctx.recarregar(); } catch (er) { erroDe(er); b.disabled = false; }
      });
      ouvir(el, 'click', '[data-kickoff]', () => formulario({ titulo: 'Agendar reunião de kickoff', subtitulo: h.nome, rotulo: 'Agendar', campos: [{ nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, metade: true }, { nome: 'hora', rotulo: 'Início', tipo: 'time', obrigatorio: true, metade: true, valor: '10:00' }], async enviar(v) { const inicio = new Date(`${v.data}T${v.hora}:00-03:00`); const r = await api.post('/api/google/eventos', { projetoId: ctx.id, titulo: `Kickoff · ${h.nome}`, inicio: inicio.toISOString(), fim: new Date(inicio.getTime() + 3600000).toISOString(), descricao: 'Reunião inicial do projeto.', marcador: 'cliente', criarMeet: true }); if (r.pendente) throw new Error(r.erro ?? 'Google indisponível: confira a conexão em Ajustes.'); toast('Kickoff agendado'); } }).then((ok) => ok && ctx.recarregar()));
      ouvir(el, 'click', '[data-drive], [data-drive-sync]', async (b) => {
        b.disabled = true;
        try { const r = await api.post(`/api/google/projetos/${ctx.id}/${b.hasAttribute('data-drive-sync') ? 'documentos' : 'drive'}`); $('[data-drive-estado]', el).textContent = r.url ? `Pastas preparadas: ${r.url}` : (r.sincronizados !== undefined ? `${r.sincronizados} documento(s) sincronizado(s)` : 'Pastas do projeto preparadas no Drive.'); toast('Google Drive atualizado'); }
        catch (er) { erroDe(er); } finally { b.disabled = false; }
      });
      const t = setInterval(async () => {
        if (!ctx.ativo || ctx.aba !== 'visao' || !el.isConnected) return clearInterval(t);
        try { const novas = await api.get(`/api/projetos/${ctx.id}/mensagens`); if (ctx.ativo && novas[0]?.id !== mensagens[0]?.id) { clearInterval(t); ctx.recarregar(); } } catch { /* próxima consulta */ }
      }, 8000); aoSair(() => clearInterval(t));
    },
  };
}
const ROTULO_EQUIPE = { lider: 'Líder', advogado: 'Advogado(a)', apoio: 'Apoio', revisor: 'Revisor(a)' };
const mini = (r, n, aba) => html`<button type="button" class="stat" data-aba-ir="${aba}" style="text-align:left;cursor:pointer"><span class="stat__label">${r}</span><span class="stat__value"><b data-n="${Number(n)}">0</b></span></button>`;

// --------------------------------------------------------------- tarefas ---

async function abaTarefas(ctx) {
  const dados = await api.get(`/api/tarefas?projeto=${ctx.id}`);
  const lista = dados.tarefas;
  return {
    html: html`<div class="flex up" style="margin-bottom:12px"><span class="dica">${dados.resumo.abertas} aberta(s) · arraste entre as colunas; concluídas somem do quadro após 14 dias.</span>
      <span class="grow"></span>${pode('tarefa.escrever') && ctx.h.situacao !== 'encerrado' ? html`<button type="button" class="btn btn--accent" data-nova="a_fazer">${icone('plus')}Nova tarefa</button>` : ''}</div>
      <div class="up">${htmlQuadro(lista, { mostrarProjeto: false })}</div>`,
    depois(el) { ligarQuadro(el, lista, () => ctx.recarregar(), ctx.id); },
  };
}

// ---------------------------------------------------------------- equipe ---

async function abaEquipe(ctx) {
  const { h } = ctx; const editar = pode('projeto.escrever') && h.situacao !== 'encerrado';
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Quem trabalha neste projeto</h2><p class="card__sub">O líder responde pelo caso; o acesso a dados segue o vínculo do escritório.</p></div>
      ${editar ? html`<button type="button" class="btn btn--accent" data-add>${icone('plus')}Incluir pessoa</button>` : ''}</header>
      <ul class="lista">${h.equipe.map((m) => html`<li>${avatar(m.nome, 'md')}<div><b>${m.nome}</b><small>${m.email} · desde ${dataBR(m.desde)}</small></div>
        <div class="fim flex"><span class="selo ${m.papel === 'lider' ? 'ok' : 'info'}">${ROTULO_EQUIPE[m.papel] ?? m.papel}</span>
        ${editar ? html`<button type="button" class="ibtn ibtn--sm" data-sair="${m.id}" aria-label="Retirar ${m.nome}" title="Retirar da equipe">${icone('x')}</button>` : ''}</div></li>`)}</ul></section>`,
    depois(el) {
      ouvir(el, 'click', '[data-add]', async () => {
        const todos = await equipeDoEscritorio();
        const livres = todos.filter((u) => !h.equipe.some((m) => m.email === u.email));
        if (!livres.length) return toast('Todos do escritório já estão na equipe.', 'aviso');
        await formulario({
          titulo: 'Incluir na equipe', rotulo: 'Incluir',
          campos: [
            { nome: 'usuarioId', rotulo: 'Pessoa', tipo: 'select', obrigatorio: true, opcoes: livres.map((u) => ({ v: u.id, t: `${u.nome}` })) },
            { nome: 'papel', rotulo: 'Papel no projeto', tipo: 'select', valor: 'advogado', opcoes: [{ v: 'lider', t: 'Líder' }, { v: 'advogado', t: 'Advogado(a)' }, { v: 'revisor', t: 'Revisor(a)' }, { v: 'apoio', t: 'Apoio' }] },
          ],
          async enviar(v) { await api.post(`/api/projetos/${ctx.id}/equipe`, v); toast('Pessoa incluída'); },
        });
        await ctx.recarregar(); atualizarLateral();
      });
      ouvir(el, 'click', '[data-sair]', async (b) => {
        if (!(await confirmar('Retirar da equipe?', 'A pessoa deixa de ver este projeto, a menos que ainda tenha outro vínculo.', { rotulo: 'Retirar', perigo: true }))) return;
        try { await api.del(`/api/equipe/${b.dataset.sair}`); toast('Retirado da equipe'); await ctx.recarregar(); } catch (e) { erroDe(e); }
      });
    },
  };
}
