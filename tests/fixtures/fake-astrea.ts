/** Mini-"Astrea" FICTÍCIO com a mesma estrutura observada (rota por hash, <article>, <main>), para testar o adaptador sem dados reais. */
export const PUBS = [
  { id: '9001', date: '21/10/2026', pub: '22/10/2026', proc: '0001234-56.2025.8.16.0001', name: 'Recuperação Judicial Empresa Fictícia A', client: 'Cliente Fictício A S.A.', text: 'Intime-se a parte para apresentar manifestação no prazo de 15 (quinze) dias úteis.', hint: 'sex, 13 de nov 2026' },
  { id: '9002', date: '21/10/2026', pub: '22/10/2026', proc: '0002345-67.2025.8.16.0001', name: 'Falência Empresa Fictícia B', client: 'Cliente Fictício B S.A.', text: 'Certifico a juntada do AR. Conclusos.', hint: '' },
];

const articles = PUBS.map((p) => `
<article>
  <input type="checkbox"/>
  <div>${p.date}</div><div>Publicado em: ${p.pub}</div>
  <div>${p.proc}</div><a href="/#/main/folders/detail/1">${p.name}</a><div>Responsável: Responsável Fictício</div>
  <div>TJXXDJN</div><div>Não tratada</div>
  <button>Adicionar</button><button>Concluir</button>
  <button data-id="${p.id}"><span>Acessar publicação</span></button>
  <div>Publicação Processo: ${p.proc} Órgão: Vara Fictícia ${p.text}</div>
  ${p.hint ? `<div>Tratamentos sugeridos:</div><button>Adicionar um prazo para ${p.hint}</button>` : ''}
</article>`).join('');

