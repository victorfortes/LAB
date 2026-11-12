/**
 * Calendário: reuniões, prazos processuais e tarefas no mesmo mês, cada tipo com a sua cor.
 *
 * Mês à esquerda; à direita, o dia escolhido (tudo dele, com detalhe) e a agenda dos próximos 7 dias.
 * Os filtros são botões coloridos que ligam e desligam cada tipo. Prazos contam dias úteis forenses
 * (arts. 219, 220 e 224 do CPC); feriado estadual, municipal e suspensão do tribunal ficam na ressalva.
 */
import { api } from '../api.js';
import { estado, pode } from '../estado.js';
import { dataBR, guardado, hojeISO, html, icone, ouvir, raw } from '../util.js';
import { cabecalho, formulario, erroDe, toast, modal } from '../ui.js';
import { ir, navegar } from '../shell.js';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const iso = (a, m, d) => `${a}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** Tipos que aparecem no calendário: rótulo e grupo do filtro. As cores ficam no CSS (.cal-t--<tipo>). */
const TIPOS = {
  reuniao: ['Reunião', 'reunioes'], audiencia: ['Audiência', 'reunioes'], cliente: ['Com cliente', 'reunioes'], interno: ['Interno', 'reunioes'], lembrete: ['Lembrete', 'reunioes'],
  prazo: ['Prazo', 'prazos'], vencido: ['Prazo vencido', 'prazos'], tarefa: ['Tarefa', 'tarefas'],
};
const GRUPOS = [['reunioes', 'Reuniões', 'reuniao'], ['prazos', 'Prazos', 'prazo'], ['tarefas', 'Tarefas', 'tarefa']];
const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const diaLongo = (c) => new Date(`${c}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

