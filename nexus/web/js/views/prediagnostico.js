/**
 * Pré-diagnóstico por CNPJ: cadastro, organograma societário (empresa → sócios → empresas ligadas),
 * processos (DJEN + carteira do LAB + DataJud) e o resumo executivo. Vale dentro do projeto (aba) e no
 * onboarding, antes de existir projeto. Roda em etapas curtas, mostrando o progresso; tudo cita a fonte.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, esc, html, icone, raw, relativo } from '../util.js';
import { erroDe, formulario, modal, toast, vazio } from '../ui.js';

const brl = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const cnpjFmt = (d) => { const x = String(d ?? '').replace(/\D/g, ''); return x.length === 14 ? `${x.slice(0, 2)}.${x.slice(2, 5)}.${x.slice(5, 8)}/${x.slice(8, 12)}-${x.slice(12)}` : d; };
const iniciais = (n) => String(n ?? '?').replace(/\b(LTDA|S\/?A|EIRELI|ME|EPP)\b/gi, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const situacaoCor = (s) => /ativ/i.test(s ?? '') ? 'ok' : /baix|inapt|nul/i.test(s ?? '') ? 'erro' : 'aviso';
const POLO = { ativo: ['ok', 'Autora / exequente'], passivo: ['erro', 'Ré / executada'] };

/** Pede o CNPJ e cria. Devolve o pré-diagnóstico criado. */
export async function novoPrediagnostico({ projetoId = null, cnpj = '' } = {}) {
  let criado = null;
  await formulario({ titulo: 'Novo pré-diagnóstico', subtitulo: 'Informe o CNPJ. O sistema busca o cadastro na Receita, os sócios, as empresas ligadas e os processos em fontes públicas.', rotulo: 'Começar', campos: [
    { nome: 'cnpj', rotulo: 'CNPJ', obrigatorio: true, valor: cnpj, placeholder: '00.000.000/0000-00', autocomplete: 'off' }],
    depois(el) { const i = el.querySelector('[name=cnpj]'); i.inputMode = 'numeric'; i.addEventListener('input', () => { const d = i.value.replace(/\D/g, '').slice(0, 14); i.value = d.length > 12 ? cnpjFmt(d.padEnd(14, ' ')).trim() : d; }); },
    async enviar(v) { criado = await api.post('/api/prediagnosticos', { cnpj: v.cnpj.replace(/\D/g, ''), projetoId }); } });
  return criado;
}

/** Roda as etapas que faltam (processos e DataJud), redesenhando a cada passo. */
export async function completar(d, aoAtualizar) {
  let atual = d;
  if (atual.etapa === 'processos') { aoAtualizar?.(atual, 'Procurando processos no DJEN e na carteira do LAB…'); atual = await api.post(`/api/prediagnosticos/${atual.id}/processos`, {}); aoAtualizar?.(atual); }
  for (let volta = 0; atual.etapa === 'datajud' && volta < 25; volta++) {
    aoAtualizar?.(atual, `Completando no DataJud (${atual.processos.filter((x) => !x.datajud).length} processo(s) na fila; o CNJ leva ~40 s por tribunal)…`);
    const r = await api.post(`/api/prediagnosticos/${atual.id}/datajud`, {}); atual = r; aoAtualizar?.(atual);
    if (!r.restantes) break;
  }
  return atual;
}

