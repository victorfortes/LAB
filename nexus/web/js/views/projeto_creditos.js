/** Aba QGC: o quadro automático (do balancete) e o validado, com a validação humana da classe (§7.7). */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, guardado, html, icone, ouvir, paraCentavos, raw, reais } from '../util.js';
import { confirmar, erroDe, formulario, modal, toast, vazio } from '../ui.js';
import { qgcAgc, qgcPre } from './projeto_pre_agc.js';

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
  // Terceira vista conforme o tipo: adesões ao PRE (recuperação extrajudicial) ou simulador da AGC (recuperação judicial).
  // Recuperação judicial (e reestruturação a caminho dela): quórum e poder de voto na AGC. Extrajudicial: adesões ao PRE.
  const extra = ctx.h.tipo === 'recuperacao_extrajudicial' ? ['pre', 'Adesões ao PRE', qgcPre]
    : ['recuperacao_judicial', 'reestruturacao'].includes(ctx.h.tipo) ? ['agc', 'Quórum da AGC', qgcAgc] : null;
  let modo = guardado.ler(`qgcModo.${ctx.id}`, 'automatico');
  if (!['automatico', 'validado', extra?.[0]].includes(modo)) modo = 'automatico';
  const corpo = extra && modo === extra[0] ? await extra[2](ctx) : modo === 'validado' ? await qgcValidado(ctx) : await qgcAutomatico(ctx);
  const seg = html`<div class="seg up" role="group" aria-label="Vista do QGC"><span class="seg__pill" aria-hidden="true"></span>
    <button type="button" class="seg__btn" data-qgc-modo="automatico" aria-pressed="${modo === 'automatico'}"><span>QGC automático</span></button>
    <button type="button" class="seg__btn" data-qgc-modo="validado" aria-pressed="${modo === 'validado'}"><span>QGC validado</span></button>
    ${extra ? html`<button type="button" class="seg__btn" data-qgc-modo="${extra[0]}" aria-pressed="${modo === extra[0]}"><span>${extra[1]}</span></button>` : ''}</div>`;
  return {
    html: html`<div class="qgc-barra">${seg}<span class="grow"></span><div class="qgc-barra__acoes">${corpo.acoes ?? ''}</div></div>${corpo.html}`,
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
  const [d, docs, lp] = await Promise.all([api.get(`/api/projetos/${ctx.id}/creditos`), api.get(`/api/projetos/${ctx.id}/documentos`).catch(() => []),
    api.get(`/api/projetos/${ctx.id}/qgc/lastros`).catch(() => ({ lastros: {}, sugestoesSujeito: [], documentosNovos: [], sujeitos: {}, acessos: [], semLastro: 0 }))]);
  const listaDocs = Array.isArray(docs) ? docs : docs.documentos ?? [];
  const sujeitoDe = (c) => { const v = lp.sujeitos?.[c.id]?.valorSujeito; if (v !== null && v !== undefined) return BigInt(v); const suj = c.sujeito_validado ?? c.enquadramentoSugerido?.sujeito; return suj === false ? 0n : BigInt(c.valor); };
  const fmtC = (v) => reais(String(v));
  const totalCred = d.creditos.reduce((s, c) => s + BigInt(c.valor), 0n); const totalSuj = d.creditos.reduce((s, c) => s + sujeitoDe(c), 0n);
  const escreve = pode('credito.escrever') && ctx.h.situacao !== 'encerrado';
  const valida = pode('credito.validar');
  const maior = Math.max(1, ...d.consolidado.map((c) => Number(c.valor)));
  const planilhas = listaDocs.filter((x) => x.tem_arquivo !== false && /\.(xlsx|csv)$/i.test(x.nome_original ?? x.titulo ?? ''));
  return {
    acoes: escreve ? html`<button type="button" class="btn btn--ghost" data-relacao-final>${icone('upload')}Relação final do cliente</button>
      <button type="button" class="btn btn--ghost" data-aj>${icone('shield')}Acesso do AJ</button>
      <button type="button" class="btn btn--accent" data-credito-rapido>${icone('plus')}Adicionar crédito</button>` : '',
    html: html`<p class="dica up" style="margin:0 0 12px">${d.creditos.length} crédito(s) · ${d.pendentesDeValidacao} com a classe ainda por validar. Este é o quadro que reflete a relação final de credores; a classe sugerida só vira definitiva com validação de alguém qualificado.</p>
      ${d.creditos.length ? html`<div class="qgc-resumo up" style="margin-bottom:12px"><span><small>Valor dos créditos</small><b>R$ ${fmtC(totalCred)}</b></span><span><small>Valor sujeito à RJ</small><b>R$ ${fmtC(totalSuj)}</b></span><span><small>Extraconcursal</small><b>R$ ${fmtC(totalCred - totalSuj)}</b></span><span><small>Com lastro</small><b>${d.creditos.length - lp.semLastro}</b><i>de ${d.creditos.length}</i></span></div>` : ''}
      ${lp.documentosNovos.length ? html`<section class="qgc-vivo up">${icone('bolt')}<div><b>${lp.documentosNovos.length} documento(s) novo(s) do cliente</b><small>${lp.documentosNovos.slice(0, 3).map((x) => x.titulo).join(' · ')}${lp.correlacaoAutomatica ? ` · ${lp.correlacaoAutomatica.novos} lastro(s) novo(s) sugerido(s) agora` : ''}. Reveja o QGC e o diagnóstico.</small></div></section>` : ''}
      ${lp.sugestoesSujeito.length && escreve ? html`<section class="qgc-sugestao up"><header>${icone('alert')}<b>${lp.sugestoesSujeito.length} crédito(s) com garantia que não cobre o valor inteiro</b></header>
        <ul>${lp.sugestoesSujeito.map((x) => html`<li><div><b>${x.credor}</b><small>${x.motivo}</small></div><button class="btn btn--accent btn--sm" data-aplicar-sujeito="${x.creditoId}" data-valor="${x.valorSujeito}">Aplicar: sujeito R$ ${x.valorSujeitoFormatado}</button></li>`)}</ul></section>` : ''}
      ${d.creditos.length ? html`<div class="grid-hub">
        <section class="card glass up"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Credor</th><th>Natureza</th><th class="num">Valor do crédito</th><th class="num">Valor sujeito</th><th>Classe</th><th>Lastro</th><th></th></tr></thead>
          <tbody>${d.creditos.map((c) => html`<tr>
            <td><b>${c.credor}</b>${c.me_epp ? html`<small>ME/EPP</small>` : ''}</td>
            <td>${NATUREZAS[c.natureza] ?? c.natureza}${c.valor_bem_gravado ? html`<small>bem gravado R$ ${reais(c.valor_bem_gravado)}</small>` : ''}</td>
            <td class="num">${c.valorFormatado}</td>
            <td class="num">${(() => { const v = sujeitoDe(c); const manual = lp.sujeitos?.[c.id]?.valorSujeito != null; return html`<button type="button" class="link qgc-sujeito ${v < BigInt(c.valor) ? 'is-parcial' : ''}" data-sujeito="${c.id}" ${escreve ? '' : raw('disabled')} title="${manual ? 'Ajustado pela equipe' : 'Automático pela natureza'}${lp.sujeitos?.[c.id]?.garantia ? ` · ${lp.sujeitos[c.id].garantia}` : ''}">${fmtC(v)}${manual ? '' : html`<small> auto</small>`}</button>`; })()}</td>
            <td>${c.classe_validada ? html`<span class="selo ok"><i></i>Classe ${c.classe_validada}${c.sujeito_validado === false ? ' · extraconcursal' : ''}</span>`
              : html`<span class="selo aviso" title="Sugerida pelo sistema; falta validação humana"><i></i>${c.enquadramentoSugerido?.sujeito === false ? 'Não sujeito (sugerido)' : `Classe ${c.enquadramentoSugerido?.classe ?? '?'} (sugerida)`}</span>`}</td>
            <td>${(() => { const ls = (lp.lastros[c.id] ?? []).filter((l) => l.situacao !== 'recusado'); return ls.length ? html`<div class="qgc-lastros">${ls.slice(0, 3).map((l) => html`<button type="button" class="qgc-lastro ${l.situacao === 'confirmado' ? 'is-ok' : ''}" data-ver-doc="${l.documentoId}" data-nome="${l.nome}" title="${l.motivo ?? ''}">${icone('file')}<span>${l.titulo}</span></button>`)}${ls.length > 3 ? html`<small>+${ls.length - 3}</small>` : ''}</div>` : html`<span class="selo aviso">sem lastro</span>`; })()}
              ${escreve ? html`<button type="button" class="link qgc-lastro-add" data-lastros="${c.id}">gerir</button>` : ''}</td>
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
      ouvir(el, 'click', '[data-ver-doc]', (b) => verDocumento(b.dataset.verDoc, b.dataset.nome));
      ouvir(el, 'click', '[data-aplicar-sujeito]', async (b) => { b.disabled = true; try { await api.put(`/api/creditos/${b.dataset.aplicarSujeito}/sujeito`, { valorSujeito: b.dataset.valor }); toast('Valor sujeito aplicado'); ctx.recarregar(); } catch (e) { b.disabled = false; erroDe(e); } });
      ouvir(el, 'click', '[data-sujeito]', async (b) => {
        const c = achar(b.dataset.sujeito); const atual = lp.sujeitos?.[c.id] ?? {};
        const ok = await formulario({ titulo: `Valor sujeito · ${c.credor}`, subtitulo: `Crédito de R$ ${c.valorFormatado}. Use quando só parte do crédito se sujeita (ex.: alienação fiduciária de bem que não cobre a dívida: o saldo descoberto se sujeita como quirografário).`, rotulo: 'Salvar', campos: [
          { nome: 'modo', rotulo: 'Como calcular', tipo: 'select', valor: atual.valorSujeito != null ? 'manual' : 'auto', opcoes: [{ v: 'auto', t: 'Automático pela natureza do crédito' }, { v: 'manual', t: 'Informar o valor sujeito' }] },
          { nome: 'valor', rotulo: 'Valor sujeito (R$)', valor: atual.valorSujeito != null ? reais(atual.valorSujeito) : '', placeholder: '400.000,00', metade: true },
          { nome: 'garantia', rotulo: 'Garantia (descrição)', valor: atual.garantia ?? '', placeholder: 'Alienação fiduciária do imóvel mat. 12.345', metade: true }],
          async enviar(v) {
            const valorSujeito = v.modo === 'auto' ? null : String(paraCentavos(v.valor ?? '') ?? '');
            if (v.modo !== 'auto' && !/^\d+$/.test(valorSujeito)) throw new Error('Informe o valor sujeito no formato 400.000,00');
            await api.put(`/api/creditos/${c.id}/sujeito`, { valorSujeito, garantiaDescricao: v.garantia || null });
          } });
        if (ok) { toast('Valor sujeito salvo'); ctx.recarregar(); }
      });
      ouvir(el, 'click', '[data-lastros]', (b) => gerirLastros(ctx, achar(b.dataset.lastros), lp.lastros[b.dataset.lastros] ?? [], listaDocs));
      ouvir(el, 'click', '[data-aj]', () => acessoAj(ctx, lp.acessos));
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

/** Abre o documento NO SISTEMA (sem baixar): PDF e imagem no visualizador, planilha e texto como tabela/texto. */
export async function verDocumento(documentoId, nome = 'Documento') {
  let url = null;
  await modal({ titulo: nome, subtitulo: 'Visualização no sistema', largo: true, corpo: '<div class="docview" data-docview><div class="skel" style="height:60vh"></div></div>',
    acoes: [{ id: 'baixar', rotulo: 'Baixar' }, { id: 'ok', rotulo: 'Fechar', tipo: 'primario' }],
    async aoAbrir(el) {
      el.querySelector('.modal__box')?.classList.add('docview-box');
      el.addEventListener('acao', async (e) => {
        if (e.detail.id === 'baixar') { try { const r = await api.post(`/api/documentos/${documentoId}/link`); window.open(r.url, '_blank', 'noopener'); } catch (er) { erroDe(er); } return; }
        if (url) URL.revokeObjectURL(url); el.fechar(true);
      });
      const alvo = el.querySelector('[data-docview]');
      try {
        const link = await api.post(`/api/documentos/${documentoId}/link`);
        const resp = await fetch(link.url, { credentials: 'same-origin' }); if (!resp.ok) throw new Error(`não foi possível abrir (HTTP ${resp.status})`);
        const blob = await resp.blob(); const tipo = blob.type || ''; const n = (link.nome ?? nome).toLowerCase();
        if (tipo.includes('pdf') || n.endsWith('.pdf')) { url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })); alvo.innerHTML = `<iframe title="${nome.replace(/"/g, '')}" src="${url}#view=FitH"></iframe>`; }
        else if (tipo.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(n)) { url = URL.createObjectURL(blob); alvo.innerHTML = `<img alt="" src="${url}">`; }
        else if (/\.(xlsx|csv)$/.test(n) || tipo.includes('spreadsheet') || tipo.includes('csv')) {
          const { lerPlanilha } = await import('../planilha.js'); const linhas = await lerPlanilha(new File([blob], n));
          const cab = Object.keys(linhas[0] ?? {});
          alvo.innerHTML = String(html`<div class="tbl-wrap docview-tbl"><table class="tbl"><thead><tr>${cab.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>${linhas.slice(0, 1000).map((l) => html`<tr>${cab.map((h) => html`<td>${l[h] ?? ''}</td>`)}</tr>`)}</tbody></table></div>${linhas.length > 1000 ? html`<p class="dica">Mostrando 1.000 de ${linhas.length} linhas.</p>` : ''}`);
        } else if (tipo.startsWith('text/') || /\.(txt|json|xml)$/.test(n)) { alvo.innerHTML = String(html`<pre class="docview-txt">${await blob.text()}</pre>`); }
        else alvo.innerHTML = String(html`<p class="dica">Este formato (${tipo || n.split('.').pop()}) não abre no navegador. Use "Baixar".</p>`);
      } catch (er) { alvo.innerHTML = String(html`<p class="selo erro">${er.message}</p>`); }
    } });
}

