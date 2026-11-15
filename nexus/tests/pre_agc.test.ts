import { describe, expect, test } from 'bun:test';
import { apurarAssembleia, type VotoLancado } from '../src/domain/insolvencia/quorum.ts';
import { apurarEspecie, cabecasPorClasse, especiePadrao, simular } from '../src/server/pre_agc.ts';

const v = (credor: string, classe: VotoLancado['classe'], valor: bigint, voto: VotoLancado['voto']): VotoLancado => ({ credor, classe, valor, voto });

describe('art. 58, § 1º, II (Lei 14.112/2020)', () => {
  test('com quatro classes votantes, o cram down exige três aprovadas', () => {
    const r = apurarAssembleia([
      v('T', 'I', 100n, 'sim'), v('B', 'II', 1000n, 'sim'), v('Q', 'III', 50n, 'nao'), v('M', 'IV', 10n, 'nao'),
    ]);
    expect(r.cramDown.incisoII).toMatchObject({ classesVotantes: 4, classesAprovadas: 2, exigidas: 3, atendido: false });
    expect(r.cramDown.cabivel).toBe(false);
  });
  test('na classe III rejeitante, mais de 1/3 por cabeça não basta sem mais de 1/3 do valor', () => {
    const r = apurarAssembleia([
      v('T1', 'I', 10n, 'sim'), v('T2', 'I', 10n, 'sim'),
      v('A', 'III', 10n, 'sim'), v('B', 'III', 10n, 'sim'), v('C', 'III', 1000n, 'nao'),
      v('M1', 'IV', 10n, 'sim'),
      v('G', 'II', 5000n, 'sim'),
    ]);
    const iii = r.cramDown.incisoIII.classesRejeitantes.find((x) => x.classe === 'III')!;
    expect(iii.proporcao).toBeCloseTo(2 / 3, 5);
    expect(iii.atendido).toBe(false);
  });
});

describe('PRE · art. 163', () => {
  test('1/3 admite igualdade; a maioria é estritamente mais da metade', () => {
    const e = apurarEspecie('Quirografário', [
      { creditoId: 'a', credor: 'A', valor: 100n, situacao: 'aderiu' }, { creditoId: 'b', credor: 'B', valor: 100n, situacao: 'pendente' },
      { creditoId: 'c', credor: 'C', valor: 100n, situacao: 'negociando' },
    ]);
    expect(e.atingiuTerco).toBe(true);
    expect(e.atingiuMaioria).toBe(false);
    expect(e.faltaTerco).toBe('0,00');
    expect(e.faltaMaioria).toBe('0,51');
    // Quem está negociando vem primeiro no caminho para a maioria.
    expect(e.caminho[0]!.credor).toBe('C');
  });
  test('metade exata não homologa', () => {
    const e = apurarEspecie('Garantia real', [{ creditoId: 'a', credor: 'A', valor: 50n, situacao: 'aderiu' }, { creditoId: 'b', credor: 'B', valor: 50n, situacao: 'recusou' }]);
    expect(e.percentual).toBe(50);
    expect(e.atingiuMaioria).toBe(false);
  });
  test('espécies padrão seguem o art. 83 e tributário começa fora do plano', () => {
    expect(especiePadrao('privilegio_geral').especie).toBe('Quirografário');
    expect(especiePadrao('me_epp').especie).toBe('Quirografário');
    expect(especiePadrao('tributario').abrangivel).toBe(false);
    expect(especiePadrao('proprietario_fiduciario').abrangivel).toBe(false);
  });
});

describe('Simulador da AGC', () => {
  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const creditos = [
    { id: 'c1', credor_id: id(1), credor: 'Banco', valor: '1000000', valor_bem_gravado: '600000', classe: 'II' as const, sujeito: true },
    { id: 'c2', credor_id: id(2), credor: 'Fornecedor', valor: '300000', valor_bem_gravado: null, classe: 'III' as const, sujeito: true },
    { id: 'c3', credor_id: id(2), credor: 'Fornecedor', valor: '100000', valor_bem_gravado: null, classe: 'III' as const, sujeito: true },
    { id: 'c4', credor_id: id(3), credor: 'Fisco', valor: '999999', valor_bem_gravado: null, classe: 'III' as const, sujeito: false },
    { id: 'c5', credor_id: id(4), credor: 'Empregado', valor: '5000', valor_bem_gravado: null, classe: 'I' as const, sujeito: true },
  ];
  test('desdobra a garantia real, junta créditos do mesmo credor e tira o não sujeito', () => {
    const c = cabecasPorClasse(creditos);
    expect(c.find((x) => x.chave === `II:${id(1)}`)!.valor).toBe(600000n);
    expect(c.find((x) => x.chave === `III:${id(1)}`)!.valor).toBe(400000n);
    expect(c.find((x) => x.chave === `III:${id(2)}`)!).toMatchObject({ valor: 400000n, creditos: 2 });
    expect(c.some((x) => x.credor === 'Fisco')).toBe(false);
  });
  test('1ª convocação não instala sem mais da metade do valor de cada classe; 2ª instala', () => {
    const c = cabecasPorClasse(creditos);
    const votos = { [`I:${id(4)}`]: 'sim', [`II:${id(1)}`]: 'sim', [`III:${id(1)}`]: 'sim' } as const;
    const primeira = simular(c, votos, 'primeira');
    // Classe III: presente só o excedente do banco (400.000 de 800.000) = exatamente metade, não instala.
    expect(primeira.classes.find((x) => x.classe === 'III')!.instalada).toBe(false);
    expect(primeira.instalada).toBe(false);
    expect(primeira.aprovadoPeloArt45).toBe(false);
    const segunda = simular(c, votos, 'segunda');
    expect(segunda.instalada).toBe(true);
    expect(segunda.aprovadoPeloArt45).toBe(true);
  });
  test('mostra quanto falta para aprovar a classe', () => {
    const c = cabecasPorClasse(creditos);
    const r = simular(c, { [`III:${id(1)}`]: 'nao', [`III:${id(2)}`]: 'sim' }, 'segunda');
    const iii = r.classes.find((x) => x.classe === 'III')!;
    expect(iii.aprovada).toBe(false);
    expect(iii.faltaCabecas).toBe(1);
    expect(iii.faltaValor).toBe('0,01');
  });
});
