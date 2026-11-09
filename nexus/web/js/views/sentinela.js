/** NGA Sentinela: novas ações contra clientes, com a conferência humana do que não está certo. */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { $, $$, dataBR, html, icone, ouvir } from '../util.js';
import { cabecalho, erroDe, formulario, toast, vazio } from '../ui.js';
import { navegar } from '../shell.js';

const CLASSE = { confirmada: ['ok', 'Confirmada'], provavel: ['aviso', 'Provável'], inconclusiva: ['info', 'Inconclusiva'], descartada: ['', 'Descartada'] };
const SAUDE = { operacional: 'ok', degradado: 'aviso', indisponivel: 'erro' };
const cnj = (n) => (n?.length === 20 ? `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16)}` : n);

export default async function sentinela() {
  let filtro = 'pendentes'; let d = await api.get(`/api/sentinela?filtro=${filtro}`); const decide = pode('processo.escrever');
  const lista = () => (d.itens.length ? html`<ul class="lista">${d.itens.map((a) => { const [t, r] = CLASSE[a.classificacao]; return html`<li><span class="selo ${t}">${r}</span><div><b>${a.cliente}</b><small class="mono-sm">${cnj(a.numero_processo)} · ${a.tribunal ?? ''}${a.categoria_data === 'nova_distribuicao' ? ' · nova distribuição' : ''}</small><small>${a.classe ?? ''}${a.orgao ? ` · ${a.orgao}` : ''}${a.data_ajuizamento ? ` · ajuizado em ${dataBR(a.data_ajuizamento)}` : ''}</small><small>${a.regra ?? ''}</small>${a.trecho ? html`<small class="obs">${a.trecho}</small>` : ''}${a.link ? html`<a class="link" href="${a.link}" target="_blank" rel="noopener">Ver comunicação</a>` : ''}</div>${filtro === 'pendentes' && decide ? html`<div class="fim flex"><button class="btn btn--accent" data-d="confirmada" data-id="${a.id}">Confirmar</button><button class="btn btn--ghost" data-d="descartada" data-id="${a.id}">Descartar</button></div>` : ''}</li>`; })}</ul>` : vazio('check', filtro === 'pendentes' ? 'Nada para conferir' : 'Nenhuma ação confirmada', ''));
  const r = d.resumo;
  return { titulo: 'Sentinela', html: html`${cabecalho({ titulo: 'NGA Sentinela', sub: 'Novas ações contra clientes, no DJEN e no DataJud. Roda na nuvem, todo dia.', resumo: [{ rotulo: 'Para conferir', valor: r.pendentes, tom: r.pendentes ? 'warn' : '' }, { rotulo: 'Confirmadas', valor: r.confirmadas }, { rotulo: 'Novas distribuições', valor: r.novas }, { rotulo: 'Descartadas', valor: r.descartadas }], acoes: pode('processo.escrever') ? html`<button class="btn btn--accent" data-novo>${icone('plus')}Monitorar cliente</button>` : '' })}
    <div class="grid-hub mt"><section class="card glass up"><header class="card__head"><div><h2 class="card__title">Correspondências</h2></div><div class="pilulas"><button type="button" data-f="pendentes" aria-pressed="true">Para conferir</button><button type="button" data-f="novas" aria-pressed="false">Confirmadas</button></div></header><div data-lista>${lista()}</div></section>
    <div style="display:grid;gap:var(--gap);align-content:start"><section class="card glass up"><header class="card__head"><div><h2 class="card__title">Fontes</h2></div></header>${d.saude.length ? html`<ul class="lista">${d.saude.map((s) => html`<li><span class="selo ${SAUDE[s.estado] ?? ''}">${s.estado}</span><div><b>${s.fonte.toUpperCase()}</b>${s.ultimo_erro && s.estado !== 'operacional' ? html`<small>${s.ultimo_erro}</small>` : ''}</div></li>`)}</ul>` : html`<p class="dica">Aguardando a primeira execução.</p>`}<p class="dica">${d.fila.map((f) => `${f.n} ${f.status}`).join(' · ') || 'Nenhuma consulta nas últimas 24 horas.'}</p></section>
    <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Clientes monitorados</h2></div></header><ul class="lista">${d.clientes.map((c) => html`<li><div><b>${c.nome_fantasia ?? c.razao_social}</b><small>${c.achados} achado(s) · ${c.pendentes} para conferir</small></div></li>`)}</ul></section></div></div>`,
    depois(el) {
      const repor = async (f) => { filtro = f; d = await api.get(`/api/sentinela?filtro=${f}`); $('[data-lista]', el).innerHTML = String(lista()); };
      ouvir(el, 'click', '[data-f]', (b) => { $$('[data-f]', el).forEach((x) => x.setAttribute('aria-pressed', x === b)); repor(b.dataset.f).catch(erroDe); });
      ouvir(el, 'click', '[data-d]', async (b) => { b.disabled = true; try { await api.post(`/api/sentinela/achados/${b.dataset.id}/decisao`, { decisao: b.dataset.d }); toast('Decisão registrada'); await repor(filtro); } catch (e) { b.disabled = false; erroDe(e); } });
      ouvir(el, 'click', '[data-novo]', () => formulario({ titulo: 'Monitorar cliente', rotulo: 'Monitorar', campos: [{ nome: 'razaoSocial', rotulo: 'Razão social', obrigatorio: true }, { nome: 'cnpj', rotulo: 'CNPJ da matriz', obrigatorio: true, metade: true }, { nome: 'nomeFantasia', rotulo: 'Nome fantasia', metade: true }], async enviar(v) { await api.post('/api/sentinela/clientes', { razaoSocial: v.razaoSocial, cnpj: v.cnpj, nomeFantasia: v.nomeFantasia || undefined }); toast('Cliente incluído no monitoramento'); } }).then((ok) => ok && navegar()));
    } };
}
