/**
 * Fatura no modelo do escritório: o Word preenchido tem de pôr cada valor na célula certa, e a réplica
 * HTML (tela e PDF) tem de usar as medidas e as fontes do modelo.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
// @ts-expect-error módulo do navegador, em JS puro
import { cssDaFatura, folhaDaFatura, gerarWord, htmlDaFatura, LAYOUT, preencherDocumento, trocarTexto } from '../web/js/fatura_modelo.js';

const WEB = join(import.meta.dir, '../web');
const F = {
  numero: 'FAT-2026-00001', arquivo: 'Fatura Novembro - INDÚSTRIA', cidadeData: 'Curitiba, 03 de novembro de 2026.',
  cliente: 'INDÚSTRIA DEMONSTRAÇÃO LTDA.', cnpj: 'CNPJ 11.222.333/0001-80',
  itens: [{ descricao: 'Honorários mensais — outubro', vencimento: '09/11/2026', valor: 'R$ 12.500,00' }], total: 'R$ 12.500,00',
};

/** Gera o Word pelo mesmo caminho do navegador e devolve o document.xml do modelo real. */
async function xmlDoModelo() {
  const original = globalThis.fetch;
  let xml = '';
  globalThis.fetch = (async (u: string) => new Response(Bun.file(WEB + u))) as typeof fetch;
  try {
    const blob = await gerarWord({ ...F, cidadeData: 'Curitiba, 05 de novembro de 2026.' } as never);
    expect(blob.size).toBeGreaterThan(1_000_000);
  } finally { globalThis.fetch = original; }
  // Lê o document.xml direto do zip do modelo (o mesmo que o navegador abre).
  const buf = new Uint8Array(await Bun.file(join(WEB, 'img/fatura/modelo.docx')).arrayBuffer());
  const v = new DataView(buf.buffer);
  let eocd = buf.length - 22; while (v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  let p = v.getUint32(eocd + 16, true);
  for (let i = 0; i < v.getUint16(eocd + 10, true); i++) {
    const nl = v.getUint16(p + 28, true); const nome = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
    if (nome === 'word/document.xml') {
      const loc = v.getUint32(p + 42, true); const comp = v.getUint32(p + 20, true);
      const ini = loc + 30 + v.getUint16(loc + 26, true) + v.getUint16(loc + 28, true);
      xml = new TextDecoder().decode(Bun.inflateSync(buf.subarray(ini, ini + comp)));
    }
    p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return xml;
}

const celulas = (xml: string) => {
  const ini = xml.indexOf('<w:tblStyle w:val="Tabelacomgrade"/>'); const tab = xml.slice(ini, xml.indexOf('</w:tbl>', ini));
  return [...tab.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''));
};

describe('Word: modelo preenchido', () => {
  test('cada valor fica na sua célula (o valor do item não invade o vencimento)', async () => {
    const xml = preencherDocumento(await xmlDoModelo(), F);
    expect(celulas(xml)).toEqual(['DESCRIÇÃO', 'VENC.', 'VALOR', 'Honorários mensais — outubro', '09/11/2026', 'R$ 12.500,00', '', 'TOTAL', 'R$ 12.500,00']);
    expect(xml).toContain('INDÚSTRIA DEMONSTRAÇÃO LTDA.');
    expect(xml).toContain('Curitiba, 03 de novembro de 2026.');
    expect(xml).not.toContain('DEVILLE');
    // Dados bancários do escritório ficam intactos.
    expect(xml).toContain('CNPJ </w:t>');
    expect(xml).toContain('07.045.249/0001-62');
  });

  test('não casa a partir de peças vazias nem atravessa parágrafo', () => {
    const xml = '<w:p><w:r><w:t>09/11/2026</w:t></w:r><w:r><w:t></w:t></w:r></w:p><w:p><w:r><w:t>R$ </w:t></w:r><w:r><w:t>7.294,50</w:t></w:r></w:p>';
    const r = trocarTexto(xml, 'R$ 7.294,50', 'R$ 1,00');
    expect(r.trocas).toBe(1);
    expect(r.xml).toContain('<w:p><w:r><w:t xml:space="preserve">R$ 1,00</w:t>');
    expect(trocarTexto('<w:p><w:t>R$ </w:t></w:p><w:p><w:t>7.294,50</w:t></w:p>', 'R$ 7.294,50', 'x').trocas).toBe(0);
  });
});

describe('réplica HTML (tela e PDF)', () => {
  const html = htmlDaFatura(F, 'https://lab.exemplo');

  test('A4 sem margem, uma folha, fontes do próprio modelo', () => {
    expect(html).toContain('@page{size:210mm 297mm;margin:0}');
    expect(html.match(/class="fx-pg"/g)).toHaveLength(1);
    for (const f of ['Lato-Regular.ttf', 'Lato-Bold.ttf', 'InterTight-Bold.ttf']) {
      expect(html).toContain(`https://lab.exemplo/img/fatura/fontes/${f}`);
      expect(Bun.file(join(WEB, 'img/fatura/fontes', f)).size).toBeGreaterThan(100_000);
    }
    expect(cssDaFatura('x')).toContain('font-kerning:none');
  });

  test('posições do modelo: caixas, tabela e dados bancários', () => {
    expect(html).toContain(`left:${LAYOUT.cliente.caixa[0]}mm;top:${LAYOUT.cliente.caixa[1]}mm;width:185.085mm;height:23mm`);
    expect(html).toContain(`left:${LAYOUT.tabela.x}mm;top:${LAYOUT.tabela.y}mm`);
    expect(html).toContain(`top:${LAYOUT.banco.caixa[1]}mm`);
    // Tudo cabe na folha: a caixa do banco termina antes do rodapé do papel timbrado (~272 mm).
    expect(LAYOUT.banco.caixa[1] + LAYOUT.banco.caixa[3]).toBeLessThan(270);
  });

  test('textos do modelo e escape dos dados do cliente', () => {
    const f = folhaDaFatura({ ...F, cliente: 'A <b>&</b> B' }, '');
    expect(f).toContain('FATURA – PRESTAÇÃO DE SERVIÇOS');
    expect(f).toContain('A &lt;b&gt;&amp;&lt;/b&gt; B');
    expect(f).toContain('<b>Banco Itaú – 341 </b>| Ag 3835 | C/C 54.188-3');
    expect(f).toContain('PIX: 07045249000162');
    expect(f).toContain('<td><span><b>Honorários mensais — outubro</b></span></td><td><span>09/11/2026</span></td><td><span>R$ 12.500,00</span></td>');
  });

  test('sem CNPJ, a linha some', () => {
    expect(folhaDaFatura({ ...F, cnpj: '' }, '')).not.toContain('<br></div>');
  });
});
