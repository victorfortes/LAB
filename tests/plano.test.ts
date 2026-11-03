import { describe, expect, test } from 'bun:test';
import { ErroDeValor, formatarReais, parseReais, somar } from '../src/domain/shared/dinheiro.ts';
import {
  type CondicaoDePagamento, gerarCronograma, parcelasAVencer, parcelasVencidas, taxaDoPeriodo,
} from '../src/domain/insolvencia/plano.ts';

const cond = (p: Partial<CondicaoDePagamento> = {}): CondicaoDePagamento => ({
  desagio: 0, carenciaMeses: 0, parcelas: 12, periodicidade: 'mensal',
  jurosAoAno: 0, sistema: 'sem_juros', ...p,
});

describe('deságio e novação', () => {
  test('deságio de 60 % sobre 1.000.000,00', () => {
    const c = gerarCronograma(parseReais('1.000.000,00'), cond({ desagio: 0.6 }), '2026-11-01');
    expect(c.desagioAplicado).toBe(parseReais('600.000,00'));
    expect(c.valorNovado).toBe(parseReais('400.000,00'));
  });
  test('sem deságio o valor novado é o original', () => {
    const c = gerarCronograma(parseReais('1.000,00'), cond(), '2026-11-01');
    expect(c.valorNovado).toBe(parseReais('1.000,00'));
  });
});

describe('fechamento exato do saldo', () => {
  const casos: Array<[string, CondicaoDePagamento]> = [
    ['sem juros, 12x', cond({ parcelas: 12 })],
    ['sem juros, 7x valor indivisível', cond({ parcelas: 7 })],
    ['SAC 24x com juros', cond({ parcelas: 24, jurosAoAno: 0.06, sistema: 'sac' })],
    ['Price 60x com juros', cond({ parcelas: 60, jurosAoAno: 0.08, sistema: 'price' })],
    ['Price 180x longo', cond({ parcelas: 180, jurosAoAno: 0.12, sistema: 'price' })],
    ['trimestral com deságio', cond({ parcelas: 20, periodicidade: 'trimestral', desagio: 0.55, jurosAoAno: 0.04, sistema: 'price' })],
    ['anual SAC', cond({ parcelas: 10, periodicidade: 'anual', jurosAoAno: 0.05, sistema: 'sac' })],
  ];

  for (const [nome, condicao] of casos) {
    test(`${nome}: amortizações somam o valor novado e o saldo zera`, () => {
      const c = gerarCronograma(parseReais('1.234.567,89'), condicao, '2026-11-01');
      expect(c.parcelas).toHaveLength(condicao.parcelas);
      expect(c.parcelas[c.parcelas.length - 1]!.saldoFinal).toBe(0n);
      expect(somar(c.parcelas.map((p) => p.amortizacao))).toBe(c.valorNovado);
      expect(c.totalPago).toBe(c.valorNovado + c.totalJuros);
      // O saldo encadeia: o final de uma parcela é o inicial da seguinte.
      for (let k = 1; k < c.parcelas.length; k++) {
        expect(c.parcelas[k]!.saldoInicial).toBe(c.parcelas[k - 1]!.saldoFinal);
      }
    });
  }

  test('fecha para valores quebrados em qualquer número de parcelas', () => {
    for (const valor of ['0,01', '7,77', '999.999,99', '1,00']) {
      for (const n of [1, 3, 13, 37]) {
        const c = gerarCronograma(parseReais(valor), cond({ parcelas: n }), '2026-11-01');
        expect(somar(c.parcelas.map((p) => p.amortizacao))).toBe(c.valorNovado);
        expect(c.parcelas[n - 1]!.saldoFinal).toBe(0n);
      }
    }
  });
});

