import { describe, expect, test } from 'bun:test';
import { juntarFaturamento, lerDocumentoPdf, lerToken } from '../src/domain/diagnostico/documentos.ts';
import { CATEGORIA, QUORUNS, documentosDoArt51, enquadramento, folhasDoPassivo, mapaDoEndividamento } from '../src/domain/diagnostico/juridico.ts';
import { montarRelatorio } from '../src/domain/diagnostico/relatorio.ts';
import { renderizarDiagnostico } from '../src/server/diagnostico_html.ts';

const BALANCO = [
  'Empresa: EJE INDUSTRIA DE METAIS LTDA Folha: 0001', 'Balanço encerrado em: 31/12/2025', 'Descrição Saldo Atual',
  'ATIVO 28.000.000,00D', 'ATIVO CIRCULANTE 19.000.000,00D', 'ATIVO NÃO-CIRCULANTE 9.000.000,00D',
  'PASSIVO 28.000.000,00C', 'PASSIVO CIRCULANTE 45.000.000,00C', 'FORNECEDORES 7.000.000,00C', 'FORNECEDORES 7.000.000,00C',
  'OBRIGAÇÕES TRIBUTÁRIAS 7.000.000,00C', 'IMPOSTOS E CONTRIBUIÇÕES A RECOLHER 7.000.000,00C',
  'OUTRAS OBRIGAÇÕES 31.000.000,00C', 'ADIANTAMENTOS A CLIENTES 28.000.000,00C', 'OUTROS DÉBITOS COM SÓCIOS 3.000.000,00C',
  'PASSIVO NÃO-CIRCULANTE 8.000.000,00C', 'PARCELAMENTOS 8.000.000,00C',
  'PATRIMÔNIO LÍQUIDO 25.000.000,00D', 'CAPITAL SOCIAL 130.000,00C',
];

describe('valores no formato dos documentos', () => {
  test('R$ com sinal, traço, parênteses e D/C', () => {
    expect(lerToken('-R$ 1.416.747,52')).toEqual({ reais: -1416747.52, lado: null });
    expect(lerToken('R$ -')).toEqual({ reais: 0, lado: null });
    expect(lerToken('(8.689.940,68)')).toEqual({ reais: -8689940.68, lado: null });
    expect(lerToken('19.299.815,64D')).toEqual({ reais: 19299815.64, lado: 'D' });
  });
});

