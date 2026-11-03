import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArmazenamentoLocal, ArquivoAusente, ArquivoCorrompido, ErroDeArmazenamento,
  chaveDoHash, hashDoConteudo,
} from '../src/store/arquivos.ts';

let raiz: string;
let armazem: ArmazenamentoLocal;
const bytes = (s: string) => new TextEncoder().encode(s);

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'nga-arq-'));
  armazem = new ArmazenamentoLocal(raiz);
  await armazem.iniciar();
});
afterAll(async () => { await rm(raiz, { recursive: true, force: true }); });

describe('endereçamento por conteúdo', () => {
  test('guarda e lê de volta exatamente os mesmos bytes', async () => {
    const conteudo = bytes('PETIÇÃO INICIAL — conteúdo com acento e ç');
    const g = await armazem.guardar(conteudo);
    expect(g.hash).toBe(hashDoConteudo(conteudo));
    expect(g.tamanho).toBe(conteudo.byteLength);
    expect(g.jaExistia).toBe(false);
    expect(await armazem.ler(g.chave)).toEqual(conteudo);
  });

  test('a chave deriva do hash, não de nada que o usuário escreva', () => {
    const h = hashDoConteudo(bytes('x'));
    expect(chaveDoHash(h)).toBe(`${h.slice(0, 2)}/${h.slice(2, 4)}/${h}`);
  });

  test('conteúdo idêntico é deduplicado', async () => {
    // A mesma certidão enviada por três credores ocupa espaço uma vez.
    const c = bytes('CERTIDÃO NEGATIVA DE DÉBITOS');
    const a = await armazem.guardar(c);
    const b = await armazem.guardar(c);
    expect(b.jaExistia).toBe(true);
    expect(b.chave).toBe(a.chave);
  });

  test('arquivo vazio e arquivo grande funcionam', async () => {
    const vazio = await armazem.guardar(new Uint8Array(0));
    expect((await armazem.ler(vazio.chave)).byteLength).toBe(0);

    const grande = new Uint8Array(3_000_000).fill(7);
    const g = await armazem.guardar(grande);
    expect((await armazem.ler(g.chave)).byteLength).toBe(3_000_000);
  });

  test('bytes binários sobrevivem sem conversão de texto', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0xff, 0xfe]);
    const g = await armazem.guardar(pdf);
    expect(await armazem.ler(g.chave)).toEqual(pdf);
  });
});

describe('travessia de diretório é inexprimível', () => {
  test('chave fora do formato é recusada antes de tocar o disco', async () => {
    for (const chave of [
      '../../etc/passwd', 'ab/cd/../../../etc/passwd', '/etc/passwd',
      'ab/cd/naoehumhash', 'ab/cd/' + 'z'.repeat(64), '', 'ab/cd',
    ]) {
      expect(armazem.ler(chave)).rejects.toThrow(ErroDeArmazenamento);
      expect(await armazem.existe(chave)).toBe(false);
    }
  });

  test('hash malformado não vira chave', () => {
    expect(() => chaveDoHash('../x')).toThrow('hash inválido');
    expect(() => chaveDoHash('ABC')).toThrow('hash inválido');
  });
});

describe('integridade na leitura', () => {
  test('conteúdo adulterado em disco faz a leitura falhar em voz alta', async () => {
    // Documento que vai a juízo não pode sair daqui corrompido em silêncio.
    const g = await armazem.guardar(bytes('balanço patrimonial de 2026'));
    await writeFile(join(raiz, g.chave), 'conteúdo trocado por fora');
    expect(armazem.ler(g.chave)).rejects.toThrow(ArquivoCorrompido);
  });

  test('hash esperado diferente do gravado também falha', async () => {
    const g = await armazem.guardar(bytes('contrato social'));
    const outro = hashDoConteudo(bytes('outra coisa'));
    expect(armazem.ler(g.chave, outro)).rejects.toThrow(ArquivoCorrompido);
  });

  test('arquivo que não existe é ausência, não corrupção', async () => {
    const chave = chaveDoHash('a'.repeat(64));
    expect(armazem.ler(chave)).rejects.toThrow(ArquivoAusente);
  });
});

describe('escrita atômica', () => {
  test('não sobra parcial depois de gravar', async () => {
    await armazem.guardar(bytes('peça qualquer'));
    expect(await readdir(join(raiz, '.parciais'))).toHaveLength(0);
  });

  test('remover apaga e a leitura passa a acusar ausência', async () => {
    const g = await armazem.guardar(bytes('documento descartável'));
    await armazem.remover(g.chave);
    expect(await armazem.existe(g.chave)).toBe(false);
    expect(armazem.ler(g.chave)).rejects.toThrow(ArquivoAusente);
  });
});
