import { describe, expect, test } from 'bun:test';
import {
  ErroDeHonorario, RESERVA, TETO_GERAL, TETO_ME_EPP,
  cronogramaDeHonorarios, ratear, tetoDoAdministradorJudicial, totalContratado,
} from '../src/domain/financeiro/honorarios.ts';
import { formatarReais, parseReais } from '../src/domain/shared/dinheiro.ts';

describe('honorário contratual', () => {
  test('fixo é o fixo', () => {
    const r = totalContratado({ modelo: 'fixo', valorFixo: parseReais('120.000,00') });
    expect(formatarReais(r.total)).toBe('120.000,00');
    expect(r.exitoPendente).toBe(false);
  });

  test('mensal multiplica pelos meses, em inteiros', () => {
    const r = totalContratado({ modelo: 'mensal', valorMensal: parseReais('18.500,00'), meses: 24 });
    expect(formatarReais(r.mensalTotal)).toBe('444.000,00');
  });

  test('êxito aplica o percentual sem passar por ponto flutuante', () => {
    // 5% de R$ 48.750.317,43. Com float o centavo final sai errado.
    const r = totalContratado(
      { modelo: 'exito', percentualExito: 0.05, baseDoExito: 'beneficio_economico' },
      parseReais('48.750.317,43'));
    expect(formatarReais(r.exito)).toBe('2.437.515,87');
  });

  test('misto soma as três parcelas', () => {
    const r = totalContratado({
      modelo: 'misto', valorFixo: parseReais('50.000,00'),
      valorMensal: parseReais('10.000,00'), meses: 12,
      percentualExito: 0.1, baseDoExito: 'desagio_obtido',
    }, parseReais('1.000.000,00'));
    expect(formatarReais(r.total)).toBe('270.000,00');
  });
});

describe('êxito sem base apurada é pendência, não zero', () => {
  test('o total não inclui o êxito e a ressalva diz por quê', () => {
    // Zero afirmaria que não há honorário de êxito; o que há é ausência de
    // apuração, e a diferença muda a conversa com o cliente.
    const r = totalContratado({
      modelo: 'misto', valorFixo: parseReais('50.000,00'),
      valorMensal: parseReais('0,00'), meses: 1,
      percentualExito: 0.15, baseDoExito: 'valor_recuperado',
    });
    expect(r.exitoPendente).toBe(true);
    expect(r.exito).toBe(0n);
    expect(formatarReais(r.total)).toBe('50.000,00');
    expect(r.ressalvas.join(' ')).toContain('não foi apurada');
  });

  test('a base de êxito é obrigatória: muda o resultado', () => {
    expect(() => totalContratado({ modelo: 'exito', percentualExito: 0.1 }))
      .toThrow('precisa declarar a base');
  });

  test('percentual digitado como número inteiro é recusado', () => {
    // Alguém digita 20 querendo 20%; 20 como fração seria 2.000%.
    expect(() => totalContratado(
      { modelo: 'exito', percentualExito: 20, baseDoExito: 'valor_recuperado' },
      parseReais('100,00'))).toThrow('o campo é fração');
  });

  test('contrato incompleto falha em vez de calcular meio errado', () => {
    expect(() => totalContratado({ modelo: 'fixo' })).toThrow(ErroDeHonorario);
    expect(() => totalContratado({ modelo: 'mensal', valorMensal: 100n })).toThrow('meses');
  });
});

