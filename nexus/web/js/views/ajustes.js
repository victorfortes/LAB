/**
 * Ajustes: tudo o que o escritório configura, e tudo editável.
 *
 *  Geral · conta, Google, integrações, efeitos
 *  Acessos · a matriz de quem entra onde
 *  Fluxos · fluxogramas desenhados na tela (arrastar, ligar, renomear)
 *  Linhas do tempo · etapas com prazo relativo, aplicáveis a um projeto (viram marcos)
 *  Automações · "quando acontecer X, criar a tarefa Y" (fase iniciada, fatura paga, documento recebido...)
 */
import { api } from '../api.js';
import { estado, pode, ROTULO_DO_PAPEL } from '../estado.js';
import { dataBR, esc, guardado, html, icone, ouvir, raw, relativo } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, modal, toast, vazio } from '../ui.js';
import { navegar } from '../shell.js';

const ESCOPOS = { 'processos': ['processos'], 'prazos': ['prazos'], 'documentos': ['documentos'], 'processos+documentos': ['processos', 'documentos'], 'todos': ['processos', 'prazos', 'documentos'], 'automação do Astrea (BI de Prazos + publicações)': ['agenda', 'publicacoes'] };
const ABAS = [['geral', 'Geral'], ['acessos', 'Acessos'], ['fluxos', 'Fluxos'], ['tempo', 'Linhas do tempo'], ['automacoes', 'Automações'], ['slack', 'Slack'], ['credenciais', 'Credenciais']];
const GATILHO = { projeto_criado: 'Quando um projeto for criado', fase_iniciada: 'Quando uma fase começar', documento_cliente_enviado: 'Quando o cliente enviar um documento', fatura_criada: 'Quando uma fatura for emitida', fatura_paga: 'Quando uma fatura for paga' };
let abertoFluxo = null; let abertoTempo = null;

/** O Google volta para cá com o código no fragmento: conclui na mesma origem e tira o código do histórico. */
async function concluirGoogle() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  if (!q.has('googleCode') && !q.has('googleErro')) return;
  history.replaceState(null, '', '#/ajustes');
  if (q.has('googleErro')) { toast(q.get('googleErro'), 'erro'); return; }
  try { await api.post('/api/google/finalizar', { code: q.get('googleCode'), state: q.get('googleState') }); toast('Conta Google conectada'); }
  catch (e) { erroDe(e); }
}

