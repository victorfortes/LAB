/**
 * O painel do cliente — o mesmo visual do LAB, com o que é do cliente.
 *
 * Aqui não há botão que o servidor vá recusar por causa de papel: a navegação
 * só oferece o que o cliente pode fazer. Mas quem garante o isolamento é o RLS
 * do banco (§6.1); esta tela apenas não finge que o resto existe.
 */
import { avisosDoCliente, onboardingDoCliente } from './avisos_portal.js';
import { api } from '../api.js';
import { estado, pode } from '../estado.js';
import { anel } from '../fx.js';
import { $, dataBR, guardado, hojeISO, html, icone, avatar, ouvir, paraCentavos, raw, relativo, tamanho } from '../util.js';
import { cabecalho, erroDe, formulario, toast, vazio } from '../ui.js';
import { painelFinanceiroProjeto } from './projeto_financeiro.js';
import { atualizarLateral, navegar } from '../shell.js';

const TITULOS = { inicio: 'Visão geral', andamento: 'Andamento', documentos: 'Documentos', faturas: 'Faturas', plano: 'Plano de pagamento', caixa: 'Financeiro', atas: 'Atas de reunião', relatorios: 'Relatórios' };
const SUB = {
  andamento: 'O que aconteceu em cada processo, em linguagem simples.', documentos: 'O que a NGA precisa de você e o que já foi conferido.',
  faturas: 'Honorários e despesas, com o comprovante de cada pagamento.', plano: 'As obrigações do plano de recuperação judicial aprovado, com credor, valor e vencimento.',
  caixa: 'O fechamento de cada mês e a saúde financeira da empresa.', atas: 'Pauta, decisões e encaminhamentos de cada reunião.', relatorios: 'Acompanhamento mensal e quadros preparados para você.',
};
const SIT = { pendente: ['', 'Pendente'], enviado: ['info', 'Enviado'], em_analise: ['info', 'Em análise'], aprovado: ['ok', 'Aprovado'], rejeitado: ['erro', 'Rejeitado'], complementacao: ['aviso', 'Complementar'], nao_aplicavel: ['', 'Não se aplica'] };
const STATUS_FATURA = {
  a_vencer: ['info', 'A vencer'], vencida: ['erro', 'Vencida'], paga_em_conferencia: ['aviso', 'Paga · em conferência'], paga: ['ok', 'Paga'], cancelada: ['', 'Cancelada'],
};
const brl = (v) => `R$ ${v}`;
const primeiroNome = () => String(estado.eu?.usuario?.nome ?? '').split(/\s+/)[0] || 'cliente';
const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };
const prazoRotulo = (f) => (f.status === 'vencida' ? `venceu há ${Math.abs(f.diasParaVencer)} dia(s)` : f.diasParaVencer === 0 ? 'vence hoje' : f.diasParaVencer === 1 ? 'vence amanhã' : `vence em ${f.diasParaVencer} dias`);

export default async function portal({ aba }) {
  const projetos = estado.portal.length ? estado.portal : await api.get('/api/portal/projetos');
  const proj = projetos.find((p) => p.projeto_id === estado.projetoDoCliente) ?? projetos[0];
  if (!proj) {
    return { titulo: 'Portal', html: html`<div class="empty up"><div class="empty__ico">${icone('lock')}</div><h3>Nenhum processo liberado ainda</h3>
      <p>Seu acesso está ativo, mas o escritório ainda não vinculou um projeto a você.</p></div>` };
  }
  const corpo = await ABAS[aba](proj);
  // Avisos do escritório (ex.: nova ação encontrada pelo Sentinela) abrem o início do portal.
  if (aba === 'inicio') { const [av, onb] = await Promise.all([avisosDoCliente(), onboardingDoCliente(proj.projeto_id)]); if (onb) { corpo.html = html`${onb}<div class="mt"></div>${corpo.html}`; } if (av.html) { const d0 = corpo.depois; corpo.html = html`${av.html}<div class="mt"></div>${corpo.html}`; corpo.depois = (el, pj) => { av.depois(el); d0?.(el, pj); }; } }
  const cab = aba === 'inicio' ? '' : cabecalho({ titulo: TITULOS[aba], sub: `${SUB[aba] ?? ''}`, resumo: corpo.resumo ?? [] });
  return {
    titulo: TITULOS[aba],
    html: html`<div class="nx-page" data-projeto-portal="${proj.projeto_id}">${aba === 'inicio' ? '' : html`<p class="nx-trail"><span>${proj.nome}</span></p>`}${cab}<div class="${aba === 'inicio' ? 'nx-contents' : 'mt'}">${corpo.html}</div></div>`,
    depois: (el) => corpo.depois?.(el, proj),
  };
}

