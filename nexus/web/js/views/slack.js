/**
 * Slack dentro do LAB, com a conta de quem está logado.
 *
 * O Slack não pode ser aberto dentro de outro site (ele bloqueia iframe por segurança), então esta aba é
 * um cliente próprio, pela API oficial: conversas à esquerda, mensagens no centro, envio embaixo. Tudo
 * com o token da PRÓPRIA pessoa (cada um conecta o seu). Para recursos que só o Slack tem (chamadas,
 * huddles, arquivos grandes), o botão "Abrir no Slack" leva à mesma conversa no app.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { esc, html, icone, ouvir, raw } from '../util.js';
import { cabecalho, erroDe, toast, vazio } from '../ui.js';
import { aoSair, navegar } from '../shell.js';

const EQUIPE = 'T0B6U2U040K';
const TIPO = { canal: '#', privado: '🔒', grupo: '👥', dm: '' };

/** Texto do Slack (mrkdwn) para HTML seguro: menções, links, negrito, itálico, código e quebras. */
function mrkdwn(t, pessoas) {
  let s = esc(t);
  s = s.replace(/&lt;@([A-Z0-9]+)(?:\|[^&]*)?&gt;/g, (_, id) => `<b class="sk-men">@${esc(pessoas[id]?.nome ?? id)}</b>`);
  s = s.replace(/&lt;#([A-Z0-9]+)\|([^&]*)&gt;/g, (_, __, n) => `<b class="sk-men">#${n}</b>`);
  s = s.replace(/&lt;(https?:\/\/[^|&]+)\|([^&]+)&gt;/g, (_, u, n) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${n}</a>`);
  s = s.replace(/&lt;(https?:\/\/[^&]+)&gt;/g, (_, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/```([\s\S]+?)```/g, '<pre>$1</pre>').replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<b>$2</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>').replace(/(^|\s)~([^~\n]+)~/g, '$1<s>$2</s>');
  return s.replace(/\n/g, '<br>');
}
const hora = (ts) => new Date(Number(ts) * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function concluirRetorno() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  if (q.get('slackErro')) { toast(q.get('slackErro'), 'erro'); history.replaceState(null, '', '#/slack'); return; }
  if (!q.get('slackCode')) return;
  try { const r = await api.post('/api/slack/concluir', { code: q.get('slackCode'), state: q.get('slackState') }); toast(`Slack conectado${r.equipe ? ` (${r.equipe})` : ''}${r.bot ? ' · bot dos avisos instalado' : ''}`); }
  catch (e) { erroDe(e); }
  history.replaceState(null, '', '#/slack');
}

export default async function slack() {
  await concluirRetorno();
  const st = await api.get('/api/slack/estado');
  const abrirWeb = html`<a class="btn btn--ghost" href="${st.linkWeb}" target="_blank" rel="noopener noreferrer">${icone('arrowUpRight')}Abrir no Slack</a>`;
  if (!st.euConectado) {
    return { titulo: 'Slack', html: html`${cabecalho({ titulo: 'Slack', sub: 'O Slack do escritório dentro do LAB, com a sua conta.', acoes: abrirWeb })}
      <section class="card glass up mt sk-conectar">${st.appConfigurado
        ? vazio('comment', 'Conecte o seu Slack', 'Você autoriza uma vez, na tela do Slack. Depois, suas conversas e canais aparecem aqui e você responde sem sair do LAB. Os avisos de prazos, tarefas e reuniões também chegam no seu Slack.', '<button class="btn btn--accent" data-conectar>Conectar meu Slack</button>')
        : vazio('settings', 'Slack ainda não configurado', pode('admin.gerir') ? 'Cadastre o app do Slack do escritório em Ajustes → Slack (leva 5 minutos, o passo a passo está lá).' : 'A administração precisa cadastrar o app do Slack do escritório em Ajustes → Slack.', pode('admin.gerir') ? '<a class="btn btn--accent" href="#/ajustes/slack">Ir para Ajustes → Slack</a>' : '')}</section>`,
      depois(el) { ouvir(el, 'click', '[data-conectar]', async () => { try { const r = await api.get(`/api/slack/conectar?origem=${encodeURIComponent(location.origin)}`); location.assign(r.url); } catch (e) { erroDe(e); } }); } };
  }
  let dados;
  try { dados = await api.get('/api/slack/conversas'); }
  catch (e) { return { titulo: 'Slack', html: html`${cabecalho({ titulo: 'Slack', acoes: abrirWeb })}<section class="card glass up mt">${vazio('alert', 'Não consegui falar com o Slack', `${e.message}. Se você trocou a senha ou removeu o app, conecte de novo.`, '<button class="btn btn--accent" data-reconectar>Conectar de novo</button>')}</section>`,
    depois(el) { ouvir(el, 'click', '[data-reconectar]', async () => { await api.del('/api/slack/conexao'); navegar(); }); } }; }
  const { conversas, pessoas } = dados;
  const grupos = [['Canais', conversas.filter((c) => c.tipo === 'canal' || c.tipo === 'privado')], ['Mensagens diretas', conversas.filter((c) => c.tipo === 'dm' || c.tipo === 'grupo').sort((a, b) => b.atualizado - a.atualizado)]];
  let atual = sessionStorage.getItem('nx-slack-canal');
  if (!conversas.some((c) => c.id === atual)) atual = (grupos[1][1][0] ?? conversas[0])?.id ?? null;

  return {
    titulo: 'Slack',
    html: html`${cabecalho({ titulo: 'Slack', sub: html`Conectado como <b>${pessoas[st.eu.slackUserId]?.nome ?? 'você'}</b>${st.eu.equipe ? ` · ${st.eu.equipe}` : ''}`, acoes: html`${abrirWeb}<button class="btn btn--ghost" data-desconectar>Desconectar</button>` })}
      <div class="sk mt">
        <aside class="sk-lista card glass"><label class="proj-filtros__busca">${icone('search')}<input class="input" type="search" data-filtro placeholder="Buscar conversa" aria-label="Buscar conversa"></label>
          ${grupos.map(([t, l]) => html`<p class="sk-sec">${t} <small>${l.length}</small></p><ul>${l.map((c) => html`<li><button type="button" class="sk-conv ${c.id === atual ? 'is-sel' : ''}" data-conv="${c.id}" data-nome="${c.nome.toLowerCase()}">
            ${c.foto ? html`<img src="${c.foto}" alt="" width="22" height="22">` : html`<span class="sk-ico">${TIPO[c.tipo]}</span>`}<span>${c.nome}</span></button></li>`)}</ul>`)}</aside>
        <section class="sk-chat card glass" data-chat><div class="skel" style="height:300px"></div></section>
      </div>`,
    depois(el) {
      const chat = el.querySelector('[data-chat]'); let timer = 0; let ultimo = '';
      const desenhar = async (rolar = true) => {
        if (!atual) { chat.innerHTML = String(vazio('comment', 'Nenhuma conversa', 'Entre num canal pelo Slack para ele aparecer aqui.')); return; }
        const c = conversas.find((x) => x.id === atual);
        try {
          const { mensagens } = await api.get(`/api/slack/conversas/${atual}/mensagens`);
          const assinatura = mensagens.map((m) => m.ts).join(','); if (!rolar && assinatura === ultimo) return; ultimo = assinatura;
          const caixa = chat.querySelector('.sk-msgs'); const noFim = !caixa || caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80;
          const rascunho = chat.querySelector('[data-texto]')?.value ?? '';
          chat.innerHTML = String(html`<header class="sk-chat__head"><b>${TIPO[c.tipo]}${c.nome}</b><a class="btn btn--ghost btn--sm" href="https://app.slack.com/client/${EQUIPE}/${c.id}" target="_blank" rel="noopener noreferrer">${icone('arrowUpRight')}Abrir no Slack</a></header>
            <div class="sk-msgs">${mensagens.length ? mensagens.map((m) => { const p = pessoas[m.usuario]; return html`<article class="sk-msg ${m.usuario === st.eu.slackUserId ? 'eu' : ''}">
                ${p?.foto ? html`<img src="${p.foto}" alt="" width="34" height="34">` : html`<span class="sk-av">${(p?.nome ?? m.bot ?? '?').slice(0, 1)}</span>`}
                <div><p class="sk-msg__autor"><b>${p?.nome ?? m.bot ?? 'Aplicativo'}</b> <small>${hora(m.ts)}</small></p><div class="sk-msg__txt">${raw(mrkdwn(m.texto, pessoas))}</div>
                ${m.arquivos.length ? html`<p class="dica">📎 ${m.arquivos.join(', ')} (abra no Slack)</p>` : ''}${m.respostas ? html`<p class="dica">${m.respostas} resposta(s) na conversa · abra no Slack</p>` : ''}</div></article>`; }) : html`<p class="dica">Nenhuma mensagem recente.</p>`}</div>
            <form class="sk-envio" data-envio><textarea class="textarea" data-texto rows="2" placeholder="Mensagem para ${c.tipo === 'dm' ? c.nome : `#${c.nome}`} · Enter envia, Shift+Enter quebra linha"></textarea><button class="btn btn--accent" type="submit">${icone('arrowUpRight')}Enviar</button></form>`);
          chat.querySelector('[data-texto]').value = rascunho;
          const nova = chat.querySelector('.sk-msgs'); if (rolar || noFim) nova.scrollTop = nova.scrollHeight;
        } catch (e) { chat.innerHTML = String(html`<p class="selo erro">${e.message}</p>`); }
      };
      desenhar();
      timer = setInterval(() => { if (!el.isConnected) return clearInterval(timer); if (document.visibilityState === 'visible') desenhar(false); }, 10_000);
      aoSair(() => clearInterval(timer));
      ouvir(el, 'click', '[data-conv]', (b) => { atual = b.dataset.conv; sessionStorage.setItem('nx-slack-canal', atual); el.querySelectorAll('.sk-conv').forEach((x) => x.classList.toggle('is-sel', x === b)); ultimo = ''; desenhar(); });
      ouvir(el, 'input', '[data-filtro]', (i) => { const q = i.value.toLowerCase().trim(); el.querySelectorAll('.sk-conv').forEach((b) => { b.parentElement.hidden = q && !b.dataset.nome.includes(q); }); });
      const enviar = async (form) => { const t = form.querySelector('[data-texto]'); const texto = t.value.trim(); if (!texto) return; t.disabled = true;
        try { await api.post('/api/slack/mensagens', { canal: atual, texto }); t.value = ''; ultimo = ''; await desenhar(); } catch (e) { erroDe(e); } finally { t.disabled = false; el.querySelector('[data-texto]')?.focus(); } };
      ouvir(el, 'submit', '[data-envio]', (f, e) => { e.preventDefault(); enviar(f); });
      ouvir(el, 'keydown', '[data-texto]', (t, e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(t.closest('form')); } });
      ouvir(el, 'click', '[data-desconectar]', async () => { await api.del('/api/slack/conexao'); toast('Slack desconectado'); navegar(); });
    },
  };
}
