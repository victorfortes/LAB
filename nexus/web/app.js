/**
 * Interface do NGA Nexus.
 *
 * Sem framework e sem build: o que a plataforma precisa aqui é de dado real na
 * tela, não de uma camada a mais. Quando a interface crescer a ponto de pedir
 * componentes de verdade, a troca é local — o servidor e a API não mudam.
 */

const raiz = document.getElementById('raiz');

/** Escapa texto antes de ir para innerHTML. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(opcoes.headers ?? {}) },
    ...opcoes,
  });
  if (r.status === 401) { estado.eu = null; render(); throw new Error('não autenticado'); }
  const corpo = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(corpo?.erro ?? `erro ${r.status}`);
  return corpo;
}

const estado = {
  eu: null, modulos: null, vista: 'central', dados: null,
  carregando: false, erro: null,
  portal: null,   // { projeto, aba, checklist, documentos, financeiro, obrigacoes }
  analise: null,  // { ia, projetos, projetoId, documentos, analises, detalhe }
  painel: null,   // pendências de quem está logado
  projeto: null,  // hub do projeto aberto
  integracoes: null, // credenciais das aplicações do NGA Lab
};

const ESTADOS = {
  operacional: { rotulo: 'Operacional', classe: 'nga-selo--ok' },
  em_obra: { rotulo: 'Em obra', classe: 'nga-selo--dev' },
  externo: { rotulo: 'Aplicação própria', classe: 'nga-selo--info' },
  nao_construido: { rotulo: 'Não construído', classe: '' },
};

function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// ------------------------------------------------------------------ telas ---

function telaEntrada() {
  raiz.innerHTML = `
    <div class="entrada">
      <form class="nga-card" id="form-entrada">
        <div class="nga-rotulo">Acesso</div>
        <h1>NGA <span class="marca">NEXUS</span></h1>
        <p style="color:var(--nga-mut);margin:0 0 18px">Plataforma operacional do escritório.</p>
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" autocomplete="username" required>
        <label for="senha">Senha</label>
        <input id="senha" name="senha" type="password" autocomplete="current-password" required>
        <button class="nga-botao" type="submit" style="width:100%;margin-top:20px">Entrar</button>
        <div id="erro-entrada"></div>
      </form>
    </div>`;

  raiz.querySelector('#form-entrada').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const botao = ev.target.querySelector('button');
    const alvoErro = raiz.querySelector('#erro-entrada');
    botao.disabled = true; botao.textContent = 'Entrando…'; alvoErro.innerHTML = '';
    try {
      await api('/api/sessao', {
        method: 'POST',
        body: JSON.stringify({ email: ev.target.email.value, senha: ev.target.senha.value }),
      });
      await carregarSessao();
    } catch (e) {
      alvoErro.innerHTML = `<div class="erro">${esc(e.message)}</div>`;
      botao.disabled = false; botao.textContent = 'Entrar';
    }
  });
}

function topo() {
  const { eu } = estado;
  return `
    <header class="topo">
      <div class="logo">NGA <b>NEXUS</b></div>
      <div class="espaco"></div>
      <div class="quem">
        <div>${esc(eu.usuario.nome)}</div>
        <small>${esc(eu.organizacoes.map((o) => o.nome).join(' · '))}</small>
      </div>
      <button class="nga-botao" id="sair">Sair</button>
    </header>`;
}

function cardModulo(m) {
  const info = ESTADOS[m.estado];
  const clicavel = m.estado !== 'nao_construido' && m.rota;
  return `
    <${clicavel ? 'button' : 'div'} class="nga-card modulo" data-estado="${m.estado}"
      ${clicavel ? `data-rota="${esc(m.rota)}"` : ''}>
      <span class="nga-selo ${info.classe}">${info.rotulo}</span>
      <h4>${esc(m.nome)}</h4>
      <p>${esc(m.descricao)}</p>
      ${m.origem ? `<p class="pendencia nga-dado">${esc(m.origem)}</p>` : ''}
      ${m.pendencia ? `<p class="pendencia">${esc(m.pendencia)}</p>` : ''}
    </${clicavel ? 'button' : 'div'}>`;
}

function telaCentral() {
  const { eu, modulos } = estado;
  const r = modulos.resumo;
  const primeiroNome = eu.usuario.nome.split(' ')[0];

  const ambientes = Object.entries(modulos.ambientes).map(([chave, amb]) => {
    const lista = modulos.modulos.filter((m) => m.ambiente === chave);
    if (lista.length === 0) return '';
    return `
      <section class="ambiente">
        <header>
          <h3>${esc(amb.nome)}</h3>
          <small>${esc(amb.descricao)}</small>
        </header>
        <div class="modulos">${lista.map(cardModulo).join('')}</div>
      </section>`;
  }).join('');

  raiz.innerHTML = `
    <div class="tela">
      ${topo()}
      <main class="corpo">
        <div class="saudacao">
          <h2>${saudacao()}, ${esc(primeiroNome)}.</h2>
          <p>${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>

        ${painelDeTrabalho()}

        <details class="catalogo">
          <summary>Estado da plataforma —
            ${r.operacional} operacionais · ${r.externo} aplicações próprias ·
            ${r.em_obra} em obra · ${r.nao_construido} não construídos</summary>
          ${ambientes}
        </details>
      </main>
    </div>`;

  raiz.querySelectorAll('[data-rota]').forEach((el) => {
    el.addEventListener('click', () => abrir(el.dataset.rota));
  });
  raiz.querySelectorAll('[data-projeto]').forEach((el) => {
    el.addEventListener('click', () => abrirProjeto(el.dataset.projeto));
  });
  raiz.querySelector('#sair').addEventListener('click', sair);
}

function telaProjetos() {
  const podeEscrever = estado.eu.permissoes.includes('projeto.escrever');
  raiz.innerHTML = `
    <div class="tela">
      ${topo()}
      <main class="corpo">
        <div class="saudacao">
          <h2>Projetos</h2>
          <p>Cada projeto é onde crédito, plano, assembleia, processo, documento e
             portal se encontram.</p>
        </div>
        <div class="linha-acoes">
          ${podeEscrever ? '<button class="nga-botao" id="novo-projeto">Novo projeto</button>' : ''}
          <button class="nga-botao nga-botao--fantasma" id="voltar">Voltar</button>
        </div>
        ${estado.dados.length === 0
          ? '<p class="pendencia">Nenhum projeto cadastrado.</p>'
          : `<table class="nga-tabela">
              <thead><tr><th>Projeto</th><th>Fase</th><th>Líder</th>
                <th>A validar</th><th>A analisar</th><th>Prazos</th></tr></thead>
              <tbody>${estado.dados.map((p) => `<tr>
                <td><button class="link-analise" data-projeto="${p.id}">${esc(p.nome)}</button>
                  <small>${esc(p.rotuloDoTipo)}${p.cliente ? ` · ${esc(p.cliente)}` : ''}</small></td>
                <td>${p.faseAtual
                  ? `<span class="nga-selo nga-selo--dev">${esc(p.faseAtual.nome)}</span>
                     <small>${p.progresso.indice} de ${p.progresso.total}</small>`
                  : '<span class="nga-dado">—</span>'}</td>
                <td>${esc(p.lider ?? p.responsavel ?? '—')}</td>
                <td class="nga-dado">${Number(p.creditos_a_validar) > 0
                  ? `<span class="nga-selo nga-selo--dev">${p.creditos_a_validar}</span>`
                  : '0'}</td>
                <td class="nga-dado">${Number(p.a_analisar) > 0
                  ? `<span class="nga-selo nga-selo--dev">${p.a_analisar}</span>` : '0'}</td>
                <td class="nga-dado">${p.prazos_abertos}</td>
              </tr>`).join('')}</tbody>
             </table>`}
      </main>
    </div>`;

  raiz.querySelector('#voltar').addEventListener('click', () => { estado.vista = 'central'; render(); });
  raiz.querySelector('#sair').addEventListener('click', sair);
  for (const b of raiz.querySelectorAll('[data-projeto]')) {
    b.addEventListener('click', () => abrirProjeto(b.dataset.projeto));
  }
  raiz.querySelector('#novo-projeto')?.addEventListener('click', criarProjeto);
}

async function criarProjeto() {
  const nome = prompt('Nome do projeto:');
  if (!nome) return;
  const tipos = ['recuperacao_judicial', 'recuperacao_extrajudicial', 'falencia',
    'reestruturacao', 'negociacao_credores', 'investigacao_patrimonial',
    'contencioso_estrategico', 'consultivo'];
  const escolha = prompt(
    `Tipo:\n${tipos.map((t, i) => `${i + 1}. ${t.replace(/_/g, ' ')}`).join('\n')}\n\nNúmero:`, '1');
  const tipo = tipos[Number(escolha) - 1];
  if (!tipo) { alert('Tipo inválido.'); return; }

  try {
    const r = await api('/api/projetos', { method: 'POST', body: JSON.stringify({ nome, tipo }) });
    await abrirProjeto(r.id);
  } catch (e) { alert(e.message); }
}

function telaCarregando() {
  raiz.innerHTML = `
    <div class="tela">
      ${estado.eu ? topo() : ''}
      <main class="corpo">
        <div class="esqueleto" style="width:220px;height:26px;margin-bottom:22px"></div>
        <div class="indicadores">
          ${Array.from({ length: 4 }, () => '<div class="nga-card"><div class="esqueleto"></div></div>').join('')}
        </div>
        <div class="modulos">
          ${Array.from({ length: 6 }, () => `
            <div class="nga-card">
              <div class="esqueleto" style="width:40%;margin-bottom:10px"></div>
              <div class="esqueleto" style="width:85%"></div>
            </div>`).join('')}
        </div>
      </main>
    </div>`;
  if (estado.eu) raiz.querySelector('#sair')?.addEventListener('click', sair);
}

// ------------------------------------------------------------------ fluxo ---

async function abrir(rota) {
  if (rota === '/portal' || rota === '/checklist' || rota === '/financeiro') {
    await abrirPortal(rota === '/financeiro' ? 'financeiro' : 'checklist');
    return;
  }
  if (rota === '/analise') { await abrirAnalise(); return; }
  if (rota === '/relatorios') { await abrirRelatorios(); return; }
  if (rota === '/integracoes') { await abrirIntegracoes(); return; }
  if (rota === '/processos' || rota === '/prazos') {
    await abrirProcessos(rota === '/prazos');
    return;
  }
  if (rota !== '/projetos') {
    // Módulo com rota ainda sem tela própria: dizer isso, não abrir tela vazia.
    alert('Este módulo tem API operacional, mas a tela ainda não foi construída.');
    return;
  }
  estado.carregando = true; render();
  try {
    estado.dados = await api('/api/projetos');
    estado.vista = 'projetos';
  } catch (e) {
    estado.erro = e.message;
  } finally {
    estado.carregando = false; render();
  }
}

async function sair() {
  await api('/api/sessao', { method: 'DELETE' }).catch(() => {});
  estado.eu = null; estado.modulos = null; estado.vista = 'central';
  render();
}

async function carregarSessao() {
  estado.carregando = true; render();
  try {
    estado.eu = await api('/api/eu');
    estado.modulos = await api('/api/modulos');
    // O cliente entra direto no portal; a equipe, no painel de trabalho.
    if (estado.eu.ehCliente) {
      await abrirPortal();
      return;
    }
    estado.painel = await api('/api/painel');
  } catch {
    estado.eu = null;
  } finally {
    estado.carregando = false; render();
  }
}

// ----------------------------------------------------------------- portal ---

const SITUACOES_QUE_AGUARDAM_VOCE = ['pendente', 'rejeitado', 'complementacao'];

async function abrirPortal(aba = 'checklist') {
  estado.carregando = true; render();
  try {
    const projetos = await api('/api/portal/projetos');
    if (projetos.length === 0) {
      estado.erro = 'Nenhum projeto liberado para o seu acesso.';
      estado.vista = 'portal';
      estado.portal = { projeto: null, aba };
      return;
    }
    const projeto = estado.portal?.projeto ?? projetos[0];
    estado.portal = { projeto, projetos, aba };
    await carregarAba(aba);
    estado.vista = 'portal';
  } catch (e) {
    estado.erro = e.message;
  } finally {
    estado.carregando = false; render();
  }
}

async function carregarAba(aba) {
  const id = estado.portal.projeto.projeto_id;
  estado.portal.aba = aba;
  if (aba === 'checklist') estado.portal.checklist = await api(`/api/projetos/${id}/checklist`);
  if (aba === 'documentos') estado.portal.documentos = await api(`/api/projetos/${id}/documentos`);
  if (aba === 'obrigacoes') estado.portal.obrigacoes = await api(`/api/projetos/${id}/obrigacoes`);
  if (aba === 'financeiro') estado.portal.financeiro = await api(`/api/projetos/${id}/financeiro`);
  if (aba === 'acompanhamento') {
    // O RLS (migração 014) é que filtra: chega só o processo deste portal e
    // só as movimentações publicadas, com o resumo escrito pela NGA.
    const processos = await api('/api/processos');
    estado.portal.processos = await Promise.all(
      processos.map((p) => api(`/api/processos/${p.id}`)));
  }
}

async function trocarAba(aba) {
  estado.carregando = true; render();
  try { await carregarAba(aba); } catch (e) { estado.erro = e.message; }
  finally { estado.carregando = false; render(); }
}

function barraDeProgresso(p) {
  return `
    <div class="nga-card" style="margin-bottom:20px">
      <div class="nga-rotulo">Onboarding documental</div>
      <div style="display:flex;align-items:baseline;gap:10px;margin:8px 0 2px">
        <span class="nga-valor" style="font-size:30px;color:var(--nga-green)">${p.percentualAprovado}%</span>
        <span style="color:var(--nga-mut)">aprovado pela NGA</span>
      </div>
      <div class="barra"><i class="aprovado" style="width:${p.percentualAprovado}%"></i></div>
      <div class="barra"><i class="enviado" style="width:${p.percentualEnviado}%"></i></div>
      <div class="legenda" style="margin-top:10px">
        <span><b>${p.aprovados}</b> de ${p.obrigatorios} aprovados</span>
        <span style="color:var(--nga-cy)"><b>${p.percentualEnviado}%</b> enviado</span>
        <span>aguardando você: <b>${p.aguardandoOCliente}</b></span>
        <span>em análise na NGA: <b>${p.aguardandoANGA}</b></span>
      </div>
      <p style="margin:12px 0 0;font-size:13px;color:var(--nga-faint)">
        Enviar um documento não o aprova: a NGA confere cada item antes de validar.
      </p>
    </div>`;
}

function abaChecklist() {
  const dados = estado.portal.checklist;
  if (!dados) return '';
  const categorias = [...new Set(dados.itens.map((i) => i.categoria))];

  return barraDeProgresso(dados.progresso) + categorias.map((cat) => {
    const itens = dados.itens.filter((i) => i.categoria === cat);
    return `
      <section class="categoria">
        <h4>${esc(cat)}</h4>
        ${itens.map((i) => `
          <div class="requisito" data-aguarda="${i.aguardaVoce}">
            <div class="meio">
              <div class="titulo">${esc(i.titulo)}${i.obrigatorio ? '' : ' <span style="color:var(--nga-faint);font-weight:400">(opcional)</span>'}</div>
              ${i.fundamento ? `<div class="fundamento">${esc(i.fundamento)}</div>` : ''}
              ${i.observacao ? `<div class="obs">${esc(i.observacao)}</div>` : ''}
            </div>
            <span class="sit sit-${i.situacao}">${esc(i.rotuloDaSituacao)}</span>
            ${SITUACOES_QUE_AGUARDAM_VOCE.includes(i.situacao)
              ? `<button class="nga-botao" data-enviar="${i.id}" data-titulo="${esc(i.titulo)}">Enviar</button>`
              : ''}
          </div>`).join('')}
      </section>`;
  }).join('');
}

function abaDocumentos() {
  const docs = estado.portal.documentos;
  if (!docs) return '';
  if (docs.length === 0) {
    return `<p style="color:var(--nga-faint);margin-top:24px">
      Nenhum documento publicado para você ainda. A NGA publica aqui os relatórios e
      peças que libera para o seu acompanhamento.</p>`;
  }
  return `<table>
    <thead><tr><th>Documento</th><th>Categoria</th><th>Publicado em</th><th>Arquivo</th></tr></thead>
    <tbody>${docs.map((d) => `<tr>
      <td>${esc(d.titulo)}</td>
      <td>${esc(d.categoria ?? '—')}</td>
      <td class="nga-dado">${d.publicado_em ? new Date(d.publicado_em).toLocaleDateString('pt-BR') : '—'}</td>
      <td>${d.tem_arquivo
        ? `<button class="nga-botao nga-botao--fantasma" data-baixar="${d.id}">Baixar
             <span class="nga-dado">${formatarTamanho(d.tamanho_bytes)}</span></button>`
        : '<span class="nga-dado" title="documento registrado sem arquivo digitalizado">sem arquivo</span>'}</td>
    </tr>`).join('')}</tbody></table>`;
}

function abaObrigacoes() {
  const dados = estado.portal.obrigacoes;
  if (!dados) return '';
  if (dados.obrigacoes.length === 0) {
    return `<p style="color:var(--nga-faint);margin-top:24px">
      Ainda não há cronograma de pagamento publicado para este projeto.</p>`;
  }
  const r = dados.resumo;
  const proximas = dados.obrigacoes.filter((o) => !o.pago).slice(0, 40);
  return `
    <div class="indicadores" style="margin-top:18px">
      <div class="nga-card indicador"><div class="nga-rotulo">Parcelas</div><span class="n">${r.total}</span></div>
      <div class="nga-card indicador"><div class="nga-rotulo">Pagas</div><span class="n green">${r.pagas}</span></div>
      <div class="nga-card indicador"><div class="nga-rotulo">Vencidas</div><span class="n ${r.vencidas > 0 ? 'red' : ''}">${r.vencidas}</span></div>
      <div class="nga-card indicador"><div class="nga-rotulo">Valor vencido</div><span class="n ${r.vencidas > 0 ? 'red' : ''}" style="font-size:20px">${esc(r.valorVencido)}</span></div>
    </div>
    <table>
      <thead><tr><th>Nº</th><th>Credor</th><th>Vencimento</th><th style="text-align:right">Valor</th><th>Situação</th></tr></thead>
      <tbody>${proximas.map((o) => `<tr>
        <td class="nga-dado">${o.numero}</td>
        <td>${esc(o.credor)}</td>
        <td class="nga-dado">${new Date(o.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
        <td class="num">${esc(o.valorFormatado)}</td>
        <td>${o.pago ? '<span class="sit sit-aprovado">Pago</span>' : ''}</td>
      </tr>`).join('')}</tbody>
    </table>`;
}

function abaFinanceiro() {
  const dados = estado.portal.financeiro;
  if (!dados) return '';
  const f = dados.fluxo, i = dados.indicadores;

  const picos = f.periodos.flatMap((p) => [
    Number(p.receitasPrevistas) + Number(p.receitasRealizadas),
    Number(p.despesasPrevistas) + Number(p.despesasRealizadas)]);
  const maximo = Math.max(1, ...picos);

  const grafico = f.periodos.length === 0 ? '' : `
    <div class="nga-card" style="margin-top:18px">
      <div class="nga-rotulo">Entradas e saídas por período</div>
      <div class="fluxo">
        ${f.periodos.map((p) => {
          const rec = (Number(p.receitasPrevistas) + Number(p.receitasRealizadas)) / maximo * 100;
          const desp = (Number(p.despesasPrevistas) + Number(p.despesasRealizadas)) / maximo * 100;
          return `<div class="col" title="${esc(p.rotulo)} — saldo projetado ${esc(p.saldoProjetadoFormatado)}">
            <div class="vb rec" style="height:${rec.toFixed(1)}%"></div>
            <div class="vb desp" style="height:${desp.toFixed(1)}%"></div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:6px">
        ${f.periodos.map((p) => `<div class="rot" style="flex:1;min-width:0">${esc(p.rotulo)}</div>`).join('')}
      </div>
      <div class="legenda" style="margin-top:14px">
        <span style="color:var(--nga-green)">■ entradas</span>
        <span style="color:var(--nga-red)">■ saídas</span>
      </div>
    </div>`;

  const negativo = f.periodosNegativos.length > 0;
  return `
    <div class="indicadores" style="margin-top:18px">
      <div class="nga-card indicador">
        <div class="nga-rotulo">Saldo atual</div>
        <span class="n ${Number(i.saldoAtual) < 0 ? 'red' : 'green'}" style="font-size:22px">${esc(i.saldoAtualFormatado)}</span>
      </div>
      <div class="nga-card indicador">
        <div class="nga-rotulo">Saldo projetado</div>
        <span class="n ${Number(f.saldoFinalProjetado) < 0 ? 'red' : 'cy'}" style="font-size:22px">${esc(f.saldoFinalProjetadoFormatado)}</span>
      </div>
      <div class="nga-card indicador">
        <div class="nga-rotulo">Contas vencidas</div>
        <span class="n ${Number(i.contasVencidas) > 0 ? 'red' : ''}" style="font-size:22px">${esc(formatarCentavos(i.contasVencidas))}</span>
      </div>
      <div class="nga-card indicador">
        <div class="nga-rotulo">Meses de caixa</div>
        <span class="n ${i.mesesDeCaixa !== null && i.mesesDeCaixa < 3 ? 'red' : 'amber'}">${i.mesesDeCaixa ?? '—'}</span>
      </div>
    </div>
    ${negativo ? `<div class="erro" style="margin-top:16px">
      Projeção negativa em: ${esc(f.periodosNegativos.join(', '))}.
      O saldo projetado considera o que ainda não se confirmou.
    </div>` : ''}
    ${grafico}
    ${dados.totalDeLancamentos === 0 ? `<p style="color:var(--nga-faint);margin-top:18px">
      Nenhum lançamento registrado ainda.</p>` : ''}`;
}

/** Centavos (string) para "1.234,56" — mesmo formato do servidor. */
function formatarCentavos(v) {
  const n = BigInt(v);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const int = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${int},${(abs % 100n).toString().padStart(2, '0')}`;
}

const ABAS = [
  ['checklist', 'Documentos a enviar'],
  ['acompanhamento', 'Andamento'],
  ['documentos', 'Publicados pela NGA'],
  ['obrigacoes', 'Plano de pagamento'],
  ['financeiro', 'Fluxo de caixa'],
];

const SITUACAO_DO_PROCESSO = {
  ativo: 'nga-selo--ok', suspenso: 'nga-selo--dev', baixado: '',
  arquivado: '', extinto: 'nga-selo--risco',
};

/**
 * Andamento como o cliente lê.
 *
 * Aqui aparece o RESUMO escrito pela NGA, nunca o andamento cru: o título
 * oficial do movimento ("Juntada de petição de impugnação") não diz nada a
 * quem não é do ramo, e é justamente a tradução que o §6.3 pede.
 */
function abaAcompanhamento() {
  const processos = estado.portal.processos;
  if (!processos) return '';
  if (processos.length === 0) {
    return `<p style="color:var(--nga-faint);margin-top:24px">
      Nenhum processo liberado para o seu acompanhamento.</p>`;
  }

  return processos.map((p) => `
    <section class="categoria">
      <div class="doc-cabeca">
        <div>
          <h4>${esc(p.classe ?? 'Processo')}</h4>
          <small class="nga-dado">${esc(p.numero)}${
            p.comarca ? ` · ${esc(p.comarca)}${p.uf ? `/${esc(p.uf)}` : ''}` : ''}</small>
        </div>
        <span class="nga-selo ${SITUACAO_DO_PROCESSO[p.situacao] ?? ''}">${esc(p.situacao)}</span>
      </div>
      ${p.situacao === 'suspenso' && p.suspenso_motivo
        ? `<p class="nga-nota">${esc(p.suspenso_motivo)}${
            p.suspenso_ate ? ` — até ${new Date(p.suspenso_ate).toLocaleDateString('pt-BR')}` : ''}</p>`
        : ''}
      ${p.movimentacoes.length === 0
        ? '<p class="pendencia">Nenhum andamento publicado ainda.</p>'
        : `<ol class="linha-do-tempo">${p.movimentacoes.map((m) => `
            <li>
              <time class="nga-dado">${new Date(m.data).toLocaleDateString('pt-BR')}</time>
              <p>${esc(m.resumo_ao_cliente)}</p>
            </li>`).join('')}</ol>`}
    </section>`).join('');
}

function telaPortal() {
  const p = estado.portal;
  if (!p?.projeto) {
    raiz.innerHTML = `<div class="tela">${topo()}<main class="corpo">
      <div class="erro">${esc(estado.erro ?? 'Sem acesso liberado.')}</div></main></div>`;
    raiz.querySelector('#sair').addEventListener('click', sair);
    return;
  }

  const permitidas = ABAS.filter(([id]) => {
    if (id === 'documentos') return p.projeto.mostra_documentos;
    if (id === 'obrigacoes') return p.projeto.mostra_obrigacoes;
    if (id === 'financeiro') return p.projeto.mostra_financeiro;
    return true;
  });

  const conteudo = p.aba === 'checklist' ? abaChecklist()
    : p.aba === 'acompanhamento' ? abaAcompanhamento()
    : p.aba === 'documentos' ? abaDocumentos()
    : p.aba === 'obrigacoes' ? abaObrigacoes()
    : abaFinanceiro();

  raiz.innerHTML = `
    <div class="tela">
      ${topo()}
      <main class="corpo">
        <div class="saudacao">
          <h2>${esc(p.projeto.nome)}</h2>
          <p>${esc(p.projeto.tipo.replace(/_/g, ' '))} · acompanhamento com a NGA Advogados</p>
        </div>
        <div class="abas" role="tablist">
          ${permitidas.map(([id, rotulo]) => `
            <button role="tab" data-aba="${id}" aria-selected="${p.aba === id}">${rotulo}</button>`).join('')}
        </div>
        ${estado.erro ? `<div class="erro">${esc(estado.erro)}</div>` : ''}
        ${conteudo}
      </main>
    </div>`;

  raiz.querySelector('#sair').addEventListener('click', sair);
  raiz.querySelectorAll('[data-aba]').forEach((b) =>
    b.addEventListener('click', () => trocarAba(b.dataset.aba)));
  raiz.querySelectorAll('[data-enviar]').forEach((b) =>
    b.addEventListener('click', () => enviarDocumento(b.dataset.enviar, b.dataset.titulo)));
  raiz.querySelectorAll('[data-baixar]').forEach((b) =>
    b.addEventListener('click', () => baixarDocumento(b.dataset.baixar)));
}

/**
 * Envia um arquivo de verdade.
 *
 * `multipart/form-data` com o FormData montado à mão, e sem `content-type`
 * nos cabeçalhos: quem define a fronteira do multipart é o próprio navegador,
 * e declará-la errada quebra o parse no servidor.
 */
async function enviarArquivo(projetoId, arquivo, campos = {}) {
  const corpo = new FormData();
  corpo.append('arquivo', arquivo);
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor !== undefined && valor !== null && valor !== '') corpo.append(chave, valor);
  }
  const r = await fetch(`/api/projetos/${projetoId}/documentos`, {
    method: 'POST', credentials: 'same-origin', body: corpo,
  });
  const resposta = await r.json().catch(() => null);
  if (!r.ok) throw new Error(resposta?.erro ?? `erro ${r.status}`);
  return resposta;
}

/**
 * Pede um link temporário e baixa.
 *
 * O link é pedido no momento do clique, nunca guardado na tela: ele vale
 * poucos minutos, e um link velho num HTML aberto há uma hora só renderia
 * erro. É também por isso que o download não vira um `<a href>` estático.
 */
async function baixarDocumento(documentoId) {
  try {
    const { url, nome } = await api(`/api/documentos/${documentoId}/link`, { method: 'POST' });
    const a = document.createElement('a');
    a.href = url;
    a.download = nome ?? '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    alert(e.message);
  }
}

/** Abre o seletor de arquivo do sistema e devolve o escolhido. */
function escolherArquivo(aceita = '.pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx,.odt,.ods') {
  return new Promise((resolve) => {
    const entrada = document.createElement('input');
    entrada.type = 'file';
    entrada.accept = aceita;
    entrada.addEventListener('change', () => resolve(entrada.files?.[0] ?? null), { once: true });
    entrada.addEventListener('cancel', () => resolve(null), { once: true });
    entrada.click();
  });
}

function formatarTamanho(bytes) {
  const n = Number(bytes ?? 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

async function enviarDocumento(requisitoId, titulo) {
  const arquivo = await escolherArquivo();
  if (!arquivo) return;

  estado.carregando = true; render();
  try {
    await enviarArquivo(estado.portal.projeto.projeto_id, arquivo, { requisitoId, titulo });
    estado.erro = null;
    await carregarAba('checklist');
  } catch (e) {
    estado.erro = e.message;
  } finally {
    estado.carregando = false; render();
  }
}


// ------------------------------------------------------- análise documental ---

const GRAVIDADE = {
  critico: { rotulo: 'Crítico', classe: 'nga-selo--risco' },
  atencao: { rotulo: 'Atenção', classe: 'nga-selo--dev' },
  informacao: { rotulo: 'Informação', classe: 'nga-selo--info' },
};

const CERTEZA = {
  alta: 'nga-selo--ok', media: 'nga-selo--info',
  baixa: 'nga-selo--dev', nenhuma: '',
};

const ESTAGIO_IA = {
  executada: { rotulo: 'Leitura por modelo executada', classe: 'nga-selo--ok' },
  nao_executada: { rotulo: 'Leitura por modelo não solicitada', classe: '' },
  indisponivel: { rotulo: 'Leitura por modelo indisponível', classe: 'nga-selo--dev' },
  recusada: { rotulo: 'Leitura recusada pelo modelo', classe: 'nga-selo--dev' },
  falhou: { rotulo: 'Leitura falhou', classe: 'nga-selo--risco' },
};

async function abrirAnalise() {
  estado.carregando = true; render();
  try {
    const [ia, projetos, acervo] = await Promise.all([
      api('/api/ia/estado'), api('/api/projetos'), api('/api/arquivos/estado'),
    ]);
    estado.analise = {
      ia, projetos, acervo, projetoId: projetos[0]?.id ?? null,
      documentos: [], analises: {}, detalhe: null,
    };
    estado.vista = 'analise';
    if (estado.analise.projetoId) await carregarDocumentos(estado.analise.projetoId);
  } catch (e) {
    estado.erro = e.message;
  } finally {
    estado.carregando = false; render();
  }
}

async function carregarDocumentos(projetoId) {
  const a = estado.analise;
  a.projetoId = projetoId;
  a.documentos = await api(`/api/projetos/${projetoId}/documentos`);
  a.analises = {};
  // As listas de análise de cada documento vêm juntas: sem isso a tela mostra
  // "nenhuma análise" para documento que tem três.
  await Promise.all(a.documentos.map(async (d) => {
    a.analises[d.id] = await api(`/api/documentos/${d.id}/analises`);
  }));
}

/**
 * Aviso do estágio de IA.
 *
 * Quando o modelo não está disponível, a tela DIZ isso e diz o que continua
 * valendo — em vez de deixar o advogado supor que a análise está completa
 * (§18, §22).
 */
function avisoDaIa(ia) {
  if (ia.disponivel) {
    return `<p class="nga-nota">Leitura por modelo disponível (${esc(ia.provedor)}).
      Toda análise permanece sugestão sujeita a revisão humana.</p>`;
  }
  return `
    <div class="nga-card aviso-ia">
      <span class="nga-selo nga-selo--dev">Leitura por modelo indisponível</span>
      <p>${esc(ia.impedimento)}</p>
      <p class="pendencia">Continua valendo, sem depender de modelo nenhum:</p>
      <ul class="lista-seca">
        ${ia.deterministicoSempreDisponivel.map((x) => `<li>${esc(x)}</li>`).join('')}
      </ul>
    </div>`;
}

function linhaDocumento(d) {
  const analises = estado.analise.analises[d.id] ?? [];
  const ultima = analises[0];
  return `
    <div class="nga-card doc">
      <div class="doc-cabeca">
        <div>
          <h4>${esc(d.titulo)}</h4>
          <small class="nga-dado">${esc(d.categoria ?? 'sem categoria')} ·
            ${d.visibilidade === 'publicado' ? 'publicado ao cliente' : 'interno'}
            ${d.tem_arquivo
              ? ` · ${esc(d.nome_original ?? '')} ${formatarTamanho(d.tamanho_bytes)}`
              : ' · sem arquivo guardado'}</small>
        </div>
        <div class="doc-acoes">
          ${d.tem_arquivo
            ? `<button class="nga-botao nga-botao--fantasma" data-baixar="${d.id}">Baixar</button>
               <button class="nga-botao nga-botao--fantasma" data-extrair="${d.id}">Extrair texto</button>`
            : ''}
          <button class="nga-botao nga-botao--fantasma" data-texto="${d.id}">Texto</button>
          <button class="nga-botao nga-botao--fantasma" data-analisar="${d.id}"
            data-ia="nao">Triagem</button>
          <button class="nga-botao" data-analisar="${d.id}" data-ia="sim"
            ${estado.analise.ia.disponivel ? '' : 'disabled title="sem chave de IA configurada"'}>
            Triagem + leitura</button>
        </div>
      </div>
      ${analises.length === 0
        ? '<p class="pendencia">Nenhuma análise ainda.</p>'
        : `<ul class="lista-analises">${analises.map((a) => {
            const est = ESTAGIO_IA[a.estagio_ia] ?? ESTAGIO_IA.falhou;
            return `
              <li>
                <button class="link-analise" data-analise="${a.id}">
                  ${esc(a.rotuloDoTipo ?? a.tipo_sugerido)}
                </button>
                <span class="nga-selo ${CERTEZA[a.certeza] ?? ''}">certeza ${esc(a.certeza)}</span>
                <span class="nga-selo ${est.classe}">${est.rotulo}</span>
                ${a.definitivo
                  ? `<span class="nga-selo nga-selo--ok">validado por ${esc(a.validado_por)}</span>`
                  : '<span class="nga-selo">aguarda validação</span>'}
                <small class="nga-dado">${a.achados} achado(s)${Number(a.criticos_abertos) > 0
                  ? ` · ${a.criticos_abertos} crítico(s) aberto(s)` : ''}</small>
              </li>`;
          }).join('')}</ul>`}
      <div class="area-texto" id="texto-${d.id}" hidden>
        <p class="pendencia">O armazenamento de arquivo com URL assinada não foi construído
          (§12.4). Até lá, o texto entra aqui — colado do PDF, do OCR ou de transcrição.</p>
        <textarea rows="7" placeholder="Cole o texto do documento"></textarea>
        <div class="linha-acoes">
          <select>
            <option value="pdf_nativo">PDF com texto nativo</option>
            <option value="ocr">OCR</option>
            <option value="texto_enviado">Digitado ou colado</option>
            <option value="transcricao">Transcrição</option>
          </select>
          <button class="nga-botao" data-salvar-texto="${d.id}">Salvar texto</button>
        </div>
      </div>
    </div>`;
}

function telaAnalise() {
  const a = estado.analise;
  raiz.innerHTML = `
    <div class="tela">
      ${topo()}
      <main class="corpo">
        <div class="saudacao">
          <h2>Análise documental</h2>
          <p>Classificação, identificadores conferidos e citações verificadas.
             O que vem de modelo de linguagem só entra ancorado em trecho do documento.</p>
        </div>
        ${avisoDaIa(a.ia)}
        <div class="linha-acoes">
          <label>Projeto
            <select id="projeto">
              ${a.projetos.map((p) => `
                <option value="${p.id}" ${p.id === a.projetoId ? 'selected' : ''}>
                  ${esc(p.nome)}</option>`).join('')}
            </select>
          </label>
          <button class="nga-botao" id="enviar-arquivo">Enviar documento</button>
          <button class="nga-botao nga-botao--fantasma" id="voltar">Voltar</button>
        </div>
        ${a.acervo ? `<p class="nga-nota">Acervo ${esc(a.acervo.armazenamento)} ·
          até ${(a.acervo.limiteBytes / 1048576).toFixed(0)} MB ·
          ${a.acervo.tiposAceitos.map((t) => esc(t.extensao)).join(', ')} ·
          links válidos por ${a.acervo.validadeDoLinkSegundos} s.
          ${a.acervo.segredoEfemero ? '<b>Segredo de assinatura efêmero: os links deixam de valer a cada reinício.</b>' : ''}
        </p>` : ''}
        ${a.documentos.length === 0
          ? '<p class="pendencia">Este projeto não tem documentos.</p>'
          : a.documentos.map(linhaDocumento).join('')}
      </main>
    </div>`;

  raiz.querySelector('#sair')?.addEventListener('click', sair);
  raiz.querySelector('#voltar')?.addEventListener('click', () => {
    estado.vista = 'central'; render();
  });
  raiz.querySelector('#projeto')?.addEventListener('change', async (ev) => {
    estado.carregando = true; render();
    try { await carregarDocumentos(ev.target.value); } catch (e) { estado.erro = e.message; }
    finally { estado.carregando = false; render(); }
  });

  for (const b of raiz.querySelectorAll('[data-texto]')) {
    b.addEventListener('click', () => {
      const area = raiz.querySelector(`#texto-${b.dataset.texto}`);
      area.hidden = !area.hidden;
    });
  }
  for (const b of raiz.querySelectorAll('[data-salvar-texto]')) {
    b.addEventListener('click', () => salvarTexto(b.dataset.salvarTexto));
  }
  for (const b of raiz.querySelectorAll('[data-analisar]')) {
    b.addEventListener('click', () => executarAnalise(b.dataset.analisar, b.dataset.ia === 'sim'));
  }
  for (const b of raiz.querySelectorAll('[data-analise]')) {
    b.addEventListener('click', () => abrirDetalhe(b.dataset.analise));
  }
  for (const b of raiz.querySelectorAll('[data-baixar]')) {
    b.addEventListener('click', () => baixarDocumento(b.dataset.baixar));
  }
  for (const b of raiz.querySelectorAll('[data-extrair]')) {
    b.addEventListener('click', () => extrairTexto(b.dataset.extrair));
  }
  raiz.querySelector('#enviar-arquivo')?.addEventListener('click', async () => {
    const arquivo = await escolherArquivo();
    if (!arquivo) return;
    const titulo = prompt('Título do documento:', arquivo.name);
    if (!titulo) return;

    estado.carregando = true; render();
    try {
      const r = await enviarArquivo(estado.analise.projetoId, arquivo, { titulo });
      await carregarDocumentos(estado.analise.projetoId);
      if (r.deduplicado) {
        alert('Arquivo idêntico a outro já no acervo: o conteúdo foi reaproveitado.');
      }
    } catch (e) {
      alert(e.message);
    } finally {
      estado.carregando = false; render();
    }
  });
}