/** Slack do escritório: app, bot dos avisos e regras de aviso (prazos, tarefas, reuniões, Sentinela). */
async function ajustesSlack() {
  const st = await api.get('/api/slack/estado');
  const gere = pode('config.gerir'); const admin = pode('admin.gerir');
  const [regras, envios, canais] = await Promise.all([api.get('/api/slack/regras').catch(() => []), gere ? api.get('/api/slack/envios').catch(() => []) : [], gere && st.botConectado ? api.get('/api/slack/canais').catch(() => []) : []]);
  const retorno = `${location.origin}/api/slack/callback`;
  const passo = (n, t, ok) => html`<li class="${ok ? 'ok' : ''}"><span>${ok ? '✓' : n}</span><div>${t}</div></li>`;
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Slack do escritório</h2><p class="card__sub">Aba Slack com a conta de cada pessoa e avisos automáticos pelo bot.</p></div>
        <div class="nx-acts">${st.botConectado ? html`<button class="btn btn--ghost btn--sm" data-teste-slack>Mandar teste para mim</button>` : ''}<a class="btn btn--accent btn--sm" href="#/slack">Abrir a aba Slack</a></div></header>
      <ol class="sk-passos">
        ${passo(1, html`<b>Criar o app do Slack</b> em <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">api.slack.com/apps</a> → Create New App → From scratch, no workspace NGA. Em <i>OAuth &amp; Permissions</i>, cadastre o Redirect URL <code>${retorno}</code> e os escopos abaixo.`, st.appConfigurado)}
        ${passo(2, html`<b>Colar aqui o Client ID e o Client Secret</b> (Basic Information → App Credentials). O secret é cifrado no servidor.${admin ? html` <button class="link" data-app-slack>${st.appConfigurado ? 'Trocar' : 'Informar'} credenciais</button>` : ' (administração)'}`, st.appConfigurado)}
        ${passo(3, html`<b>A administração conecta o Slack</b> na aba Slack: isso instala o bot que manda os avisos.`, st.botConectado)}
        ${passo(4, html`<b>Cada pessoa conecta a própria conta</b> na aba Slack. Hoje: ${st.pessoasConectadas} pessoa(s). Quem não conectar recebe os avisos pelo e-mail igual ao do Slack.`, st.pessoasConectadas > 1)}</ol>
      <details class="mt"><summary class="link">Escopos para colar no app</summary><p class="dica"><b>Bot Token Scopes:</b> <code>chat:write, chat:write.public, users:read, users:read.email, channels:read, groups:read, im:write</code></p>
        <p class="dica"><b>User Token Scopes:</b> <code>channels:read, channels:history, groups:read, groups:history, im:read, im:history, mpim:read, mpim:history, users:read, chat:write</code></p></details></section>
    <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Avisos automáticos</h2><p class="card__sub">A rotina roda a cada 5 minutos e nunca manda o mesmo aviso duas vezes. Mensagem direta vai para o responsável; o canal recebe uma cópia.</p></div></header>
      ${regras.length ? html`<div class="tbl-wrap"><table class="tbl sk-regras"><thead><tr><th>Aviso</th><th>Ligado</th><th>Direto ao responsável</th><th>Canal</th><th>A partir de</th></tr></thead><tbody>${regras.map((r) => html`<tr data-regra="${r.id}">
          <td><b>${r.rotulo}</b></td>
          <td><label class="toggle"><input type="checkbox" data-campo="ativo" ${r.ativo ? 'checked' : ''} ${gere ? '' : 'disabled'}><span></span></label></td>
          <td><label class="toggle"><input type="checkbox" data-campo="dmResponsavel" ${r.dmResponsavel ? 'checked' : ''} ${gere ? '' : 'disabled'}><span></span></label></td>
          <td>${canais.length ? html`<select class="select" data-campo="canal" ${gere ? '' : 'disabled'}><option value="">Sem canal</option>${canais.map((c) => html`<option value="${c.id}" data-nome="${c.nome}" ${c.id === r.canalId ? 'selected' : ''}>${c.privado ? '🔒' : '#'}${c.nome}${c.membro ? '' : ' (convide o bot)'}</option>`)}</select>` : html`<span class="dica">${r.canalNome ? `#${r.canalNome}` : st.botConectado ? 'nenhum canal visível' : 'instale o bot'}</span>`}</td>
          <td>${['reuniao_30min', 'tarefa_atribuida', 'sentinela_nova_acao'].includes(r.evento) ? html`<span class="dica">na hora</span>` : html`<select class="select" data-campo="hora" ${gere ? '' : 'disabled'}>${Array.from({ length: 16 }, (_, h) => h + 6).map((h) => html`<option value="${h}" ${h === r.hora ? 'selected' : ''}>${h}h</option>`)}</select>`}</td></tr>`)}</tbody></table></div>` : html`<p class="dica">Sem regras.</p>`}</section>
    ${gere ? html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Últimos avisos enviados</h2></div></header>
      ${envios.length ? html`<ul class="lista">${envios.map((e) => html`<li><span class="selo ${e.ok ? 'ok' : 'erro'}">${e.ok ? 'enviado' : 'falhou'}</span><div><b>${e.texto.split('\n')[0].replace(/\*/g, '')}</b><small>${relativo(e.enviadoEm)}${e.erro ? ` · ${e.erro}` : ''}</small></div></li>`)}</ul>` : html`<p class="dica">Nenhum aviso enviado ainda.</p>`}</section>` : ''}`,
    depois(el) {
      ouvir(el, 'click', '[data-app-slack]', async () => {
        const ok = await formulario({ titulo: 'App do Slack', subtitulo: 'Basic Information → App Credentials', rotulo: 'Salvar', campos: [{ nome: 'clientId', rotulo: 'Client ID', obrigatorio: true, valor: st.clientId ?? '' }, { nome: 'clientSecret', rotulo: 'Client Secret', tipo: 'password', obrigatorio: true, autocomplete: 'off' }],
          async enviar(v) { await api.put('/api/slack/app', v); } });
        if (ok) { toast('App do Slack salvo (secret cifrado)'); navegar(); }
      });
      ouvir(el, 'click', '[data-teste-slack]', async (b) => { b.disabled = true; try { await api.post('/api/slack/teste', {}); toast('Mensagem de teste enviada no seu Slack'); } catch (e) { erroDe(e); } finally { b.disabled = false; } });
      ouvir(el, 'change', '[data-campo]', async (c) => {
        const id = c.closest('[data-regra]').dataset.regra; const campo = c.dataset.campo; let corpo;
        if (campo === 'canal') corpo = { canalId: c.value || null, canalNome: c.value ? c.selectedOptions[0].dataset.nome : null };
        else if (campo === 'hora') corpo = { hora: Number(c.value) }; else corpo = { [campo]: c.checked };
        try { await api.patch(`/api/slack/regras/${id}`, corpo); toast('Regra salva'); } catch (e) { erroDe(e); }
      });
    },
  };
}

/** Cofre: a senha do Astrea é cifrada no servidor (AES-256-GCM) e nunca volta para a tela. */
async function credenciais() {
  if (!pode('admin.gerir')) return { html: html`<section class="card glass up">${vazio('lock', 'Só a administração', 'As credenciais de sistemas externos ficam com a sócia administradora.')}</section>` };
  const lista = await api.get('/api/cofre').catch(() => []);
  const astrea = lista.find((c) => c.servico === 'astrea');
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Acesso ao Astrea</h2><p class="card__sub">Guardado cifrado no servidor. Ninguém consegue ler a senha pela tela, nem pela API; só as rotinas internas usam.</p></div>
      <div class="nx-acts"><button class="btn btn--accent btn--sm" data-cofre>${icone('lock')}${astrea ? 'Trocar credencial' : 'Guardar credencial'}</button>${astrea ? html`<button class="btn btn--ghost btn--sm perigo-btn" data-cofre-del>Remover</button>` : ''}</div></header>
      ${astrea ? html`<ul class="lista"><li><span class="selo ok">cifrada</span><div><b>${astrea.usuario}</b><small>atualizada ${relativo(astrea.atualizadoEm)}${astrea.atualizadoPor ? ` por ${astrea.atualizadoPor}` : ''}</small></div></li></ul>` : html`<p class="dica">Nenhuma credencial guardada.</p>`}
      <p class="dica mt">Senha que já foi enviada por chat ou e-mail deve ser trocada no Astrea antes de ser guardada aqui.</p></section>`,
    depois(el) {
      ouvir(el, 'click', '[data-cofre]', async () => {
        const ok = await formulario({ titulo: 'Acesso ao Astrea', subtitulo: 'A senha é cifrada antes de ir para o banco.', rotulo: 'Guardar', campos: [
          { nome: 'usuario', rotulo: 'Usuário (e-mail)', tipo: 'email', obrigatorio: true, autocomplete: 'off' },
          { nome: 'senha', rotulo: 'Senha', tipo: 'password', obrigatorio: true, autocomplete: 'new-password' }],
          async enviar(v) { await api.put('/api/cofre', { servico: 'astrea', usuario: v.usuario, senha: v.senha }); } });
        if (ok) { toast('Credencial guardada cifrada'); navegar(); }
      });
      ouvir(el, 'click', '[data-cofre-del]', async () => { if (!(await confirmar('Remover a credencial do Astrea?', 'As rotinas que dependem dela param de funcionar.', { rotulo: 'Remover', perigo: true }))) return; try { await api.del('/api/cofre/astrea'); navegar(); } catch (e) { erroDe(e); } });
    },
  };
}

export default async function ajustes({ aba = 'geral' } = {}) {
  await concluirGoogle();
  if (!ABAS.some(([id]) => id === aba)) aba = 'geral';
  const corpo = await ({ geral, acessos, fluxos, tempo, automacoes, credenciais, slack: ajustesSlack }[aba])();
  return {
    titulo: 'Ajustes',
    html: html`${cabecalho({ titulo: 'Ajustes', sub: 'Conta, acessos, fluxos, linhas do tempo e automações do escritório' })}
      <div class="tabs glass glass--chrome mt up" role="tablist" id="abas-ajustes"><span class="tabs__pill" aria-hidden="true"></span>${ABAS.map(([id, t]) => html`<button type="button" role="tab" data-aba="${id}" aria-selected="${id === aba}">${t}</button>`)}</div>
      <div class="mt">${corpo.html}</div>`,
    depois(el) { ouvir(el, 'click', '[data-aba]', (b) => { abertoFluxo = null; abertoTempo = null; location.hash = `#/ajustes/${b.dataset.aba}`; }); corpo.depois?.(el); },
  };
}

// ------------------------------------------------------------------ geral ---

