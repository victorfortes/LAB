import { expect, test } from 'bun:test';
import { avaliar, trechoDoProcesso } from '../src/domain/sentinela/matcher.ts';
import { normalizar } from '../src/domain/sentinela/nomes.ts';

const cli = { nomes: [{ nome: 'CONDUSCABOS BRASIL INDUSTRIA COMERCIO DE CONDUTORES ELETRICOS LTDA', nome_norm: normalizar('CONDUSCABOS BRASIL INDUSTRIA COMERCIO DE CONDUTORES ELETRICOS LTDA'), tipo: 'razao_social' }], cnpjs: [] };
const edital = [
  'EDITAL DE PAUTA. 8040850-37.2026.8.05.0000 PARTES: BANCO X S.A. FULANO DE TAL ADVOGADO(S): BELTRANO',
  '8065454-62.2026.8.05.0000 PARTES: ITAU UNIBANCO S.A. CONDUSCABOS BRASIL INDUSTRIA COMERCIO DE CONDUTORES ELETRICOS LTDA ADVOGADO(S): GUSTAVO',
  '8071238-87.2026.8.05.0000 PARTES: EMPRESA Y LTDA MARIA ADVOGADO(S): JOAO',
].join(' ');

test('pauta/edital coletivo: nome no trecho de outro processo é descartado', () => {
  const m = avaliar(cli, { texto: edital, destinatarios: [], numero_processo: '80408503720268050000' });
  expect(m?.classificacao).toBe('descartada');
  expect(String(m?.evidencia.regra)).toContain('coletiva');
});

test('pauta/edital coletivo: no trecho do próprio processo continua a ser avaliado', () => {
  expect(trechoDoProcesso(edital, '80654546220268050000')).toContain('CONDUSCABOS');
  const m = avaliar(cli, { texto: edital, destinatarios: [], numero_processo: '80654546220268050000' });
  expect(m?.classificacao).toBe('inconclusiva');
});

test('publicação de um processo só não muda de comportamento', () => {
  expect(trechoDoProcesso('Processo 8065454-62.2026.8.05.0000 em face de CONDUSCABOS', '80654546220268050000')).toBeNull();
});
