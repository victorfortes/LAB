import { describe, expect, test } from 'bun:test';
import { extrairMovimento, limparTexto, sugerirLancamento, ehInsolvencia, prazoExpresso } from '../src/domain/controladoria/padroes.ts';

const projudi = (mov: string) => `Intimação referente ao movimento (seq. 7) ${mov} (27/10/2026). Acesse o sistema Projudi do Tribunal de Justiça do Paraná para mais detalhes.`;

describe('padrões de lançamento da controladoria', () => {
  test('lê o movimento do Projudi e repete o padrão "AÇÃO - ATO" do Astrea', () => {
    expect(extrairMovimento(projudi('JUNTADA DE INTIMAÇÃO - CUSTAS PROCESSUAIS'))).toBe('JUNTADA DE INTIMAÇÃO - CUSTAS PROCESSUAIS');
    const s = sugerirLancamento({ texto: projudi('JUNTADA DE INTIMAÇÃO - CUSTAS PROCESSUAIS'), classe: 'EXECUÇÃO DE TÍTULO EXTRAJUDICIAL', tipo: 'Intimação' });
    expect(s).toMatchObject({ titulo: 'MANIFESTAR - JUNTADA DE INTIMAÇÃO - CUSTAS PROCESSUAIS', dias: 5, regime: 'uteis' });
    expect(s.confianca).toBeGreaterThanOrEqual(0.8);
  });
  test('despacho de mero expediente e decisão: manifestar em 5 dias úteis (art. 218, § 3º)', () => {
    expect(sugerirLancamento({ texto: projudi('PROFERIDO DESPACHO DE MERO EXPEDIENTE'), tipo: 'Intimação' }).titulo).toBe('MANIFESTAR - PROFERIDO DESPACHO DE MERO EXPEDIENTE');
    const d = sugerirLancamento({ texto: projudi('DEFERIDO O PEDIDO'), tipo: 'Intimação' });
    expect(d).toMatchObject({ titulo: 'MANIFESTAR - DEFERIDO O PEDIDO', dias: 5 });
    expect(d.fundamento).toContain('218');
  });
  test('distribuição e pauta', () => {
    expect(sugerirLancamento({ texto: projudi('DISTRIBUÍDO POR PREVENÇÃO'), tipo: 'Intimação' }).titulo).toBe('MERA CIÊNCIA - DISTRIBUÍDO POR PREVENÇÃO');
    const p = sugerirLancamento({ texto: projudi('INCLUÍDO EM PAUTA PARA SESSÃO VIRTUAL DE 07/12/2026 00:00 ATÉ 11/12/2026 23:59'), tipo: 'Intimação' });
    expect(p.titulo).toContain('sustentação oral');
  });
  test('insolvência conta em dias corridos (art. 189, § 1º, I), menos recurso', () => {
    expect(ehInsolvencia('RECUPERAçãO JUDICIAL')).toBe(true);
    const rj = sugerirLancamento({ texto: projudi('JUNTADA DE PETIÇÃO DE HABILITAÇÃO'), classe: 'RECUPERAçãO JUDICIAL', tipo: 'Intimação' });
    expect(rj.regime).toBe('corridos'); expect(rj.fundamento).toContain('189');
    const rec = sugerirLancamento({ texto: projudi('JULGADO PROCEDENTE O PEDIDO - SENTENÇA'), classe: 'FALêNCIA DE EMPRESÁRIOS', tipo: 'Intimação' });
    expect(rec).toMatchObject({ dias: 15, regime: 'uteis', recursal: true });
  });
  test('prazo fixado no ato vence a regra padrão; HTML do e-SAJ é limpo', () => {
    expect(prazoExpresso('Manifeste-se a parte no prazo de 10 (dez) dias.')).toBe(10);
    const t = limparTexto('<table><tr><td>Despacho</td></tr></table><p>Intime-se para manifesta&ccedil;&atilde;o no prazo de 15 dias.</p>');
    expect(t).toContain('manifestação');
    expect(sugerirLancamento({ texto: '<p>Despacho: intime-se para manifesta&ccedil;&atilde;o no prazo de 15 dias.</p>', tipo: 'Intimação' })).toMatchObject({ dias: 15, acao: 'MANIFESTAR' });
  });
  test('sem ato identificável: análise com confiança baixa', () => {
    const s = sugerirLancamento({ texto: 'Comunicação genérica sem palavras-chave.', tipo: 'Intimação' });
    expect(s).toMatchObject({ titulo: 'Analisar intimação + Manifestar', regra: 'padrao' });
    expect(s.confianca).toBeLessThan(0.5);
  });
});
