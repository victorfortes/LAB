/** Órbita interativa do ecossistema: links reais, estado do servidor e movimento opcional. */
import { html, icone, ouvir } from './util.js';

export const ICONE_FERRAMENTA = { prazos:'calendar',sentinela:'radar',integra:'file',radar:'target',relatorios:'chart' };
export function ferramentaRemota(f) {
  try { const u = new URL(f.url); return /^https?:$/.test(u.protocol) && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && !u.hostname.endsWith('.localhost'); } catch { return false; }
}
export function itensDeFerramentas(ferramentas = []) {
  return ferramentas.filter((f) => !f.semInterface).map((f) => {
    const remota = ferramentaRemota(f), direta = f.semIncorporar || f.independente || (remota && !f.noAr);
    return { id:f.id,nome:f.nome,icone:ICONE_FERRAMENTA[f.id] ?? 'bolt',descricao:f.descricao,
      href:direta ? (remota ? f.url : f.caminho ?? f.url) : `#/ferramentas/${f.id}`,novaAba:!!direta,
      estado:f.noAr ? 'Disponível agora' : remota ? 'Disponibilidade não confirmada' : 'Fora do ar',ativo:f.noAr ? true : remota ? undefined : false };
  });
}
/** Graphic used only before entering a system, faithful to the exported NGA cover. */
export function lobbyOrbita({ itens, titulo='NGA LAB',chave='entrada',acessoRestrito=false }) {
  const visiveis=itens.filter(i=>i.href).slice(0,12);
  const aneis=[{diametro:270,tempo:60,classe:'r1',itens:visiveis.slice(0,3)},{diametro:420,tempo:90,classe:'r2',itens:visiveis.slice(3,7)},{diametro:560,tempo:130,classe:'r3',itens:visiveis.slice(7,12)}];
  return html`<div class="nga-cover-orbit" data-lobby="${chave}" data-lobby-restrito="${acessoRestrito}" aria-label="${titulo}"><div class="nga-cover-orbit__scene">
    ${aneis.filter(r=>r.itens.length).map(r=>html`<div class="nga-cover-ring ${r.classe}" style="--d:${r.diametro}px;--t:${r.tempo}s">${r.itens.map((i,n)=>html`<div class="nga-cover-position" style="--a:${n*360/r.itens.length+(r.diametro%7)*9}deg"><div class="nga-cover-upright"><a class="nga-cover-icon" data-lobby-item="${i.id}" href="${i.href}" aria-label="${i.nome} · acesso após login" title="${i.nome}">${icone(i.icone)}<span>${i.nome}</span></a></div></div>`)}</div>`)}
    <a class="nga-cover-core" href="#/painel" aria-label="Entrar no NGA LAB"><img src="/img/nga.png" alt="NGA LAB"></a>
  </div><button class="nga-cover-motion" type="button" data-lobby-movimento aria-pressed="false">Pausar movimento</button></div>`;
}
export function ligarLobby(raiz, itens = [], aoSolicitarAcesso) {
  for(const lobby of raiz.querySelectorAll('[data-lobby]')) {
    if(lobby.dataset.lobbyRestrito==='true')ouvir(lobby,'click','a',(b,e)=>{e.preventDefault();if(aoSolicitarAcesso)aoSolicitarAcesso();else document.querySelector('#lf input[name=email]')?.focus();});
    ouvir(lobby,'click','[data-lobby-movimento]',b=>{const pausa=lobby.classList.toggle('is-paused');b.setAttribute('aria-pressed',String(pausa));b.textContent=pausa?'Retomar movimento':'Pausar movimento';});
  }
}
