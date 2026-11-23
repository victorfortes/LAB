import { describe, expect, test } from 'bun:test';
import { itensDoDocumento } from '../src/domain/diagnostico/organizar.ts';
import { juntarFaturamento, lerDocumentoPdf } from '../src/domain/diagnostico/documentos.ts';
import type { ExtracaoLida } from '../src/domain/diagnostico/planilhas.ts';

const doc = (titulo: string, tipos: string[] = []) => ({ titulo, nome: `${titulo.split(' / ').pop()}.pdf`, tipos });

describe('organizar documentos no checklist do art. 51', () => {
  test('a pasta do cliente decide, da mais funda para cima', () => {
    expect(itensDoDocumento(doc('CLIENTE / 4. Endividamento / 03. Contratos de financiamento e empréstimos / Bradesco / 2024 / Bradesco - 2.000.000')).itens).toEqual(['financiamentos']);
    expect(itensDoDocumento(doc('CLIENTE / 5. Sócios / 03. Relação de bens particulares dos sócios / A.J.V. Holding / BENS CONTABEIS 2026')).itens).toEqual(['bensSocios']);
    expect(itensDoDocumento(doc('CLIENTE / 2. Contábil / 16. Banço + D.R.E / 2023 / G-Balanço e DRE - 2023')).itens).toEqual(['balanco', 'dre']);
    expect(itensDoDocumento(doc('CLIENTE / 8. Jurídico / 06. Contratos sociais das sociedades integradas por avalistas / Contrato Social SE')).itens).toEqual(['contratosGrupo']);
    expect(itensDoDocumento(doc('CLIENTE / 4. Endividamento / 04. Contratos com alienação fiduciária em garantia / BRDE / 2022 / BRDE')).itens).toEqual(['fiduciaria', 'financiamentos']);
  });
  test('pasta que não é item não herda a de cima; conta de luz não vira extrato', () => {
    expect(itensDoDocumento(doc('CLIENTE / 6. Empregados / 04. Sindicato(s) e convenção coletiva / FETRACC X SINDICATO')).itens).toEqual([]);
    expect(itensDoDocumento(doc('CLIENTE / 2. Contábil / 14. Extratos bancários / ABRIL / SegundaViaCopel-72')).itens).toEqual([]);
    expect(itensDoDocumento(doc('CLIENTE / 2. Contábil / 14. Extratos bancários / ABRIL / BB FITA')).itens).toEqual(['extratos']);
  });
  test('sem pasta: nome e, por fim, o conteúdo lido', () => {
    expect(itensDoDocumento(doc('SOLICITAÇÃO A CRESOL', ['contrato_credito'])).itens).toEqual(['financiamentos']);
    expect(itensDoDocumento(doc('7ªALTERAÇÃO CONTRATUAL')).itens).toEqual(['contratoSocial']);
    expect(itensDoDocumento(doc('arquivo sem nome', ['qgc'])).itens).toEqual(['credores']);
  });
});

describe('leitores para o formato dos sistemas contábeis', () => {
  test('balanço em várias páginas com ATIVO/PASSIVO como título e PL negativo', () => {
    const r = lerDocumentoPdf('Balanço 2025 ASS.pdf', [
      ['B A L AN C O PAT R I M O N IAL - 2 0 2 5', 'AT I V O', 'CIRCULANTE 20.265.486,54 20.792.384,70', 'Caixa 2.625,70 4.494,82'],
      ['NÃO CIRCULANTE 17.253.736,63 22.396.712,62', 'TOTAL DO A TIVO 37.826.536,51 43.383.600,50'],
      ['PAS S I V O', 'CIRCULANTE 17.755.578,39 22.460.030,65', 'NÃO CIRCULANTE 24.883.898,72 20.552.761,50', 'PASSIVOA DESCOBERTO (5.120.253,94 ) 176.305,17'],
    ]);
    expect(r.extracoes[0]).toMatchObject({ tipo: 'balanco', dados: { exercicio: 2025, ativoCirculante: 20265486.54, passivoNaoCirculante: 24883898.72, patrimonioLiquido: -5120253.94 } });
  });
  test('DRE com "*** Total" e resultado na última página', () => {
    const r = lerDocumentoPdf('DRE 2024.pdf', [
      ['Período: Janeiro / 2024 a Dezembro / 2024', 'DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO', '*** Total RECEITAOPERACIONAL BRUTA 54.083.802,04', '*** Total (-) DEDUÇÕES DARECEITA BRUTA (10.845.173,91 )'],
      ['*** Total DESPESAS FINANCEIRAS (1.264.212,85 )', '*** Total (=) PREJUIZO LIQUIDO DO EXERCICIO (2.747.002,69 )'],
    ]);
    expect(r.extracoes).toEqual([expect.objectContaining({ tipo: 'dre_contabil', dados: { exercicio: 2024, receitaBruta: 54083802.04, resultado: -2747002.69, meses: 12, despesasFinanceiras: 1264212.85 } })]);
  });
  test('demonstrativo gerencial (G-) em reais sem centavos entra como gerencial', () => {
    const r = lerDocumentoPdf('G-Balanço e DRE - 2023 - Fitaflex.pdf', [['DEMONSTRAÇÃO DO RESULTADO DE EXERCICIO - 31/12/2023.', 'RECEITA BRUTA COM VENDAS R$ 102.284.953', '= LUCRO LÍQUIDO DO EXERCÍCIO R$ 24.724.045']]);
    expect(r.extracoes[0]).toMatchObject({ tipo: 'dre_gerencial', dados: { exercicio: 2023, receitaBruta: 102284953, resultado: 24724045 } });
  });
  test('faturamento de doze meses móveis fica em cada ano civil, sem contar mês duas vezes', () => {
    const anual = lerDocumentoPdf('faturamento 12-2025.pdf', [['Demonstrativo Mensal do Faturamento', 'NOVEMBRO 2025 100,00', 'DEZEMBRO 2025 200,00']]);
    const movel = lerDocumentoPdf('faturamento 01-2026.pdf', [['Demonstrativo Mensal do Faturamento', 'DEZEMBRO 2025 200,00', 'JANEIRO 2026 50,00']]);
    expect(movel.extracoes.map((x) => x.dados.ano)).toEqual([2025, 2026]);
    const j = juntarFaturamento([...anual.extracoes, ...movel.extracoes] as ExtracaoLida[]);
    expect(j.map((a) => [a.ano, a.fiscal, a.mesesFiscal])).toEqual([[2025, 300, 2], [2026, 50, 1]]);
  });
  test('relação de faturamento com só o nome do mês segue o ano do intervalo', () => {
    const r = lerDocumentoPdf('G_Lista_Faturamento.pdf', [['Relação de Faturamento de 11/2025 a 01/2026', 'Novembro R$ 1.000,00', 'Dezembro R$ 2.000,00', 'Janeiro R$ 500,00', '2025/2026 R$ 3.500,00']]);
    expect(r.extracoes.map((x) => [x.dados.ano, x.dados.gerencial])).toEqual([[2025, 3000], [2026, 500]]);
  });
});
