/**
 * O painel do cliente — o mesmo visual do Lab, com o que é do cliente.
 *
 * Aqui não há botão que o servidor vá recusar por causa de papel: a navegação
 * só oferece o que o cliente pode fazer. Mas quem garante o isolamento é o RLS
 * do banco (§6.1); esta tela apenas não finge que o resto existe.
 */
import { api } from '../api.js';
import { estado, pode } from '../estado.js';
import { anel } from '../fx.js';
import { $, dataBR, hojeISO, html, icone, ouvir, paraCentavos, raw, relativo, tamanho } from '../util.js';
import { cabecalho, erroDe, formulario, toast, vazio } from '../ui.js';
import { navegar } from '../shell.js';

const TITULOS = { inicio: 'Início', andamento: 'Andamento', documentos: 'Documentos', plano: 'Plano de pagamento', caixa: 'Fluxo de caixa', mensagens: 'Mensagens' };
const SIT = { pendente: ['', 'Pendente'], enviado: ['info', 'Enviado'], em_analise: ['info', 'Em análise'], aprovado: ['ok', 'Aprovado'], rejeitado: ['erro', 'Rejeitado'], complementacao: ['aviso', 'Complementar'] };

export default async function portal({ aba }) {
  const projetos = estado.portal.length ? estado.portal : await api.get('/api/portal/projetos');
  const proj = projetos.find((p) => p.projeto_id === estado.projetoDoCliente) ?? projetos[0];
  if (!proj) {
    return { titulo: 'Portal', html: html`<div class="empty up"><div class="empty__ico">${icone('lock')}</div><h3>Nenhum processo liberado ainda</h3>
      <p>Seu acesso está ativo, mas o escritório ainda não vinculou um projeto a você.</p></div>` };
  }
  const corpo = await ABAS[aba](proj);
  return {
    titulo: TITULOS[aba],
    html: html`${cabecalho({ titulo: TITULOS[aba], sub: proj.nome, resumo: corpo.resumo ?? [] })}<div class="mt">${corpo.html}</div>`,
    depois: (el) => corpo.depois?.(el, proj),
  };
}

const bloqueado = (o) => ({ html: html`<section class="card glass up">${vazio('lock', 'Área não habilitada', `O escritório não liberou ${o} para o seu acesso. Se precisar, fale com a NGA na aba Mensagens.`)}</section>` });

// ------------------------------------------------------------------ início ---

