/**
 * Financeiro: faturas, guias de custas e os documentos de cada pagamento.
 *
 * O financeiro só enxerga os projetos em que está na equipe (o banco garante, não esta tela). Aqui ele junta
 * e gerencia faturas, confere o comprovante que o cliente anexou e paga guia de custas. A aba "Escritório"
 * já existe como reserva: o financeiro do próprio escritório (receitas, despesas) entra depois.
 */
import { api } from '../api.js';
import { estado, pode } from '../estado.js';
import { dataBR, html, icone, ouvir, relativo, tamanho } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, modal, toast, vazio } from '../ui.js';
import { navegar } from '../shell.js';

const STATUS = { a_vencer: ['info', 'A vencer'], vencida: ['erro', 'Vencida'], paga_em_conferencia: ['aviso', 'Paga · a conferir'], paga: ['ok', 'Paga'], cancelada: ['', 'Cancelada'] };
const ABAS = [['faturas', 'Faturas'], ['guias', 'Guias de custas'], ['documentos', 'Documentos'], ['escritorio', 'Escritório']];
const brl = (v) => `R$ ${v}`;
let filtro = 'abertas';

export async function novaFatura(projetoId = null, tipo = 'honorarios') {
  const projetos = (await api.get('/api/projetos')).filter((p) => p.situacao !== 'encerrado');
  if (!projetos.length) { toast('Nenhum projeto disponível para você.', 'aviso'); return false; }
  const ok = await formulario({
    titulo: tipo === 'guia_custas' ? 'Nova guia de custas' : 'Nova fatura', subtitulo: 'O cliente vê a fatura no portal e anexa o comprovante do pagamento.', rotulo: 'Emitir',
    campos: [
      { nome: 'projetoId', rotulo: 'Projeto', tipo: 'select', obrigatorio: true, valor: projetoId ?? '', opcoes: [{ v: '', t: 'Selecione' }, ...projetos.map((p) => ({ v: p.id, t: p.nome }))] },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', valor: tipo, metade: true, opcoes: [{ v: 'honorarios', t: 'Honorários' }, { v: 'guia_custas', t: 'Guia de custas' }, { v: 'despesa', t: 'Despesa' }, { v: 'outros', t: 'Outros' }] },
      { nome: 'valor', rotulo: 'Valor (R$)', obrigatorio: true, metade: true, placeholder: '1.500,00' },
      { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, placeholder: 'Honorários mensais — novembro' },
      { nome: 'vencimento', rotulo: 'Vencimento', tipo: 'date', obrigatorio: true, metade: true },
      { nome: 'competencia', rotulo: 'Competência', metade: true, placeholder: '11/2026' },
      { nome: 'linhaDigitavel', rotulo: 'Linha digitável / código de barras', dica: 'Opcional. Para guia de custas, cole o código para pagamento.' },
      { nome: 'visivel', rotulo: 'Visível ao cliente', tipo: 'select', valor: tipo === 'guia_custas' ? 'nao' : 'sim', opcoes: [{ v: 'sim', t: 'Sim — o cliente vê e anexa o comprovante' }, { v: 'nao', t: 'Não — controle interno (ex.: guia paga pelo escritório)' }] },
    ],
    async enviar(v) {
      await api.post('/api/faturas', {
        projetoId: v.projetoId, tipo: v.tipo, descricao: v.descricao, valor: v.valor, vencimento: v.vencimento, competencia: v.competencia, linhaDigitavel: v.linhaDigitavel,
        pagador: v.visivel === 'sim' ? 'cliente' : 'escritorio', visivelCliente: v.visivel === 'sim',
      });
    },
  });
  if (ok) { toast('Emitida.'); navegar(); }
  return !!ok;
}

