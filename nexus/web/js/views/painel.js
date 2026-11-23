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
import { cabecalho, vazio, toast, erroDe, modal } from '../ui.js';
import { aoSair, ir, navegar } from '../shell.js';
import { novaTarefa, abrirTarefa } from './tarefas.js';
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
  const [p, tk, projetos, atividade, ag] = await Promise.all([
    api.get('/api/painel'),
    api.get('/api/tarefas?concluidas=1'),
    api.get('/api/projetos'),
    api.get('/api/atividade').catch(() => []),
    api.get('/api/painel/agenda').catch(() => null),
  ]);
  estado.painel = p; estado.projetos = projetos; estado.tarefas = tk.tarefas;

  const primeiro = estado.eu.usuario.nome.split(' ')[0];
  const ativos = projetos.filter((x) => x.situacao === 'ativo');
  const minhas = tk.tarefas.filter((t) => t.responsavelId === estado.eu.usuario.id && t.status !== 'concluida').slice(0, 6);
  const idsMeus = new Set(p.meusProjetos.map((x) => x.id));
  const meus = projetos.filter((x) => idsMeus.has(x.id));

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const comProgresso = ativos.filter((x) => x.progresso);
  const avanco = comProgresso.length ? Math.round(comProgresso.reduce((t, x) => t + x.progresso.percentual, 0) / comProgresso.length) : null;
  const abertas = tk.tarefas.filter((t) => t.status !== 'concluida');
  const internasAtrasadas = abertas.filter((t) => t.situacaoDoPrazo === 'atrasada').length;
  const analises = abertas.filter((t) => t.tipoAtividade === 'analise_intimacao').length;

  // --- Agenda do Astrea (mesma base do BI de Prazos): é ela que diz o que vence e o que foi cumprido ---
  const escopo = ag && ag.meusAbertos && localStorage.getItem('nx-painel-escopo') === 'meus' ? 'meus' : 'todos';
  const fx = ag ? (escopo === 'meus' ? ag.faixasMeus : ag.faixas) : null;
  const FAIXAS = [['atrasada', 'Vencidos', '#FF6B6B'], ['hoje', 'Vencem hoje', '#F0A32E'], ['esta_semana', 'Próximos 5 dias úteis', '#4CC9F0'], ['adiante', 'Mais adiante', '#8B7CF6']];
  const faixas = fx ? FAIXAS.map(([chave, rotulo, cor]) => ({ chave, rotulo, cor, ...fx[chave] })) : [];
  const totalAg = faixas.reduce((t, f) => t + f.total, 0);
  const vencidosAg = fx ? fx.atrasada.total : 0;
  const proximos = ag ? (escopo === 'meus' ? ag.meusProximos : ag.proximos) : [];
  const proximoAg = proximos[0];

  // --- Esta semana: cumpridos no Astrea + tarefas concluídas no LAB, por dia ---
  const dias = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const porDia = dias.map((d) => {
    const iso = d.toLocaleDateString('sv-SE');
    const lab = tk.tarefas.filter((t) => t.concluidaEm && !t.doAstrea && (escopo === 'todos' || t.responsavelId === estado.eu.usuario.id) && new Date(t.concluidaEm).toLocaleDateString('sv-SE') === iso).length;
    const astrea = ag?.cumpridosPorDia.find((x) => x.dia === iso)?.[escopo === 'meus' ? 'meus' : 'total'] ?? 0;
    return { iso, rotulo: DIAS[d.getDay()], n: lab + astrea, lab, astrea };
  });
  const maxDia = Math.max(1, ...porDia.map((x) => x.n));
  const totalSemana = porDia.reduce((t, x) => t + x.n, 0);

  const pendTotal = p.pendencias;
  const resumo = [
    { rotulo: 'Pendências', valor: pendTotal, tom: pendTotal ? 'warn' : 'ok' },
    { rotulo: ag ? 'Prazos vencidos (Astrea)' : 'Prazos vencidos', valor: ag ? (ag.faixas.atrasada.total) : p.prazosVencidos, tom: (ag ? ag.faixas.atrasada.total : p.prazosVencidos) ? 'alert' : 'ok' },
    { rotulo: 'Projetos ativos', valor: ativos.length },
    { rotulo: 'Tarefas abertas', valor: abertas.length },
  ];

  const acoes = html`${pode('tarefa.escrever') ? html`<button type="button" class="btn btn--ghost" data-act="tarefa">${icone('plus')}Nova tarefa</button>` : ''}
    ${pode('projeto.escrever') ? html`<button type="button" class="btn btn--accent" data-act="projeto">${icone('plus')}Novo projeto</button>` : ''}`;

  return {
    titulo: 'Painel',
    html: html`
      ${cabecalho({ titulo: `${saudacao()}, ${primeiro}`, sub: `${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${pendTotal ? `${pendTotal} coisa(s) pedindo você` : 'nada pendente'}`, acoes, resumo })}

      <div class="grid3 mt painel-topo">
        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Andamento</h2><p class="card__sub">${ag ? `Prazos, audiências e eventos em aberto no Astrea${ag.atualizadoEm ? ` · lido ${relativo(ag.atualizadoEm)}` : ''}` : 'Tarefas em aberto no LAB'}</p></div>
            ${ag && ag.meusAbertos ? html`<div class="cli-seg" role="group" aria-label="De quem"><button type="button" class="${escopo === 'todos' ? 'is-on' : ''}" data-escopo="todos">Escritório</button><button type="button" class="${escopo === 'meus' ? 'is-on' : ''}" data-escopo="meus">Meus</button></div>` : ''}</header>
          ${ag ? html`<div class="andam-c">
              <button type="button" class="andam-c__anel" data-ir="bi-prazos" aria-label="Abrir o BI de Prazos">${raw(rosca(faixas, totalAg))}
                <span class="andam-c__centro"><b>${totalAg}</b><small>em aberto</small></span></button>
              <dl class="andam-c__leg">${faixas.map((f) => html`<div style="--c:${raw(f.cor)}"><dt>${f.rotulo}</dt><dd><b>${f.total}</b><small>${pct(f.total, totalAg)}%${f.prazos && f.eventos ? ` · ${f.prazos} prazo(s)` : ''}</small></dd></div>`)}</dl>
            </div>
            <div class="andam__rodape">
              <span><b class="${vencidosAg ? 'erro-txt' : ''}">${totalAg ? `${pct(totalAg - vencidosAg, totalAg)}%` : '—'}</b> em dia</span>
              <span><b>${abertas.length}</b> tarefas internas${internasAtrasadas ? ` · ${internasAtrasadas} atrasada(s)` : ''}${analises ? ` · ${analises} análise(s) de intimação` : ''}</span>
              <span><b>${avanco === null ? '—' : `${avanco}%`}</b> avanço dos projetos</span></div>`
          : vazio('check', 'Sem acesso à agenda', 'O andamento dos prazos vem da agenda do Astrea (BI de Prazos).')}
        </section>

        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Próximo prazo</h2><p class="card__sub">${escopo === 'meus' ? 'Seus, pela agenda do Astrea' : 'Do escritório, pela agenda do Astrea'} · dias úteis</p></div>
            <button class="link" data-ir="calendario">Calendário →</button></header>
          ${proximoAg ? html`
            <div class="pcard__next is-click" role="button" tabindex="0" data-agenda="${proximoAg.astreaId ?? ''}" data-idx="0" title="Abrir o prazo" style="padding:16px;border-radius:18px;background:var(--accent-soft);border:1px solid #F0A32E44">
              <small class="muted">${proximoAg.diasUteis === 0 ? 'VENCE HOJE' : `EM ${proximoAg.diasUteis} DIA(S) ÚTIL(EIS)`} · ${proximoAg.tipo.toUpperCase()}${proximoAg.hora ? ` ÀS ${proximoAg.hora}` : ''}</small>
              <h3 style="margin:6px 0 4px;font:700 21px var(--font-display)">${proximoAg.titulo}</h3>
              <span class="mono-sm">${dataBR(proximoAg.vencimento)}${proximoAg.numero ? ` · ${proximoAg.numero}` : ''}</span>
              <p class="dica" style="margin:6px 0 0">${proximoAg.caso}${proximoAg.responsavel ? ` · ${proximoAg.responsavel}` : ''}</p>
            </div>
            <ul class="lista mt">${proximos.slice(1, 4).map((z, i) => html`<li class="is-click" role="button" tabindex="0" data-agenda="${z.astreaId ?? ''}" data-idx="${i + 1}" title="Abrir o prazo"><div><b>${z.titulo}</b><small>${z.caso || z.numero}${z.responsavel ? ` · ${z.responsavel}` : ''}</small></div>
              <div class="fim"><span class="selo ${z.diasUteis <= 1 ? 'erro' : 'aviso'}">${z.diasUteis === 0 ? 'hoje' : `${z.diasUteis} d`}</span></div></li>`)}</ul>`
          : vazio('calendar', 'Nenhum prazo à frente', ag ? 'A agenda do Astrea não tem prazo, audiência ou evento em aberto daqui para a frente.' : 'Sem acesso à agenda do Astrea.')}
        </section>

        <section class="card glass up">
          <header class="card__head"><div><h2 class="card__title">Esta semana</h2><p class="card__sub">Cumpridos por dia: Astrea + tarefas do LAB</p></div>
            <span class="selo ${totalSemana ? 'ok' : ''}">${totalSemana} cumprido(s)</span></header>
          <div class="barras">${porDia.map((d) => html`<button type="button" class="barra ${d.iso === hojeISO() ? 'hoje' : ''}" data-dia="${d.iso}" title="${d.astrea} no Astrea · ${d.lab} no LAB · clique para ver a lista"><b>${d.n || ''}</b>
            <div class="barra__col"><i data-h="${d.n ? Math.max(8, (d.n / maxDia) * 100) : 0}"></i></div><small>${d.rotulo}</small></button>`)}</div>
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
          </ul>` : vazio('check', 'Mesa limpa', 'Nenhum prazo vencido, nenhuma análise parada, nenhum crédito sem validar.')}
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
      // Prazo da agenda: abre a tarefa do LAB ligada a ele; sem tarefa (processo sem projeto), mostra a ficha do Astrea.
      const abrirAgenda = (item) => {
        if (!item) return;
        const t = item.astreaId && tk.tarefas.find((x) => x.chavePlaybook === `astrea:id:${item.astreaId}`);
        if (t) return abrirTarefa(t, { aoMudar: () => {} });
        modal({ titulo: item.titulo, subtitulo: `${item.tipo} · ${dataBR(item.vencimento)}${item.hora ? ` às ${item.hora}` : ''}`, acoes: [{ id: 'bi', rotulo: 'Abrir no BI de Prazos' }, { id: 'fechar', rotulo: 'Fechar', tipo: 'primario' }],
          corpo: String(html`<dl class="ficha-ag"><div><dt>Processo</dt><dd class="mono-sm">${item.numero || '—'}</dd></div><div><dt>Caso</dt><dd>${item.caso || '—'}</dd></div>
            <div><dt>Juízo</dt><dd>${item.juizo || '—'}</dd></div><div><dt>Responsável</dt><dd>${item.responsavel || '—'}</dd></div></dl>
            <p class="dica">Este item ainda não virou tarefa no LAB: o processo não está ligado a um projeto. Ligue o processo ao projeto na Controladoria para ele aparecer em Tarefas.</p>`),
          aoAbrir(el) { el.addEventListener('acao', (e) => { el.fechar(); if (e.detail.id === 'bi') ir('bi-prazos'); }); } });
      };
      const porAgenda = (b) => abrirAgenda(proximos[Number(b.dataset.idx)]);
      ouvir(raiz, 'click', '[data-agenda]', porAgenda);
      raiz.addEventListener('keydown', (e) => { const b = e.target.closest?.('[data-agenda]'); if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); porAgenda(b); } });
      // Dia da semana: a lista do que foi cumprido (Astrea + LAB), cada item abre a tarefa.
      ouvir(raiz, 'click', '[data-dia]', (b) => {
        const dia = b.dataset.dia;
        const ast = (ag?.cumpridosPorDia.find((x) => x.dia === dia)?.itens ?? []).filter((x) => escopo === 'todos' || x.meu);
        const lab = tk.tarefas.filter((t) => t.concluidaEm && !t.doAstrea && (escopo === 'todos' || t.responsavelId === estado.eu.usuario.id) && new Date(t.concluidaEm).toLocaleDateString('sv-SE') === dia);
        const itens = [...ast.map((x, i) => ({ k: `a${i}`, titulo: x.titulo, sub: [x.caso || x.numero, x.responsavel].filter(Boolean).join(' · '), selo: x.tipo, x })), ...lab.map((t) => ({ k: `l${t.id}`, titulo: t.titulo, sub: [t.projeto, t.responsavel].filter(Boolean).join(' · '), selo: 'LAB', t }))];
        modal({ titulo: `Cumpridos em ${dataBR(dia)}`, subtitulo: `${itens.length} item(ns) · ${escopo === 'meus' ? 'seus' : 'do escritório'}`, largo: true, acoes: [{ id: 'fechar', rotulo: 'Fechar', tipo: 'primario' }],
          corpo: itens.length ? String(html`<ul class="lista lista-dia">${itens.map((x) => html`<li class="is-click" role="button" tabindex="0" data-k="${x.k}"><div><b>${x.titulo}</b><small>${x.sub}</small></div><div class="fim"><span class="selo ${x.t ? 'info' : 'ok'}">${x.selo}</span></div></li>`)}</ul>`)
            : String(html`<p class="dica">Nada cumprido neste dia.</p>`),
          aoAbrir(el) {
            el.addEventListener('acao', () => el.fechar());
            el.addEventListener('click', (e) => {
              const li = e.target.closest('[data-k]'); if (!li) return;
              const x = itens.find((y) => y.k === li.dataset.k); if (!x) return;
              el.fechar();
              if (x.t) return abrirTarefa(x.t, { aoMudar: () => {} });
              const t = x.x.astreaId && tk.tarefas.find((y) => y.chavePlaybook === `astrea:id:${x.x.astreaId}`);
              if (t) return abrirTarefa(t, { aoMudar: () => {} });
              abrirAgenda({ ...x.x, juizo: '', hora: null });
            });
          } });
      });
      ouvir(raiz, 'click', '[data-escopo]', (b) => { localStorage.setItem('nx-painel-escopo', b.dataset.escopo); navegar(); });
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

/** Rosca (círculo) por faixa de urgência: cada arco é proporcional ao número real de itens. */
const rosca = (faixas, total) => {
  const r = 62, c = 2 * Math.PI * r; let ini = 0;
  const arcos = total ? faixas.filter((f) => f.total).map((f) => {
    const tam = (f.total / total) * c; const seg = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${f.cor}" stroke-width="16" stroke-dasharray="${Math.max(0, tam - 2).toFixed(2)} ${(c - Math.max(0, tam - 2)).toFixed(2)}" stroke-dashoffset="${(-ini).toFixed(2)}" transform="rotate(-90 80 80)"/>`;
    ini += tam; return seg;
  }).join('') : '';
  return `<svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="${r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="16"/>${arcos}</svg>`;
};
const bloco = (ico, titulo, sub, tom, destino) => html`<li style="cursor:pointer" data-go="${destino}"><span class="empty__ico" style="width:38px;height:38px;border-radius:12px">${icone(ico)}</span>
  <div><b>${titulo}</b><small>${sub}</small></div><div class="fim"><span class="selo ${tom}">${tom === 'erro' ? 'urgente' : tom === 'aviso' ? 'atenção' : 'rotina'}</span></div></li>`;