export default async function calendario() {
  const hoje = hojeISO();
  const ref = guardado.ler('calMes', null) ?? hoje.slice(0, 7);
  const [ano, mes0] = ref.split('-').map(Number); const mes = mes0 - 1;
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  const fimJanela = new Date(Math.max(new Date(ano, mes + 1, 0), Date.now() + 8 * 86_400_000)).toLocaleDateString('sv-SE');
  const [agenda, tar, fer, google, eventos] = await Promise.all([
    api.get(`/api/agenda?ate=${fimJanela}`), api.get('/api/tarefas'), api.get(`/api/calendario/feriados?ano=${ano}`),
    api.get('/api/google/status').catch(() => null), api.get('/api/google/eventos').catch(() => []),
  ]);
  const feriados = new Map(fer.feriados.map((f) => [f.data, f]));
  const ligados = new Set(guardado.ler('calTipos', ['reunioes', 'prazos', 'tarefas']));

  // Todos os itens, de qualquer mês, num formato só.
  const todos = [];
  for (const z of agenda.itens) todos.push({ dia: z.vencimento, tipo: z.vencido ? 'vencido' : 'prazo', titulo: z.titulo, sub: `${z.numero}${z.projeto ? ` · ${z.projeto}` : ''}`, alvo: z.projeto_id ? `projetos/${z.projeto_id}/processos` : 'projetos', ordem: '00:00' });
  for (const e of eventos) { const dia = new Date(e.inicio).toLocaleDateString('sv-SE'); todos.push({ dia, tipo: TIPOS[e.marcador] ? e.marcador : 'reuniao', titulo: e.titulo, sub: `${hora(e.inicio)}–${hora(e.fim)}${e.pauta?.length ? ` · pauta com ${e.pauta.length} item(ns)` : ''}`, hora: hora(e.inicio), evento: e, ordem: hora(e.inicio) }); }
  for (const t of tar.tarefas) if (t.prazo && t.status !== 'concluida') todos.push({ dia: t.prazo, tipo: 'tarefa', titulo: t.titulo, sub: t.projeto ?? '', alvo: `projetos/${t.projetoId}/tarefas`, ordem: '23:59' });
  const visiveis = todos.filter((x) => ligados.has(TIPOS[x.tipo]?.[1] ?? 'reunioes')).sort((a, b) => a.ordem.localeCompare(b.ordem));
  const porDia = new Map(); for (const x of visiveis) porDia.set(x.dia, [...(porDia.get(x.dia) ?? []), x]);
  const doMes = visiveis.filter((x) => x.dia.startsWith(ref));
  const conta = (g) => todos.filter((x) => x.dia.startsWith(ref) && TIPOS[x.tipo]?.[1] === g).length;
  const vencidosAntes = agenda.itens.filter((z) => z.vencido && z.vencimento < `${ref}-01`);

  const primeiroDow = new Date(ano, mes, 1).getDay();
  const celulas = []; for (let i = 0; i < primeiroDow; i++) celulas.push(null);
  for (let d = 1; d <= ultimo; d++) celulas.push(d); while (celulas.length % 7) celulas.push(null);
  const ehNaoUtil = (a, m, d) => { const w = new Date(a, m, d).getDay(); const c = iso(a, m, d); return w === 0 || w === 6 || feriados.has(c) || (fer.recesso && ((m === 11 && d >= 20) || (m === 0 && d <= 20))); };
  const selecionado = guardado.ler('calDia', null)?.startsWith(ref) ? guardado.ler('calDia', null) : (hoje.startsWith(ref) ? hoje : `${ref}-01`);
  const semana = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86_400_000).toLocaleDateString('sv-SE'));
  const nav = (delta) => { const d = new Date(ano, mes + delta, 1); guardado.gravar('calMes', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); navegar(); };

  const itemLista = (x) => html`<li class="cal-item cal-t--${x.tipo}" ${x.evento ? raw(`data-evento="${x.evento.id}"`) : raw(`data-ir="${x.alvo}"`)}><i></i><div><b>${x.titulo}</b><small>${TIPOS[x.tipo]?.[0] ?? x.tipo}${x.sub ? ` · ${x.sub}` : ''}</small></div></li>`;
  const painelDia = (c) => { const l = porDia.get(c) ?? []; const f = feriados.get(c);
    return html`<header class="cal-lado__head"><div><p class="eyebrow">${c === hoje ? 'Hoje' : 'Dia escolhido'}</p><h3>${diaLongo(c)}</h3>${f ? html`<small class="cal__feriado">${f.nome}</small>` : ''}</div>
      ${pode('tarefa.escrever') ? html`<button class="btn btn--accent btn--sm" data-evento-novo="${c}">${icone('plus')}Evento</button>` : ''}</header>
      ${l.length ? html`<ul class="cal-lista">${l.map(itemLista)}</ul>` : html`<p class="dica">Nada marcado neste dia.</p>`}`; };

  return {
    titulo: 'Calendário',
    html: html`${cabecalho({
      titulo: 'Calendário', sub: 'Reuniões, prazos e tarefas da equipe. Clique num dia para ver tudo dele.',
      acoes: html`${pode('tarefa.escrever') ? html`<button type="button" class="btn btn--accent" data-evento-novo="${selecionado}">${icone('plus')}Nova reunião</button>` : ''}<button type="button" class="btn btn--ghost" data-google>${google?.conectado ? 'Google conectado' : google?.reconectar ? 'Renovar Google' : 'Conectar Google'}</button>`,
      resumo: [{ rotulo: 'Reuniões no mês', valor: conta('reunioes') }, { rotulo: 'Prazos no mês', valor: conta('prazos') }, { rotulo: 'Tarefas no mês', valor: conta('tarefas') },
        { rotulo: 'Vencidos', valor: agenda.vencidos, tom: agenda.vencidos ? 'alert' : 'ok' }],
    })}
    ${google?.reconectar ? html`<p class="nota mt" style="color:var(--lab-red)">${google.motivo}</p>` : !google?.conectado ? html`<p class="nota mt">Conecte sua conta Google para o convite chegar no Calendar de todos, com Meet e a pauta.</p>` : ''}
    ${vencidosAntes.length ? html`<details class="card glass up mt cal-vencidos"><summary><b>${vencidosAntes.length} prazo(s) vencido(s) de meses anteriores</b> ainda abertos</summary>
      <ul class="cal-lista mt">${vencidosAntes.map((z) => html`<li class="cal-item cal-t--vencido" data-ir="${z.projeto_id ? `projetos/${z.projeto_id}/processos` : 'projetos'}"><i></i><div><b>${z.titulo}</b><small>${z.numero} · venceu em ${dataBR(z.vencimento)}</small></div></li>`)}</ul></details>` : ''}
    <div class="cal-layout mt">
      <section class="card glass up cal-mes">
        <div class="cal-barra">
          <div class="cal-nav"><button type="button" class="ibtn" data-nav="-1" aria-label="Mês anterior">${icone('chevronLeft')}</button><h2>${MESES[mes]} <span>${ano}</span></h2><button type="button" class="ibtn" data-nav="1" aria-label="Próximo mês">${icone('chevron')}</button>
            <button type="button" class="btn btn--ghost btn--sm" data-nav="0">Hoje</button></div>
          <div class="cal-filtros" role="group" aria-label="Mostrar">${GRUPOS.map(([g, t, tipo]) => html`<button type="button" class="cal-filtro cal-t--${tipo}" data-tipo-cal="${g}" aria-pressed="${ligados.has(g)}"><i></i>${t}<b>${conta(g)}</b></button>`)}</div>
        </div>
        <div class="cal">${DOW.map((d) => html`<div class="cal__dow">${d}</div>`)}
          ${celulas.map((d) => {
            if (!d) return html`<div class="cal__dia fora"></div>`;
            const c = iso(ano, mes, d); const evs = porDia.get(c) ?? []; const f = feriados.get(c);
            return html`<div class="cal__dia ${c === hoje ? 'hoje' : ''} ${c === selecionado ? 'sel' : ''} ${ehNaoUtil(ano, mes, d) ? 'nao-util' : ''}" data-dia="${c}" tabindex="0" role="button" aria-label="${diaLongo(c)}: ${evs.length} item(ns)">
              <span class="cal__num">${d}</span>${f ? html`<span class="cal__feriado" title="${f.nome}">${f.nome}</span>` : ''}
              ${evs.slice(0, 3).map((e) => html`<span class="cal__ev cal-t--${e.tipo}" title="${e.titulo} · ${e.sub}">${e.hora ? html`<em>${e.hora}</em>` : ''}${e.titulo}</span>`)}
              ${evs.length > 3 ? html`<span class="cal__mais">+${evs.length - 3} mais</span>` : ''}
              ${evs.length ? html`<span class="cal__pontos">${[...new Set(evs.map((e) => TIPOS[e.tipo]?.[1]))].map((g) => html`<i class="cal-t--${GRUPOS.find((x) => x[0] === g)?.[2]}"></i>`)}</span>` : ''}</div>`;
          })}
        </div>
        <p class="nota mt">Dias apagados: fim de semana, feriado nacional ou recesso (art. 220 do CPC). ${fer.ressalva} Confira o calendário da comarca antes de confiar numa data.</p>
      </section>
      <aside class="cal-lado">
        <section class="card glass up" data-painel-dia>${painelDia(selecionado)}</section>
        <section class="card glass up mt"><header class="cal-lado__head"><div><p class="eyebrow">Próximos 7 dias</p><h3>Agenda</h3></div></header>
          ${semana.some((c) => porDia.get(c)?.length) ? semana.filter((c) => porDia.get(c)?.length).map((c) => html`<div class="cal-agenda__dia"><small>${c === hoje ? 'Hoje' : diaLongo(c)}</small><ul class="cal-lista">${porDia.get(c).map(itemLista)}</ul></div>`) : html`<p class="dica">Semana livre nos tipos selecionados.</p>`}</section>
      </aside>
    </div>`,
    depois(raiz) {
      ouvir(raiz, 'click', '[data-nav]', (b) => { const v = Number(b.dataset.nav); if (v === 0) { guardado.gravar('calMes', null); guardado.gravar('calDia', hoje); navegar(); } else nav(v); });
      ouvir(raiz, 'click', '[data-tipo-cal]', (b) => { const g = b.dataset.tipoCal; if (ligados.has(g)) ligados.delete(g); else ligados.add(g); guardado.gravar('calTipos', [...ligados]); navegar(); });
      const escolher = (c) => { guardado.gravar('calDia', c); raiz.querySelectorAll('.cal__dia.sel').forEach((x) => x.classList.remove('sel')); raiz.querySelector(`[data-dia="${c}"]`)?.classList.add('sel'); raiz.querySelector('[data-painel-dia]').innerHTML = String(painelDia(c)); };
      ouvir(raiz, 'click', '[data-dia]', (b) => escolher(b.dataset.dia));
      ouvir(raiz, 'keydown', '[data-dia]', (b, e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(b.dataset.dia); } });
      ouvir(raiz, 'dblclick', '[data-dia]', (b) => { if (pode('tarefa.escrever')) novoEvento(b.dataset.dia, google); });
      ouvir(raiz, 'click', '[data-evento-novo]', (b) => novoEvento(b.dataset.eventoNovo, google));
      ouvir(raiz, 'click', '[data-google]', () => conectarGoogle(google));
      ouvir(raiz, 'click', '[data-evento]', (b) => abrirEvento(eventos.find((e) => e.id === b.dataset.evento)));
      ouvir(raiz, 'click', '[data-ir]', (b) => ir(b.dataset.ir));
      void doMes;
    },
  };
}

