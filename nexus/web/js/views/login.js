/** Lobby de entrada baseado na capa original do NGA NEXUS. A autenticação continua pela mesma API. */
import { $, html, icone } from '../util.js';
import { api } from '../api.js';
import { lobbyOrbita, ligarLobby } from '../lobby.js';
import { fundo } from '../fx.js';
import { modal } from '../ui.js';

export function mostrarLogin(aoEntrar) {
  const orbitais=[['tarefas','Tarefas','check'],['prazos','Calendário','calendar'],['radar','Radar concursal','target'],['creditos','Créditos','scale'],['analise','Análise documental','sparkle'],['integra','Íntegra','file'],['relatorios','Relatórios','chart'],['projetos','Projetos','folder'],['pesquisa','Pesquisa','search'],['controladoria','Controladoria','inbox'],['sentinela','Sentinela','radar'],['portal','Portal do cliente','comment']].map(([id,nome,icone])=>({id,nome,icone,href:'#/painel'}));
  document.body.innerHTML=html`
    <div class="wall" aria-hidden="true"><div class="wall__grid"></div><div class="wall__glow a"></div><div class="wall__glow b"></div><canvas id="fx"></canvas><div class="wall__scan"></div></div>
    <main class="login-cover">
      <section class="login-cover__copy">
        <img class="login-cover__logo" src="/img/nga-adv.png" alt="NGA Advogados" width="200" height="55">
        <span class="login-cover__eyebrow">INSOLVÊNCIA · REESTRUTURAÇÃO</span>
        <h1>O ecossistema<br><em>NGA NEXUS</em></h1>
        <p class="login-cover__tag">Inteligência, organização e tecnologia<br>para o trabalho jurídico.</p>
        <p class="login-cover__description">Projetos, tarefas, documentos e ferramentas conectados. Um ambiente para a equipe e um portal exclusivo para cada cliente.</p>
        <div class="login-cover__actions"><button class="btn btn--accent" type="button" data-entrar>${icone('arrowUpRight')}Entrar no NGA NEXUS</button><span>Acesso da equipe e dos clientes</span></div>
        <div class="login-cover__chips"><span>GESTÃO DE PROJETOS</span><span>FERRAMENTAS DO LAB</span><span>PORTAL DO CLIENTE</span></div>
      </section>
      <section class="login-cover__visual" aria-label="Ferramentas do ecossistema">
        ${lobbyOrbita({itens:orbitais,titulo:'Ecossistema NGA NEXUS',chave:'login',acessoRestrito:true})}
      </section>
      <footer class="login-cover__footer"><span>NGA NEXUS · ECOSSISTEMA JURÍDICO</span><span>Um acesso. O ambiente do seu trabalho.</span></footer>
    </main>`.toString();
  fundo();
  let entradaAberta=false;
  const abrirEntrada=async()=>{
    if(entradaAberta){$('#lf input[name=email]')?.focus();return;}
    entradaAberta=true;
    try {
      await modal({titulo:'Entrar no NGA NEXUS',subtitulo:'Use o e-mail e a senha que a NGA lhe passou.',
        corpo:String(html`<form id="lf" class="stack" style="gap:14px" novalidate><label class="field"><span>E-mail</span><input class="input" name="email" type="email" autocomplete="username" required autofocus></label><label class="field"><span>Senha</span><input class="input" name="senha" type="password" autocomplete="current-password" required></label><div class="modal__err" id="lerr" role="alert"></div><button class="btn btn--accent" type="submit" style="justify-content:center;padding:13px">${icone('lock')}<span data-login-rotulo>Entrar</span></button><p class="dica">Acesso restrito. Cada cliente enxerga somente o próprio projeto.</p></form>`),
        acoes:[{id:'cancelar',rotulo:'Voltar ao lobby'}],
        aoAbrir(el){
          el.addEventListener('acao',()=>el.fechar(null));
          const form=$('#lf',el);
          form.addEventListener('submit',async e=>{
            e.preventDefault();const btn=$('button[type=submit]',form),err=$('#lerr',el),rotulo=$('[data-login-rotulo]',form);
            const email=form.elements.email.value.trim(),senha=form.elements.senha.value;
            if(!email||!senha){err.textContent='Informe e-mail e senha.';return;}
            btn.disabled=true;rotulo.textContent='Entrando…';err.textContent='';
            try {await api.post('/api/sessao',{email,senha});el.fechar(true);aoEntrar();}
            catch(ex){err.textContent=ex.message;btn.disabled=false;rotulo.textContent='Entrar';form.elements.senha.select();}
          });
        },
      });
    } finally {entradaAberta=false;}
  };
  $('[data-entrar]').addEventListener('click',abrirEntrada);
  ligarLobby(document,orbitais,abrirEntrada);
}
