import { describe, expect, test } from 'bun:test';
import {
  MINIMO_ANCORAVEL, ancorar, conferirCitacoes, dividir, parteDa,
} from '../src/domain/analise/trechos.ts';

const CLAUSULA = [
  'CLÁUSULA 7ª — DO DESÁGIO',
  'Os créditos da Classe III sofrerão deságio de 70% (setenta por cento) sobre',
  'o valor nominal, com carência de 36 (trinta e seis) meses contados da',
  'homologação judicial do plano.',
].join('\n');

describe('ancoragem de citação', () => {
  test('citação literal ancora e devolve o trecho do documento', () => {
    const a = ancorar(CLAUSULA, 'deságio de 70% (setenta por cento)');
    expect(a).not.toBeNull();
    expect(a!.trechoReal).toBe('deságio de 70% (setenta por cento)');
    expect(CLAUSULA.slice(a!.inicio, a!.fim)).toBe(a!.trechoReal);
    expect(a!.divergeDoCitado).toBe(false);
  });

  test('quebra de linha no meio da citação não impede a ancoragem', () => {
    // O modelo lê o texto corrido; o documento tem a frase quebrada em duas
    // linhas. Exigir igualdade byte a byte rejeitaria achado correto.
    const a = ancorar(CLAUSULA, 'deságio de 70% (setenta por cento) sobre o valor nominal');
    expect(a).not.toBeNull();
    expect(a!.trechoReal).toContain('\n');
  });

  test('acento e caixa perdidos no OCR não impedem a ancoragem', () => {
    const a = ancorar(CLAUSULA, 'CARENCIA DE 36 (TRINTA E SEIS) MESES');
    expect(a).not.toBeNull();
    // E o que volta é a grafia do DOCUMENTO, não a do que foi citado.
    expect(a!.trechoReal).toBe('carência de 36 (trinta e seis) meses');
    expect(a!.divergeDoCitado).toBe(true);
  });

  test('citação inventada NÃO ancora', () => {
    // É este null que impede o achado alucinado de chegar ao advogado.
    expect(ancorar(CLAUSULA, 'deságio de 30% (trinta por cento)')).toBeNull();
    expect(ancorar(CLAUSULA, 'carência de 60 (sessenta) meses')).toBeNull();
  });

  test('uma palavra trocada no meio derruba a ancoragem', () => {
    expect(ancorar(CLAUSULA, 'créditos da Classe II sofrerão deságio')).toBeNull();
  });

  test('citação curta demais é recusada por não provar nada', () => {
    expect('deságio'.length).toBeLessThan(MINIMO_ANCORAVEL);
    expect(ancorar(CLAUSULA, 'deságio')).toBeNull();
    expect(ancorar(CLAUSULA, '70%')).toBeNull();
  });

  test('conferência em lote separa o que ancora do que não', () => {
    const { ancoradas, recusadas } = conferirCitacoes(CLAUSULA, [
      'deságio de 70% (setenta por cento)',
      'deságio de 15% (quinze por cento)',
      'homologação judicial do plano',
    ]);
    expect(ancoradas).toHaveLength(2);
    expect(recusadas).toEqual(['deságio de 15% (quinze por cento)']);
  });
});

describe('divisão em partes', () => {
  const longo = Array.from({ length: 200 },
    (_, i) => `Parágrafo ${i + 1}. ${'texto jurídico '.repeat(12)}`).join('\n\n');

  test('as partes recobrem o documento inteiro, em ordem', () => {
    const partes = dividir(longo, { maximo: 3000 });
    expect(partes.length).toBeGreaterThan(1);
    expect(partes[0]!.inicio).toBe(0);
    expect(partes.at(-1)!.fim).toBe(longo.length);
    for (const p of partes) expect(longo.slice(p.inicio, p.fim)).toBe(p.texto);
  });

  test('há sobreposição entre partes consecutivas', () => {
    // Um fato escrito exatamente sobre o corte não pode desaparecer.
    const partes = dividir(longo, { maximo: 3000, sobreposicao: 300 });
    for (let i = 1; i < partes.length; i++) {
      expect(partes[i]!.inicio).toBeLessThan(partes[i - 1]!.fim);
    }
  });

  test('respeita o tamanho máximo', () => {
    for (const p of dividir(longo, { maximo: 2000 })) {
      expect(p.texto.length).toBeLessThanOrEqual(2000);
    }
  });

  test('corta em fronteira de parágrafo quando possível', () => {
    const partes = dividir(longo, { maximo: 3000 });
    expect(partes[0]!.texto).toEndWith('\n\n');
  });

  test('documento curto fica numa parte só', () => {
    const partes = dividir(CLAUSULA, { maximo: 12000 });
    expect(partes).toHaveLength(1);
    expect(partes[0]!.texto).toBe(CLAUSULA);
  });

  test('texto vazio não gera parte', () => {
    expect(dividir('')).toHaveLength(0);
  });

  test('marcação de página é propagada', () => {
    const comPaginas = [
      '--- página 1 ---', 'a'.repeat(1500),
      '--- página 2 ---', 'b'.repeat(1500),
      '--- página 3 ---', 'c'.repeat(1500),
    ].join('\n\n');
    const partes = dividir(comPaginas, {
      maximo: 1800, marcadorDePagina: /--- página (\d+) ---/,
    });
    expect(partes[0]!.pagina).toBe(1);
    expect(partes.at(-1)!.pagina).toBeGreaterThan(1);
  });

  test('a posição de um achado se localiza na parte certa', () => {
    const partes = dividir(longo, { maximo: 3000 });
    const posicao = longo.indexOf('Parágrafo 150.');
    const parte = parteDa(partes, posicao);
    expect(parte).toBeDefined();
    expect(parte!.texto).toContain('Parágrafo 150.');
  });

  test('parte menor que 100 caracteres é recusada', () => {
    expect(() => dividir(longo, { maximo: 50 })).toThrow('100 caracteres');
  });
});
