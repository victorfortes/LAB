/** NGA Sentinela: novas ações contra clientes, com prova de cobertura e conferência humana. */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { $, $$, dataBR, dataHoraBR, html, icone, ouvir, relativo } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, toast, vazio } from '../ui.js';
import { ir, navegar } from '../shell.js';
import { lerPlanilha } from '../planilha.js';

const CLASSE = { confirmada: ['ok', 'Confirmada'], provavel: ['aviso', 'Provável'], inconclusiva: ['info', 'Inconclusiva'], descartada: ['', 'Descartada'] };
const ROT = { nova_distribuicao: 'Nova distribuição', processo_antigo: 'Processo antigo', indeterminada: 'Data indeterminada', automatico: 'Automático', pendente: 'Pendente', em_verificacao: 'Em verificação', confirmado_manual: 'Confirmado manualmente', descartado_manual: 'Descartado manualmente', descartado_auto: 'Descartado (auto)', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const TOM_PRIO = { alta: 'erro', media: 'aviso', baixa: '' };
const SAUDE = { operacional: 'ok', degradado: 'aviso', indisponivel: 'erro' };
const ABAS = [['confiabilidade', 'Confiabilidade'], ['painel', 'Painel'], ['clientes', 'Clientes'], ['processos', 'Processos'], ['cobertura', 'Cobertura'], ['validacao', 'Validação'], ['fontes', 'Fontes'], ['alertas', 'Alertas'], ['config', 'Configurações']];
const COB = { coberto: 'Lido e conferido', provisorio: 'Lido, ainda sendo relido', em_curso: 'Dia em curso', lacuna: 'Não lido (lacuna)', incompleto: 'Lido incompleto', sem_historico: 'Fora do histórico buscado' };
const CTRL = { capturado: ['Capturado', 'ok'], canario_ok: ['Canário conferido', 'ok'], recuperado: ['Falha nossa, recuperado agora', 'erro'], revisar: ['Revisar nomes', 'aviso'], invisivel_no_djen: ['Invisível no DJEN', 'info'], anterior_ao_historico: ['Anterior ao histórico (incluído)', 'info'], fora_da_fonte: ['Fora da fonte', 'info'], erro: ['Erro ao verificar', 'erro'] };
const cnj = (n) => (n?.length === 20 ? `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16)}` : n);
const fmtCnpj = (d) => (d?.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d ?? '');
const selo = (v, tom = '') => html`<span class="selo ${tom}">${ROT[v] ?? v ?? '—'}</span>`;
const seloClasse = (c) => { const [t, r] = CLASSE[c] ?? ['', c]; return html`<span class="selo ${t}">${r}</span>`; };
const seloPrio = (p) => (p ? html`<span class="selo ${TOM_PRIO[p]}">${ROT[p]}</span>` : '');
const lista = (s) => (s ?? '').split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
const escreve = () => pode('processo.escrever');
const card = (titulo, corpo, sub = '', acoes = '') => html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">${titulo}</h2>${sub ? html`<p class="card__sub">${sub}</p>` : ''}</div>${acoes}</header>${corpo}</section>`;
const dl = (pares) => html`<dl class="sent-dl">${pares.map(([k, v]) => html`<dt>${k}</dt><dd>${v === null || v === undefined || v === '' ? '—' : v}</dd>`)}</dl>`;

function moldura(ativa, resumo, acoes, corpo) {
  return html`${cabecalho({ titulo: 'NGA Sentinela', sub: 'Novas ações contra clientes, no DJEN e no DataJud. Roda na nuvem, todo dia.', resumo, acoes })}
    <nav class="pilulas mt" aria-label="Seções do Sentinela">${ABAS.filter(([k]) => k !== 'config' || pode('integracao.gerir')).map(([k, t]) => html`<button type="button" data-aba="${k}" aria-pressed="${k === ativa}">${t}</button>`)}</nav>${corpo}`;
}
const tela = (ativa, conteudo, resumo = [], acoes = '', depois) => ({ titulo: 'Sentinela', html: moldura(ativa, resumo, acoes, conteudo), depois(el) { ouvir(el, 'click', '[data-aba]', (b) => ir(`sentinela/${b.dataset.aba}`)); ouvir(el, 'click', '[data-ir]', (b, e) => { if (e?.target?.closest?.('a,button:not([data-ir])')) return; ir(b.dataset.ir); }); depois?.(el); } });
const comando = (tipo, msg) => async () => { try { const r = await api.post('/api/sentinela/pesquisa', { tipo }); toast(`${msg} (${r.consultas} consulta(s))`); navegar(); } catch (e) { erroDe(e); } };

// ---------------------------------------------------------------- painel ---
let graf = 'dias';
function grafico(d) {
  const dias = graf === 'dias';
  const serie = dias ? d.serie_dias.map((x) => ({ r: `${x.dia.slice(8)}/${x.dia.slice(5, 7)}`, n: x.n, hoje: x.dia === d.hoje })) : d.serie_meses.map((x) => ({ r: `${x.mes.slice(5)}/${x.mes.slice(2, 4)}`, n: x.n, hoje: x.mes === d.hoje.slice(0, 7) }));
  const max = Math.max(1, ...serie.map((x) => x.n)), total = serie.reduce((a, x) => a + x.n, 0);
  return html`<p class="dica">${total} ação(ões) ajuizada(s) neste período. A barra laranja é ${dias ? 'hoje' : 'o mês atual'}.</p>
    <div class="sent-barras" role="img" aria-label="Ações ajuizadas por período">${serie.map((x, i) => html`<div class="sent-col ${x.hoje ? 'agora' : ''}" title="${x.r}: ${x.n}"><span>${x.n || ''}</span><i style="height:${x.n ? Math.max(6, Math.round((100 * x.n) / max)) : 2}%"></i><small>${!dias || i % 5 === 0 || x.hoje ? x.r : ''}</small></div>`)}</div>`;
}
async function painel() {
  const d = await api.get('/api/sentinela/dashboard');
  const soma = (n) => d.serie_dias.slice(-n).reduce((a, x) => a + x.n, 0);
  const semTxt = { verde: 'Tudo certo: a rotina está ativa e as fontes respondem.', amarelo: 'Atenção: houve falhas recentes em alguma consulta. O sistema tenta de novo.', vermelho: d.rotina.ativa ? 'Problema: uma fonte está indisponível. Enquanto isso, ausência de resultado não significa ausência de ação.' : 'Problema: a rotina da nuvem não roda há mais de 5 minutos.' }[d.semaforo];
  const fazer = [];
  if (d.ajuizados_hoje.length) fazer.push(['erro', `Veja as ${d.ajuizados_hoje.length} ação(ões) ajuizada(s) hoje`, 'Abra, leia e atribua a um advogado.', 'sentinela/processos?hoje']);
  if (d.pendentes_validacao) fazer.push(['aviso', `${d.pendentes_validacao} caso(s) esperam sua conferência`, 'O sistema não teve certeza: confirme ou descarte.', 'sentinela/validacao']);
  if (d.consultas_a_reprocessar) fazer.push(['info', 'Algumas consultas falharam', 'Use “Reprocessar falhas” na aba Fontes.', 'sentinela/fontes']);
  for (const c of d.clientes_so_cnpj) fazer.push(['info', `${c.razao_social}: nome curto demais`, 'Pesquisado só pelo CNPJ. Cadastre o nome completo ou alternativos.', `sentinela/cliente/${c.id}`]);
  if (!fazer.length) fazer.push(['ok', 'Nada pendente agora', 'Quando algo precisar de atenção, aparece aqui.', '']);
  const maxC = Math.max(1, ...d.por_cliente.map((c) => c.total));
  const p = d.progresso;
  return tela('painel', html`
    <div class="sent-semaforo ${d.semaforo} mt"><i></i><span>${semTxt}</span></div>
    ${p.estado === 'executando' ? html`<div class="sent-prog mt" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100"><div><b>Pesquisando</b><span>${p.pct}% · ${p.abertas} consulta(s) na fila</span></div><i style="width:${p.pct}%"></i></div>` : ''}
    ${card(d.ajuizados_hoje.length ? `${d.ajuizados_hoje.length} ação(ões) ajuizada(s) hoje` : 'Nenhuma ação nova contra seus clientes hoje, até agora', d.ajuizados_hoje.length ? html`<ul class="lista">${d.ajuizados_hoje.map((i) => html`<li data-ir="sentinela/processo/${i.id}" style="cursor:pointer">${seloClasse(i.classificacao)}<div><b>${cnj(i.numero_processo)}</b><small>${i.cliente} · ${i.tribunal ?? ''}${i.classe ? ` · ${i.classe}` : ''}</small></div><div class="fim">${seloPrio(i.prioridade)}</div></li>`)}</ul>` : html`<p class="dica">${d.ajuizados_ontem ? `Ontem foram ${d.ajuizados_ontem}. ` : ''}Os tribunais costumam registrar uma ação horas ou dias depois do protocolo.</p>`)}
    <div class="sent-placar mt">${[['Hoje', d.ajuizados_hoje.length], ['Ontem', d.ajuizados_ontem], ['Últimos 7 dias', soma(7)], ['Últimos 30 dias', soma(30)], ['Desde sempre', d.ajuizadas_total]].map(([t, n]) => html`<article class="card glass"><span>${t}</span><strong>${n}</strong></article>`)}</div>
    ${card('Quanto foi ajuizado', html`<div data-grafico>${grafico(d)}</div>${d.sem_data_ajuizamento ? html`<p class="dica">${d.sem_data_ajuizamento} processo(s) ainda sem data de ajuizamento não entram nestes números.</p>` : ''}`, 'Data em que o processo foi protocolado no tribunal.', html`<div class="pilulas"><button type="button" data-g="dias" aria-pressed="${graf === 'dias'}">30 dias</button><button type="button" data-g="meses" aria-pressed="${graf === 'meses'}">12 meses</button></div>`)}
    <div class="grid-hub">
      ${card('Por cliente', d.por_cliente.length ? html`<ul class="lista">${d.por_cliente.map((c) => html`<li data-ir="sentinela/cliente/${c.id}" style="cursor:pointer"><div><b>${c.razao_social}</b><small>${c.ultima ? `última ação em ${dataBR(c.ultima)}` : 'nenhuma ação encontrada ainda'}</small><div class="sent-trilho"><i style="width:${Math.round((100 * c.total) / maxC)}%"></i></div></div><div class="fim"><small>${c.hoje} hoje · ${c.ult30} em 30 dias · ${c.total} no total</small></div></li>`)}</ul>` : vazio('check', 'Nenhum cliente ativo', ''))}
      ${card('O que preciso fazer', html`<ul class="lista">${fazer.map(([t, tit, sub, alvo]) => html`<li ${alvo ? html`data-ir="${alvo.replace('?hoje', '')}" style="cursor:pointer"` : ''} ${alvo.includes('?hoje') ? html`data-so-hoje` : ''}><span class="selo ${t}">${t === 'erro' ? 'Urgente' : t === 'aviso' ? 'Atenção' : t === 'ok' ? 'Em dia' : 'Info'}</span><div><b>${tit}</b><small>${sub}</small></div></li>`)}</ul>`)}
    </div>
    <details class="card glass up mt sent-det"><summary>Detalhes técnicos</summary>
      <p class="dica">Rotina: ${d.rotina.ultima ? `última execução ${relativo(d.rotina.ultima)}` : 'sem execução registrada'} · ${d.clientes_monitorados} cliente(s) · ${d.tribunais_com_dados} tribunal(is) com dados · ${d.falhas_consultas_24h} falha(s) em 24 h · ${d.novas_acoes_confirmadas} nova(s) ação(ões) confirmada(s) · ${d.alertas_nao_lidos} alerta(s) não lido(s)</p>
      <div class="sent-cad">${d.cadencia.map((x) => html`<div class="${x.resultado}" title="${dataBR(x.dia)}: ${x.consultas} consulta(s)"><b>${x.resultado === 'sucesso' ? '✓' : x.resultado === 'sem_execucao' ? '–' : '!'}</b>${x.dia.slice(8)}/${x.dia.slice(5, 7)}</div>`)}</div>
    </details>`,
  [{ rotulo: 'Para conferir', valor: d.pendentes_validacao, tom: d.pendentes_validacao ? 'warn' : '' }, { rotulo: 'Hoje', valor: d.ajuizados_hoje.length, tom: d.ajuizados_hoje.length ? 'alert' : '' }, { rotulo: 'Em 30 dias', valor: soma(30) }, { rotulo: 'Clientes', valor: d.clientes_monitorados }],
  escreve() ? html`<button class="btn btn--accent" data-rodar>Executar pesquisa agora</button>` : '',
  (el) => {
    ouvir(el, 'click', '[data-rodar]', comando('executar', 'Pesquisa enfileirada'));
    ouvir(el, 'click', '[data-so-hoje]', () => { filtros.ajuizado_hoje = '1'; });
    ouvir(el, 'click', '[data-g]', (b) => { graf = b.dataset.g; $$('[data-g]', el).forEach((x) => x.setAttribute('aria-pressed', x === b)); $('[data-grafico]', el).innerHTML = String(grafico(d)); });
    if (p.estado === 'executando') { clearTimeout(tempo); tempo = setTimeout(() => { if (location.hash === '#/sentinela' || location.hash === '#/sentinela/painel') { api.limparCache?.(); navegar(); } }, 15000); }
  });
}
let tempo;

// -------------------------------------------------------------- clientes ---
const camposCliente = [{ nome: 'razaoSocial', rotulo: 'Razão social', obrigatorio: true }, { nome: 'cnpj', rotulo: 'CNPJ da matriz', obrigatorio: true, metade: true }, { nome: 'nomeFantasia', rotulo: 'Nome fantasia', metade: true }, { nome: 'filiais', rotulo: 'CNPJs de filiais (separe por ;)' }, { nome: 'anteriores', rotulo: 'Denominações anteriores (separe por ;)' }, { nome: 'alternativos', rotulo: 'Nomes alternativos (separe por ;)' }, { nome: 'grupoEconomico', rotulo: 'Grupo econômico', metade: true }, { nome: 'advogadoResponsavel', rotulo: 'Advogado responsável', metade: true }, { nome: 'equipe', rotulo: 'Equipe', metade: true }, { nome: 'frequenciaHoras', rotulo: 'Frequência (horas)', tipo: 'number', valor: 24, metade: true }];
async function clientes() {
  const cs = await api.get('/api/sentinela/clientes');
  return tela('clientes', card(`${cs.length} cliente(s)`, cs.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Razão social</th><th>CNPJ matriz</th><th class="num">CNPJs</th><th>Responsável</th><th>Monitoramento</th><th class="num">Processos</th><th class="num">A conferir</th><th>Última verificação</th></tr></thead><tbody>${cs.map((c) => html`<tr data-ir="sentinela/cliente/${c.id}" style="cursor:pointer"><td>${c.razao_social}</td><td>${fmtCnpj(c.cnpj_matriz)}</td><td class="num">${c.qtd_cnpjs}</td><td>${c.advogado_responsavel ?? '—'}</td><td><span class="selo ${c.ativo ? 'ok' : 'aviso'}">${c.ativo ? 'Ativo' : 'Pausado'}</span></td><td class="num">${c.processos}</td><td class="num">${c.pendentes}</td><td>${c.ultima_verificacao ? dataHoraBR(c.ultima_verificacao) : '—'}</td></tr>`)}</tbody></table></div>` : vazio('check', 'Nenhum cliente monitorado', ''), 'Planilha: colunas razao_social, cnpj_matriz, nome_fantasia, filiais, anteriores, alternativos (listas com ;), grupo_economico, advogado_responsavel, equipe.'), [], escreve() ? html`<button class="btn btn--accent" data-novo>${icone('plus')}Novo cliente</button><label class="btn btn--ghost">Importar CSV/Excel<input type="file" accept=".csv,.xlsx" data-imp hidden></label>` : '', (el) => {
    ouvir(el, 'click', '[data-novo]', () => formulario({ titulo: 'Monitorar cliente', rotulo: 'Monitorar', largo: true, campos: camposCliente, async enviar(v) { const r = await api.post('/api/sentinela/clientes', { ...v, filiais: lista(v.filiais), anteriores: lista(v.anteriores), alternativos: lista(v.alternativos), frequenciaHoras: Math.max(24, v.frequenciaHoras ?? 24) }); toast(`Cliente incluído. Busca retroativa com ${r.consultas} consulta(s) na fila.`); return r; } }).then((ok) => ok && navegar()));
    $('[data-imp]', el)?.addEventListener('change', async (e) => { try { const linhas = await lerPlanilha(e.target.files[0]); const r = await api.post('/api/sentinela/clientes/importar', { linhas }); toast(`Importados: ${r.importados}. Erros: ${r.erros.length}${r.erros[0] ? ` (linha ${r.erros[0].linha}: ${r.erros[0].erro})` : ''}`, r.erros.length ? 'aviso' : 'ok', 9000); navegar(); } catch (x) { erroDe(x); } });
  });
}
async function cliente(id) {
  const [c, p] = await Promise.all([api.get(`/api/sentinela/clientes/${id}`), api.get(`/api/sentinela/processos?cliente_id=${id}&limite=50`)]);
  return tela('clientes', html`${card(c.razao_social, dl([['CNPJs', html`${c.cnpjs.map((x) => html`${fmtCnpj(x.cnpj)} <small class="muted">(${x.tipo})</small><br>`)}`], ['Nomes monitorados', html`${c.nomes.map((x) => html`${x.nome} <small class="muted">(${x.tipo})</small><br>`)}`], ['Grupo econômico', c.grupo_economico], ['Responsável / equipe', `${c.advogado_responsavel ?? '—'} / ${c.equipe ?? '—'}`], ['Tribunais prioritários', (c.tribunais_prioritarios ?? []).join(', ')], ['Frequência', `a cada ${c.frequencia_horas} h`], ['Confirma por nome exato', c.confirmar_por_nome_exato ? 'Sim' : 'Não'], ['Última verificação', c.ultima_verificacao ? dataHoraBR(c.ultima_verificacao) : null]]), `${c.ativo ? 'Monitoramento ativo' : 'Monitoramento pausado'}`, escreve() ? html`<div class="flex"><button class="btn btn--ghost" data-pausa>${c.ativo ? 'Pausar' : 'Reativar'}</button><button class="btn btn--accent" data-edita>Editar</button></div>` : '')}
    ${card(`Histórico de processos (${p.total})`, tabela(p.itens))}`, [], '', (el) => {
    ouvir(el, 'click', '[data-pausa]', async () => { try { await api.put(`/api/sentinela/clientes/${id}`, { ativo: !c.ativo }); navegar(); } catch (e) { erroDe(e); } });
    ouvir(el, 'click', '[data-edita]', () => formulario({ titulo: 'Configurar monitoramento', largo: true, campos: [{ nome: 'frequenciaHoras', rotulo: 'Frequência (horas, mínimo 24)', tipo: 'number', valor: c.frequencia_horas, metade: true }, { nome: 'advogadoResponsavel', rotulo: 'Advogado responsável', valor: c.advogado_responsavel ?? '', metade: true }, { nome: 'tribunais', rotulo: 'Tribunais prioritários (;)', valor: (c.tribunais_prioritarios ?? []).join(';') }, { nome: 'fil', rotulo: 'Adicionar filiais (CNPJs ;)' }, { nome: 'ant', rotulo: 'Adicionar denominações anteriores (;)' }, { nome: 'alt', rotulo: 'Adicionar nomes alternativos (;)' }, { nome: 'cne', rotulo: 'Confirmar automaticamente por nome idêntico no polo passivo (só para nomes distintivos)', tipo: 'select', valor: c.confirmar_por_nome_exato ? 'sim' : 'nao', opcoes: [{ v: 'nao', t: 'Não' }, { v: 'sim', t: 'Sim' }] }], async enviar(v) { const r = await api.put(`/api/sentinela/clientes/${id}`, { frequenciaHoras: v.frequenciaHoras, advogadoResponsavel: v.advogadoResponsavel ?? '', tribunais: lista(v.tribunais), confirmarPorNomeExato: v.cne === 'sim', adicionarFiliais: lista(v.fil), adicionarAnteriores: lista(v.ant), adicionarAlternativos: lista(v.alt) }); toast(r.consultas ? `Salvo. Busca retroativa com ${r.consultas} consulta(s).` : 'Salvo'); return r; } }).then((ok) => ok && navegar()));
  });
}

