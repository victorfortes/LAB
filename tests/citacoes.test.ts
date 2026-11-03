import { describe, expect, test } from 'bun:test';
import {
  auditarCitacoes, extrairReferencias, tamanhoDoCorpus,
} from '../src/domain/analise/citacoes.ts';

describe('legislação dentro do corpus', () => {
  test('artigo com lei nomeada é verificado e traz a fonte oficial', () => {
    const [r] = extrairReferencias('Aplica-se o art. 41 da Lei 11.101/2005 ao caso.');
    expect(r!.natureza).toBe('legislacao');
    expect(r!.status).toBe('verificada');
    expect(r!.chave).toBe('lref:41');
    expect(r!.fonte).toContain('planalto.gov.br');
    expect(r!.diplomaPresumido).toBeUndefined();
  });

  test('parágrafo é dispositivo próprio', () => {
    const [r] = extrairReferencias('O art. 41, § 2º, da LREF desdobra o crédito.');
    expect(r!.chave).toBe('lref:41:2');
    expect(r!.status).toBe('verificada');
    expect(r!.ementa).toContain('garantia real');
  });

  test('sufixo de letra não é confundido com o parágrafo simples', () => {
    // § 7º-B do art. 6º trata de execução fiscal; § 7º é outra coisa.
    const [r] = extrairReferencias('art. 6º, § 7º-B, da Lei 11.101/2005');
    expect(r!.chave).toBe('lref:6:7-B');
    expect(r!.status).toBe('verificada');
  });

  test('artigo com sufixo, como o 51-A', () => {
    const [r] = extrairReferencias('a constatação prévia do art. 51-A da LREF');
    expect(r!.chave).toBe('lref:51-A');
    expect(r!.status).toBe('verificada');
  });

  test('apelidos da lei são reconhecidos', () => {
    for (const citacao of [
      'art. 47 da LREF', 'art. 47 da Lei de Recuperação Judicial e Falências',
      'art. 47 da Lei nº 11.101/2005', 'art. 47 da Lei 14.112/2020',
    ]) {
      const [r] = extrairReferencias(citacao);
      expect(r!.chave).toBe('lref:47');
      expect(r!.status).toBe('verificada');
    }
  });

  test('outros diplomas', () => {
    expect(extrairReferencias('art. 187 do CTN')[0]!.chave).toBe('ctn:187');
    expect(extrairReferencias('art. 406 do Código Civil')[0]!.chave).toBe('cc:406');
    expect(extrairReferencias('art. 300 do CPC')[0]!.chave).toBe('cpc:300');
  });

  test('o corpus não está vazio', () => {
    expect(tamanhoDoCorpus()).toBeGreaterThan(40);
  });
});

describe('o que NÃO pode passar como verificado', () => {
  test('artigo inexistente no corpus volta como não localizado', () => {
    // Este é o portão contra alucinação: a forma da citação é perfeita, e
    // mesmo assim não passa.
    const [r] = extrairReferencias('conforme o art. 999 da Lei 11.101/2005');
    expect(r!.status).toBe('nao_localizada');
    expect(r!.motivo).toContain('fora do corpus');
  });

  test('citação sem lei identificada não é adivinhada', () => {
    const [r] = extrairReferencias('nos termos do art. 41, o crédito vota.');
    expect(r!.status).toBe('nao_verificavel');
    expect(r!.chave).toBeNull();
    expect(r!.motivo).toContain('não identifica a lei');
  });

  test('diploma deduzido do contexto fica MARCADO como dedução', () => {
    // Deduzir é aceitável; esconder que se deduziu, não.
    const [r] = extrairReferencias('nos termos do art. 41, o crédito vota.',
      { diplomaPresumido: 'lref' });
    expect(r!.status).toBe('verificada');
    expect(r!.diplomaPresumido).toBe(true);
  });

  test('parágrafo fora do corpus não herda a verificação do caput', () => {
    const [r] = extrairReferencias('art. 47, § 9º, da LREF');
    expect(r!.status).toBe('nao_verificavel');
    expect(r!.motivo).toContain('não foi conferido');
    // Mas o caput localizado é devolvido, para o advogado partir de algum lugar.
    expect(r!.ementa).toContain('preservação da empresa');
  });
});

describe('jurisprudência: nada é verificável sem base integrada', () => {
  test('súmula', () => {
    const [r] = extrairReferencias('Aplica-se a Súmula 581 do STJ.');
    expect(r!.natureza).toBe('jurisprudencia');
    expect(r!.status).toBe('nao_verificavel');
    expect(r!.motivo).toContain('não há base de súmulas integrada');
  });

  test('julgado e tema repetitivo', () => {
    const r = extrairReferencias('REsp 1.234.567/SP e o Tema 1.051 do STJ.');
    expect(r).toHaveLength(2);
    for (const x of r) {
      expect(x.natureza).toBe('jurisprudencia');
      expect(x.status).toBe('nao_verificavel');
    }
  });

  test('nenhum julgado é marcado como verificado, nunca', () => {
    const r = extrairReferencias(
      'Conforme a Súmula Vinculante 10, o AgInt 987654/PR e o Tema 987 firmaram a tese.');
    expect(r.filter((x) => x.status === 'verificada')).toHaveLength(0);
  });
});

describe('auditoria da análise', () => {
  const parecer = [
    'O crédito com garantia real vota na classe II até o valor do bem (art. 41, § 2º, da LREF)',
    'e o quórum segue o art. 45, § 1º, da Lei 11.101/2005.',
  ].join(' ');

  test('parecer com fundamento verificável é aprovado', () => {
    const a = auditarCitacoes(parecer);
    expect(a.aprovada).toBe(true);
    expect(a.verificadas).toBe(2);
    expect(a.naoLocalizadas).toHaveLength(0);
    expect(a.resumo).toBe('2 verificada(s)');
  });

  test('uma citação inventada reprova o parecer inteiro', () => {
    const a = auditarCitacoes(`${parecer} Veja ainda o art. 412-C da Lei 11.101/2005.`);
    expect(a.aprovada).toBe(false);
    expect(a.naoLocalizadas).toHaveLength(1);
    expect(a.naoLocalizadas[0]!.bruto).toContain('412-C');
  });

  test('jurisprudência não reprova, mas fica listada para conferência', () => {
    // Não é alucinação detectada: é falta de base. Tratar como erro bloquearia
    // o trabalho normal; tratar como verificado seria mentir.
    const a = auditarCitacoes(`${parecer} Nesse sentido, o REsp 1.234.567/SP.`);
    expect(a.aprovada).toBe(true);
    expect(a.naoVerificaveis).toHaveLength(1);
    expect(a.resumo).toContain('sem base para conferência');
  });

  test('texto sem citação alguma é aprovado e não inventa referência', () => {
    const a = auditarCitacoes('A empresa opera há 12 anos no setor metalúrgico.');
    expect(a.referencias).toHaveLength(0);
    expect(a.aprovada).toBe(true);
  });
});
