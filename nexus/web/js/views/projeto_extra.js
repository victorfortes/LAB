/**
 * Abas do hub que lidam com o mundo de fora do escritório: processos e prazos,
 * documentos (acervo e análise), portal do cliente, plano e caixa, relatórios.
 *
 * Duas regras atravessam tudo aqui. (1) O que vai para o cliente só sai por
 * ação explícita de publicar (§13) — por isso "publicar" é um botão com
 * confirmação e o selo de visibilidade está sempre à vista. (2) O servidor
 * decide; a tela mostra o motivo da recusa em vez de esconder o botão e
 * deixar o usuário sem saber por quê.
 */
import { painelPrjStudio } from './projeto_prj.js';
import { painelFinanceiroProjeto } from './projeto_financeiro.js';
import { api } from '../api.js';
import { estado, pode } from '../estado.js';
import { anel } from '../fx.js';
import { $, $$, avatar, dataBR, dataCurta, dataHoraBR, hojeISO, html, icone, ouvir, paraCentavos, raw, reais, relativo, tamanho } from '../util.js';
import { confirmar, erroDe, formulario, modal, toast, vazio } from '../ui.js';
import { ir, navegar } from '../shell.js';

const soData = (d) => (d ? String(d).slice(0, 10) : '');
const baixar = async (docId) => {
  try { const r = await api.post(`/api/documentos/${docId}/link`); window.open(r.url, '_blank', 'noopener'); }
  catch (e) { erroDe(e); }
};
const fechar = (el) => new Promise((ok) => { el.addEventListener('acao', () => { el.fechar(true); ok(); }); });
const botaoFechar = [{ id: 'ok', rotulo: 'Fechar', tipo: 'primario' }];

// ================================================================ PROCESSOS ===

const SITUACAO_PROC = { ativo: ['ok', 'Ativo'], suspenso: ['aviso', 'Suspenso'], baixado: ['info', 'Baixado'], arquivado: ['info', 'Arquivado'], extinto: ['erro', 'Extinto'] };

export async function abaProcessos(ctx) {
  const lista = await api.get(`/api/processos?projeto=${ctx.id}`);
  const escreve = pode('processo.escrever') && ctx.h.situacao !== 'encerrado';
  return {
    html: html`<div class="flex up" style="margin-bottom:12px"><span class="dica">Prazos contados em dias úteis forenses (CPC, art. 219 e 224), com feriados nacionais. A conferência final de feriado local é sua.</span>
      <span class="grow"></span>${escreve ? html`<button type="button" class="btn btn--accent" data-novo>${icone('plus')}Novo processo</button>` : ''}</div>
      ${lista.length ? html`<section class="card glass up"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Processo</th><th>Tribunal</th><th>Situação</th><th>Movs.</th><th>Próximo prazo</th></tr></thead>
        <tbody>${lista.map((p) => {
          const [tom, rot] = SITUACAO_PROC[p.situacao] ?? ['info', p.situacao];
          const venc = p.diasUteisAteOProximo;
          return html`<tr class="${p.proximo_vencimento && venc < 0 ? 'vencido' : ''}" >
            <td><button type="button" class="link mono-sm" data-prazos-processo="${p.id}" aria-expanded="false" aria-controls="prazos-${p.id}">${p.numero}</button><small>${p.classe ?? ''}</small></td>
            <td>${p.tribunal ?? '—'}<small>${[p.comarca, p.uf].filter(Boolean).join(' / ')}</small></td>
            <td><span class="selo ${tom}"><i></i>${rot}</span></td><td class="num">${p.movimentacoes}</td>
            <td>${p.proximo_vencimento ? html`${dataBR(p.proximo_vencimento)}<small>${venc < 0 ? `vencido há ${-venc} dia(s) útil(eis)` : venc === 0 ? 'vence hoje' : `em ${venc} dia(s) útil(eis)`}</small>` : html`<span class="muted">sem prazo aberto</span>`}</td></tr><tr id="prazos-${p.id}" hidden><td colspan="5">
            <div data-prazos-conteudo aria-live="polite"></div><button type="button" class="btn btn--ghost mt" data-abrir="${p.id}">Abrir detalhes do processo</button>
          </td></tr>`;
        })}</tbody></table></div></section>`
        : html`<section class="card glass up">${vazio('file', 'Nenhum processo neste projeto', 'Cadastre o processo para acompanhar movimentações e calcular prazos com o fundamento à vista.', escreve ? '<button class="btn btn--accent" data-novo>Cadastrar processo</button>' : '')}</section>`}`,
    depois(el) {
      ouvir(el, 'click', '[data-novo]', () => novoProcesso(ctx.id).then((ok) => ok && ctx.recarregar()));
      ouvir(el, 'click', '[data-prazos-processo]', async b => {
        const id=b.dataset.prazosProcesso, linha=$(`#prazos-${id}`,el);
        const abrir=linha.hidden;
        linha.hidden=!abrir;
        b.setAttribute('aria-expanded',String(abrir));
        if(!abrir)return;
        const slot=$('[data-prazos-conteudo]',linha);
        slot.textContent='Carregando prazos…';
        try{
          const proc=await api.get(`/api/processos/${id}`);
          const abertos=proc.prazos.filter(p=>p.situacao==='aberto');
          slot.innerHTML=String(abertos.length?html`<ul class="lista">${abertos.map(p=>html`<li>
            <span class="selo ${p.diasUteisRestantes<0?'erro':'aviso'}">${icone('flag')}Prazo processual</span>
            <div><b>${p.titulo}</b><small>Vencimento ${dataBR(p.vencimento)}${p.calculo?.vencimentoAstrea?' · confirmado no Astrea':''}</small></div>
          </li>`)}</ul>`:html`<p class="dica">Nenhum prazo em aberto neste processo.</p>`);
        }catch(e){slot.textContent=e.message;}
      });
      ouvir(el, 'click', '[data-abrir]', (tr) => abrirProcesso(tr.dataset.abrir, ctx));
    },
  };
}

const CAMPOS_PROCESSO = [
  { nome: 'numero', rotulo: 'Número (CNJ)', obrigatorio: true, placeholder: '0001234-56.2024.8.16.0001', dica: 'O dígito verificador é conferido.' },
  { nome: 'classe', rotulo: 'Classe', metade: true, placeholder: 'Recuperação Judicial' },
  { nome: 'tribunal', rotulo: 'Tribunal', metade: true, placeholder: 'TJPR' },
  { nome: 'comarca', rotulo: 'Comarca', metade: true }, { nome: 'uf', rotulo: 'UF', metade: true, placeholder: 'PR' },
  { nome: 'orgaoJulgador', rotulo: 'Vara / órgão julgador' },
  { nome: 'valorCausa', rotulo: 'Valor da causa (R$)', metade: true }, { nome: 'distribuidoEm', rotulo: 'Distribuído em', tipo: 'date', metade: true },
];

function corpoProcesso(v, projetoId) {
  const c = { numero: v.numero, projetoId, classe: v.classe, tribunal: v.tribunal, comarca: v.comarca, uf: v.uf?.toUpperCase(), orgaoJulgador: v.orgaoJulgador, distribuidoEm: v.distribuidoEm };
  if (v.valorCausa) { const val = paraCentavos(v.valorCausa); if (!val) throw new Error('Valor da causa inválido. Use 1.250.000,00'); c.valorCausa = val; }
  return c;
}

export async function novoProcesso(projetoId) {
  return formulario({
    titulo: 'Novo processo', rotulo: 'Cadastrar', campos: CAMPOS_PROCESSO, largo: true,
    async enviar(v) { await api.post('/api/processos', corpoProcesso(v, projetoId)); toast('Processo cadastrado'); },
  });
}