// ------------------------------------------------------------- processos ---
function tabela(itens) {
  if (!itens.length) return vazio('check', 'Nenhum processo para os filtros', '');
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Processo</th><th>Cliente</th><th>Tribunal</th><th>Classe</th><th>Distribuição</th><th>Identificado</th><th>Situação</th><th>Prioridade</th><th>Responsável</th></tr></thead><tbody>${itens.map((i) => html`<tr data-ir="sentinela/processo/${i.id}" style="cursor:pointer"><td class="mono-sm">${cnj(i.numero_processo)}</td><td>${i.cliente}</td><td>${i.tribunal ?? '—'}</td><td>${i.classe ?? '—'}</td><td>${i.dias_ajuiz === 0 ? html`<span class="selo erro">Ajuizado hoje</span><br>` : i.dias_ajuiz === 1 ? html`<span class="selo aviso">Ontem</span><br>` : ''}${i.data_ajuizamento ? dataBR(i.data_ajuizamento) : '—'}<br><small class="muted">${ROT[i.categoria_data] ?? ''}</small></td><td>${dataBR(i.identificada_em)}</td><td>${seloClasse(i.classificacao)}<br><small class="muted">${ROT[i.estado_validacao] ?? i.estado_validacao}</small></td><td>${seloPrio(i.prioridade) || '—'}</td><td>${i.responsavel ?? '—'}</td></tr>`)}</tbody></table></div>`;
}
const filtros = { cliente_id: '', classificacao: '', categoria: '', tribunal: '', classe: '', de: '', ate: '', valor_min: '', valor_max: '', prioridade: '', responsavel_id: '', ajuizado_hoje: '', pagina: 1 };
const sel = (n, ops, v) => html`<label class="field"><span>${n[1]}</span><select class="select" name="${n[0]}"><option value="">Todos</option>${ops.map(([a, b]) => html`<option value="${a}" ${String(v) === String(a) ? 'selected' : ''}>${b}</option>`)}</select></label>`;
const ent = (n, t, tipo = 'text') => html`<label class="field"><span>${t}</span><input class="input" type="${tipo}" name="${n}" value="${filtros[n]}"></label>`;
async function processos() {
  const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v !== '' && v != null));
  const [cs, us, r] = await Promise.all([api.get('/api/sentinela/clientes'), api.get('/api/sentinela/equipe'), api.get(`/api/sentinela/processos?${qs}&limite=50`)]);
  return tela('processos', html`<form class="card glass up mt sent-filtros" data-ff>${sel(['cliente_id', 'Cliente'], cs.map((c) => [c.id, c.razao_social]), filtros.cliente_id)}${sel(['classificacao', 'Situação'], Object.entries(CLASSE).map(([k, v]) => [k, v[1]]), filtros.classificacao)}${sel(['categoria', 'Distribuição'], [['nova_distribuicao', 'Nova distribuição'], ['processo_antigo', 'Processo antigo'], ['indeterminada', 'Indeterminada']], filtros.categoria)}${ent('tribunal', 'Tribunal')}${ent('classe', 'Classe')}${ent('de', 'Identificado de', 'date')}${ent('ate', 'até', 'date')}${ent('valor_min', 'Valor mín.', 'number')}${ent('valor_max', 'Valor máx.', 'number')}${sel(['prioridade', 'Risco'], [['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']], filtros.prioridade)}${sel(['responsavel_id', 'Responsável'], us.map((u) => [u.id, u.nome]), filtros.responsavel_id)}<label class="field sent-chk"><input type="checkbox" name="ajuizado_hoje" value="1" ${filtros.ajuizado_hoje ? 'checked' : ''}><span>Só ajuizados hoje</span></label><div class="flex"><button class="btn btn--accent">Filtrar</button><button type="button" class="btn btn--ghost" data-limpar>Limpar</button></div></form>
    ${card(`${r.total} resultado(s)`, html`${tabela(r.itens)}<div class="flex mt"><button class="btn btn--ghost" data-pag="-1" ${filtros.pagina <= 1 ? 'disabled' : ''}>Anterior</button><span class="dica">Página ${filtros.pagina}</span><button class="btn btn--ghost" data-pag="1" ${filtros.pagina * 50 >= r.total ? 'disabled' : ''}>Próxima</button></div>`)}`, [], '', (el) => {
    $('[data-ff]', el).addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(e.target); for (const k of Object.keys(filtros)) if (k !== 'pagina') filtros[k] = f.get(k) ?? ''; filtros.pagina = 1; navegar(); });
    ouvir(el, 'click', '[data-limpar]', () => { for (const k of Object.keys(filtros)) filtros[k] = ''; filtros.pagina = 1; navegar(); });
    ouvir(el, 'click', '[data-pag]', (b) => { filtros.pagina += Number(b.dataset.pag); navegar(); });
  });
}
const ORIGEM = { fonte: ['ok', 'fonte'], inferencia: ['aviso', 'inferência'], nao_verificado: ['', 'não verificado'] };
function campoAnalise(a, k, rot) {
  const c = a.campos?.[k]; if (!c) return [rot, null];
  const v = Array.isArray(c.valor) ? c.valor.join('; ') : c.valor === true ? 'Sim' : c.valor === false ? 'Não' : c.valor;
  const txt = v === null || v === undefined || v === '' ? 'não disponível' : k === 'valor_causa' ? Number(c.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : v;
  const [t, r] = ORIGEM[c.origem] ?? ['', c.origem]; return [rot, html`${txt} <span class="selo ${t}" title="${c.nota ?? ''}">${r}</span>`];
}
async function processo(id) {
  const [d, us] = await Promise.all([api.get(`/api/sentinela/processos/${id}`), api.get('/api/sentinela/equipe')]);
  const a = d.analise, ev = d.evidencia ?? {}; const pendente = ['pendente', 'em_verificacao'].includes(d.estado_validacao);
  return tela('processos', html`
    ${card(cnj(d.numero_processo), dl([['Cliente', `${d.cliente} · ${fmtCnpj(d.cnpj_matriz)}`], ['Tribunal', d.tribunal], ['Órgão julgador', d.orgao], ['Classe', d.classe], ['Assuntos', d.assuntos.join('; ')], ['Sistema / grau', `${d.sistema ?? '—'} / ${d.grau ?? '—'}`], ['Data de ajuizamento', d.data_ajuizamento ? `${dataBR(d.data_ajuizamento)} (DataJud: ${d.datajud_status})` : `DataJud: ${d.datajud_status}`], ['Identificado em', dataHoraBR(d.primeira_identificacao)], ['Responsável', d.responsavel]]), html`${seloClasse(d.classificacao)} ${selo(d.categoria_data)} ${selo(d.estado_validacao)} ${seloPrio(d.prioridade)}`,
      escreve() ? html`<div class="flex"><select class="select" data-resp aria-label="Responsável"><option value="">Sem responsável</option>${us.map((u) => html`<option value="${u.id}" ${u.id === d.responsavel_id ? 'selected' : ''}>${u.nome}</option>`)}</select><button class="btn btn--ghost" data-atr>Atribuir</button><button class="btn btn--ghost" data-ana>Gerar análise</button></div>` : '')}
    ${card('Identificação do cliente e fundamento', html`${dl([['Critério', `Nível ${d.nivel}: ${ev.regra ?? ''}`], ['Posição processual', d.polo === 'P' ? 'Polo passivo (réu)' : d.polo === 'A' ? 'Polo ativo (autor)' : 'Não determinada'], ['Nome na fonte', d.nome_na_fonte], ['Similaridade', ev.similaridade], ['CNPJ no texto da fonte', ev.cnpj_no_texto ? fmtCnpj(ev.cnpj_no_texto) : 'não encontrado'], ['Fontes', d.fontes.map((f) => `${f.fonte} (${f.usada_para})`).join('; ')]])}${pendente && escreve() ? html`<div class="flex mt"><button class="btn btn--accent" data-dec="confirmada">Confirmar ação contra o cliente</button><button class="btn btn--ghost" data-dec="descartada">Descartar</button></div>` : ''}`)}
    ${card('Análise jurídica', a ? html`<p>${a.resumo}</p>${dl([campoAnalise(a, 'classe', 'Classe'), campoAnalise(a, 'assunto', 'Assunto'), campoAnalise(a, 'autor', 'Autor'), campoAnalise(a, 'reu', 'Réu'), campoAnalise(a, 'valor_causa', 'Valor da causa'), campoAnalise(a, 'tutela_provisoria', 'Tutela provisória'), ['Urgência aparente', a.urgencia_aparente ? 'Sim' : 'Não'], ['Análise imediata', a.requer_analise_imediata ? 'Recomendada' : 'Não indicada'], ['Motivos da prioridade', (a.campos._motivos_prioridade?.valor ?? []).join('; ') || 'nenhum critério atingido']])}<p class="dica">Gerada em ${dataHoraBR(a.gerada_em)} por ${a.modelo}. A petição inicial não está disponível nas fontes públicas.</p>` : html`<p class="dica">Análise ainda não gerada.</p>`)}
    ${card(`Comunicações coletadas (${d.comunicacoes.length})`, d.comunicacoes.length ? html`${d.comunicacoes.map((c) => html`<article class="sent-com"><div class="flex"><b>${c.tipo ?? 'Comunicação'}</b><small class="muted">${c.data_disponibilizacao ? dataBR(c.data_disponibilizacao) : ''} · ${c.tribunal ?? ''} · ${c.orgao ?? ''}</small>${c.link ? html`<a class="link" href="${c.link}" target="_blank" rel="noopener noreferrer">consulta oficial ↗</a>` : ''}</div><small class="muted">${(c.destinatarios ?? []).map((x) => `${x.polo === 'P' ? 'Passivo' : 'Ativo'}: ${x.nome}`).join(' · ')}</small><p class="obs">${c.texto ?? ''}</p></article>`)}` : html`<p class="dica">Nenhuma comunicação guardada.</p>`, 'Guardamos o início de cada texto. A íntegra fica na consulta oficial.')}
    ${card('Histórico', html`<ul class="lista">${d.validacoes.map((v) => html`<li><div><b>${v.usuario}: ${v.decisao}</b><small>${dataHoraBR(v.decidida_em)} · era ${v.classificacao_anterior ?? '—'} ${v.justificativa ? `· ${v.justificativa}` : ''}</small></div></li>`)}${d.alertas.map((v) => html`<li><div><b>Alerta ${v.tipo}</b><small>${dataHoraBR(v.criado_em)} · ${v.canal} · ${v.status}</small></div></li>`)}</ul>${d.validacoes.length + d.alertas.length ? '' : html`<p class="dica">Sem decisões manuais.</p>`}`)}`, [], '', (el) => {
    ouvir(el, 'click', '[data-atr]', async () => { try { await api.post(`/api/sentinela/processos/${id}/atribuir`, { usuarioId: $('[data-resp]', el).value || null }); toast('Responsável atualizado'); navegar(); } catch (e) { erroDe(e); } });
    ouvir(el, 'click', '[data-ana]', async () => { try { await api.post(`/api/sentinela/processos/${id}/analisar`); toast('Análise gerada'); navegar(); } catch (e) { erroDe(e); } });
    ouvir(el, 'click', '[data-dec]', (b) => formulario({ titulo: b.dataset.dec === 'confirmada' ? 'Confirmar ação' : 'Descartar', subtitulo: 'A decisão fica na auditoria.', campos: [{ nome: 'justificativa', rotulo: 'Justificativa', tipo: 'textarea' }], async enviar(v) { return api.post(`/api/sentinela/achados/${id}/decisao`, { decisao: b.dataset.dec, justificativa: v.justificativa }); } }).then((ok) => ok && navegar()));
  });
}

// ------------------------------------------------------------- validação ---
async function validacao() {
  const d = await api.get('/api/sentinela');
  return tela('validacao', card(`${d.resumo.pendentes} correspondência(s) aguardando conferência`, d.itens.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr>${escreve() ? html`<th><span class="sr-only">Selecionar</span></th>` : ''}<th>Processo</th><th>Cliente</th><th>Nome na fonte</th><th>Critério</th><th>Distribuição</th><th></th></tr></thead><tbody>${d.itens.map((i) => html`<tr>${escreve() ? html`<td><input type="checkbox" data-sel value="${i.id}" aria-label="Selecionar ${cnj(i.numero_processo)}"></td>` : ''}<td class="mono-sm">${cnj(i.numero_processo)}<br><small class="muted">${i.tribunal ?? ''}</small></td><td>${i.cliente}</td><td>${i.nome_na_fonte ?? '—'}<br><small class="muted">${i.polo === 'P' ? 'polo passivo' : i.polo === 'A' ? 'polo ativo' : 'polo desconhecido'}</small></td><td>${seloClasse(i.classificacao)}<br><small class="muted">nível ${i.nivel}: ${i.regra ?? ''}</small></td><td>${i.data_ajuizamento ? dataBR(i.data_ajuizamento) : '—'}<br><small class="muted">${ROT[i.categoria_data] ?? ''}</small></td><td><button class="btn btn--ghost" data-ir="sentinela/processo/${i.id}">Abrir</button></td></tr>`)}</tbody></table></div>` : vazio('check', 'Nada para conferir', ''), 'Só correspondências confirmadas geram alerta definitivo de nova ação. Decisões em lote exigem justificativa e ficam na auditoria.', escreve() && d.itens.length ? html`<div class="flex"><button class="btn btn--accent" data-lote="confirmada">Confirmar selecionadas</button><button class="btn btn--ghost" data-lote="descartada">Descartar selecionadas</button></div>` : ''), [{ rotulo: 'Para conferir', valor: d.resumo.pendentes, tom: d.resumo.pendentes ? 'warn' : '' }, { rotulo: 'Confirmadas', valor: d.resumo.confirmadas }, { rotulo: 'Novas distribuições', valor: d.resumo.novas }, { rotulo: 'Descartadas', valor: d.resumo.descartadas }], '', (el) => {
    ouvir(el, 'click', '[data-lote]', (b) => { const ids = $$('[data-sel]:checked', el).map((x) => x.value); if (!ids.length) return toast('Selecione ao menos uma.', 'aviso'); formulario({ titulo: `${b.dataset.lote === 'confirmada' ? 'Confirmar' : 'Descartar'} ${ids.length} correspondência(s)`, campos: [{ nome: 'justificativa', rotulo: 'Justificativa', tipo: 'textarea', obrigatorio: true }], async enviar(v) { const r = await api.post('/api/sentinela/achados/lote', { ids, decisao: b.dataset.lote, justificativa: v.justificativa }); toast(`${r.decididas} decisão(ões) registrada(s)`); return r; } }).then((ok) => ok && navegar()); });
  });
}

