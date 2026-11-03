import { describe, expect, test } from 'bun:test';
import { ErroDeValor, formatarReais, parseReais } from '../src/domain/shared/dinheiro.ts';
import { type Lancamento, calcularIndicadores, montarFluxo } from '../src/domain/portal/fluxo.ts';

let seq = 0;
const l = (data: string, tipo: Lancamento['tipo'], situacao: Lancamento['situacao'], valor: string, categoria = 'geral'): Lancamento =>
  ({ id: `l${seq++}`, data, tipo, situacao, valor: parseReais(valor), categoria });

describe('fluxo de caixa', () => {
  test('previsto e realizado caminham separados a partir do mesmo saldo', () => {
    const f = montarFluxo(parseReais('100.000,00'), [
      l('2026-11-10', 'receita', 'realizado', '50.000,00'),
      l('2026-11-20', 'receita', 'previsto', '30.000,00'),
      l('2026-11-25', 'despesa', 'realizado', '20.000,00'),
    ], '2026-11-01', '2026-11-30', 'mensal');

    expect(f.periodos).toHaveLength(1);
    const p = f.periodos[0]!;
    // Projetado: 100 + 50 + 30 − 20 = 160
    expect(formatarReais(p.saldoProjetado)).toBe('160.000,00');
    // Realizado: 100 + 50 − 20 = 130
    expect(formatarReais(p.saldoRealizado)).toBe('130.000,00');
  });

  test('o saldo encadeia entre períodos', () => {
    const f = montarFluxo(parseReais('10.000,00'), [
      l('2026-11-15', 'receita', 'realizado', '5.000,00'),
      l('2026-12-15', 'despesa', 'realizado', '3.000,00'),
    ], '2026-11-01', '2026-12-31', 'mensal');

    expect(f.periodos).toHaveLength(2);
    expect(f.periodos[0]!.saldoProjetado).toBe(parseReais('15.000,00'));
    expect(f.periodos[1]!.saldoInicial).toBe(f.periodos[0]!.saldoProjetado);
    expect(f.saldoFinalProjetado).toBe(parseReais('12.000,00'));
  });

  test('aponta os períodos em que a projeção fica negativa', () => {
    const f = montarFluxo(parseReais('10.000,00'), [
      l('2026-11-10', 'despesa', 'previsto', '25.000,00'),
      l('2026-12-10', 'receita', 'previsto', '40.000,00'),
    ], '2026-11-01', '2026-12-31', 'mensal');

    expect(f.periodosNegativos).toEqual(['nov/2026']);
    expect(f.menorSaldoProjetado).toBe(parseReais('-15.000,00'));
    // Fecha positivo, mas passa por buraco no meio — é o alerta que importa.
    expect(f.saldoFinalProjetado).toBe(parseReais('25.000,00'));
  });

  test('granularidade mensal, semanal e diária', () => {
    const lancamentos = [l('2026-11-05', 'receita', 'realizado', '1.000,00')];
    expect(montarFluxo(0n, lancamentos, '2026-11-01', '2026-11-30', 'mensal').periodos).toHaveLength(1);
    expect(montarFluxo(0n, lancamentos, '2026-11-01', '2026-11-30', 'diaria').periodos).toHaveLength(30);
    const semanal = montarFluxo(0n, lancamentos, '2026-11-01', '2026-11-30', 'semanal');
    expect(semanal.periodos.length).toBeGreaterThanOrEqual(5);
  });

  test('o período mensal começa no dia 1º mesmo que o intervalo comece depois', () => {
    const f = montarFluxo(0n, [l('2026-11-03', 'receita', 'realizado', '100,00')],
      '2026-11-15', '2026-11-30', 'mensal');
    expect(f.periodos[0]!.inicio).toBe('2026-11-01');
    // O lançamento de 03/11 está fora do intervalo pedido, então não entra.
    expect(f.periodos[0]!.receitasRealizadas).toBe(0n);
  });

  test('lançamento fora do intervalo não entra em nenhum total', () => {
    const f = montarFluxo(0n, [
      l('2026-10-31', 'receita', 'realizado', '999,00'),
      l('2026-12-01', 'receita', 'realizado', '888,00'),
      l('2026-11-15', 'receita', 'realizado', '100,00'),
    ], '2026-11-01', '2026-11-30', 'mensal');
    expect(f.totalReceitasRealizadas).toBe(parseReais('100,00'));
  });

  test('valor negativo é recusado: o sinal vem do tipo', () => {
    expect(() => montarFluxo(0n, [{ id: 'x', data: '2026-11-01', tipo: 'despesa', situacao: 'previsto', valor: -100n, categoria: 'g' }], '2026-11-01', '2026-11-30'))
      .toThrow(/o sinal vem do tipo/);
  });

  test('intervalo invertido é recusado', () => {
    expect(() => montarFluxo(0n, [], '2026-12-01', '2026-11-01')).toThrow(ErroDeValor);
  });

  test('sem lançamentos, o saldo não se move', () => {
    const f = montarFluxo(parseReais('5.000,00'), [], '2026-11-01', '2026-11-30', 'mensal');
    expect(f.saldoFinalProjetado).toBe(parseReais('5.000,00'));
    expect(f.saldoFinalRealizado).toBe(parseReais('5.000,00'));
    expect(f.periodosNegativos).toEqual([]);
  });

  test('a soma dos períodos bate com os totais', () => {
    const lancamentos = [
      l('2026-11-05', 'receita', 'realizado', '1.234,56'),
      l('2026-11-20', 'despesa', 'previsto', '789,01'),
      l('2026-12-10', 'receita', 'previsto', '2.000,00'),
      l('2026-12-28', 'despesa', 'realizado', '450,99'),
    ];
    const f = montarFluxo(parseReais('1.000,00'), lancamentos, '2026-11-01', '2026-12-31', 'mensal');
    const soma = (campo: 'receitasPrevistas'|'receitasRealizadas'|'despesasPrevistas'|'despesasRealizadas') =>
      f.periodos.reduce((a, p) => a + p[campo], 0n);
    expect(soma('receitasRealizadas')).toBe(f.totalReceitasRealizadas);
    expect(soma('receitasPrevistas')).toBe(f.totalReceitasPrevistas);
    expect(soma('despesasRealizadas')).toBe(f.totalDespesasRealizadas);
    expect(soma('despesasPrevistas')).toBe(f.totalDespesasPrevistas);
    // E o saldo final é o inicial mais tudo.
    expect(f.saldoFinalProjetado).toBe(
      parseReais('1.000,00') + f.totalReceitasPrevistas + f.totalReceitasRealizadas
      - f.totalDespesasPrevistas - f.totalDespesasRealizadas);
  });

  test('granularidade diária em intervalo absurdo não trava', () => {
    const f = montarFluxo(0n, [], '2020-01-01', '2040-01-01', 'diaria');
    expect(f.periodos.length).toBeLessThanOrEqual(2000);
  });
});

