import { describe, expect, test } from 'bun:test';
import { classificar } from '../src/domain/analise/classificacao.ts';

describe('classificação por sinais', () => {
  test('petição inicial de recuperação judicial', () => {
    const c = classificar([
      'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 1ª VARA DE FALÊNCIAS E RECUPERAÇÕES',
      'INDÚSTRIA DEMO LTDA. vem respeitosamente requerer a recuperação judicial, nos',
      'termos do art. 51 da Lei 11.101/2005, diante da crise econômico-financeira',
      'instalada a partir da retração do mercado.',
    ].join('\n'));

    expect(c.tipo).toBe('peticao_inicial_rj');
    expect(c.certeza).toBe('alta');
    expect(c.exigeValidacaoHumana).toBe(true);
  });

  test('ata de assembleia geral de credores', () => {
    const c = classificar([
      'ATA DA ASSEMBLEIA GERAL DE CREDORES',
      'Instalada em primeira convocação, conferida a lista de presença e verificado',
      'o quórum, a sessão foi presidida pelo administrador judicial.',
      'Apurado o resultado da votação, foi encerrada a assembleia.',
    ].join('\n'));

    expect(c.tipo).toBe('ata_agc');
    expect(c.certeza).toBe('alta');
  });

  test('o motivo da classificação é mostrável — cada sinal com sua posição', () => {
    const texto = 'DANFE — Documento Auxiliar da Nota Fiscal Eletrônica. Chave de acesso: 1234.';
    const c = classificar(texto);
    expect(c.tipo).toBe('nota_fiscal');
    expect(c.sinais.map((s) => s.termo)).toContain('danfe');
    for (const s of c.sinais) expect(s.posicao).toBeGreaterThanOrEqual(0);
    expect(c.criterio).toContain('pontos');
  });

  test('sentença de falência é sentença, e a decisão fica como alternativa', () => {
    // A sentença também traz os sinais de decisão — e deve, porque é uma.
    // O esperado é a ordem certa, não a ausência do concorrente.
    const c = classificar([
      'Isso posto, DECRETO A FALÊNCIA de INDÚSTRIA DEMO LTDA., nos termos do art. 73.',
      'A presente sentença produz os efeitos do art. 99.',
      'Publique-se, registre-se, intime-se.',
    ].join('\n'));

    expect(c.tipo).toBe('sentenca');
    expect(c.alternativas.map((a) => a.tipo)).toContain('decisao_judicial');
  });

  test('plano modificativo vence o plano original, mas com certeza baixa', () => {
    // Um modificativo tem quase todos os sinais de um plano. O sistema acerta
    // a ordem e DECLARA que a disputa foi apertada, em vez de fingir certeza.
    const c = classificar([
      'PRIMEIRA MODIFICAÇÃO DO PLANO DE RECUPERAÇÃO JUDICIAL',
      'Plano modificativo apresentado nos termos do art. 56.',
      'Mantêm-se o deságio, a carência e a novação previstos para a Classe III.',
    ].join('\n'));

    expect(c.tipo).toBe('plano_modificativo');
    expect(c.alternativas[0]!.tipo).toBe('plano_recuperacao');
    expect(c.certeza).toBe('baixa');
    expect(c.criterio).toContain('disputados');
  });

  test('sinal fraco devolve certeza baixa, não um palpite confiante', () => {
    const c = classificar(
      'Pelo presente instrumento, as partes elegem o foro da Comarca de Curitiba.');
    expect(c.tipo).toBe('contrato');
    expect(c.certeza).toBe('baixa');
  });
});

describe('na dúvida, não classifica', () => {
  test('texto sem sinal volta como desconhecido', () => {
    const c = classificar('Prezados, segue em anexo o comprovante do mês de outubro.');
    expect(c.tipo).toBe('desconhecido');
    expect(c.certeza).toBe('nenhuma');
    expect(c.criterio).toContain('mínimos');
  });

  test('sinal isolado não é suficiente', () => {
    // "certidão" sozinho vale 2 pontos: abaixo do mínimo, volta sem tipo.
    const c = classificar('Certidão de objeto e pé.');
    expect(c.tipo).toBe('desconhecido');
    expect(c.pontos).toBeLessThan(5);
  });

  test('documento vazio não quebra nem inventa tipo', () => {
    const c = classificar('');
    expect(c.tipo).toBe('desconhecido');
    expect(c.pontos).toBe(0);
    expect(c.sinais).toHaveLength(0);
  });
});

describe('robustez do reconhecimento', () => {
  test('acento, caixa e ordinal não atrapalham', () => {
    const comTipografia = classificar(
      'Requer a recuperação judicial, nos termos do art. 51, § 1º, diante da ' +
      'crise econômico-financeira. EXCELENTÍSSIMO SENHOR DOUTOR JUIZ.');
    const semTipografia = classificar(
      'requer a recuperacao judicial, nos termos do art. 51, 1, diante da ' +
      'crise economico-financeira. excelentissimo senhor doutor juiz.');
    expect(comTipografia.tipo).toBe(semTipografia.tipo);
    expect(comTipografia.pontos).toBe(semTipografia.pontos);
  });

  test('"art. 83" não vale como sinal de "art. 8"', () => {
    // Art. 83 é a ordem de classificação na falência; art. 8º é a impugnação
    // de crédito. Confundir os dois classifica a peça errada.
    const c = classificar('A ordem do art. 83 da LREF rege o pagamento na falência.');
    expect(c.alternativas.some((a) => a.tipo === 'impugnacao_credito')).toBe(false);
    expect(c.tipo).not.toBe('impugnacao_credito');
  });

  test('repetir o mesmo termo não aumenta a pontuação', () => {
    const uma = classificar('Objeção ao plano, nos termos do art. 55.');
    const muitas = classificar(
      'Objeção ao plano, nos termos do art. 55. ' + 'Objeção ao plano. '.repeat(20));
    expect(muitas.pontos).toBe(uma.pontos);
  });
});