// ------------------------------------------------------------- cobertura ---
async function cobertura() {
  const d = await api.get('/api/sentinela/cobertura?dias=45'); const t = d.total, ctl = d.controle, n = (k) => ctl.filter((x) => x.resultado === k).length;
  const baseR = n('capturado') + n('recuperado'), recall = baseR ? Math.round((1000 * n('capturado')) / baseR) / 10 : null, vis = baseR + n('anterior_ao_historico'), totV = vis + n('revisar') + n('invisivel_no_djen'), visib = totV ? Math.round((1000 * vis) / totV) / 10 : null;
  const nome = (id) => d.clientes.find((c) => c.cliente_id === id)?.cliente ?? id;
  return tela('cobertura', html`<div class="sent-semaforo ${d.integra ? 'verde' : 'vermelho'} mt"><i></i><span>${d.integra ? 'Nenhuma lacuna: todos os dias de todos os clientes foram lidos por completo.' : `${t.lacuna + t.incompleto} dia(s) de cliente sem leitura completa. Use “Preencher lacunas” para refazer.`}</span></div>
    ${card('Dia a dia por cliente', html`<div class="sent-leg">${Object.entries(COB).filter(([k]) => k !== 'em_curso').map(([k, v]) => html`<span><i class="${k}"></i>${v}</span>`)}</div>${d.clientes.map((c) => html`<div class="sent-cob"><div><b>${c.cliente}</b><small>${c.pct_coberto === null ? 'sem histórico ainda' : `${c.pct_coberto}% dos dias já conferidos`} · ${c.consultas.length} consulta(s)</small></div><div class="sent-tira">${c.dias.map((x) => html`<i class="${x.status}" title="${dataBR(x.dia)}: ${COB[x.status]}"></i>`)}</div></div>`)}<p class="dica">Esquerda é o mais antigo, direita é hoje. Cada pesquisa relê os últimos ${d.rescan_dias} dias, porque o DJEN às vezes publica com atraso.</p>`, 'O que não está provado como lido aparece como lacuna.')}
    ${d.lacunas.length ? card('Lacunas abertas', html`<ul class="lista">${d.lacunas.slice(0, 60).map((g) => html`<li><div><b>${nome(g.cliente_id)}</b><small>${g.chave}</small></div><div class="fim"><small>${dataBR(g.ini)} a ${dataBR(g.fim)}</small></div></li>`)}</ul>`) : ''}
    ${card('Teste de captura (processos-controle)', html`<div class="sent-placar"><article class="card glass"><span>Captura do que o DJEN mostra</span><strong>${recall === null ? '—' : `${recall}%`}</strong><small>${n('capturado')} de ${baseR}</small></article><article class="card glass"><span>Visibilidade no DJEN</span><strong>${visib === null ? '—' : `${visib}%`}</strong><small>${vis} de ${totV}</small></article></div>
      ${ctl.length ? html`<div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Cliente</th><th>Processo</th><th>Resultado</th><th>Detalhe</th>${escreve() ? html`<th></th>` : ''}</tr></thead><tbody>${ctl.map((x) => { const [r, tom] = x.verificar ? ['Na fila', 'info'] : CTRL[x.resultado] ?? ['Ainda não verificado', 'info']; return html`<tr><td>${x.cliente}</td><td class="mono-sm">${cnj(x.numero_processo)}</td><td><span class="selo ${tom}">${r}</span></td><td><small>${x.detalhe ?? ''}${x.verificado_em ? ` · ${dataHoraBR(x.verificado_em)}` : ''}</small></td>${escreve() ? html`<td><button class="btn btn--ghost" data-del="${x.id}">Remover</button></td>` : ''}</tr>`; })}</tbody></table></div>` : ''}
      ${escreve() && d.clientes.length ? html`<div class="flex mt"><select class="select" data-ccli aria-label="Cliente">${d.clientes.map((c) => html`<option value="${c.cliente_id}">${c.cliente}</option>`)}</select><input class="input" data-cnum placeholder="0000000-00.0000.0.00.0000" aria-label="Número do processo"><button class="btn btn--accent" data-cadd>Adicionar</button><button class="btn btn--ghost" data-cver>Verificar agora</button></div>` : ''}`, 'Cadastre processos que vocês sabem que existem contra o cliente. O sistema confere se foram capturados e, se não foram, inclui e mostra como falha.')}
    ${card('O que isto garante, e o que não garante', html`<p class="dica"><b>Garante:</b> que cada dia foi lido por inteiro para cada nome e CNPJ, que dias não lidos aparecem como lacuna, e que publicações tardias são pegas na releitura.</p><p class="dica"><b>Não garante:</b> processo sem nenhuma comunicação no DJEN, tribunais ou processos que não alimentam o DJEN (segredo de justiça, alguns sistemas) e cliente com nome muito curto, pesquisado só por CNPJ. Os cadernos completos do CNJ, de centenas de MB por dia, não cabem na função da nuvem.</p>`)}`,
  [{ rotulo: 'Conferidos', valor: t.coberto }, { rotulo: 'Sendo relidos', valor: t.provisorio + t.em_curso }, { rotulo: 'Lacunas', valor: t.lacuna, tom: t.lacuna ? 'alert' : 'ok' }, { rotulo: 'Incompletos', valor: t.incompleto, tom: t.incompleto ? 'alert' : '' }], escreve() ? html`<button class="btn btn--accent" data-lac>Preencher lacunas agora</button>` : '', (el) => {
    ouvir(el, 'click', '[data-lac]', comando('preencher_lacunas', 'Lacunas enfileiradas'));
    ouvir(el, 'click', '[data-cadd]', async () => { try { await api.post('/api/sentinela/controle', { clienteId: $('[data-ccli]', el).value, numeroProcesso: $('[data-cnum]', el).value }); navegar(); } catch (e) { erroDe(e); } });
    ouvir(el, 'click', '[data-cver]', async () => { try { const r = await api.post('/api/sentinela/controle/verificar'); toast(`${r.enfileirados} processo(s) na fila de verificação`); navegar(); } catch (e) { erroDe(e); } });
    ouvir(el, 'click', '[data-del]', async (b) => { if (await confirmar('Remover processo-controle', 'Ele deixa de contar no teste de captura.', { rotulo: 'Remover', perigo: true })) { try { await api.del(`/api/sentinela/controle/${b.dataset.del}`); navegar(); } catch (e) { erroDe(e); } } });
  });
}

