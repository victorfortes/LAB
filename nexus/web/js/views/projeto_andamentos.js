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
  // Linha do tempo SEPARADA POR PROCESSO: cada processo tem a sua própria trilha, do andamento mais
  // recente para o mais antigo; anotações sem processo vão para "Geral do projeto".
  const ordemProc = new Map(d.processos.map((p, i) => [p.id, i]));
  const metaProc = new Map(d.processos.map((p) => [p.id, p]));
  const grupos = new Map();
  for (const x of d.itens) {
    const k = x.processoId ?? '__geral__';
    if (!grupos.has(k)) grupos.set(k, { processoId: x.processoId, numero: x.processo, itens: [] });
    grupos.get(k).itens.push(x);
  }
  const gruposOrdenados = [...grupos.values()].sort((a, b) =>
    !a.processoId ? 1 : !b.processoId ? -1 : (ordemProc.get(a.processoId) ?? 1e9) - (ordemProc.get(b.processoId) ?? 1e9));
  const nProc = gruposOrdenados.filter((g) => g.processoId).length;
  const hora = (d) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  // Estado honesto: DataJud instável não é "falhou" — o processo volta sozinho na próxima rodada.
  const statusProc = (p) => p.instavel ? ['aviso', 'DataJud instável'] : p.erro ? ['erro', 'falhou'] : p.encontrado ? ['ok', 'em dia'] : p.ultimoSucesso ? ['', 'fora do DataJud'] : ['', 'na fila'];
  const detalheProc = (p) => p.instavel ? `o CNJ não respondeu; nova tentativa ${hora(p.proxima)}` : p.erro ? p.erro : p.encontrado ? `consultado ${relativo(p.ultimoSucesso)}` : p.ultimoSucesso ? 'o DataJud não tem este número (segredo de justiça ou tribunal fora da base pública); nova checagem em 7 dias' : `primeira consulta ${p.proxima ? `prevista para ${hora(p.proxima)}` : 'na próxima rodada'}`;
  const nEmDia = d.processos.filter((p) => p.encontrado).length; const nInst = d.processos.filter((p) => p.instavel).length;
  // Item da trilha. O número do processo não se repete aqui porque já está no cabeçalho do grupo.
  const itemLi = (x) => html`<li data-peso="${x.peso}" data-fonte="${x.fonte}"><time>${dataBR(x.data)} · <span class="selo ${FONTE[x.fonte]?.[0] ?? ''}">${FONTE[x.fonte]?.[1] ?? x.fonte}</span>${x.peso !== 'rotina' && x.fonte !== 'manual' ? html` <span class="selo ${PESO[x.peso]}">${x.categoria}</span>` : ''}</time>
      <p><b>${x.titulo}</b></p>${x.conteudo ? html`<p class="dica">${x.conteudo}</p>` : ''}${x.autor && x.fonte === 'manual' ? html`<p class="dica">por ${x.autor}${escreve ? html` · <button class="link" data-apagar="${x.id}">apagar</button>` : ''}</p>` : ''}</li>`;
  return {
    html: html`<div class="grid2 and-topo">
      <section class="card glass up and-resumo"><header class="card__head"><div><h2 class="card__title">Resumo dos últimos andamentos</h2><p class="card__sub">${dataBR(r.periodo.de)} a ${dataBR(r.periodo.ate)} · montado a partir dos movimentos, por regra (sem inventar nada)</p></div>
          <select class="select" data-dias aria-label="Período">${[7, 15, 30, 60, 90].map((n) => html`<option value="${n}" ${n === dias ? 'selected' : ''}>${n} dias</option>`)}</select></header>
        <div class="and-resumo__texto">${r.texto.map((t) => html`<p>${t}</p>`)}</div>
        ${r.destaques.length ? html`<ul class="lista">${r.destaques.slice(0, 6).map((x) => html`<li><span class="selo ${PESO[x.peso]}">${x.categoria}</span><div><b>${x.titulo}</b><small>${dataBR(x.data)}${x.processo ? ` · ${x.processo}` : ''}</small></div></li>`)}</ul>` : ''}
        ${r.processosParados.length ? html`<details class="mt"><summary class="link">${r.processosParados.length} processo(s) parado(s) há mais de 120 dias</summary><ul class="lista">${r.processosParados.map((p) => html`<li><div><b class="mono-sm">${p.processo}</b><small>${p.dias === null ? 'nenhum andamento registrado' : `último andamento em ${dataBR(p.desde)} (${p.dias} dias)`}</small></div></li>`)}</ul></details>` : ''}</section>
      <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Acompanhamento no DataJud</h2><p class="card__sub">Todo processo do projeto é consultado uma vez por dia, sozinho.</p></div>
          ${escreve && d.processos.length ? html`<button class="btn btn--ghost btn--sm" data-atualizar>${icone('refresh')}Buscar agora</button>` : ''}</header>
        ${d.processos.length ? html`<div class="and-saude"><b>${nEmDia}</b> de ${d.processos.length} em dia${nInst ? html` · <span class="selo aviso">${nInst} aguardando o DataJud</span>` : ''}<div class="and-saude__barra"><i style="width:${Math.round((nEmDia / d.processos.length) * 100)}%"></i></div></div>
          <ul class="lista and-procs">${d.processos.map((p) => { const st = statusProc(p); return html`<li><span class="selo ${st[0]}">${st[1]}</span>
            <div><b class="mono-sm">${p.numero}</b>${p.tribunal ? html` <small class="mono-sm">${p.tribunal}</small>` : ''}<small>${p.classe ?? 'classe não informada'} · ${p.movimentos} andamento(s) do tribunal · ${detalheProc(p)}</small></div></li>`; })}</ul>
          ${semConsulta ? html`<p class="dica">${semConsulta} processo(s) ainda não consultado(s): entram na próxima rodada automática.</p>` : ''}`
          : vazio('file', 'Nenhum processo no projeto', 'Cadastre ou vincule processos na aba Processos e prazos (ou pela Controladoria) para acompanhar os andamentos.')}</section></div>
      <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Linha do tempo por processo</h2><p class="card__sub">${d.itens.length} registro(s) em ${nProc} processo(s) · tribunal, diário oficial e anotações da equipe</p></div>
          <div class="nx-acts"><div class="cli-seg" role="group" aria-label="Filtrar"><button type="button" class="is-on" data-f="todos">Todos</button><button type="button" data-f="importantes">Importantes</button><button type="button" data-f="manual">Manuais</button></div>
          ${escreve ? html`<button class="btn btn--accent btn--sm" data-novo>${icone('plus')}Registrar histórico</button>` : ''}</div></header>
        ${d.itens.length ? html`<div class="and-grupos">${gruposOrdenados.map((g) => { const m = g.processoId ? metaProc.get(g.processoId) : null; const st = m ? statusProc(m) : null;
          return html`<details class="and-grupo"><summary class="and-grupo__head"><b class="mono-sm">${g.numero ?? 'Geral do projeto'}</b>${m ? html`<span class="selo ${st[0]}">${st[1]}</span><small>${m.classe ?? 'classe não informada'} · ${m.movimentos} and.${m.ultimoSucesso ? ` · ${relativo(m.ultimoSucesso)}` : ''}</small>` : html`<small>anotações sem processo vinculado</small>`}<span class="and-grupo__n">${g.itens.length}</span></summary>
            <ul class="tl and-tl">${g.itens.map(itemLi)}</ul></details>`; })}</div>`
          : vazio('scale', 'Sem andamentos ainda', 'Assim que o DataJud responder, os movimentos aparecem aqui. Você também pode registrar o histórico à mão.')}</section>`,
    depois(el) {
      ouvir(el, 'change', '[data-dias]', (s) => { sessionStorage.setItem('nx-and-dias', s.value); ctx.recarregar(); });
      // Abre os primeiros processos; os demais ficam recolhidos para a tela não virar uma lista infinita.
      el.querySelectorAll('.and-grupo').forEach((g, i) => { if (i < 4) g.open = true; });
      ouvir(el, 'click', '[data-f]', (b) => {
        el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('is-on', x === b));
        el.querySelectorAll('.and-tl > li').forEach((li) => { li.hidden = b.dataset.f === 'importantes' ? li.dataset.peso === 'rotina' && li.dataset.fonte !== 'manual' : b.dataset.f === 'manual' ? li.dataset.fonte !== 'manual' : false; });
        // Esconde grupos cujos itens foram todos filtrados; abre os que sobraram.
        el.querySelectorAll('.and-grupo').forEach((g) => { const temItem = !!g.querySelector('.and-tl > li:not([hidden])'); g.hidden = !temItem; if (temItem && b.dataset.f !== 'todos') g.open = true; });
      });
      ouvir(el, 'click', '[data-atualizar]', async (b) => {
        b.disabled = true; b.textContent = 'Consultando o DataJud (até 1 min)…';
        try { const r = await api.post(`/api/projetos/${ctx.id}/andamentos/atualizar`, {}); const fila = (r.naFila ?? 0) + (r.adiados ?? 0);
          toast(`${r.consultados} processo(s) atualizado(s), ${r.novos} andamento(s) novo(s)${fila ? ` · ${fila} seguem na fila: o DataJud do CNJ está lento e o sistema tenta de novo sozinho` : ''}`, fila && !r.consultados ? 'aviso' : 'ok'); ctx.recarregar(); }
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
