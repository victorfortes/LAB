import { describe, expect, test } from 'bun:test';
import { lerTextoDeDemonstracao } from '../src/domain/diagnostico/planilhas.ts';

describe('balanço e DRE em PDF com texto', () => {
  const paginas = [[
    'EJE INDÚSTRIA DE METAIS LTDA',
    'BALANÇO PATRIMONIAL EM 31/12 Exercícios 2023 2024',
    'ATIVO CIRCULANTE 3 1.200.000,00 1.050.000,00',
    'ATIVO NÃO CIRCULANTE 2.300.000,00 2.250.000,00',
    'PASSIVO CIRCULANTE 2.900.000,00 3.400.000,00',
    'PASSIVO NÃO CIRCULANTE 900.000,00 1.100.000,00',
    'PATRIMÔNIO LÍQUIDO (300.000,00) (1.200.000,00)',
  ], [
    'DEMONSTRAÇÃO DO RESULTADO 2023 2024',
    'RECEITA BRUTA 8.000.000,00 6.500.000,00',
    'RESULTADO LÍQUIDO DO EXERCÍCIO (400.000,00) (900.000,00)',
  ]];

  test('lê os dois exercícios do balanço pelos rótulos, com página de origem', () => {
    const r = lerTextoDeDemonstracao('balanco.pdf', paginas);
    const b = r.extracoes.filter((x) => x.tipo === 'balanco');
    expect(b.map((x) => x.dados.exercicio)).toEqual([2023, 2024]);
    expect(b[1]!.dados).toMatchObject({ ativoCirculante: 1_050_000, passivoCirculante: 3_400_000, patrimonioLiquido: -1_200_000 });
    expect(b[0]!.referencia).toBe('balanco.pdf | página 1');
  });

  test('a DRE sai da outra página', () => {
    const d = lerTextoDeDemonstracao('balanco.pdf', paginas).extracoes.filter((x) => x.tipo === 'dre_contabil');
    expect(d.map((x) => [x.dados.exercicio, x.dados.receitaBruta])).toEqual([[2023, 8_000_000], [2024, 6_500_000]]);
  });

  test('PDF sem demonstração vira aviso, não número', () => {
    const r = lerTextoDeDemonstracao('contrato.pdf', [['CONTRATO SOCIAL', 'Cláusula primeira']]);
    expect(r.extracoes).toHaveLength(0);
    expect(r.avisos[0]).toContain('sem balanço ou DRE');
  });
});
