/**
 * Diagnóstico inicial dentro da aba: o MESMO documento que vira PDF, com todas as seções, renderizado na tela
 * (sem visualizador de PDF). "Gerar PDF" pagina esse documento em A4 paisagem e abre a impressão.
 *
 * Gerar tem duas etapas: primeiro os arquivos do cliente são lidos um a um (cada leitura numa chamada,
 * para caber no limite da nuvem e mostrar o progresso), depois a versão é montada. Nenhuma versão é
 * sobrescrita: cada geração fica guardada e pode ser comparada com a anterior.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataHoraBR, html, icone, ouvir } from '../util.js';
import { erroDe, formulario, modal, toast, vazio } from '../ui.js';
import { paginar } from '../diag_paginar.js';
import { ocrDoPdf, precisaOcr } from '../ocr.js?v=2311';

const TIPOS = [['balanco', 'Balanço (por exercício)'], ['dre_contabil', 'DRE contábil'], ['dre_gerencial', 'DRE gerencial'], ['faturamento', 'Faturamento (fiscal x gerencial)'], ['extrato', 'Extrato bancário'], ['passivo_fonte', 'Passivo por fonte'], ['clientes_abc', 'Clientes (curva ABC)'], ['partes_relacionadas', 'Partes relacionadas (nomes)'], ['checklist_respostas', 'Respostas do checklist']];
const MODELO = {
  balanco: { exercicio: 2025, ativoCirculante: 0, ativoNaoCirculante: 0, passivoCirculante: 0, passivoNaoCirculante: 0, patrimonioLiquido: 0 },
  dre_contabil: { exercicio: 2025, receitaBruta: 0, resultado: 0 }, dre_gerencial: { exercicio: 2025, receitaBruta: 0, resultado: 0 },
  faturamento: { ano: 2025, fiscal: 0, gerencial: 0 }, extrato: { banco: 'Itaú', linhas: [{ data: '2026-01-05', valor: 1000, historico: 'PIX cliente' }] },
  passivo_fonte: { fonte: 'Balanço contábil', total: 0, fiscal: 0 }, clientes_abc: { clientes: [{ nome: 'Cliente A', valor: 0 }] }, partes_relacionadas: { nomes: ['Nome do sócio ou empresa do grupo'] },
};

/** Botão "Gerar": lê os arquivos pendentes um por um e só então monta a versão. */
export async function gerarComProgresso(ctx, botao) {
  const base = `/api/projetos/${ctx.id}/diagnostico`;
  const texto = botao?.innerHTML; const avisos = [];
  const mostrar = (t) => { if (botao) botao.textContent = t; };
  if (botao) botao.disabled = true;
  try {
    // Os PDFs são lidos AQUI, no navegador (sem o limite de tempo da nuvem); o servidor recebe só as linhas.
    const { proximos = [] } = await api.get(`${base}/leituras`);
    const total = proximos.length; let feitos = 0;
    let leitor;
    for (const d of proximos) {
      mostrar(`Lendo arquivo ${feitos + 1} de ${total}…`);
      let corpo = { documentoId: d.id };
      if (d.ehPdf) {
        try {
          leitor ??= import('../vendor/pdf/pdf-linhas.js?v=2311');
          const { url } = await api.post(`/api/documentos/${d.id}/link`);
          const bytes = new Uint8Array(await (await fetch(url, { credentials: 'same-origin' })).arrayBuffer());
          let paginas = await (await leitor).linhasDoPdf(bytes, (p, n) => mostrar(`Lendo arquivo ${feitos + 1} de ${total} · página ${p} de ${n}…`));
          // Digitalizado ou com fonte embaralhada: OCR aqui no navegador.
          if (precisaOcr(paginas)) {
            const r = await ocrDoPdf(bytes, { aoProgredir: (p, n) => mostrar(`Lendo arquivo ${feitos + 1} de ${total} · reconhecendo texto (OCR) da página ${p} de ${n}…`) });
            if (r.paginas.flat().join('').length > 80) { paginas = r.paginas; corpo = { ...corpo, ocr: true }; if (r.truncado) avisos.push(`${d.nome}: OCR feito nas primeiras ${r.paginas.length} de ${r.totalPaginas} páginas.`); }
          }
          corpo = { ...corpo, paginas };
        } catch (e) { corpo = { ...corpo, erro: e.message }; }
      }
      try { const r = await api.post(`${base}/leituras`, corpo); avisos.push(...(r.avisos ?? [])); }
      catch (e) { avisos.push(`${d.nome}: ${e.message}`); }
      feitos++;
    }
    mostrar('Montando o relatório…');
    const v = await api.post(`${base}/versoes`, { motivo: 'manual', lerArquivos: false });
    versaoNaTela.delete(ctx.id);
    toast(`Versão ${v.numero} gerada${feitos ? ` · ${feitos} arquivo(s) lido(s)` : ''}${avisos.length ? ` · ${avisos.length} aviso(s) no relatório` : ''}`);
    ctx.recarregar();
  } catch (e) {
    if (botao) { botao.disabled = false; botao.innerHTML = texto; }
    erroDe(new Error(`Não foi possível gerar o diagnóstico: ${e.message}`));
  }
}