async function geral() {
  const eu = estado.eu; const gere = pode('integracao.gerir');
  const [int, ia, arq, google] = await Promise.all([
    gere ? api.get('/api/integracoes') : null, api.get('/api/ia/estado').catch(() => null), api.get('/api/arquivos/estado').catch(() => null), api.get('/api/google/status').catch(() => null)]);
  const modo = guardado.ler('efeitos', (matchMedia('(pointer: coarse)').matches || innerWidth < 900) ? 'leve' : 'animado');
  return {
    html: html`<div class="grid-hub">
        <div class="nx-col">
          <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Google Calendar, Meet e Drive</h2><p class="card__sub">Conexão da conta do escritório para os eventos e arquivos dos projetos.</p></div><span class="selo ${google?.conectado ? 'ok' : google?.reconectar ? 'erro' : 'aviso'}">${google?.conectado ? 'Conectado' : google?.reconectar ? 'Renovar' : 'Pendente'}</span></header>
            ${google?.motivo ? html`<p class="nota">${google.motivo}</p>` : ''}${google?.ultimoErroFila ? html`<p class="nota">Último erro na fila do Drive: ${google.ultimoErroFila}</p>` : ''}
            <p class="dica">Os eventos criados no calendário recebem o vínculo com o projeto. Os documentos do portal são organizados nas pastas do cliente e do projeto.</p>
            ${google?.configurado ? (gere ? html`<button class="btn btn--accent" data-google-conectar>${google.conectado || google.reconectar ? 'Renovar autorização Google' : 'Conectar conta Google'}</button>` : '') : html`<p class="dica">Para habilitar, conclua a configuração da aplicação Google do escritório:</p><ul class="lista">${(google?.instrucoes ?? []).map((i) => html`<li>${i}</li>`)}</ul><p class="mono-sm">Pendente: ${(google?.faltantes ?? []).join(', ') || 'Configuração indisponível'}</p>`}
          </section>
          ${gere ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Integrações</h2><p class="card__sub">Credenciais para as aplicações do Nexus entregarem dados. O token aparece uma única vez.</p></div>
            <button type="button" class="btn btn--accent" data-nova>${icone('plus')}Nova credencial</button></header>
            ${int.integracoes.length ? html`<ul class="lista">${int.integracoes.map((i) => html`<li><div><b>${i.nome}</b><small>${i.aplicacao} · ${i.escopos.join(', ')} · ${i.nuncaUsada ? 'nunca usada' : `último uso ${relativo(i.ultimo_uso_em)} · ${i.usos} entrega(s)`}</small></div>
              <div class="fim">${i.ativa ? html`<button type="button" class="btn btn--ghost perigo-btn" data-revogar="${i.id}" data-n="${i.nome}">Revogar</button>` : html`<span class="selo erro">revogada</span>`}</div></li>`)}</ul>` : html`<p class="dica">Nenhuma credencial criada.</p>`}
            <h3 class="mini-h">Estado da ligação (declarado pelo servidor)</h3>
            <ul class="lista">${Object.entries(int.contrato.estado).map(([k, v]) => html`<li><div><b>${k}</b><small>${v}</small></div></li>`)}</ul>
            ${int.contrato.naoExercitado ? html`<p class="dica" style="margin-top:10px">${int.contrato.naoExercitado}</p>` : ''}</section>` : ''}
        </div>
        <div class="nx-col">
          <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Sua conta</h2></div></header>
            <p><b>${eu.usuario.nome}</b><br><span class="mono-sm">${eu.usuario.email}</span></p>
            <p class="dica">${eu.papeis.map((p) => ROTULO_DO_PAPEL[p] ?? p).join(', ')} · ${eu.organizacoes.map((o) => o.nome).join(', ')}</p></section>
          <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Efeitos visuais</h2><p class="card__sub">${document.documentElement.classList.contains('leve') ? 'Modo leve ativo: sem fundo em movimento nem desfoque.' : 'Fundo em movimento ativo.'}</p></div></header>
            <label class="field"><span>Modo</span><select class="select" id="efeitos">${[['animado', 'Em movimento — fundo vivo (recomendado)'], ['completo', 'Completo — movimento + desfoque em tudo (pesa em máquina fraca)'], ['leve', 'Leve — sem movimento nem desfoque (o mais rápido)']].map(([v, t]) => html`<option value="${v}" ${(modo === 'equilibrado' ? 'animado' : modo) === v ? raw('selected') : ''}>${t}</option>`)}</select></label></section>
          <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Sistema</h2></div></header>
            <ul class="lista">
              <li><div><b>Leitura por IA</b><small>${ia ? (ia.disponivel ? 'Configurada' : ia.impedimento) : '—'}</small></div><div class="fim"><span class="selo ${ia?.disponivel ? 'ok' : 'aviso'}">${ia?.trabalhadorExterno ? 'worker local' : ia?.disponivel ? 'ativa' : 'desligada'}</span></div></li>
              <li><div><b>Armazenamento de arquivos</b><small>${arq ? (arq.descricao ?? arq.modo ?? JSON.stringify(arq).slice(0, 120)) : '—'}</small></div></li></ul></section>
        </div></div>`,
    depois(el) {
      ouvir(el, 'click', '[data-google-conectar]', async () => { try { const r = await api.get('/api/google/conectar'); location.assign(r.url); } catch (e) { erroDe(e); } });
      el.querySelector('#efeitos')?.addEventListener('change', (e) => { guardado.gravar('efeitos', e.target.value); toast('Efeitos atualizados'); setTimeout(() => location.reload(), 400); });
      ouvir(el, 'click', '[data-nova]', async () => {
        let r = null;
        await formulario({
          titulo: 'Nova credencial de integração', rotulo: 'Criar',
          campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, placeholder: 'Sentinela — escritório' }, { nome: 'aplicacao', rotulo: 'Aplicação', tipo: 'select', opcoes: [{ v: 'sentinela', t: 'NGA Sentinela' }, { v: 'integra', t: 'NGA Íntegra' }, { v: 'prazos', t: 'NGA Prazos' }, { v: 'outra', t: 'Outra' }] },
            { nome: 'escopos', rotulo: 'O que pode entregar', tipo: 'select', valor: 'processos', opcoes: Object.keys(ESCOPOS).map((k) => ({ v: k, t: k })) }],
          async enviar(v) { r = await api.post('/api/integracoes', { nome: v.nome, aplicacao: v.aplicacao, escopos: ESCOPOS[v.escopos] }); },
        });
        if (!r) return;
        await modal({ titulo: 'Credencial criada', subtitulo: r.nome,
          corpo: `<p class="dica">${r.aviso}</p><div class="senha-box"><small>Token</small><b class="mono-sm" style="word-break:break-all;color:var(--lab-amber-2)">${String(r.token).replace(/</g, '&lt;')}</b></div>`,
          acoes: [{ id: 'c', rotulo: 'Copiar token' }, { id: 'ok', rotulo: 'Já guardei', tipo: 'primario' }],
          aoAbrir(m) { m.addEventListener('acao', (e) => { if (e.detail.id === 'c') navigator.clipboard?.writeText(r.token).then(() => toast('Token copiado')); else m.fechar(true); }); } });
        navegar();
      });
      ouvir(el, 'click', '[data-revogar]', async (b) => {
        if (!(await confirmar('Revogar credencial?', `“${b.dataset.n}” deixa de funcionar na hora. A aplicação que a usa vai parar de entregar.`, { rotulo: 'Revogar', perigo: true }))) return;
        try { await api.del(`/api/integracoes/${b.dataset.revogar}`); toast('Credencial revogada'); navegar(); } catch (e) { erroDe(e); }
      });
    },
  };
}

// ---------------------------------------------------------------- acessos ---

async function acessos() {
  const { matriz } = await api.get('/api/escritorio/acessos');
  const menu = matriz[0].menu;
  const extras = [['daAcessoAoPortalDoCliente', 'Cria acesso para o portal do cliente'], ['publicaParaOCliente', 'Publica documentos e andamento ao cliente'], ['geraFaturas', 'Emite e gerencia faturas'], ['editaFluxosEAutomacoes', 'Edita fluxos e automações'], ['administraAcessosDaEquipe', 'Administra acessos da equipe']];
  const ok = html`<span class="nx-sim" aria-label="sim">${icone('check')}</span>`; const nao = html`<span class="nx-nao" aria-label="não">—</span>`;
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Quem entra onde</h2><p class="card__sub">A matriz vale na tela e no servidor: a aba some e a rota é recusada. Para mudar o perfil de uma pessoa, vá em Equipe.</p></div>${pode('admin.gerir') ? html`<a class="btn btn--ghost" href="#/equipe">${icone('users')}Abrir Equipe</a>` : ''}</header>
      <div class="tbl-wrap"><table class="tbl nx-matriz"><thead><tr><th>Área</th>${matriz.map((p) => html`<th class="nx-c">${p.rotulo}</th>`)}</tr></thead>
        <tbody>${menu.map((m, i) => html`<tr><td><b>${m.rotulo}</b></td>${matriz.map((p) => html`<td class="nx-c">${p.menu[i].acesso ? ok : nao}</td>`)}</tr>`)}
          <tr class="nx-sep"><td colspan="${matriz.length + 1}">Poderes especiais</td></tr>
          ${extras.map(([k, t]) => html`<tr><td>${t}</td>${matriz.map((p) => html`<td class="nx-c">${p.extras[k] ? ok : nao}</td>`)}</tr>`)}</tbody></table></div></section>
      <div class="grid2 mt">${matriz.map((p) => html`<section class="card glass up"><h3 class="card__title" style="font-size:17px">${p.rotulo}</h3><p class="dica">${p.resumo}</p></section>`)}</div>`,
  };
}

