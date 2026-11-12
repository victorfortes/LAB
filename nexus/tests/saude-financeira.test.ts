import { describe, expect, test } from 'bun:test';
import { indicadores, saude, type Fechamento } from '../src/domain/financeiro/saude.ts';

const R = (reais: number) => BigInt(Math.round(reais * 100));
const mes = (competencia: string, o: Partial<Record<string, number>>): Fechamento =>
  ({ competencia, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : R(v)])) }) as Fechamento;

describe('indicadores do mês', () => {
  test('margens, resultado e cobertura de caixa', () => {
    const x = indicadores(mes('2026-09-01', { faturamento: 1_000_000, deducoes: 100_000, custos: 450_000, folha: 200_000, despesas: 150_000, financeiras: 50_000, caixa: 425_000, receber: 300_000, pagar: 500_000, dividaBancaria: 3_000_000 }));
    expect(x.receitaLiquida).toBe(R(900_000));
    expect(x.margemBruta).toBe(50);
    expect(x.resultadoOperacional).toBe(R(100_000));
    expect(x.resultado).toBe(R(50_000));
    expect(x.pesoFinanceiro).toBe(5);
    expect(x.mesesDeCaixa).toBe(0.5);
    expect(x.liquidezCorrente).toBe(1.45);
    expect(x.dividaEmMesesDeFaturamento).toBe(3);
  });

  test('campo não informado não vira zero: o indicador fica nulo', () => {
    const x = indicadores(mes('2026-09-01', { faturamento: 100_000 }));
    expect(x.margemBruta).toBeNull();
    expect(x.resultado).toBeNull();
    expect(x.mesesDeCaixa).toBeNull();
  });
});

describe('alertas da série', () => {
  const base = { deducoes: 0, custos: 60_000, folha: 30_000, despesas: 20_000, financeiras: 5_000, receber: 50_000, pagar: 40_000 };
  test('queda de faturamento, caixa curto e três meses no vermelho', () => {
    const s = saude([
      mes('2026-07-01', { ...base, faturamento: 100_000, caixa: 200_000 }),
      mes('2026-08-01', { ...base, faturamento: 90_000, caixa: 120_000 }),
      mes('2026-09-01', { ...base, faturamento: 60_000, caixa: 40_000 }),
    ]);
    expect(s.situacao).toBe('critica');
    const textos = s.alertas.filter((a) => a.competencia === '2026-09-01').map((a) => a.texto);
    expect(textos.some((t) => t.includes('caiu 33,33%'))).toBe(true);
    expect(textos.some((t) => t.includes('três meses seguidos'))).toBe(true);
    expect(textos.some((t) => t.startsWith('Caixa cobre'))).toBe(true);
  });

  test('sem fechamento, sem situação inventada', () => {
    expect(saude([]).situacao).toBe('sem_dados');
  });

  test('aponta o que faltou preencher no último mês', () => {
    expect(saude([mes('2026-09-01', { faturamento: 1 })]).faltando).toContain('Saldo em caixa e bancos no último dia');
  });
});