async function htmlDaVersao(ctx, numero) {
  const r = await fetch(`/api/projetos/${ctx.id}/diagnostico/versoes/${numero}/html`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`relatório indisponível (HTTP ${r.status})`);
  return r.text();
}

/**
 * Tema da aba: o documento usa as mesmas regras do PDF; aqui só as variáveis mudam para as do app e as seções
 * viram blocos em fluxo, sem página.
 */
const TELA_CSS = `
:host{display:block}
.dg.dg-tela{--fundo:transparent;--papel:transparent;--tinta:var(--text,#EAF1F8);--tinta2:var(--text-2,#B4C2D3);--suave:var(--text-3,#8DA0B5);--acento:var(--lab-amber,#F0A32E);
  --fonte:var(--font,Barlow,system-ui,sans-serif);--painel:rgba(255,255,255,.025);font-size:10pt;background:transparent}
.dg-tela .dg-fluxo{padding:0}
.dg-tela .dg-fluxo .dg-secao+.dg-secao{break-before:auto}
.dg-tela .dg-secao{border:1px solid var(--linha);border-radius:18px;padding:26px 28px 10px;margin:0 0 16px;background:rgba(255,255,255,.02);scroll-margin-top:90px}
.dg-tela .dg-sec-cab h2{font-size:21px}
.dg-tela .dg-lead{font-size:14px;max-width:none}
.dg-tela .dg-tab{font-size:12.5px}.dg-tela .dg-tab th{font-size:10.5px}.dg-tela .dg-tab .sub,.dg-tela .dg-nota{font-size:11.5px}
.dg-tela .dg-ach{font-size:13px;grid-template-columns:200px 1fr 90px}.dg-tela .dg-it{font-size:13px}
.dg-tela .dg-kpi b{font-size:24px}.dg-tela .dg-kpi span{font-size:11.5px}
.dg-tela .dg-fig{max-width:1100px}
.dg-nav{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px}
.dg-nav button{font:500 12.5px var(--fonte);color:var(--tinta2);background:rgba(255,255,255,.04);border:1px solid var(--linha);border-radius:999px;padding:6px 12px;cursor:pointer}
.dg-nav button:hover{color:var(--tinta);border-color:var(--acento)}
.dg-nav button b{color:var(--acento);font-weight:600;margin-right:6px}
@media (max-width:980px){.dg-tela .dg-linha>[class^="c"]{grid-column:span 12;margin-bottom:12px}.dg-tela .dg-ach{grid-template-columns:1fr}.dg-tela .dg-ach>span:last-child{text-align:left}.dg-tela .dg-secao{padding:18px 16px 6px}}
`;

