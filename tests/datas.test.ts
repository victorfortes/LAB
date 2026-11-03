import { describe, expect, test } from 'bun:test';
import { ErroDeData, comparar, diasNoMes, ehBissexto, partes, somarDias, somarMeses } from '../src/domain/shared/datas.ts';

describe('somarMeses', () => {
  test('satura no último dia do mês de destino', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2024-01-31', 1)).toBe('2024-02-29'); // bissexto
    expect(somarMeses('2026-03-31', 1)).toBe('2026-04-30');
  });
  test('vira o ano', () => {
    expect(somarMeses('2026-11-15', 2)).toBe('2027-01-15');
    expect(somarMeses('2026-01-15', -1)).toBe('2025-12-15');
    expect(somarMeses('2026-01-15', -13)).toBe('2024-12-15');
  });
  test('zero é identidade', () => {
    expect(somarMeses('2026-07-04', 0)).toBe('2026-07-04');
  });
  test('prazo longo de plano (180 meses)', () => {
    expect(somarMeses('2026-11-01', 180)).toBe('2041-11-01');
  });
});

describe('somarDias', () => {
  test('atravessa mês e ano', () => {
    expect(somarDias('2026-02-28', 1)).toBe('2026-03-01');
    expect(somarDias('2024-02-28', 1)).toBe('2024-02-29');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2027-01-01', -1)).toBe('2026-12-31');
  });
  test('stay period de 180 dias', () => {
    expect(somarDias('2026-11-01', 180)).toBe('2027-04-30');
  });
});

describe('validação', () => {
  test('rejeita formato e valores impossíveis', () => {
    expect(() => partes('01/11/2026')).toThrow(ErroDeData);
    expect(() => partes('2026-13-01')).toThrow(ErroDeData);
    expect(() => partes('2026-02-30')).toThrow(ErroDeData);
    expect(() => partes('2026-2-1')).toThrow(ErroDeData);
  });
  test('bissexto', () => {
    expect(ehBissexto(2024)).toBe(true);
    expect(ehBissexto(2026)).toBe(false);
    expect(ehBissexto(1900)).toBe(false);
    expect(ehBissexto(2000)).toBe(true);
    expect(diasNoMes(2024, 2)).toBe(29);
    expect(diasNoMes(1900, 2)).toBe(28);
  });
  test('comparar é cronológico', () => {
    expect(comparar('2026-01-01', '2026-02-01')).toBe(-1);
    expect(comparar('2026-02-01', '2026-01-01')).toBe(1);
    expect(comparar('2026-01-01', '2026-01-01')).toBe(0);
  });
});
