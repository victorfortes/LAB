import { describe, expect, test } from 'bun:test';
import {
  TIPOS_ACEITOS, TipoRecusado, nomeSeguro, reconhecerTipo,
} from '../src/store/tipos-de-arquivo.ts';
import { docxDeTeste, montarZip, odtDeTeste, pdfDeTeste, pngDeTeste } from './apoio/zip.ts';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('o tipo vem dos bytes, não do que o cliente declara', () => {
  test('PDF, PNG e JPEG pela assinatura', () => {
    expect(reconhecerTipo(pdfDeTeste(), 'peticao.pdf').mime).toBe('application/pdf');
    expect(reconhecerTipo(pngDeTeste(), 'print.png').mime).toBe('image/png');
    expect(reconhecerTipo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'foto.jpg').mime)
      .toBe('image/jpeg');
  });

  test('contêiner OOXML é reconhecido como ZIP real', () => {
    expect(reconhecerTipo(docxDeTeste(), 'contrato.docx').extensao).toBe('docx');
    // O conteúdo manda: pacote Word renomeado para .xlsx continua sendo Word.
    expect(reconhecerTipo(docxDeTeste(), 'planilha.xlsx').extensao).toBe('docx');
  });

  test('ODF se identifica pela entrada mimetype', () => {
    expect(reconhecerTipo(odtDeTeste(), 'parecer.odt').mime)
      .toBe('application/vnd.oasis.opendocument.text');
  });

  test('texto e CSV', () => {
    expect(reconhecerTipo(bytes('Relação de credores\nCredor;Valor\n'), 'rel.txt').extensao).toBe('txt');
    expect(reconhecerTipo(bytes('credor;valor\nX;100\n'), 'rel.csv').extensao).toBe('csv');
  });

  test('a extensão NÃO manda quando os bytes dizem outra coisa', () => {
    // Renomear HTML para .pdf é o ataque que esta linha impede: se o acervo
    // aceitasse, o escritório serviria página maliciosa do próprio domínio.
    const html = bytes('<html><script>fetch("/api/eu")</script></html>');
    expect(reconhecerTipo(html, 'inocente.pdf').mime).toStartWith('text/plain');
  });

  test('executável é recusado', () => {
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00]);
    expect(() => reconhecerTipo(elf, 'certidao.pdf')).toThrow(TipoRecusado);
    const macho = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);
    expect(() => reconhecerTipo(macho, 'doc.pdf')).toThrow(TipoRecusado);
  });

  test('ZIP comum é recusado, mesmo sendo um ZIP válido', () => {
    const zip = montarZip([{ nome: 'qualquer.txt', conteudo: 'oi' }]);
    expect(() => reconhecerTipo(zip, 'acervo.zip')).toThrow('ZIP não é aceito');
  });

  test('contêiner Office sem as partes usuais e sem extensão é recusado, não adivinhado', () => {
    expect(() => reconhecerTipo(montarZip([{ nome: '[Content_Types].xml', conteudo: 'x' }]), 'documento')).toThrow('renomeie para .docx ou .xlsx');
  });

  test('arquivo vazio é recusado', () => {
    expect(() => reconhecerTipo(new Uint8Array(0), 'vazio.pdf')).toThrow('arquivo vazio');
  });

  test('a lista de aceitos não tem duplicata de extensão', () => {
    const exts = TIPOS_ACEITOS.map((t) => t.extensao);
    expect(new Set(exts).size).toBe(exts.length);
  });
});

describe('nome do arquivo no download', () => {
  const pdf = TIPOS_ACEITOS.find((t) => t.extensao === 'pdf')!;

  test('descarta caminho embutido no nome', () => {
    expect(nomeSeguro('../../etc/passwd', pdf)).toBe('passwd.pdf');
    expect(nomeSeguro('C:\\Users\\x\\peticao.pdf', pdf)).toBe('peticao.pdf');
  });

  test('tira controles e aspas, que quebrariam o cabeçalho HTTP', () => {
    expect(nomeSeguro('pe"ti\ncao.pdf', pdf)).toBe('peticao.pdf');
  });

  test('nome vazio vira um nome utilizável', () => {
    expect(nomeSeguro('   ', pdf)).toBe('documento.pdf');
    expect(nomeSeguro('', pdf)).toBe('documento.pdf');
  });

  test('acento é preservado — é nome de documento brasileiro', () => {
    expect(nomeSeguro('petição inicial.pdf', pdf)).toBe('petição inicial.pdf');
  });

  test('nome absurdamente longo é truncado SEM perder a extensão', () => {
    const n = nomeSeguro(`${'a'.repeat(500)}.pdf`, pdf);
    expect(n.length).toBeLessThanOrEqual(120);
    expect(n).toEndWith('.pdf');
  });
});
