/**
 * Gestão de projetos — o centro do sistema.
 *
 * Duas formas de ver o mesmo dado: cartões (visão de portfólio, com anel de
 * progresso e próximo marco) e quadro por FASE (visão de procedimento, onde
 * se arrasta um projeto para a fase seguinte). No quadro, quem manda é o
 * servidor: soltar numa coluna chama a API, que recusa pular marco do
 * processo — e o cartão volta tremendo, com o motivo na tela.
 */
import { api } from '../api.js';
import { estado, pode } from '../estado.js';
import { anel, quadroArrastavel } from '../fx.js';
import { avatar, dataCurta, guardado, html, icone, matiz, ouvir, pilha, raw, tamanho } from '../util.js';
import { cabecalho, formulario, toast, erroDe, vazio } from '../ui.js';
import { atualizarLateral, ir, navegar, posicionarSeg } from '../shell.js';

const ICONE_DO_TIPO = {
  recuperacao_judicial: 'scale', recuperacao_extrajudicial: 'shield', falencia: 'anchor',
  reestruturacao: 'building', negociacao_credores: 'users', investigacao_patrimonial: 'search',
  contencioso_estrategico: 'target', consultivo: 'doc', protecao_patrimonial: 'lock',
};
const PILULA = { ativo: 'active', proposto: 'planning', suspenso: 'review', encerrado: 'shipped' };
const GRUPOS_DO_QUADRO = [
  { id: 'recuperacao_judicial', rotulo: 'Recuperação judicial', tipos: ['recuperacao_judicial'] },
  { id: 'falencia', rotulo: 'Falência', tipos: ['falencia'] },
  { id: 'recuperacao_extrajudicial', rotulo: 'Extrajudicial', tipos: ['recuperacao_extrajudicial'] },
  { id: 'outros', rotulo: 'Demais', tipos: ['reestruturacao', 'negociacao_credores', 'investigacao_patrimonial', 'contencioso_estrategico', 'consultivo', 'protecao_patrimonial'], modelo: 'consultivo' },
];

const fixados = () => guardado.ler('fixados', null);
const estaFixado = (id) => (fixados() ?? estado.projetos.filter((p) => p.situacao === 'ativo').slice(0, 3).map((p) => p.id)).includes(id);

/** Cartão de projeto, no markup do LexPane. Exportado: o painel e o hub reaproveitam. */
export function cartaoProjeto(p) {
  const hue = matiz(p.id);
  const pr = p.progresso;
  const proxima = pr?.proxima;
  const prazo = p.proximo_prazo; const fim = p.previsao_fim;
  const tf = Number(p.tarefas_total); const tc = Number(p.tarefas_concluidas);
  const pend = Number(p.creditos_a_validar) + Number(p.a_analisar);
  return html`<article class="pcard glass hue--${hue} up" data-proj="${p.id}">
    <div class="pcard__top">
      <span class="picon picon--lg hue--${hue}">${icone(ICONE_DO_TIPO[p.tipo] ?? 'folder')}</span>
      <div class="pcard__id"><h3 class="pcard__name"><a class="pcard__link" href="#/projetos/${p.id}">${p.nome}</a></h3>
        <span class="pstatus pstatus--${PILULA[p.situacao] ?? 'active'}"><i></i>${p.faseAtual?.nome ?? p.rotuloDoTipo}</span></div>
      <button type="button" class="ibtn ibtn--sm pstar" data-pin="${p.id}" aria-pressed="${estaFixado(p.id)}" aria-label="Fixar" title="Fixar na lateral">${icone('pin')}</button>
    </div>
    <p class="pcard__sum">${p.resumo ?? (p.cliente ? `${p.rotuloDoTipo} · ${p.cliente}` : p.rotuloDoTipo)}</p>
    <div class="pcard__mid">
      <span class="pring">${raw(anel(pr?.percentual ?? 0, { tam: 64, traco: 6, cor: 'var(--hue)' }))}<b class="pring__val">${pr ? `${pr.percentual}%` : '—'}</b></span>
      <div class="pcard__next"><small>${proxima ? 'Próxima fase' : p.situacao === 'encerrado' ? 'Encerrado' : 'Fase final'}</small>
        <b>${proxima?.nome ?? p.faseAtual?.nome ?? '—'}</b>
        <span>${proxima?.fundamento ?? (pr ? `${pr.indice} de ${pr.total} marcos` : '')}</span></div>
    </div>
    <footer class="pcard__foot">
      ${p.equipe?.length ? pilha(p.equipe.map((e) => e.nome), 3) : html`<span class="muted" style="font-size:12px">sem equipe</span>`}
      <span class="pcard__count tnum">${tf ? `${tc}/${tf} tarefas` : 'sem tarefas'}</span>
      ${pend ? html`<span class="selo aviso" title="Créditos a validar e documentos a analisar">${pend} pend.</span>` : ''}
      ${prazo ? html`<span class="pcard__due" title="${prazo.titulo}">${icone('flag')}${dataCurta(prazo.vencimento)}</span>`
        : fim ? html`<span class="pcard__due">${icone('calendar')}${dataCurta(fim)}</span>` : ''}
    </footer>
  </article>`;
}

