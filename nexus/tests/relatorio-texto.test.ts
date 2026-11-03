import { describe, expect, test } from 'bun:test';
import { codificavel, encurtar, paraWinAnsi, quebrarLinhas } from '../src/relatorio/texto.ts';

/** Medidor de largura fixa: 10 pontos por caractere, previsível no teste. */
const medidor = { widthOfTextAtSize: (t: string, tam: number) => t.length * tam };

describe('o que cabe na codificação do PDF', () => {
  test('o português inteiro passa intacto', () => {
    const texto = 'Recuperação judicial — art. 6º, § 4º; ação, ç, ã, õ, é, ü, À';
    expect(paraWinAnsi(texto)).toBe(texto);
  });

  test('aspas tipográficas e travessão são codificáveis', () => {
    expect(paraWinAnsi('“plano” – aditivo… €1')).toBe('“plano” – aditivo… €1');
    expect(codificavel('—'.codePointAt(0)!)).toBe(true);
  });

  test('nome fora do cp1252 não derruba a geração', () => {
    // Relatório que falha porque um credor se chama "Mikołaj" é defeito.
    expect(paraWinAnsi('Mikołaj Đurić')).toBe('Mikolaj Duric');
  });

  test('símbolo sem equivalente vira interrogação, não exceção', () => {
    expect(paraWinAnsi('crédito ↦ classe')).toBe('crédito ? classe');
    expect(paraWinAnsi('🙂')).toBe('?');
  });

  test('setas e comparadores viram o equivalente em ASCII', () => {
    expect(paraWinAnsi('A → B, x ≤ y, a ≠ b')).toBe('A -> B, x <= y, a != b');
  });

  test('espaço sem quebra vira espaço comum', () => {
    expect(paraWinAnsi('R$ 1.000')).toBe('R$ 1.000');
  });
});

describe('quebra de linha', () => {
  test('quebra por palavra na largura disponível', () => {
    expect(quebrarLinhas('um dois tres quatro', medidor, 1, 9))
      .toEqual(['um dois', 'tres', 'quatro']);
  });

  test('respeita quebra existente, inclusive linha vazia', () => {
    expect(quebrarLinhas('um\n\ndois', medidor, 1, 100)).toEqual(['um', '', 'dois']);
  });

  test('palavra maior que a linha é partida em vez de estourar a margem', () => {
    // Número de processo colado e URL são os casos reais disto.
    const linhas = quebrarLinhas('00012345620248160001', medidor, 1, 8);
    expect(linhas).toEqual(['00012345', '62024816', '0001']);
    for (const l of linhas) expect(l.length).toBeLessThanOrEqual(8);
  });

  test('nenhuma linha ultrapassa a largura', () => {
    const texto = 'O plano prevê deságio de 70% sobre o valor nominal dos créditos '
      + 'quirografários, com carência de 36 meses contados da homologação judicial.';
    for (const l of quebrarLinhas(texto, medidor, 1, 25)) {
      expect(l.length).toBeLessThanOrEqual(25);
    }
  });

  test('largura inválida falha em vez de girar', () => {
    expect(() => quebrarLinhas('x', medidor, 1, 0)).toThrow('positiva');
  });
});

describe('encurtar para célula de tabela', () => {
  test('o que cabe passa inteiro', () => {
    expect(encurtar('Banco X', medidor, 1, 20)).toBe('Banco X');
  });

  test('o que não cabe ganha reticências dentro do limite', () => {
    const r = encurtar('INDÚSTRIA DEMONSTRAÇÃO LTDA.', medidor, 1, 12);
    expect(r).toEndWith('...');
    expect(r.length).toBeLessThanOrEqual(12);
  });
});
