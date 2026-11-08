import { describe, expect, test } from 'bun:test';
import { classificar, raioX, analisarFrota } from '../src/domain/analise/raio_x.ts';
import { xlsxParaTexto } from '../src/domain/analise/planilha.ts';
const BAL = `BALANÇO PATRIMONIAL   2024  2023
Ativo Circulante 1.000.000,00 2.000.000,00
Disponibilidades 50.000,00 80.000,00
Estoques 400.000,00 500.000,00
Ativo Não Circulante 2.000.000,00 2.000.000,00
Total do Ativo 3.000.000,00 4.000.000,00
Passivo Circulante 2.500.000,00 1.500.000,00
Passivo Não Circulante 1.500.000,00 1.500.000,00
Patrimônio Líquido (1.000.000,00) 1.000.000,00`;
const DRE = `Demonstração do Resultado   2023  2024
Receita Líquida 8.000.000,00 6.000.000,00
Lucro Bruto 2.000.000,00 900.000,00
Resultado Operacional 500.000,00 (300.000,00)
Despesas Financeiras 400.000,00 600.000,00
Prejuízo do Exercício 100.000,00 (900.000,00)`;
const d = (titulo: string, texto: string) => ({ id: titulo, titulo, texto });
const r = raioX({ documentos: [d('Balanço 2024', BAL), d('DRE 2024', DRE)], naoLidos: [{ titulo: 'Scan.pdf', motivo: 'precisa de OCR' }] });
const I = (id: string) => r.indicadores.find((x) => x.id === id)!;

describe('indicadores calculados à mão', () => {
  test('liquidez: 1.000/2.500 = 0,40x; seca (1.000−400)/2.500 = 0,24x; geral 1.000/4.000 = 0,25x', () => {
    expect(I('lc').valor).toBe(0.4); expect(I('lc').leitura).toBe('critico'); expect(I('ls').valor).toBe(0.24); expect(I('lg').valor).toBe(0.25);
  });
  test('endividamento 4.000/3.000 = 133,33%', () => { expect(I('end').valor).toBeCloseTo(133.3333, 3); });
  test('respeita a ordem das colunas: DRE com ano crescente lê a última como atual', () => {
    expect(I('mb').valor).toBe(15); expect(I('vr').valor).toBe(-25);
  });
  test('PL negativo e CCL negativo são críticos, com documento e linha de origem', () => {
    const p = r.pontos.find((x) => x.titulo === 'Patrimônio líquido negativo')!; expect(p.gravidade).toBe('critico'); expect(p.evidencia!.documento).toBe('Balanço 2024'); expect(p.evidencia!.trecho).toContain('Patrimônio Líquido');
    expect(r.pontos.some((x) => x.titulo.startsWith('Capital circulante'))).toBe(true);
  });
  test('o que não foi lido aparece, não some', () => { expect(r.resumo.naoLidos).toBe(1); expect(r.pontos.some((x) => x.titulo === 'Não lido: Scan.pdf')).toBe(true); });
  test('número ausente não vira indicador inventado', () => { expect(raioX({ documentos: [d('Balanço', 'Balanço patrimonial sem valores')], naoLidos: [] }).indicadores).toEqual([]); });
});

describe('frota e teses', () => {
  const F = `Controle de frota\nPlaca ABC1D23 Scania 2015 alienação fiduciária Banco X\nPlaca DEF-4567 Volvo 2012 gravame leasing\nPlaca GHI2J45 2020 quitado\nPlaca GHI2J45 2020 repetida\nPlaca JKL1M23 2018 bloqueio RENAJUD`;
  const f = analisarFrota([d('Frota', F)])!;
  test('conta placas únicas, ônus e restrições', () => { expect(f.total).toBe(4); expect(f.onerados).toBe(2); expect(f.comRestricao).toBe(1); });
  test('transportadora aciona a essencialidade', () => {
    const x = raioX({ documentos: [d('Frota', F)], naoLidos: [] }); expect(x.transportadora).toBe(true); expect(x.teses.some((t) => t.fundamento.includes('art. 49, § 3º'))).toBe(true);
  });
  test('transportadora sem frota é apontada', () => { expect(raioX({ documentos: [d('Contrato social', 'Objeto: transporte rodoviário de cargas')], naoLidos: [] }).pontos.some((p) => p.area === 'Frota')).toBe(true); });
  test('aval aciona Súmula 581; sem o gatilho, a tese não aparece', () => {
    expect(raioX({ documentos: [d('CCB', 'Cédula de crédito bancário com aval dos sócios')], naoLidos: [] }).teses.some((t) => t.fundamento.includes('Súmula 581'))).toBe(true);
    expect(raioX({ documentos: [d('Nota', 'texto neutro')], naoLidos: [] }).teses).toEqual([]);
  });
  test('classifica pelo título antes do conteúdo', () => { expect(classificar(d('DRE 2023', 'cita o ativo circulante'))).toBe('dre'); });
  test('art. 51: aponta o que falta', () => { expect(r.requisitos.find((q) => q.inciso === 'Art. 51, III')!.atendido).toBe(false); expect(r.requisitos.find((q) => q.inciso === 'Art. 51, II')!.atendido).toBe(true); });
});

test('planilha Excel vira texto legível', async () => {
  const { montarZip } = await import('./apoio/zip.ts');
  const z = montarZip([{ nome: '[Content_Types].xml', conteudo: 'x' }, { nome: 'xl/workbook.xml', conteudo: '<sheets><sheet name="DRE" sheetId="1"/></sheets>' }, { nome: 'xl/sharedStrings.xml', conteudo: '<sst><si><t>Receita Líquida</t></si></sst>' }, { nome: 'xl/worksheets/sheet1.xml', conteudo: '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1000</v></c></row></sheetData>' }]);
  expect(xlsxParaTexto(z)).toContain('Receita Líquida\t1000');
});