async function gerirLastros(ctx, c, atuais, docs) {
  if (!c) return;
  const ja = new Set(atuais.map((l) => l.documentoId));
  await modal({ titulo: `Lastro · ${c.credor}`, subtitulo: 'O documento que prova o crédito (contrato, título, nota, sentença). O sistema sugere pelo nome/CNPJ do credor; confirme ou recuse.', largo: true,
    corpo: String(html`<div class="lastro-gestao">
      ${atuais.length ? html`<ul class="lista">${atuais.map((l) => html`<li><button type="button" class="link" data-ver="${l.documentoId}" data-nome="${l.nome}">${icone('file')}${l.titulo}</button><div><small>${l.situacao === 'sugerido' ? `Sugerido · ${l.motivo ?? ''}` : l.situacao === 'confirmado' ? 'Confirmado' : 'Recusado'}</small></div>
        <div class="fim flex">${l.situacao !== 'confirmado' ? html`<button class="btn btn--accent btn--sm" data-sit="${l.id}:confirmado">Confirmar</button>` : ''}${l.situacao !== 'recusado' ? html`<button class="btn btn--ghost btn--sm" data-sit="${l.id}:recusado">Não é</button>` : html`<button class="btn btn--ghost btn--sm" data-sit="${l.id}:sugerido">Desfazer</button>`}</div></li>`)}</ul>` : html`<p class="dica">Nenhum documento ligado ainda.</p>`}
      <label class="field mt"><span>Ligar outro documento do projeto</span><select class="select" data-doc><option value="">Escolha…</option>${docs.filter((x) => x.tem_arquivo !== false && !ja.has(x.id)).map((x) => html`<option value="${x.id}">${x.titulo}${x.origem === 'portal_cliente' ? ' · do cliente' : ''}</option>`)}</select></label>
      <button class="btn btn--ghost btn--sm" data-correlacionar>${icone('sparkle')}Procurar lastros de novo em todos os documentos</button></div>`),
    acoes: [{ id: 'ok', rotulo: 'Fechar', tipo: 'primario' }],
    aoAbrir(el) {
      let mudou = false;
      el.addEventListener('acao', () => { el.fechar(true); if (mudou) ctx.recarregar(); });
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.ver) return verDocumento(b.dataset.ver, b.dataset.nome);
        if (b.dataset.sit) { const [id, situacao] = b.dataset.sit.split(':'); try { await api.patch(`/api/lastros/${id}`, { situacao }); mudou = true; toast('Lastro atualizado'); b.closest('li').style.opacity = .5; } catch (er) { erroDe(er); } }
        if (b.matches('[data-correlacionar]')) { b.disabled = true; try { const r = await api.post(`/api/projetos/${ctx.id}/qgc/lastros/correlacionar`, {}); mudou = true; toast(`${r.novos} lastro(s) novo(s) sugerido(s); ${r.creditosComLastro} de ${r.creditos} créditos com lastro`); } catch (er) { erroDe(er); } finally { b.disabled = false; } }
      });
      el.querySelector('[data-doc]').addEventListener('change', async (e) => { if (!e.target.value) return; try { await api.post(`/api/creditos/${c.id}/lastros`, { documentoId: e.target.value }); mudou = true; toast('Documento ligado como lastro'); el.fechar(true); ctx.recarregar(); } catch (er) { erroDe(er); } });
    } });
}