async function conectarGoogle(estadoGoogle) {
  try {
    if (estadoGoogle?.configurado === false) {
      await modal({ titulo: 'Configurar conexão Google', corpo: String(html`<p class="dica">A integração precisa de uma credencial OAuth do Google Cloud e autorização da conta do escritório.</p><ul class="lista">${(estadoGoogle.instrucoes ?? []).map((i) => html`<li>${i}</li>`)}</ul><p class="dica">URI de redirecionamento: <code>${estadoGoogle.redirectUri}</code></p><p class="dica">Configuração pendente: ${(estadoGoogle.faltantes ?? []).join(', ')}</p>`), acoes: [{ id: 'ok', rotulo: 'Fechar' }], aoAbrir(el) { el.addEventListener('acao', () => el.fechar(true)); } }); return;
    }
    const r = await api.get('/api/google/conectar'); location.assign(r.url);
  } catch (e) { erroDe(e); }
}

/**
 * Pauta escrita no convite: um item por linha. "— Fulano" no fim indica quem conduz; "(15 min)" o tempo.
 * Ex.: "Apresentar o diagnóstico — Victor (20 min)".
 */
export function lerPauta(texto) {
  return String(texto ?? '').split('\n').map((l) => l.replace(/^\s*(\d+[.)-]|[-•*])\s*/, '').trim()).filter(Boolean).slice(0, 40).map((l) => {
    let t = l; let minutos; let responsavel;
    const m = /\((\d{1,3})\s*min\)\s*$/i.exec(t); if (m) { minutos = Number(m[1]); t = t.slice(0, m.index).trim(); }
    const r = /\s[—–-]\s([^—–-]{2,60})$/.exec(t); if (r) { responsavel = r[1].trim(); t = t.slice(0, r.index).trim(); }
    return { texto: t.slice(0, 300), ...(responsavel ? { responsavel } : {}), ...(minutos ? { minutos } : {}), feito: false };
  });
}

