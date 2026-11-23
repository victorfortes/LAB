/**
 * Envio de documentos em volume (portal do cliente e escritório).
 *
 * O cliente arrasta a pasta inteira, um ZIP ou um RAR (extrato bancário costuma vir assim) e segue usando a tela:
 *  - ZIP e RAR são abertos AQUI, no navegador (inclusive um dentro do outro), e cada arquivo sobe sozinho;
 *  - cada arquivo vai direto para o Storage por um endereço assinado de uso único (não passa pela função na
 *    nuvem, que tem pouca memória e pouco tempo), três por vez, com barra de progresso;
 *  - depois o servidor confere o conteúdo pelo hash, desarma PDF com script e registra o documento.
 * Um painel no canto mostra a fila; dá para minimizar e continuar trabalhando.
 */
import { api } from './api.js';
import { html, icone } from './util.js';

const LIMITE = 50 * 1024 * 1024;
const PARALELO = 3;
const LIXO = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*|~\$[^/]*)(\/|$)/i;
const ehZip = (n) => /\.zip$/i.test(n);
const ehRar = (n) => /\.rar$/i.test(n);
const mb = (b) => `${(b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0)} MB`;

// ------------------------------------------------------------------- ZIP ---
/** Lê o diretório central e extrai entrada por entrada (Blob.slice): um ZIP de 400 MB não precisa caber na memória. */
async function abrirZip(arquivo) {
  const tam = arquivo.size; const fim = await arquivo.slice(Math.max(0, tam - 65_557)).arrayBuffer();
  const v = new DataView(fim); let e = -1;
  for (let i = fim.byteLength - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('ZIP inválido ou corrompido');
  let total = v.getUint16(e + 10, true); let cdTam = v.getUint32(e + 12, true); let cdIni = v.getUint32(e + 16, true);
  if (cdIni === 0xffffffff || total === 0xffff) { // ZIP64
    const loc = e - 20; if (loc < 0 || v.getUint32(loc, true) !== 0x07064b50) throw new Error('ZIP64 sem localizador');
    const off64 = Number(v.getBigUint64(loc + 8, true)); const r = new DataView(await arquivo.slice(off64, off64 + 56).arrayBuffer());
    total = Number(r.getBigUint64(32, true)); cdTam = Number(r.getBigUint64(40, true)); cdIni = Number(r.getBigUint64(48, true));
  }
  const cd = new DataView(await arquivo.slice(cdIni, cdIni + cdTam).arrayBuffer()); const bytesCd = new Uint8Array(cd.buffer);
  const saida = []; let p = 0;
  for (let n = 0; n < total && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const flags = cd.getUint16(p + 8, true); const metodo = cd.getUint16(p + 10, true);
    let comp = cd.getUint32(p + 20, true); let descomp = cd.getUint32(p + 24, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    let off = cd.getUint32(p + 42, true);
    const nomeB = bytesCd.subarray(p + 46, p + 46 + nl);
    let nome; try { nome = new TextDecoder('utf-8', { fatal: !(flags & 0x800) }).decode(nomeB); } catch { nome = new TextDecoder('latin1').decode(nomeB); }
    // Extra ZIP64 com tamanhos/offset de 64 bits.
    let q = p + 46 + nl; const qf = q + xl;
    while (q + 4 <= qf) { const id = cd.getUint16(q, true), sz = cd.getUint16(q + 2, true);
      if (id === 1) { let k = q + 4; if (descomp === 0xffffffff) { descomp = Number(cd.getBigUint64(k, true)); k += 8; } if (comp === 0xffffffff) { comp = Number(cd.getBigUint64(k, true)); k += 8; } if (off === 0xffffffff) off = Number(cd.getBigUint64(k, true)); }
      q += 4 + sz; }
    p += 46 + nl + xl + cl;
    if (nome.endsWith('/') || LIXO.test(nome)) continue;
    if (flags & 1) { saida.push({ nome, erro: 'arquivo com senha dentro do ZIP: envie sem senha' }); continue; }
    saida.push({ nome, tamanho: descomp, abrir: async () => {
      const lh = new DataView(await arquivo.slice(off, off + 30).arrayBuffer());
      const ini = off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const dados = arquivo.slice(ini, ini + comp);
      if (metodo === 0) return dados;
      if (metodo !== 8) throw new Error(`compressão ${metodo} não suportada`);
      return new Response(dados.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    } });
  }
  return saida;
}

// ------------------------------------------------------------------- RAR ---
let unrar;
async function abrirRar(arquivo) {
  if (arquivo.size > 300 * 1048576) throw new Error('RAR acima de 300 MB: divida em partes');
  unrar ??= Promise.all([import('./vendor/unrar.js'), fetch('/js/vendor/unrar.wasm').then((r) => r.arrayBuffer())]);
  const [mod, wasmBinary] = await unrar;
  const ex = await mod.createExtractorFromData({ wasmBinary, data: await arquivo.arrayBuffer() });
  const { files } = ex.extract();
  const saida = [];
  for (const f of files) {
    const nome = f.fileHeader.name.replace(/\\/g, '/');
    if (f.fileHeader.flags.directory || LIXO.test(nome)) continue;
    if (f.fileHeader.flags.encrypted) { saida.push({ nome, erro: 'arquivo com senha dentro do RAR: envie sem senha' }); continue; }
    const bytes = f.extraction; saida.push({ nome, tamanho: bytes.length, abrir: async () => new Blob([bytes]) });
  }
  return saida;
}

/** Abre pacotes (ZIP/RAR, inclusive aninhados) e devolve só arquivos de verdade, com o caminho de onde vieram. */
export async function expandir(arquivos, aoInformar = () => {}) {
  const saida = [];
  const visitar = async (file, caminho, nivel) => {
    if ((ehZip(file.name) || ehRar(file.name)) && nivel < 4) {
      aoInformar(`Abrindo ${file.name}…`);
      try {
        const entradas = ehZip(file.name) ? await abrirZip(file) : await abrirRar(file);
        for (const e of entradas) {
          const base = e.nome.split('/').pop(); const pasta = [caminho, file.name.replace(/\.(zip|rar)$/i, ''), ...e.nome.split('/').slice(0, -1)].filter(Boolean).join(' / ');
          if (e.erro) { saida.push({ erro: e.erro, nome: base, caminho: pasta }); continue; }
          const blob = await e.abrir();
          await visitar(new File([blob], base, { type: tipoPorNome(base) }), pasta, nivel + 1);
        }
      } catch (er) { saida.push({ erro: `não abriu o pacote: ${er.message}`, nome: file.name, caminho }); }
      return;
    }
    if (!file.size || LIXO.test(file.name)) return;
    saida.push({ file, nome: file.name, caminho });
  };
  for (const f of arquivos) await visitar(f, f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(0, -1).join(' / ') : '', 0);
  return saida;
}
const tipoPorNome = (n) => ({ pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', ofx: 'application/x-ofx', txt: 'text/plain' })[n.split('.').pop().toLowerCase()] ?? 'application/octet-stream';

async function sha256(file) {
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function xhr(metodo, url, corpo, cabecalhos, aoProgredir) {
  return new Promise((ok, falha) => {
    const x = new XMLHttpRequest(); x.open(metodo, url); x.withCredentials = url.startsWith('/');
    for (const [k, v] of Object.entries(cabecalhos ?? {})) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => e.lengthComputable && aoProgredir?.(e.loaded / e.total);
    x.onload = () => { let j = null; try { j = JSON.parse(x.responseText); } catch { /* sem corpo */ }
      x.status >= 200 && x.status < 300 ? ok(j) : falha(new Error(j?.erro ?? j?.message ?? `erro ${x.status}`)); };
    x.onerror = () => falha(new Error('falha de rede: confira a conexão')); x.ontimeout = () => falha(new Error('tempo esgotado'));
    x.timeout = 15 * 60_000; x.send(corpo);
  });
}

// ----------------------------------------------------------------- painel ---
let painel; const fila = []; let ativos = 0; let lote = null;
function garantirPainel() {
  if (painel?.isConnected) return painel;
  painel = document.createElement('aside'); painel.className = 'envio'; painel.setAttribute('role', 'status'); painel.setAttribute('aria-live', 'polite');
  painel.innerHTML = '<header class="envio__head"><div><b data-t>Enviando</b><small data-s></small></div><div><button type="button" class="ibtn ibtn--sm" data-min aria-label="Minimizar">' + icone('chevronDown') + '</button><button type="button" class="ibtn ibtn--sm" data-x aria-label="Fechar" hidden>' + icone('x') + '</button></div></header><div class="envio__barra"><i data-g></i></div><ul class="envio__lista" data-l></ul>';
  document.body.append(painel);
  painel.querySelector('[data-min]').addEventListener('click', () => painel.classList.toggle('min'));
  painel.querySelector('[data-x]').addEventListener('click', () => { painel.remove(); fila.length = 0; });
  painel.addEventListener('click', (e) => { const b = e.target.closest('[data-tentar]'); if (!b) return; const it = lote?.itens.find((x) => x.id === b.dataset.tentar); if (it) { it.estado = 'fila'; it.erro = ''; it.pct = 0; fila.push(it); pintarItem(it); bombear(); } });
  return painel;
}
function pintarItem(it) {
  const ul = garantirPainel().querySelector('[data-l]'); let li = ul.querySelector(`[data-i="${it.id}"]`);
  if (!li) { li = document.createElement('li'); li.dataset.i = it.id; ul.append(li); }
  const rot = { fila: 'na fila', preparando: 'conferindo…', enviando: `${Math.round(it.pct * 100)}%`, registrando: 'registrando…', pronto: it.nota || 'recebido', erro: it.erro }[it.estado];
  li.className = `envio__it is-${it.estado}`;
  li.innerHTML = String(html`<span class="envio__nome" title="${it.caminho ? `${it.caminho} / ` : ''}${it.nome}">${it.nome}</span><small>${it.tamanho ? mb(it.tamanho) : ''} · ${rot}</small>
    <span class="envio__mini"><i style="width:${it.estado === 'pronto' ? 100 : Math.round(it.pct * 100)}%"></i></span>${it.estado === 'erro' && it.file ? html`<button type="button" class="link" data-tentar="${it.id}">tentar de novo</button>` : ''}`);
  pintarResumo();
}
function pintarResumo() {
  if (!lote || !painel) return;
  const its = lote.itens; const ok = its.filter((x) => x.estado === 'pronto').length; const er = its.filter((x) => x.estado === 'erro').length;
  const total = its.reduce((t, x) => t + (x.tamanho || 0), 0); const feito = its.reduce((t, x) => t + (x.tamanho || 0) * (x.estado === 'pronto' ? 1 : x.pct || 0), 0);
  const acabou = ok + er === its.length;
  painel.querySelector('[data-t]').textContent = acabou ? (er ? `${ok} recebido(s), ${er} com problema` : `${ok} documento(s) recebido(s)`) : `Enviando ${its.length - ok - er} de ${its.length}`;
  painel.querySelector('[data-s]').textContent = `${mb(feito)} de ${mb(total)}${acabou ? '' : ' · pode continuar usando o sistema'}`;
  painel.querySelector('[data-g]').style.width = `${total ? Math.round((feito / total) * 100) : 100}%`;
  painel.querySelector('[data-x]').hidden = !acabou; painel.classList.toggle('feito', acabou && !er);
  if (acabou && !lote.avisado) { lote.avisado = true; lote.aoConcluir?.({ recebidos: ok, erros: er }); }
}

async function processar(it) {
  const { projetoId } = it;
  try {
    if (it.tamanho > LIMITE) throw new Error(`acima de ${mb(LIMITE)}: divida o arquivo em partes`);
    it.estado = 'preparando'; pintarItem(it);
    const hash = await sha256(it.file);
    const prep = await api.post('/api/arquivos/envio', { projetoId, tamanho: it.tamanho, hash, nome: it.nome });
    const campos = it.campos;
    it.estado = 'enviando'; pintarItem(it);
    if (prep.modo === 'storage') {
      if (!prep.jaExiste) await xhr('PUT', prep.url, it.file, { 'content-type': it.file.type || 'application/octet-stream', 'x-upsert': 'false' }, (f) => { it.pct = f * 0.97; pintarItem(it); });
      it.estado = 'registrando'; pintarItem(it);
      const r = await api.post(`/api/projetos/${projetoId}/documentos`, { hash, nome: it.nome, tamanho: it.tamanho, ...campos });
      it.nota = r?.desarmado ? 'recebido · script do PDF desativado' : '';
    } else {
      const fd = new FormData(); fd.append('arquivo', it.file, it.nome);
      for (const [k, v] of Object.entries(campos)) if (v != null) fd.append(k, v);
      const r = await xhr('POST', `/api/projetos/${projetoId}/documentos`, fd, {}, (f) => { it.pct = f * 0.97; pintarItem(it); });
      it.nota = r?.desarmado ? 'recebido · script do PDF desativado' : '';
      api.limparCache();
    }
    it.estado = 'pronto'; it.pct = 1;
  } catch (e) { it.estado = 'erro'; it.erro = e.message; }
  pintarItem(it);
}
function bombear() {
  while (ativos < PARALELO && fila.length) { const it = fila.shift(); ativos++; processar(it).finally(() => { ativos--; bombear(); }); }
}

/**
 * Envia arquivos (e o conteúdo de ZIP/RAR) ao projeto. `campos(item)` devolve título, categoria e requisitoId.
 * Não bloqueia: devolve logo; `aoConcluir` é chamado quando a fila acaba.
 */
export async function enviarDocumentos({ projetoId, arquivos, campos, aoConcluir }) {
  garantirPainel(); painel.classList.remove('min', 'feito');
  painel.querySelector('[data-t]').textContent = 'Preparando os arquivos…';
  const lista = await expandir([...arquivos], (m) => { painel.querySelector('[data-s]').textContent = m; });
  if (lote) lote.aoConcluir = aoConcluir;
  if (!lote || lote.itens.every((x) => x.estado === 'pronto' || x.estado === 'erro')) { lote = { aoConcluir, itens: [] }; painel.querySelector('[data-l]').innerHTML = ''; }
  for (const x of lista) {
    const it = { id: crypto.randomUUID(), nome: x.nome, caminho: x.caminho, file: x.file, tamanho: x.file?.size ?? 0, pct: 0, estado: x.erro ? 'erro' : 'fila', erro: x.erro ?? '' };
    it.projetoId = projetoId; it.campos = campos(it);
    lote.itens.push(it); pintarItem(it); if (!x.erro) fila.push(it);
  }
  if (!lista.length) { painel.querySelector('[data-t]').textContent = 'Nenhum arquivo para enviar'; painel.querySelector('[data-x]').hidden = false; }
  bombear();
}

/** Arquivos de um arrastar-e-soltar, entrando nas pastas (o `dataTransfer.files` comum ignora o conteúdo delas). */
export async function arquivosDoDrop(dt) {
  const itens = [...(dt.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!itens.length) return [...dt.files];
  const saida = [];
  const ler = (dir) => new Promise((ok) => { const r = dir.createReader(); const todos = []; const lote = () => r.readEntries((es) => { if (!es.length) return ok(todos); todos.push(...es); lote(); }, () => ok(todos)); lote(); });
  const visitar = async (e, caminho) => {
    if (e.isFile) { const f = await new Promise((ok, falha) => e.file(ok, falha)).catch(() => null); if (f) saida.push(caminho ? Object.defineProperty(f, 'webkitRelativePath', { value: `${caminho}/${f.name}` }) : f); return; }
    if (e.isDirectory) for (const filho of await ler(e)) await visitar(filho, caminho ? `${caminho}/${e.name}` : e.name);
  };
  for (const e of itens) await visitar(e, '');
  return saida;
}