/** Extrai o texto do arquivo guardado, quando o formato permite. */
async function extrairTexto(documentoId) {
  estado.carregando = true; render();
  try {
    const r = await api(`/api/documentos/${documentoId}/texto/extrair`, { method: 'POST' });
    alert(`Texto extraído: ${r.caracteres.toLocaleString('pt-BR')} caracteres. ` +
      'Agora a triagem pode rodar neste documento.');
  } catch (e) {
    // A recusa diz o que falta (PDF e OCR não construídos); mostrar isso é
    // mais útil do que um "erro" genérico.
    alert(e.message);
  } finally {
    estado.carregando = false; render();
  }
}

async function salvarTexto(documentoId) {
  const area = raiz.querySelector(`#texto-${documentoId}`);
  const texto = area.querySelector('textarea').value.trim();
  const origem = area.querySelector('select').value;
  if (!texto) { alert('Cole o texto do documento antes de salvar.'); return; }

  estado.carregando = true; render();
  try {
    const r = await api(`/api/documentos/${documentoId}/texto`, {
      method: 'POST', body: JSON.stringify({ texto, origem }),
    });
    alert(`Texto registrado: ${r.caracteres.toLocaleString('pt-BR')} caracteres.`);
  } catch (e) {
    alert(e.message);
  } finally {
    estado.carregando = false; render();
  }
}