/** Põe as seções do relatório (o mesmo HTML do PDF) dentro de um Shadow DOM: o CSS do documento não vaza para o app. */
function montarNaTela(host, docHtml) {
  const doc = new DOMParser().parseFromString(docHtml, 'text/html');
  const raiz = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const estilo = document.createElement('style');
  estilo.textContent = [...doc.querySelectorAll('style')].map((x) => x.textContent).join('\n') + TELA_CSS;
  const corpo = document.createElement('div'); corpo.className = 'dg dg-tela';
  const nav = document.createElement('nav'); nav.className = 'dg-nav'; nav.setAttribute('aria-label', 'Seções do diagnóstico');
  const secoes = [...doc.querySelectorAll('.dg-fluxo .dg-secao')];
  for (const sec of secoes) {
    const b = document.createElement('button'); b.type = 'button';
    const n = document.createElement('b'); n.textContent = String(sec.dataset.n).padStart(2, '0');
    b.append(n, sec.dataset.titulo ?? ''); b.dataset.ir = sec.id; nav.append(b);
  }
  const fluxo = document.createElement('div'); fluxo.className = 'dg-fluxo';
  fluxo.append(...secoes.map((x) => document.importNode(x, true)));
  corpo.append(nav, fluxo);
  raiz.replaceChildren(estilo, corpo);
  nav.addEventListener('click', (e) => { const b = e.target.closest('button[data-ir]'); if (b) raiz.getElementById(b.dataset.ir)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

/**
 * PDF: com Chromium no servidor, baixa o arquivo pronto. Sem ele (nuvem), monta o mesmo documento num iframe
 * fora da tela, pagina (capa, sumário com páginas, "n / N") e abre a impressão do navegador.
 */
export async function gerarPdf(ctx, numero, botao) {
  const base = `/api/projetos/${ctx.id}/diagnostico`;
  const texto = botao?.innerHTML; if (botao) { botao.disabled = true; botao.textContent = 'Preparando o PDF…'; }
  const restaurar = () => { if (botao) { botao.disabled = false; botao.innerHTML = texto; } };
  try {
    const r = await fetch(`${base}/versoes/${numero}/pdf`, { credentials: 'same-origin' });
    if (r.ok) { const u = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = u; a.download = `diagnostico-v${numero}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 30_000); restaurar(); return; }
    const docHtml = await htmlDaVersao(ctx, numero);
    const q = document.createElement('iframe');
    q.setAttribute('aria-hidden', 'true'); q.tabIndex = -1;
    q.style.cssText = 'position:fixed;left:-10000px;top:0;width:297mm;height:210mm;border:0;pointer-events:none';
    q.srcdoc = docHtml; document.body.appendChild(q);
    await new Promise((ok) => { q.onload = ok; });
    const d = q.contentDocument;
    try { await Promise.race([d.fonts?.ready, new Promise((ok) => setTimeout(ok, 2500))]); } catch { /* segue com a fonte de reserva */ }
    paginar(d);
    const empresa = (d.body.dataset.empresa || 'cliente').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
    const titulo = document.title; document.title = `Diagnostico_Inicial_${empresa}_v${numero}`;
    q.contentWindow.focus(); q.contentWindow.print();
    setTimeout(() => { document.title = titulo; }, 1000);
    setTimeout(() => q.remove(), 60_000);
    toast('Na janela de impressão, escolha "Salvar como PDF". A página já sai em A4 paisagem, sem margens extras.');
  } catch (e) { erroDe(e); }
  restaurar();
}

/** Versão mostrada na aba, por projeto (a atual quando não há escolha). */
const versaoNaTela = new Map();

export async function secaoRelatorio(ctx) {
  const escreve = pode('analise.executar');
  const base = `/api/projetos/${ctx.id}/diagnostico`;
  const [versoes, extracoes] = await Promise.all([api.get(`${base}/versoes`).catch(() => []), api.get(`${base}/extracoes`).catch(() => [])]);
  const atual = versoes.find((v) => v.numero === versaoNaTela.get(ctx.id)) ?? versoes[0];
  return {
    html: html`<section class="card glass up" data-diag-rel><header class="card__head"><div><h2 class="card__title">Diagnóstico ${atual ? html`<span class="selo info">v${atual.numero}${atual !== versoes[0] ? ' (anterior)' : ''}</span>` : ''}</h2>
      <p class="card__sub">${atual ? html`Gerado em ${dataHoraBR(atual.geradoEm)} por ${atual.geradoPor ?? '—'} · o mesmo conteúdo do PDF entregue ao cliente` : 'Gere a primeira versão para ver o diagnóstico aqui.'}</p></div>
      ${atual ? html`<div class="nx-acts">${atual !== versoes[0] ? html`<button class="btn btn--ghost btn--sm" data-ver="${versoes[0].numero}">Voltar à atual</button>` : ''}<button class="btn btn--accent" data-pdf="${atual.numero}">${icone('download')}Gerar PDF</button></div>` : ''}</header>
      ${atual ? html`<div class="diag-doc" data-diag-doc="${atual.numero}"><p class="dica">Carregando o diagnóstico…</p></div>`
        : vazio('doc', 'Nenhuma versão gerada', 'Clique em “Gerar diagnóstico”. Os arquivos do cliente são lidos um a um e o diagnóstico completo aparece aqui; o PDF sai do mesmo conteúdo.')}
      ${versoes.length > 1 ? html`<details class="mt"><summary class="link">Versões anteriores (${versoes.length - 1})</summary><table class="tbl mt"><thead><tr><th>Versão</th><th>Gerada</th><th>Por</th><th class="num">Docs</th><th class="num">Riscos altos</th><th></th></tr></thead><tbody>${versoes.map((v, i) => html`<tr><td><b>v${v.numero}</b><small>${v.motivo === 'rodada_de_entrega' ? 'rodada de entrega' : 'manual'}</small></td><td>${dataHoraBR(v.geradoEm)}</td><td>${v.geradoPor ?? '—'}</td><td class="num">${v.documentos}</td><td class="num">${v.riscosAltos}</td>
        <td><div class="nx-acts"><button class="btn btn--ghost btn--sm" data-ver="${v.numero}">${icone('eye')}Ver</button><button class="btn btn--ghost btn--sm" data-pdf="${v.numero}">${icone('download')}PDF</button>${versoes[i + 1] ? html`<button class="btn btn--ghost btn--sm" data-cmp="${versoes[i + 1].numero}" data-para="${v.numero}">Comparar com v${versoes[i + 1].numero}</button>` : ''}</div></td></tr>`)}</tbody></table></details>` : ''}
      <details class="mt"><summary class="link">Números extraídos dos documentos (${extracoes.length})</summary>
      ${extracoes.length ? html`<ul class="lista mt">${extracoes.map((x) => html`<li><div><b>${TIPOS.find(([t]) => t === x.tipo)?.[1] ?? x.tipo}</b><small>${x.referencia} · leitura ${x.qualidade} · ${x.origem}</small></div>${escreve ? html`<div class="fim"><button class="btn btn--ghost btn--sm perigo-btn" data-del="${x.id}" aria-label="Excluir">${icone('trash')}</button></div>` : ''}</li>`)}</ul>` : html`<p class="dica">Nada extraído ainda. Planilhas e PDFs com texto são lidos ao gerar; o resto você registra à mão, sempre com o arquivo e a página de origem.</p>`}
      ${escreve ? html`<button class="btn btn--ghost mt" data-extrair>${icone('plus')}Registrar números de um documento</button>` : ''}</details></section>`,
    depois(el) {
      const host = el.querySelector('[data-diag-doc]');
      if (host) htmlDaVersao(ctx, host.dataset.diagDoc).then((doc) => montarNaTela(host, doc))
        .catch((e) => { host.replaceChildren(Object.assign(document.createElement('p'), { className: 'selo erro', textContent: e.message })); });
      ouvir(el, 'click', '[data-ver]', (b) => { versaoNaTela.set(ctx.id, Number(b.dataset.ver)); ctx.recarregar(); });
      ouvir(el, 'click', '[data-pdf]', (b) => gerarPdf(ctx, b.dataset.pdf, b));
      ouvir(el, 'click', '[data-cmp]', async (b) => {
        try {
          const c = await api.get(`${base}/comparacao?de=${b.dataset.cmp}&para=${b.dataset.para}`);
          await modal({ titulo: `Versão ${c.de} para ${c.para}`, subtitulo: 'O que mudou entre as duas rodadas', largo: true, acoes: [{ id: 'ok', rotulo: 'Fechar', tipo: 'primario' }],
            corpo: String(html`<table class="tbl"><thead><tr><th>Indicador</th><th class="num">Antes</th><th class="num">Depois</th><th class="num">Variação</th></tr></thead><tbody>${c.mudancas.map((m) => html`<tr><td>${m.campo}</td><td class="num">${m.antes}</td><td class="num">${m.depois}</td><td class="num ${m.variacao ? '' : 'dica'}">${m.variacao > 0 ? '+' : ''}${m.variacao}</td></tr>`)}</tbody></table>${c.riscosNovos.length ? html`<h3 class="mini-h">Riscos novos</h3><ul>${c.riscosNovos.map((r) => html`<li>${r}</li>`)}</ul>` : ''}${c.riscosResolvidos.length ? html`<h3 class="mini-h">Riscos que saíram</h3><ul>${c.riscosResolvidos.map((r) => html`<li>${r}</li>`)}</ul>` : ''}`),
            aoAbrir(m) { m.addEventListener('acao', () => m.fechar(true)); } });
        } catch (e) { erroDe(e); }
      });
      ouvir(el, 'click', '[data-del]', async (b) => { try { await api.del(`/api/diagnostico/extracoes/${b.dataset.del}`); ctx.recarregar(); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-extrair]', async () => {
        const ok = await formulario({ titulo: 'Registrar números de um documento', subtitulo: 'Sem arquivo de origem, o número não entra no relatório.', rotulo: 'Registrar', largo: true, campos: [
          { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', valor: 'balanco', opcoes: TIPOS.filter(([t]) => MODELO[t]).map(([v, t]) => ({ v, t })) },
          { nome: 'referencia', rotulo: 'Arquivo e página ou aba', obrigatorio: true, placeholder: 'balanco-2025.pdf | p. 2' },
          { nome: 'qualidade', rotulo: 'Qualidade da leitura', tipo: 'select', valor: 'boa', opcoes: [['boa', 'Boa'], ['regular', 'Regular'], ['ruim', 'Ruim'], ['ilegivel', 'Ilegível (não entra)']].map(([v, t]) => ({ v, t })) },
          { nome: 'dados', rotulo: 'Dados (JSON)', tipo: 'textarea', obrigatorio: true, valor: JSON.stringify(MODELO.balanco, null, 1), dica: 'Valores em reais. O modelo muda conforme o tipo; veja os campos em cada exemplo.' }],
          depois(m, form) { form.elements.tipo.addEventListener('change', () => { form.elements.dados.value = JSON.stringify(MODELO[form.elements.tipo.value], null, 1); }); },
          async enviar(v) { let dados; try { dados = JSON.parse(v.dados); } catch { throw new Error('O JSON dos dados está inválido.'); } await api.post(`${base}/extracoes`, { tipo: v.tipo, referencia: v.referencia, qualidade: v.qualidade, dados }); } });
        if (ok) { toast('Números registrados'); ctx.recarregar(); }
      });
    },
  };
}
