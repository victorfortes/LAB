import { describe, expect, test } from 'bun:test';
import { fluxo, segundaDaSemana } from '../src/domain/financeiro/motor.ts';
import { interpretar } from '../src/domain/financeiro/linguagem.ts';
import { dataBr, interpretarArquivo, valorBr } from '../src/domain/financeiro/importacao.ts';
const enc = (s: string) => new TextEncoder().encode(s);

describe('fluxo sem dupla contagem', () => {
  test('título parcialmente pago só compromete o saldo, e a baixa aparece como realizado', () => {
    const r = fluxo({ saldoInicial: 1000_00n, hoje: '2027-03-10', granularidade: 'mes',
      lancamentos: [{ data: '2027-03-05', tipo: 'despesa', situacao: 'realizado', valor: 300_00n, tituloId: 't' }],
      titulos: [{ tipo: 'pagar', vencimento: '2027-03-20', valorAtualizado: 1000_00n, valorLiquidado: 300_00n, situacao: 'parcial' }] });
    expect(r.periodos[0]!.realizadoSaidas).toBe(300_00n); expect(r.periodos[0]!.comprometidoSaidas).toBe(700_00n);
    expect(r.periodos[0]!.saldoFinal).toBe(0n); expect(r.saldoAtual).toBe(700_00n);
  });
  test('previsto ligado a título não conta de novo; liquidado e cancelado saem', () => {
    const r = fluxo({ saldoInicial: 0n, hoje: '2027-01-01', granularidade: 'mes', lancamentos: [{ data: '2027-02-01', tipo: 'despesa', situacao: 'previsto', valor: 50_00n, tituloId: 'x' }],
      titulos: [{ tipo: 'pagar', vencimento: '2027-02-01', valorAtualizado: 50_00n, valorLiquidado: 0n, situacao: 'aberto' }, { tipo: 'pagar', vencimento: '2027-02-01', valorAtualizado: 9n, valorLiquidado: 9n, situacao: 'liquidado' }, { tipo: 'receber', vencimento: '2027-02-01', valorAtualizado: 9n, valorLiquidado: 0n, situacao: 'cancelado' }] });
    expect(r.periodos[0]!.comprometidoSaidas).toBe(50_00n); expect(r.periodos[0]!.projetadoSaidas).toBe(0n);
  });
  test('vencido não pago continua devido no período atual e é apontado', () => {
    const r = fluxo({ saldoInicial: 10_00n, hoje: '2027-05-10', granularidade: 'mes', lancamentos: [], titulos: [{ tipo: 'pagar', vencimento: '2026-12-01', valorAtualizado: 40_00n, valorLiquidado: 0n, situacao: 'aberto' }] });
    expect(r.periodos[0]!.chave).toBe('2027-05'); expect(r.vencidoPagar).toBe(40_00n); expect(r.periodosNegativos).toEqual(['2027-05']);
  });
  test('semana começa na segunda', () => { expect(segundaDaSemana('2027-01-03')).toBe('2026-12-28'); expect(segundaDaSemana('2027-01-04')).toBe('2027-01-04'); });
});

describe('linguagem natural (exemplos do briefing)', () => {
  const H = '2026-11-08';
  test('Paguei R$ 4.500 de aluguel ontem.', () => { const r = interpretar('Paguei R$ 4.500 de aluguel ontem.', H);
    expect(r).toMatchObject({ natureza: 'lancamento', tipo: 'despesa', valor: '450000', data: '2026-11-07', categoria: 'Aluguel', situacao: 'realizado', faltando: [] }); });
  test('Tenho R$ 32.000 para receber da empresa ABC em 15 de dezembro.', () => { const r = interpretar('Tenho R$ 32.000 para receber da empresa ABC em 15 de dezembro.', H);
    expect(r).toMatchObject({ natureza: 'titulo', tipo: 'receita', valor: '3200000', data: '2026-12-15', contraparte: 'ABC' }); });
  test('três parcelas sem data: pede o vencimento em vez de inventar', () => { const r = interpretar('Registrar pagamento de fornecedor no valor de R$ 12.000 em três parcelas.', H);
    expect(r.parcelas).toBe(3); expect(r.natureza).toBe('titulo'); expect(r.faltando).toContain('vencimento'); expect(r.data).toBeNull(); });
  test('sem valor, não chuta', () => { expect(interpretar('paguei o aluguel', H).faltando).toContain('valor'); });
});

describe('importação', () => {
  test.each([['1.234,56', 123456n], ['1,234.56', 123456n], ['1234.56', 123456n], ['(1.234,56)', -123456n], ['-50', -5000n], ['R$ 10,5', 1050n], ['abc', null]])('valor %s', (t, e) => { expect(valorBr(t as string)).toBe(e as bigint | null); });
  test('data inválida não vira data', () => { expect(dataBr('31/13/2026')).toBeNull(); expect(dataBr('05/03/2027')).toBe('2027-03-05'); expect(dataBr('46000')).toBe('2025-12-09'); });
  test('CSV com ; identifica colunas', () => { const p = interpretarArquivo('a.csv', enc('Data;Historico;Fornecedor;Valor\n05/03/2027;Compra;ACME;-1.000,00\nxx;;;abc\n'));
    expect(p.linhas[0]).toMatchObject({ data: '2027-03-05', valor: '100000', tipo: 'despesa', contraparte: 'ACME' }); expect(p.linhas[1]!.problemas).toHaveLength(2); });
  test('OFX de banco', () => { const p = interpretarArquivo('e.ofx', enc('<OFX><STMTTRN><DTPOSTED>20270305<TRNAMT>-150.00<FITID>abc<MEMO>TED</STMTTRN></OFX>'));
    expect(p.linhas[0]).toMatchObject({ data: '2027-03-05', valor: '15000', tipo: 'despesa', documento: 'abc', situacao: 'realizado' }); });
  test('NF-e vira título a conferir, nunca pagamento', () => { const p = interpretarArquivo('n.xml', enc('<nfeProc><infNFe><ide><nNF>77</nNF><dhEmi>2027-01-02T10:00:00</dhEmi></ide><emit><xNome>ACME</xNome></emit><total><vNF>99.90</vNF></total></infNFe></nfeProc>'));
    expect(p.linhas[0]).toMatchObject({ natureza: 'titulo', situacao: 'previsto', valor: '9990' }); expect(p.avisos[0]).toContain('não prova pagamento'); });
});