async function inicio(p) {
  const [check, ob, procs, msgs] = await Promise.all([
    api.get(`/api/projetos/${p.projeto_id}/checklist`).catch(() => null),
    p.mostra_obrigacoes ? api.get(`/api/projetos/${p.projeto_id}/obrigacoes`).catch(() => null) : null,
    api.get('/api/processos').catch(() => []),
    api.get(`/api/projetos/${p.projeto_id}/mensagens`).catch(() => []),
  ]);
  const meus = procs.filter((x) => x.projeto_id === p.projeto_id);
  const pr = check?.progresso; const falta = check?.itens.filter((i) => i.aguardaVoce) ?? [];
  const pagas = ob?.resumo.total ? Math.round((ob.resumo.pagas / ob.resumo.total) * 100) : null;
  const ultima = msgs[0];
  return {
    resumo: [{ rotulo: 'Documentos aprovados', valor: pr ? pr.percentualAprovado : '—', sufixo: pr ? '%' : '' }, { rotulo: 'Aguardando você', valor: falta.length, tom: falta.length ? 'warn' : '' },
      { rotulo: 'Processos', valor: meus.length }],
    html: html`<div class="grid3">
      <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Sua documentação</h2><p class="card__sub">O que o escritório já conferiu</p></div></header>
        <div class="cliente-hero"><span class="pring" style="--s:104px">${raw(anel(pr?.percentualAprovado ?? 0, { tam: 104, traco: 9, cor: 'var(--lab-amber)' }))}<b class="pring__val" style="font-size:22px">${pr ? `${pr.percentualAprovado}%` : '—'}</b></span>
          <div><b>${pr ? `${pr.aprovados} de ${pr.obrigatorios}` : 'Sem lista'}</b><p class="dica" style="margin:4px 0 0">${pr ? 'documentos obrigatórios aprovados' : 'O escritório ainda vai montar a lista do que precisa.'}</p></div></div></section>
      <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Plano de pagamento</h2><p class="card__sub">Parcelas pagas</p></div></header>
        ${pagas === null ? html`<p class="dica">${p.mostra_obrigacoes ? 'Ainda não há plano cadastrado.' : 'Não liberado para o seu acesso.'}</p>`
          : html`<div class="cliente-hero"><span class="pring" style="--s:104px">${raw(anel(pagas, { tam: 104, traco: 9, cor: 'var(--lab-green)' }))}<b class="pring__val" style="font-size:22px">${pagas}%</b></span>
            <div><b>${ob.resumo.pagas} de ${ob.resumo.total}</b><p class="dica" style="margin:4px 0 0">${ob.resumo.vencidas ? `${ob.resumo.vencidas} vencida(s)` : 'nenhuma vencida'}</p></div></div>`}</section>
      <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Última mensagem</h2></div><a class="link" href="#/mensagens">Abrir →</a></header>
        ${ultima ? html`<div class="msg ${ultima.lado === 'cliente' ? 'meu' : ''}" style="max-width:100%">${ultima.texto}<small>${ultima.autor ?? 'NGA'} · ${relativo(ultima.criado_em)}</small></div>` : html`<p class="dica">Nenhuma mensagem ainda.</p>`}</section>
    </div>
    <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">O que falta de você</h2><p class="card__sub">Itens que dependem do seu envio</p></div><a class="link" href="#/documentos">Enviar documentos →</a></header>
      ${falta.length ? html`<div>${falta.slice(0, 6).map((i) => html`<div class="check-row"><span class="sit-dot ${i.situacao}"></span><div><b>${i.titulo}</b><small>${i.categoria}${i.observacao ? ` · ${i.observacao}` : ''}</small></div><span class="selo ${SIT[i.situacao]?.[0] ?? ''}">${i.rotuloDaSituacao}</span></div>`)}</div>`
        : vazio('check', 'Nada pendente com você', 'Quando o escritório precisar de algo, aparece aqui.')}</section>`,
  };
}

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
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Lista de documentos</h2><p class="card__sub">Envie cada arquivo no item correspondente. O escritório confere e responde aqui.</p></div></header>
      ${check.itens.length ? [...porCat].map(([cat, itens]) => html`<h3 class="mini-h">${cat}</h3>${itens.map((i) => html`<div class="check-row"><span class="sit-dot ${i.situacao}"></span>
        <div><b>${i.titulo}${i.obrigatorio ? '' : html` <span class="muted">(opcional)</span>`}</b><small>${i.fundamento ?? ''}</small>${i.observacao ? html`<small class="obs">${i.observacao}</small>` : ''}</div>
        <span class="selo ${SIT[i.situacao]?.[0] ?? ''}">${i.rotuloDaSituacao}</span>
        ${['pendente', 'rejeitado', 'complementacao'].includes(i.situacao) ? html`<label class="btn btn--accent" style="cursor:pointer">${icone('upload')}Enviar<input type="file" hidden data-req="${i.id}" data-t="${i.titulo}" data-c="${i.categoria}"></label>` : ''}</div>`)}`)
        : vazio('doc', 'A lista ainda não foi montada', 'Assim que o escritório definir o que precisa, os itens aparecem aqui.')}</section>
      <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Documentos do escritório para você</h2></div></header>
        ${docs.filter((d) => d.visibilidade === 'publicado').length ? html`<ul class="lista">${docs.filter((d) => d.visibilidade === 'publicado').map((d) => html`<li>${icone('doc')}<div><b>${d.titulo}</b><small>${d.categoria ?? ''} · ${tamanho(d.tamanho_bytes)} · publicado ${relativo(d.publicado_em)}</small></div>
          ${d.tem_arquivo ? html`<div class="fim"><button type="button" class="btn btn--ghost" data-baixar="${d.id}">${icone('download')}Baixar</button></div>` : ''}</li>`)}</ul>` : html`<p class="dica">Nenhum documento publicado para você ainda.</p>`}</section>`,
    depois(el) {
      ouvir(el, 'click', '[data-baixar]', async (b) => { try { const r = await api.post(`/api/documentos/${b.dataset.baixar}/link`); window.open(r.url, '_blank', 'noopener'); } catch (e) { erroDe(e); } });
      el.addEventListener('change', async (e) => {
        const inp = e.target.closest('input[data-req]'); if (!inp?.files[0]) return;
        const fd = new FormData(); fd.append('arquivo', inp.files[0]); fd.append('titulo', inp.dataset.t); fd.append('categoria', inp.dataset.c); fd.append('requisitoId', inp.dataset.req);
        try { await api.enviar(`/api/projetos/${p.projeto_id}/documentos`, fd); toast('Documento enviado. O escritório vai conferir.'); navegar(); } catch (er) { erroDe(er); }
      });
    },
  };
}

// -------------------------------------------------------------- plano/caixa ---

async function plano(p) {
  if (!p.mostra_obrigacoes) return bloqueado('o plano de pagamento');
  const o = await api.get(`/api/projetos/${p.projeto_id}/obrigacoes`);
  return {
    resumo: [{ rotulo: 'Parcelas', valor: o.resumo.total }, { rotulo: 'Pagas', valor: o.resumo.pagas }, { rotulo: 'Vencidas', valor: o.resumo.vencidas, tom: o.resumo.vencidas ? 'warn' : '' }],
    html: html`<section class="card glass up">${o.obrigacoes.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Credor</th><th>Vencimento</th><th class="num">Valor (R$)</th><th></th></tr></thead>
      <tbody>${o.obrigacoes.map((x) => html`<tr class="${!x.pago && x.vencida ? 'vencido' : ''}"><td class="mono-sm">${x.numero}</td><td>${x.credor}</td><td>${dataBR(x.vencimento)}</td><td class="num">${x.valorFormatado ?? x.valor}</td>
        <td>${x.pago ? html`<span class="selo ok">Paga</span>` : x.vencida ? html`<span class="selo erro">Vencida</span>` : html`<span class="selo">A vencer</span>`}</td></tr>`)}</tbody></table></div>`
      : vazio('money', 'Sem parcelas ainda', 'O plano aprovado aparece aqui com cada vencimento.')}</section>`,
  };
}

