/**
 * Relatório do diagnóstico inicial dentro da aba: a MESMA página que vira PDF, mostrada aqui como é.
 *
 * Gerar tem duas etapas: primeiro os arquivos do cliente são lidos um a um (cada leitura numa chamada,
 * para caber no limite da nuvem e mostrar o progresso), depois a versão é montada. Nenhuma versão é
 * sobrescrita: cada geração fica guardada e pode ser comparada com a anterior.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataHoraBR, html, icone, ouvir } from '../util.js';
import { erroDe, formulario, modal, toast, vazio } from '../ui.js';

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
    let { restantes } = await api.get(`${base}/leituras`);
    const total = restantes; let feitos = 0;
    while (restantes > 0 && feitos < 400) {
      mostrar(`Lendo arquivo ${feitos + 1} de ${total}…`);
      const r = await api.post(`${base}/leituras`, {});
      if (!r.lido) break;
      avisos.push(...r.avisos); feitos++; restantes = r.restantes;
    }
    mostrar('Montando o relatório…');
    const v = await api.post(`${base}/versoes`, { motivo: 'manual', lerArquivos: false });
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

/** Quadro com o relatório: página A4 paisagem escalada para a largura do cartão. */
function encaixar(quadro) {
  const largura = quadro.parentElement.clientWidth; const escala = Math.min(1, largura / 1123);
  quadro.style.transform = `scale(${escala})`; quadro.style.marginBottom = `${Math.round(quadro.dataset.altura * (escala - 1))}px`;
}

