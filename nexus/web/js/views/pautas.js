/**
 * Pautas — gestão de reuniões de pauta por cliente. Só administração, sócios e coordenação.
 *
 *  #/pautas            mural de clientes por saúde do acompanhamento (crítico, atenção, em dia)
 *  #/pautas/:projeto   mesa da reunião: itens abertos, decisão item a item, virar tarefa num clique,
 *                      encerrar a reunião (gera a ata do projeto) e histórico.
 */
import { api } from '../api.js';
import { dataBR, guardado, html, icone, ouvir, plural, raw } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, toast, vazio } from '../ui.js';
import { navegar } from '../shell.js';

const CATEGORIAS = { geral: 'Geral', processual: 'Processual', negociacao: 'Negociação', financeiro: 'Financeiro', cliente: 'Cliente', documentos: 'Documentos', estrategia: 'Estratégia' };
const PRIORIDADES = { urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const SITUACOES = { aberto: 'Em aberto', discutido: 'Discutido', encaminhado: 'Virou tarefa', concluido: 'Concluído', descartado: 'Descartado' };
const SAUDE = { critico: ['Precisa de reunião', 'pa-s--critico'], atencao: ['Atenção', 'pa-s--atencao'], ok: ['Em dia', 'pa-s--ok'] };
const hoje = () => new Date().toLocaleDateString('sv-SE');
const opcoes = (o) => Object.entries(o).map(([v, t]) => ({ v, t }));

export default async function pautas({ projeto } = {}) {
  return projeto ? mesa(projeto) : mural();
}

// ------------------------------------------------------------------ mural ---
async function mural() {
  const d = await api.get('/api/pautas');
  const filtro = guardado.ler('pautas.filtro', 'todos');
  const busca = guardado.ler('pautas.busca', '');
  const lista = d.clientes.filter((c) => (filtro === 'todos' || c.saude === filtro) && (!busca || c.nome.toLowerCase().includes(busca.toLowerCase())));
  const ultima = (c) => c.ultima ? (c.diasSemReuniao === 0 ? 'hoje' : `há ${plural(c.diasSemReuniao, 'dia', 'dias')}`) : 'nunca';
  return {
    titulo: 'Pautas',
    html: html`${cabecalho({ titulo: 'Pautas', sub: 'Reuniões de pauta por cliente: o que está acontecendo, o que foi decidido e o que virou tarefa',
      resumo: [{ rotulo: 'Precisam de reunião', valor: d.totais.criticos }, { rotulo: 'Atenção', valor: d.totais.atencao }, { rotulo: 'Itens em aberto', valor: d.totais.itensAbertos }, { rotulo: 'Reuniões na semana', valor: d.totais.reunioesSemana }] })}
      <div class="pa-barra mt up">
        <div class="seg" role="group" aria-label="Filtro">${[['todos', 'Todos'], ['critico', 'Precisam de reunião'], ['atencao', 'Atenção'], ['ok', 'Em dia']].map(([v, t]) => html`<button type="button" class="seg__btn" data-pa-filtro="${v}" aria-pressed="${filtro === v}"><span>${t}</span></button>`)}</div>
        <span class="grow"></span>
        <input class="input pa-busca" type="search" placeholder="Buscar cliente" value="${busca}" data-pa-busca aria-label="Buscar cliente">
      </div>
      ${lista.length ? html`<div class="pa-grade mt">${lista.map((c) => html`<a class="pa-card glass up" href="#/pautas/${c.id}">
          <header><span class="pa-s ${SAUDE[c.saude][1]}">${SAUDE[c.saude][0]}</span><span class="grow"></span>${c.proxima ? html`<span class="pa-prox">${icone('calendar')}${dataBR(c.proxima)}</span>` : ''}</header>
          <h3>${c.nome}</h3>
          <p class="pa-resp">${c.responsavel ?? 'Sem responsável'}</p>
          <dl class="pa-num">
            <div><dt>Itens abertos</dt><dd>${c.abertos}${c.criticos ? html`<small class="pa-alerta"> · ${c.criticos} crítico(s)</small>` : ''}</dd></div>
            <div><dt>Última reunião</dt><dd>${ultima(c)}</dd></div>
            <div><dt>Tarefas</dt><dd>${c.tarefas_abertas}${c.tarefas_atrasadas ? html`<small class="pa-alerta"> · ${c.tarefas_atrasadas} atrasada(s)</small>` : ''}</dd></div>
            <div><dt>Prazos 7 dias</dt><dd>${c.prazos_semana}</dd></div>
          </dl>
          ${c.recorrentes ? html`<p class="pa-rec">${icone('alert')}${plural(c.recorrentes, 'item volta', 'itens voltam')} à pauta pela 3ª vez</p>` : ''}
        </a>`)}</div>` : vazio('calendar', 'Nenhum cliente neste filtro', 'Troque o filtro ou a busca.')}`,
    depois(el) {
      ouvir(el, 'click', '[data-pa-filtro]', (b) => { guardado.gravar('pautas.filtro', b.dataset.paFiltro); navegar(); });
      const campo = el.querySelector('[data-pa-busca]'); let t;
      campo?.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { guardado.gravar('pautas.busca', campo.value.trim()); navegar().then(() => { const c = document.querySelector('[data-pa-busca]'); c?.focus(); c?.setSelectionRange(c.value.length, c.value.length); }); }, 300); });
    },
  };
}

