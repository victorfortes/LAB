/** Aba QGC: o quadro automático (do balancete) e o validado, com a validação humana da classe (§7.7). */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, guardado, html, icone, ouvir, paraCentavos, raw, reais } from '../util.js';
import { confirmar, erroDe, formulario, modal, toast, vazio } from '../ui.js';

export const NATUREZAS = {
  trabalhista: 'Trabalhista', acidente_trabalho: 'Acidente de trabalho', garantia_real: 'Garantia real', quirografario: 'Quirografário',
  privilegio_especial: 'Privilégio especial', privilegio_geral: 'Privilégio geral', subordinado: 'Subordinado', me_epp: 'ME/EPP',
  tributario: 'Tributário', proprietario_fiduciario: 'Propriedade fiduciária', arrendamento_mercantil: 'Arrendamento mercantil',
  reserva_dominio: 'Reserva de domínio', promitente_vendedor_irrevogavel: 'Promitente vendedor irrevogável',
  adiantamento_contrato_cambio: 'Adiantamento de contrato de câmbio', posterior_ao_pedido: 'Posterior ao pedido',
};
const CLASSES = { I: 'Classe I · Trabalhista', II: 'Classe II · Garantia real', III: 'Classe III · Quirografária', IV: 'Classe IV · ME/EPP' };

const CLASSE_CURTA = { I: 'Classe I', II: 'Classe II', III: 'Classe III', IV: 'Classe IV' };
const opcoesNatureza = (atual) => Object.entries(NATUREZAS).map(([v, t]) => html`<option value="${v}" ${v === atual ? raw('selected') : ''}>${t}</option>`);
const seloClasse = (classe, sujeito) => sujeito === false ? html`<span class="selo" title="Em regra não se sujeita à recuperação">Fora da RJ</span>` : classe ? html`<span class="selo info">${CLASSE_CURTA[classe]}</span>` : html`<span class="selo">?</span>`;

/** Aba QGC: automático (lido do balancete, editável) e validado (o que vai para a relação de credores). */
export async function abaCreditos(ctx) {
  const modo = guardado.ler(`qgcModo.${ctx.id}`, 'automatico');
  const corpo = modo === 'validado' ? await qgcValidado(ctx) : await qgcAutomatico(ctx);
  const seg = html`<div class="seg up" role="group" aria-label="Vista do QGC"><span class="seg__pill" aria-hidden="true"></span>
    <button type="button" class="seg__btn" data-qgc-modo="automatico" aria-pressed="${modo === 'automatico'}"><span>QGC automático</span></button>
    <button type="button" class="seg__btn" data-qgc-modo="validado" aria-pressed="${modo === 'validado'}"><span>QGC validado</span></button></div>`;
  return {
    html: html`<div class="flex" style="margin-bottom:12px">${seg}<span class="grow"></span>${corpo.acoes ?? ''}</div>${corpo.html}`,
    depois(el) {
      ouvir(el, 'click', '[data-qgc-modo]', (b) => { guardado.gravar(`qgcModo.${ctx.id}`, b.dataset.qgcModo); ctx.recarregar(); });
      corpo.depois?.(el);
    },
  };
}

// ------------------------------------------------------------ automático ---