const bloqueado = (o) => ({ html: html`<section class="card glass up">${vazio('lock', 'Área não habilitada', `O escritório não liberou ${o} para o seu acesso. Se precisar, fale com a NGA pelo grupo de WhatsApp.`)}</section>` });
/** O plano de pagamento só existe para quem está em recuperação judicial. */
export const ehRJ = (p) => p?.tipo === 'recuperacao_judicial';
const botaoWhats = (p, classe = 'btn btn--accent') => p.whatsapp_grupo_url ? html`<a class="${classe}" href="${p.whatsapp_grupo_url}" target="_blank" rel="noopener noreferrer">${icone('comment')}Entrar no grupo do WhatsApp</a>` : '';

// ------------------------------------------------------------------ início ---

async function inicio(p) {
  const [hub, catalogo, check, ob, procs, negs, visao, fat] = await Promise.all([
    api.get(`/api/projetos/${p.projeto_id}`).catch(() => null), api.get('/api/projetos/fases').catch(() => []),
    api.get(`/api/projetos/${p.projeto_id}/checklist`).catch(() => null),
    p.mostra_obrigacoes && ehRJ(p) ? api.get(`/api/projetos/${p.projeto_id}/obrigacoes`).catch(() => null) : null,
    api.get('/api/processos').catch(() => []),
    api.get(`/api/portal/projetos/${p.projeto_id}/negociacoes`).catch(() => []),
    api.get(`/api/projetos/${p.projeto_id}/visao`).catch(() => ({ marcos: [] })),
    p.mostra_faturas === false ? null : api.get(`/api/faturas?projeto=${p.projeto_id}`).catch(() => null),
  ]);
  const meus = procs.filter((x) => x.projeto_id === p.projeto_id);
  const fases = hub ? (catalogo.find((c) => c.tipo === hub.tipo)?.fases ?? []) : [];
  const atual = hub ? fases.findIndex((f) => f.id === hub.fase) : -1;
  const pr = check?.progresso; const falta = check?.itens.filter((i) => i.aguardaVoce) ?? [];
  const pagas = ob?.resumo.total ? Math.round((ob.resumo.pagas / ob.resumo.total) * 100) : null;
  const proxParcela = ob?.obrigacoes?.find((x) => !x.pago);
  const prox = fat?.resumo.proxima ?? null; const rf = fat?.resumo; const hon = rf?.proximaHonorarios ?? null;
  const marcos = (visao.marcos ?? []).slice(0, 6);
  // O andamento mais recente, dos processos liberados (até 3, em paralelo).
  const movs = (await Promise.all(meus.slice(0, 3).map((x) => api.get(`/api/processos/${x.id}`).catch(() => null))))
    .flatMap((d) => (d?.movimentacoes ?? []).map((m) => ({ ...m, numero: d.numero, classe: d.classe }))).sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 4);

  return {
    html: html`
    <section class="nx-hero up">
      <div class="nx-hero__text">
        <span class="nx-eyebrow">Portal do cliente · NGA Advogados</span>
        <h1>${saudacao()}, ${primeiroNome()}.</h1>
        <p class="nx-hero__proj"><b>${p.nome}</b>${hub?.rotuloDoTipo ? html` <i>·</i> ${hub.rotuloDoTipo}` : ''}</p>
        <div class="nx-hero__chips">
          ${hub?.faseAtual ? html`<span class="selo aviso"><i></i>${hub.faseAtual.nome}</span>` : ''}
          ${hub?.progresso ? html`<span class="selo ok">${hub.progresso.percentual}% do caminho</span>` : ''}
          ${falta.length ? html`<span class="selo erro">${falta.length} item(ns) aguardam você</span>` : html`<span class="selo ok"><i></i>Nada pendente com você</span>`}
        </div>
      </div>
      <div class="nx-hero__acts">${botaoWhats(p)}<a class="btn btn--ghost" href="#/documentos">${icone('upload')}Enviar documentos</a>${p.whatsapp_grupo_url ? '' : html`<small class="dica">O grupo de WhatsApp será liberado pela equipe.</small>`}</div>
    </section>

    <div class="nx-kpis${ehRJ(p) ? '' : ' nx-kpis--3'}">
      <a class="nx-kpi up" href="#/documentos"><span class="nx-kpi__label">Documentação</span>
        <span class="nx-kpi__ring"><span class="pring" style="--s:64px">${raw(anel(pr?.percentualAprovado ?? 0, { tam: 64, traco: 6, cor: 'var(--lab-amber)' }))}<b class="pring__val" style="font-size:14px">${pr ? `${pr.percentualAprovado}%` : '—'}</b></span></span>
        <b class="nx-kpi__big">${pr ? `${pr.aprovados}/${pr.obrigatorios}` : '—'}</b><small>${pr ? 'documentos aprovados' : 'lista ainda não montada'}</small></a>
      <a class="nx-kpi up ${hon?.status === 'vencida' ? 'is-alert' : ''}" href="#/faturas"><span class="nx-kpi__label">Próxima parcela de honorários</span>
        ${hon ? html`<b class="nx-kpi__big">${brl(hon.valorFormatado)}</b><small>vence em ${dataBR(hon.vencimento)}${rf.honorarios.total > 1 ? ` · ${rf.honorarios.pagas} de ${rf.honorarios.total} pagas` : ''}</small><span class="selo ${STATUS_FATURA[hon.status][0]}">${prazoRotulo(hon)}</span>`
          : html`<b class="nx-kpi__big">—</b><small>${fat ? (rf.honorarios.pagas ? 'Honorários em dia. Obrigado!' : 'Nenhuma parcela lançada') : 'Não liberada'}</small>`}</a>
      ${ehRJ(p) ? html`<a class="nx-kpi up" href="#/plano"><span class="nx-kpi__label">Plano de recuperação</span>
        ${pagas === null ? html`<b class="nx-kpi__big">—</b><small>${p.mostra_obrigacoes ? 'O plano aprovado ainda não foi cadastrado' : 'Não liberado'}</small>`
          : html`<b class="nx-kpi__big">${ob.resumo.pagas}/${ob.resumo.total}</b><small>${proxParcela ? `próxima obrigação: ${dataBR(proxParcela.vencimento)}` : 'obrigações cumpridas'}</small>${ob.resumo.vencidas ? html`<span class="selo erro">${ob.resumo.vencidas} vencida(s)</span>` : html`<span class="selo ok">em dia</span>`}`}</a>` : ''}
      <a class="nx-kpi up" href="#/andamento"><span class="nx-kpi__label">Processos</span><b class="nx-kpi__big">${meus.length}</b><small>${movs[0] ? `última movimentação em ${dataBR(movs[0].data)}` : 'acompanhe o andamento'}</small></a>
    </div>

    <div class="nx-grid">
      <div class="nx-col">
        ${fases.length ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Onde está o seu processo</h2>
          <p class="card__sub">${hub.faseAtual?.nome ?? ''}${hub.faseAtual?.marco ? ` — ${hub.faseAtual.marco}` : ''}</p></div></header>
          <ol class="trilha" style="list-style:none;margin:0">${fases.map((f, i) => html`<li class="passo ${i < atual ? 'feito' : i === atual ? 'atual' : 'futuro'}" title="${f.marco}"><span class="passo__no">${i < atual ? icone('check') : i + 1}</span><div class="passo__txt">${f.nome}</div></li>`)}</ol></section>` : ''}
        ${movs.length ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Andamento recente</h2><p class="card__sub">O que a equipe publicou para você</p></div><a class="link" href="#/andamento">Ver tudo →</a></header>
          <ul class="tl">${movs.map((m) => html`<li><time>${dataBR(m.data)}</time><p><b>${m.titulo}</b></p>${m.resumo_ao_cliente ? html`<p class="dica">${m.resumo_ao_cliente}</p>` : ''}<span class="mono-sm">${m.classe ?? ''} ${m.numero}</span></li>`)}</ul></section>` : ''}
        ${marcos.length ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Marcos do seu projeto</h2><p class="card__sub">Entregas compartilhadas pela equipe</p></div></header>
          <ul class="lista">${marcos.map((m) => html`<li><span class="selo ${m.concluidoEm ? 'ok' : 'info'}">${m.concluidoEm ? 'Concluído' : 'Previsto'}</span><div><b>${m.titulo}</b>${m.descricao ? html`<small>${m.descricao}</small>` : ''}</div><span class="mono-sm">${m.dataPrevista ? dataBR(m.dataPrevista) : 'Sem data'}</span></li>`)}</ul></section>` : ''}
        ${negs.length ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Negociações em andamento</h2><p class="card__sub">O que a NGA está tratando com credores em seu nome</p></div></header>
          <ul class="lista">${negs.map((n) => html`<li><span class="selo ${n.status === 'concluida' ? 'ok' : n.status === 'stand_by' ? 'info' : 'aviso'}">${n.status === 'concluida' ? 'Concluída' : n.status === 'stand_by' ? 'Stand by' : 'Em negociação'}</span><div><b>${n.titulo}</b><small>${n.contraparte ?? ''}${n.resumo ? ` · ${n.resumo}` : ''}</small></div>${n.desfecho ? html`<span class="selo ${n.desfecho === 'acordo' ? 'ok' : 'erro'}">${n.desfecho === 'acordo' ? 'Acordo' : 'Sem acordo'}</span>` : ''}</li>`)}</ul></section>` : ''}
      </div>
      <aside class="nx-col">
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">O que falta de você</h2><p class="card__sub">Itens que dependem do seu envio</p></div><a class="link" href="#/documentos">Enviar →</a></header>
          ${falta.length ? html`<div>${falta.slice(0, 5).map((i) => html`<div class="check-row"><span class="sit-dot ${i.situacao}"></span><div><b>${i.titulo}</b><small>${i.categoria}${i.observacao ? ` · ${i.observacao}` : ''}</small></div><span class="selo ${SIT[i.situacao]?.[0] ?? ''}">${i.rotuloDaSituacao}</span></div>`)}${falta.length > 5 ? html`<p class="dica mt">e mais ${falta.length - 5} item(ns)</p>` : ''}</div>`
            : vazio('check', 'Nada pendente com você', 'Quando o escritório precisar de algo, aparece aqui.')}</section>
        ${prox ? html`<section class="card glass up nx-fatura-card ${prox.status === 'vencida' ? 'is-alert' : ''}"><header class="card__head"><div><h2 class="card__title">Próxima fatura</h2><p class="card__sub">${prox.numero} · ${prox.rotuloDoTipo}</p></div><span class="selo ${STATUS_FATURA[prox.status][0]}">${prazoRotulo(prox)}</span></header>
          <b class="nx-money">${brl(prox.valorFormatado)}</b><p class="dica">${prox.descricao} · vencimento ${dataBR(prox.vencimento)}</p>
          <div class="flex"><a class="btn btn--accent" href="#/faturas">${icone('upload')}Anexar comprovante</a>${rf.emAberto > 1 ? html`<small class="dica">+ ${rf.emAberto - 1} em aberto</small>` : ''}</div></section>` : ''}
        <section class="card glass up nx-whats"><span class="nx-whats__ico">${icone('comment')}</span><div><h2 class="card__title">Grupo do WhatsApp</h2>
          ${p.whatsapp_grupo_url ? html`<a class="nx-whats__link" href="${p.whatsapp_grupo_url}" target="_blank" rel="noopener noreferrer">${p.whatsapp_grupo_url.replace(/^https?:\/\//, '')} ↗</a>`
            : html`<p class="dica">O link do grupo do seu caso será informado pela equipe.</p>`}</div></section>
      </aside>
    </div>`,
  };
}

// --------------------------------------------------------------------- faturas ---

async function faturas(p) {
  if (p.mostra_faturas === false) return bloqueado('as faturas');
  const { faturas: lista, resumo: r } = await api.get(`/api/faturas?projeto=${p.projeto_id}`);
  const abertas = lista.filter((f) => f.situacao === 'aberta'); const outras = lista.filter((f) => f.situacao !== 'aberta');
  const item = (f) => {
    const [tom, rot] = STATUS_FATURA[f.status] ?? ['', f.status];
    return html`<article class="nx-fat card glass up ${f.status === 'vencida' ? 'is-alert' : ''}" data-fatura="${f.id}">
      <div class="nx-fat__main"><span class="mono-sm">${f.numero} · ${f.rotuloDoTipo}${f.competencia ? ` · ${f.competencia}` : ''}</span><h3>${f.descricao}</h3>
        <p class="dica">Emitida em ${dataBR(f.emissao)} · vencimento ${dataBR(f.vencimento)}${f.situacao === 'aberta' ? ` · ${prazoRotulo(f)}` : ''}${f.pagoEm ? ` · pago em ${dataBR(f.pagoEm)}` : ''}</p>
        ${f.linhaDigitavel ? html`<p class="mono-sm nx-linha" title="Linha digitável">${f.linhaDigitavel}</p>` : ''}
        ${f.observacao && f.situacao === 'aberta' ? html`<p class="nota">${f.observacao}</p>` : ''}</div>
      <div class="nx-fat__side"><b class="nx-money">${brl(f.valorFormatado)}</b><span class="selo ${tom}"><i></i>${rot}</span>
        <div class="nx-fat__acts">
          ${f.documentoId ? html`<button type="button" class="btn btn--ghost btn--sm" data-baixar="${f.documentoId}">${icone('download')}Boleto / guia</button>` : ''}
          ${f.situacao === 'aberta' ? html`<label class="btn btn--accent btn--sm" style="cursor:pointer">${icone('upload')}Anexar comprovante<input type="file" hidden data-comprovante="${f.id}" accept=".pdf,.png,.jpg,.jpeg"></label>` : ''}
          ${f.comprovanteId ? html`<button type="button" class="btn btn--ghost btn--sm" data-baixar="${f.comprovanteId}">${icone('doc')}Meu comprovante</button>` : ''}</div></div></article>`;
  };
  return {
    resumo: [{ rotulo: 'Em aberto', valor: r.emAberto, tom: r.emAberto ? 'warn' : '' }, { rotulo: 'Vencidas', valor: r.vencidas, tom: r.vencidas ? 'alert' : '' }, { rotulo: 'Pagas', valor: r.pagas, tom: 'ok' }],
    html: html`${r.proxima ? html`<section class="card glass up nx-destaque ${r.proxima.status === 'vencida' ? 'is-alert' : ''}"><div><span class="nx-eyebrow">Próxima fatura</span><b class="nx-money nx-money--xl">${brl(r.proxima.valorFormatado)}</b>
        <p class="dica">${r.proxima.descricao} · vence em ${dataBR(r.proxima.vencimento)} (${prazoRotulo(r.proxima)})</p></div>
        <div class="nx-destaque__soma"><small>Total em aberto</small><b>${brl(r.totalAbertoFormatado)}</b>${r.vencidas ? html`<small class="nx-neg">Vencido: ${brl(r.totalVencidoFormatado)}</small>` : ''}</div></section>` : ''}
      ${lista.length ? html`<h2 class="mini-h mt">Em aberto</h2>${abertas.length ? abertas.map(item) : html`<section class="card glass up">${vazio('check', 'Nenhuma fatura em aberto', 'Tudo em dia.')}</section>`}
        ${outras.length ? html`<h2 class="mini-h mt">Histórico</h2>${outras.map(item)}` : ''}`
        : html`<section class="card glass up">${vazio('money', 'Nenhuma fatura emitida', 'As faturas e boletos do seu caso aparecem aqui. Para cada pagamento, anexe o comprovante: é ele que marca a fatura como paga.')}</section>`}
      <p class="dica mt">A fatura passa a constar como <b>paga</b> assim que você anexa o comprovante; o financeiro da NGA confere em seguida e, se algo não bater, ela volta a ficar em aberto com o motivo.</p>`,
    depois(el) {
      ouvir(el, 'click', '[data-baixar]', async (b) => { try { const x = await api.post(`/api/documentos/${b.dataset.baixar}/link`); window.open(x.url, '_blank', 'noopener'); } catch (e) { erroDe(e); } });
      el.addEventListener('change', async (e) => {
        const inp = e.target.closest('input[data-comprovante]'); if (!inp?.files[0]) return;
        const fd = new FormData(); fd.append('arquivo', inp.files[0]);
        try { await api.enviar(`/api/faturas/${inp.dataset.comprovante}/comprovante`, fd); toast('Comprovante recebido. A fatura consta como paga e será conferida pelo financeiro.'); atualizarLateral(); navegar(); } catch (er) { erroDe(er); }
      });
    },
  };
}

// O cliente não lê o que enviou antes de a NGA publicar (RLS, de propósito), então o
// "enviados agora" é o registro local desta máquina — só serve de recibo.
const recentes = (p) => guardado.ler(`enviados.${p.projeto_id}`, []).filter((r) => Date.now() - r.quando < 36 * 3600 * 1000).map((r) => ({ ...r, quando: new Date(r.quando).toISOString() }));
const guardarRecente = (p, f) => guardado.gravar(`enviados.${p.projeto_id}`, [{ nome: f.name, tamanho: f.size, quando: Date.now() }, ...guardado.ler(`enviados.${p.projeto_id}`, [])].slice(0, 12));

// --------------------------------------------------------------- andamento ---

async function andamento(p) {
  const procs = (await api.get('/api/processos')).filter((x) => x.projeto_id === p.projeto_id);
  if (!procs.length) return { html: html`<section class="card glass up">${vazio('scale', 'Sem processos para mostrar', 'O escritório publica aqui o andamento que você precisa acompanhar, com um resumo em linguagem simples.')}</section>` };
  const dets = await Promise.all(procs.map((x) => api.get(`/api/processos/${x.id}`)));
  return {
    html: html`${dets.map((d) => html`<section class="card glass up" style="margin-bottom:var(--gap)"><header class="card__head"><div><h2 class="card__title">${d.classe ?? 'Processo'}</h2><p class="card__sub mono-sm">${d.numero} · ${[d.tribunal, d.comarca].filter(Boolean).join(' · ')}</p></div>
      <span class="selo ${d.situacao === 'ativo' ? 'ok' : 'aviso'}"><i></i>${d.situacao}</span></header>
      ${d.suspenso_motivo ? html`<p class="dica">${d.suspenso_motivo}${d.suspenso_ate ? ` — até ${dataBR(d.suspenso_ate)}` : ''}</p>` : ''}
      ${d.movimentacoes.length ? html`<ul class="tl">${d.movimentacoes.map((m) => html`<li><time>${dataBR(m.data)}</time><p><b>${m.titulo}</b></p>${m.resumo_ao_cliente ? html`<p class="dica">${m.resumo_ao_cliente}</p>` : ''}</li>`)}</ul>`
        : html`<p class="dica">Ainda não há movimentações publicadas para você.</p>`}</section>`)}`,
  };
}

// --------------------------------------------------------------- documentos ---

async function documentos(p) {
  if (!p.mostra_documentos) return bloqueado('os documentos');
  const [check, docs] = await Promise.all([api.get(`/api/projetos/${p.projeto_id}/checklist`), api.get(`/api/projetos/${p.projeto_id}/documentos`)]);
  const porCat = new Map(); for (const i of check.itens) { if (!porCat.has(i.categoria)) porCat.set(i.categoria, []); porCat.get(i.categoria).push(i); }
  return {
    resumo: check.itens.length ? [{ rotulo: 'Aprovados', valor: check.progresso.aprovados }, { rotulo: 'Obrigatórios', valor: check.progresso.obrigatorios }, { rotulo: 'Aguardando você', valor: check.progresso.aguardandoOCliente, tom: 'warn' }] : [],
    html: html`<label class="drop up" id="soltar" tabindex="0"><input type="file" id="arq" hidden multiple>${icone('upload')}
        <b>Solte aqui os seus documentos</b><small>Pode enviar tudo de uma vez, sem se preocupar com a ordem: o sistema lê cada arquivo, reconhece o tipo e a equipe da NGA organiza no lugar certo.</small></label>
      ${recentes(p).length ? html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Enviados agora</h2><p class="card__sub">Recebidos e em leitura pela NGA</p></div></header>
        <ul class="lista">${recentes(p).map((r) => html`<li><span class="empty__ico" style="width:36px;height:36px;border-radius:11px">${icone('doc')}</span><div><b>${r.nome}</b><small>${relativo(r.quando)} · ${tamanho(r.tamanho)}</small></div>
          <div class="fim"><span class="leitura lendo"><i class="vivo ambar"></i>Em leitura</span></div></li>`)}</ul></section>` : ''}
      <details class="card glass up mt">
      <summary class="checklist-summary"><b>Checklist de documentos</b>
        ${check.progresso.obrigatorios ? html`<span class="selo info">${check.progresso.percentualEnviado}% entregue</span>
          <small>${check.progresso.enviados} de ${check.progresso.obrigatorios} obrigatórios enviados · ${check.progresso.percentualAprovado}% aprovado</small>`
          : html`<small>${check.itens.length ? 'Sem itens obrigatórios' : 'Aguardando a lista do escritório'}</small>`}
      </summary>
      <p class="dica mt">Envie cada arquivo no item correspondente. O escritório confere e responde aqui.</p>
      ${check.itens.length ? [...porCat].map(([cat, itens]) => html`<h3 class="mini-h">${cat}</h3>${itens.map((i) => html`<div class="check-row${i.situacao === 'nao_aplicavel' ? ' na' : ''}"><span class="sit-dot ${i.situacao}"></span>
        <div><b>${i.titulo}${i.obrigatorio ? '' : html` <span class="muted">(opcional)</span>`}</b><small>${i.fundamento ?? ''}</small>${i.atribuicao ? html`<span class="atrib">${String(i.atribuicao).split('/').map((x) => html`<i>${x.trim()}</i>`)}</span>` : ''}${i.observacao ? html`<small class="obs">${i.observacao}</small>` : ''}
          ${i.documentos?.length ? html`<ul class="req-arquivos">${i.documentos.map((d) => html`<li>${icone('doc')}<span>${d.titulo}</span><small>${tamanho(d.tamanho_bytes)} · ${dataBR(d.enviado_em)}</small></li>`)}</ul>` : ''}</div>
        <span class="selo ${SIT[i.situacao]?.[0] ?? ''}">${i.rotuloDaSituacao}${i.documentos?.length > 1 ? ` · ${i.documentos.length} arquivos` : ''}</span>
        ${['pendente', 'rejeitado', 'complementacao', 'enviado', 'em_analise'].includes(i.situacao) ? html`<label class="btn ${i.documentos?.length && !['rejeitado', 'complementacao'].includes(i.situacao) ? 'btn--ghost' : 'btn--accent'}" style="cursor:pointer" title="Pode escolher vários arquivos de uma vez">${icone('upload')}${i.documentos?.length ? 'Adicionar arquivos' : 'Enviar'}<input type="file" hidden multiple data-req="${i.id}" data-t="${i.titulo}" data-c="${i.categoria}"></label>` : ''}</div>`)}`)
        : vazio('doc', 'A lista ainda não foi montada', 'Assim que o escritório definir o que precisa, os itens aparecem aqui.')}</details>
      <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Documentos do escritório para você</h2></div></header>
        ${docs.filter((d) => d.visibilidade === 'publicado').length ? html`<ul class="lista">${docs.filter((d) => d.visibilidade === 'publicado').map((d) => html`<li>${icone('doc')}<div><b>${d.titulo}</b><small>${d.categoria ?? ''} · ${tamanho(d.tamanho_bytes)} · publicado ${relativo(d.publicado_em)}</small></div>
          ${d.tem_arquivo ? html`<div class="fim"><button type="button" class="btn btn--ghost" data-baixar="${d.id}">${icone('download')}Baixar</button></div>` : ''}</li>`)}</ul>` : html`<p class="dica">Nenhum documento publicado para você ainda.</p>`}</section>`,
    depois(el) {
      const drop = $('#soltar', el); const entrada = $('#arq', el);
      const enviar = async (arquivos) => {
        let ok = 0;
        for (const f of arquivos) {
          drop.classList.add('over');
          const fd = new FormData(); fd.append('arquivo', f); fd.append('titulo', f.name.replace(/\.[^.]+$/, '')); fd.append('categoria', 'Enviado pelo cliente');
          try { await api.enviar(`/api/projetos/${p.projeto_id}/documentos`, fd); ok++; guardarRecente(p, f); } catch (er) { erroDe(er); }
        }
        drop.classList.remove('over');
        if (ok) { toast(`${ok} documento(s) recebido(s). A leitura começou.`); navegar(); }
      };
      entrada.addEventListener('change', (e) => enviar([...e.target.files]));
      ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => enviar([...e.dataTransfer.files]));
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.click(); } });
      ouvir(el, 'click', '[data-baixar]', async (b) => { try { const r = await api.post(`/api/documentos/${b.dataset.baixar}/link`); window.open(r.url, '_blank', 'noopener'); } catch (e) { erroDe(e); } });
      el.addEventListener('change', async (e) => {
        const inp = e.target.closest('input[data-req]'); if (!inp?.files?.length) return;
        const arquivos = [...inp.files]; let ok = 0;
        for (const f of arquivos) {
          // Com vários arquivos, cada um leva o próprio nome junto do item ("Balanço · 2023.pdf").
          const titulo = arquivos.length > 1 ? `${inp.dataset.t} · ${f.name.replace(/\.[^.]+$/, '')}` : inp.dataset.t;
          const fd = new FormData(); fd.append('arquivo', f); fd.append('titulo', titulo); fd.append('categoria', inp.dataset.c); fd.append('requisitoId', inp.dataset.req);
          try { await api.enviar(`/api/projetos/${p.projeto_id}/documentos`, fd); ok++; } catch (er) { erroDe(er); }
        }
        if (ok) { toast(ok > 1 ? `${ok} arquivos enviados. O escritório vai conferir.` : 'Documento enviado. O escritório vai conferir.'); navegar(); }
      });
    },
  };
}

