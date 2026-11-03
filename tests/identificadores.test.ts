import { describe, expect, test } from 'bun:test';
import {
  agruparPorTipo, digitoDoProcesso, extrairIdentificadores, formatarCnpj,
  formatarProcesso, validarCnpj, validarCpf, validarProcessoCnj,
} from '../src/domain/analise/identificadores.ts';

describe('CNPJ', () => {
  test('CNPJ real conhecido confere', () => {
    // Banco do Brasil e Petrobras: números públicos, úteis justamente porque
    // conferem o algoritmo contra a realidade, não contra si mesmo.
    expect(validarCnpj('00.000.000/0001-91')).toBe(true);
    expect(validarCnpj('33.000.167/0001-01')).toBe(true);
  });

  test('dígito trocado é recusado', () => {
    expect(validarCnpj('33.000.167/0001-02')).toBe(false);
    expect(validarCnpj('00.000.000/0001-90')).toBe(false);
  });

  test('CNPJ alfanumérico (IN RFB 2.229/2024) usa o mesmo cálculo', () => {
    expect(validarCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(validarCnpj('12.ABC.345/01DE-36')).toBe(false);
  });

  test('sequência de caractere repetido não é CNPJ', () => {
    expect(validarCnpj('00.000.000/0000-00')).toBe(false);
    expect(validarCnpj('11111111111111')).toBe(false);
  });

  test('tamanho errado é recusado', () => {
    expect(validarCnpj('33.000.167/0001')).toBe(false);
    expect(validarCnpj('')).toBe(false);
  });

  test('minúscula no alfanumérico é aceita e normalizada', () => {
    expect(validarCnpj('12.abc.345/01de-35')).toBe(true);
    expect(formatarCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
  });
});

describe('CPF', () => {
  test('CPF com dígito correto', () => {
    expect(validarCpf('111.444.777-35')).toBe(true);
    expect(validarCpf('529.982.247-25')).toBe(true);
  });

  test('dígito trocado e sequência repetida', () => {
    expect(validarCpf('111.444.777-36')).toBe(false);
    expect(validarCpf('000.000.000-00')).toBe(false);
    expect(validarCpf('123.456.789-00')).toBe(false);
  });
});

describe('número único do processo (Res. CNJ 65/2008)', () => {
  test('dígito verificador calculado', () => {
    expect(digitoDoProcesso({
      sequencial: '0001234', ano: '2024', segmento: '8', tribunal: '16', origem: '0001',
    })).toBe('56');
  });

  test('valida e identifica o segmento', () => {
    expect(validarProcessoCnj('0001234-56.2024.8.16.0001')).toBe(true);
    expect(validarProcessoCnj('0001234-57.2024.8.16.0001')).toBe(false);
  });

  test('aceita sem pontuação e devolve formatado', () => {
    expect(validarProcessoCnj('00012345620248160001')).toBe(true);
    expect(formatarProcesso('00012345620248160001')).toBe('0001234-56.2024.8.16.0001');
  });
});

describe('varredura de documento', () => {
  const peticao = [
    'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 1ª VARA DE FALÊNCIAS',
    'Processo nº 0001234-56.2024.8.16.0001',
    'INDÚSTRIA DEMO LTDA., CNPJ 33.000.167/0001-01, por seu administrador',
    'João da Silva, CPF 111.444.777-35, vem requerer recuperação judicial.',
    'O passivo concursal soma R$ 12.450.000,00, sendo R$ 980.500,35 de natureza',
    'trabalhista, com juros de 1,50% ao mês desde 15/03/2024.',
    'Curitiba, 2 de outubro de 2026.',
    'ADVOGADO RESPONSÁVEL — OAB/PR 12.345',
  ].join('\n');

  const porTipo = agruparPorTipo(extrairIdentificadores(peticao));

  test('acha o processo com o segmento certo', () => {
    expect(porTipo.processo_cnj).toHaveLength(1);
    expect(porTipo.processo_cnj![0]!.valido).toBe(true);
    expect(porTipo.processo_cnj![0]!.observacao).toBe('Justiça Estadual');
  });

  test('acha CNPJ e CPF sem confundir um com o outro', () => {
    expect(porTipo.cnpj!.map((o) => o.canonico)).toEqual(['33000167000101']);
    expect(porTipo.cpf!.map((o) => o.canonico)).toEqual(['11144477735']);
  });

  test('valores vêm em centavos', () => {
    expect(porTipo.valor!.map((o) => o.canonico)).toEqual(['1245000000', '98050035']);
  });

  test('percentual NÃO é lido como dinheiro', () => {
    // "juros de 1,50% ao mês" entrando como R$ 1,50 num quadro de credores é
    // pior do que valor nenhum.
    expect(porTipo.valor!.some((o) => o.canonico === '150')).toBe(false);
  });

  test('datas numéricas e por extenso viram ISO', () => {
    expect(porTipo.data!.map((o) => o.canonico)).toEqual(['2024-03-15', '2026-10-02']);
  });

  test('OAB é extraída, e declarada não conferida', () => {
    expect(porTipo.oab![0]!.canonico).toBe('PR 12345');
    expect(porTipo.oab![0]!.observacao).toContain('não conferida');
  });

  test('as posições apontam para o texto', () => {
    for (const o of extrairIdentificadores(peticao)) {
      expect(peticao.slice(o.posicao, o.posicao + o.bruto.length)).toBe(o.bruto);
    }
  });
});

describe('o inválido é relatado, não escondido', () => {
  test('CNPJ com dígito errado aparece marcado como inválido', () => {
    // Quem descarta em silêncio esconde do advogado exatamente o que ele
    // precisa ver numa habilitação de crédito.
    const o = extrairIdentificadores('CNPJ 33.000.167/0001-99 do requerente');
    expect(o).toHaveLength(1);
    expect(o[0]!.valido).toBe(false);
    expect(o[0]!.observacao).toBe('dígito verificador não confere');
  });

  test('processo com dígito errado informa o esperado', () => {
    const o = extrairIdentificadores('Autos 0001234-99.2024.8.16.0001');
    expect(o[0]!.valido).toBe(false);
    expect(o[0]!.observacao).toContain('esperado 56');
  });

  test('31 de fevereiro é relatado como data inexistente', () => {
    const o = extrairIdentificadores('vencimento em 31/02/2025');
    expect(o[0]!.valido).toBe(false);
    expect(o[0]!.observacao).toBe('data inexistente no calendário');
  });

  test('14 dígitos sem máscara que não fecham não entram como CNPJ', () => {
    // Código de barras e protocolo também têm 14 dígitos.
    expect(extrairIdentificadores('protocolo 12345678901234')).toHaveLength(0);
  });
});