export default async function projetos() {
  const [lista, catalogo] = await Promise.all([api.get('/api/projetos'), api.get('/api/projetos/fases')]);
  estado.projetos = lista;
  const filtro = guardado.ler('projFiltro', 'ativos');
  const visao = guardado.ler('projVisao', 'cartoes');
  const grupo = guardado.ler('projGrupo', 'recuperacao_judicial');

  const ativos = lista.filter((p) => p.situacao !== 'encerrado');
  const comProg = ativos.filter((p) => p.progresso);
  const avanco = comProg.length ? Math.round(comProg.reduce((t, p) => t + p.progresso.percentual, 0) / comProg.length) : null;
  const prazos = lista.reduce((t, p) => t + Number(p.prazos_abertos), 0);

  const visiveis = lista.filter((p) => (filtro === 'todos' ? true : filtro === 'ativos' ? p.situacao !== 'encerrado' : p.situacao === 'encerrado'));

  const seg = (nome, valor, itens) => html`<div class="seg" role="group" aria-label="${nome}"><span class="seg__pill" aria-hidden="true"></span>
    ${itens.map(([v, t, ic]) => html`<button type="button" class="seg__btn" data-seg="${nome}" data-v="${v}" aria-pressed="${valor === v}">${ic ? icone(ic) : ''}<span>${t}</span></button>`)}</div>`;

  const acoes = html`${seg('visao', visao, [['cartoes', 'Cartões', 'grid'], ['quadro', 'Quadro por fase', 'board']])}
    ${visao === 'cartoes' ? seg('filtro', filtro, [['ativos', 'Ativos'], ['todos', 'Todos'], ['encerrados', 'Encerrados']]) : ''}
    ${pode('projeto.escrever') ? html`<button type="button" class="btn btn--accent" data-act="novo">${icone('plus')}Novo projeto</button>` : ''}`;

  let corpo;
  if (lista.length === 0) {
    corpo = html`<section class="card glass up">${vazio('folder', 'Nenhum projeto ainda',
      'Cada projeto é um caso do escritório: fase processual, equipe, créditos, processos, documentos e o portal do cliente, tudo num lugar só.',
      pode('projeto.escrever') ? '<button class="btn btn--accent" data-act="novo">Criar o primeiro projeto</button>' : '')}</section>`;
  } else if (visao === 'quadro') {
    corpo = quadro(lista, catalogo, grupo);
  } else {
    corpo = visiveis.length ? html`<div class="pgrid">${visiveis.map(cartaoProjeto)}</div>`
      : html`<section class="card glass up">${vazio('folder', 'Nada neste filtro', 'Troque o filtro para ver os outros projetos.')}</section>`;
  }

  return {
    titulo: 'Projetos',
    html: html`${cabecalho({
      titulo: 'Projetos',
      sub: `${plural(ativos.length)} em andamento${visao === 'quadro' ? ' · arraste um cartão para a fase seguinte' : ''}`,
      acoes,
      resumo: [
        { rotulo: 'Ativos', valor: ativos.length }, { rotulo: 'Encerrados', valor: lista.length - ativos.length },
        { rotulo: 'Avanço médio', valor: avanco === null ? '—' : avanco, sufixo: '%' }, { rotulo: 'Prazos abertos', valor: prazos, tom: prazos ? 'warn' : '' },
      ].map((s) => (s.rotulo === 'Avanço médio' && avanco !== null ? { ...s, valor: avanco, sufixo: '%' } : s)),
    })}<div class="mt">${corpo}</div>`,
    depois(raiz) {
      ouvir(raiz, 'click', '[data-seg]', (b) => { guardado.gravar(b.dataset.seg === 'visao' ? 'projVisao' : 'projFiltro', b.dataset.v); navegar(); });
      ouvir(raiz, 'click', '[data-grupo]', (b) => { guardado.gravar('projGrupo', b.dataset.grupo); navegar(); });
      ouvir(raiz, 'click', '[data-act=novo]', () => novoProjeto());
      ouvir(raiz, 'click', '.pcard', (c, ev) => { if (!ev.target.closest('a, button')) ir(`projetos/${c.dataset.proj}`); });
      ouvir(raiz, 'click', '[data-card]', (c, ev) => { if (!ev.target.closest('button')) ir(`projetos/${c.dataset.id}`); });
      ouvir(raiz, 'click', '[data-pin]', (b, ev) => {
        ev.preventDefault();
        const atuais = fixados() ?? estado.projetos.filter((p) => p.situacao === 'ativo').slice(0, 3).map((p) => p.id);
        const id = b.dataset.pin; const novo = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id];
        guardado.gravar('fixados', novo); b.setAttribute('aria-pressed', novo.includes(id));
        atualizarLateral(); toast(novo.includes(id) ? 'Fixado na lateral' : 'Removido da lateral');
      });
      if (visao === 'quadro') {
        quadroArrastavel(raiz.querySelector('.fases') ?? raiz, {
          item: '.tk-card', coluna: '.tk-col', lista: '.tk-col__list',
          aoSoltar: async (id, faseId) => {
            try {
              const r = await api.post(`/api/projetos/${id}/fase`, { fase: faseId });
              toast(`Fase atualizada: ${r.fase.nome}`); atualizarLateral();
            } catch (e) {
              // O servidor recusou (pular marco, por exemplo): a mensagem diz qual ficou sem registro.
              toast(e.message, 'erro'); throw e;
            }
          },
        });
      }
    },
  };
}