function organograma(d) {
  const e = d.empresa; const lig = d.ligadas ?? [];
  const daPessoa = (s) => lig.filter((l) => (l.via ?? []).some((v) => v.startsWith(s.nome)));
  const soltas = lig.filter((l) => !(e.socios ?? []).some((s) => (l.via ?? []).some((v) => v.startsWith(s.nome))));
  const noEmpresa = (x, principal = false) => html`<button type="button" class="og-no og-no--pj ${principal ? 'is-principal' : ''}" data-no-empresa="${x.cnpj}"><span class="og-av">${iniciais(x.razao)}</span>
    <span class="og-txt"><b>${x.razao}</b><small>${cnpjFmt(x.cnpj)}</small><small>${x.situacao ? html`<i class="og-sit og-sit--${situacaoCor(x.situacao)}"></i>${x.situacao}` : ''}${x.capital != null ? ` · capital ${brl(x.capital)}` : ''}</small></span></button>`;
  const noPessoa = (s) => html`<button type="button" class="og-no og-no--pf" data-no-socio="${s.id}"><span class="og-av og-av--pf">${iniciais(s.nome)}</span><span class="og-txt"><b>${s.nome}</b><small>${s.qualificacao ?? 'Sócio'}${s.documento ? ` · ${s.tipo === 'PJ' ? cnpjFmt(s.documento) : `CPF ${s.documento}`}` : ''}</small>${s.entrada ? html`<small>desde ${dataBR(s.entrada)}</small>` : ''}</span></button>`;
  return html`<div class="og" role="tree" aria-label="Organograma societário"><ul><li>${noEmpresa(e, true)}
      ${(e.socios ?? []).length ? html`<ul>${e.socios.map((s) => { const filhas = s.tipo === 'PJ' ? lig.filter((l) => l.cnpj === String(s.documento ?? '').replace(/\D/g, '')) : daPessoa(s);
        return html`<li>${noPessoa(s)}${filhas.length ? html`<ul>${filhas.map((f) => html`<li>${noEmpresa(f)}<small class="og-rel">${f.relacao}${f.origem === 'base_lab' ? ' · base do LAB' : f.origem === 'manual' ? ' · informada' : ''}</small></li>`)}</ul>` : ''}</li>`; })}</ul>` : html`<p class="dica">A Receita não informa sócios para este CNPJ (ex.: empresário individual).</p>`}
    </li>${soltas.map((f) => html`<li class="og-solta">${noEmpresa(f)}<small class="og-rel">${f.relacao}</small></li>`)}</ul></div>`;
}

function tabelaProcessos(d, filtro) {
  const l = d.processos.filter((x) => filtro === 'todos' || (filtro === 'curso' ? !x.datajud?.arquivado : filtro === 'arquivados' ? x.datajud?.arquivado : x.polo === filtro));
  if (!d.processos.length) return vazio('scale', 'Nenhum processo encontrado ainda', 'O DJEN só traz o que foi publicado desde 2023 e pelo nome exato da parte. Inclua números conhecidos em "Incluir processos".');
  return html`<div class="tbl-wrap"><table class="tbl pd-procs"><thead><tr><th>Processo</th><th>Juízo</th><th>Polo da empresa</th><th>Outra parte</th><th>Situação e último andamento</th><th>Fonte</th></tr></thead><tbody>
    ${l.map((x) => html`<tr><td><b class="mono-sm">${x.numero}</b><small>${x.datajud?.classe ?? x.classe ?? ''}</small>${x.datajud?.ajuizamento ? html`<small>ajuizado ${dataBR(x.datajud.ajuizamento)}</small>` : ''}</td>
      <td>${x.datajud?.orgao ?? x.orgao ?? '—'}<small>${x.tribunal ?? ''}</small></td>
      <td>${x.polo ? html`<span class="selo ${POLO[x.polo][0]}">${POLO[x.polo][1]}</span>` : html`<span class="selo">a conferir</span>`}</td>
      <td>${(x.partes ?? []).slice(0, 2).join(' · ') || '—'}${(x.comoConsta ?? []).length ? html`<small>consta como: ${x.comoConsta.join(' / ')}</small>` : ''}</td>
      <td>${x.datajud?.estado === 'ok' ? html`<span class="selo ${x.datajud.arquivado ? '' : 'info'}">${x.datajud.arquivado ? 'Arquivado' : 'Em curso'}</span>${x.datajud.ultimoMovimento ? html`<small>${dataBR(x.datajud.ultimoMovimento.data)} · ${x.datajud.ultimoMovimento.titulo}</small>` : ''}`
        : x.datajud?.estado === 'nao_encontrado' ? html`<small>Fora do DataJud (sigilo ou base pública)</small>` : x.datajud?.estado === 'instavel' ? html`<small>DataJud instável: tente "Completar no DataJud"</small>` : html`<small>${x.ultimaPublicacao ? `última publicação ${dataBR(x.ultimaPublicacao)}` : 'na fila do DataJud'}</small>`}</td>
      <td><small>${(x.fontes ?? []).join(' · ')}</small></td></tr>`)}</tbody></table></div>`;
}

