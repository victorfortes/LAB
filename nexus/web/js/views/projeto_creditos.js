/** Aba de créditos: o quadro de credores do projeto e a validação humana da classe (§7.7). */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { html, icone, ouvir, paraCentavos, raw, reais } from '../util.js';
import { confirmar, erroDe, formulario, modal, toast, vazio } from '../ui.js';

export const NATUREZAS = {
  trabalhista: 'Trabalhista', acidente_trabalho: 'Acidente de trabalho', garantia_real: 'Garantia real', quirografario: 'Quirografário',
  privilegio_especial: 'Privilégio especial', privilegio_geral: 'Privilégio geral', subordinado: 'Subordinado', me_epp: 'ME/EPP',
  tributario: 'Tributário', proprietario_fiduciario: 'Propriedade fiduciária', arrendamento_mercantil: 'Arrendamento mercantil',
  reserva_dominio: 'Reserva de domínio', promitente_vendedor_irrevogavel: 'Promitente vendedor irrevogável',
  adiantamento_contrato_cambio: 'Adiantamento de contrato de câmbio', posterior_ao_pedido: 'Posterior ao pedido',
};
const CLASSES = { I: 'Classe I · Trabalhista', II: 'Classe II · Garantia real', III: 'Classe III · Quirografária', IV: 'Classe IV · ME/EPP' };

export async function abaCreditos(ctx) {
  const d = await api.get(`/api/projetos/${ctx.id}/creditos`);
  const escreve = pode('credito.escrever') && ctx.h.situacao !== 'encerrado';
  const valida = pode('credito.validar');
  const maior = Math.max(1, ...d.consolidado.map((c) => Number(c.valor)));

  return {
    html: html`
      <div class="flex up" style="margin-bottom:12px"><span class="dica">${d.creditos.length} crédito(s) · ${d.pendentesDeValidacao} aguardando validação humana.
        A classe sugerida pelo sistema <b>não</b> é definitiva até alguém qualificado validar.</span><span class="grow"></span>
        ${escreve ? html`<button type="button" class="btn btn--ghost" data-credor>${icone('plus')}Novo credor</button>
          <button type="button" class="btn btn--accent" data-credito>${icone('plus')}Novo crédito</button>` : ''}</div>
      ${d.creditos.length ? html`<div class="grid-hub">
        <section class="card glass up"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Credor</th><th>Natureza</th><th class="num">Valor (R$)</th><th>Classe</th><th></th></tr></thead>
          <tbody>${d.creditos.map((c) => html`<tr>
            <td><b>${c.credor}</b>${c.me_epp ? html`<small>ME/EPP</small>` : ''}</td>
            <td>${NATUREZAS[c.natureza] ?? c.natureza}${c.valor_bem_gravado ? html`<small>bem gravado R$ ${reais(c.valor_bem_gravado)}</small>` : ''}</td>
            <td class="num">${c.valorFormatado}</td>
            <td>${c.classe_validada ? html`<span class="selo ok"><i></i>Classe ${c.classe_validada}${c.sujeito_validado === false ? ' · extraconcursal' : ''}</span>`
              : html`<span class="selo aviso" title="Sugerida pelo sistema — falta validação humana"><i></i>${c.enquadramentoSugerido?.sujeito === false ? 'Não sujeito (sugerido)' : `Classe ${c.enquadramentoSugerido?.classe ?? '?'} (sugerida)`}</span>`}</td>
            <td class="num">${valida && !c.classe_validada ? html`<button type="button" class="btn btn--ghost" data-validar="${c.id}">Validar</button>`
              : html`<button type="button" class="btn btn--ghost" data-ver="${c.id}">Ver</button>`}</td></tr>`)}</tbody></table></div></section>
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Por classe</h2><p class="card__sub">${d.pendentesDeValidacao ? `Pela classe sugerida — ${d.pendentesDeValidacao} de ${d.creditos.length} ainda sem validação` : 'Todos os créditos validados'}</p></div></header>
          ${d.consolidado.length ? html`<div style="display:grid;gap:14px">${d.consolidado.map((c) => html`<div>
            <div class="flex" style="justify-content:space-between"><b>Classe ${c.classe}</b><span class="mono-sm">R$ ${c.valorFormatado}</span></div>
            <div class="fase-card__bar" style="height:9px;margin-top:6px"><i data-w="${Math.max(4, (Number(c.valor) / maior) * 100)}" style="width:0;transition:width 1s var(--ease)"></i></div>
            <small class="muted">${c.credores} credor(es)</small></div>`)}</div>`
            : html`<p class="dica">Sem créditos para consolidar.</p>`}
        </section></div>`
        : html`<section class="card glass up">${vazio('scale', 'Nenhum crédito cadastrado', 'Cadastre o credor e depois o crédito. O sistema sugere a classe pela natureza (art. 83 da LREF); a decisão final é humana.',
          escreve ? '<button class="btn btn--accent" data-credor>Cadastrar o primeiro credor</button>' : '')}</section>`}`,

    depois(el) {
      const achar = (id) => d.creditos.find((c) => c.id === id);
      ouvir(el, 'click', '[data-credor]', () => novoCredor(ctx));
      ouvir(el, 'click', '[data-credito]', () => novoCredito(ctx));
      ouvir(el, 'click', '[data-validar], [data-ver]', (b) => detalhe(ctx, achar(b.dataset.validar ?? b.dataset.ver), valida && !!b.dataset.validar));
    },
  };
}