export async function novoProcessoSolto() {
  if (!estado.projetos.length) estado.projetos = await api.get('/api/projetos');
  const abertos = estado.projetos.filter((p) => p.situacao !== 'encerrado');
  if (!abertos.length) return toast('Crie um projeto antes de cadastrar processos.', 'aviso');
  const r = await formulario({
    titulo: 'Novo processo', rotulo: 'Cadastrar', largo: true,
    campos: [{ nome: 'projetoId', rotulo: 'Projeto', tipo: 'select', obrigatorio: true, opcoes: abertos.map((p) => ({ v: p.id, t: p.nome })) }, ...CAMPOS_PROCESSO],
    async enviar(v) { await api.post('/api/processos', corpoProcesso(v, v.projetoId)); toast('Processo cadastrado'); return v.projetoId; },
  });
  if (r) navegar();
}

async function abrirProcesso(id, ctx) {
  let p;
  try { p = await api.get(`/api/processos/${id}`); } catch (e) { return erroDe(e); }
  const [tom, rot] = SITUACAO_PROC[p.situacao] ?? ['info', p.situacao];
  const escreve = pode('processo.escrever'); const prazoEscreve = pode('prazo.escrever'); const publica = pode('portal.publicar');
  const corpo = html`
    <div class="flex" style="margin-bottom:6px"><span class="selo ${tom}"><i></i>${rot}</span><span class="mono-sm">${p.numero}</span>
      ${p.valorFormatado && p.valor_causa ? html`<span class="mono-sm">R$ ${p.valorFormatado}</span>` : ''}${p.segredo_justica ? html`<span class="selo erro">segredo de justiça</span>` : ''}</div>
    <p class="dica">${[p.classe, p.orgao_julgador, p.comarca && `${p.comarca}/${p.uf ?? ''}`, p.tribunal].filter(Boolean).join(' · ')}</p>
    ${p.suspenso_motivo ? html`<p class="dica" style="color:var(--lab-amber-2)">Suspenso: ${p.suspenso_motivo}${p.suspenso_ate ? ` (até ${dataBR(p.suspenso_ate)})` : ''}</p>` : ''}
    <div class="flex" style="margin:12px 0 4px">${escreve ? html`<button type="button" class="btn btn--ghost" data-mov>${icone('plus')}Movimentação</button>
      <button type="button" class="btn btn--ghost" data-parte>${icone('plus')}Parte</button><button type="button" class="btn btn--ghost" data-sit>Alterar situação</button>` : ''}
      ${prazoEscreve ? html`<button type="button" class="btn btn--accent" data-prazo>${icone('calendar')}Calcular prazo</button>` : ''}</div>

    <h3 class="mini-h">Prazos</h3>
    ${p.prazos.length ? html`<ul class="lista">${p.prazos.map((z) => html`<li style="align-items:flex-start">
      <div><b>${z.titulo}</b><small>${dataBR(z.vencimento)} · ${z.dias} dia(s) ${z.regime === 'uteis' ? 'úteis' : 'corridos'}${z.em_dobro ? ' · em dobro' : ''}${z.calculo?.fundamentoLegal ? ` · ${z.calculo.fundamentoLegal}` : ''}</small>
        <details class="calc"><summary>Ver o cálculo</summary>
          <p class="dica">Evento ${dataBR(z.evento)} → primeiro dia contado ${dataBR(z.calculo?.primeiroDiaContado)} → vence ${dataBR(z.vencimento)}.</p>
          <ul class="dica" style="padding-left:18px;margin:4px 0">${(z.calculo?.fundamentos ?? []).map((f) => html`<li>${f}</li>`)}</ul>
          ${(z.calculo?.naoCorreram ?? []).length ? html`<p class="dica" style="margin:6px 0 2px">Dias que não correram:</p><ul class="dica" style="padding-left:18px;margin:0">${z.calculo.naoCorreram.slice(0, 14).map((n) => html`<li>${dataBR(n.data)} — ${n.nome}</li>`)}</ul>` : ''}
          ${(z.calculo?.ressalvas ?? []).map((r) => html`<p class="dica" style="color:var(--lab-amber-2);margin:6px 0 0">⚠ ${r}</p>`)}</details></div>
      <div class="fim">${z.situacao === 'aberto' ? html`<span class="selo ${z.diasUteisRestantes < 0 ? 'erro' : z.diasUteisRestantes <= 3 ? 'aviso' : 'info'}">${z.diasUteisRestantes < 0 ? `há ${-z.diasUteisRestantes} d` : z.diasUteisRestantes === 0 ? 'hoje' : `${z.diasUteisRestantes} d úteis`}</span>
        ${prazoEscreve ? html`<br><button type="button" class="btn btn--ghost" style="margin-top:6px" data-fechar-prazo="${z.id}">Fechar</button>` : ''}`
        : html`<span class="selo ok">${z.situacao}</span>`}</div></li>`)}</ul>` : html`<p class="dica">Nenhum prazo calculado.</p>`}

    <h3 class="mini-h">Movimentações</h3>
    ${p.movimentacoes.length ? html`<ul class="tl">${p.movimentacoes.map((m) => html`<li><time>${dataBR(m.data)} · ${m.fonte}</time><p><b>${m.titulo}</b></p>
      ${m.conteudo ? html`<p class="dica">${m.conteudo.slice(0, 400)}${m.conteudo.length > 400 ? '…' : ''}</p>` : ''}
      <div class="flex">${m.visivel_ao_cliente ? html`<span class="selo ok">visível ao cliente</span>${publica ? html`<button type="button" class="link" data-despublicar="${m.id}">retirar do portal</button>` : ''}`
        : html`<span class="selo">interna</span>${publica ? html`<button type="button" class="link" data-publicar="${m.id}">publicar ao cliente</button>` : ''}`}</div>
      ${m.resumo_ao_cliente ? html`<p class="dica">Texto ao cliente: “${m.resumo_ao_cliente}”</p>` : ''}</li>`)}</ul>` : html`<p class="dica">Sem movimentações.</p>`}

    <h3 class="mini-h">Partes</h3>
    ${p.partes.length ? html`<ul class="lista">${p.partes.map((x) => html`<li><div><b>${x.nome}</b><small>${[x.papel, x.polo, x.documento].filter(Boolean).join(' · ')}</small></div>${x.eh_cliente ? html`<div class="fim"><span class="selo ok">cliente</span></div>` : ''}</li>`)}</ul>` : html`<p class="dica">Nenhuma parte cadastrada.</p>`}`;

  await modal({
    titulo: 'Processo', subtitulo: p.projeto, corpo: String(corpo), acoes: botaoFechar, largo: true,
    aoAbrir(el) {
      const recomeçar = async () => { el.fechar(true); await abrirProcesso(id, ctx); };
      el.addEventListener('acao', () => el.fechar(true));
      ouvir(el, 'click', '[data-mov]', async () => { if (await novaMovimentacao(id)) recomeçar(); });
      ouvir(el, 'click', '[data-parte]', async () => { if (await novaParte(id)) recomeçar(); });
      ouvir(el, 'click', '[data-sit]', async () => { if (await alterarSituacao(id, p.situacao)) recomeçar(); });
      ouvir(el, 'click', '[data-prazo]', async () => { if (await novoPrazo(id)) recomeçar(); });
      ouvir(el, 'click', '[data-fechar-prazo]', async (b) => { if (await fecharPrazo(b.dataset.fecharPrazo)) recomeçar(); });
      ouvir(el, 'click', '[data-publicar]', async (b) => { if (await publicarMov(b.dataset.publicar)) recomeçar(); });
      ouvir(el, 'click', '[data-despublicar]', async (b) => {
        if (!(await confirmar('Retirar do portal?', 'O cliente deixa de ver esta movimentação.', { rotulo: 'Retirar' }))) return;
        try { await api.del(`/api/movimentacoes/${b.dataset.despublicar}/publicacao`); toast('Retirada do portal'); recomeçar(); } catch (e) { erroDe(e); }
      });
    },
  });
  ctx?.recarregar?.();
}

