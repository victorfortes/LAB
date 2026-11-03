import { describe, expect, test } from 'bun:test';
import { Construtor, renderizar } from '../src/relatorio/modelo.ts';
import { ehPdf, paginasDoPdf, textoDoPdf, trechosDoPdf } from './apoio/pdf.ts';

const cabecalho = {
  titulo: 'Relatório mensal de acompanhamento',
  subtitulo: 'Recuperação judicial · Grupo Demonstração',
  geradoPor: 'Sócio de Demonstração',
  geradoEm: '2026-11-02T14:30:00.000Z',
};

async function gerar(montar: (c: Construtor) => void): Promise<Uint8Array> {
  const c = new Construtor();
  montar(c);
  return renderizar(c.montar(cabecalho));
}

describe('o arquivo é um PDF de verdade', () => {
  test('assinatura, páginas e texto legível', async () => {
    const pdf = await gerar((c) => c.paragrafo('Conteúdo do relatório.'));
    expect(ehPdf(pdf)).toBe(true);
    expect(paginasDoPdf(pdf)).toBe(1);
    expect(textoDoPdf(pdf)).toContain('Conteúdo do relatório.');
  });

  test('o título, a marca e o rodapé entram', async () => {
    const pdf = await gerar((c) => c.paragrafo('x'));
    const t = textoDoPdf(pdf);
    expect(t).toContain('Relatório mensal de acompanhamento');
    expect(t).toContain('NGA');
    expect(t).toContain('LAB');
    expect(t).toContain('1 de 1');
    expect(t).toContain('02/11/2026');
    expect(t).toContain('Sócio de Demonstração');
  });

  test('acento, cifrão e símbolo de parágrafo sobrevivem', async () => {
    const pdf = await gerar((c) =>
      c.paragrafo('Deságio de 70% — art. 6º, § 4º — R$ 12.450.000,00; ação, çedilha.'));
    const t = textoDoPdf(pdf);
    expect(t).toContain('Deságio de 70%');
    expect(t).toContain('art. 6º, § 4º');
    expect(t).toContain('R$ 12.450.000,00');
  });

  test('nome fora do cp1252 não derruba a geração', async () => {
    const pdf = await gerar((c) => c.campo('Credor', 'Mikołaj Przedsiębiorstwo'));
    expect(textoDoPdf(pdf)).toContain('Mikolaj');
  });
});

describe('§15 — dado que não existe não vira número', () => {
  test('tabela sem linhas vira frase explicando a ausência', async () => {
    const pdf = await gerar((c) => c.tabela({
      colunas: [{ titulo: 'Data', largura: 120 }, { titulo: 'Valor', largura: 120 }],
      linhas: [],
      seVazio: 'Nenhum lançamento financeiro foi registrado neste período.',
    }));
    const t = textoDoPdf(pdf);
    expect(t).toContain('Nenhum lançamento financeiro foi registrado neste período.');
    // E não aparece cabeçalho de tabela vazia fingindo que há o que ler.
    expect(t).not.toContain('VALOR');
  });

  test('a frase de ausência longa é quebrada, não sai pela margem', async () => {
    const motivo = 'Nenhum crédito com classe validada por pessoa. O quadro só considera '
      + 'crédito validado; enquanto a validação não ocorre, não há consolidado a apresentar.';
    const pdf = await gerar((c) => c.tabela({
      colunas: [{ titulo: 'Classe', largura: 100 }], linhas: [], seVazio: motivo,
    }));
    const partes = trechosDoPdf(pdf).filter((t) => motivo.startsWith(t.slice(0, 20)) || motivo.includes(t));
    const inicio = trechosDoPdf(pdf).find((t) => t.startsWith('Nenhum crédito'));
    expect(inicio).toBeDefined();
    // Quebrada: o primeiro pedaço não contém a frase inteira.
    expect(inicio!.length).toBeLessThan(motivo.length);
    expect(partes.length).toBeGreaterThan(1);
  });

  test('a ausência sobe para a lista do fim do relatório', async () => {
    const pdf = await gerar((c) => {
      c.tabela({ colunas: [{ titulo: 'X', largura: 100 }], linhas: [], seVazio: 'Sem obrigações vencidas.' });
      c.tabela({ colunas: [{ titulo: 'Y', largura: 100 }], linhas: [], seVazio: 'Sem movimentações publicadas.' });
    });
    const t = textoDoPdf(pdf);
    expect(t).toContain('O QUE ESTE RELATÓRIO NÃO AFIRMA');
    expect(t).toContain('Sem obrigações vencidas.');
    expect(t).toContain('Sem movimentações publicadas.');
  });

  test('sem lacuna, o relatório diz isso em vez de omitir a seção', async () => {
    const pdf = await gerar((c) => c.tabela({
      colunas: [{ titulo: 'Credor', largura: 200 }],
      linhas: [['Banco Fictício S.A.']],
      seVazio: 'sem credores',
    }));
    const t = textoDoPdf(pdf);
    expect(t).toContain('Todas as seções deste relatório foram preenchidas');
  });

  test('campo sem valor sai como "não informado", nunca em branco', async () => {
    const pdf = await gerar((c) => c.campo('Comarca', null));
    expect(textoDoPdf(pdf)).toContain('não informado');
  });

  test('toda fonte declarada é impressa', async () => {
    const pdf = await gerar((c) => {
      c.tabela({
        colunas: [{ titulo: 'C', largura: 100 }], linhas: [['x']],
        seVazio: 'vazio', fonte: 'tabela creditos, classe validada por pessoa',
      });
      c.fonte('tabela lancamentos, situação realizada');
    });
    const t = textoDoPdf(pdf);
    expect(t).toContain('PROCEDÊNCIA DOS DADOS');
    expect(t).toContain('tabela creditos, classe validada por pessoa');
    expect(t).toContain('tabela lancamentos, situação realizada');
  });

  test('o aviso de documento gerado está em todo relatório', async () => {
    const pdf = await gerar((c) => c.paragrafo('x'));
    expect(textoDoPdf(pdf)).toContain('não substituem');
  });
});