// ----------------------------------------------------------------- fluxos ---

const NOS = { inicio: ['Início', 150, 52], etapa: ['Etapa', 170, 60], decisao: ['Decisão?', 190, 90], fim: ['Fim', 150, 52] };
const COR = { ambar: ['#F0A32E', '#F0A32E22'], ciano: ['#4CC9F0', '#4CC9F022'], verde: ['#2EE6A0', '#2EE6A022'], vermelho: ['#FF6B6B', '#FF6B6B22'], cinza: ['#8da0b5', '#8da0b522'] };
const corPadrao = { inicio: 'verde', etapa: 'ciano', decisao: 'ambar', fim: 'cinza' };
const uid = () => Math.random().toString(36).slice(2, 9);

async function fluxos() {
  const lista = await api.get('/api/config/modelos?tipo=fluxograma'); const gere = pode('config.gerir');
  if (abertoFluxo) { const m = lista.find((x) => x.id === abertoFluxo); if (m) return { html: editorFluxo(m, gere), depois: (el) => ligarEditorFluxo(el, m, gere) }; abertoFluxo = null; }
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Fluxogramas</h2><p class="card__sub">Desenhe o processo de trabalho do escritório: arraste as etapas, ligue com setas, renomeie.</p></div>${gere ? html`<button class="btn btn--accent" data-novo-fluxo>${icone('plus')}Novo fluxograma</button>` : ''}</header>
      ${lista.length ? html`<div class="grid3">${lista.map((m) => html`<article class="card glass nx-modelo"><h3>${m.nome}</h3><p class="dica">${m.descricao || `${m.definicao.nos?.length ?? 0} etapas · ${m.definicao.arestas?.length ?? 0} ligações`}</p>
        <div class="flex"><span class="selo ${m.ativo ? 'ok' : ''}">${m.ativo ? 'Ativo' : 'Inativo'}</span><span class="mono-sm">${relativo(m.atualizadoEm)}</span></div>
        <div class="flex"><button class="btn btn--accent btn--sm" data-abrir-fluxo="${m.id}">${icone('eye')}${gere ? 'Abrir e editar' : 'Abrir'}</button>${gere ? html`<button class="btn btn--ghost btn--sm perigo-btn" data-del="${m.id}" data-n="${m.nome}">${icone('trash')}</button>` : ''}</div></article>`)}</div>`
        : vazio('board', 'Nenhum fluxograma ainda', 'Crie o primeiro: por exemplo, o caminho de uma publicação do DJEN até o prazo agendado.')}</section>`,
    depois(el) {
      ouvir(el, 'click', '[data-abrir-fluxo]', (b) => { abertoFluxo = b.dataset.abrirFluxo; navegar(); });
      ouvir(el, 'click', '[data-novo-fluxo]', async () => {
        const ok = await formulario({ titulo: 'Novo fluxograma', rotulo: 'Criar e abrir', campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, placeholder: 'Triagem de publicações' }, { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea' }],
          async enviar(v) { const r = await api.post('/api/config/modelos', { tipo: 'fluxograma', nome: v.nome, descricao: v.descricao ?? '', definicao: { nos: [{ id: uid(), tipo: 'inicio', rotulo: 'Início', x: 80, y: 60, cor: 'verde' }], arestas: [] } }); abertoFluxo = r.id; } });
        if (ok) navegar();
      });
      ouvir(el, 'click', '[data-del]', async (b) => { if (!(await confirmar('Excluir fluxograma?', `“${b.dataset.n}” será removido.`, { rotulo: 'Excluir', perigo: true }))) return; try { await api.del(`/api/config/modelos/${b.dataset.del}`); navegar(); } catch (e) { erroDe(e); } });
    },
  };
}

function editorFluxo(m, gere) {
  return html`<section class="card glass up nx-editor"><header class="card__head"><div><h2 class="card__title">${m.nome}</h2><p class="card__sub">${gere ? 'Arraste para mover · “Ligar” para criar setas · duplo clique para editar uma etapa.' : 'Somente leitura.'}</p></div>
      <div class="flex"><button class="btn btn--ghost" data-voltar>${icone('arrowLeft')}Fluxos</button>${gere ? html`<button class="btn btn--accent" data-salvar>${icone('check')}Salvar</button>` : ''}</div></header>
    ${gere ? html`<div class="nx-toolbar"><span class="mini-h" style="margin:0">Adicionar</span>
      ${[['inicio', 'Início'], ['etapa', 'Etapa'], ['decisao', 'Decisão'], ['fim', 'Fim']].map(([t, r]) => html`<button class="btn btn--ghost btn--sm" data-add="${t}">${icone('plus')}${r}</button>`)}
      <span class="nx-toolbar__sep"></span><button class="btn btn--ghost btn--sm" data-ligar aria-pressed="false">${icone('link')}Ligar etapas</button><button class="btn btn--ghost btn--sm" data-editar-sel>${icone('list')}Editar</button><button class="btn btn--ghost btn--sm perigo-btn" data-apagar-sel>${icone('trash')}Excluir</button>
      <span class="dica" data-dica style="margin-left:auto"></span></div>` : ''}
    <div class="nx-canvas" data-canvas><svg data-svg width="100%" viewBox="0 0 1200 640" style="height:auto;min-height:420px" role="img" aria-label="Fluxograma ${esc(m.nome)}"><defs><marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#8da0b5"/></marker></defs><g data-arestas></g><g data-nos></g></svg></div></section>`;
}