async function executarAnalise(documentoId, comIa) {
  estado.carregando = true; render();
  try {
    const r = await api(`/api/documentos/${documentoId}/analises`, {
      method: 'POST', body: JSON.stringify({ comIa }),
    });
    await abrirDetalhe(r.id, r.achadosRecusados);
    return;
  } catch (e) {
    alert(e.message);
  } finally {
    estado.carregando = false; render();
  }
}

async function abrirDetalhe(analiseId, recusados) {
  estado.carregando = true; render();
  try {
    const detalhe = await api(`/api/analises/${analiseId}`);
    estado.analise.detalhe = { ...detalhe, recusados: recusados ?? [] };
    estado.vista = 'analise-detalhe';
  } catch (e) {
    estado.erro = e.message;
  } finally {
    estado.carregando = false; render();
  }
}

function blocoAchado(a) {
  const g = GRAVIDADE[a.gravidade] ?? GRAVIDADE.informacao;
  return `
    <div class="nga-card achado" data-situacao="${a.situacao}">
      <div class="achado-cabeca">
        <span class="nga-selo ${g.classe}">${g.rotulo}</span>
        <span class="nga-selo">${esc(a.rotuloDaNatureza)}</span>
        <span class="nga-selo ${a.origem === 'ia' ? 'nga-selo--info' : 'nga-selo--ok'}">
          ${a.origem === 'ia' ? 'leitura por modelo' : 'determinístico'}</span>
        ${a.fundamento_status ? `<span class="nga-selo ${
          a.fundamento_status === 'verificada' ? 'nga-selo--ok' : 'nga-selo--dev'
        }">${esc(a.fundamento_chave ?? a.fundamento_status)}</span>` : ''}
      </div>
      <h4>${esc(a.titulo)}</h4>
      <p class="achado-descricao">${esc(a.descricao).replace(/\n/g, '<br>')}</p>
      ${a.trecho_citado
        ? `<blockquote class="trecho">${esc(a.trecho_citado)}<cite class="nga-dado">` +
          `posição ${a.trecho_inicio ?? '—'} no documento` +
          `${a.pagina ? ` · página ${a.pagina}` : ''}</cite></blockquote>`
        : ''}
      ${a.situacao === 'aberto' ? `
        <div class="linha-acoes">
          <button class="nga-botao nga-botao--fantasma" data-triar="${a.id}"
            data-situacao="confirmado">Confirmar</button>
          <button class="nga-botao nga-botao--fantasma" data-triar="${a.id}"
            data-situacao="descartado">Descartar</button>
        </div>`
        : `<p class="nga-dado">${a.situacao} por ${esc(a.revisado_por_nome ?? '—')}</p>`}
    </div>`;
}

function telaAnaliseDetalhe() {
  const d = estado.analise.detalhe;
  const est = ESTAGIO_IA[d.estagio_ia] ?? ESTAGIO_IA.falhou;
  const identificadores = d.identificadores ?? [];
  const citacoes = d.citacoes ?? [];
  const suspeitas = d.suspeitas ?? [];

  raiz.innerHTML = `
    <div class="tela">
      ${topo()}
      <main class="corpo">
        <div class="linha-acoes">
          <button class="nga-botao nga-botao--fantasma" id="voltar">← Documentos</button>
        </div>
        <div class="saudacao">
          <h2>${esc(d.documento)}</h2>
          <p>
            <span class="nga-selo ${CERTEZA[d.certeza] ?? ''}">
              ${esc(d.rotuloDoTipo ?? d.tipo_sugerido)} · certeza ${esc(d.certeza)}</span>
            <span class="nga-selo ${est.classe}">${est.rotulo}</span>
            ${d.definitivo
              ? `<span class="nga-selo nga-selo--ok">tipo validado por ${esc(d.validado_por_nome)}</span>`
              : '<span class="nga-selo nga-selo--dev">tipo ainda não validado</span>'}
          </p>
          <p class="pendencia">${esc(d.criterio ?? '')}</p>
          ${d.motivo_ia ? `<p class="pendencia">Leitura por modelo: ${esc(d.motivo_ia)}</p>` : ''}
          ${d.modelo_ia ? `<p class="nga-dado">modelo ${esc(d.modelo_ia)} ·
            ${d.tokens_entrada ?? '—'} tokens de entrada · ${d.tokens_saida ?? '—'} de saída</p>` : ''}
        </div>

        ${d.resumo ? `
          <div class="nga-card nga-ia">
            <p>${esc(d.resumo)}</p>
          </div>` : ''}

        ${!d.definitivo ? `
          <div class="linha-acoes">
            <label>Validar o tipo
              <select id="tipo-validado">
                <option value="${esc(d.tipo_sugerido)}">${esc(d.rotuloDoTipo)} (sugerido)</option>
                ${(d.alternativas ?? []).map((x) => `
                  <option value="${esc(x.tipo)}">${esc(x.rotulo ?? x.tipo)}</option>`).join('')}
                <option value="desconhecido">Não classificado</option>
              </select>
            </label>
            <button class="nga-botao" id="validar">Validar tipo</button>
          </div>` : ''}

        <section class="ambiente">
          <header><h3>Achados</h3>
            <small>${d.achados.length} no total · o que vem de modelo está ancorado em trecho conferido</small>
          </header>
          ${d.achados.length === 0
            ? '<p class="pendencia">Nenhum achado.</p>'
            : d.achados.map(blocoAchado).join('')}
        </section>

        ${d.recusados.length > 0 ? `
          <section class="ambiente">
            <header><h3>Descartados antes de chegar aqui</h3>
              <small>O modelo afirmou, a plataforma não conseguiu ancorar no documento</small>
            </header>
            ${d.recusados.map((r) => `
              <div class="nga-card recusado">
                <h4>${esc(r.titulo)}</h4>
                <p>${esc(r.motivo)}</p>
                <blockquote class="trecho trecho--falso">${esc(r.trechoCitado)}</blockquote>
              </div>`).join('')}
          </section>` : ''}

        <section class="ambiente">
          <header><h3>Identificadores</h3>
            <small>CNPJ, CPF e número de processo conferidos por dígito verificador</small>
          </header>
          ${identificadores.length === 0
            ? '<p class="pendencia">Nenhum identificador reconhecido.</p>'
            : `<table class="nga-tabela"><thead><tr>
                 <th>Tipo</th><th>No documento</th><th>Canônico</th><th>Conferência</th>
               </tr></thead><tbody>
               ${identificadores.map((o) => `
                 <tr>
                   <td>${esc(o.tipo)}</td>
                   <td class="nga-dado">${esc(o.bruto)}</td>
                   <td class="nga-dado">${esc(o.canonico)}</td>
                   <td>${o.valido
                     ? '<span class="nga-selo nga-selo--ok">confere</span>'
                     : '<span class="nga-selo nga-selo--risco">não confere</span>'}
                     ${o.observacao ? `<small>${esc(o.observacao)}</small>` : ''}</td>
                 </tr>`).join('')}
               </tbody></table>`}
        </section>

        <section class="ambiente">
          <header><h3>Referências jurídicas citadas pelo documento</h3>
            <small>Conferidas contra o corpus fechado da NGA; jurisprudência não tem base integrada</small>
          </header>
          ${citacoes.length === 0
            ? '<p class="pendencia">O documento não cita dispositivo algum.</p>'
            : `<table class="nga-tabela"><thead><tr>
                 <th>Citação</th><th>Natureza</th><th>Situação</th><th>Fonte</th>
               </tr></thead><tbody>
               ${citacoes.map((c) => `
                 <tr>
                   <td class="nga-dado">${esc(c.bruto)}</td>
                   <td>${esc(c.rotuloDaNatureza ?? c.natureza)}</td>
                   <td><span class="nga-selo ${
                     c.status === 'verificada' ? 'nga-selo--ok'
                     : c.status === 'nao_localizada' ? 'nga-selo--risco' : 'nga-selo--dev'
                   }">${esc(c.rotuloDoStatus ?? c.status)}</span>
                   ${c.motivo ? `<small>${esc(c.motivo)}</small>` : ''}</td>
                   <td>${c.fonte
                     ? `<a href="${esc(c.fonte)}" target="_blank" rel="noopener">conferir</a>`
                     : '—'}</td>
                 </tr>`).join('')}
               </tbody></table>`}
        </section>

        ${suspeitas.length > 0 ? `
          <section class="ambiente">
            <header><h3>Conteúdo com forma de instrução no documento</h3>
              <small>Tratado como dado, nunca como instrução (§7.12)</small>
            </header>
            ${suspeitas.map((s) => `
              <div class="nga-card achado" data-situacao="aberto">
                <span class="nga-selo nga-selo--risco">${esc(s.tipo.replace(/_/g, ' '))}</span>
                <p>${esc(s.explicacao)}</p>
                <blockquote class="trecho trecho--falso">${esc(s.trecho)}</blockquote>
              </div>`).join('')}
          </section>` : ''}
      </main>
    </div>`;

  raiz.querySelector('#sair')?.addEventListener('click', sair);
  raiz.querySelector('#voltar')?.addEventListener('click', async () => {
    estado.vista = 'analise';
    estado.carregando = true; render();
    try { await carregarDocumentos(estado.analise.projetoId); }
    catch (e) { estado.erro = e.message; }
    finally { estado.carregando = false; render(); }
  });
  raiz.querySelector('#validar')?.addEventListener('click', async () => {
    const tipo = raiz.querySelector('#tipo-validado').value;
    try {
      await api(`/api/analises/${d.id}/validacao`, {
        method: 'POST', body: JSON.stringify({ tipo }),
      });
      await abrirDetalhe(d.id, d.recusados);
    } catch (e) { alert(e.message); }
  });
  for (const b of raiz.querySelectorAll('[data-triar]')) {
    b.addEventListener('click', async () => {
      try {
        await api(`/api/achados/${b.dataset.triar}/triagem`, {
          method: 'POST', body: JSON.stringify({ situacao: b.dataset.situacao }),
        });
        await abrirDetalhe(d.id, d.recusados);
      } catch (e) { alert(e.message); }
    });
  }
}


// ------------------------------------------------------------- processos ---

const SITUACOES_DO_PRAZO = {
  aberto: '', cumprido: 'nga-selo--ok', perdido: 'nga-selo--risco', cancelado: '',
};

const dataBR = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—');

async function abrirProcessos(focoNaAgenda = false) {
  estado.carregando = true; render();
  try {
    const podeVerPrazo = estado.eu.permissoes.includes('prazo.ler');
    const [processos, agenda, catalogo] = await Promise.all([
      api('/api/processos'),
      podeVerPrazo ? api('/api/agenda') : Promise.resolve(null),
      podeVerPrazo ? api('/api/prazos/catalogo') : Promise.resolve([]),
    ]);
    estado.processos = { lista: processos, agenda, catalogo, focoNaAgenda, detalhe: null };
    estado.vista = 'processos';
  } catch (e) {
    estado.erro = e.message;
  } finally {
    estado.carregando = false; render();
  }
}

/**
 * Caixa da agenda.
 *
 * Vencido primeiro e em vermelho: um prazo aberto com vencimento no passado é
 * o achado mais importante que esta tela pode mostrar, e esconder isso no
 * meio de uma lista ordenada por data é como não mostrar.
 */
function caixaDaAgenda(agenda) {
  if (!agenda) return '';
  if (agenda.itens.length === 0) {
    return '<p class="nga-nota">Nenhum prazo aberto nos próximos 90 dias.</p>';
  }
  return `
    <section class="ambiente">
      <header>
        <h3>Agenda de prazos</h3>
        <small>${agenda.itens.length} aberto(s) · ${agenda.vencidos} vencido(s) ·
          ${agenda.venceHoje} vence(m) hoje</small>
      </header>
      <table class="nga-tabela">
        <thead><tr>
          <th>Vencimento</th><th>Prazo</th><th>Processo</th><th>Responsável</th><th>Faltam</th>
        </tr></thead>
        <tbody>${agenda.itens.map((i) => `
          <tr data-vencido="${i.vencido}">
            <td class="nga-dado">${dataBR(i.vencimento)}</td>
            <td>${esc(i.titulo)}</td>
            <td><button class="link-analise" data-processo="${i.processo_id}">
              ${esc(i.numero)}</button></td>
            <td>${esc(i.responsavel ?? '—')}</td>
            <td>${i.vencido
              ? `<span class="nga-selo nga-selo--risco">vencido há ${-i.diasUteisRestantes} dia(s) útil(eis)</span>`
              : i.diasUteisRestantes === 0
                ? '<span class="nga-selo nga-selo--dev">vence hoje</span>'
                : `<span class="nga-dado">${i.diasUteisRestantes} dia(s) útil(eis)</span>`}</td>
          </tr>`).join('')}</tbody>
      </table>
      <p class="nga-nota">${esc(agenda.ressalva)}</p>
    </section>`;
}

function telaProcessos() {
  const p = estado.processos;
  raiz.innerHTML = `
    <div class="tela">
      ${topo()}
      <main class="corpo">
        <div class="saudacao">
          <h2>Processos</h2>
          <p>Cadastro, andamento e prazos. A contagem segue os arts. 219, 224 e 220 do CPC,
             e cada data sai com o cálculo à vista.</p>
        </div>
        <div class="linha-acoes">
          <button class="nga-botao" id="novo-processo">Cadastrar processo</button>
          <button class="nga-botao nga-botao--fantasma" id="voltar">Voltar</button>
        </div>
        ${caixaDaAgenda(p.agenda)}
        <section class="ambiente">
          <header><h3>Todos os processos</h3><small>${p.lista.length} cadastrado(s)</small></header>
          ${p.lista.length === 0
            ? '<p class="pendencia">Nenhum processo cadastrado.</p>'
            : `<table class="nga-tabela">
                <thead><tr>
                  <th>Número</th><th>Classe</th><th>Comarca</th><th>Situação</th>
                  <th>Movimentações</th><th>Prazos abertos</th>
                </tr></thead>
                <tbody>${p.lista.map((x) => `
                  <tr>
                    <td><button class="link-analise" data-processo="${x.id}">
                      ${esc(x.numero)}</button>
                      <small>${esc(x.segmento ?? '')}</small></td>
                    <td>${esc(x.classe ?? '—')}
                      ${x.segredo_justica ? '<small>segredo de justiça</small>' : ''}</td>
                    <td>${esc(x.comarca ?? '—')}${x.uf ? `/${esc(x.uf)}` : ''}</td>
                    <td><span class="nga-selo ${SITUACAO_DO_PROCESSO[x.situacao] ?? ''}">
                      ${esc(x.situacao)}</span>
                      ${x.suspenso_motivo ? `<small>${esc(x.suspenso_motivo)}</small>` : ''}</td>
                    <td class="nga-dado">${x.movimentacoes}</td>
                    <td class="nga-dado">${x.prazos_abertos}${
                      x.diasUteisAteOProximo !== null
                        ? ` · próximo em ${x.diasUteisAteOProximo} dia(s) útil(eis)` : ''}</td>
                  </tr>`).join('')}</tbody>
              </table>`}
        </section>
      </main>
    </div>`;

  raiz.querySelector('#sair')?.addEventListener('click', sair);
  raiz.querySelector('#voltar')?.addEventListener('click', () => {
    estado.vista = 'central'; render();
  });
  raiz.querySelector('#novo-processo')?.addEventListener('click', cadastrarProcesso);
  for (const b of raiz.querySelectorAll('[data-processo]')) {
    b.addEventListener('click', () => abrirProcesso(b.dataset.processo));
  }
}

async function cadastrarProcesso() {
  const numero = prompt('Número único do processo (CNJ):');
  if (!numero) return;
  const classe = prompt('Classe processual:', 'Recuperação Judicial') ?? undefined;

  estado.carregando = true; render();
  try {
    await api('/api/processos', {
      method: 'POST', body: JSON.stringify({ numero, classe }),
    });
    await abrirProcessos();
    return;
  } catch (e) {
    // O dígito verificador é conferido no servidor; mostrar o motivo exato é
    // mais útil do que "erro ao salvar".
    alert(e.message);
  } finally {
    estado.carregando = false; render();
  }
}

async function abrirProcesso(id) {
  estado.carregando = true; render();
  try {
    estado.processos.detalhe = await api(`/api/processos/${id}`);
    estado.vista = 'processo';
  } catch (e) {
    estado.erro = e.message;
  } finally {
    estado.carregando = false; render();
  }
}

function blocoPrazo(z) {
  const c = z.calculo ?? {};
  return `
    <div class="nga-card achado">
      <div class="achado-cabeca">
        <span class="nga-selo ${SITUACOES_DO_PRAZO[z.situacao] ?? ''}">${esc(z.situacao)}</span>
        <span class="nga-selo">${esc(z.dias)} dias ${esc(z.regime)}</span>
        ${z.em_dobro ? '<span class="nga-selo nga-selo--dev">em dobro</span>' : ''}
        ${z.diasUteisRestantes !== null && z.diasUteisRestantes < 0
          ? `<span class="nga-selo nga-selo--risco">vencido há ${-z.diasUteisRestantes} dia(s) útil(eis)</span>`
          : z.diasUteisRestantes !== null
            ? `<span class="nga-dado">faltam ${z.diasUteisRestantes} dia(s) útil(eis)</span>`
            : ''}
      </div>
      <h4>${esc(z.titulo)} — vence em ${dataBR(z.vencimento)}</h4>
      ${c.fundamentoLegal ? `<p class="fundamento">${esc(c.fundamentoLegal)}</p>` : ''}
      <details class="calculo">
        <summary>Como esta data foi calculada</summary>
        <p class="nga-dado">evento ${dataBR(z.evento)} (${esc(z.origem)}) ·
          publicação ${dataBR(c.publicacao)} · 1º dia contado ${dataBR(c.primeiroDiaContado)}</p>
        <ul class="lista-seca">${(c.fundamentos ?? []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        ${(c.naoCorreram ?? []).length > 0 ? `
          <p class="nga-dado">Dias que não correram:</p>
          <ul class="lista-seca">${c.naoCorreram.map((d) =>
            `<li>${dataBR(d.data)} — ${esc(d.nome)}</li>`).join('')}</ul>` : ''}
        <p class="pendencia">${(c.ressalvas ?? []).map(esc).join(' ')}</p>
      </details>
      ${z.situacao === 'aberto' ? `
        <div class="linha-acoes">
          <button class="nga-botao nga-botao--fantasma" data-fechar="${z.id}"
            data-como="cumprido">Marcar cumprido</button>
          <button class="nga-botao nga-botao--fantasma" data-fechar="${z.id}"
            data-como="cancelado">Cancelar</button>
        </div>` : z.observacao ? `<p class="obs">${esc(z.observacao)}</p>` : ''}
    </div>`;
}

function telaProcesso() {
  const p = estado.processos.detalhe;
  const podePublicar = estado.eu.permissoes.includes('portal.publicar');
  const podePrazo = estado.eu.permissoes.includes('prazo.escrever');

  raiz.innerHTML = `
    <div class="tela">
      ${topo()}
      <main class="corpo">
        <div class="linha-acoes">
          <button class="nga-botao nga-botao--fantasma" id="voltar">← Processos</button>
        </div>
        <div class="saudacao">
          <h2>${esc(p.numero)}</h2>
          <p>
            <span class="nga-selo ${SITUACAO_DO_PROCESSO[p.situacao] ?? ''}">${esc(p.situacao)}</span>
            ${p.segmento ? `<span class="nga-selo">${esc(p.segmento)}</span>` : ''}
            ${p.segredo_justica ? '<span class="nga-selo nga-selo--risco">segredo de justiça</span>' : ''}
          </p>
          <p class="nga-dado">${esc(p.classe ?? '—')}${
            p.comarca ? ` · ${esc(p.comarca)}${p.uf ? `/${esc(p.uf)}` : ''}` : ''}${
            p.valorFormatado ? ` · valor da causa R$ ${esc(p.valorFormatado)}` : ''}${
            p.distribuido_em ? ` · distribuído em ${dataBR(p.distribuido_em)}` : ''}</p>
          ${p.suspenso_motivo
            ? `<p class="pendencia">Suspenso: ${esc(p.suspenso_motivo)}${
                p.suspenso_ate ? ` — até ${dataBR(p.suspenso_ate)}` : ''}</p>` : ''}
        </div>

        <section class="ambiente">
          <header><h3>Partes</h3></header>
          ${p.partes.length === 0 ? '<p class="pendencia">Nenhuma parte cadastrada.</p>'
            : `<table class="nga-tabela">
                <thead><tr><th>Polo</th><th>Nome</th><th>Documento</th><th>Papel</th></tr></thead>
                <tbody>${p.partes.map((x) => `<tr>
                  <td>${esc(x.polo)}</td>
                  <td>${esc(x.nome)}${x.eh_cliente ? ' <span class="nga-selo nga-selo--ok">cliente</span>' : ''}</td>
                  <td class="nga-dado">${esc(x.documento ?? '—')}</td>
                  <td>${esc(x.papel ?? '—')}</td>
                </tr>`).join('')}</tbody></table>`}
        </section>

        <section class="ambiente">
          <header><h3>Prazos</h3>
            <small>a data sai do cálculo do CPC e sempre pede conferência</small></header>
          ${podePrazo ? `<div class="linha-acoes">
            <button class="nga-botao" id="novo-prazo">Calcular prazo</button></div>` : ''}
          ${p.prazos.length === 0 ? '<p class="pendencia">Nenhum prazo lançado.</p>'
            : p.prazos.map(blocoPrazo).join('')}
        </section>

        <section class="ambiente">
          <header><h3>Andamento</h3>
            <small>movimentação nasce invisível ao cliente; publicar exige resumo escrito</small>
          </header>
          ${podePublicar ? `<div class="linha-acoes">
            <button class="nga-botao nga-botao--fantasma" id="nova-mov">Registrar movimentação</button>
          </div>` : ''}
          ${p.movimentacoes.length === 0 ? '<p class="pendencia">Nenhuma movimentação.</p>'
            : `<ol class="linha-do-tempo">${p.movimentacoes.map((m) => `
              <li data-publicada="${m.visivel_ao_cliente}">
                <time class="nga-dado">${dataBR(m.data)}</time>
                <p><b>${esc(m.titulo)}</b></p>
                ${m.conteudo ? `<p class="obs">${esc(m.conteudo)}</p>` : ''}
                ${m.visivel_ao_cliente
                  ? `<p class="nga-nota">Publicado ao cliente: ${esc(m.resumo_ao_cliente)}</p>`
                  : '<p class="nga-dado">não publicado</p>'}
                ${podePublicar ? `<div class="linha-acoes">
                  ${m.visivel_ao_cliente
                    ? `<button class="nga-botao nga-botao--fantasma" data-despublicar="${m.id}">Despublicar</button>`
                    : `<button class="nga-botao nga-botao--fantasma" data-publicar="${m.id}">Publicar ao cliente</button>`}
                  </div>` : ''}
              </li>`).join('')}</ol>`}
        </section>
      </main>
    </div>`;

  raiz.querySelector('#sair')?.addEventListener('click', sair);
  raiz.querySelector('#voltar')?.addEventListener('click', () => abrirProcessos());
  raiz.querySelector('#novo-prazo')?.addEventListener('click', () => lancarPrazo(p.id));
  raiz.querySelector('#nova-mov')?.addEventListener('click', () => registrarMovimentacao(p.id));
  for (const b of raiz.querySelectorAll('[data-fechar]')) {
    b.addEventListener('click', () => fecharPrazo(b.dataset.fechar, b.dataset.como, p.id));
  }
  for (const b of raiz.querySelectorAll('[data-publicar]')) {
    b.addEventListener('click', () => publicarMovimentacao(b.dataset.publicar, p.id));
  }
  for (const b of raiz.querySelectorAll('[data-despublicar]')) {
    b.addEventListener('click', async () => {
      try {
        await api(`/api/movimentacoes/${b.dataset.despublicar}/publicacao`, { method: 'DELETE' });
        await abrirProcesso(p.id);
      } catch (e) { alert(e.message); }
    });
  }
}

async function lancarPrazo(processoId) {
  const catalogo = estado.processos.catalogo;
  const opcoes = catalogo.map((c, i) => `${i + 1}. ${c.nome} (${c.dias} dias ${c.regime})`).join('\n');
  const escolha = prompt(`Tipo do prazo:\n${opcoes}\n\nNúmero:`);
  if (!escolha) return;
  const tipo = catalogo[Number(escolha) - 1]?.id;
  if (!tipo) { alert('Tipo inválido.'); return; }

  const evento = prompt('Data do evento (AAAA-MM-DD):', new Date().toISOString().slice(0, 10));
  if (!evento) return;

  try {
    const r = await api(`/api/processos/${processoId}/prazos`, {
      method: 'POST', body: JSON.stringify({ tipo, evento }),
    });
    // A observação do catálogo é onde mora a divergência (o stay, por exemplo).
    alert(`Vence em ${r.vencimento}.\n\n${r.fundamentoLegal ?? ''}` +
      (r.observacaoDoCatalogo ? `\n\n${r.observacaoDoCatalogo}` : '') +
      '\n\nConfira o calendário da comarca antes de confiar na data.');
    await abrirProcesso(processoId);
  } catch (e) { alert(e.message); }
}

async function fecharPrazo(prazoId, situacao, processoId) {
  const observacao = prompt(`Marcar como "${situacao}". Observação:`) ?? undefined;
  try {
    await api(`/api/prazos/${prazoId}/fechamento`, {
      method: 'POST', body: JSON.stringify({ situacao, observacao }),
    });
    await abrirProcesso(processoId);
  } catch (e) { alert(e.message); }
}

async function registrarMovimentacao(processoId) {
  const data = prompt('Data da movimentação (AAAA-MM-DD):', new Date().toISOString().slice(0, 10));
  if (!data) return;
  const titulo = prompt('Título da movimentação:');
  if (!titulo) return;
  try {
    await api(`/api/processos/${processoId}/movimentacoes`, {
      method: 'POST', body: JSON.stringify({ data, titulo }),
    });
    await abrirProcesso(processoId);
  } catch (e) { alert(e.message); }
}

async function publicarMovimentacao(movimentacaoId, processoId) {
  const resumo = prompt(
    'Resumo para o cliente.\n\nEscreva no idioma dele, não no do processo: ' +
    'é esta frase que ele vai ler no portal.');
  if (!resumo) return;
  try {
    await api(`/api/movimentacoes/${movimentacaoId}/publicacao`, {
      method: 'POST', body: JSON.stringify({ resumo }),
    });
    await abrirProcesso(processoId);
  } catch (e) { alert(e.message); }
}


// ------------------------------------------------------------ relatórios ---

const ROTULO_DO_RELATORIO = {
  acompanhamento: 'Acompanhamento mensal (para o cliente)',
  credores: 'Quadro de credores consolidado',
};

async function abrirRelatorios() {
  estado.carregando = true; render();
  try {
    const [projetos, tipos] = await Promise.all([
      api('/api/projetos'), api('/api/relatorios/tipos'),
    ]);
    const projetoId = estado.relatorios?.projetoId ?? projetos[0]?.id ?? null;
    estado.relatorios = {
      projetos, tipos: tipos.tipos, periodo: tipos.periodoPadrao,
      projetoId, emitidos: [], ultimo: null,
    };
    if (projetoId) await carregarEmitidos(projetoId);
    estado.vista = 'relatorios';
  } catch (e) {
    estado.erro = e.message;
  } finally {
    estado.carregando = false; render();
  }
}

async function carregarEmitidos(projetoId) {
  const r = estado.relatorios;
  r.projetoId = projetoId;
  const documentos = await api(`/api/projetos/${projetoId}/documentos`);
  r.emitidos = documentos.filter((d) => d.categoria === 'Relatório');
}

/**
 * As lacunas do último relatório, em destaque.
 *
 * Aparecem ANTES do botão de publicar, de propósito: é a última chance de
 * alguém ver o que o relatório não afirma antes de ele chegar ao cliente.
 */
function lacunasDoUltimo(ultimo) {
  if (!ultimo) return '';
  return `
    <div class="nga-card aviso-ia">
      <span class="nga-selo ${ultimo.lacunas.length ? 'nga-selo--dev' : 'nga-selo--ok'}">
        ${ultimo.lacunas.length ? `${ultimo.lacunas.length} lacuna(s)` : 'sem lacunas'}</span>
      <h4>${esc(ultimo.nome)}</h4>
      <p class="nga-dado">${esc(ultimo.subtitulo)} · ${formatarTamanho(ultimo.tamanho)}</p>
      ${ultimo.lacunas.length ? `
        <p class="pendencia">O que este relatório NÃO afirma:</p>
        <ul class="lista-seca">${ultimo.lacunas.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
        : '<p class="pendencia">Todas as seções foram preenchidas com dados registrados.</p>'}
      <p class="pendencia">Procedência: ${ultimo.fontes.map(esc).join(' · ') || '—'}</p>
      <div class="linha-acoes">
        <button class="nga-botao nga-botao--fantasma" data-baixar="${ultimo.documentoId}">Baixar</button>
        <button class="nga-botao" data-publicar-doc="${ultimo.documentoId}">Publicar ao cliente</button>
      </div>
    </div>`;
}

function telaRelatorios() {
  const r = estado.relatorios;
  const podePublicar = estado.eu.permissoes.includes('portal.publicar');

  raiz.innerHTML = `
    <div class="tela">
      ${topo()}
      <main class="corpo">
        <div class="saudacao">
          <h2>Relatórios</h2>
          <p>Gerados a partir do que está lançado. Seção sem dado diz que não tem,
             e o PDF termina listando o que ele não afirma.</p>
        </div>
        <div class="linha-acoes">
          <label>Projeto
            <select id="projeto">
              ${r.projetos.map((p) => `<option value="${p.id}"
                ${p.id === r.projetoId ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}
            </select>
          </label>
          <label>Relatório
            <select id="tipo">
              ${r.tipos.map((t) => `<option value="${t}">
                ${esc(ROTULO_DO_RELATORIO[t] ?? t)}</option>`).join('')}
            </select>
          </label>
          <label>De <input type="date" id="de" value="${r.periodo.de}"></label>
          <label>Até <input type="date" id="ate" value="${r.periodo.ate}"></label>
          <button class="nga-botao" id="gerar">Gerar</button>
          <button class="nga-botao nga-botao--fantasma" id="voltar">Voltar</button>
        </div>
        ${lacunasDoUltimo(r.ultimo)}
        <section class="ambiente">
          <header><h3>Emitidos neste projeto</h3>
            <small>cada emissão é um documento próprio, com sua publicação e sua auditoria</small>
          </header>
          ${r.emitidos.length === 0 ? '<p class="pendencia">Nenhum relatório emitido ainda.</p>'
            : `<table class="nga-tabela">
                <thead><tr><th>Relatório</th><th>Emitido em</th><th>Tamanho</th>
                  <th>No portal</th><th></th></tr></thead>
                <tbody>${r.emitidos.map((d) => `<tr>
                  <td>${esc(d.titulo)}</td>
                  <td class="nga-dado">${new Date(d.criado_em).toLocaleString('pt-BR')}</td>
                  <td class="nga-dado">${formatarTamanho(d.tamanho_bytes)}</td>
                  <td>${d.visibilidade === 'publicado'
                    ? '<span class="nga-selo nga-selo--ok">publicado</span>'
                    : '<span class="nga-dado">interno</span>'}</td>
                  <td>
                    <button class="nga-botao nga-botao--fantasma" data-baixar="${d.id}">Baixar</button>
                    ${podePublicar ? (d.visibilidade === 'publicado'
                      ? `<button class="nga-botao nga-botao--fantasma" data-despublicar-doc="${d.id}">Despublicar</button>`
                      : `<button class="nga-botao nga-botao--fantasma" data-publicar-doc="${d.id}">Publicar</button>`) : ''}
                  </td>
                </tr>`).join('')}</tbody></table>`}
        </section>
      </main>
    </div>`;

  raiz.querySelector('#sair')?.addEventListener('click', sair);
  raiz.querySelector('#voltar')?.addEventListener('click', () => {
    estado.vista = 'central'; render();
  });
  raiz.querySelector('#projeto')?.addEventListener('change', async (ev) => {
    estado.carregando = true; render();
    try {
      estado.relatorios.ultimo = null;
      await carregarEmitidos(ev.target.value);
    } catch (e) { estado.erro = e.message; }
    finally { estado.carregando = false; render(); }
  });
  raiz.querySelector('#gerar')?.addEventListener('click', gerarRelatorio);

  for (const b of raiz.querySelectorAll('[data-baixar]')) {
    b.addEventListener('click', () => baixarDocumento(b.dataset.baixar));
  }
  for (const b of raiz.querySelectorAll('[data-publicar-doc]')) {
    b.addEventListener('click', () => mudarPublicacao(b.dataset.publicarDoc, 'POST'));
  }
  for (const b of raiz.querySelectorAll('[data-despublicar-doc]')) {
    b.addEventListener('click', () => mudarPublicacao(b.dataset.despublicarDoc, 'DELETE'));
  }
}

async function gerarRelatorio() {
  const r = estado.relatorios;
  const tipo = raiz.querySelector('#tipo').value;
  const de = raiz.querySelector('#de').value;
  const ate = raiz.querySelector('#ate').value;

  estado.carregando = true; render();
  try {
    r.ultimo = await api(`/api/projetos/${r.projetoId}/relatorios`, {
      method: 'POST', body: JSON.stringify({ tipo, de, ate }),
    });
    await carregarEmitidos(r.projetoId);
  } catch (e) {
    alert(e.message);
  } finally {
    estado.carregando = false; render();
  }
}

async function mudarPublicacao(documentoId, metodo) {
  try {
    await api(`/api/documentos/${documentoId}/publicacao`, { method: metodo });
    await carregarEmitidos(estado.relatorios.projetoId);
    render();
  } catch (e) { alert(e.message); }
}


// -------------------------------------------------------- painel e projeto ---

const PAPEL_NA_EQUIPE = {
  lider: 'nga-selo--ok', advogado: '', revisor: 'nga-selo--info', apoio: '',
};

/**
 * O que está na mesa.
 *
 * Nada aqui é sugestão: são as pendências que existem no banco, ordenadas
 * pelo que vence antes. Sem pendência, a tela DIZ isso em vez de inventar um
 * indicador para não ficar vazia (§18).
 */
function painelDeTrabalho() {
  const p = estado.painel;
  if (!p) return '';

  if (p.pendencias === 0 && p.meusProjetos.length === 0) {
    return `<p class="nga-nota">Nada na sua mesa e nenhum projeto com você na equipe.</p>`;
  }

  const prazos = p.prazos.slice(0, 5);
  const cartao = (titulo, quantos, classe, corpo) => `
    <section class="ambiente pendencia-bloco">
      <header>
        <h3>${esc(titulo)}</h3>
        <span class="nga-selo ${classe}">${quantos}</span>
      </header>
      ${corpo}
    </section>`;

  return `
    <div class="indicadores">
      <div class="nga-card indicador">
        <div class="nga-rotulo">Pendências</div>
        <span class="n ${p.pendencias > 0 ? 'amber' : 'green'}">${p.pendencias}</span>
      </div>
      <div class="nga-card indicador">
        <div class="nga-rotulo">Prazos vencidos</div>
        <span class="n ${p.prazosVencidos > 0 ? 'red' : 'green'}">${p.prazosVencidos}</span>
      </div>
      <div class="nga-card indicador">
        <div class="nga-rotulo">Meus projetos</div>
        <span class="n cy">${p.meusProjetos.length}</span>
      </div>
      <div class="nga-card indicador">
        <div class="nga-rotulo">Sem resposta ao cliente</div>
        <span class="n ${p.mensagensSemResposta.length > 0 ? 'amber' : 'green'}">
          ${p.mensagensSemResposta.length}</span>
      </div>
    </div>

    ${p.meusProjetos.length > 0 ? cartao('Meus projetos', p.meusProjetos.length, 'nga-selo--info', `
      <div class="modulos">${p.meusProjetos.map((x) => `
        <button class="nga-card modulo" data-projeto="${x.id}">
          <span class="nga-selo ${PAPEL_NA_EQUIPE[x.papel] ?? ''}">${esc(x.papel)}</span>
          <h4>${esc(x.nome)}</h4>
          <p>${esc(x.rotuloDoTipo)}${x.faseAtual ? ` · ${esc(x.faseAtual.nome)}` : ''}</p>
        </button>`).join('')}</div>`) : ''}

    ${prazos.length > 0 ? cartao('Prazos mais próximos', p.prazos.length,
      p.prazosVencidos > 0 ? 'nga-selo--risco' : 'nga-selo--dev', `
      <table class="nga-tabela">
        <thead><tr><th>Vencimento</th><th>Prazo</th><th>Processo</th><th>Faltam</th></tr></thead>
        <tbody>${prazos.map((z) => `<tr data-vencido="${z.vencido}">
          <td class="nga-dado">${dataBR(z.vencimento)}</td>
          <td>${esc(z.titulo)}${z.meu ? ' <span class="nga-selo nga-selo--info">seu</span>' : ''}</td>
          <td class="nga-dado">${esc(z.numero)}</td>
          <td>${z.vencido
            ? `<span class="nga-selo nga-selo--risco">vencido há ${-z.diasUteisRestantes}</span>`
            : `<span class="nga-dado">${z.diasUteisRestantes} dia(s) útil(eis)</span>`}</td>
        </tr>`).join('')}</tbody>
      </table>`) : ''}

    ${p.aAnalisar.length > 0 ? cartao('Documentos aguardando análise', p.aAnalisar.length, 'nga-selo--dev', `
      <ul class="lista-seca">${p.aAnalisar.map((r) => `
        <li>${esc(r.titulo)} <span class="nga-dado">${esc(r.projeto)}</span></li>`).join('')}</ul>`) : ''}

    ${p.aValidar.length > 0 ? cartao('Créditos sem classe validada',
      p.aValidar.reduce((t, x) => t + x.quantos, 0), 'nga-selo--dev', `
      <ul class="lista-seca">${p.aValidar.map((r) => `
        <li>${r.quantos} em <b>${esc(r.projeto)}</b></li>`).join('')}</ul>
      <p class="nga-nota">Enquanto não houver validação humana, nada a jusante trata a
        classe como definitiva — nem o plano, nem o quadro de credores.</p>`) : ''}

    ${p.achadosCriticos.length > 0 ? cartao('Achados críticos abertos',
      p.achadosCriticos.length, 'nga-selo--risco', `
      <ul class="lista-seca">${p.achadosCriticos.map((a) => `
        <li>${esc(a.titulo)} <span class="nga-dado">${esc(a.documento)}</span></li>`).join('')}</ul>`) : ''}

    ${p.mensagensSemResposta.length > 0 ? cartao('Cliente esperando resposta',
      p.mensagensSemResposta.length, 'nga-selo--dev', `
      <ul class="lista-seca">${p.mensagensSemResposta.map((m) => `
        <li>“${esc(m.texto.slice(0, 120))}” <span class="nga-dado">${esc(m.projeto)} ·
          ${dataBR(m.criado_em)}</span></li>`).join('')}</ul>`) : ''}`;
}

async function abrirProjeto(id) {
  estado.carregando = true; render();
  try {
    estado.projeto = await api(`/api/projetos/${id}`);
    estado.vista = 'projeto';
  } catch (e) {
    estado.erro = e.message;
  } finally {
    estado.carregando = false; render();
  }
}

function trilhaDeFases(p) {
  if (!p.faseAtual) return '';
  const atual = p.faseAtual.id;
  const normais = p.fasesDisponiveis.filter((f) => !f.excepcional);
  const iAtual = normais.findIndex((f) => f.id === atual);
  return `
    <ol class="trilha">
      ${normais.map((f, i) => `
        <li data-estado="${i < iAtual ? 'passou' : i === iAtual ? 'atual' : 'futura'}">
          <span>${esc(f.nome)}</span>
          ${f.fundamento ? `<small class="nga-dado">${esc(f.fundamento)}</small>` : ''}
        </li>`).join('')}
    </ol>`;
}

function telaProjeto() {
  const p = estado.projeto;
  const c = p.contagens;
  const podeEscrever = estado.eu.permissoes.includes('projeto.escrever');
  const atalho = (rotulo, valor, rota, alerta) => `
    <button class="nga-card indicador atalho" data-ir="${rota}">
      <div class="nga-rotulo">${esc(rotulo)}</div>
      <span class="n ${alerta ? 'amber' : 'cy'}">${valor}</span>
    </button>`;

  raiz.innerHTML = `
    <div class="tela">
      ${topo()}
      <main class="corpo">
        <div class="linha-acoes">
          <button class="nga-botao nga-botao--fantasma" id="voltar">← Painel</button>
        </div>
        <div class="saudacao">
          <h2>${esc(p.nome)}</h2>
          <p>
            <span class="nga-selo nga-selo--info">${esc(p.rotuloDoTipo)}</span>
            <span class="nga-selo ${p.situacao === 'ativo' ? 'nga-selo--ok'
              : p.situacao === 'encerrado' ? '' : 'nga-selo--dev'}">${esc(p.situacao)}</span>
            ${p.faseAtual ? `<span class="nga-selo nga-selo--dev">${esc(p.faseAtual.nome)}
              ${p.progresso ? `· ${p.progresso.indice} de ${p.progresso.total}` : ''}</span>` : ''}
          </p>
          ${p.resumo ? `<p>${esc(p.resumo)}</p>` : ''}
          ${p.motivo_encerramento
            ? `<p class="pendencia">Encerrado em ${dataBR(p.encerrado_em)}: ${esc(p.motivo_encerramento)}</p>`
            : ''}
        </div>

        <section class="ambiente">
          <header><h3>Fase</h3>
            <small>${p.faseAtual?.marco ? esc(p.faseAtual.marco) : 'fase não definida'}</small>
          </header>
          ${trilhaDeFases(p)}
          ${podeEscrever && p.progresso && !p.progresso.terminal ? `
            <div class="linha-acoes">
              <label>Mudar para
                <select id="nova-fase">
                  ${p.fasesDisponiveis.filter((f) => f.id !== p.faseAtual?.id).map((f) => `
                    <option value="${f.id}">${esc(f.nome)}</option>`).join('')}
                </select>
              </label>
              <button class="nga-botao" id="mudar-fase">Registrar</button>
            </div>` : ''}
        </section>

        <section class="ambiente">
          <header><h3>O que está pendurado neste projeto</h3>
            <small>clique para abrir o módulo</small></header>
          <div class="indicadores">
            ${atalho('Créditos', c.creditos, '/creditos', c.creditos_a_validar > 0)}
            ${atalho('A validar', c.creditos_a_validar, '/creditos', c.creditos_a_validar > 0)}
            ${atalho('Processos', c.processos, '/processos', false)}
            ${atalho('Prazos abertos', c.prazos_abertos, '/processos', c.prazos_abertos > 0)}
            ${atalho('Documentos', c.documentos, '/analise', false)}
            ${atalho('Publicados', c.documentos_publicados, '/relatorios', false)}
            ${atalho('A analisar', c.requisitos_a_analisar, '/portal', c.requisitos_a_analisar > 0)}
            ${atalho('Achados críticos', c.achados_criticos, '/analise', c.achados_criticos > 0)}
          </div>
          ${c.requisitos_obrigatorios > 0 ? `
            <p class="nga-nota">Onboarding documental: ${c.requisitos_aprovados} de
              ${c.requisitos_obrigatorios} itens obrigatórios aprovados.
              Enviar não é aprovar.</p>` : ''}
          ${c.portais > 0
            ? '<p class="nga-nota">Portal do cliente ativo para este projeto.</p>'
            : '<p class="pendencia">Nenhum portal ativo: o cliente não acessa nada deste projeto.</p>'}
        </section>

        <section class="ambiente">
          <header><h3>Equipe</h3>
            <small>um líder por projeto, garantido por índice no banco</small></header>
          ${p.equipe.length === 0 ? '<p class="pendencia">Ninguém na equipe.</p>'
            : `<table class="nga-tabela">
                <thead><tr><th>Papel</th><th>Nome</th><th>Desde</th><th></th></tr></thead>
                <tbody>${p.equipe.map((e) => `<tr>
                  <td><span class="nga-selo ${PAPEL_NA_EQUIPE[e.papel] ?? ''}">${esc(e.papel)}</span></td>
                  <td>${esc(e.nome)}<small>${esc(e.email)}</small></td>
                  <td class="nga-dado">${dataBR(e.desde)}</td>
                  <td>${podeEscrever
                    ? `<button class="nga-botao nga-botao--fantasma" data-sair="${e.id}">Remover</button>`
                    : ''}</td>
                </tr>`).join('')}</tbody></table>`}
        </section>

        ${p.empresas.length > 0 ? `
          <section class="ambiente">
            <header><h3>Empresas</h3></header>
            <table class="nga-tabela">
              <thead><tr><th>Papel</th><th>Razão social</th><th>CNPJ</th></tr></thead>
              <tbody>${p.empresas.map((e) => `<tr>
                <td>${esc(e.papel)}</td>
                <td>${esc(e.nome_fantasia ?? e.razao_social)}</td>
                <td class="nga-dado">${esc(e.cnpj ?? '—')}</td>
              </tr>`).join('')}</tbody></table>
          </section>` : ''}

        ${p.proximosPrazos.length > 0 ? `
          <section class="ambiente">
            <header><h3>Próximos prazos</h3></header>
            <table class="nga-tabela">
              <thead><tr><th>Vencimento</th><th>Prazo</th><th>Processo</th><th>Faltam</th></tr></thead>
              <tbody>${p.proximosPrazos.map((z) => `<tr data-vencido="${z.diasUteisRestantes < 0}">
                <td class="nga-dado">${dataBR(z.vencimento)}</td>
                <td>${esc(z.titulo)}</td>
                <td class="nga-dado">${esc(z.numero)}</td>
                <td class="nga-dado">${z.diasUteisRestantes} dia(s) útil(eis)</td>
              </tr>`).join('')}</tbody></table>
          </section>` : ''}
      </main>
    </div>`;

  raiz.querySelector('#sair')?.addEventListener('click', sair);
  raiz.querySelector('#voltar')?.addEventListener('click', () => {
    estado.vista = 'central'; render();
  });
  for (const b of raiz.querySelectorAll('[data-ir]')) {
    b.addEventListener('click', () => abrir(b.dataset.ir));
  }
  raiz.querySelector('#mudar-fase')?.addEventListener('click', async () => {
    const fase = raiz.querySelector('#nova-fase').value;
    try {
      await api(`/api/projetos/${p.id}/fase`, {
        method: 'POST', body: JSON.stringify({ fase }),
      });
      await abrirProjeto(p.id);
    } catch (e) {
      // O domínio recusa pulo de fase e diz qual marco ficou sem registro.
      alert(e.message);
    }
  });
  for (const b of raiz.querySelectorAll('[data-sair]')) {
    b.addEventListener('click', async () => {
      try {
        await api(`/api/equipe/${b.dataset.sair}`, { method: 'DELETE' });
        await abrirProjeto(p.id);
      } catch (e) { alert(e.message); }
    });
  }
}


// ----------------------------------------------------------- integrações ---

const ROTULO_DA_APLICACAO = {
  sentinela: 'NGA Sentinela', integra: 'NGA Íntegra', prazos: 'NGA Prazos', outra: 'Outra',
};

async function abrirIntegracoes() {
  estado.carregando = true; render();
  try {
    estado.integracoes = { ...(await api('/api/integracoes')), novoToken: null };
    estado.vista = 'integracoes';
  } catch (e) {
    estado.erro = e.message;
  } finally {
    estado.carregando = false; render();
  }
}

function telaIntegracoes() {
  const { integracoes, contrato, novoToken } = estado.integracoes;

  raiz.innerHTML = `
    <div class="tela">
      ${topo()}
      <main class="corpo">
        <div class="saudacao">
          <h2>Integrações do NGA Lab</h2>
          <p>As aplicações do Lab seguem separadas. O que passa por aqui é o que elas
             entregam — e com que credencial.</p>
        </div>
        <div class="linha-acoes">
          <button class="nga-botao" id="nova">Nova credencial</button>
          <button class="nga-botao nga-botao--fantasma" id="voltar">Voltar</button>
        </div>

        ${novoToken ? `
          <div class="nga-card aviso-ia">
            <span class="nga-selo nga-selo--dev">copie agora</span>
            <h4>${esc(novoToken.nome)}</h4>
            <blockquote class="trecho">${esc(novoToken.token)}</blockquote>
            <p class="pendencia">${esc(novoToken.aviso)}</p>
          </div>` : ''}

        <section class="ambiente">
          <header><h3>Credenciais</h3>
            <small>o token fica só em hash; credencial nunca usada é credencial a revogar</small>
          </header>
          ${integracoes.length === 0 ? '<p class="pendencia">Nenhuma credencial criada.</p>'
            : `<table class="nga-tabela">
                <thead><tr><th>Nome</th><th>Aplicação</th><th>Escopos</th>
                  <th>Entregas</th><th>Último uso</th><th></th></tr></thead>
                <tbody>${integracoes.map((i) => `<tr>
                  <td>${esc(i.nome)}
                    ${i.ativa ? '' : '<span class="nga-selo">revogada</span>'}</td>
                  <td>${esc(ROTULO_DA_APLICACAO[i.aplicacao] ?? i.aplicacao)}</td>
                  <td class="nga-dado">${i.escopos.map(esc).join(', ')}</td>
                  <td class="nga-dado">${i.usos}</td>
                  <td class="nga-dado">${i.ultimo_uso_em
                    ? new Date(i.ultimo_uso_em).toLocaleString('pt-BR')
                    : '<span class="nga-selo nga-selo--dev">nunca usada</span>'}</td>
                  <td>${i.ativa
                    ? `<button class="nga-botao nga-botao--fantasma" data-revogar="${i.id}">Revogar</button>`
                    : ''}</td>
                </tr>`).join('')}</tbody></table>`}
        </section>

        <section class="ambiente">
          <header><h3>O contrato</h3>
            <small>o que cada aplicação entrega, e por onde</small></header>
          ${contrato.entradas.map((e) => `
            <div class="nga-card doc">
              <div class="doc-cabeca">
                <div>
                  <h4>${esc(e.aplicacao)}</h4>
                  <small class="nga-dado">${esc(e.rota)}</small>
                </div>
                <span class="nga-selo nga-selo--info">${esc(e.escopo)}</span>
              </div>
              <p class="achado-descricao">${esc(e.descricao)}</p>
              <p class="nga-dado">Idempotência: ${esc(e.idempotencia)}</p>
            </div>`).join('')}
          <p class="nga-nota">${esc(contrato.naoExercitado)}</p>
        </section>
      </main>
    </div>`;

  raiz.querySelector('#sair')?.addEventListener('click', sair);
  raiz.querySelector('#voltar')?.addEventListener('click', () => {
    estado.vista = 'central'; render();
  });
  raiz.querySelector('#nova')?.addEventListener('click', criarIntegracao);
  for (const b of raiz.querySelectorAll('[data-revogar]')) {
    b.addEventListener('click', async () => {
      if (!confirm('Revogar esta credencial? A aplicação para de entregar na hora.')) return;
      try {
        await api(`/api/integracoes/${b.dataset.revogar}`, { method: 'DELETE' });
        await abrirIntegracoes();
      } catch (e) { alert(e.message); }
    });
  }
}

async function criarIntegracao() {
  const apps = ['sentinela', 'integra', 'prazos', 'outra'];
  const escolha = prompt(
    `Aplicação:\n${apps.map((a, i) => `${i + 1}. ${ROTULO_DA_APLICACAO[a]}`).join('\n')}\n\nNúmero:`, '1');
  const aplicacao = apps[Number(escolha) - 1];
  if (!aplicacao) return;
  const nome = prompt('Nome da credencial:', ROTULO_DA_APLICACAO[aplicacao]);
  if (!nome) return;
  const sugestao = { sentinela: 'processos', integra: 'documentos', prazos: 'prazos', outra: '' };
  const escopos = (prompt(
    'Escopos separados por vírgula (processos, prazos, documentos):',
    sugestao[aplicacao]) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (escopos.length === 0) { alert('Informe ao menos um escopo.'); return; }

  try {
    const novo = await api('/api/integracoes', {
      method: 'POST', body: JSON.stringify({ nome, aplicacao, escopos }),
    });
    await abrirIntegracoes();
    // O token aparece uma vez: a tela guarda em memória só até o próximo render.
    estado.integracoes.novoToken = novo;
    render();
  } catch (e) { alert(e.message); }
}

function render() {
  if (estado.carregando) return telaCarregando();
  if (!estado.eu) return telaEntrada();
  if (estado.vista === 'portal') return telaPortal();
  if (estado.vista === 'analise') return telaAnalise();
  if (estado.vista === 'analise-detalhe') return telaAnaliseDetalhe();
  if (estado.vista === 'projeto') return telaProjeto();
  if (estado.vista === 'integracoes') return telaIntegracoes();
  if (estado.vista === 'relatorios') return telaRelatorios();
  if (estado.vista === 'processos') return telaProcessos();
  if (estado.vista === 'processo') return telaProcesso();
  if (estado.vista === 'projetos') return telaProjetos();
  return telaCentral();
}

// Entrada: tenta a sessão do cookie; cai na tela de login se não houver.
carregarSessao();
