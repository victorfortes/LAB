import { describe, expect, test } from 'bun:test';
import {
  ErroDePrazo, PRAZOS_USUAIS, contarPrazo, diasUteisAte, prazoUsual,
} from '../src/domain/processo/prazos.ts';

describe('os dois saltos do art. 224', () => {
  test('o que sai no Diário publica-se no dia útil seguinte, e a contagem começa no seguinte a esse', () => {
    // O erro clássico: contar da disponibilização. Aqui são dois saltos —
    // sexta 06/11 → publicação segunda 09/11 → primeiro dia terça 10/11.
    const p = contarPrazo({ evento: '2026-11-06', origem: 'disponibilizacao_dje', dias: 15 });
    expect(p.publicacao).toBe('2026-11-09');
    expect(p.primeiroDiaContado).toBe('2026-11-10');
    expect(p.vencimento).toBe('2026-12-01');
  });

  test('quando a data JÁ é a da publicação, o salto é um só', () => {
    const p = contarPrazo({ evento: '2026-04-15', origem: 'publicacao', dias: 10 });
    expect(p.publicacao).toBe('2026-04-15');
    expect(p.primeiroDiaContado).toBe('2026-04-16');
    expect(p.vencimento).toBe('2026-04-30');
  });

  test('intimação pessoal e juntada do AR correm do próprio evento', () => {
    const p = contarPrazo({ evento: '2026-02-10', origem: 'juntada_ar', dias: 15 });
    expect(p.publicacao).toBe('2026-02-10');
    expect(p.primeiroDiaContado).toBe('2026-02-11');
    expect(p.vencimento).toBe('2026-03-05');
    expect(p.fundamentos.join(' ')).toContain('Art. 231');
  });

  test('os fundamentos saem escritos, para o advogado conferir a conta', () => {
    const p = contarPrazo({ evento: '2026-11-06', origem: 'disponibilizacao_dje', dias: 15 });
    const texto = p.fundamentos.join(' ');
    expect(texto).toContain('Art. 224, § 2º');
    expect(texto).toContain('Art. 224, caput');
    expect(texto).toContain('Art. 219');
  });
});

describe('dias úteis forenses', () => {
  test('Carnaval entra na conta como dia que não corre', () => {
    const p = contarPrazo({ evento: '2026-02-10', origem: 'juntada_ar', dias: 15 });
    expect(p.naoCorreram.map((d) => d.data)).toContain('2026-02-16');
    expect(p.naoCorreram.map((d) => d.data)).toContain('2026-02-17');
    expect(p.naoCorreram).toHaveLength(8);
  });

  test('o recesso empurra o vencimento para o ano seguinte', () => {
    // 15 dias úteis a partir de 16/12/2026: três dias em dezembro, o resto só
    // depois de 20 de janeiro.
    const p = contarPrazo({ evento: '2026-12-14', origem: 'disponibilizacao_dje', dias: 15 });
    expect(p.primeiroDiaContado).toBe('2026-12-16');
    expect(p.vencimento).toBe('2027-02-05');
    expect(p.fundamentos.join(' ')).toContain('Art. 220');
    expect(p.naoCorreram.some((d) => d.motivo === 'recesso_forense')).toBe(true);
  });

  test('feriado no meio do prazo não conta', () => {
    // 5 úteis de 15/04/2026: 15, 16, 17, 20 e 22 — 21 é Tiradentes.
    const p = contarPrazo({ evento: '2026-04-14', origem: 'publicacao', dias: 5 });
    expect(p.vencimento).toBe('2026-04-22');
    expect(p.naoCorreram.map((d) => d.data)).toEqual(['2026-04-18', '2026-04-19', '2026-04-21']);
  });

  test('prazo em dobro dobra os dias e diz por quê', () => {
    const p = contarPrazo({
      evento: '2026-02-10', origem: 'juntada_ar', dias: 15,
      emDobro: true, motivoDoDobro: 'Fazenda Pública (art. 183 do CPC)',
    });
    expect(p.dias).toBe(30);
    expect(p.vencimento).toBe('2026-03-26');
    expect(p.fundamentos.join(' ')).toContain('Fazenda Pública');
  });
});