describe('cronograma de faturamento', () => {
  test('a fixa parcelada fecha exatamente com o contratado', () => {
    // R$ 100.000,00 em 3 parcelas: o centavo que sobra vai para a primeira.
    const p = cronogramaDeHonorarios(
      { modelo: 'fixo', valorFixo: parseReais('100.000,00') }, '2026-11-10', 3);
    expect(p).toHaveLength(3);
    expect(p.reduce((t, x) => t + x.valor, 0n)).toBe(parseReais('100.000,00'));
    expect(formatarReais(p[0]!.valor)).toBe('33.333,34');
    expect(formatarReais(p[2]!.valor)).toBe('33.333,33');
  });

  test('vencimentos mensais saturam no fim do mês', () => {
    const p = cronogramaDeHonorarios(
      { modelo: 'mensal', valorMensal: parseReais('5.000,00'), meses: 4 }, '2026-01-31');
    expect(p.map((x) => x.vencimento))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  test('o êxito NÃO entra no cronograma', () => {
    // Ele vence quando o êxito ocorre; agendá-lo seria inventar uma data.
    const p = cronogramaDeHonorarios({
      modelo: 'misto', valorFixo: parseReais('10.000,00'),
      valorMensal: parseReais('1.000,00'), meses: 2,
      percentualExito: 0.1, baseDoExito: 'beneficio_economico',
    }, '2026-11-10');
    expect(p.map((x) => x.origem)).toEqual(['fixo', 'mensal', 'mensal']);
  });
});

describe('teto do administrador judicial (art. 24 da LREF)', () => {
  const passivo = parseReais('50.000.000,00');

  test('5% no caso geral', () => {
    const t = tetoDoAdministradorJudicial({ base: passivo, microempresaOuEpp: false });
    expect(t.percentual).toBe(TETO_GERAL);
    expect(formatarReais(t.teto)).toBe('2.500.000,00');
    expect(t.fundamentos.join(' ')).toContain('§ 1º');
  });

  test('2% para ME e EPP, e o fundamento muda junto', () => {
    const t = tetoDoAdministradorJudicial({ base: passivo, microempresaOuEpp: true });
    expect(t.percentual).toBe(TETO_ME_EPP);
    expect(formatarReais(t.teto)).toBe('1.000.000,00');
    expect(t.fundamentos.join(' ')).toContain('§ 5º');
    expect(t.fundamentos.join(' ')).not.toContain('não excederá 5%');
  });

  test('40% ficam reservados para depois da prestação de contas', () => {
    const t = tetoDoAdministradorJudicial({ base: passivo, microempresaOuEpp: false });
    expect(RESERVA).toBe(0.4);
    expect(formatarReais(t.reserva)).toBe('1.000.000,00');
    expect(formatarReais(t.liberavelDuranteOProcesso)).toBe('1.500.000,00');
    expect(t.reserva + t.liberavelDuranteOProcesso).toBe(t.teto);
  });

  test('proposta acima do teto é apontada com o excedente', () => {
    const t = tetoDoAdministradorJudicial({
      base: passivo, microempresaOuEpp: false,
      propostoMensal: parseReais('120.000,00'), meses: 24,
    });
    expect(formatarReais(t.propostoTotal!)).toBe('2.880.000,00');
    expect(t.excedeOTeto).toBe(true);
    expect(formatarReais(t.excedente)).toBe('380.000,00');
  });

  test('proposta dentro do teto passa sem excedente', () => {
    const t = tetoDoAdministradorJudicial({
      base: passivo, microempresaOuEpp: false,
      propostoMensal: parseReais('80.000,00'), meses: 24,
    });
    expect(t.excedeOTeto).toBe(false);
    expect(t.excedente).toBe(0n);
  });

  test('o teto é limite, nunca arbitramento', () => {
    const t = tetoDoAdministradorJudicial({ base: passivo, microempresaOuEpp: false });
    expect(t.exigeDecisaoJudicial).toBe(true);
    expect(t.ressalvas.join(' ')).toContain('fixado em decisão judicial');
    expect(t.ressalvas.join(' ')).toContain('crédito ainda não validado altera o cálculo');
  });

  test('proposta sem prazo é recusada', () => {
    expect(() => tetoDoAdministradorJudicial({
      base: passivo, microempresaOuEpp: false, propostoMensal: 100n,
    })).toThrow('em quantos meses');
  });
});

describe('rateio entre projetos', () => {
  test('reparte proporcionalmente e a soma fecha', () => {
    const r = ratear(parseReais('10.000,00'), [
      { chave: 'a', peso: 10 }, { chave: 'b', peso: 20 }, { chave: 'c', peso: 7 },
    ]);
    expect(r.reduce((t, x) => t + x.valor, 0n)).toBe(parseReais('10.000,00'));
    expect(formatarReais(r[1]!.valor)).toBe('5.405,41');
  });

  test('peso zero em todos é erro, não divisão por zero', () => {
    expect(() => ratear(100n, [{ chave: 'a', peso: 0 }])).toThrow('precisa ser positiva');
    expect(() => ratear(100n, [])).toThrow('sem destino');
  });
});