const novaMovimentacao = (id) => formulario({
  titulo: 'Nova movimentação', rotulo: 'Registrar',
  campos: [{ nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, valor: hojeISO() }, { nome: 'titulo', rotulo: 'Título', obrigatorio: true, placeholder: 'Despacho de mero expediente' },
    { nome: 'conteudo', rotulo: 'Conteúdo / teor', tipo: 'textarea' }],
  async enviar(v) { await api.post(`/api/processos/${id}/movimentacoes`, { data: v.data, titulo: v.titulo, conteudo: v.conteudo }); toast('Movimentação registrada'); },
});
const novaParte = (id) => formulario({
  titulo: 'Nova parte', rotulo: 'Adicionar',
  campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true }, { nome: 'polo', rotulo: 'Polo', tipo: 'select', metade: true, valor: 'passivo', opcoes: [{ v: 'ativo', t: 'Ativo' }, { v: 'passivo', t: 'Passivo' }, { v: 'terceiro', t: 'Terceiro' }] },
    { nome: 'papel', rotulo: 'Papel', metade: true, placeholder: 'recuperanda, credor…' }, { nome: 'tipoDocumento', rotulo: 'Documento', tipo: 'select', metade: true, opcoes: [{ v: '', t: '—' }, { v: 'cnpj', t: 'CNPJ' }, { v: 'cpf', t: 'CPF' }] },
    { nome: 'documento', rotulo: 'Número', metade: true }, { nome: 'ehCliente', rotulo: 'É nosso cliente?', tipo: 'select', valor: 'nao', opcoes: [{ v: 'nao', t: 'Não' }, { v: 'sim', t: 'Sim' }] }],
  async enviar(v) { await api.post(`/api/processos/${id}/partes`, { nome: v.nome, polo: v.polo, papel: v.papel, tipoDocumento: v.tipoDocumento || undefined, documento: v.documento, ehCliente: v.ehCliente === 'sim' }); toast('Parte adicionada'); },
});
const alterarSituacao = (id, atual) => formulario({
  titulo: 'Situação do processo', rotulo: 'Salvar',
  campos: [{ nome: 'situacao', rotulo: 'Situação', tipo: 'select', valor: atual, opcoes: Object.entries(SITUACAO_PROC).map(([v, [, t]]) => ({ v, t })) },
    { nome: 'motivo', rotulo: 'Motivo', dica: 'Ex.: stay period, art. 6º, § 4º, LREF' }, { nome: 'suspensoAte', rotulo: 'Suspenso até', tipo: 'date' }],
  async enviar(v) { await api.post(`/api/processos/${id}/situacao`, { situacao: v.situacao, motivo: v.motivo, suspensoAte: v.suspensoAte }); toast('Situação atualizada'); },
});
const publicarMov = (movId) => formulario({
  titulo: 'Publicar ao cliente', subtitulo: 'Escreva com as suas palavras o que o cliente precisa entender. O teor original continua interno.', rotulo: 'Publicar',
  campos: [{ nome: 'resumo', rotulo: 'Texto para o cliente', tipo: 'textarea', obrigatorio: true, dica: 'Mínimo de 10 caracteres. Evite jargão.' }],
  async enviar(v) { await api.post(`/api/movimentacoes/${movId}/publicacao`, { resumo: v.resumo }); toast('Publicada no portal'); },
});
const fecharPrazo = (prazoId) => formulario({
  titulo: 'Fechar prazo', rotulo: 'Fechar',
  campos: [{ nome: 'situacao', rotulo: 'Resultado', tipo: 'select', valor: 'cumprido', opcoes: [{ v: 'cumprido', t: 'Cumprido' }, { v: 'perdido', t: 'Perdido' }, { v: 'cancelado', t: 'Cancelado' }] }, { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea' }],
  async enviar(v) { await api.post(`/api/prazos/${prazoId}/fechamento`, v); toast('Prazo fechado'); },
});

export async function novoPrazo(id, padroes = {}) {
  const catalogo = await api.get('/api/prazos/catalogo');
  return formulario({
    titulo: 'Calcular prazo', subtitulo: 'O sistema conta os dias úteis, mostra o fundamento e o que não correu. Confira feriados locais antes de confiar na data.', rotulo: 'Calcular e salvar', largo: true,
    campos: [
      { nome: 'tipo', rotulo: 'Tipo de prazo', tipo: 'select', obrigatorio: true, opcoes: [...catalogo.map((c) => ({ v: c.id, t: `${c.nome} — ${c.dias} d ${c.regime === 'uteis' ? 'úteis' : 'corridos'}` })), { v: 'manual', t: 'Outro (informar dias)' }] },
      { nome: 'evento', rotulo: 'Data do evento (publicação, intimação…)', tipo: 'date', obrigatorio: true, metade: true, valor: padroes.evento ?? hojeISO() },
      { nome: 'origem', rotulo: 'Origem', tipo: 'select', metade: true, valor: padroes.origem ?? 'publicacao', opcoes: [{ v: 'disponibilizacao_dje', t: 'Disponibilização no DJe' }, { v: 'publicacao', t: 'Publicação' }, { v: 'intimacao_pessoal', t: 'Intimação pessoal' }, { v: 'juntada_ar', t: 'Juntada do AR' }, { v: 'citacao', t: 'Citação' }, { v: 'audiencia', t: 'Audiência' }, { v: 'manual', t: 'Contagem direta' }] },
      { nome: 'titulo', rotulo: 'Título (só para “Outro”)', metade: true }, { nome: 'dias', rotulo: 'Dias (só para “Outro”)', tipo: 'number', metade: true, min: 1 },
      { nome: 'emDobro', rotulo: 'Prazo em dobro?', tipo: 'select', valor: 'nao', opcoes: [{ v: 'nao', t: 'Não' }, { v: 'sim', t: 'Sim (art. 229 CPC, litisconsortes etc.)' }] },
    ],
    async enviar(v) {
      const corpo = { evento: v.evento, origem: v.origem, emDobro: v.emDobro === 'sim' };
      if (v.tipo === 'manual') { if (!v.titulo || !v.dias) throw new Error('Para “Outro”, informe título e número de dias.'); Object.assign(corpo, { titulo: v.titulo, dias: v.dias, regime: 'uteis' }); } else corpo.tipo = v.tipo;
      if (corpo.emDobro) corpo.motivoDoDobro = 'informado na tela';
      const r = await api.post(`/api/processos/${id}/prazos`, corpo);
      toast(`Prazo calculado${r?.vencimento ? `: vence em ${dataBR(r.vencimento)}` : ''}`);
    },
  });
}

// ============================================================== DOCUMENTOS ===

const CATEGORIAS = ['Contrato', 'Societário', 'Contábil', 'Fiscal', 'Trabalhista', 'Processual', 'Patrimonial', 'Credores', 'Outro'];

export async function abaDocumentos(ctx) {
  const docs = await api.get(`/api/projetos/${ctx.id}/documentos`);
  const escreve = pode('documento.escrever') && ctx.h.situacao !== 'encerrado'; const publica = pode('portal.publicar');
  return {
    html: html`
      ${escreve ? html`<label class="drop up" id="soltar" tabindex="0"><input type="file" id="arq" hidden multiple>${icone('upload')}
        <b>Solte arquivos aqui ou clique para enviar</b><small>Ficam no acervo interno. Nada vai ao cliente sem você publicar.</small></label>` : ''}
      <section class="card glass up mt">${docs.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Documento</th><th>Categoria</th><th>Tamanho</th><th>Visibilidade</th><th></th></tr></thead>
        <tbody>${docs.map((d) => html`<tr><td><b>${d.titulo}</b><small>${d.nome_original ?? 'referência sem arquivo'} · v${d.versao} · ${relativo(d.criado_em)}</small></td>
          <td>${d.categoria ?? '—'}<small>${d.origem === 'portal_cliente' ? 'Enviado pelo cliente' : 'Acervo do escritório'}</small></td><td class="mono-sm">${tamanho(d.tamanho_bytes)}</td>
          <td>${d.visibilidade === 'publicado' ? html`<span class="selo ok"><i></i>No portal</span>` : html`<span class="selo"><i></i>Interno</span>`}</td>
          <td class="num"><div class="flex" style="justify-content:flex-end">
            ${d.tem_arquivo ? html`<button type="button" class="ibtn ibtn--sm" data-baixar="${d.id}" title="Baixar (link de 5 min)" aria-label="Baixar">${icone('download')}</button>` : ''}
            ${d.tem_arquivo ? html`<button type="button" class="ibtn ibtn--sm" data-analisar="${d.id}" data-t="${d.titulo}" title="Análise documental" aria-label="Analisar">${icone('sparkle')}</button>` : ''}
            ${publica ? (d.visibilidade === 'publicado' ? html`<button type="button" class="btn btn--ghost" data-despub="${d.id}">Retirar</button>` : html`<button type="button" class="btn btn--ghost" data-pub="${d.id}" data-t="${d.titulo}">Publicar</button>`) : ''}
          </div></td></tr>`)}</tbody></table></div>` : vazio('doc', 'Nenhum documento ainda', 'Envie os arquivos do caso. Cada um é guardado por conteúdo e baixado por link temporário.')}</section>`,
    depois(el) {
      const enviar = async (arquivos) => {
        for (const f of arquivos) {
          const ok = await formulario({
            titulo: 'Enviar documento', subtitulo: `${f.name} · ${tamanho(f.size)}`, rotulo: 'Enviar',
            campos: [{ nome: 'titulo', rotulo: 'Título', obrigatorio: true, valor: f.name.replace(/\.[^.]+$/, '') }, { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', opcoes: CATEGORIAS.map((c) => ({ v: c, t: c })) }],
            async enviar(v) { const fd = new FormData(); fd.append('arquivo', f); fd.append('titulo', v.titulo); if (v.categoria) fd.append('categoria', v.categoria); await api.enviar(`/api/projetos/${ctx.id}/documentos`, fd); toast('Documento enviado'); },
          });
          if (!ok) break;
        }
        ctx.recarregar();
      };
      const drop = $('#soltar', el);
      if (drop) {
        $('#arq', el).addEventListener('change', (e) => enviar([...e.target.files]));
        ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', (e) => enviar([...e.dataTransfer.files]));
        drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#arq', el).click(); } });
      }
      ouvir(el, 'click', '[data-baixar]', (b) => baixar(b.dataset.baixar));
      ouvir(el, 'click', '[data-analisar]', (b) => abrirAnalises(b.dataset.analisar, b.dataset.t, ctx));
      ouvir(el, 'click', '[data-pub]', async (b) => {
        if (!(await confirmar('Publicar no portal?', `“${b.dataset.t}” passará a ser visível para o cliente deste projeto. Confira antes: não dá para desfazer o que ele já tiver baixado.`, { rotulo: 'Publicar' }))) return;
        try { await api.post(`/api/documentos/${b.dataset.pub}/publicacao`); toast('Publicado no portal'); ctx.recarregar(); } catch (e) { erroDe(e); }
      });
      ouvir(el, 'click', '[data-despub]', async (b) => { try { await api.del(`/api/documentos/${b.dataset.despub}/publicacao`); toast('Retirado do portal'); ctx.recarregar(); } catch (e) { erroDe(e); } });
    },
  };
}

export async function abrirAnalises(docId, titulo, ctx) {
  let ia, analises;
  try { [ia, analises] = await Promise.all([api.get('/api/ia/estado').catch(() => null), api.get(`/api/documentos/${docId}/analises`)]); } catch (e) { return erroDe(e); }
  const executa = pode('analise.executar');
  const corpo = html`
    <div class="card glass-lite" style="padding:14px;margin-bottom:14px"><b>${ia?.disponivel ? 'Leitura por IA disponível' : 'Leitura por IA indisponível'}</b>
      <p class="dica" style="margin:4px 0 0">${ia?.disponivel ? 'O texto do documento é tratado como dado, nunca como instrução. Toda citação é conferida contra o corpus do escritório.' : ia?.impedimento ?? 'Sem informação.'}</p>
      ${!ia?.disponivel && ia?.deterministicoSempreDisponivel ? html`<p class="dica" style="margin:6px 0 0">Roda sem IA: ${ia.deterministicoSempreDisponivel.join('; ')}.</p>` : ''}</div>
    ${executa ? html`<button type="button" class="btn btn--accent" data-rodar>${icone('sparkle')}Rodar análise${ia?.disponivel ? '' : ' (somente determinística)'}</button>` : ''}
    <h3 class="mini-h">Análises deste documento</h3>
    ${analises.length ? html`<ul class="lista">${analises.map((a) => html`<li style="cursor:pointer" data-analise="${a.id}"><div><b>${a.rotuloDoTipo}</b><small>${dataHoraBR(a.criado_em)} · certeza ${a.certeza ?? '—'}% · ${a.achados} achado(s)${Number(a.criticos_abertos) ? ` · ${a.criticos_abertos} crítico(s)` : ''}</small></div>
      <div class="fim">${a.definitivo ? html`<span class="selo ok">tipo validado</span>` : html`<span class="selo aviso">tipo sugerido</span>`}</div></li>`)}</ul>` : html`<p class="dica">Nenhuma análise ainda.</p>`}`;
  await modal({
    titulo: 'Análise documental', subtitulo: titulo, corpo: String(corpo), acoes: botaoFechar, largo: true,
    aoAbrir(el) {
      el.addEventListener('acao', () => el.fechar(true));
      ouvir(el, 'click', '[data-rodar]', async (b) => {
        b.disabled = true; b.textContent = 'Analisando…';
        try {
          await api.post(`/api/documentos/${docId}/texto/extrair`, {}).catch(() => {});
          await api.post(`/api/documentos/${docId}/analises`, { comIa: !!ia?.disponivel });
          toast('Análise concluída'); el.fechar(true); abrirAnalises(docId, titulo, ctx);
        } catch (e) { b.disabled = false; b.textContent = 'Rodar análise'; el.erro(e.message); }
      });
      ouvir(el, 'click', '[data-analise]', (li) => { el.fechar(true); abrirAnalise(li.dataset.analise, docId, titulo, ctx); });
    },
  });
  ctx.recarregar();
}

const GRAV = { critico: ['erro', 'Crítico'], atencao: ['aviso', 'Atenção'], informacao: ['info', 'Informação'] };

async function abrirAnalise(id, docId, titulo, ctx) {
  let a;
  try { a = await api.get(`/api/analises/${id}`); } catch (e) { return erroDe(e); }
  const triar = pode('documento.escrever'); const validar = pode('analise.validar');
  const corpo = html`
    <div class="flex"><span class="selo ${a.tipo_validado ? 'ok' : 'aviso'}">${a.tipo_validado ? 'Tipo validado' : 'Tipo apenas sugerido'}</span><b>${a.rotuloDoTipo ?? a.tipo_sugerido}</b>
      ${validar && !a.tipo_validado ? html`<button type="button" class="btn btn--ghost" data-validar-tipo>Validar tipo</button>` : ''}</div>
    <p class="dica">A classificação é da máquina; o tipo definitivo é de quem assina (§7.7). Citações marcadas como não localizadas não devem ser usadas.</p>
    <h3 class="mini-h">Achados (${a.achados?.length ?? 0})</h3>
    ${(a.achados ?? []).length ? html`<ul class="lista">${a.achados.map((x) => { const [tom, rot] = GRAV[x.gravidade] ?? ['info', x.gravidade]; return html`<li style="align-items:flex-start">
      <div><b>${x.titulo}</b><small>${x.categoria} · ${x.natureza}${x.situacao && x.situacao !== 'aberto' ? ` · ${x.situacao}` : ''}</small>
        ${x.descricao ? html`<p class="dica" style="margin:4px 0 0">${x.descricao}</p>` : ''}${x.trecho_citado ? html`<blockquote class="dica" style="margin:6px 0 0;padding-left:10px;border-left:2px solid var(--sep)">${x.trecho_citado}</blockquote>` : ''}</div>
      <div class="fim"><span class="selo ${tom}">${rot}</span>${triar && x.situacao === 'aberto' ? html`<br><div class="flex" style="margin-top:6px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-triar="${x.id}" data-s="confirmado">Confirmar</button><button type="button" class="btn btn--ghost" data-triar="${x.id}" data-s="descartado">Descartar</button></div>` : ''}</div></li>`; })}</ul>` : html`<p class="dica">Nenhum achado.</p>`}
    ${(a.citacoes ?? []).length ? html`<h3 class="mini-h">Citações conferidas</h3><ul class="lista">${a.citacoes.map((c) => html`<li><div><b>${c.texto ?? c.referencia ?? ''}</b><small>${c.rotuloDaNatureza ?? c.natureza}</small></div><div class="fim"><span class="selo ${c.status === 'localizada' ? 'ok' : 'aviso'}">${c.rotuloDoStatus ?? c.status}</span></div></li>`)}</ul>` : ''}`;
  await modal({
    titulo: 'Resultado da análise', subtitulo: titulo, corpo: String(corpo), acoes: [{ id: 'volta', rotulo: 'Voltar' }, { id: 'ok', rotulo: 'Fechar', tipo: 'primario' }], largo: true,
    aoAbrir(el) {
      el.addEventListener('acao', (e) => { el.fechar(true); if (e.detail.id === 'volta') abrirAnalises(docId, titulo, ctx); });
      ouvir(el, 'click', '[data-triar]', async (b) => { try { await api.post(`/api/achados/${b.dataset.triar}/triagem`, { situacao: b.dataset.s }); toast('Achado triado'); el.fechar(true); abrirAnalise(id, docId, titulo, ctx); } catch (e) { el.erro(e.message); } });
      ouvir(el, 'click', '[data-validar-tipo]', async () => {
        const alt = [{ tipo: a.tipo_sugerido, rotulo: a.rotuloDoTipo ?? a.tipo_sugerido }, ...(a.alternativas ?? []).filter((x) => x.tipo !== a.tipo_sugerido)];
        el.fechar(true);
        await formulario({ titulo: 'Validar tipo do documento', rotulo: 'Validar', campos: [{ nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: alt.map((x) => ({ v: x.tipo, t: x.rotulo ?? x.tipo })) }, { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea' }],
          async enviar(v) { await api.post(`/api/analises/${id}/validacao`, v); toast('Tipo validado'); } });
        abrirAnalise(id, docId, titulo, ctx);
      });
    },
  });
}

/** Quem deve entregar (coluna "Atribuição" da planilha da NGA), em etiquetas. */
const atribuicao = (a) => (a ? html`<span class="atrib">${String(a).split('/').map((x) => html`<i>${x.trim()}</i>`)}</span>` : '');

// ================================================================== PORTAL ===

const SIT = { pendente: ['', 'Pendente'], enviado: ['info', 'Enviado'], em_analise: ['info', 'Em análise'], aprovado: ['ok', 'Aprovado'], rejeitado: ['erro', 'Rejeitado'], complementacao: ['aviso', 'Complementar'], nao_aplicavel: ['', 'Não se aplica'] };

export async function abaPortal(ctx) {
  const [portal, check, msgs] = await Promise.all([api.get(`/api/projetos/${ctx.id}/portal`), api.get(`/api/projetos/${ctx.id}/checklist`), api.get(`/api/projetos/${ctx.id}/mensagens`)]);
  const publica = pode('portal.publicar'); const escreve = pode('projeto.escrever'); const analisa = pode('documento.escrever') && escreve;
  const porCat = new Map(); for (const i of check.itens) { if (!porCat.has(i.categoria)) porCat.set(i.categoria, []); porCat.get(i.categoria).push(i); }
  const pr = check.progresso; const cron = [...msgs].reverse();
  const toggle = (k, rot) => html`<label class="toggle"><input type="checkbox" data-mostra="${k}" ${portal.mostra?.[k] ? raw('checked') : ''} ${publica ? '' : raw('disabled')}><span></span>${rot}</label>`;

  return {
    html: html`<div class="grid-hub">
      <div style="display:grid;gap:var(--gap)">
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Checklist de documentos</h2>
          <p class="card__sub">${pr.total ? `${pr.aprovados} de ${pr.obrigatorios} obrigatórios aprovados · ${pr.aguardandoOCliente} aguardando o cliente · ${pr.aguardandoANGA} aguardando você` : 'O que o cliente precisa enviar, com o fundamento de cada item.'}</p></div>
          ${!pr.total && escreve ? html`<button type="button" class="btn btn--accent" data-modelo>Gerar do modelo</button>` : ''}</header>
          ${pr.total ? html`<details class="mt"><summary class="check-resumo"><span class="pct">${pr.percentualEnviado}%</span><span class="barra-m" aria-hidden="true"><i style="width:${pr.percentualEnviado}%"></i></span><small>entregue · ${pr.percentualAprovado}% aprovado</small></summary>` : ''}
          ${pr.total ? [...porCat].map(([cat, itens]) => html`<h3 class="mini-h">${cat}</h3>${itens.map((i) => html`<div class="check-row${i.situacao === 'nao_aplicavel' ? ' na' : ''}"><span class="sit-dot ${i.situacao}"></span>
            <div><b>${i.titulo}${i.obrigatorio ? '' : html` <span class="muted">(opcional)</span>`}</b><small>${i.fundamento ?? ''}</small>${atribuicao(i.atribuicao)}${i.observacao ? html`<small class="obs">${i.observacao}</small>` : ''}</div>
            <span class="selo ${SIT[i.situacao]?.[0] ?? ''}">${i.rotuloDaSituacao ?? SIT[i.situacao]?.[1]}</span>
            ${i.documento_id ? html`<button type="button" class="ibtn ibtn--sm" data-baixar="${i.documento_id}" aria-label="Baixar" title="Baixar">${icone('download')}</button>` : ''}
            ${analisa && (i.situacao === 'enviado' || i.situacao === 'em_analise') ? html`<button type="button" class="btn btn--accent" data-analisar-req="${i.id}" data-t="${i.titulo}">Analisar</button>` : ''}
            ${analisa && ['pendente', 'rejeitado', 'complementacao'].includes(i.situacao) ? html`<button type="button" class="btn btn--ghost" data-na="${i.id}" title="Marcar como não se aplica a este caso">N/A</button>` : ''}
            ${analisa && i.situacao === 'nao_aplicavel' ? html`<button type="button" class="btn btn--ghost" data-reativar="${i.id}">Reativar</button>` : ''}</div>`)}`) : vazio('check', 'Checklist ainda não gerado', 'Gerar do modelo cria a lista de documentos do procedimento deste projeto, cada item com o seu fundamento legal.')}
          ${pr.total ? raw('</details>') : ''}
        </section>
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Conversa com o cliente</h2><p class="card__sub">O cliente vê estas mensagens no portal.</p></div></header>
          <div class="chat" id="chat">${cron.length ? cron.map((m) => html`<div class="msg ${m.lado === 'nga' ? 'meu' : ''}">${m.texto}<small>${m.autor ?? (m.lado === 'nga' ? 'NGA' : 'Cliente')} · ${relativo(m.criado_em)}</small></div>`) : html`<p class="dica">Sem mensagens ainda.</p>`}</div>
          <form class="chat-in" id="enviar-msg"><input class="input" name="texto" placeholder="Escreva para o cliente…" autocomplete="off" aria-label="Mensagem" required><button class="btn btn--accent" type="submit">${icone('send')}Enviar</button></form>
        </section>
      </div>
      <div style="display:grid;gap:var(--gap)">
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Acesso do cliente</h2><p class="card__sub">${portal.existe ? portal.organizacao : 'Ainda não há portal para este projeto.'}</p></div>
          ${portal.existe ? html`<span class="selo ${portal.ativo ? 'ok' : 'erro'}"><i></i>${portal.ativo ? 'Ativo' : 'Suspenso'}</span>` : ''}</header>
          ${portal.existe ? html`<div style="display:grid;gap:8px;margin-bottom:14px"><p class="dica" style="margin:0">O que o cliente enxerga:</p>
            ${toggle('documentos', 'Documentos publicados')}${toggle('obrigacoes', 'Plano de pagamento')}${toggle('financeiro', 'Fluxo de caixa')}${toggle('processos', 'Andamento processual (só o publicado)')}
            ${publica ? html`<label class="toggle"><input type="checkbox" data-ativo ${portal.ativo ? raw('checked') : ''}><span></span>Portal ativo</label>` : ''}</div>
            <p class="mini-h" style="margin-top:0">Pessoas de ${portal.organizacao} · todas veem o mesmo conteúdo</p><ul class="lista">${portal.usuarios.map((u) => html`<li>${avatar(u.nome, 'md')}<div><b>${u.nome}</b><small>${u.email} · ${u.ultimoAcesso ? `último acesso ${relativo(u.ultimoAcesso)}` : 'nunca entrou'}</small></div></li>`)}</ul>` : ''}
          ${publica ? html`<button type="button" class="btn ${portal.existe ? 'btn--ghost' : 'btn--accent'} mt" data-convite>${icone('plus')}${portal.existe ? 'Adicionar pessoa da mesma empresa' : 'Criar portal e convidar o cliente'}</button>` : ''}
        </section>
      </div></div>`,

    depois(el) {
      ouvir(el, 'click', '[data-baixar]', (b) => baixar(b.dataset.baixar));
      ouvir(el, 'click', '[data-modelo]', async (b) => { b.disabled = true; try { await api.post(`/api/projetos/${ctx.id}/checklist`, {}); toast('Checklist gerado'); ctx.recarregar(); } catch (e) { b.disabled = false; erroDe(e); } });
      ouvir(el, 'click', '[data-analisar-req]', async (b) => {
        const ok = await formulario({
          titulo: 'Analisar documento do cliente', subtitulo: b.dataset.t, rotulo: 'Registrar decisão',
          campos: [{ nome: 'situacao', rotulo: 'Decisão', tipo: 'select', obrigatorio: true, valor: 'aprovado', opcoes: [{ v: 'aprovado', t: 'Aprovar' }, { v: 'complementacao', t: 'Entregue parcialmente (pedir complementação)' }, { v: 'rejeitado', t: 'Rejeitar' }, { v: 'em_analise', t: 'Marcar como em análise' }, { v: 'nao_aplicavel', t: 'Não se aplica a este caso' }] },
            { nome: 'observacao', rotulo: 'Observação para o cliente', tipo: 'textarea', dica: 'Se rejeitar ou pedir complementação, diga o que falta.' }],
          async enviar(v) { await api.post(`/api/requisitos/${b.dataset.analisarReq}/analise`, v); toast('Decisão registrada'); },
        });
        if (ok) ctx.recarregar();
      });
      ouvir(el, 'click', '[data-na], [data-reativar]', async (b) => {
        const na = !!b.dataset.na; const id = b.dataset.na ?? b.dataset.reativar;
        try { await api.post(`/api/requisitos/${id}/analise`, na ? { situacao: 'nao_aplicavel', observacao: 'Não se aplica a este caso.' } : { situacao: 'pendente' }); toast(na ? 'Marcado como não se aplica' : 'Item reativado'); ctx.recarregar(); } catch (e) { erroDe(e); }
      });
      ouvir(el, 'change', '[data-mostra]', async (c) => {
        const campo = { documentos: 'mostraDocumentos', obrigacoes: 'mostraObrigacoes', financeiro: 'mostraFinanceiro', processos: 'mostraProcessos' }[c.dataset.mostra];
        try { await api.patch(`/api/projetos/${ctx.id}/portal`, { [campo]: c.checked }); toast('Visibilidade atualizada'); } catch (e) { c.checked = !c.checked; erroDe(e); }
      });
      ouvir(el, 'change', '[data-ativo]', async (c) => {
        try { await api.patch(`/api/projetos/${ctx.id}/portal`, { ativo: c.checked }); toast(c.checked ? 'Portal ativado' : 'Portal suspenso'); ctx.recarregar(); } catch (e) { c.checked = !c.checked; erroDe(e); }
      });
      ouvir(el, 'click', '[data-convite]', () => convidar(ctx, portal));
      const chat = $('#chat', el); if (chat) chat.scrollTop = chat.scrollHeight;
      $('#enviar-msg', el)?.addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target; const texto = f.texto.value.trim(); if (!texto) return;
        f.querySelector('button').disabled = true;
        try { await api.post(`/api/projetos/${ctx.id}/mensagens`, { texto }); ctx.recarregar(); } catch (er) { erroDe(er); f.querySelector('button').disabled = false; }
      });
    },
  };
}

async function convidar(ctx, portal) {
  let resultado = null;
  await formulario({
    titulo: portal.existe ? `Adicionar pessoa a ${portal.organizacao}` : 'Criar o portal do cliente', rotulo: 'Criar acesso',
    subtitulo: portal.existe
      ? `Atenção: esta pessoa entra na MESMA empresa (${portal.organizacao}) e vai ver tudo o que as outras já veem neste projeto — documentos publicados, mensagens, plano e caixa. Para atender OUTRO cliente, crie o projeto dele e o portal dele.`
      : 'Cria a empresa-cliente deste projeto. A pessoa recebe e-mail e senha temporária e só enxerga ESTE projeto, e só o que você publicar. Cada cliente tem o seu portal: nada passa de um para outro.',
    campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true }, { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true },
      ...(portal.existe ? [] : [{ nome: 'organizacao', rotulo: 'Nome da empresa cliente', obrigatorio: true, valor: ctx.h.empresas[0]?.razao_social ?? '' }])],
    async enviar(v) { resultado = await api.post(`/api/projetos/${ctx.id}/portal/convites`, { nome: v.nome, email: v.email, organizacao: v.organizacao }); },
  });
  if (!resultado) return;
  await modal({
    titulo: 'Acesso criado', subtitulo: resultado.nome,
    corpo: `<p class="dica">${resultado.aviso}</p><div class="senha-box"><small>E-mail</small><b>${resultado.email.replace(/</g, '&lt;')}</b><small>Senha temporária</small><b class="mono-sm" id="sn" style="font-size:20px;letter-spacing:.06em;color:var(--lab-amber-2)">${resultado.senhaTemporaria.replace(/</g, '&lt;')}</b></div>`,
    acoes: [{ id: 'copiar', rotulo: 'Copiar e-mail e senha' }, { id: 'ok', rotulo: 'Já anotei', tipo: 'primario' }],
    aoAbrir(el) { el.addEventListener('acao', (e) => { if (e.detail.id === 'copiar') navigator.clipboard?.writeText(`${resultado.email}\n${resultado.senhaTemporaria}`).then(() => toast('Copiado')); else el.fechar(true); }); },
  });
  ctx.recarregar();
}

// ============================================================ PLANO E CAIXA ===

export async function abaPlano(ctx) {
  const [ob, fin] = await Promise.allSettled([api.get(`/api/projetos/${ctx.id}/obrigacoes`), pode('financeiro_cliente.ler') ? api.get(`/api/projetos/${ctx.id}/financeiro`) : Promise.reject(new Error('sem permissão'))]);
  const o = ob.status === 'fulfilled' ? ob.value : null; const f = fin.status === 'fulfilled' ? fin.value : null;
  const maxSaldo = f ? Math.max(1, ...f.fluxo.periodos.map((p) => Math.abs(Number(p.saldoProjetado)))) : 1;
  const lanca = pode('financeiro_cliente.escrever');
  return {
    html: html`
      <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Plano de pagamento</h2>
        <p class="card__sub">${o?.resumo.total ? `${o.resumo.pagas} de ${o.resumo.total} parcelas pagas${o.resumo.vencidas ? ` · ${o.resumo.vencidas} vencida(s)` : ''}` : 'Obrigações geradas a partir do plano aprovado.'}</p></div>
        ${o?.resumo.total ? html`<span class="selo ${o.resumo.vencidas ? 'erro' : 'ok'}">R$ ${o.resumo.valorTotal}</span>` : ''}</header>
        ${o?.obrigacoes.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Credor</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Saldo</th><th></th></tr></thead>
          <tbody>${o.obrigacoes.map((x) => html`<tr class="${!x.pago && x.vencida ? 'vencido' : ''}"><td class="mono-sm">${x.numero}</td><td>${x.credor}</td><td>${dataBR(x.vencimento)}</td>
            <td class="num">${x.valorFormatado ?? reais(x.valor)}</td><td class="num">${x.saldoFinalFormatado ?? reais(x.saldo_final ?? x.saldoFinal)}</td>
            <td>${x.pago ? html`<span class="selo ok">Paga</span>` : x.vencida ? html`<span class="selo erro">Vencida</span>` : html`<span class="selo">A vencer</span>`}</td></tr>`)}</tbody></table></div>`
          : vazio('money', 'Nenhuma obrigação', 'O plano de recuperação ainda não foi cadastrado neste projeto, então não há parcelas para acompanhar.')}
      </section>
      <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Fluxo de caixa do cliente</h2>
        <p class="card__sub">${f ? `${f.totalDeLancamentos} lançamento(s) · previsto + realizado` : 'Sem acesso ou sem dados financeiros.'}</p></div>
        ${lanca && f ? html`<button type="button" class="btn btn--accent" data-lancar>${icone('plus')}Lançamento</button>` : ''}</header>
        ${f ? html`<div class="grid3" style="margin-bottom:18px">
          <div class="stat"><span class="stat__label">Saldo atual</span><span class="stat__value"><b>R$ ${f.indicadores.saldoAtualFormatado}</b></span></div>
          <div class="stat"><span class="stat__label">Meses de caixa</span><span class="stat__value"><b>${f.indicadores.mesesDeCaixa ?? '—'}</b></span></div>
          <div class="stat ${f.fluxo.periodosNegativos.length ? 'is-warn' : ''}"><span class="stat__label">Saldo final projetado</span><span class="stat__value"><b>R$ ${f.fluxo.saldoFinalProjetadoFormatado}</b></span></div></div>
          ${f.fluxo.periodosNegativos.length ? html`<p class="selo erro" style="margin-bottom:12px">Caixa projetado negativo em ${f.fluxo.periodosNegativos.length} período(s)</p>` : ''}
          <div class="barras">${f.fluxo.periodos.map((p) => { const v = Number(p.saldoProjetado); return html`<div class="barra"><b>${p.saldoProjetadoFormatado}</b><div class="barra__col"><i data-h="${Math.max(6, (Math.abs(v) / maxSaldo) * 100)}" ${v < 0 ? raw('style="background:linear-gradient(180deg,#ff9b9b,var(--lab-red))"') : ''}></i></div><small>${p.rotulo}</small></div>`; })}</div>`
          : vazio('chart', 'Sem fluxo de caixa', 'O fluxo aparece quando houver lançamentos do cliente neste projeto.')}
      </section>
      <div class="pilulas mt" data-sub-plano><button type="button" data-v="fin" aria-pressed="true">Gestão financeira</button>${pode('plano.ler') ? html`<button type="button" data-v="prj" aria-pressed="false">PRJ Studio</button>` : ''}</div><div class="mt" data-sub-corpo></div>`,
    depois(el) {
      const corpo = $('[data-sub-corpo]', el);
      const abrir = async (v) => { corpo.textContent = 'Carregando…'; try { const r = v === 'prj' ? await painelPrjStudio(ctx) : pode('financeiro_cliente.ler') ? await painelFinanceiroProjeto(ctx.id, () => ctx.recarregar()) : { html: '' }; corpo.innerHTML = String(r.html); r.depois?.(corpo); } catch (e) { corpo.textContent = e.message; } };
      ouvir(el, 'click', '[data-sub-plano] button', (b) => { $$('[data-sub-plano] button', el).forEach((x) => x.setAttribute('aria-pressed', x === b)); abrir(b.dataset.v); }); abrir('fin');
      ouvir(el, 'click', '[data-lancar]', async () => {
        const ok = await formulario({
          titulo: 'Novo lançamento', rotulo: 'Lançar',
          campos: [{ nome: 'tipo', rotulo: 'Tipo', tipo: 'select', metade: true, valor: 'despesa', opcoes: [{ v: 'receita', t: 'Receita' }, { v: 'despesa', t: 'Despesa' }] },
            { nome: 'situacao', rotulo: 'Situação', tipo: 'select', metade: true, valor: 'realizado', opcoes: [{ v: 'realizado', t: 'Realizado' }, { v: 'previsto', t: 'Previsto' }] },
            { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, metade: true, valor: hojeISO() }, { nome: 'valor', rotulo: 'Valor (R$)', obrigatorio: true, metade: true },
            { nome: 'categoria', rotulo: 'Categoria', obrigatorio: true, placeholder: 'Folha, fornecedores, vendas…' }, { nome: 'contraparte', rotulo: 'Contraparte' }],
          async enviar(v) { const valor = paraCentavos(v.valor); if (!valor) throw new Error('Valor inválido. Use 12.500,00'); await api.post(`/api/projetos/${ctx.id}/financeiro`, { tipo: v.tipo, situacao: v.situacao, data: v.data, valor, categoria: v.categoria, contraparte: v.contraparte }); toast('Lançamento registrado'); },
        });
        if (ok) ctx.recarregar();
      });
    },
  };
}

// ============================================================== RELATÓRIOS ===

const mesRelatorio = (periodo) => /^\d{4}-(0[1-9]|1[0-2])$/.test(periodo ?? '') ? periodo : '';
const rotuloMesRelatorio = (mes) => mes
  ? new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(mes + '-01T00:00:00Z'))
  : 'Sem competência informada';

export async function abaRelatorios(ctx) {
  const base = `/api/projetos/${ctx.id}`;
  const [docs, ger] = await Promise.all([api.get(`${base}/documentos`), api.get(`${base}/gerador/emissoes`)]);
  const escreve = pode('documento.escrever') && ctx.h.situacao !== 'encerrado';
  const publica = pode('portal.publicar');
  const relatorios = docs.filter((d) => d.categoria === 'relatorio_gerador');
  const porId = new Map(relatorios.map((d) => [d.id, d]));
  const vinculados = new Set(ger.emissoes.map((e) => e.documentoId));
  const porMes = new Map();
  const hoje = hojeISO();
  const competenciaAtual = hoje.slice(0, 7);
  const mesInicial = new Date(competenciaAtual + '-01T00:00:00Z');
  for (let i = 0; i < 6; i++) {
    const data = new Date(mesInicial);
    data.setUTCMonth(data.getUTCMonth() - i);
    porMes.set(data.toISOString().slice(0, 7), []);
  }
  const incluir = (mes, item) => {
    if (!porMes.has(mes)) porMes.set(mes, []);
    porMes.get(mes).push(item);
  };
  for (const e of ger.emissoes) incluir(mesRelatorio(e.periodo), { e, d: porId.get(e.documentoId) });
  for (const d of relatorios) if (!vinculados.has(d.id)) incluir('', { d });

  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Entregas mensais de relatórios</h2>
      <p class="card__sub">Relatórios do Gerador vinculados aos nomes cadastrados para este cliente. Confira a competência e publique o PDF no portal.</p></div>
      <a class="btn btn--ghost" href="/gerador/" target="_blank" rel="noopener">Abrir o gerador ↗</a></header>
      ${[...porMes.keys()].sort().reverse().map(mes => {
        const itens = porMes.get(mes);
        const publicados = itens.filter(({d}) => d?.visibilidade === 'publicado').length;
        return html`<details class="mt" ${mes === competenciaAtual ? raw('open') : ''}>
          <summary class="checklist-summary"><b>${rotuloMesRelatorio(mes)}</b>
            <span class="selo ${publicados ? 'ok' : ''}">${itens.length ? `${publicados}/${itens.length} no portal` : 'Sem relatório'}</span>
          </summary>
          ${itens.length ? html`<ul class="lista">${itens.map(({e,d}) => html`<li><div><b>${d?.titulo ?? e.cliente ?? e.nome}</b><small>${e?.modelo ?? d?.nome_original ?? ''}${e?.geradoEm ? ` · emitido ${relativo(e.geradoEm)}` : ''}</small></div>
            ${d ? html`<span class="selo ${d.visibilidade === 'publicado' ? 'ok' : ''}">${d.visibilidade === 'publicado' ? 'Publicado' : 'Importado'}</span>
              <button type="button" class="btn btn--ghost" data-baixar="${d.id}">Baixar</button>
              ${publica ? html`<button type="button" class="btn btn--ghost" data-relatorio-publicar="${d.id}" data-titulo="${d.titulo}" data-publicado="${d.visibilidade === 'publicado'}">${d.visibilidade === 'publicado' ? 'Retirar do portal' : 'Publicar'}</button>` : ''}`
              : html`<span class="selo info">Emitido</span>
                ${escreve ? html`<button type="button" class="btn btn--ghost" data-importar="${e.id}">Importar</button>
                ${publica ? html`<button type="button" class="btn btn--accent" data-importar="${e.id}" data-publicar="1">Importar e publicar</button>` : ''}` : ''}`}</li>`)}</ul>`
              : html`<p class="dica">Nenhuma emissão correspondente nesta competência.</p>`}
        </details>`;
      })}
    </section>`,
    depois(el) {
      ouvir(el, 'click', '[data-baixar]', (b) => baixar(b.dataset.baixar));
      ouvir(el, 'click', '[data-importar]', async (b) => {
        const publicar = !!b.dataset.publicar;
        const e = ger.emissoes.find((item) => item.id === b.dataset.importar);
        if (publicar && !(await confirmar('Importar e publicar ao cliente?', `O relatório de ${e.cliente ?? e.nome} ficará disponível no portal de ${ctx.h.nome}.`, { rotulo: 'Importar e publicar' }))) return;
        b.disabled = true;
        try { await api.post(`${base}/gerador/importacoes`, { emissaoId: e.id, publicar }); toast(publicar ? 'Relatório publicado no portal' : 'Relatório importado'); ctx.recarregar(); }
        catch (er) { b.disabled = false; erroDe(er); }
      });
      ouvir(el, 'click', '[data-relatorio-publicar]', async (b) => {
        const publicado = b.dataset.publicado === 'true';
        if (!publicado && !(await confirmar('Publicar relatório ao cliente?', `“${b.dataset.titulo}” ficará disponível no portal de ${ctx.h.nome}.`, { rotulo: 'Publicar' }))) return;
        try {
          const rota = `/api/documentos/${b.dataset.relatorioPublicar}/publicacao`;
          if (publicado) await api.del(rota); else await api.post(rota);
          toast(publicado ? 'Relatório retirado do portal' : 'Relatório publicado');
          ctx.recarregar();
        } catch (er) { erroDe(er); }
      });
    },
  };
}

async function resultado(r, ctx) {
  const publica = pode('portal.publicar');
  await modal({
    titulo: 'Relatório gerado', subtitulo: r.subtitulo ?? '',
    corpo: String(html`<p class="dica">Guardado no acervo como documento interno. Antes de publicar, leia o que o relatório não afirma:</p>
      ${(r.lacunas ?? []).length ? html`<ul class="lista">${r.lacunas.map((l) => html`<li><span class="empty__ico" style="width:32px;height:32px;border-radius:10px">${icone('alert')}</span><div><b>${typeof l === 'string' ? l : (l.titulo ?? l.texto ?? JSON.stringify(l))}</b></div></li>`)}</ul>` : html`<p class="dica">Nenhuma lacuna registrada.</p>`}`),
    acoes: [{ id: 'baixar', rotulo: 'Baixar PDF' }, ...(publica ? [{ id: 'pub', rotulo: 'Publicar ao cliente' }] : []), { id: 'ok', rotulo: 'Fechar', tipo: 'primario' }],
    aoAbrir(el) {
      el.addEventListener('acao', async (e) => {
        if (e.detail.id === 'baixar') return baixar(r.documentoId);
        if (e.detail.id === 'pub') { try { await api.post(`/api/documentos/${r.documentoId}/publicacao`); toast('Relatório publicado no portal'); el.fechar(true); } catch (er) { el.erro(er.message); } return; }
        el.fechar(true);
      });
    },
  });
}

