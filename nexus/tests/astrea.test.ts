import { expect, test } from 'bun:test';
import { interpretarLinha, normalizarCnj, situacaoDaFase } from '../src/domain/processo/astrea.ts';
const CNJ = '0042910-33.2014.8.16.0001';
test('normaliza CNJ sem pontuação e com incidente, e recusa dígito errado', () => {
  expect(normalizarCnj(CNJ)).toBe(CNJ); expect(normalizarCnj('00429103320148160001')).toBe(CNJ); expect(normalizarCnj(`${CNJ}/50000`)).toBe(CNJ);
  expect(normalizarCnj('0042910-34.2014.8.16.0001')).toBeNull(); expect(normalizarCnj('1643591-3')).toBeNull(); expect(normalizarCnj('3445947/SP (2026/0468946-6)')).toBeNull();
});
test('fase define a situação', () => { expect(situacaoDaFase('Arquivado provisoriamente')).toBe('arquivado'); expect(situacaoDaFase('Encerrado Projuris')).toBe('arquivado'); expect(situacaoDaFase('Suspenso')).toBe('suspenso'); expect(situacaoDaFase(null)).toBe('ativo'); });
const CAB = ['Tipo', 'Título', 'Cliente', 'Número', 'Pasta', 'Etiquetas', 'Foro', 'Valor da causa', 'Responsável', 'Data de distribuição'];
test('etiquetas viram cliente, equipe e fase; cliente sem etiqueta não é inventado', () => {
  const r = interpretarLinha(CAB, ['Processo', 'A x B', 'Fulano', CNJ, '1', 'Cliente: CANET, Equipe: Cível, Fase: Em trâmite, Reestruturação', 'Curitiba/PR', 'R$ 18.296,73', 'Ana', '12/02/2026']);
  expect(r).toMatchObject({ clienteEtiqueta: 'CANET', equipe: 'Cível', fase: 'Em trâmite', reestruturacao: true, uf: 'PR', comarca: 'Curitiba', valorCausa: '1829673', numeroCnj: CNJ, distribuidoEm: '2026-02-12' });
  expect(interpretarLinha(CAB, ['Caso', 'X', 'Fulano', '', '', 'Fase: Consultivo', '', 'R$ 0,00', 'Ana', '']).clienteEtiqueta).toBeNull();
});
test('a chave não colide entre clientes do mesmo processo', () => { const a = interpretarLinha(CAB, ['Processo', 'T', 'A', CNJ, '1', '', '', '', '', '']); const b = interpretarLinha(CAB, ['Processo', 'T', 'B', CNJ, '1', '', '', '', '', '']); expect(a.chave).not.toBe(b.chave); });