const plural = (n) => `${n} ${n === 1 ? 'projeto' : 'projetos'}`;

function quadro(lista, catalogo, grupoId) {
  const grupo = GRUPOS_DO_QUADRO.find((g) => g.id === grupoId) ?? GRUPOS_DO_QUADRO[0];
  const tipoDoModelo = grupo.modelo ?? grupo.tipos[0];
  const fases = catalogo.find((c) => c.tipo === tipoDoModelo)?.fases ?? [];
  const doGrupo = lista.filter((p) => grupo.tipos.includes(p.tipo) && p.situacao !== 'encerrado' && !p.playbook_modelo_id);
  const personalizados = lista.filter(p=>grupo.tipos.includes(p.tipo)&&p.situacao!=='encerrado'&&p.playbook_modelo_id);
  const primeira = fases[0]?.id;

  const porFase = new Map(fases.map((f) => [f.id, []]));
  for (const p of doGrupo) (porFase.get(p.fase ?? primeira) ?? porFase.get(primeira))?.push(p);

  const conta = (g) => lista.filter((p) => g.tipos.includes(p.tipo) && p.situacao !== 'encerrado').length;
  return html`
    <div class="flex up" style="margin-bottom:14px">
      <div class="tabs glass glass--chrome" role="tablist"><span class="tabs__pill" aria-hidden="true"></span>
        ${GRUPOS_DO_QUADRO.map((g) => html`<button type="button" role="tab" data-grupo="${g.id}" aria-selected="${g.id === grupo.id}">${g.rotulo}<b>${conta(g)}</b></button>`)}</div>
      <span class="dica">As colunas são os marcos legais do procedimento. Avançar é passo a passo; voltar é permitido.</span>
    </div>
    ${personalizados.length?html`<section class="card glass mb"><header class="card__head"><div><h2 class="card__title">Procedimentos personalizados</h2><p class="card__sub">Cada projeto tem suas próprias fases e etapas. Veja as etapas na fase do procedimento.</p></div></header><ul class="lista">${personalizados.map(p=>html`<li><div><b>${p.nome}</b><small>${p.faseAtual?.nome??'Sem fase'}</small></div><a class="btn btn--ghost" href="#/projetos/${p.id}/playbook">Abrir procedimento →</a></li>`)}</ul></section>`:''}
    <div class="fases up">
      ${fases.map((f, i) => {
        const cards = porFase.get(f.id) ?? [];
        return html`<section class="card glass tk-col" data-fase="${f.id}">
          <header class="tk-col__head"><i class="tk-dot" style="background:${f.excepcional ? 'var(--lab-red)' : f.terminal ? 'var(--lab-green)' : 'var(--lab-amber)'}"></i>
            <h2 class="tk-col__name" title="${f.marco}">${f.nome}</h2><span class="tk-col__count tnum">${cards.length}</span></header>
          ${f.fundamento ? html`<small class="mono-sm" style="padding:0 4px 8px;display:block">${f.fundamento}</small>` : ''}
          <div class="tk-col__list" data-col="${f.id}">${cards.map(cartaoDoQuadro)}</div></section>`;
      })}
    </div>`;
}

