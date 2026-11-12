import { describe, expect, test } from 'bun:test';
import { lerValor, linhasDeTabela, linhasDeTexto, qgcPreliminar } from '../src/domain/insolvencia/balancete.ts';

const TABELA = [
  ['BALANCETE DE VERIFICAÇÃO - 31/12/2025'],
  ['Código', 'Descrição', 'Saldo anterior', 'Débito', 'Crédito', 'Saldo atual'],
  ['1', 'ATIVO', '0,00', '0,00', '0,00', '900.000,00D'],
  ['2', 'PASSIVO', '0,00', '0,00', '0,00', '1.000.000,00C'],
  ['2.1', 'PASSIVO CIRCULANTE', '', '', '', '700.000,00C'],
  ['2.1.1', 'Fornecedores', '', '', '', '300.000,00C'],
  ['2.1.1.001', 'ACME AÇO LTDA', '', '', '', '200.000,00C'],
  ['2.1.1.002', 'TRANSPORTES SUL LTDA', '', '', '', '100.000,00C'],
  ['2.1.2', 'Obrigações trabalhistas', '', '', '', '150.000,00C'],
  ['2.1.2.001', 'Salários a pagar', '', '', '', '120.000,00C'],
  ['2.1.2.002', 'INSS a recolher', '', '', '', '30.000,00C'],
  ['2.1.3', 'Empréstimos e financiamentos', '', '', '', '250.000,00C'],
  ['2.1.3.001', 'Banco Alfa S.A. - capital de giro', '', '', '', '250.000,00C'],
  ['2.1.4', 'Adiantamento a fornecedor (errado)', '', '', '', '5.000,00D'],
  ['2.2', 'PASSIVO NÃO CIRCULANTE', '', '', '', '300.000,00C'],
  ['2.2.1', 'Financiamento com alienação fiduciária', '', '', '', '200.000,00C'],
  ['2.2.2', 'Mútuo de sócios', '', '', '', '100.000,00C'],
  ['2.3', 'PATRIMÔNIO LÍQUIDO', '', '', '', '100.000,00D'],
  ['2.3.1', 'Capital social', '', '', '', '50.000,00C'],
];

describe('valores do balancete', () => {
  test('lê D/C, parênteses e sinal', () => {
    expect(lerValor('1.234,56C')).toEqual({ centavos: 123456n, lado: 'C' });
    expect(lerValor('1.234,56 D')).toEqual({ centavos: 123456n, lado: 'D' });
    expect(lerValor('(10,00)')).toEqual({ centavos: 1000n, lado: 'D' });
    expect(lerValor('R$ 5.000')).toEqual({ centavos: 500000n, lado: null });
    expect(lerValor('Fornecedores')).toBeNull();
  });
});

describe('QGC preliminar a partir do balancete', () => {
  const q = qgcPreliminar(linhasDeTabela('balancete.xlsx', 'Plan1', TABELA));
  const por = (conta: string) => q.linhas.find((l) => l.conta === conta);

  test('só folhas do passivo com saldo credor; grupos, ativo e PL ficam de fora', () => {
    expect(q.linhas.map((l) => l.conta)).toEqual([
      'ACME AÇO LTDA', 'TRANSPORTES SUL LTDA', 'Salários a pagar', 'INSS a recolher',
      'Banco Alfa S.A. - capital de giro', 'Financiamento com alienação fiduciária', 'Mútuo de sócios',
    ]);
    expect(q.total).toBe(String(1_000_000_00n));
  });

  test('conta de passivo com saldo devedor vira aviso, não credor', () => {
    expect(q.avisos.some((a) => a.includes('saldo devedor'))).toBe(true);
  });

  test('fornecedor dentro do grupo é credor quirografário com o próprio nome', () => {
    expect(por('ACME AÇO LTDA')).toMatchObject({ credor: 'ACME AÇO LTDA', natureza: 'quirografario', classe: 'III', hipotese: false, grupo: 'Fornecedores' });
  });

  test('salário é classe I; INSS é tributo e não se sujeita', () => {
    expect(por('Salários a pagar')).toMatchObject({ natureza: 'trabalhista', classe: 'I', credor: 'Empregados (Salários a pagar)' });
    expect(por('INSS a recolher')).toMatchObject({ natureza: 'tributario', sujeito: false });
  });

  test('banco é hipótese; fiduciária fica fora; sócio é subordinado com ressalva', () => {
    expect(por('Banco Alfa S.A. - capital de giro')).toMatchObject({ natureza: 'quirografario', hipotese: true });
    expect(por('Financiamento com alienação fiduciária')).toMatchObject({ natureza: 'proprietario_fiduciario', sujeito: false });
    expect(por('Mútuo de sócios')).toMatchObject({ natureza: 'subordinado', hipotese: true });
  });

  test('fornecedor com ME no nome vira classe IV, como hipótese', () => {
    const l = qgcPreliminar(linhasDeTabela('b.csv', 'csv', [['Código', 'Descrição', 'Saldo atual'], ['2', 'PASSIVO', '10,00C'], ['2.1', 'Fornecedores', '10,00C'], ['2.1.1', 'EMBALAGENS PARANÁ ME', '10,00C']])).linhas[0]!;
    expect(l).toMatchObject({ natureza: 'me_epp', classe: 'IV', hipotese: true });
  });

  test('cada linha guarda de onde veio', () => {
    expect(por('ACME AÇO LTDA')!.referencia).toBe('balancete.xlsx | Plan1 | linha 7');
  });
});

describe('balancete em PDF (texto)', () => {
  test('código, descrição e o último valor da linha', () => {
    const l = linhasDeTexto('bal.pdf', [[
      '2 PASSIVO 0,00 0,00 0,00 500.000,00C',
      '2.1.1 FORNECEDORES 0,00 0,00 0,00 500.000,00C',
      '2.1.1.01 ACME LTDA 10.000,00 5.000,00 495.000,00 500.000,00C',
    ]]);
    expect(l.at(-1)).toMatchObject({ codigo: '2.1.1.01', conta: 'ACME LTDA', saldo: 50_000_000n, lado: 'C', referencia: 'bal.pdf | página 1 | linha 3' });
    expect(qgcPreliminar(l).linhas.map((x) => x.credor)).toEqual(['ACME LTDA']);
  });
});
