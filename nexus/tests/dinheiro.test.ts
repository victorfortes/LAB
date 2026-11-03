import { describe, expect, test } from 'bun:test';
import {
  ErroDeValor, aplicarTaxa, dividirArredondando, formatarBRL, formatarReais,
  parseReais, repartir, somar,
} from '../src/domain/shared/dinheiro.ts';

describe('parseReais', () => {
  test('formato brasileiro com milhar e decimal', () => {
    expect(parseReais('1.234.567,89')).toBe(123456789n);
  });
  test('formato com ponto decimal', () => {
    expect(parseReais('1234567.89')).toBe(123456789n);
  });
  test('sem decimais', () => {
    expect(parseReais('1500')).toBe(150000n);
  });
  test('milhar sem decimal não vira centavo', () => {
    // "1.234" é mil duzentos e trinta e quatro, não um real e vinte e três.
    expect(parseReais('1.234')).toBe(123400n);
    expect(parseReais('1.234.567')).toBe(123456700n);
  });
  test('um dígito decimal é decigrama, não centavo', () => {
    expect(parseReais('10,5')).toBe(1050n);
  });
  test('aceita prefixo R$ e espaços', () => {
    expect(parseReais('R$ 2.500,00')).toBe(250000n);
  });
  test('negativo', () => {
    expect(parseReais('-1.000,50')).toBe(-100050n);
  });
  test('rejeita lixo', () => {
    expect(() => parseReais('abc')).toThrow(ErroDeValor);
    expect(() => parseReais('')).toThrow(ErroDeValor);
  });
  test('valores grandes não perdem precisão', () => {
    // 9 trilhões — além do seguro em float64 para centavos.
    expect(parseReais('9.007.199.254.740.993,01')).toBe(900719925474099301n);
  });
});

describe('formatarReais', () => {
  test('ida e volta', () => {
    for (const s of ['0,00', '1,00', '1.234.567,89', '999,99']) {
      expect(formatarReais(parseReais(s))).toBe(s);
    }
  });
  test('negativo e prefixo', () => {
    expect(formatarReais(-100050n)).toBe('-1.000,50');
    expect(formatarBRL(250000n)).toBe('R$ 2.500,00');
  });
});

describe('aplicarTaxa', () => {
  test('deságio de 60 % sobre 1.000,00', () => {
    expect(aplicarTaxa(100000n, 0.6)).toBe(60000n);
  });
  test('o clássico 0.1 + 0.2 não contamina', () => {
    // 3 × 10 % de 0,10 deve dar exatamente 0,03.
    const parcela = aplicarTaxa(10n, 0.1);
    expect(parcela * 3n).toBe(3n);
  });
  test('arredonda para o centavo mais próximo', () => {
    expect(aplicarTaxa(101n, 0.5)).toBe(51n); // 50,5 → 51
    expect(aplicarTaxa(100n, 0.005)).toBe(1n); // 0,5 → 1
  });
  test('rejeita taxa não finita', () => {
    expect(() => aplicarTaxa(100n, Number.NaN)).toThrow(ErroDeValor);
  });
});

describe('dividirArredondando', () => {
  test('half-up simétrico', () => {
    expect(dividirArredondando(5n, 2n)).toBe(3n);
    expect(dividirArredondando(-5n, 2n)).toBe(-3n);
    expect(dividirArredondando(4n, 2n)).toBe(2n);
  });
  test('divisão por zero', () => {
    expect(() => dividirArredondando(1n, 0n)).toThrow(ErroDeValor);
  });
});

describe('repartir', () => {
  test('a soma das parcelas fecha com o total', () => {
    const total = parseReais('1.000,00');
    const parcelas = repartir(total, 3);
    expect(parcelas).toEqual([33334n, 33333n, 33333n]);
    expect(somar(parcelas)).toBe(total);
  });
  test('fecha para qualquer combinação', () => {
    for (const valor of [1n, 7n, 100n, 123457n, 999999999n]) {
      for (const n of [1, 2, 3, 7, 12, 60, 180]) {
        expect(somar(repartir(valor, n))).toBe(valor);
      }
    }
  });
  test('valores negativos também fecham', () => {
    expect(somar(repartir(-100n, 3))).toBe(-100n);
  });
  test('rejeita número de parcelas inválido', () => {
    expect(() => repartir(100n, 0)).toThrow(ErroDeValor);
    expect(() => repartir(100n, 1.5)).toThrow(ErroDeValor);
  });
});
