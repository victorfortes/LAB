/**
 * Controladoria → "Agendar em lote": cada publicação sem prazo chega com o lançamento sugerido no padrão do
 * escritório (título "AÇÃO - ATO", dias, regime e fundamento) e com o responsável de quem lança aquele processo
 * no Astrea. A controladoria ajusta o que precisar e confirma várias de uma vez (validação prévia).
 * Também: direcionar a agenda do Astrea em tarefas por responsável e ver o catálogo de padrões.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, html, icone, plural, raw } from '../util.js';
import { erroDe, modal, toast } from '../ui.js';

const mascara = (d) => { const x = String(d ?? '').replace(/\D/g, ''); return x.length === 20 ? `${x.slice(0, 7)}-${x.slice(7, 9)}.${x.slice(9, 13)}.${x.slice(13, 14)}.${x.slice(14, 16)}.${x.slice(16)}` : d ?? ''; };
const tomConf = (c) => (c >= 0.8 ? 'ok' : c >= 0.6 ? 'info' : 'aviso');

export async function montarLote(alvo, aoConcluir) {
  if (!alvo) return;
  const gere = pode('controladoria.gerir');
  let f;
  try { f = await api.get('/api/controladoria/sugestoes'); } catch (e) { alvo.innerHTML = ''; return; }
  const linha = (i) => html`<tr data-lote-item="${i.id}" class="${i.pronto ? '' : 'is-off'}">
    <td>${gere && i.pronto ? html`<input type="checkbox" data-lote-sel="${i.id}" ${i.sugestao.confianca >= 0.8 ? raw('data-alta') : ''} aria-label="Selecionar">` : ''}</td>
    <td><span class="mono-sm">${dataBR(i.data)}</span><small>${i.tribunal ?? ''}</small></td>
    <td><span class="mono-sm">${mascara(i.numero)}</span><small>${i.projeto ?? html`<span class="selo aviso">sem projeto</span>`}</small></td>
    <td class="cl-titulo"><input class="input input--sm" data-campo="titulo" value="${i.sugestao.titulo}" ${gere ? '' : raw('disabled')} maxlength="200">
      <small title="${i.sugestao.fundamento}">${i.sugestao.fundamento}${i.sugestao.usosNoEscritorio ? ` · usado ${i.sugestao.usosNoEscritorio}× no Astrea` : ''}${i.sugestao.observacao ? ` · ${i.sugestao.observacao}` : ''}</small>
      <details class="cl-texto"><summary>ver publicação</summary><p>${i.resumo}</p></details></td>
    <td class="num"><input class="input input--sm cl-dias" type="number" min="1" max="365" data-campo="dias" value="${i.sugestao.dias}" ${gere ? '' : raw('disabled')}></td>
    <td><select class="select select--sm" data-campo="regime" ${gere ? '' : raw('disabled')}><option value="uteis" ${i.sugestao.regime === 'uteis' ? raw('selected') : ''}>úteis</option><option value="corridos" ${i.sugestao.regime === 'corridos' ? raw('selected') : ''}>corridos</option></select></td>
    <td>${i.responsavel ? html`<b class="cl-resp">${i.responsavel.nome}</b><small>${i.responsavel.origem === 'astrea' ? 'quem lança no Astrea' : 'responsável do projeto'}</small>` : html`<small>${i.responsavelAstrea ? `${i.responsavelAstrea} (sem cadastro no LAB)` : 'sem sugestão'}</small>`}</td>
    <td><span class="selo ${tomConf(i.sugestao.confianca)}">${Math.round(i.sugestao.confianca * 100)}%</span></td></tr>`;
  alvo.innerHTML = String(html`<section class="card glass mt cl-lote">
    <header class="card__head"><div><h2 class="card__title">Agendar em lote</h2>
      <p class="card__sub">Lançamento sugerido no padrão do escritório e responsável de quem lança o processo no Astrea. Confira e confirme: cada confirmação vira prazo e tarefa. Em recuperação e falência a contagem é em dias corridos (art. 189, § 1º, I, Lei 11.101).</p></div>
      <div class="nx-acts"><button class="btn btn--ghost btn--sm" type="button" data-padroes>${icone('chart')}Padrões do escritório</button>${gere ? html`<button class="btn btn--ghost btn--sm" type="button" data-direcionar>${icone('users')}Direcionar agenda do Astrea</button>` : ''}</div></header>
    <div class="cl-resumo"><span><b>${f.resumo.total}</b> sem prazo</span><span><b>${f.resumo.prontos}</b> prontas para agendar</span><span><b>${f.resumo.altaConfianca}</b> com confiança alta</span>${f.resumo.semProjeto ? html`<span class="selo aviso">${plural(f.resumo.semProjeto, 'publicação sem projeto', 'publicações sem projeto')}: vincule o processo para liberar</span>` : ''}</div>
    ${f.itens.length ? html`${gere ? html`<div class="flex mt"><button class="btn btn--ghost btn--sm" type="button" data-sel-alta>Selecionar confiança alta</button><button class="btn btn--ghost btn--sm" type="button" data-sel-nenhuma>Limpar seleção</button><span class="grow"></span><span class="dica" data-lote-n>0 selecionadas</span><button class="btn btn--accent" type="button" data-lote-confirmar disabled>${icone('check')}Confirmar e agendar</button></div>` : ''}
      <div class="tbl-wrap mt"><table class="tbl cl-tabela"><thead><tr><th></th><th>Data</th><th>Processo</th><th>Lançamento sugerido</th><th class="num">Dias</th><th>Regime</th><th>Responsável</th><th>Confiança</th></tr></thead>
      <tbody>${f.itens.map(linha)}</tbody></table></div>` : html`<p class="dica mt">Nenhuma publicação esperando agendamento.</p>`}
  </section>`);
  const marcados = () => [...alvo.querySelectorAll('[data-lote-sel]:checked')];
  const contar = () => { const n = marcados().length; const c = alvo.querySelector('[data-lote-n]'); if (c) c.textContent = `${n} selecionada(s)`; const b = alvo.querySelector('[data-lote-confirmar]'); if (b) b.disabled = !n; };
  alvo.addEventListener('change', (e) => { if (e.target.matches('[data-lote-sel]')) contar(); });
  alvo.querySelector('[data-sel-alta]')?.addEventListener('click', () => { alvo.querySelectorAll('[data-lote-sel]').forEach((c) => { c.checked = c.hasAttribute('data-alta'); }); contar(); });
  alvo.querySelector('[data-sel-nenhuma]')?.addEventListener('click', () => { alvo.querySelectorAll('[data-lote-sel]').forEach((c) => { c.checked = false; }); contar(); });
  alvo.querySelector('[data-lote-confirmar]')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    const itens = marcados().map((c) => {
      const tr = c.closest('tr'); const it = f.itens.find((x) => x.id === c.dataset.loteSel);
      return { publicacaoId: it.id, titulo: tr.querySelector('[data-campo=titulo]').value.trim(), dias: Number(tr.querySelector('[data-campo=dias]').value), regime: tr.querySelector('[data-campo=regime]').value, responsavelId: it.responsavel?.id ?? null };
    });
    try {
      const r = await api.post('/api/controladoria/sugestoes/confirmar', { itens });
      toast(`${r.confirmados} prazo(s) agendado(s)${r.falhas ? `; ${r.falhas} com erro: ${r.resultados.find((x) => !x.ok)?.erro ?? ''}` : ''}`);
      aoConcluir?.();
    } catch (e) { erroDe(e); b.disabled = false; }
  });
  alvo.querySelector('[data-direcionar]')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try {
      const r = await api.post('/api/controladoria/direcionar', {});
      toast(`Agenda do Astrea: ${r.criadas} tarefa(s) nova(s), ${r.atualizadas} atualizada(s), ${r.concluidas} concluída(s)${r.semProjeto ? `, ${r.semProjeto} sem projeto no LAB` : ''}${r.pessoasSemCadastro.length ? `. Sem cadastro: ${r.pessoasSemCadastro.join(', ')}` : ''}`);
    } catch (e) { erroDe(e); } finally { b.disabled = false; }
  });
  alvo.querySelector('[data-padroes]')?.addEventListener('click', async () => {
    try {
      const p = await api.get('/api/controladoria/padroes');
      await modal({ titulo: 'Padrões de lançamento do escritório', largo: true, corpo: html`<p class="dica">Tirado da agenda do Astrea (base do BI de Prazos). É daqui que vem o título sugerido.</p>
        <div class="row2"><div><h3 class="card__title">Ações mais usadas</h3><ul class="lista">${p.acoes.slice(0, 14).map((a) => html`<li><div><b>${a.acao}</b></div><span class="mono-sm">${a.n}</span></li>`)}</ul></div>
        <div><h3 class="card__title">Responsáveis</h3><ul class="lista">${p.responsaveis.map((r) => html`<li><div><b>${r.resp}</b><small>${r.noLab ? `no LAB: ${r.noLab}` : 'sem cadastro no LAB'}</small></div><span class="mono-sm">${r.abertos} abertos · ${r.n}</span></li>`)}</ul></div></div>
        <h3 class="card__title mt">Títulos</h3><ul class="lista">${p.titulos.map((t) => html`<li><div><b>${t.titulo}</b></div><span class="mono-sm">${t.n}</span></li>`)}</ul>` });
    } catch (e) { erroDe(e); }
  });
}