/** Novo evento (com pauta). `fixo` traz o projeto quando a reunião nasce dentro do projeto. */
export async function novoEvento(dia, google, fixo = null) {
  if (!estado.projetos.length) estado.projetos = await api.get('/api/projetos');
  const projetos = estado.projetos.filter((p) => p.situacao !== 'encerrado');
  if (!projetos.length) return toast('Crie um projeto para vincular o evento.', 'aviso');
  google ??= await api.get('/api/google/status').catch(() => null);
  const ok = await formulario({ titulo: 'Nova reunião', subtitulo: google?.conectado ? 'O convite vai para o Google Calendar de todos, com a pauta escrita na descrição.' : 'Evento local. Conecte o Google para enviar o convite com Meet e pauta.', rotulo: 'Criar e enviar convite', largo: true, campos: [
    ...(fixo ? [] : [{ nome: 'projetoId', rotulo: 'Projeto', tipo: 'select', obrigatorio: true, opcoes: projetos.map((p) => ({ v: p.id, t: p.nome })) }]),
    { nome: 'titulo', rotulo: 'Título', obrigatorio: true, placeholder: 'Reunião de alinhamento com o cliente' },
    { nome: 'inicio', rotulo: 'Início', tipo: 'datetime-local', valor: `${dia}T09:00`, obrigatorio: true, metade: true },
    { nome: 'fim', rotulo: 'Término', tipo: 'datetime-local', valor: `${dia}T10:00`, obrigatorio: true, metade: true },
    { nome: 'marcador', rotulo: 'Tipo', tipo: 'select', valor: 'reuniao', metade: true, opcoes: [{ v: 'reuniao', t: 'Reunião' }, { v: 'cliente', t: 'Com cliente' }, { v: 'audiencia', t: 'Audiência' }, { v: 'interno', t: 'Interno' }, { v: 'lembrete', t: 'Lembrete' }, { v: 'prazo', t: 'Prazo' }] },
    { nome: 'meet', rotulo: 'Google Meet', tipo: 'select', valor: google?.conectado ? 'sim' : 'nao', metade: true, opcoes: [{ v: 'sim', t: 'Criar link de reunião' }, { v: 'nao', t: 'Sem videoconferência' }] },
    { nome: 'pauta', rotulo: 'Pauta (um item por linha)', tipo: 'textarea', placeholder: 'Apresentar o diagnóstico — Victor (20 min)\nDocumentos que faltam — Bruna (10 min)\nPróximos passos (10 min)', dica: 'Vai escrita no convite. Durante a reunião, marque o que foi tratado e as decisões na aba Atas do projeto.' },
    { nome: 'convidados', rotulo: 'Outros participantes', tipo: 'textarea', placeholder: 'email@cliente.com.br, outra@empresa.com.br', dica: 'A equipe do projeto já recebe o convite. Separe os e-mails por vírgula.' },
    { nome: 'descricao', rotulo: 'Observações', tipo: 'textarea' }],
    enviar: async (v) => {
      const inicio = new Date(v.inicio), fim = new Date(v.fim); if (fim <= inicio) throw new Error('O término deve ser depois do início.');
      if (v.meet === 'sim' && !google?.conectado) throw new Error('Conecte o Google antes de solicitar um link Meet.');
      const convidados = String(v.convidados ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      const invalido = convidados.find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)); if (invalido) throw new Error(`E-mail inválido: ${invalido}`);
      const r = await api.post('/api/google/eventos', { projetoId: fixo ?? v.projetoId, titulo: v.titulo, inicio: inicio.toISOString(), fim: fim.toISOString(), marcador: v.marcador, descricao: v.descricao ?? '', criarMeet: v.meet === 'sim', convidados, pauta: lerPauta(v.pauta) });
      if (r.pendente) toast(`Reunião salva no Nexus, mas o convite não foi para o Google: ${r.erro ?? 'tente de novo em instantes.'}`, 'aviso'); else toast('Reunião criada e convite enviado');
    },
  });
  if (ok) navegar();
  return ok;
}