export const html = `<!doctype html><html><body>
<header><input placeholder="Pesquisar contato, processo ou tarefa" id="gs"/><ul id="sug"></ul></header>
<nav id="nav"></nav>
<main id="m"></main>
<script>
const PUBS = ${JSON.stringify(PUBS)};
const LIST = ${JSON.stringify(articles)};
const SAVED = __SAVED__;
const TASKS = __TASKS__;
const WFS = __WFS__;
const REQUIRE_LOGIN = __LOGIN__;
const CHALLENGE = __CHALLENGE__;
const WD = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']; const MON = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function ptDate(br) { const [d,m,y] = br.split('/').map(Number); const dt = new Date(Date.UTC(y, m-1, d)); return WD[dt.getUTCDay()] + ', ' + d + ' de ' + MON[m-1] + ' ' + y; }
const ACTS = [
  { type: 'PRAZO', title: 'Prazo fictício aberto', date: 'sex, 13 de nov 2026', iso: '2026-11-13', closed: false, obs: '[NGA:abc123] teste fictício', resp: 'Responsável Fictício' },
  { type: 'TAREFA', title: 'Tarefa fictícia', date: 'sex, 6 de nov 2026', closed: false },
  { type: 'PRAZO', title: 'Prazo fictício concluído', date: 'qui, 25 de jun 2026', iso: '2026-06-25', closed: true, obs: '', resp: 'Outra Pessoa' },
];
let modalOpen = null;
function closeModal() { const e = document.getElementById('modal'); if (e) e.remove(); }
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
function openModal(a) {
  closeModal();
  const d = document.createElement('div'); d.id = 'modal';
  d.innerHTML = '<span id="x">×</span><h2>' + a.type[0] + a.type.slice(1).toLowerCase() + '</h2><div>' + a.title + '</div><div>Data: ' + a.date + '</div>'
    + '<div>Número do processo: ' + PUBS[0].proc + '</div><div>Quadro Kanban: Kanban Padrão</div><div>Responsável: ' + (a.resp || '') + '</div>'
    + (a.obs ? '<div>Observações: ' + a.obs + '</div>' : '') + '<div>Criado por: Alguém</div><div>Atividades</div><div>Checklists</div>';
  d.querySelector('#x').onclick = closeModal;
  document.body.appendChild(d);
}
function folderView(showClosed, tab) {
  const rows = ACTS.filter(a => showClosed || !a.closed);
  const m = document.getElementById('m');
  m.innerHTML = '<h1>Recuperação Judicial Fictícia</h1><div>Processo</div><div>' + PUBS[0].proc + '</div><a href="#r">Resumo</a><a href="#a" id="tab-a">Atividades</a><a href="#h">Histórico</a>'
    + (tab === 'a' ? '<div>2 ABERTAS</div><a href="#c" id="tog">1 concluídas</a>' + rows.map(a => '<div class="row"><h4>' + a.type[0] + a.type.slice(1).toLowerCase() + '</h4><div class="t">' + a.title + '</div><div>' + a.date + '</div><div>Fulano</div></div>').join('') : '');
  m.querySelector('#tab-a').onclick = (e) => { e.preventDefault(); folderView(showClosed, 'a'); };
  const tog = m.querySelector('#tog'); if (tog) tog.onclick = (e) => { e.preventDefault(); folderView(true, 'a'); };
  m.querySelectorAll('.t').forEach((el, i) => el.onclick = () => openModal(rows[i]));
}
const gs = document.getElementById('gs');
gs.oninput = () => { document.getElementById('sug').innerHTML = gs.value && PUBS[0].proc.startsWith(gs.value.slice(0, 7)) ? '<li id="s1">Processo Recuperação Judicial Fictícia - <b>' + PUBS[0].proc + '</b></li>' : ''; const s1 = document.getElementById('s1'); if (s1) s1.onclick = () => { location.hash = '#/main/folders/detail/55'; }; };
window.__mutations = 0;
const COLS = { 'Kanban Padrão': ['A Fazer', 'Fazendo', 'Concluído'], 'FLUXO NGA': ['Entrada', 'Análise', 'Feito'] };
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
function calcDue(startIso, n, unit) {
  const d = new Date(startIso + 'T00:00:00Z'); let c = 1;
  while (c < n) { d.setUTCDate(d.getUTCDate() + 1); const wd = d.getUTCDay(); if (unit === 'runningDays' || (wd !== 0 && wd !== 6)) c++; }
  return d;
}
function mountTreatments(p) {
  const m = document.getElementById('m');
  const box = document.createElement('div');
  box.innerHTML = '<button id="trat">Tratamentos</button><div id="addp" hidden>Adicionar prazo</div><div id="addt" hidden>Adicionar tarefa</div><div id="tslot"></div>'
    + '<div id="form" hidden>'
    + '<div id="calc"></div><input placeholder="Digite o título do prazo" id="ttl"/>'
    + '<input type="number" placeholder="0" id="amt"/><select id="unit"><option value="workingDays">Dias úteis</option><option value="runningDays">Dias corridos</option></select>'
    + '<input placeholder="__/__/____" id="due"/><input type="number" placeholder="0" id="alert"/>'
    + '<input placeholder="Digite o nome do responsável" id="resp" value="Gustavo Brasil"/><div id="sug2"></div>'
    + '<textarea placeholder="Digite observações sobre o prazo"></textarea>'
    + '<select id="board"><option>Nenhum</option><option>Kanban Padrão</option><option>FLUXO NGA</option></select><select id="col"></select>'
    + '<a href="#" id="cancel">Cancelar</a> <a href="#" id="savef">Salvar</a></div>';
  m.appendChild(box);
  const $ = (id) => document.getElementById(id);
  $('trat').onclick = () => { $('addp').hidden = false; $('addt').hidden = false; };
  const TFORM = '<div id="tform"><textarea name="description" placeholder="Digite a descrição da tarefa"></textarea><input name="dueDate" placeholder="Digite a data"/>'
    + '<select name="idCurrentTaskList"><option>Tarefas diárias</option></select><input placeholder="Digite o nome do responsável" id="tresp" value="Gustavo Brasil"/><div id="tsug"></div>'
    + '<select name="priority"><option>Baixa</option><option>Média</option><option>Alta</option></select>'
    + '<select name="kanbanId"><option>Nenhum</option><option>Kanban Padrão</option><option>FLUXO NGA</option></select><select name="kanbanColumnId"><option>Nenhum</option></select>'
    + '<a href="#" id="tcancel">Cancelar</a> <a href="#" id="tsave">Salvar</a></div>';
  $('addt').onclick = () => {
    $('tslot').innerHTML = TFORM; const tf = $('tform');
    tf.querySelector('[name=kanbanId]').onchange = (e) => { tf.querySelector('[name=kanbanColumnId]').innerHTML = (COLS[e.target.value] || ['Nenhum']).map(c => '<option>' + c + '</option>').join(''); };
    $('tcancel').onclick = (e) => { e.preventDefault(); $('tslot').innerHTML = ''; };
    $('tresp').oninput = () => { $('tsug').innerHTML = $('tresp').value ? '<div id="tpick">Camilla Rodrigues c@nga.adv.br</div><div id="tpick2">Victor Fortes v@nga.adv.br</div>' : ''; const pick = (id, name) => { const k = document.getElementById(id); if (k) k.onclick = () => { $('tresp').value = name; $('tsug').innerHTML = ''; }; }; pick('tpick', 'Camilla Rodrigues'); pick('tpick2', 'Victor Fortes'); };
    $('tsave').onclick = (e) => { e.preventDefault(); const g = (n) => tf.querySelector('[name=' + n + ']').value; fetch('/api/save-tarefa', { method: 'POST', body: JSON.stringify({ title: g('description'), due: g('dueDate'), resp: $('tresp').value, priority: g('priority'), board: g('kanbanId'), col: g('kanbanColumnId') }) }).then(() => { $('tslot').innerHTML = ''; }).catch(() => {}); };
  };
  $('addp').onclick = () => { $('form').hidden = false; };
  const recalc = () => {
    const n = Number($('amt').value); if (!n) return;
    const start = '2026-10-23', d = calcDue(start, n, $('unit').value);
    $('due').value = fmt(d);
    $('calc').innerHTML = '<div>Data da publicação</div><div>' + p.pub + '</div><div>Início do prazo</div><div>23/10/2026</div>'
      + '<div>Considerar feriado e recesso</div><div>Dia de Finados - 02/11/2026 (segunda-feira)</div><div>Este cálculo é meramente uma ferramenta de auxílio</div>';
  };
  $('amt').onblur = recalc; $('unit').onchange = recalc;
  $('board').onchange = () => { const cols = COLS[$('board').value] || []; $('col').innerHTML = cols.map(c => '<option>' + c + '</option>').join(''); };
  $('cancel').onclick = (e) => { e.preventDefault(); $('form').hidden = true; };
  $('resp').oninput = () => { $('sug2').innerHTML = $('resp').value ? '<div id="pick">Victor Fortes victor@nga.adv.br</div><div>João Victor joao@nga.adv.br</div>' : ''; const k = document.getElementById('pick'); if (k) k.onclick = () => { $('resp').value = 'Victor Fortes'; $('sug2').innerHTML = ''; }; };
  $('savef').onclick = (e) => {
    e.preventDefault();
    const body = JSON.stringify({ title: $('ttl').value, due: $('due').value, resp: $('resp').value, notes: document.querySelector('textarea').value, board: $('board').value, col: $('col').value, alert: $('alert').value });
    fetch('/api/save-prazo', { method: 'POST', body }).then(() => { const t = document.createElement('div'); t.textContent = 'O prazo foi adicionado'; document.body.appendChild(t); $('form').hidden = true; }).catch(() => {});
  };
}
function prazoDetail(item) {
  const m = document.getElementById('m'); const done = WFS.filter(w => w.title === item.title);
  m.innerHTML = '<div>PRAZO</div><div>' + item.title + '</div>' + (done.length ? '<div>Analisar Intimação + Verificar Providências</div><div>Conferir Protocolo / Renúncia</div>' : '<div>Este prazo ainda não possui atividades</div><button id="addwf">ADICIONAR WORKFLOWS</button><div id="wflist"></div>');
  const b = document.getElementById('addwf'); if (!b) return;
  b.onclick = () => {
    document.getElementById('wflist').innerHTML = ['PRAZO 05 DIAS CORRIDOS', 'PRAZO 10 DIAS CORRIDOS', 'PRAZO 15 DIAS CORRIDOS', 'PRAZO 30 DIAS CORRIDOS'].map(n => '<div data-test="component-predefinedActivity-card">' + n + ' <a href="#" data-test="component-formSubmitButton-discard">Adicionar</a></div>').join('') + '<button data-test="component-predefinedActivityList-cancel">Cancelar</button>';
    document.querySelectorAll('[data-test="component-formSubmitButton-discard"]').forEach(a => a.onclick = (e) => { e.preventDefault(); const name = a.parentElement.textContent.replace('Adicionar', '').trim(); fetch('/api/apply-workflow', { method: 'POST', body: JSON.stringify({ title: item.title, workflow: name }) }).then(() => { WFS.push({ title: item.title, workflow: name }); prazoDetail(item); }).catch(() => {}); });
  };
}
function openKebab(item) {
  document.querySelectorAll('.menu,.dlg').forEach(e => e.remove());
  const menu = document.createElement('div'); menu.className = 'menu'; menu.innerHTML = '<div>Acessar detalhes</div><div>Concluir</div><div class="del">Excluir</div>';
  document.body.appendChild(menu);
  menu.querySelector('.del').onclick = () => {
    menu.remove();
    const dlg = document.createElement('div'); dlg.className = 'dlg';
    dlg.innerHTML = '<div>Excluir prazo</div><div>Você tem certeza que deseja excluir o prazo?</div><a href="#" class="no">CANCELAR</a> <a href="#" class="ok">CONFIRMAR</a>';
    document.body.appendChild(dlg);
    dlg.querySelector('.no').onclick = (e) => { e.preventDefault(); dlg.remove(); };
    dlg.querySelector('.ok').onclick = (e) => { e.preventDefault(); fetch('/api/delete-prazo', { method: 'POST', body: JSON.stringify({ title: item.title }) }).then(() => { dlg.remove(); const t = document.createElement('div'); t.textContent = 'O tratamento foi excluído'; document.body.appendChild(t); }).catch(() => {}); };
  };
}
function loginView(m) {
  m.innerHTML = '<div>ENTRAR</div>' + (CHALLENGE ? '<div>Marque a caixa: não sou um robô (captcha)</div>' : '')
    + '<input placeholder="Digite seu email" id="le"/><input type="password" placeholder="Digite sua senha" id="lp"/><a href="#" id="lgo">ENTRAR</a><div id="lerr"></div>';
  document.getElementById('lgo').onclick = (e) => {
    e.preventDefault();
    const ok = document.getElementById('le').value === 'robo@exemplo.test' && document.getElementById('lp').value === 'senha-fake-123';
    fetch('/api/login-attempt', { method: 'POST', body: JSON.stringify({ ok }) }).finally(() => {
      if (ok) { sessionStorage.setItem('ok', '1'); location.hash = '#/main/clippings'; } else document.getElementById('lerr').textContent = 'Credenciais inválidas';
    });
  };
}
function render() {
  const h = location.hash, m = document.getElementById('m');
  const logged = !REQUIRE_LOGIN || !!sessionStorage.getItem('ok');
  document.getElementById('nav').innerHTML = logged ? '<a href="#/main/clippings">Publicações</a>' : '';
  if (!logged) { if (!h.startsWith('#/login')) { location.hash = '#/login/'; return; } loginView(m); return; }
  if (h.startsWith('#/main/folders/detail')) { folderView(false, ''); return; }
  if (h.startsWith('#/main/clippings-treatment')) {
    const id = new URLSearchParams(h.split('?')[1]).get('id'); const p = PUBS.find(x => x.id === id);
    const treated = !!localStorage.getItem('treated:' + id);
    m.innerHTML = '<h1>Publicação</h1><div>' + (treated ? 'TRATADA' : 'NÃO TRATADA') + '</div>' + (treated ? '' : '<button id="concl">CONCLUIR</button>') + '<div>Diario Fictício - DJN</div><div>Divulgado em: ' + p.date + ' - Publicado em: ' + p.pub + '</div><div>Processo: ' + p.proc + '</div><div>Diário: TJXXDJN</div>'
      + '<pre>Publicação\\nProcesso: ' + p.proc + '\\nÓrgão: Vara Fictícia\\nData de disponibilização: ' + p.date + '\\nTipo de comunicação: Intimação\\nConteúdo: ' + p.text + '</pre>'
      + '<div>IA</div><div>TRATAMENTOS SUGERIDOS</div>' + (p.hint ? '<div>PRAZO</div><div>Ciência fictícia</div><div>Sex, 13 De Nov 2026 | Responsável Fictício</div>' : '')
      + '<div>PROCESSO</div><div>Cliente: ' + p.client + '</div><div>Responsável: Responsável Fictício</div>'
      + '<button id="save">Salvar</button>';
    const cb = document.getElementById('concl'); if (cb) cb.onclick = () => { localStorage.setItem('treated:' + id, '1'); location.reload(); };
    document.getElementById('save').onclick = () => fetch('/api/save', { method: 'POST', body: '{}' }).catch(() => { window.__mutations++; });
    mountTreatments(p);
    if (TASKS.length) { const tc = document.createElement('div'); tc.innerHTML = TASKS.map(x => '<div class="card"><div>Tarefa</div><div>' + x.title + '</div><div>' + x.due + '</div></div>').join(''); document.getElementById('m').appendChild(tc); }
    if (SAVED.length) { const c = document.createElement('div'); c.innerHTML = '<div>TRATAMENTOS</div>' + SAVED.map(x => '<div class="card" data-test="component-clippingTreatment-eventCard"><i role="button" aria-label="action button" class="fa-pencil pencil" style="display:inline-block;width:24px;height:24px">✎</i><i class="fa fa-ellipsis-v kebab" style="display:inline-block;width:24px;height:24px">⋮</i><div>Prazo</div><div>' + x.title + '</div><div>Data:</div><div>' + ptDate(x.due) + '</div><div>Responsável:</div><div>' + x.resp + '</div><div>Quadro Kanban:</div><div>' + x.board + '</div><div>Coluna:</div><div>' + x.col + '</div><div>Observações:</div><div>' + x.notes + '</div><a href="#" class="detalhes">Acessar detalhes</a></div>').join(''); c.querySelectorAll('.kebab').forEach((k, i) => k.onclick = () => openKebab(SAVED[i])); c.querySelectorAll('.detalhes').forEach((k, i) => k.onclick = (e) => { e.preventDefault(); prazoDetail(SAVED[i]); }); document.getElementById('m').appendChild(c); }
  } else {
    m.innerHTML = '<h1>Publicações</h1><div>status: Não tratada</div><div id="empty">Nenhuma publicação encontrada</div>';
    setTimeout(() => { if (!location.hash.startsWith('#/main/clippings') || location.hash.startsWith('#/main/clippings-treatment')) return; m.innerHTML = '<h1>Publicações</h1><div>status: Não tratada</div><div>Mostrando ' + PUBS.length + ' publicações</div>' + LIST; m.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => { location.hash = '#/main/clippings-treatment?id=' + b.dataset.id; }); }, 700);
    return;
    m.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => { location.hash = '#/main/clippings-treatment?id=' + b.dataset.id; });
  }
}
addEventListener('hashchange', render); render();
</script></body></html>`;