describe('carência e vencimentos', () => {
  test('a primeira parcela vence após a carência', () => {
    const c = gerarCronograma(parseReais('120.000,00'), cond({ carenciaMeses: 24, parcelas: 12 }), '2026-11-01');
    expect(c.primeiroVencimento).toBe('2028-12-01'); // 24 meses + 1 mês
    expect(c.ultimoVencimento).toBe('2029-11-01');
  });
  test('periodicidade trimestral espaça de 3 em 3 meses', () => {
    const c = gerarCronograma(parseReais('100.000,00'), cond({ parcelas: 4, periodicidade: 'trimestral' }), '2026-11-01');
    expect(c.parcelas.map((p) => p.vencimento)).toEqual(['2027-02-01', '2027-05-01', '2027-08-01', '2027-11-01']);
  });
  test('data-base em dia 31 satura nos meses curtos', () => {
    const c = gerarCronograma(parseReais('100,00'), cond({ parcelas: 4 }), '2026-01-31');
    expect(c.parcelas.map((p) => p.vencimento)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });
  test('capitalização na carência aumenta o valor devido', () => {
    const base = { parcelas: 12, carenciaMeses: 12, jurosAoAno: 0.12, sistema: 'sac' as const };
    const sem = gerarCronograma(parseReais('100.000,00'), cond(base), '2026-11-01');
    const com = gerarCronograma(parseReais('100.000,00'), cond({ ...base, capitalizarNaCarencia: true }), '2026-11-01');
    expect(com.totalPago).toBeGreaterThan(sem.totalPago);
    // O valor novado (pré-carência) não muda; o que cresce é o saldo amortizado.
    expect(com.valorNovado).toBe(sem.valorNovado);
    expect(somar(com.parcelas.map((p) => p.amortizacao))).toBeGreaterThan(com.valorNovado);
  });
});

describe('juros', () => {
  test('taxa nominal divide proporcionalmente; efetiva capitaliza', () => {
    expect(taxaDoPeriodo(cond({ jurosAoAno: 0.12, periodicidade: 'mensal' }))).toBeCloseTo(0.01, 12);
    expect(taxaDoPeriodo(cond({ jurosAoAno: 0.12, periodicidade: 'mensal', regimeDeJuros: 'efetiva' }))).toBeCloseTo(0.009488792934583046, 12);
    expect(taxaDoPeriodo(cond({ jurosAoAno: 0 }))).toBe(0);
  });
  test('sem juros não gera juros', () => {
    const c = gerarCronograma(parseReais('1.000,00'), cond(), '2026-11-01');
    expect(c.totalJuros).toBe(0n);
    expect(c.totalPago).toBe(c.valorNovado);
  });
  test('SAC tem parcela decrescente; Price tem parcela constante', () => {
    const sac = gerarCronograma(parseReais('120.000,00'), cond({ parcelas: 12, jurosAoAno: 0.12, sistema: 'sac' }), '2026-11-01');
    expect(sac.parcelas[0]!.valor).toBeGreaterThan(sac.parcelas[11]!.valor);
    expect(sac.parcelas[0]!.amortizacao).toBe(sac.parcelas[5]!.amortizacao);

    const price = gerarCronograma(parseReais('120.000,00'), cond({ parcelas: 12, jurosAoAno: 0.12, sistema: 'price' }), '2026-11-01');
    // Todas as parcelas iguais, exceto a última que absorve o resíduo.
    const valores = price.parcelas.slice(0, -1).map((p) => p.valor);
    expect(new Set(valores.map(String)).size).toBe(1);
    const ultima = price.parcelas[11]!.valor;
    const diff = ultima > valores[0]! ? ultima - valores[0]! : valores[0]! - ultima;
    expect(diff).toBeLessThan(100n); // menos de um real de resíduo
  });
  test('Price com juros que engolem a parcela falha em vez de inventar cronograma', () => {
    expect(() => gerarCronograma(parseReais('1.000.000,00'), cond({ parcelas: 1, jurosAoAno: 5, periodicidade: 'anual', sistema: 'price' }), '2026-11-01')).not.toThrow();
    // 300 parcelas anuais a 300 % a.a.: PMT arredondada não cobre os juros.
    expect(() => gerarCronograma(1n, cond({ parcelas: 300, jurosAoAno: 3, periodicidade: 'anual', sistema: 'price' }), '2026-11-01')).toThrow(ErroDeValor);
  });
});

describe('validação de condições', () => {
  test('rejeita parâmetros impossíveis', () => {
    expect(() => gerarCronograma(100n, cond({ parcelas: 0 }), '2026-11-01')).toThrow(ErroDeValor);
    expect(() => gerarCronograma(100n, cond({ carenciaMeses: -1 }), '2026-11-01')).toThrow(ErroDeValor);
    expect(() => gerarCronograma(100n, cond({ desagio: 1 }), '2026-11-01')).toThrow(ErroDeValor);
    expect(() => gerarCronograma(100n, cond({ desagio: -0.1 }), '2026-11-01')).toThrow(ErroDeValor);
    expect(() => gerarCronograma(100n, cond({ jurosAoAno: -0.01 }), '2026-11-01')).toThrow(ErroDeValor);
    expect(() => gerarCronograma(-1n, cond(), '2026-11-01')).toThrow(ErroDeValor);
  });
});

describe('acompanhamento de obrigações', () => {
  const c = gerarCronograma(parseReais('120.000,00'), cond({ parcelas: 12 }), '2026-11-01');

  test('parcelas vencidas e não pagas', () => {
    const vencidas = parcelasVencidas(c, new Set([1, 2]), '2027-04-15');
    expect(vencidas.map((p) => p.numero)).toEqual([3, 4, 5]);
  });
  test('parcelas a vencer na janela', () => {
    const proximas = parcelasAVencer(c, new Set(), '2027-01-15', 30);
    expect(proximas.map((p) => p.numero)).toEqual([3]);
  });
  test('parcela paga não aparece em nenhuma das duas listas', () => {
    const pagas = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(parcelasVencidas(c, pagas, '2030-01-01')).toHaveLength(0);
    expect(parcelasAVencer(c, pagas, '2026-11-01', 3650)).toHaveLength(0);
  });
});

describe('exemplo auditável de ponta a ponta', () => {
  test('crédito de 1.000.000,00, deságio 50 %, carência 12m, 60x mensais, 6 % a.a. SAC', () => {
    const c = gerarCronograma(
      parseReais('1.000.000,00'),
      cond({ desagio: 0.5, carenciaMeses: 12, parcelas: 60, periodicidade: 'mensal', jurosAoAno: 0.06, sistema: 'sac' }),
      '2026-11-01',
    );
    expect(formatarReais(c.valorNovado)).toBe('500.000,00');
    expect(c.primeiroVencimento).toBe('2027-12-01');
    expect(c.ultimoVencimento).toBe('2032-11-01');
    // SAC: amortização constante de 500.000,00 / 60.
    expect(formatarReais(c.parcelas[0]!.amortizacao)).toBe('8.333,34');
    // 1º juro: 0,5 % de 500.000,00.
    expect(formatarReais(c.parcelas[0]!.juros)).toBe('2.500,00');
    expect(c.parcelas[59]!.saldoFinal).toBe(0n);
    expect(somar(c.parcelas.map((p) => p.amortizacao))).toBe(parseReais('500.000,00'));
  });
});
