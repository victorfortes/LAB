/**
 * Paginação do diagnóstico para o PDF (A4 paisagem).
 *
 * Recebe o documento gerado por `src/server/diagnostico_html.ts` já carregado num iframe (layout real) e
 * distribui as linhas de cada seção (`.dg-linha`) em páginas `.pg` com cabeçalho e rodapé. Cada seção começa
 * numa página nova; linha que não cabe vai para a próxima; tabela maior que a página é dividida por linhas,
 * repetindo o cabeçalho. No fim, numera "n / N" e preenche o sumário. Sem dependências: o servidor também
 * injeta este arquivo no Chromium (Playwright) quando gera o PDF por lá.
 */
export function paginar(doc) {
  const fluxo = doc.querySelector('.dg-fluxo');
  if (!fluxo || doc.body.dataset.paginado) return;
  const empresa = doc.body.dataset.empresa || '';
  const rodape = doc.body.dataset.rodape || '';
  const destino = doc.createElement('div');
  fluxo.before(destino);
  const paginaDe = {};

  const el = (tag, cls, txt) => { const x = doc.createElement(tag); if (cls) x.className = cls; if (txt !== undefined) x.textContent = txt; return x; };
  function novaPagina(rotuloContinuacao) {
    const pg = el('section', 'pg');
    const cab = el('div', 'pg-cab');
    const marca = el('div', 'marca', 'NGA'); marca.append(el('i', '', 'LAB'));
    cab.append(marca, el('div', '', `Diagnóstico inicial · ${empresa}`));
    const corpo = el('div', 'pg-corpo');
    if (rotuloContinuacao) corpo.append(el('div', 'dg-cont', `${rotuloContinuacao} (continuação)`));
    const rod = el('div', 'pg-rod');
    rod.append(el('span', '', rodape), el('span', 'pg-n'));
    pg.append(cab, corpo, rod);
    destino.append(pg);
    return corpo;
  }
  const estoura = (corpo) => corpo.scrollHeight > corpo.clientHeight + 1;
  const vazia = (corpo) => [...corpo.children].every((c) => c.classList.contains('dg-cont') || c.classList.contains('dg-sec-cab'));

  /**
   * Divide uma linha que tem uma tabela: as linhas do corpo da tabela vão para cópias da linha, uma por página.
   * O título fica só no primeiro pedaço e as notas só no último; o cabeçalho da tabela se repete em todos.
   */
  function dividirTabela(linha, corpo, rotulo) {
    const tab = linha.querySelector('table.dg-tab');
    if (!tab || tab.tBodies[0].rows.length < 2) return { corpo, cabe: false };
    const restantes = [...tab.tBodies[0].rows];
    const notas = [...linha.querySelectorAll('.dg-nota')];
    const casca = (comTitulo) => {
      const l = linha.cloneNode(true);
      l.querySelector('table.dg-tab').tBodies[0].replaceChildren();
      l.querySelectorAll('.dg-nota').forEach((x) => x.remove());
      if (!comTitulo) l.querySelectorAll('.dg-t').forEach((x) => x.remove());
      corpo.append(l);
      return l.querySelector('table.dg-tab').tBodies[0];
    };
    const fresca = vazia(corpo);
    let tbody = casca(true); let primeiro = true;
    for (const tr of restantes) {
      tbody.append(tr);
      if (!estoura(corpo)) continue;
      // O primeiro pedaço numa página já ocupada precisa levar ao menos 3 linhas; senão a tabela começa na próxima.
      if (primeiro && !fresca && tbody.rows.length <= 3) { const l = tbody.closest('.dg-linha'); l.remove(); corpo = novaPagina(rotulo); corpo.append(l); primeiro = false; continue; }
      if (tbody.rows.length > 1) { tr.remove(); corpo = novaPagina(rotulo); tbody = casca(false); tbody.append(tr); }
      primeiro = false;
    }
    const lugar = tbody.closest('table').parentElement;
    for (const n of notas) { lugar.append(n); if (estoura(corpo)) { n.remove(); corpo = novaPagina(rotulo); const l = el('div', 'dg-linha'); const c = el('div', 'c12'); c.append(n); l.append(c); corpo.append(l); } }
    linha.remove();
    return { corpo, cabe: true };
  }

  for (const secao of [...fluxo.querySelectorAll('.dg-secao')]) {
    const rotulo = secao.dataset.titulo || '';
    let corpo = novaPagina('');
    paginaDe[secao.id] = destino.children.length;
    const cab = secao.querySelector('.dg-sec-cab');
    if (cab) corpo.append(cab);
    for (const linha of [...secao.children].filter((c) => c !== cab)) {
      corpo.append(linha);
      if (!estoura(corpo)) continue;
      linha.remove();
      // Tabela longa: começa nesta página e continua na próxima, em vez de deixar o resto da página vazio.
      const tab = linha.querySelector('table.dg-tab');
      if (tab && tab.tBodies[0].rows.length >= 4 && linha.querySelectorAll('table.dg-tab').length === 1) { corpo = dividirTabela(linha, corpo, rotulo).corpo; continue; }
      if (!vazia(corpo)) {
        corpo = novaPagina(rotulo);
        corpo.append(linha);
        if (!estoura(corpo)) continue;
        linha.remove();
      }
      // Não cabe nem numa página vazia: divide a tabela ou, sem tabela, reduz a linha até caber.
      const r = dividirTabela(linha, corpo, rotulo);
      if (r.cabe) { corpo = r.corpo; continue; }
      corpo.append(linha);
      const escala = Math.max(0.6, corpo.clientHeight / linha.scrollHeight);
      linha.style.zoom = String(escala);
    }
  }
  fluxo.remove();

  const paginas = [...doc.querySelectorAll('.pg')];
  const total = paginas.length;
  // A capa e o sumário vêm antes do destino: as seções começam depois deles.
  const desloc = paginas.indexOf(destino.querySelector('.pg'));
  paginas.forEach((p, i) => { const n = p.querySelector('.pg-n'); if (n) n.textContent = `${i + 1} / ${total}`; });
  for (const [id, n] of Object.entries(paginaDe)) {
    const alvo = doc.querySelector(`[data-pag="${id}"]`);
    if (alvo) alvo.textContent = String(desloc + n);
  }
  doc.body.dataset.paginado = '1';
}