describe('paginação', () => {
  test('conteúdo longo gera mais de uma página e numera certo', async () => {
    const pdf = await gerar((c) => {
      for (let i = 1; i <= 120; i++) c.paragrafo(`Parágrafo ${i} do relatório extenso.`);
    });
    const paginas = paginasDoPdf(pdf);
    expect(paginas).toBeGreaterThan(2);
    const t = textoDoPdf(pdf);
    expect(t).toContain('Parágrafo 1 ');
    expect(t).toContain('Parágrafo 120 ');
    expect(t).toContain(`1 de ${paginas}`);
    expect(t).toContain(`${paginas} de ${paginas}`);
  });

  test('tabela que vira a folha repete o cabeçalho', async () => {
    const pdf = await gerar((c) => c.tabela({
      colunas: [{ titulo: 'Credor', largura: 300 }, { titulo: 'Valor', largura: 199, tecnico: true }],
      linhas: Array.from({ length: 90 }, (_, i) => [`Credor ${i + 1}`, `${i + 1}.000,00`]),
      seVazio: 'sem credores',
    }));
    expect(paginasDoPdf(pdf)).toBeGreaterThan(1);
    // Uma ocorrência do cabeçalho por página de tabela: sem isso o leitor
    // precisa voltar uma folha para saber o que é cada coluna.
    const cabecalhos = trechosDoPdf(pdf).filter((x) => x === 'CREDOR').length;
    expect(cabecalhos).toBeGreaterThan(1);
  });

  test('a última linha da tabela não se perde na virada', async () => {
    const pdf = await gerar((c) => c.tabela({
      colunas: [{ titulo: 'Item', largura: 400 }],
      linhas: Array.from({ length: 60 }, (_, i) => [`Item ${i + 1}`]),
      seVazio: 'vazio',
    }));
    const t = textoDoPdf(pdf);
    for (const i of [1, 30, 45, 60]) expect(t).toContain(`Item ${i}`);
  });
});

describe('tabela', () => {
  test('texto longo em célula é encurtado, não estoura a coluna', async () => {
    const pdf = await gerar((c) => c.tabela({
      colunas: [{ titulo: 'Credor', largura: 110 }],
      linhas: [['INDÚSTRIA DEMONSTRAÇÃO E PARTICIPAÇÕES SOCIETÁRIAS DO PARANÁ LTDA.']],
      seVazio: 'vazio',
    }));
    const encontrado = trechosDoPdf(pdf).find((x) => x.startsWith('INDÚSTRIA'));
    expect(encontrado).toBeDefined();
    expect(encontrado).toEndWith('...');
  });

  test('tabela sem coluna é erro de programação, não página torta', async () => {
    const c = new Construtor();
    c.tabela({ colunas: [], linhas: [['x']], seVazio: 'vazio' });
    expect(renderizar(c.montar(cabecalho))).rejects.toThrow('sem colunas');
  });
});