async function novoCredor(ctx) {
  const r = await formulario({
    titulo: 'Novo credor', rotulo: 'Cadastrar',
    campos: [
      { nome: 'nome', rotulo: 'Nome / razão social', obrigatorio: true },
      { nome: 'documento', rotulo: 'CNPJ ou CPF', dica: 'Opcional.' },
      { nome: 'meEpp', rotulo: 'É ME ou EPP?', tipo: 'select', valor: 'nao', opcoes: [{ v: 'nao', t: 'Não' }, { v: 'sim', t: 'Sim' }] },
    ],
    async enviar(v) { await api.post(`/api/projetos/${ctx.id}/credores`, { nome: v.nome, documento: v.documento, meEpp: v.meEpp === 'sim' }); toast('Credor cadastrado'); },
  });
  if (r) novoCredito(ctx);
}

async function novoCredito(ctx) {
  let credores;
  try { credores = await api.get(`/api/projetos/${ctx.id}/credores`); } catch (e) { return erroDe(e); }
  if (!credores.length) return novoCredor(ctx);
  await formulario({
    titulo: 'Novo crédito', subtitulo: 'Valores em reais. A classe é sugerida pela natureza e depois validada por uma pessoa.', rotulo: 'Cadastrar',
    campos: [
      { nome: 'credorId', rotulo: 'Credor', tipo: 'select', obrigatorio: true, opcoes: credores.map((c) => ({ v: c.id, t: c.nome })) },
      { nome: 'natureza', rotulo: 'Natureza do crédito', tipo: 'select', obrigatorio: true, valor: 'quirografario', opcoes: Object.entries(NATUREZAS).map(([v, t]) => ({ v, t })) },
      { nome: 'valor', rotulo: 'Valor (R$)', metade: true, obrigatorio: true, placeholder: '1.250.000,00' },
      { nome: 'valorBemGravado', rotulo: 'Bem gravado (R$)', metade: true, placeholder: 'Só garantia real' },
    ],
    async enviar(v) {
      const valor = paraCentavos(v.valor); if (!valor) throw new Error('Valor inválido. Use o formato 1.250.000,00');
      const corpo = { credorId: v.credorId, natureza: v.natureza, valor };
      if (v.valorBemGravado) { const g = paraCentavos(v.valorBemGravado); if (!g) throw new Error('Valor do bem gravado inválido'); corpo.valorBemGravado = g; }
      await api.post(`/api/projetos/${ctx.id}/creditos`, corpo); toast('Crédito cadastrado');
    },
  });
  await ctx.recarregar();
}

async function detalhe(ctx, c, validar) {
  const s = c.enquadramentoSugerido;
  const corpoInfo = html`<div style="display:grid;gap:10px;margin-bottom:14px">
    <div class="flex"><span class="selo info">${NATUREZAS[c.natureza]}</span><span class="mono-sm">R$ ${c.valorFormatado}</span></div>
    ${s ? html`<div><small class="muted">SUGESTÃO DO SISTEMA (NÃO DEFINITIVA)</small>
      <p style="margin:4px 0">${s.sujeito ? `Sujeito à recuperação · Classe ${s.classe}` : 'Não sujeito à recuperação'}</p>
      <ul class="dica" style="margin:0;padding-left:18px">${(s.fundamentos ?? []).map((f) => html`<li>${f}</li>`)}</ul>
      ${(s.ressalvas ?? []).length ? html`<p class="dica" style="margin:8px 0 0;color:var(--lab-amber-2)">Ressalvas: ${s.ressalvas.join(' · ')}</p>` : ''}</div>` : ''}
    ${c.classe_validada ? html`<p class="dica">Validado em ${new Date(c.validado_em).toLocaleDateString('pt-BR')}: classe ${c.classe_validada}.</p>` : ''}</div>`;
  if (!validar) return modal({ titulo: c.credor, subtitulo: 'Crédito', corpo: String(corpoInfo), acoes: [{ id: 'ok', rotulo: 'Fechar', tipo: 'primario' }], aoAbrir(el) { el.addEventListener('acao', () => el.fechar(true)); } });
  await formulario({
    titulo: `Validar enquadramento — ${c.credor}`, subtitulo: 'Ato jurídico: só confirme depois de conferir a natureza e a documentação.', rotulo: 'Validar', largo: true,
    campos: [
      { nome: 'classe', rotulo: 'Classe', tipo: 'select', metade: true, obrigatorio: true, valor: s?.classe ?? 'III', opcoes: Object.entries(CLASSES).map(([v, t]) => ({ v, t })) },
      { nome: 'sujeito', rotulo: 'Sujeito à recuperação?', tipo: 'select', metade: true, valor: s?.sujeito === false ? 'nao' : 'sim', opcoes: [{ v: 'sim', t: 'Sim' }, { v: 'nao', t: 'Não (extraconcursal)' }] },
      { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', placeholder: 'Por que esta classe? Registre se divergiu da sugestão.' },
    ],
    depois(el) { el.querySelector('.modal__body').insertAdjacentHTML('afterbegin', String(corpoInfo)); },
    async enviar(v) { await api.post(`/api/creditos/${c.id}/validar`, { classe: v.classe, sujeito: v.sujeito === 'sim', observacao: v.observacao }); toast('Enquadramento validado'); },
  });
  await ctx.recarregar();
}
