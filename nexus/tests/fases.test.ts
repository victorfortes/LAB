import { describe, expect, test } from 'bun:test';
import {
  TransicaoDeFaseInvalida, fase, faseInicial, fasesDe, progresso, transicionarFase,
} from '../src/domain/projeto/fases.ts';

describe('fases por procedimento', () => {
  test('a recuperação judicial segue os marcos da LREF', () => {
    const ids = fasesDe('recuperacao_judicial').map((f) => f.id);
    expect(ids).toEqual([
      'preparacao', 'distribuido', 'processamento_deferido', 'relacao_credores',
      'plano_apresentado', 'assembleia', 'concedida', 'supervisao', 'encerrada',
      'convolada_falencia',
    ]);
  });

  test('cada marco legal traz o fundamento', () => {
    expect(fase('recuperacao_judicial', 'processamento_deferido')!.fundamento)
      .toBe('art. 52 da Lei 11.101/2005');
    expect(fase('falencia', 'decretada')!.fundamento).toBe('art. 99 da Lei 11.101/2005');
    expect(fase('recuperacao_extrajudicial', 'adesoes')!.fundamento)
      .toBe('art. 163 da Lei 11.101/2005');
  });

  test('procedimento sem marco legal próprio usa o ciclo genérico', () => {
    expect(fasesDe('consultivo').map((f) => f.id))
      .toEqual(['diagnostico', 'execucao', 'entrega', 'encerrado']);
    expect(fasesDe('investigacao_patrimonial')).toEqual(fasesDe('consultivo'));
  });

  test('todo projeto começa na primeira fase', () => {
    expect(faseInicial('recuperacao_judicial').id).toBe('preparacao');
    expect(faseInicial('falencia').id).toBe('pedido');
  });
});

describe('progresso', () => {
  test('conta a posição na sequência normal', () => {
    const p = progresso('recuperacao_judicial', 'plano_apresentado');
    expect(p.indice).toBe(5);
    expect(p.total).toBe(9);
    expect(p.proxima!.id).toBe('assembleia');
    expect(p.terminal).toBe(false);
  });

  test('a convolação em falência NÃO entra no denominador', () => {
    // Somá-la faria todo projeto normal parecer mais atrasado do que está.
    expect(progresso('recuperacao_judicial', 'preparacao').total).toBe(9);
    expect(fasesDe('recuperacao_judicial')).toHaveLength(10);
  });

  test('fase terminal não tem próxima', () => {
    const p = progresso('recuperacao_judicial', 'encerrada');
    expect(p.terminal).toBe(true);
    expect(p.proxima).toBeNull();
    expect(p.percentual).toBe(100);
  });

  test('fase excepcional é terminal e completa', () => {
    const p = progresso('recuperacao_judicial', 'convolada_falencia');
    expect(p.terminal).toBe(true);
    expect(p.percentual).toBe(100);
  });

  test('fase inexistente falha em vez de devolver zero', () => {
    expect(() => progresso('recuperacao_judicial', 'inventada')).toThrow(TransicaoDeFaseInvalida);
  });
});

describe('mudança de fase', () => {
  test('avança um passo', () => {
    expect(transicionarFase('recuperacao_judicial', 'distribuido', 'processamento_deferido').id)
      .toBe('processamento_deferido');
  });

  test('voltar é permitido — decisão reformada em agravo acontece', () => {
    expect(transicionarFase('recuperacao_judicial', 'concedida', 'assembleia').id)
      .toBe('assembleia');
    expect(transicionarFase('recuperacao_judicial', 'supervisao', 'preparacao').id)
      .toBe('preparacao');
  });

  test('pular adiante é recusado, e o erro diz o que ficou de fora', () => {
    // Saltar esconde que ninguém registrou o que houve no meio.
    expect(() => transicionarFase('recuperacao_judicial', 'distribuido', 'concedida'))
      // O erro nomeia a PRÓXIMA fase pulada, que é a que precisa ser registrada.
      .toThrow('sem passar por "Processamento deferido"');
  });

  test('a convolação em falência é alcançável de qualquer ponto', () => {
    for (const de of ['preparacao', 'plano_apresentado', 'supervisao']) {
      expect(transicionarFase('recuperacao_judicial', de, 'convolada_falencia').id)
        .toBe('convolada_falencia');
    }
  });

  test('de fase final não se sai', () => {
    expect(() => transicionarFase('recuperacao_judicial', 'encerrada', 'supervisao'))
      .toThrow('precisa ser registrada como projeto novo');
    expect(() => transicionarFase('recuperacao_judicial', 'convolada_falencia', 'assembleia'))
      .toThrow('fase final');
  });

  test('fase de outro procedimento não serve', () => {
    expect(() => transicionarFase('falencia', 'pedido', 'plano_apresentado'))
      .toThrow('não é fase de Falência');
  });

  test('mudar para a mesma fase é recusado', () => {
    expect(() => transicionarFase('consultivo', 'execucao', 'execucao'))
      .toThrow('já está nesta fase');
  });
});
