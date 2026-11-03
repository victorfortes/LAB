import { describe, expect, test } from 'bun:test';
import {
  calendarioNacional, ehDiaUtilForense, noRecesso, pascoa, porQueNaoCorre, proximoDiaUtil,
} from '../src/domain/processo/feriados.ts';
import { diaDaSemana, ehFimDeSemana } from '../src/domain/shared/datas.ts';

describe('dia da semana', () => {
  test('bate com datas conhecidas', () => {
    // Sakamoto, não `new Date(iso).getDay()`: a string ISO é lida em UTC e o
    // getDay() responde no fuso local, devolvendo o dia anterior no Brasil.
    expect(diaDaSemana('2026-11-02')).toBe(1);   // segunda
    expect(diaDaSemana('2026-01-01')).toBe(4);   // quinta
    expect(diaDaSemana('2000-02-29')).toBe(2);   // terça, ano bissexto secular
    expect(diaDaSemana('1988-10-05')).toBe(3);   // quarta, promulgação da CF
  });

  test('fim de semana', () => {
    expect(ehFimDeSemana('2026-11-07')).toBe(true);
    expect(ehFimDeSemana('2026-11-08')).toBe(true);
    expect(ehFimDeSemana('2026-11-09')).toBe(false);
  });
});

describe('Páscoa e os feriados móveis', () => {
  test('domingos de Páscoa conhecidos', () => {
    expect(pascoa(2024)).toBe('2024-03-31');
    expect(pascoa(2025)).toBe('2025-04-20');
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
  });

  test('Carnaval, Sexta-feira Santa e Corpus Christi derivam dela', () => {
    const c = calendarioNacional(2026);
    const nomes = (data: string) => c.filter((d) => d.data === data).map((d) => d.nome);
    expect(nomes('2026-02-16')).toContain('Carnaval (segunda)');
    expect(nomes('2026-02-17')).toContain('Carnaval (terça)');
    expect(nomes('2026-04-03')).toContain('Sexta-feira Santa');
    expect(nomes('2026-06-04')).toContain('Corpus Christi');
  });

  test('Carnaval e Corpus Christi são suspensão forense, não feriado civil', () => {
    // A distinção importa: é ela que o advogado confere contra a portaria.
    const c = calendarioNacional(2026);
    expect(c.find((d) => d.data === '2026-02-17')!.motivo).toBe('suspensao_forense');
    expect(c.find((d) => d.data === '2026-04-03')!.motivo).toBe('feriado_nacional');
  });
});

describe('feriados fixos', () => {
  test('os nacionais estão todos no calendário', () => {
    const datas = calendarioNacional(2026).map((d) => d.data);
    for (const d of ['2026-01-01', '2026-04-21', '2026-05-01', '2026-09-07',
      '2026-10-12', '2026-11-02', '2026-11-15', '2026-12-25']) {
      expect(datas).toContain(d);
    }
  });

  test('20 de novembro só é nacional a partir de 2024', () => {
    // Virou feriado por lei federal de 2023; recalcular prazo de processo
    // antigo com a regra nova dá data errada.
    expect(calendarioNacional(2026).map((d) => d.data)).toContain('2026-11-20');
    expect(calendarioNacional(2023).map((d) => d.data)).not.toContain('2023-11-20');
  });
});

describe('recesso do art. 220 do CPC', () => {
  test('de 20 de dezembro a 20 de janeiro, inclusive nas pontas', () => {
    expect(noRecesso('2026-12-19')).toBe(false);
    expect(noRecesso('2026-12-20')).toBe(true);
    expect(noRecesso('2027-01-20')).toBe(true);
    expect(noRecesso('2027-01-21')).toBe(false);
  });

  test('dia de semana dentro do recesso não é dia útil forense', () => {
    expect(ehDiaUtilForense('2026-12-23')).toBe(false);
    expect(porQueNaoCorre('2026-12-23')!.motivo).toBe('recesso_forense');
  });

  test('mas corre quando o prazo é material e o chamador diz que corre', () => {
    expect(ehDiaUtilForense('2026-12-23', { considerarRecesso: false })).toBe(true);
  });
});

describe('o que o sistema não sabe sozinho', () => {
  test('feriado local informado é respeitado', () => {
    // 9 de julho é feriado em São Paulo e dia útil no resto do país.
    expect(ehDiaUtilForense('2026-07-09')).toBe(true);
    expect(ehDiaUtilForense('2026-07-09', { feriadosLocais: ['2026-07-09'] })).toBe(false);
    expect(porQueNaoCorre('2026-07-09', { feriadosLocais: ['2026-07-09'] })!.motivo)
      .toBe('feriado_local');
  });

  test('suspensão informada cobre o período inteiro', () => {
    const cal = { suspensoes: [{ de: '2026-07-01', ate: '2026-07-31', motivo: 'greve dos servidores' }] };
    expect(ehDiaUtilForense('2026-07-15', cal)).toBe(false);
    expect(porQueNaoCorre('2026-07-15', cal)!.nome).toBe('greve dos servidores');
    expect(ehDiaUtilForense('2026-08-03', cal)).toBe(true);
  });
});

describe('próximo dia útil', () => {
  test('devolve o próprio dia quando já é útil', () => {
    expect(proximoDiaUtil('2026-11-09')).toBe('2026-11-09');
  });

  test('pula fim de semana e feriado emendado', () => {
    expect(proximoDiaUtil('2026-11-14')).toBe('2026-11-16');   // sáb → seg (15/11 é domingo)
    expect(proximoDiaUtil('2026-12-24')).toBe('2027-01-21');   // recesso inteiro
  });

  test('suspensão longa demais falha em vez de girar para sempre', () => {
    const cal = { suspensoes: [{ de: '2026-01-01', ate: '2028-01-01', motivo: 'absurdo' }] };
    expect(() => proximoDiaUtil('2026-06-01', cal)).toThrow('provavelmente suspende');
  });
});