export function serve(opts: { requireLogin?: boolean; challenge?: boolean; hangFirst?: number } = {}): { url: string; stop: () => void; posts: string[]; saved: Array<Record<string, string>>; tasks: Array<Record<string, string>>; workflows: Array<Record<string, string>>; loginAttempts: boolean[] } {
  const posts: string[] = [];
  const loginAttempts: boolean[] = [];
  const tasks: Array<Record<string, string>> = [];
  const workflows: Array<Record<string, string>> = [];
  let hung = 0;
  const saved: Array<Record<string, string>> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method !== 'GET') {
        posts.push(`${req.method} ${new URL(req.url).pathname}`);
        if (new URL(req.url).pathname === '/api/login-attempt') loginAttempts.push(JSON.parse(await req.text()).ok);
        if (new URL(req.url).pathname === '/api/save-prazo') saved.push(JSON.parse(await req.text()));
        if (new URL(req.url).pathname === '/api/save-tarefa') tasks.push(JSON.parse(await req.text()));
        if (new URL(req.url).pathname === '/api/apply-workflow') workflows.push(JSON.parse(await req.text()));
        if (new URL(req.url).pathname === '/api/delete-prazo') { const t = JSON.parse(await req.text()).title; const k = saved.findIndex((x) => x.title === t); if (k >= 0) saved.splice(k, 1); }
        return new Response('{}');
      }
      if (opts.hangFirst && hung < opts.hangFirst && new URL(req.url).pathname === '/') { hung++; return new Promise<Response>(() => {}); } // simula conexão presa
      return new Response(html.replace('__SAVED__', JSON.stringify(saved)).replace('__TASKS__', JSON.stringify(tasks)).replace('__WFS__', JSON.stringify(workflows)).replace('__LOGIN__', String(!!opts.requireLogin)).replace('__CHALLENGE__', String(!!opts.challenge)), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/`, stop: () => server.stop(true), posts, saved, tasks, workflows, loginAttempts };
}