describe('dias corridos e a prorrogação do art. 224, § 1º', () => {
  test('o vencimento que cai em domingo vai para a segunda', () => {
    // Stay de 180 dias corridos: cairia em domingo 06/09 e vence na terça 08,
    // porque 07/09 é feriado.
    const p = contarPrazo({
      evento: '2026-03-10', origem: 'publicacao', dias: 180, regime: 'corridos',
    });
    expect(p.vencimento).toBe('2026-09-08');
    expect(p.fundamentos.join(' ')).toContain('Art. 224, § 1º');
  });

  test('em dias corridos nada é pulado no meio', () => {
    const p = contarPrazo({
      evento: '2026-12-09', origem: 'publicacao', dias: 5, regime: 'corridos',
    });
    expect(p.vencimento).toBe('2026-12-14');
    expect(p.naoCorreram).toHaveLength(0);
  });
});

describe('o resultado nunca sai como definitivo', () => {
  test('sempre exige conferência e diz o que não foi considerado', () => {
    const p = contarPrazo({ evento: '2026-11-06', origem: 'disponibilizacao_dje', dias: 15 });
    expect(p.exigeConferencia).toBe(true);
    const r = p.ressalvas.join(' ');
    expect(r).toContain('Feriados estaduais e municipais');
    expect(r).toContain('Suspensões decretadas pelo tribunal');
    expect(r).toContain('Expediente encerrado antes da hora');
  });

  test('informar o calendário local tira a ressalva correspondente', () => {
    const p = contarPrazo({
      evento: '2026-11-06', origem: 'disponibilizacao_dje', dias: 15,
      calendario: { feriadosLocais: ['2026-11-19'], suspensoes: [] },
    });
    expect(p.ressalvas.join(' ')).not.toContain('Feriados estaduais e municipais');
    // E o feriado informado muda a conta: 19/11 deixa de correr.
    expect(p.vencimento).toBe('2026-12-02');
  });

  test('prazo absurdo é recusado em vez de calculado', () => {
    expect(() => contarPrazo({ evento: '2026-01-05', origem: 'publicacao', dias: 0 }))
      .toThrow(ErroDePrazo);
    expect(() => contarPrazo({ evento: '2026-01-05', origem: 'publicacao', dias: -3 }))
      .toThrow(ErroDePrazo);
    expect(() => contarPrazo({ evento: '2026-01-05', origem: 'publicacao', dias: 99_999 }))
      .toThrow('fora de qualquer hipótese');
  });
});

describe('dias úteis até o vencimento', () => {
  test('conta os que faltam', () => {
    expect(diasUteisAte('2026-11-02', '2026-11-06')).toBe(4);
    expect(diasUteisAte('2026-11-02', '2026-11-02')).toBe(0);
  });

  test('pula fim de semana e feriado', () => {
    // 16/11 (seg) a 23/11 (seg): 17, 18, 19, 23 — 20/11 é feriado.
    expect(diasUteisAte('2026-11-16', '2026-11-23')).toBe(4);
  });

  test('vencido devolve negativo', () => {
    expect(diasUteisAte('2026-11-06', '2026-11-02')).toBe(-4);
  });
});

describe('catálogo de prazos usuais', () => {
  test('traz o fundamento de cada um', () => {
    for (const p of PRAZOS_USUAIS) {
      expect(p.fundamento).toMatch(/art\./);
      expect(p.dias).toBeGreaterThan(0);
    }
  });

  test('impugnação é 10 dias, não 15 — é o erro de digitação que o catálogo evita', () => {
    expect(prazoUsual('impugnacao')!.dias).toBe(10);
    expect(prazoUsual('habilitacao')!.dias).toBe(15);
    expect(prazoUsual('embargos')!.dias).toBe(5);
    expect(prazoUsual('plano')!.dias).toBe(60);
    expect(prazoUsual('objecao')!.dias).toBe(30);
  });

  test('o stay declara a divergência de regime em vez de escondê-la', () => {
    const stay = prazoUsual('stay')!;
    expect(stay.regime).toBe('corridos');
    expect(stay.observacao).toContain('art. 189, § 1º, I');
    expect(stay.observacao).toContain('divergência');
  });

  test('id desconhecido devolve indefinido, sem inventar prazo', () => {
    expect(prazoUsual('nao-existe')).toBeUndefined();
  });
});
