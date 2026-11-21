/**
 * Página do administrador judicial: o QGC do projeto com o lastro de cada crédito.
 * A credencial vem no fragmento da URL (#nga_aj_...), que não vai ao servidor nem a logs; ela segue em
 * cabeçalho na leitura e no corpo do POST que abre cada documento. Nada aqui alcança o resto do sistema.
 */
const t = location.hash.slice(1);
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NAT = { trabalhista: 'Trabalhista', acidente_trabalho: 'Acidente de trabalho', garantia_real: 'Garantia real', quirografario: 'Quirografário', me_epp: 'ME/EPP', subordinado: 'Subordinado', tributario: 'Tributário', proprietario_fiduciario: 'Propriedade fiduciária', arrendamento_mercantil: 'Arrendamento mercantil', reserva_dominio: 'Reserva de domínio', adiantamento_contrato_cambio: 'ACC', privilegio_especial: 'Privilégio especial', privilegio_geral: 'Privilégio geral', promitente_vendedor_irrevogavel: 'Promitente vendedor', posterior_ao_pedido: 'Posterior ao pedido' };
const CLASSE = { I: 'Classe I · Trabalhistas', II: 'Classe II · Garantia real', III: 'Classe III · Quirografários', IV: 'Classe IV · ME/EPP' };
let url = null;

async function abrir(id, nome) {
  const corpo = $('#aj-doc-corpo'); $('#aj-doc-nome').textContent = nome; corpo.innerHTML = '<p class="aj-carregando">Abrindo…</p>'; $('#aj-doc').showModal();
  try {
    const r = await fetch(`/api/aj/lastros/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t }) });
    if (!r.ok) throw new Error('Documento indisponível.');
    const blob = await r.blob(); if (url) URL.revokeObjectURL(url);
    const pdf = blob.type.includes('pdf') || /\.pdf$/i.test(nome);
    url = URL.createObjectURL(pdf ? new Blob([blob], { type: 'application/pdf' }) : blob);
    $('#aj-doc-baixar').href = url; $('#aj-doc-baixar').download = nome;
    corpo.innerHTML = pdf ? `<iframe title="${esc(nome)}" src="${url}"></iframe>` : blob.type.startsWith('image/') ? `<img alt="" src="${url}">` : '<p class="aj-carregando">Este formato não abre no navegador. Use "Baixar".</p>';
  } catch (e) { corpo.innerHTML = `<p class="aj-erro">${esc(e.message)}</p>`; }
}

async function iniciar() {
  if (!/^nga_aj_/.test(t)) { $('#aj').innerHTML = '<p class="aj-erro">Link incompleto. Peça um novo link ao escritório.</p>'; return; }
  const r = await fetch('/api/aj/qgc', { headers: { 'x-nga-aj': t } });
  if (!r.ok) { $('#aj').innerHTML = '<p class="aj-erro">Este link expirou ou foi revogado. Peça um novo ao escritório.</p>'; return; }
  const d = await r.json();
  $('#aj-quem').innerHTML = `Acesso de <b>${esc(d.destinatario)}</b>`;
  const grupos = new Map(); for (const c of d.creditos) { const k = Number(c.valorSujeito) > 0 ? (c.classe ?? '?') : 'X'; grupos.set(k, [...(grupos.get(k) ?? []), c]); }
  const ordem = ['I', 'II', 'III', 'IV', '?', 'X'].filter((k) => grupos.has(k));
  const cartao = (c) => `<article class="aj-cred" data-txt="${esc(`${c.credor} ${c.documento ?? ''}`.toLowerCase())}"><div><h3>${esc(c.credor)}</h3><small>${esc(c.documento ?? 'sem documento')} · ${esc(NAT[c.natureza] ?? c.natureza)}${c.garantia ? ` · ${esc(c.garantia)}` : ''}${c.validado ? '' : ' · classe ainda em validação'}</small></div>
    <div class="aj-val"><b>R$ ${c.valorSujeitoFormatado}</b><small>${c.valorSujeito !== c.valor ? `de R$ ${c.valorFormatado} do crédito` : 'sujeito à recuperação'}</small></div>
    <div class="aj-lastros">${c.lastros.length ? c.lastros.map((l) => `<button type="button" class="${l.situacao === 'confirmado' ? 'ok' : ''}" data-doc="${l.documentoId}" data-nome="${esc(l.nome)}">📄 ${esc(l.titulo)}</button>`).join('') : '<span class="aj-sem">Lastro ainda não juntado</span>'}</div></article>`;
  $('#aj').innerHTML = `<h1>${esc(d.projeto)}</h1><p class="aj-sub">Quadro geral de credores com o lastro de cada crédito${d.soValidado ? ' (só créditos com classe validada pela equipe)' : ''}. Clique num documento para abri-lo aqui mesmo.</p>
    <div class="aj-kpis"><div><small>Credores</small><b>${d.resumo.credores}</b></div><div><small>Valor sujeito</small><b>R$ ${d.resumo.sujeito}</b></div><div><small>Extraconcursal</small><b>R$ ${d.resumo.extraconcursal}</b></div><div><small>Com lastro</small><b>${d.resumo.comLastro} de ${d.creditos.length}</b></div>
      ${d.resumo.porClasse.map((x) => `<div><small>${esc(CLASSE[x.classe] ?? `Classe ${x.classe}`)}</small><b>R$ ${x.valor}</b></div>`).join('')}</div>
    <input class="aj-busca" type="search" placeholder="Buscar credor ou CPF/CNPJ" aria-label="Buscar credor">
    ${ordem.map((k) => `<h2 class="aj-classe">${k === 'X' ? 'Não sujeitos à recuperação' : esc(CLASSE[k] ?? 'Classe a definir')}</h2>${grupos.get(k).map(cartao).join('')}`).join('')}`;
  $('.aj-busca').addEventListener('input', (e) => { const q = e.target.value.toLowerCase().trim(); document.querySelectorAll('.aj-cred').forEach((x) => { x.hidden = q && !x.dataset.txt.includes(q); }); });
  $('#aj').addEventListener('click', (e) => { const b = e.target.closest('[data-doc]'); if (b) abrir(b.dataset.doc, b.dataset.nome); });
}
$('#aj-doc-fechar').addEventListener('click', () => $('#aj-doc').close());
iniciar().catch(() => { $('#aj').innerHTML = '<p class="aj-erro">Não foi possível carregar. Tente de novo em instantes.</p>'; });