function cartaoDoQuadro(p) {
  const hue = matiz(p.id); const pr = p.progresso;
  const lider = p.lider ?? p.responsavel;
  return html`<article class="tk-card hue--${hue}" draggable="true" data-id="${p.id}" data-card>
    <div class="tk-card__top"><span class="pchip hue--${hue}"><i></i><span class="tk-ellip">${p.cliente ?? p.rotuloDoTipo}</span></span>
      ${Number(p.prazos_abertos) ? html`<span class="prio prio--high">${icone('flag')}${p.prazos_abertos}</span>` : ''}</div>
    <h3 class="tk-card__title"><span class="tk-card__text">${p.nome}</span></h3>
    <div class="fase-card__bar"><i data-w="${pr?.percentual ?? 0}" style="width:0;transition:width 1s var(--ease)"></i></div>
    <div class="tk-card__foot"><span class="tk-due">${icone('calendar')}${p.proximo_prazo ? dataCurta(p.proximo_prazo.vencimento) : p.previsao_fim ? dataCurta(p.previsao_fim) : 'sem data'}</span>
      <span class="tk-card__who">${lider ? avatar(lider, 'xs') : ''}</span></div></article>`;
}

export async function novoProjeto() {
  const modelos=(await api.get('/api/playbooks')).filter(m=>m.ativo);
  return formulario({
    titulo: 'Novo projeto', subtitulo: 'Cada projeto começa na primeira fase do procedimento escolhido. Quem cria lidera.',
    rotulo: 'Criar projeto',
    campos: [
      { nome: 'nome', rotulo: 'Nome do projeto', obrigatorio: true, placeholder: 'Ex.: RJ Grupo Aurora' },
      { nome: 'tipo', rotulo: 'Procedimento', tipo: 'select', obrigatorio: true, valor: 'recuperacao_judicial', opcoes: [
        { v: 'recuperacao_judicial', t: 'Recuperação judicial' }, { v: 'recuperacao_extrajudicial', t: 'Recuperação extrajudicial' },
        { v: 'falencia', t: 'Falência' }, { v: 'reestruturacao', t: 'Reestruturação' }, { v: 'negociacao_credores', t: 'Negociação com credores' },
        { v: 'investigacao_patrimonial', t: 'Investigação patrimonial' }, { v: 'contencioso_estrategico', t: 'Contencioso estratégico' }, { v: 'consultivo', t: 'Consultivo' }, { v: 'protecao_patrimonial', t: 'Proteção patrimonial' }] },
      { nome: 'razaoSocial', rotulo: 'Cliente (razão social)', metade: true, placeholder: 'INDÚSTRIA DEMO LTDA.' },
      { nome: 'cnpj', rotulo: 'CNPJ', metade: true, placeholder: 'Opcional — confere o dígito', dica: '' },
      { nome: 'resumo', rotulo: 'Resumo do caso', tipo: 'textarea', placeholder: 'Uma ou duas frases: o que é este projeto.' },
      { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', metade: true, valor: '3', opcoes: [{ v: 1, t: '1 · Máxima' }, { v: 2, t: '2 · Alta' }, { v: 3, t: '3 · Normal' }, { v: 4, t: '4 · Baixa' }, { v: 5, t: '5 · Mínima' }] },
      { nome: 'previsaoFim', rotulo: 'Previsão de término', tipo: 'date', metade: true },
      ...(modelos.length?[{nome:'playbookModeloId',rotulo:'Modelo de fases e tarefas',tipo:'select',opcoes:[{v:'',t:'Usar o padrão do escritório para este tipo'},...modelos.map(m=>({v:m.id,t:m.nome}))]}]:[]),
      { nome: 'playbook', rotulo: 'Gerar as tarefas do playbook?', tipo: 'select', valor: 'sim', opcoes: [{ v: 'sim', t: 'Sim — o projeto já nasce com as tarefas da abertura e da primeira fase' }, { v: 'nao', t: 'Não — o caso já está andando' }] },
    ],
    async enviar(v) {
      const corpo = { nome: v.nome, tipo: v.tipo, prioridade: Number(v.prioridade ?? 3), resumo: v.resumo, previsaoFim: v.previsaoFim, semPlaybook: v.playbook === 'nao',playbookModeloId:v.playbookModeloId };
      if (v.razaoSocial) corpo.cliente = { razaoSocial: v.razaoSocial, cnpj: v.cnpj };
      const r = await api.post('/api/projetos', corpo);
      toast(`Projeto criado${r.playbook?.criadas ? ` · ${r.playbook.criadas} tarefas geradas pelo playbook` : ''}`); atualizarLateral(); ir(`projetos/${r.id}`);
    },
  });
}
