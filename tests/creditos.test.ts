import { describe, expect, test } from 'bun:test';
import { parseReais } from '../src/domain/shared/dinheiro.ts';
import {
  type Credito, consolidarPorClasse, desdobrarParaVotacao, enquadrar,
} from '../src/domain/insolvencia/creditos.ts';

const credito = (p: Partial<Credito> & Pick<Credito, 'id' | 'credor' | 'valor' | 'natureza'>): Credito => p;

describe('enquadrar', () => {
  test('trabalhista vai para a classe I com o total do crédito', () => {
    const e = enquadrar(credito({ id: '1', credor: 'João', valor: parseReais('500.000,00'), natureza: 'trabalhista' }));
    expect(e.classe).toBe('I');
    expect(e.sujeito).toBe(true);
    expect(e.fundamentos.some((f) => f.includes('§ 1º'))).toBe(true);
    // O teto de 150 salários mínimos é da falência, não da AGC.
    expect(e.ressalvas.some((r) => r.includes('150 salários'))).toBe(true);
  });

  test('trabalhista prevalece sobre marcação de ME/EPP', () => {
    const e = enquadrar(credito({ id: '1', credor: 'João', valor: 1000n, natureza: 'trabalhista', meEpp: true }));
    expect(e.classe).toBe('I');
  });

  test('garantia real vai para a classe II', () => {
    const e = enquadrar(credito({ id: '2', credor: 'Banco', valor: parseReais('1.000.000,00'), natureza: 'garantia_real', valorBemGravado: parseReais('600.000,00') }));
    expect(e.classe).toBe('II');
    expect(e.ressalvas.some((r) => r.includes('Garantia insuficiente'))).toBe(true);
  });

  test('garantia real sem avaliação do bem sinaliza a pendência', () => {
    const e = enquadrar(credito({ id: '2', credor: 'Banco', valor: 1000n, natureza: 'garantia_real' }));
    expect(e.ressalvas.some((r) => r.includes('não pôde ser calculado'))).toBe(true);
  });

  test('ME/EPP vai para a classe IV', () => {
    expect(enquadrar(credito({ id: '3', credor: 'Peq', valor: 1000n, natureza: 'quirografario', meEpp: true })).classe).toBe('IV');
    expect(enquadrar(credito({ id: '3', credor: 'Peq', valor: 1000n, natureza: 'me_epp' })).classe).toBe('IV');
  });

  test('quirografário e subordinado vão para a classe III', () => {
    expect(enquadrar(credito({ id: '4', credor: 'F', valor: 1000n, natureza: 'quirografario' })).classe).toBe('III');
    const sub = enquadrar(credito({ id: '5', credor: 'S', valor: 1000n, natureza: 'subordinado' }));
    expect(sub.classe).toBe('III');
    expect(sub.ressalvas.some((r) => r.includes('art. 83, VIII'))).toBe(true);
  });

  test('créditos não sujeitos não votam e vêm com fundamento', () => {
    for (const natureza of ['tributario', 'proprietario_fiduciario', 'arrendamento_mercantil', 'reserva_dominio', 'promitente_vendedor_irrevogavel', 'adiantamento_contrato_cambio', 'posterior_ao_pedido'] as const) {
      const e = enquadrar(credito({ id: 'x', credor: 'C', valor: 1000n, natureza }));
      expect(e.sujeito).toBe(false);
      expect(e.classe).toBeNull();
      expect(e.fundamentos.length).toBeGreaterThan(0);
      expect(e.ressalvas.length).toBeGreaterThan(0);
    }
  });

  test('todo enquadramento exige validação humana', () => {
    expect(enquadrar(credito({ id: '1', credor: 'C', valor: 1n, natureza: 'quirografario' })).exigeValidacaoHumana).toBe(true);
  });
});

describe('desdobrarParaVotacao — art. 41, § 2º', () => {
  test('garantia parcial desdobra entre as classes II e III', () => {
    const parcelas = desdobrarParaVotacao(credito({
      id: '2', credor: 'Banco', valor: parseReais('1.000.000,00'),
      natureza: 'garantia_real', valorBemGravado: parseReais('600.000,00'),
    }));
    expect(parcelas).toHaveLength(2);
    expect(parcelas[0]).toMatchObject({ classe: 'II', valor: parseReais('600.000,00'), desdobrada: true });
    expect(parcelas[1]).toMatchObject({ classe: 'III', valor: parseReais('400.000,00'), desdobrada: true });
    // O desdobramento não cria nem destrói valor.
    expect(parcelas[0]!.valor + parcelas[1]!.valor).toBe(parseReais('1.000.000,00'));
  });

  test('garantia que cobre todo o crédito não desdobra', () => {
    const parcelas = desdobrarParaVotacao(credito({
      id: '2', credor: 'Banco', valor: parseReais('500.000,00'),
      natureza: 'garantia_real', valorBemGravado: parseReais('800.000,00'),
    }));
    expect(parcelas).toHaveLength(1);
    expect(parcelas[0]).toMatchObject({ classe: 'II', valor: parseReais('500.000,00'), desdobrada: false });
  });

  test('crédito não sujeito não gera parcela de voto', () => {
    expect(desdobrarParaVotacao(credito({ id: 't', credor: 'Fazenda', valor: 1000n, natureza: 'tributario' }))).toHaveLength(0);
  });
});

describe('consolidarPorClasse', () => {
  test('conta cabeças distintas e desdobra garantia real', () => {
    const totais = consolidarPorClasse([
      credito({ id: '1', credor: 'João', valor: parseReais('50.000,00'), natureza: 'trabalhista' }),
      credito({ id: '2', credor: 'João', valor: parseReais('10.000,00'), natureza: 'trabalhista' }),
      credito({ id: '3', credor: 'Banco', valor: parseReais('1.000.000,00'), natureza: 'garantia_real', valorBemGravado: parseReais('600.000,00') }),
      credito({ id: '4', credor: 'Fornecedor', valor: parseReais('200.000,00'), natureza: 'quirografario' }),
      credito({ id: '5', credor: 'Fazenda', valor: parseReais('900.000,00'), natureza: 'tributario' }),
    ]);

    const porClasse = Object.fromEntries(totais.map((t) => [t.classe, t]));
    // João tem dois créditos: uma cabeça só.
    expect(porClasse.I).toMatchObject({ credores: 1, valor: parseReais('60.000,00') });
    expect(porClasse.II).toMatchObject({ credores: 1, valor: parseReais('600.000,00') });
    // O excedente do Banco soma ao quirografário: 400k + 200k.
    expect(porClasse.III).toMatchObject({ credores: 2, valor: parseReais('600.000,00') });
    // A Fazenda não aparece: não vota.
    expect(porClasse.IV).toBeUndefined();
    expect(totais.map((t) => t.classe)).toEqual(['I', 'II', 'III']);
  });
});
