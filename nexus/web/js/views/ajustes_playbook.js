/**
 * Ajustes → Playbook: tarefas automáticas por fase, de forma visual.
 *
 * Escolhe o procedimento, clica na fase e cria as tarefas que nascem sozinhas quando um projeto entra nela.
 * Por baixo é a mesma automação "fase iniciada" do servidor (/api/config/automacoes): a tarefa vai para o líder
 * do projeto, com prazo em dias úteis contado da entrada na fase.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { guardado, html, icone, ouvir, raw } from '../util.js';
import { confirmar, erroDe, formulario, toast } from '../ui.js';

const PRIORIDADES = [{ v: 'baixa', t: 'Baixa' }, { v: 'media', t: 'Média' }, { v: 'alta', t: 'Alta' }, { v: 'urgente', t: 'Urgente' }];
const ROT_PRIO = Object.fromEntries(PRIORIDADES.map((p) => [p.v, p.t]));

export async function ajustesPlaybook(recarregar) {
  const [r, cat] = await Promise.all([api.get('/api/config/automacoes'), api.get('/api/projetos/fases').catch(() => [])]);
  const gere = pode('config.gerir');
  let tipo = guardado.ler('playbook.tipo', cat[0]?.tipo);
  if (!cat.some((c) => c.tipo === tipo)) tipo = cat[0]?.tipo;
  const proc = cat.find((c) => c.tipo === tipo) ?? { fases: [] };
  let faseSel = guardado.ler(`playbook.fase.${tipo}`, proc.fases[0]?.id);
  if (!proc.fases.some((f) => f.id === faseSel)) faseSel = proc.fases[0]?.id;
  const daFase = (id) => r.automacoes.filter((a) => a.escopo === 'escritorio' && a.gatilho === 'fase_iniciada' && a.fase === id);
  const fase = proc.fases.find((f) => f.id === faseSel);
  const tarefas = fase ? daFase(fase.id) : [];

  const campos = (a = {}) => [
    { nome: 'tituloTarefa', rotulo: 'Tarefa', obrigatorio: true, valor: a.tituloTarefa ?? '', placeholder: 'Ex.: Conferir edital do art. 52 e preparar habilitações' },
    { nome: 'descricao', rotulo: 'Instruções (opcional)', tipo: 'textarea', valor: a.descricao ?? '' },
    { nome: 'diasUteis', rotulo: 'Prazo em dias úteis', tipo: 'number', valor: a.diasUteis ?? 2, metade: true, min: 0 },
    { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', valor: a.prioridade ?? 'media', metade: true, opcoes: PRIORIDADES },
  ];
  const corpo = (v) => ({ nome: `${fase.nome} · ${v.tituloTarefa}`.slice(0, 200), gatilho: 'fase_iniciada', fase: fase.id, tituloTarefa: v.tituloTarefa, descricao: v.descricao || null, diasUteis: Number(v.diasUteis ?? 1), prioridade: v.prioridade });

  return {
    html: html`<section class="card glass up pb">
      <header class="card__head"><div><h2 class="card__title">Playbook: tarefas automáticas por fase</h2>
        <p class="card__sub">Clique na fase e cadastre as tarefas. Quando um projeto entrar nela, as tarefas nascem para o líder do projeto, com prazo em dias úteis.</p></div></header>
      <div class="pb-tipos" role="tablist" aria-label="Procedimento">${cat.map((c) => html`<button type="button" class="pb-tipo" data-pb-tipo="${c.tipo}" aria-pressed="${c.tipo === tipo}">${c.rotulo}</button>`)}</div>
      <ol class="pb-fases">${proc.fases.map((f, n) => { const q = daFase(f.id); return html`<li><button type="button" class="pb-fase${f.id === faseSel ? ' is-sel' : ''}" data-pb-fase="${f.id}">
        <span class="pb-fase__n">${n + 1}</span><span class="pb-fase__nome">${f.nome}</span>
        <span class="pb-fase__q${q.length ? ' tem' : ''}">${q.length ? `${q.length} tarefa${q.length > 1 ? 's' : ''}` : 'sem tarefas'}</span></button></li>`; })}</ol>
      ${fase ? html`<div class="pb-painel">
        <header class="pb-painel__head"><div><small>Fase ${proc.fases.indexOf(fase) + 1} de ${proc.fases.length}</small><h3>${fase.nome}</h3>${fase.marco ? html`<p class="dica">${fase.marco}${fase.fundamento ? ` · ${fase.fundamento}` : ''}</p>` : ''}</div>
          ${gere ? html`<button class="btn btn--accent" data-pb-nova>${icone('plus')}Nova tarefa automática</button>` : ''}</header>
        ${tarefas.length ? html`<ul class="pb-tarefas">${tarefas.map((a) => html`<li class="${a.ativo ? '' : 'is-off'}">
            <span class="pb-prio pb-prio--${a.prioridade}" title="Prioridade ${ROT_PRIO[a.prioridade]}"></span>
            <div class="grow"><b>${a.tituloTarefa}</b><small>${a.diasUteis} dia(s) útil(eis) · prioridade ${ROT_PRIO[a.prioridade]} · ${a.execucoes ? `criada ${a.execucoes} vez(es)` : 'ainda não rodou'}</small>${a.descricao ? html`<p class="dica">${a.descricao}</p>` : ''}</div>
            ${gere ? html`<label class="nx-switch" title="Ativa"><input type="checkbox" data-pb-ativo="${a.id}" ${a.ativo ? raw('checked') : ''}><span></span></label>
              <button class="btn btn--ghost btn--sm" data-pb-editar="${a.id}">${icone('list')}Editar</button>
              <button class="btn btn--ghost btn--sm perigo-btn" data-pb-del="${a.id}" aria-label="Excluir">${icone('trash')}</button>` : ''}</li>`)}</ul>`
          : html`<div class="pb-vazio">${icone('bolt')}<p>Nenhuma tarefa automática nesta fase.</p>${gere ? html`<button class="btn btn--ghost" data-pb-nova>${icone('plus')}Criar a primeira</button>` : ''}</div>`}
      </div>` : ''}
    </section>`,
    depois(el) {
      ouvir(el, 'click', '[data-pb-tipo]', (b) => { guardado.gravar('playbook.tipo', b.dataset.pbTipo); recarregar(); });
      ouvir(el, 'click', '[data-pb-fase]', (b) => { guardado.gravar(`playbook.fase.${tipo}`, b.dataset.pbFase); recarregar(); });
      ouvir(el, 'click', '[data-pb-nova]', async () => {
        const ok = await formulario({ titulo: 'Nova tarefa automática', subtitulo: `Nasce quando o projeto entrar em “${fase.nome}”.`, rotulo: 'Criar', campos: campos(), async enviar(v) { await api.post('/api/config/automacoes', { ...corpo(v), ativo: true }); } });
        if (ok) { toast('Tarefa automática criada'); recarregar(); }
      });
      ouvir(el, 'click', '[data-pb-editar]', async (b) => {
        const a = r.automacoes.find((x) => x.id === b.dataset.pbEditar);
        const ok = await formulario({ titulo: 'Editar tarefa automática', subtitulo: fase.nome, rotulo: 'Salvar', campos: campos(a), async enviar(v) { await api.patch(`/api/config/automacoes/${a.id}`, corpo(v)); } });
        if (ok) recarregar();
      });
      ouvir(el, 'click', '[data-pb-del]', async (b) => {
        if (!(await confirmar('Excluir tarefa automática?', 'Ela deixa de ser criada. As tarefas já criadas permanecem.', { rotulo: 'Excluir', perigo: true }))) return;
        try { await api.del(`/api/config/automacoes/${b.dataset.pbDel}`); recarregar(); } catch (e) { erroDe(e); }
      });
      el.addEventListener('change', async (e) => {
        const c = e.target.closest('[data-pb-ativo]'); if (!c) return;
        try { await api.patch(`/api/config/automacoes/${c.dataset.pbAtivo}`, { ativo: c.checked }); toast(c.checked ? 'Ativada' : 'Pausada'); recarregar(); } catch (er) { c.checked = !c.checked; erroDe(er); }
      });
    },
  };
}