export default async function financeiro({ aba = 'faturas' }) {
  if (!ABAS.some(([id]) => id === aba)) aba = 'faturas';
  const [dados, docs] = await Promise.all([api.get('/api/faturas'), aba === 'documentos' ? api.get('/api/financeiro/documentos') : []]);
  const r = dados.resumo; const todas = dados.faturas;
  const base = aba === 'guias' ? todas.filter((f) => f.tipo === 'guia_custas') : todas.filter((f) => f.tipo !== 'guia_custas');
  const lista = base.filter((f) => (filtro === 'abertas' ? f.situacao === 'aberta' : filtro === 'conferir' ? f.status === 'paga_em_conferencia' : filtro === 'pagas' ? f.situacao === 'paga' : true));
  const linha = (f) => {
    const [tom, rot] = STATUS[f.status] ?? ['', f.status];
    return html`<tr class="${f.status === 'vencida' ? 'vencido' : ''}"><td class="mono-sm">${f.numero}</td><td>${f.projeto ?? '—'}<small>${f.rotuloDoTipo}${f.visivelCliente ? '' : ' · interna'}</small></td>
      <td>${f.descricao}<small>${f.competencia ?? ''}${f.processo ? ` · proc. ${f.processo}` : ''}</small></td><td>${dataBR(f.vencimento)}<small>${f.situacao === 'aberta' ? (f.diasParaVencer < 0 ? `${-f.diasParaVencer} dia(s) de atraso` : `em ${f.diasParaVencer} dia(s)`) : f.pagoEm ? `pago em ${dataBR(f.pagoEm)}` : ''}</small></td>
      <td class="num">${f.valorFormatado}</td><td><span class="selo ${tom}"><i></i>${rot}</span></td>
      <td><div class="nx-acts">
        ${f.documentoId ? html`<button class="btn btn--ghost btn--sm" data-baixar="${f.documentoId}" title="Boleto, guia ou nota">${icone('download')}</button>` : ''}
        ${f.comprovanteId ? html`<button class="btn btn--ghost btn--sm" data-baixar="${f.comprovanteId}" title="Comprovante">${icone('doc')}</button>` : ''}
        ${f.status === 'paga_em_conferencia' ? html`<button class="btn btn--accent btn--sm" data-conferir="${f.id}">${icone('check')}Conferir</button><button class="btn btn--ghost btn--sm perigo-btn" data-recusar="${f.id}">Recusar</button>` : ''}
        ${f.situacao === 'aberta' ? html`<label class="btn btn--ghost btn--sm" style="cursor:pointer" title="Anexar boleto, guia ou nota">${icone('link')}<input type="file" hidden data-doc="${f.id}"></label>
          <label class="btn btn--accent btn--sm" style="cursor:pointer" title="Anexar comprovante e dar baixa">${icone('upload')}${f.tipo === 'guia_custas' ? 'Pagar' : 'Baixar'}<input type="file" hidden data-pagar="${f.id}"></label>
          <button class="btn btn--ghost btn--sm" data-editar="${f.id}" title="Editar">${icone('list')}</button><button class="btn btn--ghost btn--sm perigo-btn" data-cancelar="${f.id}" title="Cancelar">${icone('x')}</button>` : ''}</div></td></tr>`;
  };
  const tabela = html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">${aba === 'guias' ? 'Guias de custas' : 'Faturas'}</h2><p class="card__sub">${aba === 'guias' ? 'Pagas pelo escritório; anexe o comprovante para dar baixa.' : 'Cobradas do cliente; o comprovante dele aparece aqui para conferência.'}</p></div>
      <div class="seg glass glass--chrome" role="group" aria-label="Filtro">${[['abertas', 'Em aberto'], ['conferir', 'A conferir'], ['pagas', 'Pagas'], ['todas', 'Todas']].map(([v, t]) => html`<button type="button" data-filtro="${v}" aria-pressed="${v === filtro}">${t}</button>`)}</div></header>
    ${lista.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nº</th><th>Projeto</th><th>Descrição</th><th>Vencimento</th><th class="num">Valor (R$)</th><th>Situação</th><th></th></tr></thead><tbody>${lista.map(linha)}</tbody></table></div>`
      : vazio('money', 'Nada neste filtro', aba === 'guias' ? 'Emita uma guia de custas para controlar o pagamento.' : 'Emita uma fatura para o cliente acompanhar pelo portal.')}</section>`;
  const corpo = aba === 'escritorio'
    ? html`<section class="card glass up">${vazio('chart', 'Financeiro do escritório', 'Receitas, despesas, fluxo de caixa e rentabilidade por projeto. Esta aba está reservada e entra na próxima etapa; hoje o Nexus cuida das faturas e guias de cada caso.')}</section>`
    : aba === 'documentos'
      ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Documentos do financeiro</h2><p class="card__sub">Comprovantes enviados pelos clientes, guias e boletos anexados às faturas.</p></div></header>
          ${docs.length ? html`<ul class="lista">${docs.map((d) => html`<li><span class="empty__ico" style="width:38px;height:38px;border-radius:12px">${icone(d.papel === 'comprovante' ? 'check' : 'doc')}</span><div><b>${d.nome ?? 'documento'}</b><small>${d.papel === 'comprovante' ? 'Comprovante' : 'Boleto / guia'} · ${d.numero} · ${d.projeto} · ${d.tamanho ? tamanho(d.tamanho) : ''} · ${d.em ? relativo(d.em) : ''}${d.enviado_por ? ` · ${d.enviado_por}` : ''}</small></div>
            <div class="fim">${d.papel === 'comprovante' ? html`<span class="selo ${d.conferido ? 'ok' : 'aviso'}">${d.conferido ? 'Conferido' : 'A conferir'}</span>` : ''}<button class="btn btn--ghost btn--sm" data-baixar="${d.documento_id}">${icone('download')}Baixar</button></div></li>`)}</ul>` : vazio('doc', 'Nenhum documento ainda', 'Os comprovantes que os clientes anexarem e os boletos que você juntar às faturas aparecem aqui.')}</section>`
      : tabela;

  return {
    titulo: 'Financeiro',
    html: html`${cabecalho({ titulo: 'Financeiro', sub: pode('admin.gerir') || pode('financeiro.escrever') ? 'Faturas, guias de custas e comprovantes dos projetos' : 'Faturas, guias de custas e comprovantes dos seus projetos',
      acoes: html`<button class="btn btn--accent" data-nova>${icone('plus')}Nova fatura</button><button class="btn btn--ghost" data-nova-guia>${icone('plus')}Nova guia de custas</button>`,
      resumo: [{ rotulo: 'Em aberto', valor: r.emAberto }, { rotulo: 'Vencidas', valor: r.vencidas, tom: r.vencidas ? 'alert' : '' }, { rotulo: 'A conferir', valor: r.aConferir, tom: r.aConferir ? 'warn' : '' }, { rotulo: 'Pagas', valor: r.pagas, tom: 'ok' }] })}
      <div class="tabs glass glass--chrome mt up" role="tablist" id="abas-fin"><span class="tabs__pill" aria-hidden="true"></span>${ABAS.map(([id, t]) => html`<button type="button" role="tab" data-aba="${id}" aria-selected="${id === aba}">${t}</button>`)}</div>
      <div class="nx-resumo-fin mt"><div><small>Total em aberto</small><b>${brl(r.totalAbertoFormatado)}</b></div><div><small>Vencido</small><b class="${r.vencidas ? 'nx-neg' : ''}">${brl(r.totalVencidoFormatado)}</b></div><div><small>Recebido</small><b class="nx-pos">${brl(r.totalPagoFormatado)}</b></div></div>
      <div class="mt">${corpo}</div>`,
    depois(el) {
      ouvir(el, 'click', '[data-aba]', (b) => { location.hash = `#/financeiro/${b.dataset.aba}`; });
      ouvir(el, 'click', '[data-filtro]', (b) => { filtro = b.dataset.filtro; navegar(); });
      ouvir(el, 'click', '[data-nova]', () => novaFatura());
      ouvir(el, 'click', '[data-nova-guia]', () => novaFatura(null, 'guia_custas'));
      ouvir(el, 'click', '[data-baixar]', async (b) => { try { const x = await api.post(`/api/documentos/${b.dataset.baixar}/link`); window.open(x.url, '_blank', 'noopener'); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-conferir]', async (b) => { try { await api.post(`/api/faturas/${b.dataset.conferir}/conferencia`, { acao: 'conferir' }); toast('Comprovante conferido.'); navegar(); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-recusar]', async (b) => {
        const ok = await formulario({ titulo: 'Recusar comprovante', subtitulo: 'A fatura volta a ficar em aberto e o cliente vê o motivo.', rotulo: 'Recusar', campos: [{ nome: 'motivo', rotulo: 'Motivo', tipo: 'textarea', obrigatorio: true, placeholder: 'Ex.: o valor do comprovante é diferente do boleto' }], async enviar(v) { await api.post(`/api/faturas/${b.dataset.recusar}/conferencia`, { acao: 'recusar', motivo: v.motivo }); } });
        if (ok) navegar();
      });
      ouvir(el, 'click', '[data-cancelar]', async (b) => { if (!(await confirmar('Cancelar fatura?', 'Ela deixa de aparecer para o cliente. Fatura paga não se cancela.', { rotulo: 'Cancelar fatura', perigo: true }))) return; try { await api.post(`/api/faturas/${b.dataset.cancelar}/cancelamento`); navegar(); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-editar]', async (b) => {
        const f = todas.find((x) => x.id === b.dataset.editar);
        const ok = await formulario({ titulo: `Editar ${f.numero}`, rotulo: 'Salvar', campos: [
          { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, valor: f.descricao }, { nome: 'valor', rotulo: 'Valor (R$)', valor: f.valorFormatado, metade: true },
          { nome: 'vencimento', rotulo: 'Vencimento', tipo: 'date', valor: f.vencimento, metade: true }, { nome: 'linhaDigitavel', rotulo: 'Linha digitável', valor: f.linhaDigitavel ?? '' }],
          async enviar(v) { await api.patch(`/api/faturas/${f.id}`, { descricao: v.descricao, valor: v.valor, vencimento: v.vencimento, linhaDigitavel: v.linhaDigitavel ?? null }); } });
        if (ok) navegar();
      });
      el.addEventListener('change', async (e) => {
        const doc = e.target.closest('input[data-doc]'); const pagar = e.target.closest('input[data-pagar]');
        const inp = doc ?? pagar; if (!inp?.files[0]) return;
        const fd = new FormData(); fd.append('arquivo', inp.files[0]);
        try {
          if (doc) { await api.enviar(`/api/faturas/${doc.dataset.doc}/documento`, fd); toast('Documento anexado à fatura.'); }
          else { await api.enviar(`/api/faturas/${pagar.dataset.pagar}/comprovante`, fd); toast('Pagamento registrado com o comprovante.'); }
          navegar();
        } catch (er) { erroDe(er); }
      });
      void estado; void modal;
    },
  };
}