describe('leitores por conteúdo', () => {
  test('balanço de um exercício com D/C: PL devedor vira negativo e fecha com o ativo', () => {
    const b = lerDocumentoPdf('Balanço 2025.pdf', [BALANCO]).extracoes.find((x) => x.tipo === 'balanco')!;
    expect(b.dados).toMatchObject({ exercicio: 2025, ativoCirculante: 19e6, passivoCirculante: 45e6, passivoNaoCirculante: 8e6, patrimonioLiquido: -25e6 });
  });

  test('faturamento fiscal e gerencial em arquivos separados se juntam por ano', () => {
    const fiscal = lerDocumentoPdf('03 - FATURAMENTO FISCAL 2024.pdf', [['DECLARAÇÃO DE FATURAMENTO', 'Janeiro 2024 1.000,00', 'Fevereiro 2024 2.000,00', 'Totais 3.000,00']]);
    const ger = lerDocumentoPdf('03 - FATURAMENTO GERENCIAL 2024.pdf', [['FATURAMENTO GERENCIAL', 'jan/24 R$ 1.000,00 R$ 500,00 R$ 1.500,00', 'fev/24 R$ 2.000,00 R$ 1.000,00 R$ 3.000,00', 'mar/24 R$ 0,00 R$ 0,00 R$ 0,00']]);
    const [a] = juntarFaturamento([...fiscal.extracoes, ...ger.extracoes]);
    expect(a).toMatchObject({ ano: 2024, fiscal: 3000, gerencial: 4500, outros: 1500, mesesGerencial: 2 });
  });

  test('DRE gerencial (acumulado + meses) e contábil (parênteses) com o sinal do resultado', () => {
    const g = lerDocumentoPdf('DRE 2026.pdf', [['Acumulado jan/26 fev/26', 'Receita Bruta R$ 3.000,00 R$ 1.000,00 R$ 2.000,00', 'Lucro Liquido -R$ 200,00 -R$ 100,00 -R$ 100,00']]).extracoes[0]!;
    expect(g).toMatchObject({ tipo: 'dre_gerencial', dados: { exercicio: 2026, receitaBruta: 3000, resultado: -200, meses: 2 } });
    const c = lerDocumentoPdf('DRE 2024 - Contabil.pdf', [['DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO EM 31/12/2024', 'RECEITA BRUTA 16.876.866,85', 'PREJUÍZO DO EXERCÍCIO (8.689.940,68)']]).extracoes[0]!;
    expect(c).toMatchObject({ tipo: 'dre_contabil', dados: { exercicio: 2024, resultado: -8689940.68 } });
  });

  test('balancete gerencial: passivo pelo sinal, sem PL nem receita', () => {
    const r = lerDocumentoPdf('2 - Balancete 06.26.pdf', [['BALANCETE GERENCIAL', 'jun/26', 'Fornecedores ( Despesas) -R$ 1.800.130,82 R$ 96.695,45 R$ 288.821,48 -R$ 1.992.256,85',
      'Impostos Parcelados -R$ 3.434.603,75 R$ 2.120,45 R$ - -R$ 3.432.483,30', 'Capital social (Ajuste) -R$ 7.605.233,95 -R$ 7.605.233,95', 'Receita de Vendas -R$ 6.547.956,21 R$ 1.297.044,50 -R$ 7.845.000,71',
      'Banco conta corrente R$ 1.496.829,22 R$ 1.091.321,83 R$ 552.161,86 R$ 2.035.989,19']]);
    expect(r.extracoes[0]).toMatchObject({ tipo: 'passivo_fonte', dados: { fonte: 'Balancete gerencial jun/26', total: 5424740.15, fiscal: 3432483.3, periodo: '2026-06' } });
  });
});

describe('leitura jurídica', () => {
  const b = lerDocumentoPdf('Balanço 2025.pdf', [BALANCO]).extracoes.find((x) => x.tipo === 'balanco')!;
  const folhas = folhasDoPassivo(b.dados.contas as { conta: string; saldo: number }[]);
  const mapa = mapaDoEndividamento({ fonte: 'Balanço contábil 2025', ref: { arquivo: 'Balanço 2025.pdf' }, contas: folhas })!;

  test('só as contas folha do passivo, sem grupos nem PL', () => {
    expect(folhas.map((f) => f.conta)).toEqual(['FORNECEDORES', 'IMPOSTOS E CONTRIBUIÇÕES A RECOLHER', 'ADIANTAMENTOS A CLIENTES', 'OUTROS DÉBITOS COM SÓCIOS', 'PARCELAMENTOS']);
    expect(mapa.total).toBe(53e6);
  });

  test('o mapa separa o que se sujeita à RJ e aponta a principal dor', () => {
    expect(mapa.categorias[0]).toMatchObject({ categoria: 'Adiantamentos de clientes', rj: 'sujeito' });
    expect(mapa.foraDaRj).toBe(15e6); // tributos + parcelamentos
    expect(mapa.principalDor!.texto).toContain('provar o lastro');
  });

  test('enquadramento: requisitos atendidos, indícios e pendências, sem afirmar o que não foi provado', () => {
    const e = enquadramento({ razaoSocial: 'EJE INDUSTRIA DE METAIS LTDA', primeiroExercicio: 2021, anoBase: 2026, pendentesArt51: ['Relação nominal de credores'], mapa, patrimonioLiquido: -25e6, posicao: 'devedor' });
    const s = Object.fromEntries(e.rj.requisitos.map((r) => [r.fundamento, r.situacao]));
    expect(s).toMatchObject({ 'art. 1º': 'atendido', 'art. 48, caput': 'indicio', 'art. 48, I': 'pendente', 'art. 51': 'pendente' });
    expect(e.re.requisitos.some((r) => r.fundamento.startsWith('art. 163'))).toBe(true);
    expect(e.caminhos.some((c) => c.includes('art. 53'))).toBe(true);
  });

  test('instituição financeira é impeditivo do art. 2º', () => {
    const e = enquadramento({ razaoSocial: 'BANCO ALFA S.A.', primeiroExercicio: null, anoBase: 2026, pendentesArt51: [], mapa: null, patrimonioLiquido: null, posicao: 'devedor' });
    expect(e.rj.requisitos.find((r) => r.fundamento === 'art. 2º')!.situacao).toBe('impeditivo');
  });
});

