import { describe, expect, test } from 'bun:test';
import { cronogramaDaClasse, otimizar, projetar, simular, taxaComposta, type CaixaBase, type CondicaoPrj, type Entrada } from '../src/domain/insolvencia/prj_motor.ts';

const K: CondicaoPrj = { desagio: 0, carenciaMeses: 0, parcelas: 12, periodicidade: 'mensal', jurosAoAno: 0, correcaoAoAno: 0, sistema: 'sem_juros', modalidade: 'parcelas' };
const c = (credito: bigint, k: Partial<CondicaoPrj>) => ({ id: 'III', rotulo: 'Classe III', credito, condicao: { ...K, ...k } });
const CX: CaixaBase = { saldoInicial: 100_000_00n, inicio: '2027-01-01', receitaMensal: 1_000_000_00n, outrasEntradasMensal: 0n, despesaMensal: 800_000_00n, tributosMensal: 50_000_00n, extraconcursalMensal: 0n, investimentoMensal: 0n, crescimentoReceitaAoMes: 0 };
const E = (classes: Entrada['classes'], o: Partial<Entrada> = {}): Entrada => ({ marco: '2027-01-15', classes, caixa: CX, horizonte: 60, reservaMinima: 0n, taxaDesconto: 0, ...o });

describe('cenários do briefing, conferidos à mão (R$ 20 milhões)', () => {
  test('A: 70% de deságio, 18 de carência, 36 parcelas = R$ 6 mi, parcela de R$ 166.666,67', () => {
    const r = cronogramaDaClasse(c(20_000_000_00n, { desagio: 0.7, carenciaMeses: 18, parcelas: 36 }), '2027-01-15');
    expect(r.novado).toBe(6_000_000_00n); expect(r.total).toBe(6_000_000_00n);
    expect(r.parcelas).toHaveLength(36); expect(r.parcelas[0]!.vencimento).toBe('2028-08-15');
    expect(r.parcelas[0]!.valor).toBeGreaterThanOrEqual(166_666_66n); expect(r.parcelas[0]!.valor).toBeLessThanOrEqual(166_666_67n);
    expect(r.parcelas.at(-1)!.saldoFinal).toBe(0n);
  });
  test('B: 50%, 24, 60 parcelas = R$ 10 mi; C: 80%, 12, 24 parcelas = R$ 4 mi', () => {
    expect(cronogramaDaClasse(c(20_000_000_00n, { desagio: 0.5, carenciaMeses: 24, parcelas: 60 }), '2027-01-15').total).toBe(10_000_000_00n);
    expect(cronogramaDaClasse(c(20_000_000_00n, { desagio: 0.8, carenciaMeses: 12, parcelas: 24 }), '2027-01-15').total).toBe(4_000_000_00n);
  });
});

describe('modalidades', () => {
  test('as amortizações fecham exatamente no novado, com centavos que não dividem', () => {
    const r = cronogramaDaClasse(c(100_00n, { parcelas: 3 }), '2027-01-15');
    expect(r.parcelas.reduce((a, p) => a + p.amortizacao, 0n)).toBe(100_00n);
  });
  test('bullet: 60% no final de R$ 100 mil em 4 parcelas', () => {
    const r = cronogramaDaClasse(c(100_000_00n, { parcelas: 4, modalidade: 'bullet', bulletPercentual: 0.6 }), '2027-01-15');
    // 3 × 13.333,33 = 39.999,99: a última absorve o centavo que sobra.
    expect(r.parcelas.at(-1)!.amortizacao).toBe(60_000_01n);
    expect(r.parcelas.slice(0, 3).every((p) => p.amortizacao === 13_333_33n)).toBe(true) ;
  });
  test('bullet puro não paga nada antes da última parcela', () => {
    const r = cronogramaDaClasse(c(50_000_00n, { parcelas: 5, modalidade: 'bullet', bulletPercentual: 1 }), '2027-01-15');
    expect(r.parcelas.slice(0, 4).every((p) => p.valor === 0n)).toBe(true); expect(r.parcelas.at(-1)!.valor).toBe(50_000_00n);
  });
  test('escalonado 10/20/70 e recusa de percentuais que não somam 100%', () => {
    const r = cronogramaDaClasse(c(1_000_00n, { parcelas: 3, modalidade: 'escalonado', percentuais: [0.1, 0.2, 0.7] }), '2027-01-15');
    expect(r.parcelas.map((p) => p.amortizacao)).toEqual([100_00n, 200_00n, 700_00n]);
    expect(() => cronogramaDaClasse(c(1_000_00n, { modalidade: 'escalonado', percentuais: [0.5, 0.4] }), '2027-01-15')).toThrow('somam');
  });
  test('juros simples sobre saldo no escalonado: 12% a.a. mensal sobre R$ 1.000 = R$ 10', () => {
    const r = cronogramaDaClasse(c(1_000_00n, { parcelas: 2, modalidade: 'escalonado', percentuais: [0.5, 0.5], jurosAoAno: 0.12 }), '2027-01-15');
    expect(r.parcelas[0]!.juros).toBe(10_00n); expect(r.parcelas[1]!.juros).toBe(5_00n);
  });
  test('juros e correção compõem', () => { expect(taxaComposta(0.1, 0.05)).toBeCloseTo(0.155, 10); });
  test('correção sem juros não some: vira amortização com encargo', () => {
    const r = cronogramaDaClasse(c(12_000_00n, { parcelas: 12, correcaoAoAno: 0.12 }), '2027-01-15');
    expect(r.juros).toBeGreaterThan(0n);
  });
});