// ------------------------------------------------------------------- mesa ---
async function mesa(projetoId) {
  const d = await api.get(`/api/pautas/projetos/${projetoId}`);
  const reuniao = d.reunioes.find((r) => r.situacao === 'agendada');
  const abertos = d.itens.filter((i) => ['aberto', 'discutido'].includes(i.situacao));
  const resolvidos = d.itens.filter((i) => !['aberto', 'discutido'].includes(i.situacao));
  const pessoas = [{ v: '', t: 'Líder do projeto' }, ...d.equipe.map((p) => ({ v: p.id, t: p.nome }))];

  const cartao = (i) => html`<li class="pa-item pa-item--${i.prioridade}${i.vezesEmPauta >= 3 ? ' is-rec' : ''}" data-id="${i.id}">
    <div class="pa-item__topo"><span class="pa-tag">${CATEGORIAS[i.categoria]}</span><span class="pa-tag pa-tag--${i.prioridade}">${PRIORIDADES[i.prioridade]}</span>
      ${i.vezesEmPauta ? html`<span class="pa-tag pa-tag--rec" title="Quantas reuniões já passou">${i.vezesEmPauta}ª vez em pauta</span>` : ''}<span class="grow"></span>
      <span class="pa-sit pa-sit--${i.situacao}">${SITUACOES[i.situacao]}</span></div>
    <b>${i.titulo}</b>${i.detalhe ? html`<p class="dica">${i.detalhe}</p>` : ''}
    ${i.decisao ? html`<p class="pa-dec"><span>Decisão</span>${i.decisao}</p>` : ''}
    <div class="pa-item__pe"><small>${i.responsavel ? html`${icone('users')}${i.responsavel}` : 'Sem responsável'}${i.tarefaId ? html` · tarefa ${i.tarefaStatus === 'concluida' ? 'concluída' : `até ${i.tarefaPrazo ? dataBR(i.tarefaPrazo) : 's/ prazo'}`}` : ''}</small><span class="grow"></span>
      ${['aberto', 'discutido'].includes(i.situacao) ? html`<button class="btn btn--ghost btn--sm" data-decidir="${i.id}">${icone('comment')}Decisão</button>
        <button class="btn btn--accent btn--sm" data-tarefa="${i.id}">${icone('check')}Virar tarefa</button>
        <button class="btn btn--ghost btn--sm" data-concluir="${i.id}" title="Resolvido sem tarefa">${icone('check')}Resolvido</button>` : html`<button class="btn btn--ghost btn--sm" data-reabrir="${i.id}">Reabrir</button>`}
      <button class="btn btn--ghost btn--sm" data-editar="${i.id}" aria-label="Editar">${icone('list')}</button>
      <button class="btn btn--ghost btn--sm perigo-btn" data-excluir="${i.id}" aria-label="Excluir">${icone('trash')}</button></div></li>`;

  const camposItem = (i = {}) => [
    { nome: 'titulo', rotulo: 'Assunto', obrigatorio: true, valor: i.titulo ?? '', placeholder: 'Ex.: Contraproposta do Banco Alfa' },
    { nome: 'detalhe', rotulo: 'Contexto (opcional)', tipo: 'textarea', valor: i.detalhe ?? '' },
    { nome: 'categoria', rotulo: 'Tema', tipo: 'select', valor: i.categoria ?? 'geral', opcoes: opcoes(CATEGORIAS), metade: true },
    { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', valor: i.prioridade ?? 'media', opcoes: opcoes(PRIORIDADES), metade: true },
    { nome: 'responsavelId', rotulo: 'Quem conduz', tipo: 'select', valor: i.responsavelId ?? '', opcoes: pessoas },
  ];
  const corpoItem = (v) => ({ titulo: v.titulo, detalhe: v.detalhe || null, categoria: v.categoria, prioridade: v.prioridade, responsavelId: v.responsavelId || null });
  const achar = (id) => d.itens.find((x) => x.id === id);

  return {
    titulo: `Pauta · ${d.projeto.nome}`,
    html: html`${cabecalho({ titulo: d.projeto.nome, sub: 'Pauta do cliente',
      acoes: html`<a class="btn btn--ghost" href="#/pautas">${icone('chevron')}Todos os clientes</a><a class="btn btn--ghost" href="#/projetos/${d.projeto.id}">Abrir projeto</a>` })}
      <div class="pa-mesa mt">
        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">${reuniao ? html`${reuniao.titulo} · ${dataBR(reuniao.data)}` : 'Pauta em aberto'}</h2>
            <p class="card__sub">${reuniao ? 'Reunião em andamento: registre a decisão de cada item e encerre para gerar a ata.' : 'Itens que entram na próxima reunião. O que não for resolvido continua aqui.'}</p></div>
            <div class="nx-acts"><button class="btn btn--ghost" data-novo>${icone('plus')}Novo item</button>
            ${reuniao ? html`<button class="btn btn--accent" data-encerrar="${reuniao.id}">${icone('check')}Encerrar e gerar ata</button><button class="btn btn--ghost btn--sm" data-cancelar="${reuniao.id}">Cancelar reunião</button>`
              : html`<button class="btn btn--accent" data-agendar>${icone('calendar')}Agendar reunião</button>`}</div></header>
          ${abertos.length ? html`<ol class="pa-itens">${abertos.map(cartao)}</ol>` : vazio('check', 'Pauta limpa', 'Nenhum assunto em aberto para este cliente.')}
          ${resolvidos.length ? html`<details class="pa-res mt"><summary>${plural(resolvidos.length, 'item resolvido', 'itens resolvidos')}</summary><ol class="pa-itens">${resolvidos.map(cartao)}</ol></details>` : ''}
        </section>
        <aside class="pa-lado">
          <section class="card glass up"><header class="card__head"><h2 class="card__title">Tarefas abertas</h2></header>
            ${d.tarefas.length ? html`<ul class="lista">${d.tarefas.map((t) => html`<li><div><b>${t.titulo}</b><small>${t.responsavel ?? 'sem responsável'}</small></div><span class="mono-sm${t.prazo && t.prazo.slice(0, 10) < hoje() ? ' pa-alerta' : ''}">${t.prazo ? dataBR(t.prazo) : '—'}</span></li>`)}</ul>` : html`<p class="dica">Nenhuma.</p>`}</section>
          <section class="card glass up mt"><header class="card__head"><h2 class="card__title">Prazos (30 dias)</h2></header>
            ${d.prazos.length ? html`<ul class="lista">${d.prazos.map((z) => html`<li><div><b>${z.titulo}</b><small>${z.numero}</small></div><span class="mono-sm">${dataBR(z.vencimento)}</span></li>`)}</ul>` : html`<p class="dica">Nenhum.</p>`}</section>
          <section class="card glass up mt"><header class="card__head"><h2 class="card__title">Reuniões</h2></header>
            ${d.reunioes.length ? html`<ul class="lista">${d.reunioes.map((r) => html`<li><div><b>${r.titulo}</b><small>${{ agendada: 'Agendada', realizada: 'Realizada, ata gerada', cancelada: 'Cancelada' }[r.situacao]} · ${plural(r.itens, 'item', 'itens')}</small></div><span class="mono-sm">${dataBR(r.data)}</span></li>`)}</ul>` : html`<p class="dica">Nenhuma reunião registrada.</p>`}</section>
        </aside>
      </div>`,
    depois(el) {
      const rec = () => navegar();
      ouvir(el, 'click', '[data-novo]', async () => { if (await formulario({ titulo: 'Novo item de pauta', subtitulo: d.projeto.nome, rotulo: 'Incluir', campos: camposItem(), async enviar(v) { await api.post(`/api/pautas/projetos/${projetoId}/itens`, corpoItem(v)); } })) rec(); });
      ouvir(el, 'click', '[data-editar]', async (b) => { const i = achar(b.dataset.editar); if (await formulario({ titulo: 'Editar item', rotulo: 'Salvar', campos: camposItem(i), async enviar(v) { await api.patch(`/api/pautas/itens/${i.id}`, corpoItem(v)); } })) rec(); });
      ouvir(el, 'click', '[data-decidir]', async (b) => {
        const i = achar(b.dataset.decidir);
        const ok = await formulario({ titulo: 'Decisão da reunião', subtitulo: i.titulo, rotulo: 'Registrar', campos: [
          { nome: 'decisao', rotulo: 'O que foi decidido', tipo: 'textarea', obrigatorio: true, valor: i.decisao ?? '' },
          { nome: 'situacao', rotulo: 'Situação', tipo: 'select', valor: 'discutido', opcoes: [{ v: 'discutido', t: 'Discutido, segue em pauta' }, { v: 'concluido', t: 'Resolvido' }, { v: 'descartado', t: 'Descartado' }] }],
          async enviar(v) { await api.patch(`/api/pautas/itens/${i.id}`, { decisao: v.decisao, situacao: v.situacao }); } });
        if (ok) rec();
      });
      ouvir(el, 'click', '[data-tarefa]', async (b) => {
        const i = achar(b.dataset.tarefa);
        const ok = await formulario({ titulo: 'Criar tarefa a partir do item', subtitulo: 'O item fica como encaminhado e a tarefa aparece em Tarefas.', rotulo: 'Criar tarefa', campos: [
          { nome: 'titulo', rotulo: 'Tarefa', obrigatorio: true, valor: i.titulo },
          { nome: 'responsavelId', rotulo: 'Responsável', tipo: 'select', valor: i.responsavelId ?? '', opcoes: pessoas, metade: true },
          { nome: 'prazo', rotulo: 'Prazo', tipo: 'date', metade: true },
          { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', valor: i.prioridade, opcoes: opcoes(PRIORIDADES) }],
          async enviar(v) { await api.post(`/api/pautas/itens/${i.id}/tarefa`, { titulo: v.titulo, responsavelId: v.responsavelId || undefined, prazo: v.prazo || null, prioridade: v.prioridade }); } });
        if (ok) { toast('Tarefa criada'); rec(); }
      });
      ouvir(el, 'click', '[data-concluir]', async (b) => { try { await api.patch(`/api/pautas/itens/${b.dataset.concluir}`, { situacao: 'concluido' }); rec(); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-reabrir]', async (b) => { try { await api.patch(`/api/pautas/itens/${b.dataset.reabrir}`, { situacao: 'aberto' }); rec(); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-excluir]', async (b) => { if (!(await confirmar('Excluir item?', 'O item sai da pauta. Tarefas já criadas permanecem.', { rotulo: 'Excluir', perigo: true }))) return; try { await api.del(`/api/pautas/itens/${b.dataset.excluir}`); rec(); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-agendar]', async () => {
        const ok = await formulario({ titulo: 'Agendar reunião de pauta', subtitulo: `${plural(abertos.length, 'item em aberto entra', 'itens em aberto entram')} automaticamente.`, rotulo: 'Agendar', campos: [
          { nome: 'titulo', rotulo: 'Título', valor: `Reunião de pauta · ${d.projeto.nome}`.slice(0, 200), obrigatorio: true },
          { nome: 'data', rotulo: 'Data', tipo: 'date', valor: hoje(), obrigatorio: true, metade: true },
          { nome: 'participantes', rotulo: 'Participantes', metade: true }],
          async enviar(v) { await api.post(`/api/pautas/projetos/${projetoId}/reunioes`, { titulo: v.titulo, data: v.data, participantes: v.participantes || null }); } });
        if (ok) rec();
      });
      ouvir(el, 'click', '[data-encerrar]', async (b) => {
        let r;
        const ok = await formulario({ titulo: 'Encerrar a reunião', subtitulo: 'Gera a ata do projeto com pauta, decisões e encaminhamentos. O que ficou aberto segue para a próxima.', rotulo: 'Encerrar e gerar ata', campos: [
          { nome: 'resumo', rotulo: 'Resumo geral (opcional)', tipo: 'textarea' },
          { nome: 'participantes', rotulo: 'Participantes', valor: reuniao.participantes ?? '' },
          { nome: 'publicarAta', rotulo: 'Ata visível ao cliente no portal?', tipo: 'select', valor: 'nao', opcoes: [{ v: 'nao', t: 'Não, só interna' }, { v: 'sim', t: 'Sim, publicar no portal' }] }],
          async enviar(v) { r = await api.post(`/api/pautas/reunioes/${b.dataset.encerrar}/encerrar`, { resumo: v.resumo || null, participantes: v.participantes || null, publicarAta: v.publicarAta === 'sim' }); } });
        if (ok) { toast(`Ata gerada: ${plural(r.itens, 'item', 'itens')}, ${r.encaminhados} virou(aram) tarefa`); rec(); }
      });
      ouvir(el, 'click', '[data-cancelar]', async (b) => { if (!(await confirmar('Cancelar a reunião?', 'Os itens voltam para a pauta em aberto.', { rotulo: 'Cancelar reunião', perigo: true }))) return; try { await api.del(`/api/pautas/reunioes/${b.dataset.cancelar}`); rec(); } catch (e) { erroDe(e); } });
    },
  };
}
