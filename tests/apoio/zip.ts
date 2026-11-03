/**
 * Construtor de ZIP para os testes.
 *
 * Existe porque testar o reconhecedor de tipo contra bytes inventados à mão
 * não prova nada: .docx e .odt SÃO arquivos ZIP, e o reconhecedor lê a
 * estrutura do contêiner. Aqui ele é construído de verdade — cabeçalho local,
 * diretório central e EOCD, com CRC-32 correto —, armazenado sem compressão,
 * que é como o ODF exige que a entrada `mimetype` seja gravada.
 */

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of dados) c = TABELA[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface EntradaZip { readonly nome: string; readonly conteudo: string | Uint8Array }

export function montarZip(entradas: readonly EntradaZip[]): Uint8Array {
  const codificar = new TextEncoder();
  const pedacos: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;

  for (const entrada of entradas) {
    const nome = codificar.encode(entrada.nome);
    const dados = typeof entrada.conteudo === 'string'
      ? codificar.encode(entrada.conteudo) : entrada.conteudo;
    const crc = crc32(dados);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // PK\x03\x04
    local.setUint16(4, 20, true);           // versão necessária
    local.setUint16(8, 0, true);            // método: armazenado
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nome.length, true);

    const bloco = new Uint8Array(30 + nome.length + dados.length);
    bloco.set(new Uint8Array(local.buffer), 0);
    bloco.set(nome, 30);
    bloco.set(dados, 30 + nome.length);
    pedacos.push(bloco);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); // PK\x01\x02
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(10, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, dados.length, true);
    central.setUint32(24, dados.length, true);
    central.setUint16(28, nome.length, true);
    central.setUint32(42, deslocamento, true);

    const blocoCentral = new Uint8Array(46 + nome.length);
    blocoCentral.set(new Uint8Array(central.buffer), 0);
    blocoCentral.set(nome, 46);
    centrais.push(blocoCentral);

    deslocamento += bloco.length;
  }

  const tamanhoCentral = centrais.reduce((t, c) => t + c.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);       // PK\x05\x06
  fim.setUint16(8, entradas.length, true);
  fim.setUint16(10, entradas.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true);

  const total = deslocamento + tamanhoCentral + 22;
  const saida = new Uint8Array(total);
  let posicao = 0;
  for (const p of [...pedacos, ...centrais, new Uint8Array(fim.buffer)]) {
    saida.set(p, posicao);
    posicao += p.length;
  }
  return saida;
}

/** Um .docx mínimo, mas um ZIP de verdade. */
export function docxDeTeste(): Uint8Array {
  return montarZip([
    { nome: '[Content_Types].xml', conteudo: '<?xml version="1.0"?><Types/>' },
    { nome: 'word/document.xml', conteudo: '<?xml version="1.0"?><document/>' },
  ]);
}

/** Um .odt mínimo: `mimetype` primeiro e sem compressão, como manda o formato. */
export function odtDeTeste(): Uint8Array {
  return montarZip([
    { nome: 'mimetype', conteudo: 'application/vnd.oasis.opendocument.text' },
    { nome: 'content.xml', conteudo: '<?xml version="1.0"?><document/>' },
  ]);
}

/** PNG 1×1 válido: assinatura, IHDR, IDAT e IEND com CRC correto. */
export function pngDeTeste(): Uint8Array {
  const pedaco = (tipo: string, dados: Uint8Array): Uint8Array => {
    const nome = new TextEncoder().encode(tipo);
    const corpo = new Uint8Array(nome.length + dados.length);
    corpo.set(nome, 0); corpo.set(dados, nome.length);
    const saida = new Uint8Array(12 + dados.length);
    new DataView(saida.buffer).setUint32(0, dados.length, false);
    saida.set(corpo, 4);
    new DataView(saida.buffer).setUint32(8 + dados.length, crc32(corpo), false);
    return saida;
  };

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, 1, false); v.setUint32(4, 1, false);
  ihdr[8] = 8; ihdr[9] = 0;  // 8 bits, escala de cinza

  // IDAT com um bloco zlib não comprimido, que é válido e dispensa deflate.
  const bruto = new Uint8Array([0x00, 0x00]);  // filtro 0 + um pixel
  const zlib = new Uint8Array(2 + 5 + bruto.length + 4);
  zlib[0] = 0x78; zlib[1] = 0x01;
  zlib[2] = 0x01;
  zlib[3] = bruto.length & 0xff; zlib[4] = bruto.length >> 8;
  zlib[5] = ~bruto.length & 0xff; zlib[6] = (~bruto.length >> 8) & 0xff;
  zlib.set(bruto, 7);
  let a = 1, b = 0;
  for (const x of bruto) { a = (a + x) % 65521; b = (b + a) % 65521; }
  new DataView(zlib.buffer).setUint32(7 + bruto.length, ((b << 16) | a) >>> 0, false);

  const partes = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr), pedaco('IDAT', zlib), pedaco('IEND', new Uint8Array(0)),
  ];
  const total = partes.reduce((t, p) => t + p.length, 0);
  const png = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { png.set(p, i); i += p.length; }
  return png;
}

/** PDF mínimo, estruturalmente válido. */
export function pdfDeTeste(): Uint8Array {
  return new TextEncoder().encode([
    '%PDF-1.7',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n'));
}
