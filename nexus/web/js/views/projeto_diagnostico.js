/**
 * Diagnóstico inicial: o que o cliente enviou, o que o sistema entendeu e o
 * que falta — para o advogado decidir por onde começar.
 *
 * Esta tela só reorganiza o que a leitura automática já gravou. Não decide
 * classe de crédito nem estratégia, e diz de frente o que NÃO leu (PDF
 * digitalizado, falta de modelo de IA).
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { anel } from '../fx.js';
import { dataHoraBR, html, icone, ouvir, raw, relativo } from '../util.js';
import { erroDe, formulario, toast, vazio } from '../ui.js';
import { aoSair } from '../shell.js';
import { abrirAnalises } from './projeto_extra.js';
import { secaoRaioX } from './projeto_raiox.js';
import { gerarComProgresso, secaoRelatorio } from './projeto_diag_relatorio.js';
import { secaoSocios } from './projeto_socios.js';

const SEGMENTOS = [['', 'Segmento não informado'], ['transportadora', 'Transportadora'], ['industria', 'Indústria'], ['comercio', 'Comércio'], ['servicos', 'Serviços'], ['agronegocio', 'Agronegócio'], ['construcao', 'Construção'], ['saude', 'Saúde'], ['outro', 'Outro']];

const ESTADO = { na_fila: 'Na fila', lendo: 'Lendo agora', analisado: 'Lido e organizado', sem_texto: 'Sem texto legível', erro: 'Falhou', sem_registro: 'Não lido' };
const TOM = { erro: 'erro', aviso: 'aviso', info: 'info' };
const ICONE_PONTO = { erro: 'alert', aviso: 'flag', info: 'sparkle' };

export async function abaDiagnostico(ctx) {
  const falha = (nome) => (e) => ({ html: html`<p class="selo erro">${nome} indisponível: ${e.message}</p>`, depois() {} });
  const [d, ia, rx, rel, soc] = await Promise.all([api.get(`/api/projetos/${ctx.id}/diagnostico`), api.get('/api/ia/estado').catch(() => null),
    secaoRaioX(ctx).catch((e) => html`<p class="selo erro">Raio X indisponível: ${e.message}</p>`), secaoRelatorio(ctx).catch(falha('Relatório')), secaoSocios(ctx).catch(falha('Patrimônio dos sócios'))]);
  const c = d.cobertura; const total = d.documentos.length;
  const andamento = d.documentos.filter((x) => x.estado === 'na_fila' || x.estado === 'lendo').length;
  const pctEnviado = c.obrigatorios ? Math.round((c.enviados / c.obrigatorios) * 100) : 0;
  const pctAprov = c.obrigatorios ? Math.round((c.aprovados / c.obrigatorios) * 100) : 0;
  const escreve = pode('analise.executar');

  return {
    html: html`
      <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Diagnóstico inicial</h2>
        <p class="card__sub">Gerado a partir do que o cliente enviou · ${dataHoraBR(d.geradoEm)}</p></div>
        ${andamento ? html`<span class="leitura lendo"><i class="vivo ambar"></i>Lendo ${andamento} documento(s)…</span>` : html`<span class="leitura analisado">${icone('check')}Leitura em dia</span>`}
        ${escreve ? html`<div class="nx-acts diag-ctrl"><select class="select" data-segmento aria-label="Segmento do cliente">${SEGMENTOS.map(([v, t]) => html`<option value="${v}" ${(ctx.h.segmento ?? '') === v ? 'selected' : ''}>${t}</option>`)}</select>
          <select class="select" data-posicao aria-label="Posição do cliente"><option value="devedor" ${ctx.h.posicaoCliente !== 'credor' ? 'selected' : ''}>NGA atua pelo devedor</option><option value="credor" ${ctx.h.posicaoCliente === 'credor' ? 'selected' : ''}>NGA atua pelo credor</option></select>
          <button type="button" class="btn btn--accent" data-gerar>${icone('sparkle')}Gerar diagnóstico</button></div>` : ''}</header>
        <div class="diag-hero">
          <span class="pring" style="--s:132px">${raw(anel(pctEnviado, { tam: 132, traco: 10, cor: 'var(--lab-amber)' }))}<b class="pring__val" style="font-size:28px">${c.obrigatorios ? `${pctEnviado}%` : '—'}</b></span>
          <div>
            <p style="margin:0 0 6px;font-size:16px;line-height:1.5">${c.obrigatorios
              ? html`O cliente já enviou <b>${c.enviados} de ${c.obrigatorios}</b> documentos obrigatórios (${pctAprov}% aprovados). ${total} arquivo(s) no total, ${d.estados.analisado} lido(s) e organizado(s) automaticamente.`
              : html`O checklist ainda não foi gerado. Gere-o na aba <b>Portal do cliente</b> para o cliente saber o que enviar.`}</p>
            <div class="flex">${ia?.disponivel ? html`<span class="selo ok"><i></i>Leitura por IA ativa</span>` : html`<span class="selo aviso" title="${ia?.impedimento ?? ''}"><i></i>Sem leitura por IA — análise determinística</span>`}
              ${d.estados.sem_texto ? html`<span class="selo info">${d.estados.sem_texto} sem texto (precisa OCR)</span>` : ''}</div>
            <p class="dica" style="margin:10px 0 0">A leitura reconhece o tipo do documento, confere CNPJ/CPF e valores, audita citações legais e isola qualquer trecho que tente dar ordens ao sistema. Nada daqui decide classe de crédito: isso continua sendo ato seu.</p>
          </div></div></section>

      <div class="grid2 mt diag-topo">
          <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Pontos de atenção</h2><p class="card__sub">O que merece o seu olhar primeiro</p></div></header>
            ${d.pontos.length ? html`<ul class="lista">${d.pontos.map((p) => html`<li ${p.aba ? raw(`data-aba-ir="${p.aba}" style="cursor:pointer"`) : ''}><span class="empty__ico" style="width:38px;height:38px;border-radius:12px">${icone(ICONE_PONTO[p.tom])}</span>
              <div><b>${p.titulo}</b><small>${p.detalhe}</small></div><div class="fim"><span class="selo ${TOM[p.tom]}">${p.tom === 'erro' ? 'urgente' : p.tom === 'aviso' ? 'atenção' : 'nota'}</span></div></li>`)}</ul>`
              : vazio('check', total ? 'Nenhum ponto de atenção' : 'Aguardando os primeiros documentos', total ? 'A leitura não encontrou inconsistência nem item crítico.' : 'Quando o cliente enviar documentos, o diagnóstico se monta aqui sozinho.')}</section>

          <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Cobertura por categoria</h2></div></header>
            ${c.porCategoria.length ? c.porCategoria.map((k) => html`<div class="cat-row"><span>${k.categoria}</span>
              <div class="fase-card__bar"><i data-w="${k.total ? Math.round((k.enviados / k.total) * 100) : 0}" style="width:0;transition:width 1.1s var(--ease)"></i></div>
              <span class="mono-sm">${k.enviados}/${k.total}</span></div>`) : html`<p class="dica">Sem checklist.</p>`}</section>

      </div>
      <div class="mt"></div>${rel.html}<div class="mt"></div>${soc.html}<div class="mt"></div>${rx}
      <div class="grid-hub mt">
        <div style="display:grid;gap:var(--gap)">
          <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Documentos recebidos</h2><p class="card__sub">Cada um é lido assim que chega</p></div></header>
            ${total ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Documento</th><th>Reconhecido como</th><th>Leitura</th><th class="num">Achados</th><th></th></tr></thead><tbody>
              ${d.documentos.map((x) => html`<tr><td><b>${x.titulo}</b><small>${x.requisito ? `item: ${x.requisito}` : 'sem item do checklist'} · ${relativo(x.enviadoEm)}</small></td>
                <td>${x.rotuloDoTipo ? html`${x.rotuloDoTipo}<small>${x.tipoValidado ? 'tipo validado por pessoa' : `certeza ${x.certeza ?? '—'} · sugerido`}</small>` : html`<span class="muted">—</span>`}</td>
                <td><span class="leitura ${x.estado}" title="${x.detalhe ?? ''}">${x.estado === 'lendo' || x.estado === 'na_fila' ? html`<i class="vivo ambar"></i>` : ''}${ESTADO[x.estado]}</span></td>
                <td class="num">${x.achados ? html`${x.achados}${x.criticos ? html` <span class="selo erro">${x.criticos} crít.</span>` : ''}` : '—'}</td>
                <td class="num"><div class="flex" style="justify-content:flex-end">${x.semItem && x.sugestoes.length && pode('projeto.escrever') ? html`<button type="button" class="btn btn--accent" data-vincular="${x.id}">Vincular</button>` : ''}<button type="button" class="btn btn--ghost" data-abrir="${x.id}" data-t="${x.titulo}">Abrir</button>
                  ${escreve && ['sem_texto', 'erro', 'sem_registro'].includes(x.estado) ? html`<button type="button" class="ibtn ibtn--sm" data-reler="${x.id}" title="Ler de novo" aria-label="Ler de novo">${icone('refresh')}</button>` : ''}</div></td></tr>`)}</tbody></table></div>`
              : html`<p class="dica">Nenhum documento recebido ainda.</p>`}</section>

        </div>

        <div style="display:grid;gap:var(--gap)">
          ${d.faltando.length ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Ainda falta</h2><p class="card__sub">${d.faltando.length} obrigatório(s)</p></div><button class="link" data-aba-ir="portal">Portal →</button></header>
            <ul class="lista">${d.faltando.slice(0, 8).map((f) => html`<li><div><b>${f.titulo}</b><small>${f.categoria}${f.fundamento ? ` · ${f.fundamento}` : ''}</small></div></li>`)}</ul></section>` : ''}

          ${d.identificadores.length ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Quem aparece nos documentos</h2><p class="card__sub">Dígito verificador conferido</p></div></header>
            <div>${d.identificadores.map((i) => html`<span class="idchip ${i.valido ? 'ok' : 'bad'}" title="${i.documentos.join(' · ')}"><small>${i.tipo}</small>${i.bruto}${i.valido ? '' : ' ✗'}<small>${i.documentos.length}×</small></span>`)}</div></section>` : ''}

          ${d.conferencias.length ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Conferência de enquadramento</h2><p class="card__sub">O arquivo não parece combinar com o item</p></div></header>
            <ul class="lista">${d.conferencias.map((x) => html`<li><div><b>${x.documento}</b><small>parece ${x.parece.toLowerCase()} · enviado como “${x.enviadoComo}” (${x.categoria})</small></div></li>`)}</ul></section>` : ''}
        </div></div>`,

    depois(el) {
      rel.depois(el); soc.depois(el);
      ouvir(el, 'click', '[data-gerar]', (b) => gerarComProgresso(ctx, b));
      ouvir(el, 'change', '[data-posicao]', async (x) => { try { await api.patch(`/api/projetos/${ctx.id}/dados-do-cliente`, { posicaoCliente: x.value }); ctx.h.posicaoCliente = x.value; toast('Posição do cliente salva'); } catch (e) { erroDe(e); } });
      ouvir(el, 'change', '[data-segmento]', async (x) => { try { await api.patch(`/api/projetos/${ctx.id}/dados-do-cliente`, { segmento: x.value || null }); ctx.h.segmento = x.value || null; toast('Segmento salvo'); ctx.recarregar(); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-aba-ir]', (b) => ctx.irParaAba(b.dataset.abaIr));
      ouvir(el, 'click', '[data-ler-todos]', async (b) => {
        const fila = d.documentos.filter((x) => x.estado === 'sem_registro'); let feitos = 0;
        b.disabled = true;
        for (const x of fila) { b.textContent = `Lendo ${++feitos} de ${fila.length}…`; try { await api.post(`/api/documentos/${x.id}/reprocessamento`, {}); } catch { /* segue para o próximo */ } }
        toast(`${fila.length} documento(s) processado(s)`); ctx.recarregar();
      });
      ouvir(el, 'click', '[data-vincular]', async (b) => {
        const doc = d.documentos.find((x) => x.id === b.dataset.vincular);
        const ok = await formulario({
          titulo: 'Vincular ao checklist', subtitulo: `${doc.titulo} — reconhecido como ${doc.rotuloDoTipo ?? 'tipo desconhecido'}`, rotulo: 'Vincular e marcar como enviado',
          campos: [{ nome: 'requisitoId', rotulo: 'Item do checklist (sugeridos pelo tipo)', tipo: 'select', obrigatorio: true, opcoes: doc.sugestoes.map((q) => ({ v: q.id, t: `${q.categoria} · ${q.titulo}` })) }],
          async enviar(v) { await api.post(`/api/requisitos/${v.requisitoId}/vinculo`, { documentoId: doc.id }); toast('Documento vinculado ao item'); },
        });
        if (ok) ctx.recarregar();
      });
      ouvir(el, 'click', '[data-abrir]', (b) => abrirAnalises(b.dataset.abrir, b.dataset.t, ctx));
      ouvir(el, 'click', '[data-reler]', async (b) => {
        b.disabled = true;
        try { const r = await api.post(`/api/documentos/${b.dataset.reler}/reprocessamento`, {}); toast(r.estado === 'analisado' ? 'Documento lido e organizado' : `Resultado: ${ESTADO[r.estado] ?? r.estado}`, r.estado === 'analisado' ? 'ok' : 'aviso'); ctx.recarregar(); }
        catch (e) { b.disabled = false; erroDe(e); }
      });
      if (andamento) {
        const t = setInterval(async () => {
          if (ctx.aba !== 'diagnostico' || !el.isConnected) return clearInterval(t);
          try { const n = await api.get(`/api/projetos/${ctx.id}/diagnostico`); if (n.documentos.filter((x) => x.estado === 'na_fila' || x.estado === 'lendo').length !== andamento) { clearInterval(t); ctx.recarregar(); } } catch { /* tenta no próximo ciclo */ }
        }, 3000);
        aoSair(() => clearInterval(t));
      }
    },
  };
}