// ---------------------------------------------------- fontes e operação ---
async function fontes() {
  const f = await api.get('/api/sentinela/fontes'); const c = f.consultas_7d ?? {};
  return tela('fontes', html`<div class="grid-hub mt">${['djen', 'datajud'].map((n) => { const s = f.saude.find((x) => x.fonte === n); return html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">${n.toUpperCase()}</h2></div><span class="selo ${SAUDE[s?.estado] ?? 'aviso'}">${s?.estado ?? 'sem dados'}</span></header><p class="dica">Último sucesso: ${s?.ultimo_sucesso ? dataHoraBR(s.ultimo_sucesso) : '—'}<br>Última falha: ${s?.ultima_falha ? dataHoraBR(s.ultima_falha) : '—'}${s?.ultimo_erro && s.estado !== 'operacional' ? ` (${s.ultimo_erro})` : ''}<br>Falhas consecutivas: ${s?.falhas_consecutivas ?? 0}</p></section>`; })}</div>
    <p class="dica mt">Consultas em 7 dias: ${c.ok ?? 0} ok · ${c.falhas ?? 0} falhas · ${c.truncadas ?? 0} truncadas. Última rotina: ${f.rotina ? relativo(f.rotina.criado_em) : '—'}.</p>
    ${card('Matriz de cobertura', html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fonte</th><th>Estado</th><th>CNPJ</th><th>Nome</th><th>Partes</th><th>Distribuição</th><th>Auth</th><th>Restrições</th></tr></thead><tbody>${f.matriz.map((m) => html`<tr><td><b>${m.fonte}</b><br><small class="muted">${m.sistema}</small></td><td>${m.estado}</td><td>${m.cnpj}</td><td>${m.nome}</td><td>${m.partes}</td><td>${m.distribuicao}</td><td>${m.auth}</td><td><small>${m.restricoes}</small></td></tr>`)}</tbody></table></div>`)}
    ${card('Execuções por dia', f.execucoes.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Dia</th><th class="num">Consultas</th><th class="num">Concluídas</th><th class="num">Falhas</th><th class="num">Na fila</th><th class="num">Comunicações lidas</th></tr></thead><tbody>${f.execucoes.map((e) => html`<tr><td>${dataBR(e.dia)}</td><td class="num">${e.consultas}</td><td class="num">${e.concluidas}</td><td class="num">${e.falhas}</td><td class="num">${e.abertas}</td><td class="num">${e.lidos}</td></tr>`)}</tbody></table></div>` : html`<p class="dica">Sem execuções.</p>`)}`, [], escreve() ? html`<button class="btn btn--ghost" data-rep>Reprocessar falhas</button>` : '', (el) => ouvir(el, 'click', '[data-rep]', comando('reprocessar_falhas', 'Falhas devolvidas à fila')));
}
const ROT_ALERTA = { nova_acao_confirmada: 'Nova ação confirmada', conferencia_pendente: 'Conferência pendente', falha_consulta: 'Falha de consulta' };
async function alertas() {
  const al = await api.get('/api/sentinela/alertas');
  return tela('alertas', card('Alertas', al.length ? html`<ul class="lista">${al.map((a) => html`<li><span class="selo ${a.tipo === 'nova_acao_confirmada' ? 'erro' : 'aviso'}">${ROT_ALERTA[a.tipo] ?? a.tipo}</span><div ${a.achado_id ? html`data-ir="sentinela/processo/${a.achado_id}" style="cursor:pointer"` : ''}><b>${a.payload?.cliente ?? ''}</b><small>${cnj(a.payload?.numero_processo) ?? ''} · ${dataHoraBR(a.criado_em)}</small></div><div class="fim">${a.lido ? html`<small class="muted">lido</small>` : html`<button class="btn btn--ghost" data-lido="${a.id}">Marcar como lido</button>`}</div></li>`)}</ul>` : vazio('check', 'Nenhum alerta gerado', ''), 'Na nuvem os alertas ficam nesta tela.'), [], '', (el) => ouvir(el, 'click', '[data-lido]', async (b) => { try { await api.post(`/api/sentinela/alertas/${b.dataset.lido}/lido`); navegar(); } catch (e) { erroDe(e); } }));
}
async function config() {
  const c = await api.get('/api/sentinela/config'); const bloco = (k, t, dica) => card(t, html`<label class="field"><span>Valores (JSON)</span><textarea class="input" rows="10" data-cfg="${k}" spellcheck="false">${JSON.stringify(c[k], null, 2)}</textarea></label><button class="btn btn--accent mt" data-salva="${k}">Salvar</button>`, dica);
  return tela('config', html`${bloco('prioridade', 'Critérios de prioridade', 'Termos e classes que elevam a prioridade e faixas de valor da causa.')}${bloco('motor', 'Motor', 'Janela (dias) para considerar uma distribuição como nova e dias da busca retroativa de cliente novo.')}<p class="dica mt">Usuários, permissões e auditoria são os do próprio NGA LAB, em Equipe.</p>`, [], '', (el) => ouvir(el, 'click', '[data-salva]', async (b) => { try { await api.put(`/api/sentinela/config/${b.dataset.salva}`, JSON.parse($(`[data-cfg=${b.dataset.salva}]`, el).value)); toast('Salvo'); } catch (e) { erroDe(e); } }));
}

// ------------------------------------------------------------ confiabilidade ---
async function confiabilidade() {
  const c = await api.get('/api/sentinela/confiabilidade');
  const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  const tom = (v) => (v === null ? '' : v >= 95 ? 'ok' : v >= 80 ? 'aviso' : 'erro');
  const pilar = (rot, v, sub) => html`<div class="kpi card glass conf-pilar ${tom(v)}"><small>${rot}</small><b>${pct(v)}</b><small>${sub}</small></div>`;
  const foraBase = c.novas.filter((n) => !n.naBase);
  const corpo = html`<section class="card glass up mt conf-hero"><div class="conf-nota ${tom(c.nota)}"><b>${c.nota ?? '—'}</b><small>de 100</small></div>
      <div><h2 class="card__title">Quanto dá para confiar hoje</h2><p>${c.nota === null ? 'Ainda sem dados: cadastre os clientes da carteira.' : c.nota >= 95 ? 'Monitoramento completo: todos os clientes com CNPJ foram lidos nos últimos dias, sem lacuna.' : 'Há pontos abaixo que reduzem a confiança. Resolva-os na ordem em que aparecem.'}</p>
        ${escreve() ? html`<div class="nx-acts"><button class="btn btn--accent" data-carteira>${icone('users')}Cadastrar todos os clientes da carteira</button><button class="btn btn--ghost" data-lacunas>${icone('refresh')}Reler lacunas</button></div>` : ''}</div></section>
    <div class="kpis mt">${pilar('Clientes da carteira monitorados', c.pctClientes, `${c.carteira.empresas} empresa(s) · ${c.carteira.sem_cnpj} sem CNPJ · ${c.carteira.fora} fora do Sentinela`)}
      ${pilar('Dias lidos sem lacuna (30 dias)', c.pctCobertura, `${c.lacunas} lacuna(s) aberta(s)`)}
      ${pilar('Clientes verificados nas últimas 36 h', c.pctEmDia, `${c.clientes.em_dia} de ${c.clientes.ativos} ativo(s)`)}
      <div class="kpi card glass ${foraBase.length ? 'alerta' : ''}"><small>Ações novas fora da base (30 dias)</small><b>${foraBase.length}</b><small>encontradas e ainda não cadastradas no LAB nem no Astrea</small></div></div>
    ${card('Fontes', c.fontes.length ? html`<ul class="lista">${c.fontes.map((f) => html`<li><span class="selo ${SAUDE[f.estado] ?? ''}">${f.estado}</span><div><b>${f.fonte.toUpperCase()}</b><small>último sucesso ${f.ultimo_sucesso ? relativo(f.ultimo_sucesso) : 'nunca'}${f.falhas_consecutivas ? ` · ${f.falhas_consecutivas} falha(s) seguida(s)` : ''}</small></div></li>`)}</ul>` : html`<p class="dica">Nenhuma rodada registrada ainda. A primeira acontece no minuto seguinte ao cadastro dos clientes.</p>`)}
    ${card('Ações novas encontradas × base do escritório', c.novas.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Processo</th><th>Cliente</th><th>Classe</th><th>Ajuizada</th><th>Na base?</th></tr></thead><tbody>${c.novas.map((n) => html`<tr><td class="mono-sm">${cnj(n.numero)}</td><td>${n.cliente}</td><td>${n.classe ?? '—'}<small>${n.tribunal ?? ''}</small></td><td>${n.ajuizamento ? dataBR(n.ajuizamento) : '—'}</td><td>${n.naBase ? html`<span class="selo ok">Já cadastrada</span>` : html`<span class="selo erro">Nova: cadastrar</span>`}</td></tr>`)}</tbody></table></div>` : html`<p class="dica">Nenhuma ação confirmada ou provável nos últimos 30 dias.</p>`, 'Comparação diária do que o Sentinela achou com os processos do LAB e da carteira do Astrea.')}
    ${card('Limites das fontes públicas', html`<ul class="lista">${c.limites.map((l) => html`<li>${icone('alert')}<div><small>${l}</small></div></li>`)}</ul>`, 'O que nenhuma automação consegue garantir, para a decisão ser informada.')}`;
  return tela('confiabilidade', corpo, [{ rotulo: 'Nota', valor: c.nota ?? '—' }], '', (el) => {
    ouvir(el, 'click', '[data-lacunas]', comando('preencher_lacunas', 'Lacunas enviadas para releitura'));
    ouvir(el, 'click', '[data-carteira]', async (b) => {
      b.disabled = true; b.textContent = 'Cadastrando…';
      try {
        const r = await api.post('/api/sentinela/carteira', {});
        toast(`${r.cadastrados} cliente(s) cadastrado(s) · ${r.jaMonitorados} já monitorado(s) · ${r.semCnpj.length} sem CNPJ`);
        if (r.semCnpj.length) {
          const ok = await formulario({ titulo: `${r.semCnpj.length} cliente(s) sem CNPJ`, subtitulo: 'Informe o CNPJ para entrar no monitoramento. Deixe em branco o que não souber agora.', rotulo: 'Salvar e cadastrar', largo: true,
            campos: r.semCnpj.slice(0, 15).map((x) => ({ nome: x.empresaId, rotulo: `${x.empresa} (${x.projeto})`, placeholder: '00.000.000/0000-00' })),
            async enviar(v) { for (const [empresaId, cnpj] of Object.entries(v)) if (cnpj) await api.post('/api/sentinela/carteira/cnpj', { empresaId, cnpj }); } });
          if (ok) toast('CNPJs salvos e clientes cadastrados');
        }
        navegar();
      } catch (e) { b.disabled = false; erroDe(e); }
    });
  });
}

export default function sentinela({ aba = 'confiabilidade', id } = {}) {
  if (aba === 'cliente' && id) return cliente(id);
  if (aba === 'processo' && id) return processo(id);
  return ({ confiabilidade, painel, clientes, processos, cobertura, validacao, fontes, alertas, config }[aba] ?? painel)();
}