function ligarEditorFluxo(el, m, gere) {
  const def = JSON.parse(JSON.stringify(m.definicao ?? { nos: [], arestas: [] })); def.nos ??= []; def.arestas ??= [];
  const svg = el.querySelector('[data-svg]'); const gNos = el.querySelector('[data-nos]'); const gAr = el.querySelector('[data-arestas]');
  const dica = el.querySelector('[data-dica]'); let sel = null; let ligando = false; let origem = null; let sujo = false;
  const tam = (n) => { const [, w, h] = NOS[n.tipo]; return { w, h }; };
  const centro = (n) => { const { w, h } = tam(n); return { x: n.x + w / 2, y: n.y + h / 2, w, h }; };
  const borda = (n, alvo) => {
    const c = centro(n); const dx = alvo.x - c.x; const dy = alvo.y - c.y; if (!dx && !dy) return c;
    const t = n.tipo === 'decisao' ? 1 / (Math.abs(dx) / (c.w / 2) + Math.abs(dy) / (c.h / 2)) : Math.min((c.w / 2) / Math.abs(dx || 1e-9), (c.h / 2) / Math.abs(dy || 1e-9));
    return { x: c.x + dx * t, y: c.y + dy * t };
  };
  const formaNo = (n) => {
    const { w, h } = tam(n); const [cor, fundo] = COR[n.cor ?? corPadrao[n.tipo]];
    const forma = n.tipo === 'decisao' ? `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" fill="${fundo}" stroke="${cor}" stroke-width="${sel === n.id ? 3 : 1.6}"/>`
      : `<rect width="${w}" height="${h}" rx="${n.tipo === 'etapa' ? 14 : h / 2}" fill="${fundo}" stroke="${cor}" stroke-width="${sel === n.id || origem === n.id ? 3 : 1.6}"/>`;
    const palavras = String(n.rotulo ?? '').split(/\s+/); const linhas = []; let atual = '';
    for (const p of palavras) { if ((atual + ' ' + p).trim().length > (n.tipo === 'decisao' ? 16 : 20)) { linhas.push(atual); atual = p; } else atual = (atual + ' ' + p).trim(); } if (atual) linhas.push(atual);
    const ls = linhas.slice(0, 3); const y0 = h / 2 - ((ls.length - 1) * 8);
    return `<g class="nx-no" data-id="${esc(n.id)}" transform="translate(${n.x},${n.y})" style="cursor:${gere ? 'grab' : 'default'}">${forma}${ls.map((l, i) => `<text x="${w / 2}" y="${y0 + i * 16 + 5}" text-anchor="middle" fill="#EAF1F8" font-size="13.5" font-weight="600">${esc(l)}</text>`).join('')}</g>`;
  };
  const desenhar = () => {
    gNos.innerHTML = def.nos.map(formaNo).join('');
    gAr.innerHTML = def.arestas.map((a) => {
      const de = def.nos.find((n) => n.id === a.de); const para = def.nos.find((n) => n.id === a.para); if (!de || !para) return '';
      const p1 = borda(de, centro(para)); const p2 = borda(para, centro(de));
      const mx = (p1.x + p2.x) / 2; const my = (p1.y + p2.y) / 2;
      return `<g class="nx-aresta" data-aresta="${esc(a.id)}" style="cursor:pointer"><path d="M${p1.x},${p1.y} L${p2.x},${p2.y}" stroke="transparent" stroke-width="14" fill="none"/><path d="M${p1.x},${p1.y} L${p2.x},${p2.y}" stroke="${sel === a.id ? '#F0A32E' : '#8da0b5'}" stroke-width="${sel === a.id ? 2.6 : 1.6}" fill="none" marker-end="url(#seta)"/>${a.rotulo ? `<text x="${mx}" y="${my - 6}" text-anchor="middle" fill="#FFD08A" font-size="12" font-weight="600">${esc(a.rotulo)}</text>` : ''}</g>`;
    }).join('');
  };
  // A tela do desenho acompanha o conteúdo: cabe tudo sem rolar, com folga para crescer.
  const caixa = { w: 1200, h: 640 };
  const ajustarCaixa = () => {
    caixa.w = Math.max(1200, ...def.nos.map((n) => n.x + tam(n).w + 120)); caixa.h = Math.max(640, ...def.nos.map((n) => n.y + tam(n).h + 120));
    svg.setAttribute('viewBox', `0 0 ${caixa.w} ${caixa.h}`);
  };
  ajustarCaixa(); desenhar();
  const ponto = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) * (caixa.w / r.width), y: (e.clientY - r.top) * (caixa.h / r.height) }; };
  const editarNo = async (n) => {
    const ok = await formulario({ titulo: 'Editar etapa', rotulo: 'Salvar', campos: [{ nome: 'rotulo', rotulo: 'Texto', obrigatorio: true, valor: n.rotulo },
      { nome: 'tipo', rotulo: 'Forma', tipo: 'select', valor: n.tipo, metade: true, opcoes: [{ v: 'inicio', t: 'Início' }, { v: 'etapa', t: 'Etapa' }, { v: 'decisao', t: 'Decisão' }, { v: 'fim', t: 'Fim' }] },
      { nome: 'cor', rotulo: 'Cor', tipo: 'select', valor: n.cor ?? corPadrao[n.tipo], metade: true, opcoes: Object.keys(COR).map((c) => ({ v: c, t: c })) }],
      async enviar(v) { n.rotulo = v.rotulo; n.tipo = v.tipo; n.cor = v.cor; } });
    if (ok) { sujo = true; desenhar(); }
  };
  if (!gere) return ouvir(el, 'click', '[data-voltar]', () => { abertoFluxo = null; navegar(); });
  let arrasto = null;
  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.nx-no'); const ar = e.target.closest('.nx-aresta');
    if (g) {
      const n = def.nos.find((x) => x.id === g.dataset.id);
      if (ligando) {
        if (!origem) { origem = n.id; dica.textContent = 'Agora clique na etapa de destino.'; }
        else if (origem !== n.id) { if (!def.arestas.some((a) => a.de === origem && a.para === n.id)) { def.arestas.push({ id: uid(), de: origem, para: n.id }); sujo = true; } origem = null; dica.textContent = 'Ligação criada. Clique na próxima origem.'; }
        desenhar(); return;
      }
      sel = n.id; const p = ponto(e); arrasto = { n, dx: p.x - n.x, dy: p.y - n.y, moveu: false }; svg.setPointerCapture(e.pointerId); desenhar();
    } else if (ar) { sel = ar.dataset.aresta; desenhar(); }
    else { sel = null; origem = null; desenhar(); }
  });
  svg.addEventListener('pointermove', (e) => { if (!arrasto) return; const p = ponto(e); arrasto.n.x = Math.max(0, Math.round((p.x - arrasto.dx) / 10) * 10); arrasto.n.y = Math.max(0, Math.round((p.y - arrasto.dy) / 10) * 10); arrasto.moveu = true; desenhar(); });
  svg.addEventListener('pointerup', () => { if (arrasto?.moveu) { sujo = true; ajustarCaixa(); desenhar(); } arrasto = null; });
  svg.addEventListener('dblclick', (e) => {
    const g = e.target.closest('.nx-no'); const ar = e.target.closest('.nx-aresta');
    if (g) editarNo(def.nos.find((x) => x.id === g.dataset.id));
    else if (ar) { const a = def.arestas.find((x) => x.id === ar.dataset.aresta); formulario({ titulo: 'Texto da seta', rotulo: 'Salvar', campos: [{ nome: 'rotulo', rotulo: 'Texto (ex.: Sim, Não)', valor: a.rotulo ?? '' }], async enviar(v) { a.rotulo = v.rotulo; } }).then((ok) => { if (ok) { sujo = true; desenhar(); } }); }
  });
  ouvir(el, 'click', '[data-add]', (b) => {
    const t = b.dataset.add; const k = def.nos.length; const id = uid();
    def.nos.push({ id, tipo: t, rotulo: NOS[t][0], x: 80 + (k % 5) * 220, y: 60 + Math.floor(k / 5) * 140, cor: corPadrao[t] }); sel = id; sujo = true; ajustarCaixa(); desenhar();
  });
  ouvir(el, 'click', '[data-ligar]', (b) => { ligando = !ligando; origem = null; b.setAttribute('aria-pressed', String(ligando)); b.classList.toggle('is-on', ligando); dica.textContent = ligando ? 'Clique na etapa de origem e depois na de destino.' : ''; desenhar(); });
  ouvir(el, 'click', '[data-editar-sel]', () => { const n = def.nos.find((x) => x.id === sel); if (n) editarNo(n); else toast('Selecione uma etapa.', 'aviso'); });
  ouvir(el, 'click', '[data-apagar-sel]', () => {
    if (!sel) return toast('Selecione uma etapa ou seta.', 'aviso');
    if (def.nos.some((n) => n.id === sel)) { def.nos = def.nos.filter((n) => n.id !== sel); def.arestas = def.arestas.filter((a) => a.de !== sel && a.para !== sel); } else def.arestas = def.arestas.filter((a) => a.id !== sel);
    sel = null; sujo = true; desenhar();
  });
  document.addEventListener('keydown', function tecla(e) {
    if (!document.body.contains(el)) return document.removeEventListener('keydown', tecla);
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')) el.querySelector('[data-apagar-sel]').click();
  });
  ouvir(el, 'click', '[data-salvar]', async () => { try { await api.patch(`/api/config/modelos/${m.id}`, { definicao: def }); sujo = false; toast('Fluxograma salvo.'); } catch (e) { erroDe(e); } });
  ouvir(el, 'click', '[data-voltar]', async () => { if (sujo && !(await confirmar('Sair sem salvar?', 'As alterações deste fluxograma ainda não foram salvas.', { rotulo: 'Sair sem salvar', perigo: true }))) return; abertoFluxo = null; navegar(); });
}