async function caixa(p) {
  if (!p.mostra_financeiro) return bloqueado('o fluxo de caixa');
  const f = await api.get(`/api/projetos/${p.projeto_id}/financeiro`);
  const max = Math.max(1, ...f.fluxo.periodos.map((x) => Math.abs(Number(x.saldoProjetado))));
  return {
    resumo: [{ rotulo: 'Saldo atual', valor: `R$ ${f.indicadores.saldoAtualFormatado}` }, { rotulo: 'Meses de caixa', valor: f.indicadores.mesesDeCaixa ?? '—' }],
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Saldo projetado por mês</h2><p class="card__sub">Realizado + previsto. ${f.fluxo.periodosNegativos.length ? 'Atenção: há mês com caixa negativo.' : ''}</p></div>
      ${pode('financeiro_cliente.escrever') ? html`<button type="button" class="btn btn--accent" data-lancar>${icone('plus')}Lançamento</button>` : ''}</header>
      ${f.fluxo.periodos.length ? html`<div class="barras">${f.fluxo.periodos.map((x) => { const v = Number(x.saldoProjetado); return html`<div class="barra"><b>${x.saldoProjetadoFormatado}</b><div class="barra__col"><i data-h="${Math.max(6, (Math.abs(v) / max) * 100)}" ${v < 0 ? raw('style="background:linear-gradient(180deg,#ff9b9b,var(--lab-red))"') : ''}></i></div><small>${x.rotulo}</small></div>`; })}</div>`
        : vazio('chart', 'Sem lançamentos', 'Registre receitas e despesas (realizadas ou previstas) para ver o caixa.')}</section>`,
    depois(el) {
      ouvir(el, 'click', '[data-lancar]', async () => {
        const ok = await formulario({
          titulo: 'Novo lançamento', rotulo: 'Lançar',
          campos: [{ nome: 'tipo', rotulo: 'Tipo', tipo: 'select', metade: true, valor: 'despesa', opcoes: [{ v: 'receita', t: 'Receita' }, { v: 'despesa', t: 'Despesa' }] },
            { nome: 'situacao', rotulo: 'Situação', tipo: 'select', metade: true, valor: 'realizado', opcoes: [{ v: 'realizado', t: 'Realizado' }, { v: 'previsto', t: 'Previsto' }] },
            { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, metade: true, valor: hojeISO() }, { nome: 'valor', rotulo: 'Valor (R$)', obrigatorio: true, metade: true },
            { nome: 'categoria', rotulo: 'Categoria', obrigatorio: true, placeholder: 'Folha, fornecedores, vendas…' }],
          async enviar(v) { const valor = paraCentavos(v.valor); if (!valor) throw new Error('Valor inválido. Use 12.500,00'); await api.post(`/api/projetos/${p.projeto_id}/financeiro`, { tipo: v.tipo, situacao: v.situacao, data: v.data, valor, categoria: v.categoria }); toast('Lançamento registrado'); },
        });
        if (ok) navegar();
      });
    },
  };
}

// --------------------------------------------------------------- mensagens ---

async function mensagens(p) {
  const msgs = (await api.get(`/api/projetos/${p.projeto_id}/mensagens`)).reverse();
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Conversa com a NGA</h2><p class="card__sub">Dúvidas, avisos e pedidos. A equipe responde aqui.</p></div></header>
      <div class="chat" id="chat" style="max-height:520px">${msgs.length ? msgs.map((m) => html`<div class="msg ${m.lado === 'cliente' ? 'meu' : ''}">${m.texto}<small>${m.autor ?? (m.lado === 'nga' ? 'NGA' : 'Você')} · ${relativo(m.criado_em)}</small></div>`) : html`<p class="dica">Nenhuma mensagem ainda. Escreva a primeira.</p>`}</div>
      <form class="chat-in" id="env"><input class="input" name="texto" placeholder="Escreva sua mensagem…" autocomplete="off" aria-label="Mensagem" required><button class="btn btn--accent" type="submit">${icone('send')}Enviar</button></form></section>`,
    depois(el) {
      const chat = $('#chat', el); chat.scrollTop = chat.scrollHeight;
      $('#env', el).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target; const texto = f.texto.value.trim(); if (!texto) return; f.querySelector('button').disabled = true;
        try { await api.post(`/api/projetos/${p.projeto_id}/mensagens`, { texto }); navegar(); } catch (er) { erroDe(er); f.querySelector('button').disabled = false; }
      });
    },
  };
}

const ABAS = { inicio, andamento, documentos, plano, caixa, mensagens };
