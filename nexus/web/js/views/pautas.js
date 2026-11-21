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

export default async function pautas({ projeto, equipe, clientes } = {}) {
  if (equipe) return mesaDaEquipe(equipe);
  if (clientes) return mural();
  return projeto ? mesa(projeto) : muralEquipes();
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const cadenciaTxt = (c) => c ? `Toda ${DIAS[c.diaSemana]}${c.diaSemana === 0 || c.diaSemana === 6 ? '' : '-feira'} às ${c.hora}` : 'Sem dia fixo';
const TIPO_T = { prazo: 'Prazo', tarefa: 'Tarefa', evento: 'Evento', audiencia: 'Audiência', analise: 'Análise' };
const COR_EQ = (n) => [...String(n)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

// ------------------------------------------------------- mural das equipes ---
async function muralEquipes() {
  const d = await api.get('/api/pautas/equipes');
  return {
    titulo: 'Pautas',
    html: html`${cabecalho({ titulo: 'Pautas', sub: 'A reunião semanal de cada equipe, com todos os clientes dela. Tudo o que sai daqui vira tarefa, entra no calendário e vira ata no projeto.',
      acoes: html`<a class="btn btn--ghost" href="#/pautas/clientes">${icone('users')}Ver por cliente</a>`,
      resumo: [{ rotulo: 'Equipes', valor: d.equipes.length }, { rotulo: 'Itens em aberto', valor: d.equipes.reduce((s, e) => s + e.abertos, 0) }, { rotulo: 'Tarefas atrasadas', valor: d.equipes.reduce((s, e) => s + e.atrasadas, 0), tom: 'alert' }, { rotulo: 'Clientes sem equipe', valor: d.semEquipe, tom: d.semEquipe ? 'warn' : 'ok' }] })}
      ${d.equipes.length ? html`<div class="pq-grade mt">${d.equipes.map((e) => html`<a class="pq-card glass up" href="#/pautas/equipe/${encodeURIComponent(e.equipe)}" style="--h:${COR_EQ(e.equipe)}">
          <header><span class="pq-av">${e.equipe.slice(0, 2).toUpperCase()}</span><div><h3>${e.equipe}</h3><small>${cadenciaTxt(e.cadencia)}</small></div></header>
          <div class="pq-prox">${e.proxima ? html`${icone('calendar')}<span>Próxima reunião <b>${dataBR(e.proxima.data)}${e.proxima.hora ? ` · ${e.proxima.hora}` : ''}</b></span>` : html`${icone('calendar')}<span>Nenhuma reunião marcada</span>`}</div>
          <dl class="pq-num"><div><dt>Clientes</dt><dd>${e.clientes}</dd></div><div><dt>Itens abertos</dt><dd>${e.abertos}${e.criticos ? html`<small class="pa-alerta"> · ${e.criticos} crítico(s)</small>` : ''}</dd></div>
            <div><dt>Atrasadas</dt><dd class="${e.atrasadas ? 'pa-alerta' : ''}">${e.atrasadas}</dd></div><div><dt>Vencem em 7 dias</dt><dd>${e.semana}</dd></div></dl>
          <footer>${e.ultima ? `Última reunião em ${dataBR(e.ultima)}` : 'Ainda sem reunião registrada'}<span class="grow"></span><b>Abrir a mesa ${icone('chevron')}</b></footer></a>`)}</div>`
        : html`<section class="card glass up mt">${vazio('users', 'Nenhuma equipe ainda', 'As equipes vêm da coluna "Equipe" do Astrea. Você também pode definir a equipe de cada cliente na aba Equipe do projeto.')}</section>`}
      ${d.semEquipe ? html`<p class="dica mt">${plural(d.semEquipe, 'cliente ativo está', 'clientes ativos estão')} sem equipe e não aparece(m) em nenhuma reunião. Defina na aba Equipe de cada projeto ou <a href="#/pautas/clientes">veja por cliente</a>.</p>` : ''}`,
  };
}

// ------------------------------------------------ mesa da reunião da equipe ---
async function mesaDaEquipe(equipe) {
  const d = await api.get(`/api/pautas/equipes/${encodeURIComponent(equipe)}`);
  const r = d.reuniaoAtual;
  const pessoas = [{ v: '', t: 'Líder do projeto' }, ...d.pessoas.map((p) => ({ v: p.id, t: p.nome }))];
  const so = guardado.ler('pq.so', 'pendencia');
  const abertosDe = (id) => d.itens.filter((i) => i.projetoId === id && ['aberto', 'discutido'].includes(i.situacao));
  const resolvidosDe = (id) => d.itens.filter((i) => i.projetoId === id && !['aberto', 'discutido'].includes(i.situacao));
  const comPendencia = (c) => abertosDe(c.id).length || c.semana.length || c.atrasadas;
  const visiveis = d.clientes.filter((c) => so === 'todos' || comPendencia(c));
  const naReuniao = r ? d.itens.filter((i) => i.reuniaoId === r.id) : [];
  const decididos = naReuniao.filter((i) => i.situacao !== 'aberto').length;
  const totais = { itens: d.itens.filter((i) => ['aberto', 'discutido'].includes(i.situacao)).length, atrasadas: d.clientes.reduce((s, c) => s + c.atrasadas, 0), semana: d.clientes.reduce((s, c) => s + c.semana.filter((x) => !x.atrasada).length, 0) };
  const bloco = (c) => { const ab = abertosDe(c.id); const rs = resolvidosDe(c.id);
    return html`<section class="pq-cli card glass up" id="cli-${c.id}" data-cli="${c.id}">
      <header class="pq-cli__head"><span class="pa-s ${SAUDE[c.saude][1]}">${SAUDE[c.saude][0]}</span><div><h3>${c.nome}</h3><small>${c.responsavel}${c.fase ? ` · ${c.fase}` : ''}${c.diasSemPauta !== null ? ` · última pauta há ${plural(c.diasSemPauta, 'dia', 'dias')}` : ' · nunca passou em pauta'}</small></div>
        <span class="grow"></span><button class="btn btn--ghost btn--sm" data-novo-cli="${c.id}">${icone('plus')}Item</button><a class="ibtn ibtn--sm" href="#/pautas/${c.id}" title="Pauta e histórico do cliente" aria-label="Pauta do cliente">${icone('list')}</a><a class="ibtn ibtn--sm" href="#/projetos/${c.id}" title="Abrir projeto" aria-label="Abrir projeto">${icone('folder')}</a></header>
      ${c.semana.length || c.ultimoAndamento ? html`<div class="pq-ctx">${c.semana.slice(0, 6).map((x) => html`<span class="pq-ctx__i ${x.atrasada ? 'is-late' : ''}"><em>${TIPO_T[x.tipo] ?? 'Tarefa'}</em>${x.titulo}<small>${x.atrasada ? 'atrasada · ' : ''}${dataBR(x.prazo)}${x.hora ? ` ${x.hora}` : ''}${x.responsavel ? ` · ${x.responsavel}` : ''}</small></span>`)}
        ${c.semana.length > 6 ? html`<span class="pq-ctx__i">+${c.semana.length - 6} na semana</span>` : ''}
        ${c.ultimoAndamento ? html`<span class="pq-ctx__i pq-ctx__and"><em>Andamento</em>${c.ultimoAndamento.titulo}<small>${dataBR(c.ultimoAndamento.data)} · ${c.ultimoAndamento.numero}</small></span>` : ''}</div>` : ''}
      ${ab.length ? html`<ol class="pa-itens">${ab.map(cartaoItem)}</ol>` : html`<p class="dica pq-vazio">Sem assunto em aberto. ${c.semana.length ? 'Confira os vencimentos acima.' : ''}</p>`}
      ${rs.length ? html`<details class="pa-res"><summary>${plural(rs.length, 'resolvido nesta semana', 'resolvidos nesta semana')}</summary><ol class="pa-itens">${rs.map(cartaoItem)}</ol></details>` : ''}</section>`; };
  return {
    titulo: `Pauta · ${equipe}`,
    html: html`${cabecalho({ titulo: `Equipe ${equipe}`, sub: html`Reunião semanal · ${cadenciaTxt(d.cadencia)}${r ? html` · <b>reunião de ${dataBR(r.data)}${r.hora ? ` às ${r.hora}` : ''}</b>` : ''}`,
      acoes: html`<a class="btn btn--ghost" href="#/pautas">${icone('chevronLeft')}Equipes</a><button class="btn btn--ghost" data-cadencia>${icone('settings')}Dia e hora</button>
        ${r ? html`<button class="btn btn--accent" data-encerrar="${r.id}">${icone('check')}Encerrar e gerar atas</button>` : html`<button class="btn btn--accent" data-agendar-eq>${icone('calendar')}Marcar reunião</button>`}`,
      resumo: [{ rotulo: 'Clientes', valor: d.clientes.length }, { rotulo: 'Itens em aberto', valor: totais.itens }, { rotulo: 'Tarefas atrasadas', valor: totais.atrasadas, tom: totais.atrasadas ? 'alert' : 'ok' }, { rotulo: 'Vencem em 7 dias', valor: totais.semana }] })}
      ${r ? html`<div class="pq-run glass up mt"><div><b>Reunião em andamento</b><small>${decididos} de ${naReuniao.length} assunto(s) com decisão · o que não for decidido volta na semana que vem</small></div><div class="pq-run__barra"><i style="width:${naReuniao.length ? Math.round((decididos / naReuniao.length) * 100) : 0}%"></i></div>
        <button class="btn btn--ghost btn--sm" data-cancelar="${r.id}">Cancelar reunião</button></div>` : ''}
      <div class="pq-mesa mt">
        <aside class="pq-lado card glass up"><div class="seg" role="group" aria-label="Mostrar">${[['pendencia', 'Com pendência'], ['todos', 'Todos']].map(([v, t]) => html`<button type="button" class="seg__btn" data-so="${v}" aria-pressed="${so === v}"><span>${t}</span></button>`)}</div>
          <ul class="pq-lista">${d.clientes.map((c) => html`<li><button type="button" data-ir-cli="${c.id}" class="${comPendencia(c) ? '' : 'is-quieto'}"><i class="pq-dot pq-dot--${c.saude}"></i><span>${c.nome}</span>${abertosDe(c.id).length ? html`<b>${abertosDe(c.id).length}</b>` : ''}</button></li>`)}</ul></aside>
        <div class="pq-blocos">${visiveis.length ? visiveis.map(bloco) : html`<section class="card glass up">${vazio('check', 'Nada pendente nesta equipe', 'Nenhum cliente com assunto aberto, atraso ou vencimento na semana. Mostre "Todos" para incluir um assunto.')}</section>`}</div>
      </div>
      ${d.reunioes.filter((x) => x.situacao !== 'agendada').length ? html`<details class="card glass up mt"><summary class="link">Reuniões anteriores da equipe</summary><ul class="lista mt">${d.reunioes.filter((x) => x.situacao !== 'agendada').map((x) => html`<li><div><b>${dataBR(x.data)}</b><small>${{ realizada: `Realizada · ${plural(x.itens, 'assunto', 'assuntos')} · ${plural(x.atas, 'ata gerada', 'atas geradas')}`, cancelada: 'Cancelada' }[x.situacao]}${x.resumo ? ` · ${x.resumo.slice(0, 120)}` : ''}</small></div></li>`)}</ul></details>` : ''}`,
    depois(el) {
      const rec = () => navegar();
      ouvir(el, 'click', '[data-so]', (b) => { guardado.gravar('pq.so', b.dataset.so); navegar(); });
      ouvir(el, 'click', '[data-ir-cli]', (b) => { let alvo = el.querySelector(`#cli-${b.dataset.irCli}`); if (!alvo) { guardado.gravar('pq.so', 'todos'); navegar().then(() => document.querySelector(`#cli-${b.dataset.irCli}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })); return; } alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); alvo.classList.add('is-flash'); setTimeout(() => alvo.classList.remove('is-flash'), 1200); });
      ouvir(el, 'click', '[data-novo-cli]', async (b) => { const c = d.clientes.find((x) => x.id === b.dataset.novoCli);
        if (await formulario({ titulo: 'Novo assunto para a pauta', subtitulo: `${c.nome} · equipe ${equipe}`, rotulo: 'Incluir', campos: camposItem(pessoas), async enviar(v) { await api.post(`/api/pautas/projetos/${c.id}/itens`, { ...corpoItem(v), equipe }); } })) rec(); });
      ouvir(el, 'click', '[data-cadencia]', async () => { const c = d.cadencia ?? { diaSemana: 1, hora: '09:00', duracaoMin: 60, participantes: '' };
        const ok = await formulario({ titulo: `Reunião semanal · ${equipe}`, subtitulo: 'Ao encerrar uma reunião, a da semana seguinte já fica marcada e aparece no calendário.', rotulo: 'Salvar', campos: [
          { nome: 'diaSemana', rotulo: 'Dia da semana', tipo: 'select', valor: String(c.diaSemana), opcoes: DIAS.map((t, v) => ({ v: String(v), t: t[0].toUpperCase() + t.slice(1) })), metade: true },
          { nome: 'hora', rotulo: 'Hora', tipo: 'time', valor: c.hora, metade: true, obrigatorio: true },
          { nome: 'duracaoMin', rotulo: 'Duração (min)', tipo: 'number', valor: c.duracaoMin, metade: true },
          { nome: 'participantes', rotulo: 'Participantes', valor: c.participantes ?? '', metade: true, placeholder: 'Nomes ou e-mails' }],
          async enviar(v) { await api.put(`/api/pautas/equipes/${encodeURIComponent(equipe)}/cadencia`, { diaSemana: Number(v.diaSemana), hora: v.hora, duracaoMin: Number(v.duracaoMin) || 60, participantes: v.participantes || null, ativo: true }); } });
        if (ok) { toast('Reunião semanal configurada'); rec(); } });
      ouvir(el, 'click', '[data-agendar-eq]', async () => {
        const ok = await formulario({ titulo: `Marcar reunião · ${equipe}`, subtitulo: 'Os assuntos abertos de todos os clientes da equipe entram nela.', rotulo: 'Marcar', campos: [
          { nome: 'data', rotulo: 'Data', tipo: 'date', valor: hoje(), obrigatorio: true, metade: true }, { nome: 'hora', rotulo: 'Hora', tipo: 'time', valor: d.cadencia?.hora ?? '09:00', metade: true },
          { nome: 'participantes', rotulo: 'Participantes', valor: d.cadencia?.participantes ?? '' }],
          async enviar(v) { await api.post(`/api/pautas/equipes/${encodeURIComponent(equipe)}/reunioes`, { data: v.data, hora: v.hora || null, participantes: v.participantes || null }); } });
        if (ok) rec(); });
      ligarItens(el, (id) => d.itens.find((x) => x.id === id), pessoas, rec, r);
    },
  };
}

// Item da pauta (mesmo cartão na mesa da equipe e na pauta do cliente).
function cartaoItem(i) {
  return html`<li class="pa-item pa-item--${i.prioridade}${i.vezesEmPauta >= 3 ? ' is-rec' : ''}" data-id="${i.id}">
    <div class="pa-item__topo"><span class="pa-tag">${CATEGORIAS[i.categoria]}</span><span class="pa-tag pa-tag--${i.prioridade}">${PRIORIDADES[i.prioridade]}</span>
      ${i.vezesEmPauta ? html`<span class="pa-tag pa-tag--rec" title="Quantas reuniões já passou">${i.vezesEmPauta}ª vez em pauta</span>` : ''}<span class="grow"></span>
      <span class="pa-sit pa-sit--${i.situacao}">${SITUACOES[i.situacao]}</span></div>
    <b>${i.titulo}</b>${i.detalhe ? html`<p class="dica">${i.detalhe}</p>` : ''}
    ${i.decisao ? html`<p class="pa-dec"><span>Decisão</span>${i.decisao}</p>` : ''}
    <div class="pa-item__pe"><small>${i.responsavel ? html`${icone('users')}${i.responsavel}` : 'Sem responsável'}${i.tarefaId ? html` · tarefa ${i.tarefaStatus === 'concluida' ? 'concluída' : `até ${i.tarefaPrazo ? dataBR(i.tarefaPrazo) : 's/ prazo'}`}` : ''}</small><span class="grow"></span>
      ${['aberto', 'discutido'].includes(i.situacao) ? html`<button class="btn btn--ghost btn--sm" data-decidir="${i.id}">${icone('comment')}Decisão</button>
        <button class="btn btn--accent btn--sm" data-tarefa="${i.id}">${icone('check')}Encaminhar</button>
        <button class="btn btn--ghost btn--sm" data-concluir="${i.id}" title="Resolvido sem tarefa">${icone('check')}Resolvido</button>` : html`<button class="btn btn--ghost btn--sm" data-reabrir="${i.id}">Reabrir</button>`}
      <button class="btn btn--ghost btn--sm" data-editar="${i.id}" aria-label="Editar">${icone('edit')}</button>
      <button class="btn btn--ghost btn--sm perigo-btn" data-excluir="${i.id}" aria-label="Excluir">${icone('trash')}</button></div></li>`;
}
const camposItem = (pessoas, i = {}) => [
  { nome: 'titulo', rotulo: 'Assunto', obrigatorio: true, valor: i.titulo ?? '', placeholder: 'Ex.: Contraproposta do Banco Alfa' },
  { nome: 'detalhe', rotulo: 'Contexto (opcional)', tipo: 'textarea', valor: i.detalhe ?? '' },
  { nome: 'categoria', rotulo: 'Tema', tipo: 'select', valor: i.categoria ?? 'geral', opcoes: opcoes(CATEGORIAS), metade: true },
  { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', valor: i.prioridade ?? 'media', opcoes: opcoes(PRIORIDADES), metade: true },
  { nome: 'responsavelId', rotulo: 'Quem conduz', tipo: 'select', valor: i.responsavelId ?? '', opcoes: pessoas },
];
const corpoItem = (v) => ({ titulo: v.titulo, detalhe: v.detalhe || null, categoria: v.categoria, prioridade: v.prioridade, responsavelId: v.responsavelId || null });

/** Botões dos itens (decisão, encaminhar, resolvido, reabrir, editar, excluir, encerrar, cancelar). */
function ligarItens(el, achar, pessoas, rec, reuniao) {
  ouvir(el, 'click', '[data-editar]', async (b) => { const i = achar(b.dataset.editar); if (await formulario({ titulo: 'Editar assunto', rotulo: 'Salvar', campos: camposItem(pessoas, i), async enviar(v) { await api.patch(`/api/pautas/itens/${i.id}`, corpoItem(v)); } })) rec(); });
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
    const ok = await formulario({ titulo: 'Encaminhar', subtitulo: 'Vira tarefa, prazo, evento ou audiência: aparece em Tarefas, no Calendário e na ata.', rotulo: 'Encaminhar', campos: [
      { nome: 'tipo', rotulo: 'Vira', tipo: 'select', valor: 'tarefa', opcoes: [{ v: 'tarefa', t: 'Tarefa' }, { v: 'prazo', t: 'Prazo' }, { v: 'evento', t: 'Evento / reunião' }, { v: 'audiencia', t: 'Audiência' }], metade: true },
      { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', valor: i.prioridade, opcoes: opcoes(PRIORIDADES), metade: true },
      { nome: 'titulo', rotulo: 'O que fazer', obrigatorio: true, valor: i.titulo },
      { nome: 'responsavelId', rotulo: 'Responsável', tipo: 'select', valor: i.responsavelId ?? '', opcoes: pessoas, metade: true },
      { nome: 'prazo', rotulo: 'Data', tipo: 'date', metade: true }, { nome: 'hora', rotulo: 'Hora (evento/audiência)', tipo: 'time', metade: true }],
      async enviar(v) { await api.post(`/api/pautas/itens/${i.id}/tarefa`, { titulo: v.titulo, responsavelId: v.responsavelId || undefined, prazo: v.prazo || null, prioridade: v.prioridade, tipo: v.tipo, hora: v.hora || null }); } });
    if (ok) { toast('Encaminhado: já está em Tarefas'); rec(); }
  });
  ouvir(el, 'click', '[data-concluir]', async (b) => { try { await api.patch(`/api/pautas/itens/${b.dataset.concluir}`, { situacao: 'concluido' }); rec(); } catch (e) { erroDe(e); } });
  ouvir(el, 'click', '[data-reabrir]', async (b) => { try { await api.patch(`/api/pautas/itens/${b.dataset.reabrir}`, { situacao: 'aberto' }); rec(); } catch (e) { erroDe(e); } });
  ouvir(el, 'click', '[data-excluir]', async (b) => { if (!(await confirmar('Excluir assunto?', 'Sai da pauta. Tarefas já criadas permanecem.', { rotulo: 'Excluir', perigo: true }))) return; try { await api.del(`/api/pautas/itens/${b.dataset.excluir}`); rec(); } catch (e) { erroDe(e); } });
  ouvir(el, 'click', '[data-encerrar]', async (b) => {
    let r;
    const ok = await formulario({ titulo: 'Encerrar a reunião', subtitulo: 'Gera a ata de cada cliente tratado (aba Reuniões e atas do projeto). O que ficou aberto volta na próxima.', rotulo: 'Encerrar e gerar atas', campos: [
      { nome: 'resumo', rotulo: 'Resumo geral (opcional)', tipo: 'textarea' },
      { nome: 'participantes', rotulo: 'Participantes', valor: reuniao?.participantes ?? '' },
      { nome: 'publicarAta', rotulo: 'Atas visíveis ao cliente no portal?', tipo: 'select', valor: 'nao', opcoes: [{ v: 'nao', t: 'Não, só internas' }, { v: 'sim', t: 'Sim, publicar no portal' }] }],
      async enviar(v) { r = await api.post(`/api/pautas/reunioes/${b.dataset.encerrar}/encerrar`, { resumo: v.resumo || null, participantes: v.participantes || null, publicarAta: v.publicarAta === 'sim' }); } });
    if (ok) { toast(`${plural(r.atas ?? 1, 'ata gerada', 'atas geradas')} · ${r.encaminhados} encaminhamento(s)${r.proxima ? ' · próxima reunião já marcada' : ''}`); rec(); }
  });
  ouvir(el, 'click', '[data-cancelar]', async (b) => { if (!(await confirmar('Cancelar a reunião?', 'Os assuntos voltam para a pauta em aberto.', { rotulo: 'Cancelar reunião', perigo: true }))) return; try { await api.del(`/api/pautas/reunioes/${b.dataset.cancelar}`); rec(); } catch (e) { erroDe(e); } });
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
    html: html`${cabecalho({ titulo: 'Pautas por cliente', sub: 'Manutenção da pauta de cada cliente. As reuniões acontecem por equipe, toda semana.', acoes: html`<a class="btn btn--ghost" href="#/pautas">${icone('chevronLeft')}Reuniões por equipe</a>`,
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
      acoes: html`<a class="btn btn--ghost" href="#/pautas/clientes">${icone('chevronLeft')}Todos os clientes</a><a class="btn btn--ghost" href="#/projetos/${d.projeto.id}">Abrir projeto</a>` })}
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
