/**
 * Conferência diária Astrea × Nexus (publicações e prazos) e o vínculo dos processos aos projetos.
 * Mostrado no topo da Controladoria: o que diverge aparece primeiro, com o caminho para resolver.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, html, icone, relativo } from '../util.js';
import { erroDe, modal, toast } from '../ui.js';

const pct = (v) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')}%`);
const brDeIso = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

export async function montarConferencia(caixa) {
  let c;
  try { c = await api.get('/api/controladoria/conferencia'); } catch (e) { caixa.innerHTML = String(html`<p class="selo erro">Conferência indisponível: ${e.message}</p>`); return; }
  const p = c.prazos; const d = c.detalheDia;
  const problemas = p.dataDiferente.length + p.soAstrea.length + (d ? d.soAstrea.length + d.soNexus.length : 0);
  const tom = problemas ? 'aviso' : 'ok';
  caixa.innerHTML = String(html`<section class="card glass up mt conf-ctrl"><header class="card__head"><div><h2 class="card__title">Conferência Astrea × Nexus</h2>
      <p class="card__sub">Prazos do Astrea recebidos ${c.ultimaCargaPrazos ? relativo(c.ultimaCargaPrazos) : 'nunca'} · publicações do Astrea recebidas ${c.ultimaCargaPublicacoes ? relativo(c.ultimaCargaPublicacoes) : 'nunca'}</p></div>
      <span class="selo ${tom}">${problemas ? `${problemas} divergência(s)` : 'tudo igual'}</span></header>
    <div class="kpis">
      <div class="kpi card glass ${p.concordancia !== null && p.concordancia < 95 ? 'alerta' : ''}"><small>Prazos iguais (próx. 30 dias)</small><b>${pct(p.concordancia)}</b><small>${p.iguais} de ${p.astrea - p.semNumero} com número</small></div>
      <div class="kpi card glass ${p.dataDiferente.length ? 'alerta' : ''}"><small>Mesmo processo, data diferente</small><b>${p.dataDiferente.length}</b></div>
      <div class="kpi card glass ${p.soAstrea.length ? 'alerta' : ''}"><small>Prazo só no Astrea</small><b>${p.soAstrea.length}</b></div>
      <div class="kpi card glass"><small>Prazo só no Nexus</small><b>${p.soNexus.length}</b></div>
      ${d ? html`<div class="kpi card glass ${d.soAstrea.length ? 'alerta' : ''}"><small>Publicações ${brDeIso(d.dia)}: só no Astrea</small><b>${d.soAstrea.length}</b><small>${d.emAmbos} nos dois</small></div>` : ''}</div>
    ${p.dataDiferente.length ? html`<h3 class="mini-h">Datas diferentes (o mais urgente)</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Processo</th><th>Providência no Astrea</th><th>Astrea</th><th>Nexus</th><th>Responsável</th></tr></thead><tbody>${p.dataDiferente.slice(0, 20).map((x) => html`<tr><td class="mono-sm">${x.astrea.numero}</td><td>${x.astrea.titulo}<small>${x.nexus.titulo}</small></td><td>${x.astrea.data}</td><td>${dataBR(x.nexus.vencimento)}</td><td>${x.astrea.resp}</td></tr>`)}</tbody></table></div>` : ''}
    <details class="mt"><summary class="link">Ver listas completas</summary>
      ${p.soAstrea.length ? html`<h3 class="mini-h">Prazos só no Astrea (${p.soAstrea.length})</h3><ul class="lista">${p.soAstrea.slice(0, 50).map((x) => html`<li><div><b>${x.titulo}</b><small class="mono-sm">${x.numero} · vence ${x.data} · ${x.resp}</small></div></li>`)}</ul>` : ''}
      ${p.soNexus.length ? html`<h3 class="mini-h">Prazos só no Nexus (${p.soNexus.length})</h3><ul class="lista">${p.soNexus.slice(0, 50).map((x) => html`<li><div><b>${x.titulo}</b><small class="mono-sm">${x.numero} · vence ${dataBR(x.vencimento)}${x.projeto ? ` · ${x.projeto}` : ''}</small></div></li>`)}</ul>` : ''}
      ${d?.soAstrea.length ? html`<h3 class="mini-h">Publicações só no Astrea em ${brDeIso(d.dia)}</h3><ul class="lista">${d.soAstrea.map((x) => html`<li><div><b class="mono-sm">${x.numero || 'sem número'}</b><small>${x.orgao ?? ''} ${x.resumo ?? ''}</small></div></li>`)}</ul>` : ''}
      ${d?.soNexus.length ? html`<h3 class="mini-h">Publicações só no Nexus (DJEN) em ${brDeIso(d.dia)}</h3><ul class="lista">${d.soNexus.map((x) => html`<li><div><b class="mono-sm">${x.numero || 'sem número'}</b><small>${x.orgao ?? ''} · ${x.tipo ?? ''}</small></div></li>`)}</ul>` : ''}
      ${c.dias.length ? html`<h3 class="mini-h">Histórico da conferência de publicações</h3><table class="tbl"><thead><tr><th>Dia</th><th class="num">Astrea</th><th class="num">Nexus</th><th class="num">Nos dois</th><th class="num">Só Astrea</th><th class="num">Só Nexus</th></tr></thead><tbody>${c.dias.map((x) => html`<tr><td>${brDeIso(x.dia)}</td><td class="num">${x.astrea}</td><td class="num">${x.nexus}</td><td class="num">${x.emAmbos}</td><td class="num">${x.soAstrea}</td><td class="num">${x.soNexus}</td></tr>`)}</tbody></table>` : html`<p class="dica">As publicações do Astrea chegam pela automação diária (Passo de envio ao Nexus). Sem elas, a conferência compara só os prazos.</p>`}
    </details></section>`);
}

/** Botão "Vincular processos aos projetos": simula, mostra o resultado e só aplica com confirmação. */
export async function vincularProcessos() {
  if (!pode('controladoria.gerir')) return;
  let sim;
  try { sim = await api.post('/api/controladoria/vinculo-projetos', { aplicar: false }); } catch (e) { erroDe(e); return; }
  const total = sim.processosPeloAstrea + sim.processosPeloCnpj;
  await modal({ titulo: 'Vincular processos aos projetos', subtitulo: `${sim.processos} processo(s) na base · ${sim.semProjeto} ainda sem projeto depois desta rodada`, largo: true,
    acoes: [{ id: 'fechar', rotulo: 'Fechar' }, ...(total || sim.registrosPeloNome ? [{ id: 'aplicar', rotulo: `Vincular ${total} processo(s)`, tipo: 'primario' }] : [])],
    corpo: String(html`<ul class="lista">
      <li><span class="selo ${sim.processosPeloAstrea ? 'ok' : ''}">${sim.processosPeloAstrea}</span><div><b>Pela etiqueta ou nome do cliente no Astrea</b><small>${sim.registrosPeloNome} registro(s) sem etiqueta herdam o projeto do mesmo cliente</small></div></li>
      <li><span class="selo ${sim.processosPeloCnpj ? 'ok' : ''}">${sim.processosPeloCnpj}</span><div><b>Pelo CNPJ do cliente nas partes do processo</b><small>só quando o CNPJ pertence a um único projeto</small></div></li>
      <li><span class="selo ${sim.publicacoes.semProjeto ? 'aviso' : 'ok'}">${sim.publicacoes.vinculadasAoProcesso}</span><div><b>Publicações ligadas ao processo</b><small>${sim.publicacoes.semProcesso} sem processo cadastrado · ${sim.publicacoes.semProjeto} com processo sem projeto</small></div></li></ul>
      ${sim.amostraSemProjeto.length ? html`<h3 class="mini-h">Ainda sem projeto (vincule na aba Processos do projeto ou pelo cliente)</h3><ul class="lista">${sim.amostraSemProjeto.slice(0, 30).map((x) => html`<li><div><b class="mono-sm">${x.numero}</b><small>${x.cliente ?? 'cliente desconhecido'}${x.titulo ? ` · ${x.titulo}` : ''}${x.classe ? ` · ${x.classe}` : ''}</small></div></li>`)}</ul>` : ''}`),
    aoAbrir(m) {
      m.addEventListener('acao', async (e) => {
        if (e.detail.id !== 'aplicar') return m.fechar(true);
        try { const r = await api.post('/api/controladoria/vinculo-projetos', { aplicar: true }); toast(`${r.processosPeloAstrea + r.processosPeloCnpj} processo(s) vinculado(s) · ${r.semProjeto} ainda sem projeto`); m.fechar(true); }
        catch (er) { erroDe(er); }
      });
    } });
  void icone;
}
