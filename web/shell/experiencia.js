/* Melhorias de entrada: preservam os valores e o motor do Artifact original. */
(function () {
  'use strict';
  var normalizar = function (s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); };
  var listaClientes = [], seletor, busca, area;
  function filtrarClientes(atual) {
    var termo = normalizar(busca.value).trim();
    var grupos = { civel: [], empresarial: [] };
    listaClientes.forEach(function (c) {
      var grupo = c.config && c.config.tipo === 'civel' ? 'civel' : 'empresarial';
      if ((!area.value || area.value === grupo) && normalizar(c.nome).includes(termo)) grupos[grupo].push(c);
    });
    seletor.replaceChildren(new Option('Avulso, sem cadastro', ''));
    var rotulos = { civel: 'Cível', empresarial: 'Empresarial' };
    var tipos = { civel: 'Cível', prejudicial: 'Pré-judicial', rj: 'RJ', re: 'RE', falencia: 'Falência' };
    Object.keys(grupos).forEach(function (chave) {
      if (!grupos[chave].length) return;
      var grupo = document.createElement('optgroup'); grupo.label = rotulos[chave];
      grupos[chave].sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); }).forEach(function (c) {
        grupo.appendChild(new Option(c.nome + ' · ' + (tipos[c.config.tipo] || c.config.tipo || rotulos[chave]), c.id));
      });
      seletor.appendChild(grupo);
    });
    // Um filtro nunca troca silenciosamente o cliente já escolhido.
    if (atual && !Array.from(seletor.options).some(function (o) { return o.value === atual; })) {
      var escolhido = listaClientes.find(function (c) { return c.id === atual; });
      if (escolhido) seletor.appendChild(new Option(escolhido.nome + ' · selecionado', escolhido.id));
    }
    seletor.value = atual || '';
    var total = grupos.civel.length + grupos.empresarial.length;
    document.getElementById('nga-clientes-contagem').textContent = total ? total + ' cliente(s) encontrado(s)' : 'Nenhum cliente encontrado';
  }
  window.NGA_FILTRAR_CLIENTES = function (lista, atual) {
    seletor = document.getElementById('astrea-cliente-select');
    if (!seletor) return;
    if (!busca) {
      var campos = document.createElement('div'); campos.className = 'nga-cliente-filtros';
      campos.innerHTML = '<label for="nga-cliente-area"><span>Área do cliente</span><select id="nga-cliente-area"><option value="">Todas as áreas</option><option value="civel">Cível</option><option value="empresarial">Empresarial</option></select></label><label for="nga-cliente-busca"><span>Buscar cliente</span><input id="nga-cliente-busca" type="search" placeholder="Nome do cliente" autocomplete="off"></label>';
      seletor.closest('.fields').before(campos);
      var contagem = document.createElement('p'); contagem.id = 'nga-clientes-contagem'; contagem.className = 'nga-clientes-contagem'; contagem.setAttribute('role', 'status');
      campos.appendChild(contagem);
      busca = document.getElementById('nga-cliente-busca'); area = document.getElementById('nga-cliente-area');
      busca.addEventListener('input', function () { filtrarClientes(seletor.value); });
      area.addEventListener('change', function () { filtrarClientes(seletor.value); });
    }
    listaClientes = lista; filtrarClientes(atual);
  };

  function limiteData(el) {
    if (!(el instanceof HTMLInputElement) || !['text', 'search', 'tel'].includes(el.type)) return 0;
    var ph = normalizar(el.placeholder).replace(/\s/g, '');
    if (ph === 'dd/mm') return 4;
    if (ph === 'dd/mm/aaaa' || ph === 'dd/mm/yyyy' || el.id === 'rv-data' || el.hasAttribute('data-marco')) return 8;
    var label = el.closest('label');
    return label && /dd\/mm\/(aaaa|yyyy)/i.test(label.textContent) ? 8 : 0;
  }
  function prepararData(el) {
    var limite = limiteData(el); if (!limite) return 0;
    el.inputMode = 'numeric'; el.maxLength = limite === 4 ? 5 : 10;
    return limite;
  }
  document.addEventListener('focusin', function (ev) { prepararData(ev.target); }, true);
  document.addEventListener('input', function (ev) {
    var el = ev.target, limite = prepararData(el); if (!limite || ev.isComposing) return;
    var pos = el.selectionStart == null ? el.value.length : el.selectionStart;
    var antes = el.value.slice(0, pos).replace(/\D/g, '').length;
    var numeros = el.value.replace(/\D/g, '').slice(0, limite);
    var valor = numeros.slice(0, 2);
    if (numeros.length > 2) valor += '/' + numeros.slice(2, 4);
    if (limite === 8 && numeros.length > 4) valor += '/' + numeros.slice(4);
    if (el.value === valor) return;
    el.value = valor;
    var cursor = antes + (antes > 2 ? 1 : 0) + (antes > 4 && limite === 8 ? 1 : 0);
    el.setSelectionRange(cursor, cursor);
  }, true); // captura antes dos listeners originais que persistem o valor.
})();