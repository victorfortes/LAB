/**
 * Andamentos do projeto: o resumo do que aconteceu, a linha do tempo de todos os processos (DataJud,
 * diário oficial, Astrea e registros manuais) e o registro manual de histórico.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, html, icone, ouvir, relativo } from '../util.js';
import { confirmar, erroDe, formulario, toast, vazio } from '../ui.js';

const FONTE = { datajud: ['info', 'DataJud'], manual: ['aviso', 'Manual'], djen: ['ok', 'Diário'], astrea: ['', 'Astrea'] };
const PESO = { decisivo: 'erro', relevante: 'aviso', rotina: '' };

export async function abaAndamentos(ctx) {
  const dias = Number(sessionStorage.getItem('nx-and-dias') ?? 30);
  const d = await api.get(`/api/projetos/${ctx.id}/andamentos?dias=${dias}`);
  const r = d.resumo; const escreve = pode('processo.escrever');
  const semConsulta = d.processos.filter((p) => !p.ultimoSucesso).length;
  return {
    html: html`<div class="grid2 and-topo">
      <section class="card glass up and-resumo"><header class="card__head"><div><h2 class="card__title">Resumo dos últimos andamentos</h2><p class="card__sub">${dataBR(r.periodo.de)} a ${dataBR(r.periodo.ate)} · montado a partir dos movimentos, por regra (sem inventar nada)</p></div>
          <select class="select" data-dias aria-label="Período">${[7, 15, 30, 60, 90].map((n) => html`<option value="${n}" ${n === dias ? 'selected' : ''}>${n} dias</option>`)}</select></header>
        <div class="and-resumo__texto">${r.texto.map((t) => html`<p>${t}</p>`)}</div>
        ${r.destaques.length ? html`<ul class="lista">${r.destaques.slice(0, 6).map((x) => html`<li><span class="selo ${PESO[x.peso]}">${x.categoria}</span><div><b>${x.titulo}</b><small>${dataBR(x.data)}${x.processo ? ` · ${x.processo}` : ''}</small></div></li>`)}</ul>` : ''}
        ${r.processosParados.length ? html`<details class="mt"><summary class="link">${r.processosParados.length} processo(s) parado(s) há mais de 120 dias</summary><ul class="lista">${r.processosParados.map((p) => html`<li><div><b class="mono-sm">${p.processo}</b><small>${p.dias === null ? 'nenhum andamento registrado' : `último andamento em ${dataBR(p.desde)} (${p.dias} dias)`}</small></div></li>`)}</ul></details>` : ''}</section>
      <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Acompanhamento no DataJud</h2><p class="card__sub">Todo processo do projeto é consultado uma vez por dia, sozinho.</p></div>
          ${escreve && d.processos.length ? html`<button class="btn btn--ghost btn--sm" data-atualizar>${icone('refresh')}Buscar agora</button>` : ''}</header>
        ${d.processos.length ? html`<ul class="lista and-procs">${d.processos.map((p) => html`<li><span class="selo ${p.erro ? 'erro' : p.encontrado ? 'ok' : p.ultimoSucesso ? 'aviso' : ''}">${p.erro ? 'falhou' : p.encontrado ? 'encontrado' : p.ultimoSucesso ? 'não achado' : 'na fila'}</span>
            <div><b class="mono-sm">${p.numero}</b><small>${p.classe ?? 'classe não informada'} · ${p.movimentos} andamento(s) do tribunal${p.ultimoSucesso ? ` · consultado ${relativo(p.ultimoSucesso)}` : ''}${p.erro ? ` · ${p.erro}` : ''}</small></div></li>`)}</ul>
          ${semConsulta ? html`<p class="dica">${semConsulta} processo(s) ainda não consultado(s): entram na próxima rodada automática.</p>` : ''}`
          : vazio('file', 'Nenhum processo no projeto', 'Cadastre ou vincule processos na aba Processos e prazos (ou pela Controladoria) para acompanhar os andamentos.')}</section></div>
      <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Linha do tempo</h2><p class="card__sub">${d.itens.length} registro(s) · tribunal, diário oficial e anotações da equipe</p></div>
          <div class="nx-acts"><div class="cli-seg" role="group" aria-label="Filtrar"><button type="button" class="is-on" data-f="todos">Todos</button><button type="button" data-f="importantes">Importantes</button><button type="button" data-f="manual">Manuais</button></div>
          ${escreve ? html`<button class="btn btn--accent btn--sm" data-novo>${icone('plus')}Registrar histórico</button>` : ''}</div></header>
        ${d.itens.length ? html`<ul class="tl and-tl">${d.itens.map((x) => html`<li data-peso="${x.peso}" data-fonte="${x.fonte}"><time>${dataBR(x.data)} · <span class="selo ${FONTE[x.fonte]?.[0] ?? ''}">${FONTE[x.fonte]?.[1] ?? x.fonte}</span>${x.peso !== 'rotina' && x.fonte !== 'manual' ? html` <span class="selo ${PESO[x.peso]}">${x.categoria}</span>` : ''}</time>
            <p><b>${x.titulo}</b>${x.processo ? html` <small class="mono-sm">${x.processo}</small>` : html` <small>projeto</small>`}</p>${x.conteudo ? html`<p class="dica">${x.conteudo}</p>` : ''}
            ${x.autor && x.fonte === 'manual' ? html`<p class="dica">por ${x.autor}${escreve ? html` · <button class="link" data-apagar="${x.id}">apagar</button>` : ''}</p>` : ''}</li>`)}</ul>`
          : vazio('scale', 'Sem andamentos ainda', 'Assim que o DataJud responder, os movimentos aparecem aqui. Você também pode registrar o histórico à mão.')}</section>`,
    depois(el) {
      ouvir(el, 'change', '[data-dias]', (s) => { sessionStorage.setItem('nx-and-dias', s.value); ctx.recarregar(); });
      ouvir(el, 'click', '[data-f]', (b) => {
        el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('is-on', x === b));
        el.querySelectorAll('.and-tl > li').forEach((li) => { li.hidden = b.dataset.f === 'importantes' ? li.dataset.peso === 'rotina' && li.dataset.fonte !== 'manual' : b.dataset.f === 'manual' ? li.dataset.fonte !== 'manual' : false; });
      });
      ouvir(el, 'click', '[data-atualizar]', async (b) => {
        b.disabled = true; b.textContent = 'Consultando o DataJud (até 1 min)…';
        try { const r = await api.post(`/api/projetos/${ctx.id}/andamentos/atualizar`, {}); toast(`${r.consultados} processo(s) consultado(s), ${r.novos} andamento(s) novo(s)${r.naFila ? ` · ${r.naFila} na fila (próximos minutos)` : ''}${r.erros.length ? ` · ${r.erros.length} falha(s)` : ''}`, r.erros.length ? 'aviso' : 'ok'); ctx.recarregar(); }
        catch (e) { erroDe(e); b.disabled = false; }
      });
      ouvir(el, 'click', '[data-novo]', async () => {
        const ok = await formulario({ titulo: 'Registrar histórico', subtitulo: 'Reunião, negociação, diligência, protocolo… Sem processo, fica no histórico do projeto.', rotulo: 'Registrar', largo: true, campos: [
          { nome: 'data', rotulo: 'Data', tipo: 'date', valor: new Date().toLocaleDateString('sv-SE'), obrigatorio: true, metade: true },
          { nome: 'processoId', rotulo: 'Processo', tipo: 'select', valor: '', metade: true, opcoes: [{ v: '', t: 'Geral do projeto' }, ...d.processos.map((p) => ({ v: p.id, t: p.numero }))] },
          { nome: 'titulo', rotulo: 'O que aconteceu', obrigatorio: true, placeholder: 'Reunião com o credor Banco X: proposta de deságio de 40%' },
          { nome: 'texto', rotulo: 'Detalhes', tipo: 'textarea' }],
          async enviar(v) { await api.post(`/api/projetos/${ctx.id}/andamentos`, { data: v.data, titulo: v.titulo, texto: v.texto, processoId: v.processoId || null }); } });
        if (ok) { toast('Histórico registrado'); ctx.recarregar(); }
      });
      ouvir(el, 'click', '[data-apagar]', async (b) => {
        if (!(await confirmar('Apagar este registro?', 'Só registros manuais podem ser apagados.', { rotulo: 'Apagar', perigo: true }))) return;
        try { await api.del(`/api/historicos/${b.dataset.apagar}`); ctx.recarregar(); } catch (e) { erroDe(e); }
      });
    },
  };
}