// -------------------------------------------------------------- plano/caixa ---

async function plano(p) {
  if (!ehRJ(p)) return { html: html`<section class="card glass up">${vazio('scale', 'Sem plano de recuperação neste caso', 'O plano de pagamento existe só nos casos de recuperação judicial, depois que o plano é aprovado. As parcelas de honorários ficam em Faturas.')}</section>` };
  if (!p.mostra_obrigacoes) return bloqueado('o plano de pagamento');
  const o = await api.get(`/api/projetos/${p.projeto_id}/obrigacoes`);
  const hoje = hojeISO();
  const lista = o.obrigacoes.map((x) => ({ ...x, vencida: !x.pago && x.vencimento < hoje }));
  const prox = lista.find((x) => !x.pago);
  const pct = o.resumo.total ? Math.round((o.resumo.pagas / o.resumo.total) * 100) : 0;
  const porAno = new Map(); for (const x of lista) { const ano = x.vencimento.slice(0, 4); porAno.set(ano, [...(porAno.get(ano) ?? []), x]); }
  return {
    resumo: [{ rotulo: 'Obrigações', valor: o.resumo.total }, { rotulo: 'Cumpridas', valor: o.resumo.pagas }, { rotulo: 'Vencidas', valor: o.resumo.vencidas, tom: o.resumo.vencidas ? 'warn' : '' }],
    html: lista.length ? html`
      <section class="card glass up plano-topo">
        <div><span class="nx-eyebrow">Plano de recuperação judicial a cumprir</span>
          <p class="dica">Cada linha é um pagamento que a empresa assumiu com um credor no plano aprovado em juízo. Deixar de pagar no prazo pode levar à convolação em falência (art. 61, §1º, e art. 73, IV, da Lei 11.101/2005), por isso o que vence primeiro aparece em destaque.</p>
          <div class="plano-barra" aria-label="${pct}% das obrigações cumpridas"><i style="width:${pct}%"></i></div>
          <small class="dica">${o.resumo.pagas} de ${o.resumo.total} obrigações cumpridas · total do plano R$ ${o.resumo.valorTotal}${o.resumo.vencidas ? ` · R$ ${o.resumo.valorVencido} vencido` : ''}</small></div>
        ${prox ? html`<div class="plano-prox ${prox.vencida ? 'is-alert' : ''}"><span class="nx-eyebrow">${prox.vencida ? 'Vencida, regularize' : 'Próxima obrigação'}</span><b class="nx-money">R$ ${prox.valorFormatado}</b><small>${prox.credor} · ${dataBR(prox.vencimento)}</small></div>`
          : html`<div class="plano-prox"><span class="nx-eyebrow">Situação</span><b>Plano cumprido</b></div>`}
      </section>
      ${[...porAno].map(([ano, itens]) => html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">${ano}</h2><p class="card__sub">${itens.filter((x) => x.pago).length} de ${itens.length} cumpridas</p></div></header>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vencimento</th><th>Credor</th><th class="num">Parcela</th><th class="num">Valor (R$)</th><th>Situação</th></tr></thead>
        <tbody>${itens.map((x) => html`<tr class="${x.vencida ? 'vencido' : ''}"><td>${dataBR(x.vencimento)}</td><td>${x.credor}</td><td class="num mono-sm">${x.numero}</td><td class="num">${x.valorFormatado}</td>
          <td>${x.pago ? html`<span class="selo ok">Cumprida</span>` : x.vencida ? html`<span class="selo erro">Vencida</span>` : html`<span class="selo">A vencer</span>`}</td></tr>`)}</tbody></table></div></section>`)}`
      : html`<section class="card glass up">${vazio('scale', 'O plano ainda não foi cadastrado', 'Assim que o plano de recuperação for aprovado, cada obrigação aparece aqui com credor, valor e vencimento.')}</section>`,
  };
}

async function caixa(p) {
  if (!p.mostra_financeiro) return bloqueado('o financeiro');
  const r = await painelFinanceiroProjeto(p.projeto_id, () => navegar()).catch(() => null);
  if (!r) return { resumo: [], html: html`<section class="card glass up">${vazio('chart', 'Fluxo de caixa indisponível', 'Tente de novo em alguns instantes.')}</section>` };
  return { resumo: [], html: r.html, depois: r.depois };
}

async function atas(p) {
  const l = await api.get(`/api/projetos/${p.projeto_id}/atas`);
  return { resumo: [], html: l.length ? html`${l.map((a) => html`<details class="card glass up mt"><summary class="checklist-summary"><b>${a.titulo}</b> <small>${dataBR(a.realizadaEm)}</small></summary><div class="mt">${[['Pauta', a.pauta], ['Decisões', a.decisoes], ['Encaminhamentos', a.encaminhamentos]].filter(([, t]) => t).map(([r, t]) => html`<h3 class="mini-h">${r}</h3><p style="white-space:pre-wrap;margin:0">${t}</p>`)}</div></details>`)}` : html`<section class="card glass up">${vazio('doc', 'Nenhuma ata publicada', 'As atas das reuniões aparecem aqui quando o escritório publicar.')}</section>` };
}
async function relatorios(p) {
  const docs = (await api.get(`/api/projetos/${p.projeto_id}/documentos`)).filter((d) => d.visibilidade === 'publicado');
  const rel = docs.filter((d) => d.categoria === 'relatorio_gerador' && d.visibilidade === 'publicado');
  return {
    resumo: [{ rotulo: 'Relatórios', valor: rel.length }, { rotulo: 'Outros documentos', valor: docs.length - rel.length }],
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Relatórios da NGA</h2><p class="card__sub">Acompanhamento mensal e quadros preparados para você</p></div></header>
      ${rel.length ? html`<ul class="lista">${rel.map((d) => html`<li><span class="empty__ico" style="width:40px;height:40px;border-radius:13px">${icone('chart')}</span><div><b>${d.titulo}</b><small>publicado ${relativo(d.publicado_em)} · ${tamanho(d.tamanho_bytes)}</small></div>
        ${d.tem_arquivo ? html`<div class="fim"><button type="button" class="btn btn--accent" data-baixar="${d.id}">${icone('download')}Baixar</button></div>` : ''}</li>`)}</ul>`
        : vazio('chart', 'Nenhum relatório publicado ainda', 'Quando a NGA publicar um relatório, ele aparece aqui para baixar.')}</section>`,
    depois: (el) => ouvir(el, 'click', '[data-baixar]', async (b) => { try { const r = await api.post(`/api/documentos/${b.dataset.baixar}/link`); window.open(r.url, '_blank', 'noopener'); } catch (e) { erroDe(e); } }),
  };
}

const ABAS = { inicio, andamento, documentos, faturas, plano, caixa, relatorios, atas };
