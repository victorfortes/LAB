/**
 * Calendário: prazos do CPC e tarefas, no mesmo mês.
 *
 * Os prazos vêm contados em dias úteis forenses (arts. 219, 220 e 224). O que
 * o sistema NÃO sabe — feriado estadual, municipal e suspensão do tribunal —
 * está dito na própria tela, junto do calendário: uma data bonita sem essa
 * ressalva faria o advogado confiar no que não deve.
 */
import { api } from '../api.js';
import { estado, pode } from '../estado.js';
import { dataBR, guardado, hojeISO, html, icone, matiz, ouvir, raw } from '../util.js';
import { cabecalho, vazio, formulario, erroDe, toast, modal } from '../ui.js';
import { ir, navegar } from '../shell.js';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const iso = (a, m, d) => `${a}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export default async function calendario() {
  const hoje = hojeISO();
  const ref = guardado.ler('calMes', null) ?? hoje.slice(0, 7);
  const [ano, mes0] = ref.split('-').map(Number); const mes = mes0 - 1;
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  const [agenda, tar, fer, google, eventos] = await Promise.all([
    api.get(`/api/agenda?ate=${iso(ano, mes, ultimo)}`),
    api.get('/api/tarefas'),
    api.get(`/api/calendario/feriados?ano=${ano}`),
    api.get('/api/google/status').catch(() => null),
    api.get('/api/google/eventos'),
  ]);

  const feriados = new Map(fer.feriados.map((f) => [f.data, f]));
  const prazos = agenda.itens.filter((z) => z.vencimento.startsWith(ref));
  const vencidosAntes = agenda.itens.filter((z) => z.vencido && z.vencimento < `${ref}-01`);
  const tarefas = tar.tarefas.filter((t) => t.prazo && t.prazo.startsWith(ref) && t.status !== 'concluida');
  const porDia = new Map();
  const push = (d, e) => porDia.set(d, [...(porDia.get(d) ?? []), e]);
  for (const z of prazos) push(z.vencimento, { tipo: z.vencido ? 'vencido' : 'prazo', rotulo: z.titulo, dica: `${z.numero}${z.projeto ? ` · ${z.projeto}` : ''}`, alvo: z.projeto_id ? `projetos/${z.projeto_id}/processos` : 'projetos' });
  for (const e of eventos) {
    const dia = new Date(e.inicio).toLocaleDateString('sv-SE');
    if (dia.startsWith(ref)) push(dia, { tipo: e.marcador ?? 'reuniao', rotulo: e.titulo, dica: new Date(e.inicio).toLocaleTimeString('pt-BR', { hour:'2-digit',minute:'2-digit' }), evento: e });
  }
  for (const t of tarefas) push(t.prazo, { tipo: 'tarefa', rotulo: t.titulo, dica: t.projeto, alvo: `projetos/${t.projetoId}/tarefas` });

  const primeiroDow = new Date(ano, mes, 1).getDay();
  const celulas = [];
  for (let i = 0; i < primeiroDow; i++) celulas.push(null);
  for (let d = 1; d <= ultimo; d++) celulas.push(d);
  while (celulas.length % 7) celulas.push(null);

  const ehNaoUtil = (a, m, d) => { const w = new Date(a, m, d).getDay(); const c = iso(a, m, d); return w === 0 || w === 6 || feriados.has(c) || fer.recesso && ((m === 11 && d >= 20) || (m === 0 && d <= 20)); };

  const nav = (delta) => { const d = new Date(ano, mes + delta, 1); guardado.gravar('calMes', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); navegar(); };
  const nPrazos = prazos.length;

  return {
    titulo: 'Calendário',
    html: html`${cabecalho({
      titulo: 'Calendário', sub: `${MESES[mes]} de ${ano} · prazos contados em dias úteis forenses`,
      acoes: html`${pode('tarefa.escrever') ? html`<button type="button" class="btn btn--accent" data-evento-novo="${hoje}">${icone('plus')}Novo evento</button>` : ''}<button type="button" class="btn btn--ghost" data-google>${google?.conectado ? 'Google conectado' : 'Conectar Google'}</button><div class="seg" role="group"><span class="seg__pill" aria-hidden="true"></span>
        <button type="button" class="seg__btn" data-nav="-1" aria-pressed="false">${icone('chevronLeft')}</button>
        <button type="button" class="seg__btn" data-nav="0" aria-pressed="false"><span>Hoje</span></button>
        <button type="button" class="seg__btn" data-nav="1" aria-pressed="false">${icone('chevron')}</button></div>`,
      resumo: [{ rotulo: 'Prazos no mês', valor: nPrazos }, { rotulo: 'Tarefas com prazo', valor: tarefas.length },
        { rotulo: 'Vencidos', valor: agenda.vencidos, tom: agenda.vencidos ? 'alert' : 'ok' }, { rotulo: 'Vencem hoje', valor: agenda.venceHoje, tom: agenda.venceHoje ? 'warn' : '' }],
    })}
    ${!google?.conectado ? html`<p class="nota mt">Conecte sua conta Google para criar eventos no Calendar, gerar links do Meet e organizar os documentos no Drive.${google?.configurado === false ? ' A configuração OAuth do escritório ainda precisa ser concluída em Ajustes.' : ''}</p>` : ''}
    ${vencidosAntes.length ? html`<div class="card glass up mt" style="border:1px solid #FF6B6B55"><header class="card__head"><div><h2 class="card__title" style="color:var(--lab-red)">${vencidosAntes.length} prazo(s) vencido(s) de meses anteriores</h2><p class="card__sub">Ainda abertos. Um prazo aberto com vencimento no passado é o achado mais importante desta tela.</p></div></header>
      <ul class="lista">${vencidosAntes.map((z) => html`<li style="cursor:pointer" data-ir="${z.projeto_id ? `projetos/${z.projeto_id}/processos` : 'projetos'}"><div><b>${z.titulo}</b><small>${z.numero} · venceu em ${dataBR(z.vencimento)}</small></div><div class="fim"><span class="selo erro">há ${-z.diasUteisRestantes} dia(s) útil(eis)</span></div></li>`)}</ul></div>` : ''}
    <section class="card glass up mt">
      <div class="cal">${DOW.map((d) => html`<div class="cal__dow">${d}</div>`)}
        ${celulas.map((d) => {
          if (!d) return html`<div class="cal__dia fora"></div>`;
          const c = iso(ano, mes, d); const evs = porDia.get(c) ?? []; const f = feriados.get(c);
          return html`<div class="cal__dia ${c === hoje ? 'hoje' : ''} ${ehNaoUtil(ano, mes, d) ? 'nao-util' : ''}"><b>${d}</b>${pode('tarefa.escrever') ? html`<button class="cal__create" data-evento-novo="${c}" aria-label="Criar evento em ${dataBR(c)}">+</button>` : ''}
            ${f ? html`<span class="cal__feriado">${f.nome}</span>` : ''}
            ${evs.slice(0, 3).map((e) => html`<button type="button" class="cal__ev ${e.tipo}" ${e.evento ? raw(`data-evento="${e.evento.id}"`) : raw(`data-ir="${e.alvo}"`)} title="${e.rotulo} — ${e.dica}">${e.rotulo}</button>`)}
            ${evs.length > 3 ? html`<small class="muted">+${evs.length - 3}</small>` : ''}</div>`;
        })}
      </div>
      <div class="flex mt" style="gap:18px"><span class="selo aviso"><i></i>Prazo processual</span><span class="selo info"><i></i>Tarefa</span><span class="selo erro"><i></i>Vencido</span>
        <span class="dica">Dias em cinza: fim de semana, feriado nacional ou recesso (art. 220 do CPC).</span></div>
      <p class="nota mt">${fer.ressalva} Confira o calendário da comarca antes de confiar numa data.</p>
    </section>`,
    depois(raiz) {
      ouvir(raiz, 'click', '[data-nav]', (b) => {
        const v = Number(b.dataset.nav);
        if (v === 0) { guardado.gravar('calMes', null); navegar(); } else nav(v);
      });
      ouvir(raiz, 'click', '[data-evento-novo]', (b) => novoEvento(b.dataset.eventoNovo, google));
      ouvir(raiz, 'click', '[data-google]', () => conectarGoogle(google));
      ouvir(raiz, 'click', '[data-evento]', (b) => abrirEvento(eventos.find((e) => e.id === b.dataset.evento)));
      ouvir(raiz, 'click', '[data-ir]', (b) => ir(b.dataset.ir));
    },
  };
}

async function conectarGoogle(estadoGoogle) {
  try {
    if (estadoGoogle?.configurado === false) {
      await modal({ titulo:'Configurar conexão Google', corpo:String(html`<p class="dica">A integração precisa de uma credencial OAuth do Google Cloud e autorização da conta do escritório.</p><ul class="lista">${(estadoGoogle.instrucoes ?? []).map((i) => html`<li>${i}</li>`)}</ul><p class="dica">URI de redirecionamento: <code>${estadoGoogle.redirectUri}</code></p><p class="dica">Configuração pendente: ${(estadoGoogle.faltantes ?? []).join(', ')}</p>`), acoes:[{ id:'ok',rotulo:'Fechar' }], aoAbrir(el) { el.addEventListener('acao', () => el.fechar(true)); } }); return;
    }
    const r = await api.get('/api/google/conectar'); location.assign(r.url);
  } catch (e) { erroDe(e); }
}

async function novoEvento(dia, google) {
  if (!estado.projetos.length) estado.projetos = await api.get('/api/projetos');
  const projetos = estado.projetos.filter((p) => p.situacao !== 'encerrado');
  if (!projetos.length) return toast('Crie um projeto para vincular o evento.', 'aviso');
  const ok = await formulario({ titulo:'Novo evento', subtitulo:google?.conectado ? 'O evento será criado também no Google Calendar.' : 'Evento local. A conexão Google permite sincronizar no Calendar e gerar Meet.', rotulo:'Criar evento', campos:[
    { nome:'projetoId',rotulo:'Projeto',tipo:'select',obrigatorio:true,opcoes:projetos.map((p) => ({ v:p.id,t:p.nome })) },
    { nome:'titulo',rotulo:'Título',obrigatorio:true },
    { nome:'inicio',rotulo:'Início',tipo:'datetime-local',valor:`${dia}T09:00`,obrigatorio:true,metade:true },
    { nome:'fim',rotulo:'Término',tipo:'datetime-local',valor:`${dia}T10:00`,obrigatorio:true,metade:true },
    { nome:'marcador',rotulo:'Marcador',tipo:'select',opcoes:[{v:'reuniao',t:'Reunião'},{v:'audiencia',t:'Audiência'},{v:'prazo',t:'Prazo'},{v:'lembrete',t:'Lembrete'},{v:'cliente',t:'Cliente'},{v:'interno',t:'Interno'}] },
    { nome:'meet',rotulo:'Google Meet',tipo:'select',valor:google?.conectado ? 'sim' : 'nao',opcoes:[{v:'sim',t:'Criar link de reunião'},{v:'nao',t:'Sem videoconferência'}] },
    { nome:'descricao',rotulo:'Descrição',tipo:'textarea' }],
    enviar:async (v) => { const inicio = new Date(v.inicio), fim = new Date(v.fim); if (fim <= inicio) throw new Error('O término deve ser depois do início.'); if (v.meet === 'sim' && !google?.conectado) throw new Error('Conecte o Google antes de solicitar um link Meet.'); await api.post('/api/google/eventos', { projetoId:v.projetoId,titulo:v.titulo,inicio:inicio.toISOString(),fim:fim.toISOString(),marcador:v.marcador,descricao:v.descricao,criarMeet:v.meet === 'sim' }); toast('Evento criado'); },
  }); if (ok) navegar();
}

async function abrirEvento(e) {
  if (!e) return;
  await modal({ titulo:e.titulo, corpo:String(html`<p>${dataBR(e.inicio)} · ${new Date(e.inicio).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} — ${new Date(e.fim).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</p><span class="selo info">${e.marcador}</span><p class="dica" style="white-space:pre-wrap">${e.descricao ?? ''}</p>${e.meet_url ? html`<a class="btn btn--accent" href="${e.meet_url}" target="_blank" rel="noopener noreferrer">Entrar no Meet ↗</a>` : ''}${e.google_url ? html`<a class="btn btn--ghost" href="${e.google_url}" target="_blank" rel="noopener noreferrer">Abrir no Google Calendar ↗</a>` : html`<p class="dica">Ainda não sincronizado com o Google. ${e.erro ?? ''}</p>`}`), acoes:[{id:'projeto',rotulo:'Abrir projeto'},{id:'ok',rotulo:'Fechar'}], aoAbrir(el) { el.addEventListener('acao', (ev) => { el.fechar(true); if (ev.detail.id === 'projeto') ir(`projetos/${e.projeto_id}`); }); } });
}