/** Link do administrador judicial: vê o QGC com os lastros e abre cada documento, sem acessar mais nada. */
async function acessoAj(ctx, acessos) {
  const ativos = acessos.filter((a) => !a.revogadoEm && new Date(a.expiraEm) > new Date());
  await modal({ titulo: 'Acesso do administrador judicial', subtitulo: 'Um link próprio, com validade, que mostra só o QGC deste projeto com os lastros de cada crédito. Pode ser revogado a qualquer momento e cada uso fica registrado.', largo: true,
    corpo: String(html`${ativos.length ? html`<ul class="lista">${ativos.map((a) => html`<li><div><b>${a.nome}</b><small>${a.papel === 'administrador_judicial' ? 'Administrador judicial' : a.papel} · válido até ${dataBR(a.expiraEm)} · ${a.usos} acesso(s)${a.ultimoUso ? ` · último ${dataBR(a.ultimoUso)}` : ''}${a.soValidado ? ' · só créditos validados' : ''}</small></div><div class="fim"><button class="btn btn--ghost btn--sm perigo-btn" data-revogar="${a.id}">Revogar</button></div></li>`)}</ul>` : html`<p class="dica">Nenhum link ativo.</p>`}
      <form class="mt" data-novo-aj><div class="row2"><label class="field"><span>Nome *</span><input class="input" name="nome" required placeholder="Ex.: Dr. Fulano · Administrador judicial"></label><label class="field"><span>E-mail</span><input class="input" name="email" type="email"></label></div>
        <div class="row2"><label class="field"><span>Validade (dias)</span><input class="input" name="dias" type="number" min="1" max="365" value="90"></label><label class="field"><span>Mostrar</span><select class="select" name="so"><option value="sim">Só créditos com classe validada</option><option value="nao">Todos os créditos</option></select></label></div>
        <button class="btn btn--accent" type="submit">${icone('link')}Gerar link</button></form><div data-link-gerado></div>`),
    acoes: [{ id: 'ok', rotulo: 'Fechar', tipo: 'primario' }],
    aoAbrir(el) {
      el.addEventListener('acao', () => el.fechar(true));
      el.querySelector('[data-novo-aj]').addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target; const btn = f.querySelector('button'); btn.disabled = true;
        try {
          const r = await api.post(`/api/projetos/${ctx.id}/qgc/acessos`, { nome: f.nome.value, email: f.email.value || null, dias: Number(f.dias.value) || 90, soValidado: f.so.value === 'sim' });
          const link = `${location.origin}${r.caminho}`;
          el.querySelector('[data-link-gerado]').innerHTML = String(html`<div class="aj-link mt"><p><b>Link gerado.</b> Copie agora: por segurança ele não é mostrado de novo.</p><input class="input mono-sm" readonly value="${link}"><button class="btn btn--accent btn--sm" type="button" data-copiar-aj>Copiar link</button></div>`);
          el.querySelector('[data-copiar-aj]').addEventListener('click', () => navigator.clipboard?.writeText(link).then(() => toast('Link copiado')));
        } catch (er) { erroDe(er); btn.disabled = false; }
      });
      el.addEventListener('click', async (e) => { const b = e.target.closest('[data-revogar]'); if (!b) return; if (!(await confirmar('Revogar o link?', 'Quem tiver o link perde o acesso na hora.', { rotulo: 'Revogar', perigo: true }))) return; try { await api.del(`/api/qgc/acessos/${b.dataset.revogar}`); toast('Link revogado'); b.closest('li').remove(); } catch (er) { erroDe(er); } });
    } });
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