async function qgcAutomatico(ctx) {
  const d = await api.get(`/api/projetos/${ctx.id}/qgc/preliminar`);
  const escreve = pode('credito.escrever') && ctx.h.situacao !== 'encerrado';
  const r = d.resumo; const abertas = d.linhas.filter((l) => l.situacao === 'preliminar');
  const avisos = ctx.avisosQgc ?? [];
  const linha = (l) => html`<tr data-linha="${l.id}" class="${l.situacao === 'validado' ? 'qgc-validada' : ''}">
    <td>${escreve && l.situacao === 'preliminar' ? html`<input class="input input--tabela" data-campo="credor" value="${l.credor}" aria-label="Credor">` : html`<b>${l.credor}</b>`}
      <small title="${l.referencia ?? ''}">${l.conta ? `${l.codigo ? `${l.codigo} · ` : ''}${l.conta}` : 'incluída à mão'}${l.grupo ? ` · ${l.grupo}` : ''}</small></td>
    <td>${escreve && l.situacao === 'preliminar' ? html`<select class="select input--tabela" data-campo="natureza" aria-label="Natureza">${opcoesNatureza(l.natureza)}</select>` : NATUREZAS[l.natureza] ?? l.natureza}
      ${l.hipotese && l.situacao === 'preliminar' ? html`<small class="qgc-hipotese" title="${l.motivo}">hipótese · ${l.motivo}</small>` : ''}</td>
    <td>${seloClasse(l.classe, l.sujeito)}</td>
    <td class="num">${escreve && l.situacao === 'preliminar' ? html`<input class="input input--tabela num" data-campo="valor" value="${reais(l.valor)}" aria-label="Valor em reais" inputmode="decimal">` : l.valorFormatado}</td>
    <td class="num qgc-acoes">${l.situacao === 'validado' ? html`<span class="selo ok">No QGC validado</span>`
      : escreve ? html`<button type="button" class="btn btn--ghost btn--sm" data-validar-linha="${l.id}" title="Levar para o QGC validado">Validar</button><button type="button" class="ibtn ibtn--sm" data-descartar="${l.id}" aria-label="Descartar linha" title="Descartar">${icone('x')}</button>` : ''}</td></tr>`;
  return {
    acoes: escreve ? html`<button type="button" class="btn btn--ghost" data-ler-balancete>${icone('upload')}Ler balancete</button>
      <button type="button" class="btn btn--ghost" data-incluir>${icone('plus')}Adicionar linha</button>
      ${abertas.length ? html`<button type="button" class="btn btn--accent" data-validar-todas>Validar todas (${abertas.length})</button>` : ''}` : '',
    html: html`<section class="card glass up qgc-nota"><span class="nx-eyebrow">QGC preliminar</span>
        <p>${d.fonte ? html`Reflexo do passivo declarado no balancete <b>${d.fonte.documento}</b>, lido em ${dataBR(d.fonte.lidoEm)}.` : 'Ainda não há balancete lido para este projeto.'}
          Não é a relação de credores do art. 51, III: credor, natureza e classe saem do nome das contas e precisam de conferência. Linhas marcadas como hipótese pedem atenção antes de validar.</p>
        ${d.linhas.length ? html`<div class="qgc-resumo"><span><small>Total do passivo lido</small><b>R$ ${r.total}</b></span>${r.porClasse.map((c) => html`<span><small>${c.classe === '?' ? 'Sem classe' : CLASSE_CURTA[c.classe]}</small><b>R$ ${c.valor}</b><i>${c.credores} linha(s)</i></span>`)}
          <span><small>Fora da RJ</small><b>R$ ${r.foraDaRecuperacao}</b></span><span><small>Hipóteses</small><b>${r.hipoteses}</b><i>${r.validadas} validada(s)</i></span></div>` : ''}</section>
      ${avisos.length ? html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Avisos da última leitura</h2><p class="card__sub">O que não entrou e por quê.</p></div></header><ul class="lista">${avisos.map((a) => html`<li><div><small>${a}</small></div></li>`)}</ul></section>` : ''}
      <section class="card glass up mt">${d.linhas.length ? html`<div class="tbl-wrap"><table class="tbl qgc-tabela"><thead><tr><th>Credor e conta de origem</th><th>Natureza</th><th>Classe</th><th class="num">Valor (R$)</th><th></th></tr></thead>
        <tbody>${d.linhas.map(linha)}</tbody></table></div>${escreve ? html`<p class="dica mt">Edite direto na tabela: a alteração é salva ao sair do campo e a classe é recalculada pela natureza.</p>` : ''}`
        : vazio('scale', 'Nenhuma linha ainda', 'Escolha o balancete do cliente (XLSX, CSV ou PDF gerado pelo sistema contábil) e o sistema monta o QGC preliminar a partir do passivo.', escreve ? '<button class="btn btn--accent" data-ler-balancete>Ler balancete</button>' : '')}</section>`,
    depois(el) {
      ouvir(el, 'click', '[data-ler-balancete]', async () => {
        if (!d.fontes.length) return toast('Nenhum arquivo XLSX, CSV ou PDF neste projeto. Peça o balancete ao cliente pelo portal.', 'aviso');
        let res;
        const ok = await formulario({ titulo: 'Ler balancete', subtitulo: 'As linhas automáticas ainda não validadas são refeitas; as incluídas à mão e as validadas ficam.', rotulo: 'Ler e montar o QGC',
          campos: [{ nome: 'doc', rotulo: 'Arquivo', tipo: 'select', obrigatorio: true, opcoes: d.fontes.map((f) => ({ v: f.id, t: `${f.titulo}${f.origem === 'portal_cliente' ? ' · enviado pelo cliente' : ''} · ${dataBR(f.criadoEm)}` })) }],
          async enviar(v) { res = await api.post(`/api/projetos/${ctx.id}/qgc/preliminar`, { documentoId: v.doc }); } });
        if (!ok) return;
        ctx.avisosQgc = res.avisos;
        toast(res.linhas ? `${res.linhas} linha(s) do passivo, total R$ ${res.total}` : 'Nenhuma conta de passivo encontrada. Veja os avisos.', res.linhas ? undefined : 'aviso');
        ctx.recarregar();
      });
      ouvir(el, 'click', '[data-incluir]', () => formulario({ titulo: 'Adicionar linha ao QGC preliminar', rotulo: 'Adicionar', campos: [
        { nome: 'credor', rotulo: 'Credor', obrigatorio: true }, { nome: 'natureza', rotulo: 'Natureza', tipo: 'select', valor: 'quirografario', opcoes: Object.entries(NATUREZAS).map(([v, t]) => ({ v, t })) },
        { nome: 'valor', rotulo: 'Valor (R$)', obrigatorio: true, metade: true, placeholder: '150.000,00' }, { nome: 'documentoCredor', rotulo: 'CPF ou CNPJ', metade: true }],
        async enviar(v) { const c = paraCentavos(v.valor); if (!c) throw new Error('Valor inválido. Use 150.000,00'); await api.post(`/api/projetos/${ctx.id}/qgc/preliminar/linhas`, { credor: v.credor, natureza: v.natureza, valor: c, documentoCredor: v.documentoCredor || null }); } })
        .then((ok) => ok && ctx.recarregar()));
      el.addEventListener('change', async (e) => {
        const campo = e.target.closest('[data-campo]'); if (!campo) return; const id = campo.closest('[data-linha]').dataset.linha;
        let valor = campo.value.trim();
        if (campo.dataset.campo === 'valor') { valor = paraCentavos(valor); if (!valor) { toast('Valor inválido. Use 150.000,00', 'erro'); return; } }
        if (campo.dataset.campo === 'credor' && !valor) { toast('O credor não pode ficar em branco', 'erro'); return; }
        try { await api.patch(`/api/qgc/preliminar/${id}`, { [campo.dataset.campo]: valor }); toast('Linha salva'); if (campo.dataset.campo !== 'credor') ctx.recarregar(); } catch (er) { erroDe(er); }
      });
      ouvir(el, 'click', '[data-validar-linha]', async (b) => { b.disabled = true; try { await api.post(`/api/qgc/preliminar/${b.dataset.validarLinha}/validar`); toast('Linha levada ao QGC validado'); ctx.recarregar(); } catch (er) { b.disabled = false; erroDe(er); } });
      ouvir(el, 'click', '[data-descartar]', async (b) => { try { await api.del(`/api/qgc/preliminar/${b.dataset.descartar}`); ctx.recarregar(); } catch (er) { erroDe(er); } });
      ouvir(el, 'click', '[data-validar-todas]', async () => {
        if (!(await confirmar('Validar todas as linhas?', `${abertas.length} linha(s) vão para o QGC validado. A classe de cada uma ainda precisa ser conferida lá.`, { rotulo: 'Validar todas' }))) return;
        try { const x = await api.post(`/api/projetos/${ctx.id}/qgc/preliminar/validar-todas`); toast(`${x.validadas} linha(s) no QGC validado`); ctx.recarregar(); } catch (er) { erroDe(er); }
      });
    },
  };
}

// -------------------------------------------------------------- validado ---

async function qgcValidado(ctx) {
  const [d, docs] = await Promise.all([api.get(`/api/projetos/${ctx.id}/creditos`), api.get(`/api/projetos/${ctx.id}/documentos`).catch(() => [])]);
  const escreve = pode('credito.escrever') && ctx.h.situacao !== 'encerrado';
  const valida = pode('credito.validar');
  const maior = Math.max(1, ...d.consolidado.map((c) => Number(c.valor)));
  const planilhas = (Array.isArray(docs) ? docs : docs.documentos ?? []).filter((x) => x.tem_arquivo !== false && /\.(xlsx|csv)$/i.test(x.nome_original ?? x.titulo ?? ''));
  return {
    acoes: escreve ? html`<button type="button" class="btn btn--ghost" data-relacao-final>${icone('upload')}Relação final do cliente</button>
      <button type="button" class="btn btn--accent" data-credito-rapido>${icone('plus')}Adicionar crédito</button>` : '',
    html: html`<p class="dica up" style="margin:0 0 12px">${d.creditos.length} crédito(s) · ${d.pendentesDeValidacao} com a classe ainda por validar. Este é o quadro que reflete a relação final de credores; a classe sugerida só vira definitiva com validação de alguém qualificado.</p>
      ${d.creditos.length ? html`<div class="grid-hub">
        <section class="card glass up"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Credor</th><th>Natureza</th><th class="num">Valor (R$)</th><th>Classe</th><th></th></tr></thead>
          <tbody>${d.creditos.map((c) => html`<tr>
            <td><b>${c.credor}</b>${c.me_epp ? html`<small>ME/EPP</small>` : ''}</td>
            <td>${NATUREZAS[c.natureza] ?? c.natureza}${c.valor_bem_gravado ? html`<small>bem gravado R$ ${reais(c.valor_bem_gravado)}</small>` : ''}</td>
            <td class="num">${c.valorFormatado}</td>
            <td>${c.classe_validada ? html`<span class="selo ok"><i></i>Classe ${c.classe_validada}${c.sujeito_validado === false ? ' · extraconcursal' : ''}</span>`
              : html`<span class="selo aviso" title="Sugerida pelo sistema; falta validação humana"><i></i>${c.enquadramentoSugerido?.sujeito === false ? 'Não sujeito (sugerido)' : `Classe ${c.enquadramentoSugerido?.classe ?? '?'} (sugerida)`}</span>`}</td>
            <td class="num qgc-acoes">${valida && !c.classe_validada ? html`<button type="button" class="btn btn--ghost btn--sm" data-validar="${c.id}">Validar classe</button>` : html`<button type="button" class="btn btn--ghost btn--sm" data-ver="${c.id}">Ver</button>`}
              ${escreve ? html`<button type="button" class="ibtn ibtn--sm" data-editar-credito="${c.id}" aria-label="Editar crédito de ${c.credor}" title="Editar">${icone('edit')}</button>` : ''}</td></tr>`)}</tbody></table></div></section>
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Por classe</h2><p class="card__sub">${d.pendentesDeValidacao ? `Pela classe sugerida; ${d.pendentesDeValidacao} de ${d.creditos.length} ainda sem validação` : 'Todos os créditos validados'}</p></div></header>
          ${d.consolidado.length ? html`<div style="display:grid;gap:14px">${d.consolidado.map((c) => html`<div>
            <div class="flex" style="justify-content:space-between"><b>Classe ${c.classe}</b><span class="mono-sm">R$ ${c.valorFormatado}</span></div>
            <div class="fase-card__bar" style="height:9px;margin-top:6px"><i data-w="${Math.max(4, (Number(c.valor) / maior) * 100)}" style="width:0;transition:width 1s var(--ease)"></i></div>
            <small class="muted">${c.credores} credor(es)</small></div>`)}</div>`
            : html`<p class="dica">Sem créditos para consolidar.</p>`}
        </section></div>`
        : html`<section class="card glass up">${vazio('scale', 'QGC validado vazio', 'Valide as linhas do QGC automático, importe a relação final de credores enviada pelo cliente ou adicione um crédito.',
          escreve ? '<button class="btn btn--accent" data-credito-rapido>Adicionar crédito</button>' : '')}</section>`}`,
    depois(el) {
      const achar = (id) => d.creditos.find((c) => c.id === id);
      ouvir(el, 'click', '[data-credito-rapido]', () => creditoRapido(ctx));
      ouvir(el, 'click', '[data-editar-credito]', (b) => editarCredito(ctx, achar(b.dataset.editarCredito)));
      ouvir(el, 'click', '[data-validar], [data-ver]', (b) => detalhe(ctx, achar(b.dataset.validar ?? b.dataset.ver), valida && !!b.dataset.validar));
      ouvir(el, 'click', '[data-relacao-final]', async () => {
        if (!planilhas.length) return toast('Nenhuma planilha (XLSX ou CSV) neste projeto. A relação final do cliente chega pelo portal.', 'aviso');
        let r;
        const ok = await formulario({ titulo: 'Importar a relação final de credores', subtitulo: 'Lê a planilha enviada pelo cliente (colunas credor, CPF/CNPJ, classe ou natureza e valor) e cria os créditos. O que já estiver no quadro com o mesmo credor e valor não entra de novo.', rotulo: 'Importar',
          campos: [{ nome: 'doc', rotulo: 'Planilha', tipo: 'select', obrigatorio: true, opcoes: planilhas.map((x) => ({ v: x.id, t: x.titulo })) }],
          async enviar(v) { r = await api.post(`/api/projetos/${ctx.id}/qgc/relacao-final`, { documentoId: v.doc }); } });
        if (!ok) return;
        toast(`${r.criados} crédito(s) importado(s)${r.repetidos ? `, ${r.repetidos} já existiam` : ''}${r.avisos.length ? `. ${r.avisos.length} aviso(s): ${r.avisos.slice(0, 2).join('; ')}` : ''}`, r.avisos.length ? 'aviso' : undefined);
        ctx.recarregar();
      });
    },
  };
}

const camposCredito = (c = {}) => [
  { nome: 'credor', rotulo: 'Credor (nome ou razão social)', obrigatorio: true, valor: c.credor },
  { nome: 'documento', rotulo: 'CPF ou CNPJ', metade: true, valor: c.documento },
  { nome: 'meEpp', rotulo: 'ME ou EPP?', tipo: 'select', metade: true, valor: c.me_epp ? 'sim' : 'nao', opcoes: [{ v: 'nao', t: 'Não' }, { v: 'sim', t: 'Sim' }] },
  { nome: 'natureza', rotulo: 'Natureza do crédito', tipo: 'select', obrigatorio: true, valor: c.natureza ?? 'quirografario', opcoes: Object.entries(NATUREZAS).map(([v, t]) => ({ v, t })) },
  { nome: 'valor', rotulo: 'Valor (R$)', metade: true, obrigatorio: true, placeholder: '1.250.000,00', valor: c.valor ? reais(c.valor) : '' },
  { nome: 'valorBemGravado', rotulo: 'Bem gravado (R$)', metade: true, placeholder: 'Só garantia real', valor: c.valor_bem_gravado ? reais(c.valor_bem_gravado) : '' },
];
const lerCampos = (v) => {
  const valor = paraCentavos(v.valor); if (!valor) throw new Error('Valor inválido. Use o formato 1.250.000,00');
  const bem = v.valorBemGravado ? paraCentavos(v.valorBemGravado) : null; if (v.valorBemGravado && !bem) throw new Error('Valor do bem gravado inválido');
  return { credor: v.credor, documento: v.documento || null, meEpp: v.meEpp === 'sim', natureza: v.natureza, valor, valorBemGravado: bem };
};

/** Um popup só: o credor é criado junto, se ainda não existir com esse nome. */
async function creditoRapido(ctx) {
  const ok = await formulario({ titulo: 'Adicionar crédito', subtitulo: 'A classe é sugerida pela natureza e depois validada por uma pessoa.', rotulo: 'Adicionar', campos: camposCredito(),
    async enviar(v) { await api.post(`/api/projetos/${ctx.id}/qgc/credito`, lerCampos(v)); } });
  if (ok) { toast('Crédito adicionado'); ctx.recarregar(); }
}

async function editarCredito(ctx, c) {
  if (!c) return;
  let r;
  const ok = await formulario({ titulo: `Editar crédito · ${c.credor}`, subtitulo: c.classe_validada ? 'Trocar a natureza desfaz a validação da classe; ela precisa ser conferida de novo.' : undefined, rotulo: 'Salvar', campos: camposCredito(c),
    async enviar(v) { r = await api.patch(`/api/creditos/${c.id}`, lerCampos(v)); } });
  if (ok) { toast(r?.validacaoDesfeita ? 'Crédito salvo. A classe voltou para validação.' : 'Crédito salvo'); ctx.recarregar(); }
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