/** Relatório completo (HTML). `opcoes.cabecalho=false` quando já há um cabeçalho de página em volta. */
export function htmlRelatorio(d, { progresso = '', filtro = 'todos' } = {}) {
  const e = d.empresa; const r = d.resumo;
  return html`<div class="pdx" data-pd="${d.id}">
    <section class="pd-capa card glass up"><div class="pd-capa__id"><span class="og-av og-av--xl">${iniciais(e.razao)}</span><div>
        <p class="eyebrow">Pré-diagnóstico · ${dataBR(d.atualizadoEm)}</p><h2>${e.razao}</h2>${e.fantasia ? html`<p class="pd-fantasia">${e.fantasia}</p>` : ''}
        <p class="pd-linha"><span class="selo ${situacaoCor(e.situacao)}">${e.situacao ?? 'situação ?'}</span><span class="mono-sm">${d.cnpjFormatado}</span>${e.abertura ? html`<span>aberta em ${dataBR(e.abertura)}</span>` : ''}${e.porte ? html`<span>${e.porte}</span>` : ''}</p></div></div>
      <dl class="pd-ficha"><div><dt>Atividade</dt><dd>${e.cnae ? `${e.cnae.descricao}` : '—'}</dd></div><div><dt>Capital social</dt><dd>${brl(e.capital)}</dd></div>
        <div><dt>Natureza</dt><dd>${e.natureza ?? '—'}</dd></div><div><dt>Endereço</dt><dd>${e.endereco ? `${e.endereco.logradouro}, ${e.endereco.numero} · ${e.endereco.municipio}/${e.endereco.uf}` : '—'}</dd></div>
        <div><dt>Contato</dt><dd>${[...(e.telefones ?? []), ...(e.emails ?? [])].join(' · ') || '—'}</dd></div><div><dt>Simples</dt><dd>${e.simples === true ? 'Optante' : e.simples === false ? 'Não optante' : '—'}</dd></div></dl></section>
    ${progresso ? html`<div class="pd-prog glass up"><span class="pd-spin"></span>${progresso}</div>` : ''}
    <div class="pd-kpis up">${[
      ['Processos', r.processos, r.periodo ?? 'publicados no DJEN e na carteira'], ['Em curso', r.emCurso, `${r.arquivados} arquivado(s)`],
      ['Como autora', r.ativo, 'exequente / requerente'], ['Como ré', r.passivo, 'executada / requerida'],
      ['Sócios', r.socios, 'no quadro da Receita'], ['Empresas ligadas', r.ligadas, 'por sócio'],
    ].map(([t, v, s]) => html`<div class="pd-kpi card glass"><small>${t}</small><b>${v}</b><i>${s}</i></div>`)}</div>
    <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Estrutura societária</h2><p class="card__sub">Empresa → sócios → empresas ligadas. Toque num nó para ver os detalhes.</p></div>
      ${pode('projeto.escrever') ? html`<button class="btn btn--ghost btn--sm" data-pd-ligar>${icone('plus')}Ligar empresa (CNPJ)</button>` : ''}</header>
      ${organograma(d)}<div data-pd-detalhe></div></section>
    <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Processos</h2><p class="card__sub">${r.tribunais.length ? `Tribunais: ${r.tribunais.join(', ')}` : 'DJEN (por nome da parte), carteira do LAB e DataJud'}</p></div>
      <div class="nx-acts"><div class="cli-seg" role="group" aria-label="Filtro">${[['todos', 'Todos'], ['curso', 'Em curso'], ['arquivados', 'Arquivados'], ['ativo', 'Como autora'], ['passivo', 'Como ré']].map(([v, t]) => html`<button type="button" class="${filtro === v ? 'is-on' : ''}" data-pd-filtro="${v}">${t}</button>`)}</div>
      ${pode('projeto.escrever') ? html`<button class="btn btn--ghost btn--sm" data-pd-numeros>${icone('plus')}Incluir processos</button><button class="btn btn--ghost btn--sm" data-pd-refazer>${icone('refresh')}Buscar de novo</button>` : ''}</div></header>
      <div data-pd-tabela>${tabelaProcessos(d, filtro)}</div>
      ${r.recorrentes.length ? html`<h3 class="mini-h mt">Partes que aparecem em mais de um processo</h3><div class="pd-rec">${r.recorrentes.map((x) => html`<span>${x.nome} <b>${x.n}</b></span>`)}</div>` : ''}</section>
    ${(d.processosSocios ?? []).length ? html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Processos dos sócios</h2>
      <p class="card__sub">Em nome próprio, pelo nome completo no DJEN. Mesmo nome não é prova de mesma pessoa: confira o CPF nos autos.</p></div></header>
      <div class="tbl-wrap"><table class="tbl pd-procs"><thead><tr><th>Processo</th><th>Sócio</th><th>Juízo</th><th>Polo</th><th>Outra parte</th><th>Última publicação</th></tr></thead><tbody>
      ${d.processosSocios.map((x) => html`<tr><td><b class="mono-sm">${x.numero}</b><small>${x.classe ?? ''}</small></td><td>${x.socio ?? '—'}</td><td>${x.orgao ?? '—'}<small>${x.tribunal ?? ''}</small></td>
        <td>${x.polo ? html`<span class="selo ${POLO[x.polo][0]}">${POLO[x.polo][1]}</span>` : html`<span class="selo">a conferir</span>`}</td>
        <td>${(x.partes ?? []).slice(0, 2).join(' · ') || '—'}</td><td>${x.ultimaPublicacao ? dataBR(x.ultimaPublicacao) : '—'}</td></tr>`)}</tbody></table></div></section>` : ''}
    <details class="card glass up mt pd-fontes"><summary>Fontes e limites deste levantamento</summary><ul>
      <li>Cadastro e sócios: ${e.fonte} (dados públicos da Receita Federal; CPF de sócio vem mascarado).</li>
      <li>Processos: DJEN, Diário de Justiça Eletrônico Nacional (publicações desde 2021, busca pelo nome exato da parte — por isso o sistema tenta o nome com e sem LTDA/EIRELI/ME/EPP e o nome fantasia), carteira importada do Astrea e números informados pela equipe; detalhes pelo DataJud (CNJ).</li>
      ${d.fontes?.processos?.djen?.achouPor ? html`<li>Buscas no DJEN (processos novos achados por cada uma): ${Object.entries(d.fontes.processos.djen.achouPor).map(([n, q]) => `"${n}" ${q}`).join(' · ')}.</li>` : ''}
      ${(d.avisos ?? []).map((a) => html`<li>${a}</li>`)}
      <li>Documento preliminar: valores e situações precisam de conferência nos autos.</li></ul></details>
  </div>`;
}

/** Liga os botões do relatório. `recarregar(d)` redesenha com o novo estado. */
export function ligarRelatorio(el, recarregar) {
  if (el.__pdLigado) return; el.__pdLigado = true;
  let filtro = 'todos';
  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b || !el.contains(b)) return;
    const d = el.__pd; if (!d) return;
    if (b.dataset.pdFiltro) { filtro = b.dataset.pdFiltro; el.querySelectorAll('[data-pd-filtro]').forEach((x) => x.classList.toggle('is-on', x === b)); el.querySelector('[data-pd-tabela]').innerHTML = String(tabelaProcessos(d, filtro)); return; }
    if (b.dataset.noEmpresa || b.dataset.noSocio) {
      const alvo = el.querySelector('[data-pd-detalhe]'); el.querySelectorAll('.og-no').forEach((x) => x.classList.toggle('is-sel', x === b));
      if (b.dataset.noSocio) { const s = d.empresa.socios.find((x) => x.id === b.dataset.noSocio); const outras = (d.ligadas ?? []).filter((l) => (l.via ?? []).some((v) => v.startsWith(s.nome)));
        alvo.innerHTML = String(html`<div class="og-det"><b>${s.nome}</b><small>${s.qualificacao ?? ''}${s.faixa ? ` · ${s.faixa}` : ''}${s.entrada ? ` · na sociedade desde ${dataBR(s.entrada)}` : ''}</small>
          <p>${outras.length ? `Também ligado(a) a ${outras.map((o) => o.razao).join(', ')}.` : 'Nenhuma outra empresa encontrada nas fontes gratuitas e na base do LAB.'}</p>
          <p class="dica">Para procurar outras empresas desta pessoa: consulte uma base paga (ex.: Leme, Sr. Watson) e traga o CNPJ em "Ligar empresa".</p></div>`); }
      else { const x = b.dataset.noEmpresa === d.empresa.cnpj ? { ...d.empresa, relacao: 'empresa analisada' } : d.ligadas.find((l) => l.cnpj === b.dataset.noEmpresa);
        alvo.innerHTML = String(html`<div class="og-det"><b>${x.razao}</b><small>${cnpjFmt(x.cnpj)} · ${x.situacao ?? ''}${x.capital != null ? ` · capital ${brl(x.capital)}` : ''}</small>
          ${x.cnae ? html`<p>${x.cnae.descricao}</p>` : ''}${(x.socios ?? []).length ? html`<p><b>Quadro:</b> ${x.socios.map((s) => `${s.nome} (${s.qualificacao ?? 'sócio'})`).join(' · ')}</p>` : ''}
          ${[...(x.telefones ?? []), ...(x.emails ?? [])].length ? html`<p>${[...(x.telefones ?? []), ...(x.emails ?? [])].join(' · ')}</p>` : ''}</div>`); }
      return;
    }
    try {
      if (b.matches('[data-pd-ligar]')) { let r; const ok = await formulario({ titulo: 'Ligar empresa', subtitulo: 'Informe o CNPJ de uma empresa que você sabe ser do mesmo grupo ou do mesmo sócio. O sistema busca o cadastro e liga no organograma.', rotulo: 'Ligar', campos: [{ nome: 'cnpj', rotulo: 'CNPJ', obrigatorio: true }], async enviar(v) { r = await api.post(`/api/prediagnosticos/${d.id}/ligar`, { cnpj: v.cnpj.replace(/\D/g, '') }); } }); if (ok) recarregar(r); }
      if (b.matches('[data-pd-numeros]')) { let r; const ok = await formulario({ titulo: 'Incluir processos', subtitulo: 'Cole os números (um por linha). O DataJud completa o resto.', rotulo: 'Incluir', campos: [{ nome: 'n', rotulo: 'Números CNJ', tipo: 'textarea', obrigatorio: true }], async enviar(v) { const numeros = (v.n.match(/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/g) ?? []); if (!numeros.length) throw new Error('Nenhum número CNJ reconhecido.'); r = await api.post(`/api/prediagnosticos/${d.id}/numeros`, { numeros }); } }); if (ok) { recarregar(r, true); } }
      if (b.matches('[data-pd-refazer]')) { b.disabled = true; const r = await api.post(`/api/prediagnosticos/${d.id}/processos`, {}); recarregar(r, true); }
    } catch (er) { erroDe(er); b.disabled = false; }
  });
}

/** Monta o relatório num elemento e roda as etapas que faltam, sem recarregar a página. */
export async function montarRelatorio(alvo, d) {
  const pintar = (x, progresso = '') => { alvo.__pd = x; alvo.innerHTML = String(htmlRelatorio(x, { progresso })); };
  ligarRelatorio(alvo, (novo) => montarRelatorio(alvo, novo));
  pintar(d);
  if (d.etapa !== 'pronto') { try { pintar(await completar(d, (x, msg) => pintar(x, msg ?? ''))); } catch (e) { erroDe(e); pintar(alvo.__pd); } }
}

/** Aba "Pré-diagnóstico" do projeto. */
export async function abaPrediagnostico(ctx) {
  const lista = await api.get(`/api/prediagnosticos?projeto=${ctx.id}`);
  const cnpj = ctx.h.empresas?.[0]?.cnpj ?? '';
  return {
    html: html`${lista.length ? html`<div class="nx-acts up" style="margin-bottom:12px">${lista.length > 1 ? html`<select class="select" data-pd-qual style="max-width:360px">${lista.map((p) => html`<option value="${p.id}">${p.razao ?? p.cnpj} · ${dataBR(p.criadoEm)}</option>`)}</select>` : html`<span class="dica">Levantado ${relativo(lista[0].criadoEm)} por ${lista[0].criadoPor ?? '—'}</span>`}
        <span class="grow"></span><button class="btn btn--ghost btn--sm" data-pd-imprimir>${icone('download')}Imprimir / PDF</button>${pode('projeto.escrever') ? html`<button class="btn btn--accent btn--sm" data-pd-novo>${icone('plus')}Novo levantamento</button>` : ''}</div><div data-pd-alvo></div>`
      : html`<section class="card glass up">${vazio('search', 'Pré-diagnóstico do cliente', 'A partir do CNPJ: cadastro na Receita, sócios e organograma, empresas ligadas e processos em fontes públicas. Bom para preparar a primeira reunião.', pode('projeto.escrever') ? '<button class="btn btn--accent" data-pd-novo>Fazer pré-diagnóstico</button>' : '')}</section>`}`,
    async depois(el) {
      const alvo = el.querySelector('[data-pd-alvo]');
      const abrir = async (id) => { alvo.innerHTML = '<div class="skel" style="height:420px"></div>'; try { montarRelatorio(alvo, await api.get(`/api/prediagnosticos/${id}`)); } catch (e) { erroDe(e); } };
      if (lista.length) abrir(lista[0].id);
      el.querySelector('[data-pd-qual]')?.addEventListener('change', (e) => abrir(e.target.value));
      el.querySelector('[data-pd-imprimir]')?.addEventListener('click', () => { document.body.classList.add('pd-imprimindo'); window.print(); setTimeout(() => document.body.classList.remove('pd-imprimindo'), 500); });
      el.querySelectorAll('[data-pd-novo]').forEach((b) => b.addEventListener('click', async () => { const d = await novoPrediagnostico({ projetoId: ctx.id, cnpj }); if (d) ctx.recarregar(); }));
    },
  };
}

export { esc, raw, modal, toast };
