/**
 * Aba de negociações: o quadro "em negociação / stand by / concluídas".
 *
 * A estratégia (notas internas) fica só aqui. Para o cliente ver um cartão, a NGA precisa marcar "mostrar ao
 * cliente" E escrever o texto que ele vai ler: o servidor recusa as duas coisas separadas.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { quadroArrastavel } from '../fx.js';
import { dataBR, dataCurta, hojeISO, html, icone, ouvir, paraCentavos, raw, reais } from '../util.js';
import { confirmar, erroDe, formulario, toast, vazio } from '../ui.js';
import { equipe as equipeDoEscritorio } from './tarefas.js';

export const COLUNAS_NEG = [
  { id: 'em_negociacao', nome: 'Em negociação', cor: 'var(--lab-amber)' },
  { id: 'stand_by', nome: 'Stand by', cor: 'var(--lab-cy)' },
  { id: 'concluida', nome: 'Concluídas', cor: 'var(--lab-green)' },
];
const DESFECHO = { acordo: 'Acordo fechado', sem_acordo: 'Sem acordo' };

const cartao = (n) => html`<article class="tk-card hue--${n.status === 'concluida' ? 'green' : n.status === 'stand_by' ? 'teal' : 'yellow'}" draggable="true" data-id="${n.id}" data-neg>
  <div class="tk-card__top">${n.contraparte ? html`<span class="pchip"><i></i><span class="tk-ellip">${n.contraparte}</span></span>` : html`<span></span>`}
    ${n.visivelAoCliente ? html`<span class="selo ok" title="O cliente vê este cartão">${icone('eye')}cliente</span>` : html`<span class="selo" title="Só a NGA vê">${icone('lock')}interna</span>`}</div>
  <h3 class="tk-card__title"><button type="button" class="tk-card__open" data-editar="${n.id}"><span class="tk-card__text">${n.titulo}</span></button></h3>
  ${n.valor ? html`<div class="mono-sm">R$ ${reais(n.valor)}</div>` : ''}
  ${n.desfecho ? html`<span class="selo ${n.desfecho === 'acordo' ? 'ok' : 'erro'}">${DESFECHO[n.desfecho]}</span>` : ''}
  <div class="tk-card__foot"><span class="tk-due">${icone('calendar')}${n.prazo ? dataCurta(n.prazo) : 'sem prazo'}</span><span class="muted" style="font-size:12px">${n.responsavel ?? ''}</span></div></article>`;

const SIT_PMT = { paga: ['ok', 'Paga'], paga_parcial: ['aviso', 'Parcial'], vencida: ['erro', 'Vencida'], proxima: ['aviso', 'Próx. 30 dias'], futura: ['', 'A vencer'] };
function painelPmt(p, escreve, negs) {
  const abertas = p.itens.filter((x) => x.situacao === 'vencida' || x.situacao === 'proxima');
  const r = p.resumo;
  return html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Controle de PMT</h2><p class="card__sub">Parcelas dos acordos, previsto contra pago.</p></div>${escreve && negs.length ? html`<button class="btn btn--accent" data-gerar-pmt>${icone('plus')}Programar PMT</button>` : ''}</header>
    <div class="grid3" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px"><div class="stat ${r.qtdVencidas ? 'is-alert' : ''}"><span class="stat__label">Vencidas (${r.qtdVencidas})</span><span class="stat__value"><b>R$ ${reais(r.vencido)}</b></span></div><div class="stat is-warn"><span class="stat__label">Próx. 30 dias (${r.qtdProximos30})</span><span class="stat__value"><b>R$ ${reais(r.proximos30)}</b></span></div><div class="stat is-ok"><span class="stat__label">Pago</span><span class="stat__value"><b>R$ ${reais(r.pago)}</b></span></div><div class="stat"><span class="stat__label">Total programado</span><span class="stat__value"><b>R$ ${reais(r.total)}</b></span></div></div>
    ${abertas.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vencimento</th><th>Negociação</th><th>Nº</th><th class="num">PMT</th><th>Situação</th><th></th></tr></thead><tbody>${abertas.map((x) => html`<tr class="${x.situacao === 'vencida' ? 'vencido' : ''}"><td>${dataBR(x.vencimento)}</td><td>${x.negociacao}<small>${x.contraparte ?? ''}</small></td><td>${x.numero}</td><td class="num">${reais(x.valor)}</td><td><span class="selo ${SIT_PMT[x.situacao][0]}">${SIT_PMT[x.situacao][1]}</span></td><td>${escreve ? html`<button class="btn btn--ghost" data-baixa-pmt="${x.id}">Baixar</button>` : ''}</td></tr>`)}</tbody></table></div>` : html`<p class="dica">Nenhuma PMT vencida ou nos próximos 30 dias.</p>`}
    ${p.itens.length ? html`<details class="mt"><summary class="checklist-summary"><b>Cronograma completo</b> <small>${p.itens.length} parcela(s)</small></summary><div class="tbl-wrap mt" style="max-height:340px"><table class="tbl"><thead><tr><th>Vencimento</th><th>Negociação</th><th>Nº</th><th class="num">Juros</th><th class="num">Amortização</th><th class="num">PMT</th><th class="num">Pago</th><th>Situação</th><th></th></tr></thead><tbody>${p.itens.map((x) => html`<tr><td>${dataBR(x.vencimento)}</td><td>${x.negociacao}</td><td>${x.numero}</td><td class="num">${reais(x.juros)}</td><td class="num">${reais(x.amortizacao)}</td><td class="num">${reais(x.valor)}</td><td class="num">${x.valorPago ? reais(x.valorPago) : '—'}</td><td><span class="selo ${SIT_PMT[x.situacao][0]}">${SIT_PMT[x.situacao][1]}</span></td><td>${escreve ? (x.pagoEm ? html`<button class="btn btn--ghost" data-reabre-pmt="${x.id}">Reabrir</button>` : html`<button class="btn btn--ghost" data-baixa-pmt="${x.id}">Baixar</button>`) : ''}</td></tr>`)}</tbody></table></div></details>` : ''}</section>`;
}
function gerarPmt(negs, recarregar) {
  return formulario({ titulo: 'Programar PMT', subtitulo: 'Refazer só é possível enquanto nenhuma parcela tiver sido paga.', rotulo: 'Gerar cronograma', campos: [{ nome: 'neg', rotulo: 'Negociação', tipo: 'select', obrigatorio: true, opcoes: negs.map((n) => ({ v: n.id, t: n.titulo })) }, { nome: 'principal', rotulo: 'Valor acordado (R$)', obrigatorio: true, metade: true }, { nome: 'parcelas', rotulo: 'Parcelas', obrigatorio: true, metade: true, valor: '12' }, { nome: 'primeiro', rotulo: '1º vencimento', tipo: 'date', obrigatorio: true, metade: true }, { nome: 'juros', rotulo: 'Juros ao mês (%)', metade: true, valor: '0' }, { nome: 'sistema', rotulo: 'Sistema', tipo: 'select', valor: 'price', opcoes: [{ v: 'price', t: 'Price (PMT constante)' }, { v: 'sac', t: 'SAC' }, { v: 'fixa', t: 'Parcelas iguais sem juros' }] }],
    async enviar(v) { const c = paraCentavos(v.principal); if (!c) throw new Error('Valor inválido. Use 150.000,00'); const r = await api.post(`/api/negociacoes/${v.neg}/pmts`, { principal: c, parcelas: Number(v.parcelas), primeiroVencimento: v.primeiro, jurosAoMes: (Number(String(v.juros).replace(',', '.')) || 0) / 100, sistema: v.sistema }); toast(`${r.parcelas} PMT(s) de R$ ${reais(r.primeira)}`); } }).then((ok) => ok && recarregar());
}

export async function abaNegociacoes(ctx) {
  const [d, pmt] = await Promise.all([api.get(`/api/projetos/${ctx.id}/negociacoes`), api.get(`/api/projetos/${ctx.id}/pmts`).catch(() => ({ itens: [], porMes: [], resumo: { total: '0', pago: '0', vencido: '0', qtdVencidas: 0, proximos30: '0', qtdProximos30: 0 } }))]);
  const escreve = pode('negociacao.escrever') && ctx.h.situacao !== 'encerrado';
  return {
    html: html`<div class="flex up" style="margin-bottom:12px"><span class="dica">${d.resumo.emNegociacao} em negociação · ${d.resumo.standBy} em stand by · ${d.resumo.concluidas} concluída(s)${d.resumo.acordos ? ` (${d.resumo.acordos} com acordo)` : ''}. Arraste entre as colunas.</span><span class="grow"></span>
      ${escreve ? html`<button type="button" class="btn btn--accent" data-nova>${icone('plus')}Nova negociação</button>` : ''}</div>
      <div class="tk-board up" id="neg-board">${COLUNAS_NEG.map((c) => {
        const itens = d.negociacoes.filter((n) => n.status === c.id);
        return html`<section class="card glass tk-col" data-col-wrap="${c.id}"><header class="tk-col__head"><i class="tk-dot" style="background:${raw(c.cor)}"></i><h2 class="tk-col__name">${c.nome}</h2><span class="tk-col__count tnum">${itens.length}</span></header>
          <div class="tk-col__list" data-col="${c.id}">${itens.map(cartao)}</div></section>`;
      })}</div>
      ${painelPmt(pmt, escreve, d.negociacoes)}${d.negociacoes.length ? '' : html`<section class="card glass up mt">${vazio('users', 'Nenhuma negociação ainda', 'Registre cada frente de negociação com credores. Só vira visível ao cliente quando você escrever o resumo e marcar.', escreve ? '<button class="btn btn--accent" data-nova>Criar a primeira</button>' : '')}</section>`}`,
    depois(el) {
      const recarregar = () => ctx.recarregar();
      ouvir(el, 'click', '[data-gerar-pmt]', () => gerarPmt(d.negociacoes, recarregar));
      ouvir(el, 'click', '[data-baixa-pmt]', (b) => { const x = pmt.itens.find((p) => p.id === b.dataset.baixaPmt); formulario({ titulo: `PMT ${x.numero} · ${x.negociacao}`, subtitulo: `Vencimento ${dataBR(x.vencimento)}`, rotulo: 'Registrar pagamento', campos: [{ nome: 'valor', rotulo: 'Valor pago (R$)', obrigatorio: true, metade: true, valor: reais(x.valor) }, { nome: 'data', rotulo: 'Pago em', tipo: 'date', obrigatorio: true, metade: true, valor: hojeISO() }, { nome: 'obs', rotulo: 'Observação', tipo: 'textarea' }], async enviar(v) { const c = paraCentavos(v.valor); if (!c) throw new Error('Valor inválido'); await api.patch(`/api/pmts/${x.id}`, { valorPago: c, pagoEm: v.data, observacao: v.obs ?? null }); toast('PMT baixada'); } }).then((ok) => ok && recarregar()); });
      ouvir(el, 'click', '[data-reabre-pmt]', async (b) => { try { await api.patch(`/api/pmts/${b.dataset.reabrePmt}`, { valorPago: null, pagoEm: null }); recarregar(); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-nova]', () => formularioNegociacao(ctx, null, recarregar));
      ouvir(el, 'click', '[data-editar]', (b) => formularioNegociacao(ctx, d.negociacoes.find((n) => n.id === b.dataset.editar), recarregar));
      const board = el.querySelector('#neg-board');
      if (escreve && board) quadroArrastavel(board, {
        item: '.tk-card', coluna: '.tk-col', lista: '.tk-col__list',
        aoSoltar: async (id, status) => {
          try {
            await api.patch(`/api/negociacoes/${id}`, { status });
            if (status === 'concluida') {
              const n = d.negociacoes.find((x) => x.id === id);
              await formulario({ titulo: 'Como terminou?', subtitulo: n?.titulo, rotulo: 'Registrar',
                campos: [{ nome: 'desfecho', rotulo: 'Desfecho', tipo: 'select', valor: 'acordo', opcoes: [{ v: 'acordo', t: 'Acordo fechado' }, { v: 'sem_acordo', t: 'Sem acordo' }] }],
                async enviar(v) { await api.patch(`/api/negociacoes/${id}`, { desfecho: v.desfecho }); } });
            }
            recarregar();
          } catch (e) { erroDe(e); throw e; }
        },
      });
    },
  };
}

async function formularioNegociacao(ctx, n, recarregar) {
  const equipe = await equipeDoEscritorio();
  const publica = pode('portal.publicar');
  let excluir = false;
  await formulario({
    titulo: n ? 'Negociação' : 'Nova negociação', subtitulo: ctx.h.nome, rotulo: n ? 'Salvar' : 'Criar', largo: true,
    campos: [
      { nome: 'titulo', rotulo: 'O que se negocia', obrigatorio: true, valor: n?.titulo, placeholder: 'Ex.: Banco X — repactuação da CCB' },
      { nome: 'contraparte', rotulo: 'Contraparte (credor)', metade: true, valor: n?.contraparte },
      { nome: 'valor', rotulo: 'Valor em jogo (R$)', metade: true, valor: n?.valor ? reais(n.valor) : '' },
      { nome: 'status', rotulo: 'Coluna', tipo: 'select', metade: true, valor: n?.status ?? 'em_negociacao', opcoes: COLUNAS_NEG.map((c) => ({ v: c.id, t: c.nome })) },
      { nome: 'desfecho', rotulo: 'Desfecho (se concluída)', tipo: 'select', metade: true, valor: n?.desfecho ?? '', opcoes: [{ v: '', t: '—' }, { v: 'acordo', t: 'Acordo fechado' }, { v: 'sem_acordo', t: 'Sem acordo' }] },
      { nome: 'prazo', rotulo: 'Prazo', tipo: 'date', metade: true, valor: n?.prazo ?? '' },
      { nome: 'responsavelId', rotulo: 'Responsável', tipo: 'select', metade: true, valor: n?.responsavelId ?? '', opcoes: [{ v: '', t: 'Eu' }, ...equipe.map((u) => ({ v: u.id, t: u.nome }))] },
      { nome: 'notasInternas', rotulo: 'Notas internas (só a NGA vê)', tipo: 'textarea', valor: n?.notasInternas, placeholder: 'Estratégia, limites, o que se aceita…' },
      ...(publica ? [
        { nome: 'visivel', rotulo: 'Mostrar ao cliente?', tipo: 'select', metade: true, valor: n?.visivelAoCliente ? 'sim' : 'nao', opcoes: [{ v: 'nao', t: 'Não — só a NGA' }, { v: 'sim', t: 'Sim — o cliente verá título, contraparte, coluna e o resumo abaixo' }] },
        { nome: 'resumoCliente', rotulo: 'Resumo para o cliente', tipo: 'textarea', valor: n?.resumoCliente, dica: 'Obrigatório para mostrar. Escreva sem estratégia nem números sensíveis.' },
      ] : []),
    ],
    depois(el) {
      if (!n) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--ghost perigo-btn'; b.style.marginRight = 'auto'; b.textContent = 'Excluir';
      el.querySelector('.modal__foot').prepend(b);
      b.addEventListener('click', async () => {
        if (!(await confirmar('Excluir negociação?', `“${n.titulo}” será apagada. Fica na auditoria.`, { rotulo: 'Excluir', perigo: true }))) return;
        try { await api.del(`/api/negociacoes/${n.id}`); excluir = true; toast('Negociação excluída'); el.fechar(true); } catch (e) { el.erro(e.message); }
      });
    },
    async enviar(v) {
      let valor; if (v.valor) { valor = paraCentavos(v.valor); if (!valor) throw new Error('Valor inválido. Use 150.000,00'); }
      const corpo = {
        titulo: v.titulo, contraparte: v.contraparte ?? null, valor: valor ?? null, status: v.status, prazo: v.prazo ?? null,
        desfecho: v.status === 'concluida' ? (v.desfecho || null) : null, responsavelId: v.responsavelId || undefined, notasInternas: v.notasInternas ?? null,
      };
      if (publica) { corpo.visivelAoCliente = v.visivel === 'sim'; corpo.resumoCliente = v.resumoCliente ?? null; }
      if (n) await api.patch(`/api/negociacoes/${n.id}`, corpo); else await api.post(`/api/projetos/${ctx.id}/negociacoes`, corpo);
      toast(n ? 'Negociação atualizada' : 'Negociação criada');
    },
  });
  recarregar();
  void excluir;
}
