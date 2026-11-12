/** Relatório do diagnóstico inicial: versões, PDF, comparação e as extrações (números com a origem de cada um). */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataHoraBR, html, icone, ouvir } from '../util.js';
import { erroDe, formulario, modal, toast, vazio } from '../ui.js';

const TIPOS = [['balanco', 'Balanço (por exercício)'], ['dre_contabil', 'DRE contábil'], ['dre_gerencial', 'DRE gerencial'], ['faturamento', 'Faturamento (fiscal x gerencial)'], ['extrato', 'Extrato bancário'], ['passivo_fonte', 'Passivo por fonte'], ['clientes_abc', 'Clientes (curva ABC)'], ['partes_relacionadas', 'Partes relacionadas (nomes)']];
const MODELO = {
  balanco: { exercicio: 2025, ativoCirculante: 0, ativoNaoCirculante: 0, passivoCirculante: 0, passivoNaoCirculante: 0, patrimonioLiquido: 0 },
  dre_contabil: { exercicio: 2025, receitaBruta: 0, resultado: 0 }, dre_gerencial: { exercicio: 2025, receitaBruta: 0, resultado: 0 },
  faturamento: { ano: 2025, fiscal: 0, gerencial: 0 }, extrato: { banco: 'Itaú', linhas: [{ data: '2026-01-05', valor: 1000, historico: 'PIX cliente' }] },
  passivo_fonte: { fonte: 'Balanço contábil', total: 0, fiscal: 0 }, clientes_abc: { clientes: [{ nome: 'Cliente A', valor: 0 }] }, partes_relacionadas: { nomes: ['Nome do sócio ou empresa do grupo'] },
};

export async function secaoRelatorio(ctx) {
  const escreve = pode('analise.executar');
  const [versoes, extracoes] = await Promise.all([api.get(`/api/projetos/${ctx.id}/diagnostico/versoes`).catch(() => []), api.get(`/api/projetos/${ctx.id}/diagnostico/extracoes`).catch(() => [])]);
  const base = `/api/projetos/${ctx.id}/diagnostico`;
  return {
    html: html`<section class="card glass up" data-diag-rel><header class="card__head"><div><h2 class="card__title">Relatório do diagnóstico inicial</h2><p class="card__sub">Cada geração é uma versão guardada, com PDF paisagem. Todo número do relatório aponta para o arquivo de onde veio.</p></div>
      <div class="flex">${escreve ? html`<select class="select" data-posicao aria-label="Posição do cliente"><option value="devedor" ${ctx.h.posicaoCliente !== 'credor' ? 'selected' : ''}>NGA atua pelo devedor</option><option value="credor" ${ctx.h.posicaoCliente === 'credor' ? 'selected' : ''}>NGA atua pelo credor</option></select><button class="btn btn--accent" data-gerar>${icone('sparkle')}Gerar diagnóstico</button>` : ''}</div></header>
      <p class="nota">Leitura automática para revisão profissional. Não conclui sobre viabilidade. Confira vigência e julgados antes de citar qualquer tese.</p>
      ${versoes.length ? html`<table class="tbl"><thead><tr><th>Versão</th><th>Gerada</th><th>Por</th><th class="num">Docs</th><th class="num">Pendentes</th><th class="num">Riscos altos</th><th></th></tr></thead><tbody>${versoes.map((v, i) => html`<tr><td><b>v${v.numero}</b><small>${v.motivo === 'rodada_de_entrega' ? 'rodada de entrega' : 'manual'}</small></td><td>${dataHoraBR(v.geradoEm)}</td><td>${v.geradoPor ?? '—'}</td><td class="num">${v.documentos}</td><td class="num">${v.pendentes ?? '—'}</td><td class="num">${v.riscosAltos}</td>
        <td><div class="nx-acts"><a class="btn btn--ghost btn--sm" href="${base}/versoes/${v.numero}/html" target="_blank" rel="noopener">${icone('eye')}Abrir</a><button class="btn btn--accent btn--sm" data-pdf="${v.numero}">${icone('download')}Baixar PDF</button>${versoes[i + 1] ? html`<button class="btn btn--ghost btn--sm" data-cmp="${versoes[i + 1].numero}" data-para="${v.numero}">Comparar com v${versoes[i + 1].numero}</button>` : ''}</div></td></tr>`)}</tbody></table>`
        : vazio('doc', 'Nenhuma versão gerada', 'Clique em “Gerar diagnóstico”. Sem números extraídos, as páginas aparecem com o aviso “sem documentos para esta análise” e a lista do que pedir.')}
      <h3 class="mini-h">Números extraídos dos documentos</h3>
      ${extracoes.length ? html`<ul class="lista">${extracoes.map((x) => html`<li><div><b>${TIPOS.find(([t]) => t === x.tipo)?.[1] ?? x.tipo}</b><small>${x.referencia} · leitura ${x.qualidade} · ${x.origem}</small></div>${escreve ? html`<div class="fim"><button class="btn btn--ghost btn--sm perigo-btn" data-del="${x.id}">${icone('trash')}</button></div>` : ''}</li>`)}</ul>` : html`<p class="dica">Nada extraído ainda. Registre os números de cada demonstração, sempre com o arquivo e a página de origem.</p>`}
      ${escreve ? html`<button class="btn btn--ghost mt" data-extrair>${icone('plus')}Registrar números de um documento</button>` : ''}</section>`,
    depois(el) {
      ouvir(el, 'change', '[data-posicao]', async (s) => { try { await api.patch(`/api/projetos/${ctx.id}/dados-do-cliente`, { posicaoCliente: s.value }); toast('Posição do cliente salva'); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-gerar]', async (b) => { b.disabled = true; try { const r = await api.post(`${base}/versoes`, { motivo: 'manual' }); toast(`Versão ${r.numero} gerada`); ctx.recarregar(); } catch (e) { b.disabled = false; erroDe(e); } });
      ouvir(el, 'click', '[data-pdf]', async (b) => {
        const r = await fetch(`${base}/versoes/${b.dataset.pdf}/pdf`, { credentials: 'same-origin' });
        if (r.ok) { const u = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = u; a.download = `diagnostico-v${b.dataset.pdf}.pdf`; a.click(); return; }
        // Sem Chromium no servidor (caso da nuvem): o próprio navegador imprime o mesmo HTML em A4 paisagem.
        // "Salvar como PDF" no diálogo gera o arquivo; o @page do relatório já fixa 297 x 210 mm e margem zero.
        try {
          const doc = await (await fetch(`${base}/versoes/${b.dataset.pdf}/html`, { credentials: 'same-origin' })).text();
          const quadro = document.createElement('iframe');
          quadro.setAttribute('aria-hidden', 'true'); quadro.style.cssText = 'position:fixed;right:0;bottom:0;width:297mm;height:210mm;border:0;opacity:0;pointer-events:none';
          quadro.srcdoc = doc; document.body.appendChild(quadro);
          quadro.onload = () => { setTimeout(() => { quadro.contentWindow.focus(); quadro.contentWindow.print(); setTimeout(() => quadro.remove(), 60_000); }, 400); };
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
          { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', valor: 'balanco', opcoes: TIPOS.map(([v, t]) => ({ v, t })) },
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