export async function secaoRelatorio(ctx) {
  const escreve = pode('analise.executar');
  const base = `/api/projetos/${ctx.id}/diagnostico`;
  const [versoes, extracoes] = await Promise.all([api.get(`${base}/versoes`).catch(() => []), api.get(`${base}/extracoes`).catch(() => [])]);
  const atual = versoes[0];
  return {
    html: html`<section class="card glass up" data-diag-rel><header class="card__head"><div><h2 class="card__title">Relatório do diagnóstico ${atual ? html`<span class="selo info">v${atual.numero}</span>` : ''}</h2>
      <p class="card__sub">${atual ? html`Gerado em ${dataHoraBR(atual.geradoEm)} por ${atual.geradoPor ?? '—'} · é exatamente o que sai no PDF` : 'Gere a primeira versão para ver o relatório aqui.'}</p></div>
      ${atual ? html`<div class="nx-acts"><button class="btn btn--ghost btn--sm" data-cheia="${atual.numero}">${icone('eye')}Tela cheia</button><button class="btn btn--accent btn--sm" data-pdf="${atual.numero}">${icone('download')}Baixar PDF</button></div>` : ''}</header>
      ${atual ? html`<div class="diag-folha" data-folha><iframe title="Relatório do diagnóstico" data-quadro="${atual.numero}" data-altura="794" style="width:1123px;height:794px;border:0;transform-origin:0 0;border-radius:12px;background:#0B111D"></iframe></div>`
        : vazio('doc', 'Nenhuma versão gerada', 'Clique em “Gerar diagnóstico”. Os arquivos do cliente são lidos um a um e o relatório aparece aqui, igual ao PDF.')}
      ${versoes.length > 1 ? html`<details class="mt"><summary class="link">Versões anteriores (${versoes.length - 1})</summary><table class="tbl mt"><thead><tr><th>Versão</th><th>Gerada</th><th>Por</th><th class="num">Docs</th><th class="num">Riscos altos</th><th></th></tr></thead><tbody>${versoes.map((v, i) => html`<tr><td><b>v${v.numero}</b><small>${v.motivo === 'rodada_de_entrega' ? 'rodada de entrega' : 'manual'}</small></td><td>${dataHoraBR(v.geradoEm)}</td><td>${v.geradoPor ?? '—'}</td><td class="num">${v.documentos}</td><td class="num">${v.riscosAltos}</td>
        <td><div class="nx-acts"><button class="btn btn--ghost btn--sm" data-cheia="${v.numero}">${icone('eye')}Ver</button><button class="btn btn--ghost btn--sm" data-pdf="${v.numero}">${icone('download')}PDF</button>${versoes[i + 1] ? html`<button class="btn btn--ghost btn--sm" data-cmp="${versoes[i + 1].numero}" data-para="${v.numero}">Comparar com v${versoes[i + 1].numero}</button>` : ''}</div></td></tr>`)}</tbody></table></details>` : ''}
      <details class="mt"><summary class="link">Números extraídos dos documentos (${extracoes.length})</summary>
      ${extracoes.length ? html`<ul class="lista mt">${extracoes.map((x) => html`<li><div><b>${TIPOS.find(([t]) => t === x.tipo)?.[1] ?? x.tipo}</b><small>${x.referencia} · leitura ${x.qualidade} · ${x.origem}</small></div>${escreve ? html`<div class="fim"><button class="btn btn--ghost btn--sm perigo-btn" data-del="${x.id}" aria-label="Excluir">${icone('trash')}</button></div>` : ''}</li>`)}</ul>` : html`<p class="dica">Nada extraído ainda. Planilhas e PDFs com texto são lidos ao gerar; o resto você registra à mão, sempre com o arquivo e a página de origem.</p>`}
      ${escreve ? html`<button class="btn btn--ghost mt" data-extrair>${icone('plus')}Registrar números de um documento</button>` : ''}</details></section>`,
    depois(el) {
      const quadro = el.querySelector('[data-quadro]');
      if (quadro) {
        htmlDaVersao(ctx, quadro.dataset.quadro).then((doc) => {
          quadro.srcdoc = doc;
          quadro.onload = () => { const paginas = quadro.contentDocument?.querySelectorAll('.pg').length || 1; quadro.dataset.altura = String(paginas * 794); quadro.style.height = `${paginas * 794}px`; encaixar(quadro); };
        }).catch((e) => { quadro.replaceWith(Object.assign(document.createElement('p'), { className: 'selo erro', textContent: e.message })); });
        const ro = new ResizeObserver(() => encaixar(quadro)); ro.observe(quadro.parentElement);
      }
      ouvir(el, 'click', '[data-cheia]', async (b) => {
        try {
          const doc = await htmlDaVersao(ctx, b.dataset.cheia);
          const f = document.createElement('iframe'); f.srcdoc = doc; f.title = 'Relatório em tela cheia';
          f.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:9999;background:#0B111D';
          document.body.appendChild(f);
          const sair = () => { f.remove(); document.removeEventListener('fullscreenchange', aoMudar); };
          const aoMudar = () => { if (!document.fullscreenElement) sair(); };
          f.onload = () => f.contentDocument?.addEventListener('keydown', (e) => { if (e.key === 'Escape') sair(); });
          try { await f.requestFullscreen(); document.addEventListener('fullscreenchange', aoMudar); } catch { toast('Pressione Esc para fechar o relatório.'); }
        } catch (e) { erroDe(e); }
      });
      ouvir(el, 'click', '[data-pdf]', async (b) => {
        const r = await fetch(`${base}/versoes/${b.dataset.pdf}/pdf`, { credentials: 'same-origin' });
        if (r.ok) { const u = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = u; a.download = `diagnostico-v${b.dataset.pdf}.pdf`; a.click(); return; }
        // Sem Chromium no servidor (caso da nuvem): o navegador imprime o mesmo HTML em A4 paisagem.
        try {
          const doc = await htmlDaVersao(ctx, b.dataset.pdf);
          const q = document.createElement('iframe');
          q.setAttribute('aria-hidden', 'true'); q.style.cssText = 'position:fixed;right:0;bottom:0;width:297mm;height:210mm;border:0;opacity:0;pointer-events:none';
          q.srcdoc = doc; document.body.appendChild(q);
          q.onload = () => { setTimeout(() => { q.contentWindow.focus(); q.contentWindow.print(); setTimeout(() => q.remove(), 60_000); }, 400); };
          toast('Na janela de impressão, escolha "Salvar como PDF". O relatório já sai em A4 paisagem.');
        } catch (e) { erroDe(e); }
      });
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
