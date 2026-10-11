/* Casca do Gerador NGA: login (Supabase Auth), perfil, ponte de sessão para o gerador original e administração.
   O gerador roda num iframe do mesmo site; ele pede o token por postMessage (contrato do módulo "nuvem" do original).
   Todas as permissões de verdade são aplicadas pelo banco (RLS); a tela só reflete o que o banco permite. */
(function () {
  'use strict';
  var cfg = window.NGA_SHELL_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var MAPA = { admin: 'admin', advogado: 'operador', visualizador: 'leitor' };   // papel do banco -> nível do gerador original
  var sb = null, perfil = null, quadro = null, ultimaAtividade = Date.now(), emRecuperacao = false;
  var hashInicial = location.hash || '';
  var falhas = 0;

  window.NGA_SHELL_CFG = { url: cfg.url, key: cfg.key };

  function mostrar(qual) {
    ['form-login', 'form-nova-senha', 'bloqueio', 'config-faltando'].forEach(function (id) { $(id).hidden = id !== qual; });
    $('entrada').hidden = false; $('gerador').hidden = true; $('admin').hidden = true;
  }
  function msg(el, texto) { el.textContent = texto || ''; el.hidden = !texto; }

  // dados do gerador guardados neste navegador não podem sobrar para a próxima pessoa que usar o computador
  function limparLocal() {
    try { indexedDB.deleteDatabase('nga_plataforma'); } catch (e) {}
    try {
      Object.keys(localStorage).filter(function (k) { return /^(nga[._]|nga_)/.test(k); }).forEach(function (k) { localStorage.removeItem(k); });
      sessionStorage.clear();
    } catch (e) {}
  }

  async function sair() {
    try { await sb.auth.signOut(); } catch (e) {}
    limparLocal();
    location.replace(location.pathname);
  }

  /* ---------------------------------------------------------------- entrada */
  async function entrar(sessao) {
    var r = await sb.from('perfis').select('user_id,email,nome,papel,ativo').eq('user_id', sessao.user.id).maybeSingle();
    perfil = r.data;
    if (r.error || !perfil || !perfil.ativo) {
      msg($('bloqueio-msg'), !perfil
        ? 'Seu usuário ainda não foi liberado pelo administrador do escritório.'
        : 'Seu acesso está desativado. Fale com o administrador do escritório.');
      mostrar('bloqueio'); return;
    }
    try { await sb.rpc('registrar_acesso'); } catch (e) {}
    try {
      if (localStorage.getItem('nga.shell.uid') !== perfil.user_id) { limparLocal(); }
      localStorage.setItem('nga.shell.uid', perfil.user_id);
      sessionStorage.setItem('nga_auth_session_v1', JSON.stringify({ email: perfil.email, role: MAPA[perfil.papel], logadoEm: new Date().toISOString() }));
      sessionStorage.setItem('nga.acesso.sessao', '1');   // a trava de PIN do original não se aplica: o acesso é por usuário
    } catch (e) {}
    $('entrada').hidden = true;
    var f = $('gerador');
    if (!f.getAttribute('src')) f.setAttribute('src', 'app/gerador.html');
    f.hidden = false;
  }

  async function iniciar() {
    if (!cfg.url || !cfg.key) { mostrar('config-faltando'); return; }
    sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    var convite = /type=(invite|recovery)/.test(hashInicial);
    sb.auth.onAuthStateChange(function (ev) {
      if (ev === 'PASSWORD_RECOVERY') { emRecuperacao = true; $('nova-titulo').textContent = 'Defina sua nova senha'; mostrar('form-nova-senha'); }
      if (ev === 'SIGNED_OUT' && perfil) { perfil = null; mostrar('form-login'); }
    });
    var s = (await sb.auth.getSession()).data.session;
    if (convite && s) { emRecuperacao = true; $('nova-titulo').textContent = /type=invite/.test(hashInicial) ? 'Defina sua senha de acesso' : 'Defina sua nova senha'; history.replaceState(null, '', location.pathname); mostrar('form-nova-senha'); return; }
    if (s) await entrar(s); else mostrar('form-login');
  }

  $('form-login').addEventListener('submit', async function (e) {
    e.preventDefault();
    var b = $('login-entrar'); msg($('login-erro'), '');
    var email = $('login-email').value.trim().toLowerCase(), senha = $('login-senha').value;
    if (!email || !senha) { msg($('login-erro'), 'Informe e-mail e senha.'); return; }
    b.disabled = true; b.textContent = 'Verificando...';
    if (falhas) await new Promise(function (r) { setTimeout(r, Math.min(8000, 800 * Math.pow(2, falhas - 1))); });   // freio contra tentativas em série
    var r = await sb.auth.signInWithPassword({ email: email, password: senha });
    b.disabled = false; b.textContent = 'Entrar no Sistema';
    if (r.error || !r.data.session) {
      falhas++;
      msg($('login-erro'), 'E-mail ou senha incorretos.');   // mesma mensagem para qualquer causa: não revela se o e-mail existe
      return;
    }
    falhas = 0; $('login-senha').value = '';
    await entrar(r.data.session);
  });

  $('login-esqueci').addEventListener('click', async function () {
    var email = $('login-email').value.trim().toLowerCase();
    if (!email) { msg($('login-erro'), 'Digite seu e-mail e clique de novo em "Esqueci minha senha".'); return; }
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    msg($('login-erro'), 'Se o e-mail estiver cadastrado, enviaremos um link para criar uma nova senha.');
  });

  $('form-nova-senha').addEventListener('submit', async function (e) {
    e.preventDefault(); msg($('nova-erro'), '');
    var a = $('nova-senha').value, b = $('nova-senha2').value;
    if (a.length < 12) { msg($('nova-erro'), 'Use ao menos 12 caracteres.'); return; }
    if (a !== b) { msg($('nova-erro'), 'As senhas não coincidem.'); return; }
    var r = await sb.auth.updateUser({ password: a });
    if (r.error) { msg($('nova-erro'), 'Não foi possível salvar a senha. Peça um novo link ao administrador.'); return; }
    emRecuperacao = false; $('nova-senha').value = ''; $('nova-senha2').value = '';
    await entrar((await sb.auth.getSession()).data.session);
  });
  $('bloqueio-sair').addEventListener('click', sair);

  /* ------------------------------------------- ponte com o gerador (iframe) */
  window.addEventListener('message', async function (ev) {
    var f = $('gerador');
    if (ev.origin !== location.origin || ev.source !== f.contentWindow || !ev.data || !ev.data.nga) return;
    if (ev.data.nga === 'token') {
      var s = (await sb.auth.getSession()).data.session;   // renovado automaticamente pelo cliente do Supabase
      ev.source.postMessage({ nga: 'token', token: s ? s.access_token : null }, location.origin);
    } else if (ev.data.nga === 'logout') { sair(); }
    else if (ev.data.nga === 'admin') { if (perfil && perfil.papel === 'admin') abrirAdmin(); }
  });

  /* ------------------------------------------------------------ inatividade */
  ['mousemove', 'keydown', 'click', 'touchstart'].forEach(function (t) { document.addEventListener(t, function () { ultimaAtividade = Date.now(); }, { passive: true }); });
  window.addEventListener('message', function (ev) { if (ev.origin === location.origin && ev.source === $('gerador').contentWindow) ultimaAtividade = Date.now(); });
  setInterval(function () {
    if (perfil && Date.now() - ultimaAtividade > (cfg.inatividadeMin || 30) * 60000) sair();
  }, 30000);
  // o iframe é do mesmo site: atividade lá dentro também conta
  $('gerador').addEventListener('load', function () {
    try { var d = $('gerador').contentDocument; ['mousemove', 'keydown', 'click', 'touchstart'].forEach(function (t) { d.addEventListener(t, function () { ultimaAtividade = Date.now(); }, { passive: true }); }); } catch (e) {}
  });

  /* ----------------------------------------------------------- administração */
  var ROTULO = { admin: 'Administrador', advogado: 'Advogado', visualizador: 'Visualizador' };
  function td(txt) { var c = document.createElement('td'); c.textContent = txt == null ? '' : txt; return c; }
  function quando(v) { return v ? new Date(v).toLocaleString('pt-BR') : '—'; }

  async function abrirAdmin() { $('admin').hidden = false; await listarUsuarios(); }
  $('admin-fechar').addEventListener('click', function () { $('admin').hidden = true; });
  document.querySelectorAll('.aba').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.aba').forEach(function (x) { x.classList.toggle('ativa', x === b); });
      $('aba-usuarios').hidden = b.dataset.aba !== 'usuarios'; $('aba-auditoria').hidden = b.dataset.aba !== 'auditoria';
      if (b.dataset.aba === 'auditoria') listarAuditoria();
    });
  });

  async function listarUsuarios() {
    var r = await sb.from('perfis').select('user_id,email,nome,papel,ativo,ultimo_acesso').order('nome');
    var tb = $('tb-usuarios'); tb.textContent = '';
    if (r.error) { msg($('admin-msg'), 'Não foi possível carregar os usuários.'); return; }
    r.data.forEach(function (p) {
      var tr = document.createElement('tr'), eu = p.user_id === perfil.user_id;
      tr.appendChild(td(p.nome)); tr.appendChild(td(p.email));
      var c1 = document.createElement('td'), sel = document.createElement('select');
      Object.keys(ROTULO).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = ROTULO[k]; if (k === p.papel) o.selected = true; sel.appendChild(o); });
      sel.disabled = eu; sel.setAttribute('aria-label', 'Perfil de ' + p.email);
      sel.addEventListener('change', async function () { await alterar(p, { papel: sel.value }); });
      c1.appendChild(sel); tr.appendChild(c1);
      var c2 = document.createElement('td'), ativo = document.createElement('select');
      [['true', 'Ativo'], ['false', 'Desativado']].forEach(function (a) { var o = document.createElement('option'); o.value = a[0]; o.textContent = a[1]; if ((a[0] === 'true') === p.ativo) o.selected = true; ativo.appendChild(o); });
      ativo.disabled = eu; ativo.setAttribute('aria-label', 'Situação de ' + p.email);
      ativo.addEventListener('change', async function () { await alterar(p, { ativo: ativo.value === 'true' }); });
      c2.appendChild(ativo); tr.appendChild(c2);
      tr.appendChild(td(quando(p.ultimo_acesso)));
      tb.appendChild(tr);
    });
  }
  async function alterar(p, campos) {
    var r = await sb.from('perfis').update(campos).eq('user_id', p.user_id).select('user_id');
    msg($('admin-msg'), r.error || !r.data.length ? 'Alteração recusada: ' + (r.error ? r.error.message : 'sem permissão.') : 'Alteração salva.');
    await listarUsuarios();
  }
  $('form-convite').addEventListener('submit', async function (e) {
    e.preventDefault();
    var nome = $('conv-nome').value.trim(), email = $('conv-email').value.trim().toLowerCase(), papel = $('conv-papel').value;
    if (!nome || !email) { msg($('admin-msg'), 'Informe nome e e-mail.'); return; }
    var r = await sb.functions.invoke('convidar-usuario', { body: { nome: nome, email: email, papel: papel } });
    if (r.error) { msg($('admin-msg'), 'Não foi possível convidar. Confira o e-mail e tente de novo.'); return; }
    msg($('admin-msg'), 'Convite enviado para ' + email + '.'); $('conv-nome').value = ''; $('conv-email').value = '';
    await listarUsuarios();
  });
  async function listarAuditoria() {
    var r = await sb.from('auditoria').select('em,email,acao,colecao,doc_id').order('em', { ascending: false }).limit(200);
    var tb = $('tb-auditoria'); tb.textContent = '';
    (r.data || []).forEach(function (a) {
      var tr = document.createElement('tr');
      tr.appendChild(td(quando(a.em))); tr.appendChild(td(a.email || '—')); tr.appendChild(td(a.acao)); tr.appendChild(td([a.colecao, a.doc_id].filter(Boolean).join(' / ')));
      tb.appendChild(tr);
    });
  }

  iniciar();
})();