// ------------------------------------------------------- linhas do tempo ---

async function tempo() {
  const lista = await api.get('/api/config/modelos?tipo=linha_do_tempo'); const gere = pode('config.gerir');
  if (abertoTempo) { const m = lista.find((x) => x.id === abertoTempo); if (m) return editorTempo(m, gere); abertoTempo = null; }
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Linhas do tempo</h2><p class="card__sub">Modelos de etapas com prazo relativo ao início. Ao aplicar a um projeto, cada etapa vira um marco real — visível ao cliente só se você marcar.</p></div>${gere ? html`<button class="btn btn--accent" data-novo>${icone('plus')}Nova linha do tempo</button>` : ''}</header>
      ${lista.length ? html`<div class="grid3">${lista.map((m) => html`<article class="card glass nx-modelo"><h3>${m.nome}</h3><p class="dica">${m.descricao || `${m.definicao.etapas?.length ?? 0} etapas`}</p>
        <div class="flex"><button class="btn btn--accent btn--sm" data-abrir="${m.id}">${icone('eye')}${gere ? 'Abrir e editar' : 'Abrir'}</button>${gere ? html`<button class="btn btn--ghost btn--sm" data-aplicar="${m.id}">${icone('folder')}Aplicar a projeto</button><button class="btn btn--ghost btn--sm perigo-btn" data-del="${m.id}" data-n="${m.nome}">${icone('trash')}</button>` : ''}</div></article>`)}</div>`
        : vazio('clock', 'Nenhuma linha do tempo ainda', 'Crie a primeira: por exemplo, as etapas de uma recuperação judicial, com o prazo de cada uma.')}</section>`,
    depois(el) {
      ouvir(el, 'click', '[data-abrir]', (b) => { abertoTempo = b.dataset.abrir; navegar(); });
      ouvir(el, 'click', '[data-novo]', async () => {
        const ok = await formulario({ titulo: 'Nova linha do tempo', rotulo: 'Criar e abrir', campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, placeholder: 'Recuperação judicial — marcos iniciais' }, { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea' }],
          async enviar(v) { const r = await api.post('/api/config/modelos', { tipo: 'linha_do_tempo', nome: v.nome, descricao: v.descricao ?? '', definicao: { etapas: [{ id: uid(), titulo: 'Primeira etapa', diasApos: 0, visivelCliente: true }] } }); abertoTempo = r.id; } });
        if (ok) navegar();
      });
      ouvir(el, 'click', '[data-del]', async (b) => { if (!(await confirmar('Excluir linha do tempo?', `“${b.dataset.n}” será removida. Marcos já aplicados a projetos permanecem.`, { rotulo: 'Excluir', perigo: true }))) return; try { await api.del(`/api/config/modelos/${b.dataset.del}`); navegar(); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-aplicar]', (b) => aplicarTempo(b.dataset.aplicar));
    },
  };
}

async function aplicarTempo(id) {
  const projetos = (await api.get('/api/projetos')).filter((p) => p.situacao !== 'encerrado');
  const ok = await formulario({ titulo: 'Aplicar a um projeto', subtitulo: 'Cria os marcos no projeto, com datas a partir do início informado.', rotulo: 'Aplicar', campos: [
    { nome: 'projetoId', rotulo: 'Projeto', tipo: 'select', obrigatorio: true, opcoes: [{ v: '', t: 'Selecione' }, ...projetos.map((p) => ({ v: p.id, t: p.nome }))] }, { nome: 'inicio', rotulo: 'Início', tipo: 'date', obrigatorio: true, valor: new Date().toLocaleDateString('sv-SE') }],
    async enviar(v) { const r = await api.post(`/api/config/modelos/${id}/aplicacao`, { projetoId: v.projetoId, inicio: v.inicio }); toast(`${r.marcos} marco(s) criados no projeto.`); } });
  if (ok) navegar();
}

function editorTempo(m, gere) {
  const def = JSON.parse(JSON.stringify(m.definicao ?? { etapas: [] })); def.etapas ??= [];
  const linha = (e, i) => html`<li class="nx-etapa" data-i="${i}"><span class="nx-etapa__n">${i + 1}</span><div class="nx-etapa__corpo">
      <input class="input" data-f="titulo" value="${e.titulo}" placeholder="Título da etapa" ${gere ? '' : raw('disabled')}>
      <input class="input" data-f="descricao" value="${e.descricao ?? ''}" placeholder="Descrição (opcional)" ${gere ? '' : raw('disabled')}>
      <div class="flex"><label class="field" style="width:150px"><span>Dias após o início</span><input class="input" type="number" min="0" max="3650" data-f="diasApos" value="${e.diasApos}" ${gere ? '' : raw('disabled')}></label>
        <label class="flex dica"><input type="checkbox" data-f="visivelCliente" ${e.visivelCliente ? raw('checked') : ''} ${gere ? '' : raw('disabled')}> Visível ao cliente</label>
        ${gere ? html`<span class="grow"></span><button class="btn btn--ghost btn--sm" data-sobe="${i}" ${i === 0 ? raw('disabled') : ''}>↑</button><button class="btn btn--ghost btn--sm" data-desce="${i}" ${i === def.etapas.length - 1 ? raw('disabled') : ''}>↓</button><button class="btn btn--ghost btn--sm perigo-btn" data-tira="${i}">${icone('trash')}</button>` : ''}</div></div></li>`;
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">${m.nome}</h2><p class="card__sub">${m.descricao || 'Ordene as etapas e defina o prazo de cada uma, contado em dias corridos a partir do início.'}</p></div>
      <div class="flex"><button class="btn btn--ghost" data-voltar>${icone('arrowLeft')}Linhas do tempo</button>${gere ? html`<button class="btn btn--ghost" data-aplicar>${icone('folder')}Aplicar a projeto</button><button class="btn btn--accent" data-salvar>${icone('check')}Salvar</button>` : ''}</div></header>
      <ol class="nx-etapas" data-lista>${def.etapas.map(linha)}</ol>${gere ? html`<button class="btn btn--ghost mt" data-add>${icone('plus')}Adicionar etapa</button>` : ''}</section>`,
    depois(el) {
      const lerCampos = () => { el.querySelectorAll('.nx-etapa').forEach((li) => { const e = def.etapas[Number(li.dataset.i)]; li.querySelectorAll('[data-f]').forEach((c) => { const k = c.dataset.f; e[k] = c.type === 'checkbox' ? c.checked : c.type === 'number' ? Number(c.value || 0) : c.value; }); }); };
      const redesenhar = () => { el.querySelector('[data-lista]').innerHTML = String(html`${def.etapas.map(linha)}`); };
      ouvir(el, 'click', '[data-voltar]', () => { abertoTempo = null; navegar(); });
      if (!gere) return;
      ouvir(el, 'click', '[data-add]', () => { lerCampos(); def.etapas.push({ id: uid(), titulo: 'Nova etapa', diasApos: (def.etapas.at(-1)?.diasApos ?? 0) + 7, visivelCliente: false }); redesenhar(); });
      ouvir(el, 'click', '[data-tira]', (b) => { lerCampos(); def.etapas.splice(Number(b.dataset.tira), 1); redesenhar(); });
      ouvir(el, 'click', '[data-sobe]', (b) => { lerCampos(); const i = Number(b.dataset.sobe); [def.etapas[i - 1], def.etapas[i]] = [def.etapas[i], def.etapas[i - 1]]; redesenhar(); });
      ouvir(el, 'click', '[data-desce]', (b) => { lerCampos(); const i = Number(b.dataset.desce); [def.etapas[i + 1], def.etapas[i]] = [def.etapas[i], def.etapas[i + 1]]; redesenhar(); });
      ouvir(el, 'click', '[data-salvar]', async () => { lerCampos(); try { await api.patch(`/api/config/modelos/${m.id}`, { definicao: def }); toast('Linha do tempo salva.'); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-aplicar]', async () => { lerCampos(); try { await api.patch(`/api/config/modelos/${m.id}`, { definicao: def }); } catch (e) { return erroDe(e); } aplicarTempo(m.id); });
    },
  };
}

// ------------------------------------------------------------- automações ---

async function automacoes() {
  const [r, cat] = await Promise.all([api.get('/api/config/automacoes'), api.get('/api/projetos/fases').catch(() => [])]); const gere = pode('config.gerir');
  const fases = []; const vistos = new Set();
  for (const c of cat) for (const f of c.fases) if (!vistos.has(f.id)) { vistos.add(f.id); fases.push({ v: f.id, t: f.nome }); }
  const campos = (a = {}) => [
    { nome: 'nome', rotulo: 'Nome da regra', obrigatorio: true, valor: a.nome ?? '' },
    { nome: 'gatilho', rotulo: 'Quando', tipo: 'select', valor: a.gatilho ?? 'fase_iniciada', opcoes: r.gatilhos.map((g) => ({ v: g, t: GATILHO[g] })) },
    { nome: 'fase', rotulo: 'Só na fase (apenas para “fase começar”)', tipo: 'select', valor: a.fase ?? '', opcoes: [{ v: '', t: 'Qualquer fase' }, ...fases] },
    { nome: 'tituloTarefa', rotulo: 'Criar a tarefa', obrigatorio: true, valor: a.tituloTarefa ?? '', placeholder: 'Conferir recebimento no banco' },
    { nome: 'diasUteis', rotulo: 'Prazo (dias úteis)', tipo: 'number', valor: a.diasUteis ?? 1, metade: true, min: 0 },
    { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', valor: a.prioridade ?? 'media', metade: true, opcoes: [{ v: 'baixa', t: 'Baixa' }, { v: 'media', t: 'Média' }, { v: 'alta', t: 'Alta' }, { v: 'urgente', t: 'Urgente' }] },
  ];
  const corpo = (v) => ({ nome: v.nome, gatilho: v.gatilho, fase: v.gatilho === 'fase_iniciada' ? (v.fase || null) : null, tituloTarefa: v.tituloTarefa, diasUteis: Number(v.diasUteis ?? 1), prioridade: v.prioridade });
  const escritorio = r.automacoes.filter((a) => a.escopo === 'escritorio'); const deProjeto = r.automacoes.filter((a) => a.escopo === 'projeto');
  const linha = (a) => html`<tr><td><b>${a.nome}</b><small>${GATILHO[a.gatilho]}${a.fase ? ` · fase “${fases.find((f) => f.v === a.fase)?.t ?? a.fase}”` : ''}</small></td><td>${a.tituloTarefa}<small>em ${a.diasUteis} dia(s) útil(eis) · prioridade ${a.prioridade}</small></td>
    <td class="num">${a.execucoes}<small>${a.ultimaExecucaoEm ? relativo(a.ultimaExecucaoEm) : 'nunca rodou'}</small></td>
    <td><label class="nx-switch"><input type="checkbox" data-ativo="${a.id}" ${a.ativo ? raw('checked') : ''} ${gere ? '' : raw('disabled')}><span></span></label></td>
    <td>${gere ? html`<div class="nx-acts"><button class="btn btn--ghost btn--sm" data-editar="${a.id}">${icone('list')}Editar</button><button class="btn btn--ghost btn--sm perigo-btn" data-del="${a.id}" data-n="${a.nome}">${icone('trash')}</button></div>` : ''}</td></tr>`;
  return {
    html: html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Automações do escritório</h2><p class="card__sub">“Quando acontecer isto, crie esta tarefa.” A tarefa nasce para o líder do projeto, com prazo em dias úteis (não substitui prazo processual).</p></div>${gere ? html`<button class="btn btn--accent" data-nova>${icone('plus')}Nova automação</button>` : ''}</header>
      ${escritorio.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Regra</th><th>Tarefa criada</th><th class="num">Execuções</th><th>Ativa</th><th></th></tr></thead><tbody>${escritorio.map(linha)}</tbody></table></div>` : vazio('bolt', 'Nenhuma automação do escritório', 'Exemplo: ao iniciar a fase “Plano apresentado”, criar a tarefa “Analisar o plano e preparar objeção”.')}</section>
      ${deProjeto.length ? html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Automações de projetos</h2><p class="card__sub">Criadas dentro de cada projeto; valem só para ele.</p></div></header><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Regra</th><th>Tarefa criada</th><th class="num">Execuções</th><th>Ativa</th><th></th></tr></thead><tbody>${deProjeto.map((a) => linha(a))}</tbody></table></div></section>` : ''}`,
    depois(el) {
      ouvir(el, 'click', '[data-nova]', async () => { const ok = await formulario({ titulo: 'Nova automação', rotulo: 'Criar', campos: campos(), async enviar(v) { await api.post('/api/config/automacoes', { ...corpo(v), ativo: true }); } }); if (ok) navegar(); });
      ouvir(el, 'click', '[data-editar]', async (b) => { const a = r.automacoes.find((x) => x.id === b.dataset.editar); const ok = await formulario({ titulo: 'Editar automação', rotulo: 'Salvar', campos: campos(a), async enviar(v) { await api.patch(`/api/config/automacoes/${a.id}`, corpo(v)); } }); if (ok) navegar(); });
      ouvir(el, 'click', '[data-del]', async (b) => { if (!(await confirmar('Excluir automação?', `“${b.dataset.n}” deixa de criar tarefas. As tarefas já criadas permanecem.`, { rotulo: 'Excluir', perigo: true }))) return; try { await api.del(`/api/config/automacoes/${b.dataset.del}`); navegar(); } catch (e) { erroDe(e); } });
      el.addEventListener('change', async (e) => { const c = e.target.closest('[data-ativo]'); if (!c) return; try { await api.patch(`/api/config/automacoes/${c.dataset.ativo}`, { ativo: c.checked }); toast(c.checked ? 'Automação ativada.' : 'Automação pausada.'); } catch (er) { c.checked = !c.checked; erroDe(er); } });
      void dataBR;
    },
  };
}
