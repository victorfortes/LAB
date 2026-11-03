import { describe, expect, test } from 'bun:test';
import { parseReais } from '../src/domain/shared/dinheiro.ts';
import { type VotoLancado, apurarAssembleia, apurarClasse, criterioDaClasse } from '../src/domain/insolvencia/quorum.ts';
import type { ClasseCredor } from '../src/domain/insolvencia/creditos.ts';

const v = (credor: string, classe: ClasseCredor, valor: string, voto: VotoLancado['voto']): VotoLancado =>
  ({ credor, classe, valor: parseReais(valor), voto });

describe('critério por classe', () => {
  test('I e IV por cabeça; II e III cumulativo', () => {
    expect(criterioDaClasse('I')).toBe('cabeca');
    expect(criterioDaClasse('IV')).toBe('cabeca');
    expect(criterioDaClasse('II')).toBe('cumulativo');
    expect(criterioDaClasse('III')).toBe('cumulativo');
  });
});

describe('apurarClasse', () => {
  test('classe I aprova por maioria de cabeças, valor é irrelevante', () => {
    // O voto "não" tem 100× mais valor e ainda assim perde: classe I é por cabeça.
    const a = apurarClasse('I', [
      v('A', 'I', '1.000,00', 'sim'), v('B', 'I', '1.000,00', 'sim'),
      v('C', 'I', '1.000.000,00', 'nao'),
    ]);
    expect(a.aprovada).toBe(true);
    expect(a.aprovadaPorValor).toBeNull();
    expect(a.sim.credores).toBe(2);
  });

  test('classe III exige valor E cabeça — maioria de cabeças sem valor reprova', () => {
    const a = apurarClasse('III', [
      v('A', 'III', '1.000,00', 'sim'), v('B', 'III', '1.000,00', 'sim'),
      v('C', 'III', '1.000.000,00', 'nao'),
    ]);
    expect(a.aprovadaPorCabeca).toBe(true);
    expect(a.aprovadaPorValor).toBe(false);
    expect(a.aprovada).toBe(false);
  });

  test('classe III com valor mas sem cabeça também reprova', () => {
    const a = apurarClasse('III', [
      v('A', 'III', '1.000.000,00', 'sim'),
      v('B', 'III', '1.000,00', 'nao'), v('C', 'III', '1.000,00', 'nao'),
    ]);
    expect(a.aprovadaPorValor).toBe(true);
    expect(a.aprovadaPorCabeca).toBe(false);
    expect(a.aprovada).toBe(false);
  });

  test('empate não é maioria', () => {
    const a = apurarClasse('I', [v('A', 'I', '1,00', 'sim'), v('B', 'I', '1,00', 'nao')]);
    expect(a.aprovada).toBe(false);
  });

  test('abstenção conta como presente e empurra contra a aprovação', () => {
    const a = apurarClasse('I', [
      v('A', 'I', '1,00', 'sim'), v('B', 'I', '1,00', 'sim'), v('C', 'I', '1,00', 'abstencao'),
      v('D', 'I', '1,00', 'abstencao'),
    ]);
    expect(a.presentes.credores).toBe(4);
    expect(a.abstencoes).toBe(2);
    expect(a.aprovada).toBe(false); // 2 de 4 não é "mais da metade"
  });

  test('o mesmo credor com dois créditos é uma cabeça e dois valores', () => {
    const a = apurarClasse('III', [
      v('Banco', 'III', '100,00', 'sim'), v('Banco', 'III', '200,00', 'sim'),
      v('Outro', 'III', '50,00', 'nao'),
    ]);
    expect(a.presentes.credores).toBe(2);
    expect(a.presentes.valor).toBe(parseReais('350,00'));
    expect(a.sim.valor).toBe(parseReais('300,00'));
  });

  test('classe vazia não é classe aprovada', () => {
    const a = apurarClasse('II', []);
    expect(a.aprovada).toBe(false);
    expect(a.presentes.credores).toBe(0);
  });
});

describe('apurarAssembleia — art. 45', () => {
  test('todas as classes aprovam', () => {
    const r = apurarAssembleia([
      v('A', 'I', '10,00', 'sim'), v('B', 'I', '10,00', 'sim'),
      v('C', 'III', '100,00', 'sim'), v('D', 'III', '50,00', 'sim'), v('E', 'III', '10,00', 'nao'),
    ]);
    expect(r.aprovadoPeloArt45).toBe(true);
    expect(r.concessaoPossivel).toBe(true);
    expect(r.cramDown.cabivel).toBe(false); // não se cogita cram down se o art. 45 já aprovou
  });
});