describe('revisão contra a Lei 11.101 (redação da Lei 14.112/2020)', () => {
  test('classes do art. 41 por natureza do crédito', () => {
    expect(CATEGORIA['Trabalhista e encargos'].classe).toContain('art. 41, I');
    expect(CATEGORIA['Fornecedores'].classe).toContain('III e IV');
    expect(CATEGORIA['Bancos e financiamentos'].fundamento).toContain('art. 41, II, e § 2º');
    expect(CATEGORIA['Sócios e partes relacionadas'].fundamento).toMatch(/art\. 43.*art\. 163, § 3º, II/);
  });
  test('fora da RJ e da RE: tributos (art. 6º, § 7º-B; art. 161, § 1º), fiduciário e ACC (art. 49, §§ 3º e 4º; art. 86, II)', () => {
    expect(CATEGORIA['Tributário e parcelamentos']).toMatchObject({ rj: 'nao_sujeito', re: 'excluido' });
    expect(CATEGORIA['Tributário e parcelamentos'].fundamento).toContain('art. 6º, § 7º-B');
    expect(CATEGORIA['Tributário e parcelamentos'].fundamento).toContain('art. 161, § 1º');
    expect(CATEGORIA['Bancos e financiamentos'].fundamento).toContain('art. 86, II');
    // bens de capital essenciais: proteção é do art. 49, § 3º, parte final (não do art. 6º, § 4º sozinho)
    expect(CATEGORIA['Garantia fiduciária e leasing'].fundamento).toContain('art. 49, § 3º, parte final');
    // trabalhista na RJ: classe I pelo total; o teto de 150 salários-mínimos é regra da falência
    expect(CATEGORIA['Trabalhista e encargos'].fundamento).toContain('rege a classificação na falência');
    expect(CATEGORIA['Trabalhista e encargos'].fundamento).toContain('art. 161, § 1º');
  });
  test('quóruns: art. 163 pede mais da metade por espécie e admite 1/3 + 90 dias', () => {
    expect(QUORUNS.re.find((q) => q.fundamento === 'art. 163, caput')!.regra).toContain('mais da metade');
    expect(QUORUNS.re.find((q) => q.fundamento === 'art. 163, § 7º')!.regra).toMatch(/1\/3.*90 dias/);
    expect(QUORUNS.rj.map((q) => q.fundamento)).toEqual(expect.arrayContaining(['art. 45, § 1º', 'art. 45, § 2º', 'art. 58, § 1º', 'art. 45-A']));
  });
  test('documentos do art. 51: cruza pelo fundamento do item e, sem ele, pelo título', () => {
    const d = documentosDoArt51([
      { titulo: 'Balanço Patrimonial, 3 últimos exercícios', artigo: 'Art. 51, II, Lei 11.101/2005', status: 'entregue' },
      { titulo: 'DRE', artigo: 'Art. 51, II', status: 'pendente' },
      { titulo: 'Lista completa de credores', artigo: 'Art. 51, III', status: 'pendente' },
      { titulo: 'Certidões de protesto', artigo: null, status: 'entregue' },
      { titulo: 'Relatório detalhado do Passivo Fiscal', artigo: 'Art. 51, X', status: 'entregue' },
    ]);
    const s = Object.fromEntries(d.map((x) => [x.inciso, x.situacao]));
    expect(d).toHaveLength(11);
    expect(s).toMatchObject({ II: 'parcial', III: 'pendente', VIII: 'entregue', X: 'entregue', I: 'fora_do_checklist', XI: 'fora_do_checklist' });
  });
  test('enquadramento traz os requisitos comuns, os do art. 163, § 6º, e o art. 51 cruzado', () => {
    const e = enquadramento({ razaoSocial: 'ALFA LTDA', primeiroExercicio: 2020, anoBase: 2026, pendentesArt51: [], mapa: null, patrimonioLiquido: null, posicao: 'devedor', checklist: [{ titulo: 'Lista completa de credores', artigo: 'Art. 51, III', status: 'pendente' }] });
    expect(e.comuns.map((q) => q.fundamento)).toEqual(['art. 1º', 'art. 2º', 'art. 48, caput', 'art. 48, I', 'art. 48, II e III', 'art. 48, IV']);
    expect(e.re.requisitos.some((q) => q.fundamento === 'arts. 162 e 163, § 6º')).toBe(true);
    expect(e.rj.requisitos.find((q) => q.fundamento === 'art. 51')!.situacao).toBe('pendente');
    expect(e.documentosArt51.find((d) => d.inciso === 'III')!.situacao).toBe('pendente');
  });
});