describe('indicadores', () => {
  const hoje = '2026-11-15';
  const lancamentos = [
    l('2026-09-10', 'despesa', 'realizado', '30.000,00'),
    l('2026-10-10', 'despesa', 'realizado', '30.000,00'),
    l('2026-11-10', 'despesa', 'realizado', '30.000,00'),
    l('2026-11-05', 'despesa', 'previsto', '8.000,00'),  // vencida
    l('2026-11-28', 'despesa', 'previsto', '12.000,00'), // a vencer em 30 dias
    l('2027-05-01', 'despesa', 'previsto', '99.000,00'), // longe
  ];

  test('queima mensal e meses de caixa', () => {
    const i = calcularIndicadores(parseReais('180.000,00'), lancamentos, hoje, 3);
    expect(formatarReais(i.queimaMensal)).toBe('30.000,00');
    expect(i.mesesDeCaixa).toBe(6);
  });

  test('contas vencidas e a vencer em 30 dias', () => {
    const i = calcularIndicadores(parseReais('100.000,00'), lancamentos, hoje, 3);
    expect(formatarReais(i.contasVencidas)).toBe('8.000,00');
    expect(formatarReais(i.aVencerEm30Dias)).toBe('12.000,00');
  });

  test('sem queima, meses de caixa é indefinido e não infinito', () => {
    const i = calcularIndicadores(parseReais('100.000,00'), [], hoje, 3);
    expect(i.mesesDeCaixa).toBeNull();
  });

  test('intervalo não positivo é recusado', () => {
    expect(() => calcularIndicadores(0n, [], hoje, 0)).toThrow(ErroDeValor);
  });
});