describe('caixa', () => {
  test('saldo mês a mês bate com a conta manual e sem PRJ', () => {
    const s = projetar(CX, [], 3);
    expect(s.map((m) => m.saldo)).toEqual([250_000_00n, 400_000_00n, 550_000_00n]);
  });
  test('duas classes vencendo no mesmo mês somam', () => {
    const a = cronogramaDaClasse({ ...c(120_000_00n, {}), id: 'I' }, '2027-01-15'); const b = cronogramaDaClasse({ ...c(240_000_00n, {}), id: 'III' }, '2027-01-15');
    const s = projetar(CX, [a, b], 2);
    expect(s[1]!.porClasse).toEqual({ I: 10_000_00n, III: 20_000_00n }); expect(s[1]!.prj).toBe(30_000_00n);
  });
  test('atraso de 45 dias abre um buraco único e depois normaliza', () => {
    const s = projetar(CX, [], 3, { atrasoDias: 45 });
    expect(s[0]!.entradas).toBe(0n); expect(s[1]!.entradas).toBe(500_000_00n); expect(s[2]!.entradas).toBe(1_000_000_00n);
  });
  test('simular não altera a entrada e aponta o déficit', () => {
    const e = E([c(20_000_000_00n, { desagio: 0.1, parcelas: 12 })]); const copia = JSON.stringify(e, (_k, v) => typeof v === 'bigint' ? String(v) : v);
    const r = simular(e);
    expect(JSON.stringify(e, (_k, v) => typeof v === 'bigint' ? String(v) : v)).toBe(copia);
    expect(r.indicadores.mesesDeficit.length).toBeGreaterThan(0);
    expect(r.indicadores.necessidadeFinanciamento).toBe(-r.indicadores.menorSaldo);
  });
  test('avisa quando o plano termina depois do horizonte', () => {
    expect(simular(E([c(1_000_00n, { parcelas: 24 })], { horizonte: 6 })).indicadores.parcelasForaDoHorizonte).toBe(true);
  });
  test('reproduzível: mesma entrada, mesmo resultado', () => {
    const f = () => JSON.stringify(simular(E([c(7_777_777_77n, { desagio: 0.33, jurosAoAno: 0.06, sistema: 'price', parcelas: 48 })])).serie, (_k, v) => typeof v === 'bigint' ? String(v) : v);
    expect(f()).toBe(f());
  });
});

describe('engenharia reversa', () => {
  const O = { classeId: 'III', desagio: [0.3, 0.8] as const, passoDesagio: 0.1, carencia: [12, 24] as const, passoCarencia: 12, parcelas: [24, 60] as const, passoParcelas: 12, reservaMinima: 500_000_00n };
  test('toda alternativa respeita a reserva, e a primeira é a que mais paga', () => {
    const r = otimizar(E([c(20_000_000_00n, {})], { caixa: { ...CX, saldoInicial: 1_000_000_00n } }), O);
    expect(r.alternativas.length).toBeGreaterThan(0);
    expect(r.alternativas.every((a) => a.menorSaldo >= 500_000_00n)).toBe(true);
    expect(r.alternativas[0]!.total >= r.alternativas.at(-1)!.total).toBe(true);
  });
  test('sem combinação viável, mostra as mais próximas e o que violam', () => {
    const r = otimizar(E([c(900_000_000_00n, {})], { horizonte: 36 }), { ...O, desagio: [0, 0.1], reservaMinima: 500_000_000_00n });
    expect(r.viaveis).toBe(0); expect(r.maisProximas[0]!.violacoes).toContain('reserva mínima de caixa');
  });
  test('recusa busca grande demais', () => {
    expect(() => otimizar(E([c(1n, {})]), { ...O, passoDesagio: 0.001, passoParcelas: 1 })).toThrow('combinações');
  });
});
