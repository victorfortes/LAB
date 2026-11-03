/**
 * Painel do advogado: o que está na mesa hoje.
 *
 * Todo número aqui sai de uma consulta, e o que não há diz que não há — o
 * mesmo critério do §18 que vale para os relatórios. Os anéis têm
 * denominador real (tarefas, prazos, projetos); quando o denominador é zero o
 * anel mostra "sem dados" em vez de fingir 100%.
 */
import { api } from '../api.js';
import { estado, pode } from '../estado.js';
import { anel } from '../fx.js';
import { avatar, dataCurta, dataBR, hojeISO, html, icone, matiz, ouvir, pilha, raw, relativo } from '../util.js';
import { cabecalho, vazio, toast, erroDe } from '../ui.js';
import { aoSair, ir, navegar } from '../shell.js';
import { novaTarefa } from './tarefas.js';
import { cartaoProjeto, novoProjeto } from './projetos.js';

const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };
/** Texto humano para cada evento da trilha. O que não conheço cai num texto neutro, sem inventar. */
const EVENTO = {
  'portal.documento_enviado': ['upload', 'Cliente enviou um documento', 'a leitura automática começa agora'],
  'portal.requisito_analisado': ['check', 'Documento do cliente analisado', ''],
  'portal.cliente_convidado': ['user', 'Cliente convidado ao portal', ''],
  'portal.ajustado': ['eye', 'Visibilidade do portal ajustada', ''],
  'documento.arquivo_recebido': ['doc', 'Documento guardado no acervo', ''],
  'documento.publicado_para_cliente': ['eye', 'Documento publicado ao cliente', ''],
  'documento.retirado_do_portal': ['lock', 'Documento retirado do portal', ''],
  'analise.tipo_validado': ['shield', 'Tipo de documento validado', ''],
  'achado.triado': ['sparkle', 'Achado triado', ''],
  'projeto.criado': ['folder', 'Projeto criado', 'nome'], 'projeto.fase_alterada': ['flag', 'Fase do projeto alterada', 'fase'],
  'projeto.encerrado': ['inbox', 'Projeto encerrado', 'motivo'], 'projeto.equipe_alterada': ['users', 'Equipe do projeto alterada', ''],
  'tarefa.criada': ['check', 'Tarefa criada', 'titulo'], 'tarefa.excluida': ['trash', 'Tarefa excluída', 'titulo'],
  'credito.criado': ['scale', 'Crédito cadastrado', ''], 'credito.validado': ['scale', 'Enquadramento de crédito validado', ''], 'credor.criado': ['user', 'Credor cadastrado', 'nome'],
  'processo.criado': ['scale', 'Processo cadastrado', 'numero'], 'processo.movimentacao_registrada': ['file', 'Movimentação registrada', 'titulo'],
  'processo.movimentacao_publicada': ['eye', 'Movimentação publicada ao cliente', ''], 'prazo.criado': ['calendar', 'Prazo calculado', 'titulo'], 'prazo.fechado': ['check', 'Prazo fechado', 'situacao'],
  'checklist.modelo_aplicado': ['list', 'Checklist de documentos gerado', ''], 'integracao.processos_recebidos': ['bolt', 'Processos recebidos de uma integração', ''],
  'integracao.criada': ['lock', 'Credencial de integração criada', 'nome'], 'integracao.revogada': ['lock', 'Credencial revogada', ''],
  'analise_automatica.falhou': ['alert', 'Leitura automática falhou', ''], 'agc.apurada': ['users', 'Assembleia apurada', ''],
};
const itemDoFeed = (a, novo = false) => {
  const [ic, titulo, campo] = EVENTO[a.acao] ?? ['dots', a.acao.replace(/[._]/g, ' '), ''];
  const extra = campo ? a.dados?.[campo] : '';
  return html`<li data-id="${a.id}" class="${novo ? 'novo' : ''}"><span class="ic">${icone(ic)}</span><div><b>${titulo}${extra ? html` · <span class="muted">${extra}</span>` : ''}</b><small>${a.quem ?? (a.acao.startsWith('portal.') ? 'portal do cliente' : 'sistema')} · ${relativo(a.quando)}</small></div></li>`;
};
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export default async function painel() {
  const [p, tk, projetos, atividade] = await Promise.all([
    api.get('/api/painel'),
    api.get('/api/tarefas?concluidas=1'),
    api.get('/api/projetos'),
    api.get('/api/atividade').catch(() => []),
  ]);
  estado.painel = p; estado.projetos = projetos; estado.tarefas = tk.tarefas;

  const primeiro = estado.eu.usuario.nome.split(' ')[0];
  const ativos = projetos.filter((x) => x.situacao === 'ativo');
  const minhas = tk.tarefas.filter((t) => t.responsavelId === estado.eu.usuario.id && t.status !== 'concluida').slice(0, 6);
  const proximo = p.prazos.find((z) => !z.vencido) ?? p.prazos[0];
  const idsMeus = new Set(p.meusProjetos.map((x) => x.id));
  const meus = projetos.filter((x) => idsMeus.has(x.id));

  // --- denominadores reais dos três anéis ---
  const tTotal = tk.resumo.total; const tFeitas = tk.resumo.concluidas;
  const pTotal = p.prazos.length; const pEmDia = p.prazos.filter((z) => !z.vencido).length;
  const comProgresso = ativos.filter((x) => x.progresso);
  const avanco = comProgresso.length ? Math.round(comProgresso.reduce((t, x) => t + x.progresso.percentual, 0) / comProgresso.length) : null;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  // --- concluídas por dia, últimos 7 dias (dado real: tarefas.concluida_em) ---
  const dias = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const porDia = dias.map((d) => {
    const iso = d.toLocaleDateString('sv-SE');
    return { iso, rotulo: DIAS[d.getDay()], n: tk.tarefas.filter((t) => t.concluidaEm && new Date(t.concluidaEm).toLocaleDateString('sv-SE') === iso).length };
  });
  const maxDia = Math.max(1, ...porDia.map((x) => x.n));
  const totalSemana = porDia.reduce((t, x) => t + x.n, 0);

  const pendTotal = p.pendencias;
  const resumo = [
    { rotulo: 'Pendências', valor: pendTotal, tom: pendTotal ? 'warn' : 'ok' },
    { rotulo: 'Prazos vencidos', valor: p.prazosVencidos, tom: p.prazosVencidos ? 'alert' : 'ok' },
    { rotulo: 'Projetos ativos', valor: ativos.length },
    { rotulo: 'Tarefas abertas', valor: tk.resumo.abertas },
  ];

  const acoes = html`${pode('tarefa.escrever') ? html`<button type="button" class="btn btn--ghost" data-act="tarefa">${icone('plus')}Nova tarefa</button>` : ''}
    ${pode('projeto.escrever') ? html`<button type="button" class="btn btn--accent" data-act="projeto">${icone('plus')}Novo projeto</button>` : ''}`;

  return {
    titulo: 'Painel',
    html: html`
      ${cabecalho({ titulo: `${saudacao()}, ${primeiro}`, sub: `${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${pendTotal ? `${pendTotal} coisa(s) pedindo você` : 'nada pendente'}`, acoes, resumo })}

      <div class="grid3 mt">
        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Andamento</h2><p class="card__sub">O que está de pé, em números reais</p></div></header>
          <div class="flex" style="gap:22px;flex-wrap:nowrap">
            <div class="ring-lg" style="width:150px;height:150px">
              <svg viewBox="0 0 150 150" aria-hidden="true">
                ${raw(anelCirc(75, 66, 9, pct(tFeitas, tTotal), 'var(--ring-tasks)'))}
                ${raw(anelCirc(75, 51, 9, pct(pEmDia, pTotal), 'var(--ring-focus)'))}
                ${raw(anelCirc(75, 36, 9, avanco ?? 0, 'var(--ring-meet)'))}
              </svg>
            </div>
            <dl class="rings__legend" style="margin:0;display:grid;gap:10px;flex:1">
              ${legenda('var(--ring-tasks)', 'Tarefas', tTotal ? `${tFeitas}/${tTotal}` : 'sem dados')}
              ${legenda('var(--ring-focus)', 'Prazos em dia', pTotal ? `${pEmDia}/${pTotal}` : 'sem prazos')}
              ${legenda('var(--ring-meet)', 'Avanço dos projetos', avanco === null ? 'sem dados' : `${avanco}%`)}
            </dl>
          </div>
        </section>

        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Próximo prazo</h2><p class="card__sub">Contado em dias úteis forenses</p></div>
            <button class="link" data-ir="calendario">Calendário →</button></header>
          ${proximo ? html`
            <div class="pcard__next" style="padding:16px;border-radius:18px;background:${proximo.vencido ? 'var(--fill)' : 'var(--accent-soft)'};border:1px solid ${proximo.vencido ? '#FF6B6B55' : '#F0A32E44'}">
              <small class="muted">${proximo.vencido ? 'VENCIDO' : proximo.diasUteisRestantes === 0 ? 'VENCE HOJE' : `EM ${proximo.diasUteisRestantes} DIA(S) ÚTIL(EIS)`}</small>
              <h3 style="margin:6px 0 4px;font:700 23px var(--font-display)">${proximo.titulo}</h3>
              <span class="mono-sm">${dataBR(proximo.vencimento)} · ${proximo.numero}</span>
              <div class="mt flex">${proximo.projeto ? html`<span class="pchip hue--${matiz(proximo.projeto)}"><i></i><span class="tk-ellip">${proximo.projeto}</span></span>` : ''}</div>
            </div>
            <ul class="lista mt">${p.prazos.filter((z) => z !== proximo).slice(0, 3).map((z) => html`<li><div><b>${z.titulo}</b><small>${z.numero}</small></div>
              <div class="fim"><span class="selo ${z.vencido ? 'erro' : 'aviso'}">${z.vencido ? `há ${-z.diasUteisRestantes} d` : `${z.diasUteisRestantes} d`}</span></div></li>`)}</ul>`
          : vazio('calendar', 'Nenhum prazo aberto', 'Quando um prazo for calculado num processo, ele aparece aqui com a contagem em dias úteis.')}
        </section>

        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Esta semana</h2><p class="card__sub">Tarefas concluídas por dia</p></div>
            <span class="selo ${totalSemana ? 'ok' : ''}">${totalSemana} concluída(s)</span></header>
          <div class="barras">${porDia.map((d, i) => html`<div class="barra ${d.iso === hojeISO() ? 'hoje' : ''}"><b>${d.n || ''}</b>
            <div class="barra__col"><i data-h="${d.n ? Math.max(8, (d.n / maxDia) * 100) : 0}"></i></div><small>${d.rotulo}</small></div>`)}</div>
        </section>
      </div>

      <div class="grid-hub mt">
        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Minhas tarefas</h2><p class="card__sub">Marque ao concluir — vale para o quadro inteiro</p></div>
            <button class="link" data-ir="tarefas">Ver quadro →</button></header>
          ${minhas.length ? html`<ul class="lista">${minhas.map((t) => html`<li>
              <button class="ibtn ibtn--sm" data-concluir="${t.id}" aria-label="Concluir ${t.titulo}" title="Concluir">${icone('check')}</button>
              <div><b>${t.titulo}</b><small><span class="pchip hue--${matiz(t.projetoId)}" style="padding:0"><i></i>${t.projeto}</span></small></div>
              <div class="fim">${t.prazo ? html`<span class="tk-due ${t.situacaoDoPrazo === 'hoje' ? 'is-today' : ''}">${icone('calendar')}${t.situacaoDoPrazo === 'atrasada' ? html`<b style="color:var(--lab-red)">${dataCurta(t.prazo)}</b>` : dataCurta(t.prazo)}</span>` : ''}</div></li>`)}</ul>`
          : vazio('check', 'Nenhuma tarefa com você', 'Crie uma tarefa ou peça para atribuírem — ela aparece aqui.', pode('tarefa.escrever') ? '<button class="btn btn--accent" data-act="tarefa">Nova tarefa</button>' : '')}
        </section>

        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Pedindo você</h2><p class="card__sub">Pendências que dependem de uma pessoa</p></div></header>
          ${pendTotal ? html`<ul class="lista">
            ${p.prazosVencidos ? bloco('alert', `${p.prazosVencidos} prazo(s) vencido(s)`, 'Prioridade máxima', 'erro', 'calendario') : ''}
            ${p.achadosCriticos.map((a) => bloco('shield', a.titulo, a.documento, 'erro', 'projetos'))}
            ${p.aValidar.map((a) => bloco('scale', `${a.quantos} crédito(s) sem classe validada`, a.projeto, 'aviso', `projetos/${a.projeto_id}/creditos`))}
            ${p.aAnalisar.slice(0, 4).map((a) => bloco('doc', a.titulo, `${a.projeto} · aguarda análise`, 'info', `projetos/${a.projeto_id}/portal`))}
            ${p.mensagensSemResposta.slice(0, 3).map((m) => bloco('comment', `“${m.texto.slice(0, 60)}${m.texto.length > 60 ? '…' : ''}”`, `${m.projeto} · cliente esperando`, 'aviso', `projetos/${m.projeto_id}/portal`))}
          </ul>` : vazio('check', 'Mesa limpa', 'Nenhum prazo vencido, nenhuma análise parada, nenhum cliente esperando.')}
        </section>
      </div>

      <section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Atividade ao vivo</h2><p class="card__sub">O que acontece no escritório e nos portais, assim que acontece</p></div>
        <span class="leitura analisado"><i class="vivo"></i>ao vivo</span></header>
        <ul class="feed" id="feed" aria-live="polite">${atividade.map((a) => itemDoFeed(a))}</ul>
        ${atividade.length ? '' : html`<p class="dica" id="feed-vazio">Nada aconteceu ainda. Crie um projeto ou convide um cliente.</p>`}</section>

      <section class="mt up">
        <header class="card__head" style="padding:0 4px"><div><h2 class="card__title" style="font-size:22px">Meus projetos</h2></div>
          <button class="link" data-ir="projetos">Todos os projetos →</button></header>
        ${meus.length ? html`<div class="pgrid">${meus.map(cartaoProjeto)}</div>`
          : vazio('folder', 'Você ainda não está em nenhuma equipe', 'Peça para o líder de um projeto incluir você, ou crie o seu.', pode('projeto.escrever') ? '<button class="btn btn--accent" data-act="projeto">Novo projeto</button>' : '')}
      </section>`,
    depois(raiz) {
      // Atividade ao vivo: pergunta o que é novo a cada 8 s, só com a aba visível.
      let marca = atividade[0]?.quando ?? null; const vistos = new Set(atividade.map((a) => a.id));
      const t = setInterval(async () => {
        if (document.hidden || !raiz.isConnected) return;
        try {
          const novos = (await api.get(`/api/atividade${marca ? `?desde=${encodeURIComponent(marca)}` : ''}`)).filter((a) => !vistos.has(a.id));
          if (!novos.length) return;
          marca = novos[0].quando; const ul = raiz.querySelector('#feed'); raiz.querySelector('#feed-vazio')?.remove();
          for (const a of [...novos].reverse()) { vistos.add(a.id); ul.insertAdjacentHTML('afterbegin', String(itemDoFeed(a, true))); if ((a.acao === 'portal.documento_enviado' || a.acao === 'documento.arquivo_recebido') && a.quem !== estado.eu.usuario.nome) toast('Um cliente acabou de enviar um documento', 'ok'); }
          while (ul.children.length > 30) ul.lastElementChild.remove();
        } catch { /* próximo ciclo */ }
      }, 8000);
      aoSair(() => clearInterval(t));
      ouvir(raiz, 'click', '[data-ir]', (b) => ir(b.dataset.ir));
      ouvir(raiz, 'click', '[data-go]', (b) => ir(b.dataset.go));
      ouvir(raiz, 'click', '[data-proj]', (b) => ir(`projetos/${b.dataset.proj}`));
      ouvir(raiz, 'click', '[data-act=tarefa]', () => novaTarefa(() => navegar()));
      ouvir(raiz, 'click', '[data-act=projeto]', () => novoProjeto());
      ouvir(raiz, 'click', '[data-concluir]', async (b) => {
        b.disabled = true; b.closest('li').style.opacity = .4;
        try { await api.patch(`/api/tarefas/${b.dataset.concluir}`, { status: 'concluida' }); toast('Tarefa concluída'); location.reload(); }
        catch (e) { b.disabled = false; b.closest('li').style.opacity = 1; erroDe(e); }
      });
    },
  };
}

const anelCirc = (c, r, traco, pct, cor) => {
  const circ = 2 * Math.PI * r;
  return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--fill-2)" stroke-width="${traco}"/>
    <circle class="anel-bar" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${cor}" stroke-width="${traco}" stroke-linecap="round"
      stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${circ.toFixed(2)}" data-alvo="${(circ * (1 - Math.max(0, Math.min(100, pct)) / 100)).toFixed(2)}"/>`;
};
const legenda = (cor, rotulo, valor) => html`<div class="rings__row" style="--rc:${raw(cor)}"><dt>${rotulo}</dt><dd>${valor}</dd></div>`;
const bloco = (ico, titulo, sub, tom, destino) => html`<li style="cursor:pointer" data-go="${destino}"><span class="empty__ico" style="width:38px;height:38px;border-radius:12px">${icone(ico)}</span>
  <div><b>${titulo}</b><small>${sub}</small></div><div class="fim"><span class="selo ${tom}">${tom === 'erro' ? 'urgente' : tom === 'aviso' ? 'atenção' : 'rotina'}</span></div></li>`;