async function abrirEvento(e) {
  if (!e) return;
  await modal({ titulo: e.titulo, corpo: String(html`<p>${dataBR(e.inicio)} · ${hora(e.inicio)} — ${hora(e.fim)}</p><span class="selo cal-t--${TIPOS[e.marcador] ? e.marcador : 'reuniao'} cal-selo">${TIPOS[e.marcador]?.[0] ?? e.marcador}</span>
    ${e.pauta?.length ? html`<h3 class="mini-h">Pauta</h3><ol class="pauta-lista">${e.pauta.map((p) => html`<li class="${p.feito ? 'feito' : ''}">${p.texto}${p.responsavel ? html` <small>· ${p.responsavel}</small>` : ''}${p.minutos ? html` <small>· ${p.minutos} min</small>` : ''}${p.decisao ? html`<small class="pauta-decisao">Decisão: ${p.decisao}</small>` : ''}</li>`)}</ol>` : ''}
    <p class="dica" style="white-space:pre-wrap">${e.descricao ?? ''}</p>${e.convidados?.length ? html`<p class="dica"><b>Convidados:</b> ${e.convidados.join(', ')}</p>` : ''}
    <div class="nx-acts">${e.meet_url ? html`<a class="btn btn--accent" href="${e.meet_url}" target="_blank" rel="noopener noreferrer">Entrar no Meet ↗</a>` : ''}${e.google_url ? html`<a class="btn btn--ghost" href="${e.google_url}" target="_blank" rel="noopener noreferrer">Abrir no Google Calendar ↗</a>` : html`<p class="dica">Ainda não sincronizado com o Google. ${e.erro ?? ''}</p>`}</div>`),
    acoes: [{ id: 'pauta', rotulo: 'Pauta e decisões' }, { id: 'ok', rotulo: 'Fechar', tipo: 'primario' }],
    aoAbrir(el) { el.addEventListener('acao', (ev) => { el.fechar(true); if (ev.detail.id === 'pauta') ir(`projetos/${e.projeto_id}/atas`); }); } });
}