describe('apurarAssembleia — cram down do art. 58, § 1º', () => {
  test('cenário completo: classe IV rejeita, mas os três incisos são atendidos', () => {
    // I e III aprovam. IV rejeita por cabeça (2 sim de 5 = 40 %),
    // mas 40 % > 1/3, então o inciso III é atendido.
    const votos = [
      v('T1', 'I', '50.000,00', 'sim'), v('T2', 'I', '30.000,00', 'sim'),
      v('Banco', 'III', '2.000.000,00', 'sim'), v('Forn2', 'III', '50.000,00', 'sim'),
      v('Forn', 'III', '100.000,00', 'nao'),
      v('P1', 'IV', '10.000,00', 'sim'), v('P2', 'IV', '10.000,00', 'sim'),
      v('P3', 'IV', '10.000,00', 'nao'), v('P4', 'IV', '10.000,00', 'nao'), v('P5', 'IV', '10.000,00', 'nao'),
    ];
    const r = apurarAssembleia(votos);

    expect(r.aprovadoPeloArt45).toBe(false);
    expect(r.cramDown.incisoI.atendido).toBe(true);
    expect(r.cramDown.incisoII).toMatchObject({ atendido: true, classesAprovadas: 2, classesVotantes: 3, exigidas: 2 });
    expect(r.cramDown.incisoIII.atendido).toBe(true);
    expect(r.cramDown.incisoIII.classesRejeitantes).toHaveLength(1);
    expect(r.cramDown.incisoIII.classesRejeitantes[0]!.classe).toBe('IV');
    expect(r.cramDown.cabivel).toBe(true);
    expect(r.concessaoPossivel).toBe(true);
    // A vedação do § 2º é de mérito e tem de vir sinalizada.
    expect(r.cramDown.ressalvas.some((x) => x.includes('§ 2º'))).toBe(true);
  });

  test('exatamente 1/3 na classe rejeitante não basta — a lei exige MAIS de 1/3', () => {
    const votos = [
      v('A', 'I', '100,00', 'sim'), v('B', 'I', '100,00', 'sim'),
      v('C', 'III', '1.000,00', 'sim'), v('D', 'III', '500,00', 'sim'), v('E', 'III', '10,00', 'nao'),
      v('P1', 'IV', '10,00', 'sim'), v('P2', 'IV', '10,00', 'nao'), v('P3', 'IV', '10,00', 'nao'),
    ];
    const r = apurarAssembleia(votos);
    expect(r.cramDown.incisoIII.classesRejeitantes[0]!.proporcao).toBeCloseTo(1 / 3, 10);
    expect(r.cramDown.incisoIII.atendido).toBe(false);
    expect(r.cramDown.cabivel).toBe(false);
    expect(r.concessaoPossivel).toBe(false);
  });

  test('com apenas duas classes votantes, basta uma aprovada', () => {
    const votos = [
      v('A', 'I', '100,00', 'sim'), v('B', 'I', '100,00', 'sim'),
      v('C', 'III', '1.000,00', 'sim'),
      v('D', 'III', '400,00', 'nao'), v('E', 'III', '400,00', 'nao'),
    ];
    const r = apurarAssembleia(votos);
    expect(r.cramDown.incisoII).toMatchObject({ classesVotantes: 2, exigidas: 1, atendido: true });
  });

  test('inciso I falha quando o valor favorável não passa de metade', () => {
    const votos = [
      v('A', 'I', '10,00', 'sim'), v('B', 'I', '10,00', 'sim'),
      v('C', 'III', '1.000.000,00', 'nao'),
    ];
    const r = apurarAssembleia(votos);
    expect(r.cramDown.incisoI.atendido).toBe(false);
    expect(r.cramDown.cabivel).toBe(false);
  });

  test('assembleia sem votos não aprova nada', () => {
    const r = apurarAssembleia([]);
    expect(r.aprovadoPeloArt45).toBe(false);
    expect(r.cramDown.cabivel).toBe(false);
    expect(r.concessaoPossivel).toBe(false);
  });
});
