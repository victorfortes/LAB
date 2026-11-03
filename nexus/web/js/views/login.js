/**
 * Tela de entrada. Mesma linguagem do deck do NGA Lab: fundo escuro com grade,
 * brilho âmbar, rede de partículas — e as ferramentas do ecossistema à vista,
 * porque é isto que o sistema é: um conjunto de ferramentas sob um só acesso.
 */
import { $, html, icone, raw } from '../util.js';
import { api } from '../api.js';
import { fundo, brilho } from '../fx.js';

export function mostrarLogin(aoEntrar) {
  document.body.innerHTML = html`
    <div class="wall" aria-hidden="true"><div class="wall__grid"></div><div class="wall__glow a"></div><div class="wall__glow b"></div><canvas id="fx"></canvas><div class="wall__scan"></div></div>
    <main class="login">
      <section class="login__hero">
        <img class="login__logo" src="/img/nga-adv.png" alt="NGA Advogados" width="200" height="55"><span class="login__eyebrow">Insolvência · Reestruturação</span>
        <h1>O ecossistema<br><em>NGA LAB</em></h1>
        <p>Gestão de projetos, painel do advogado, portal do cliente e todas as ferramentas do Lab — num só lugar, sob o mesmo acesso.</p>
        <div class="login__tools">
          ${['Gestão de projetos', 'Prazos', 'Íntegra', 'Sentinela', 'Análise documental', 'Portal do cliente', 'Relatórios'].map((t, i) => html`<span style="--i:${i}">${t}</span>`)}
        </div>
      </section>
      <section class="login__box card glass up">
        <div>
          <h2>Entrar</h2>
          <p class="card__sub">Use o e-mail e a senha que a NGA lhe passou.</p>
        </div>
        <form id="lf" class="stack" style="gap:14px" novalidate>
          <label class="field"><span>E-mail</span><input class="input" name="email" type="email" autocomplete="username" required autofocus></label>
          <label class="field"><span>Senha</span><input class="input" name="senha" type="password" autocomplete="current-password" required></label>
          <div class="modal__err" id="lerr" role="alert"></div>
          <button class="btn btn--accent" type="submit" style="justify-content:center;padding:13px">${icone('lock')} Entrar</button>
        </form>
        <p class="dica">Acesso restrito. Cada cliente enxerga somente o próprio processo.</p>
      </section>
    </main>`.toString();
  fundo(); brilho();

  const form = $('#lf');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form); const err = $('#lerr');
    const email = form.elements.email.value.trim(); const senha = form.elements.senha.value;
    if (!email || !senha) { err.textContent = 'Informe e-mail e senha.'; return; }
    btn.disabled = true; btn.lastChild.textContent = ' Entrando…'; err.textContent = '';
    try {
      await api.post('/api/sessao', { email, senha });
      aoEntrar();
    } catch (ex) {
      err.textContent = ex.message; btn.disabled = false; btn.lastChild.textContent = ' Entrar';
      form.elements.senha.select();
      const box = $('.login__box'); box.classList.remove('volta'); void box.offsetWidth; box.classList.add('volta');
    }
  });
}