describe('documento do diagnóstico (aba e PDF)', () => {
  const bal = lerDocumentoPdf('Balanço 2025.pdf', [BALANCO]).extracoes.find((x) => x.tipo === 'balanco')!;
  const mapa = mapaDoEndividamento({ fonte: 'Balanço contábil 2025', ref: { arquivo: 'Balanço 2025.pdf' }, contas: folhasDoPassivo(bal.dados.contas as { conta: string; saldo: number }[]) })!;
  const base = { projeto: { nome: 'P', razaoSocial: 'EJE INDUSTRIA DE METAIS LTDA', posicao: 'devedor' as const, cnpj: '11.222.333/0001-81' }, dataBase: '2026-11-10', geradoPor: 'T', versao: 2, documentos: [], checklist: [], portal: { obrigatorios: 0, enviados: 0, aprovados: 0 }, balancos: [], dres: [], extratos: [], passivo: [], clientesAbc: [], relacionadas: [] };
  const r = montarRelatorio({ ...base, endividamento: [mapa], faturamento: [{ ano: 2024, ref: { arquivo: 'f.pdf' }, fiscal: 10e6, gerencial: 20e6 }, { ano: 2025, ref: { arquivo: 'f.pdf' }, fiscal: 12e6, gerencial: 25e6 }] });
  const h = renderizarDiagnostico(r);
  test('capa, sumário com as 12 seções e gráficos na largura útil da página (265 mm)', () => {
    expect(h).toContain('CNPJ 11.222.333/0001-81');
    expect((h.match(/data-pag="/g) ?? []).length).toBe(12);
    expect(h).toContain('viewBox="0 0 265 ');
    expect(h).toContain('Classe III (art. 41, III)');
  });
  test('versão antiga, gravada sem os campos novos, continua abrindo', () => {
    const antiga = JSON.parse(JSON.stringify(r));
    delete antiga.juridico.comuns; delete antiga.juridico.documentosArt51; delete antiga.capa.cnpj;
    for (const c of antiga.endividamento[0].categorias) delete c.classe;
    const x = renderizarDiagnostico(antiga);
    expect(x).toContain('Gere uma nova versão');
    expect((x.match(/class="dg-secao"/g) ?? []).length).toBe(12);
  });
});
