import { describe, expect, test } from 'bun:test';
import { classify, initialStateFor } from '../src/domain/classifier.ts';
import { computeDeadline, nextBusinessDay } from '../src/domain/deadline.ts';
import { liveAmount } from '../src/writer/writer.ts';
import { InvalidTransition, STATE_TABLE, transition } from '../src/domain/states.ts';
import { DEMO_PUBLICATIONS } from '../src/astrea/simulated.ts';

const pub = (id: string) => DEMO_PUBLICATIONS.find((p) => p.externalId === id)!;
const opts = { holidaysLoaded: true, responsibleFor: () => 'Dra. X' };

describe('deadline', () => {
  test('15 dias úteis: disponibilização seg 2026-03-02 → publicação 03-03, início 03-04, fim 03-24', () => {
    const d = computeDeadline({ availabilityDate: '2026-03-02', amount: 15, unit: 'dias_uteis' });
    expect(d.startTerm).toBe('2026-03-04');
    expect(d.endTerm).toBe('2026-03-24');
  });
  test('referência observada no Astrea real: disp. 21/10/2026, 15 dias úteis, Finados 02/11 → 13/11/2026', () => {
    const d = computeDeadline({ availabilityDate: '2026-10-21', amount: 15, unit: 'dias_uteis', holidays: new Set(['2026-11-02']) });
    expect(d.startTerm).toBe('2026-10-23'); // "Início do prazo" exibido pelo Astrea
    expect(d.endTerm).toBe('2026-11-13'); // "Data limite" calculada pelo Astrea
    // sem o feriado o resultado diverge: por isso feriados não verificados sempre são sinalizados
    expect(computeDeadline({ availabilityDate: '2026-10-21', amount: 15, unit: 'dias_uteis' }).endTerm).toBe('2026-11-12');
  });
  test('disponibilização na sexta: publicação segunda', () => {
    expect(nextBusinessDay(new Date('2026-03-06T00:00:00Z'), new Set()).toISOString().slice(0, 10)).toBe('2026-03-09');
  });
  test('feriado informado é excluído da contagem', () => {
    const a = computeDeadline({ availabilityDate: '2026-03-02', amount: 5, unit: 'dias_uteis' });
    const b = computeDeadline({ availabilityDate: '2026-03-02', amount: 5, unit: 'dias_uteis', holidays: new Set(['2026-03-05']) });
    expect(a.endTerm).toBe('2026-03-10');
    expect(b.endTerm).toBe('2026-03-11');
  });
  test('recesso 20/12–20/01 suspende o prazo', () => {
    const d = computeDeadline({ availabilityDate: '2025-12-18', amount: 5, unit: 'dias_uteis' });
    expect(d.startTerm).toBe('2026-01-21');
    expect(d.endTerm).toBe('2026-01-27');
  });
  test('dias corridos vencendo em fim de semana ANTECIPA para o dia útil anterior', () => {
    const d = computeDeadline({ availabilityDate: '2026-03-02', amount: 5, unit: 'dias_corridos' });
    expect(d.endTerm).toBe('2026-03-06'); // dia 5 = sáb 03-07 → sex 03-06
    const p = computeDeadline({ availabilityDate: '2026-10-23', amount: 5, unit: 'dias_corridos' });
    expect(p.endTerm).toBe('2026-10-30'); // caso do piloto: sáb 31/10 → sex 30/10
    expect(liveAmount({ amount: 5, unit: 'dias_corridos', startTerm: p.startTerm, endTerm: p.endTerm })).toBe(4);
  });
  test('meses não são calculados automaticamente', () => {
    expect(computeDeadline({ availabilityDate: '2026-03-02', amount: 1, unit: 'meses' }).endTerm).toBeNull();
  });
});

describe('classifier', () => {
  test('prazo único explícito sem ambiguidade', () => {
    const a = classify(pub('SIM-001'), opts);
    expect(a.actions).toHaveLength(1);
    expect(a.actions[0]!.deadline?.amount).toBe(15);
    expect(a.actions[0]!.description).toBe('Apresentar contestação');
    expect(a.actions[0]!.evidence[0]!.quote).toContain('15');
    expect(initialStateFor(a)).toBe('classified');
  });
  test('múltiplas providências na mesma publicação', () => {
    const a = classify(pub('SIM-002'), opts);
    expect(a.actions.map((x) => x.description)).toEqual(['Manifestar-se', 'Especificar provas']);
    expect(a.flags).toContain('multiplas_providencias');
  });
  test('publicação sem prazo', () => {
    const a = classify(pub('SIM-003'), opts);
    expect(a.actions[0]!.kind).toBe('sem_providencia');
    expect(initialStateFor(a)).toBe('no_action');
  });
  test('prazo em dobro / intimação pessoal / Fazenda → ambíguo', () => {
    const a = classify(pub('SIM-004'), opts);
    expect(a.actions[0]!.ambiguous).toBe(true);
    expect(a.actions[0]!.ambiguityReasons.length).toBeGreaterThanOrEqual(2);
    expect(initialStateFor(a)).toBe('needs_review');
  });
  test('audiência com data e hora', () => {
    const a = classify(pub('SIM-005'), opts);
    const aud = a.actions.find((x) => x.kind === 'audiencia')!;
    expect(aud.eventAt).toBe('2026-04-20T14:30');
  });
  test('"prazo legal" sem número → needs_review sem cálculo', () => {
    const a = classify(pub('SIM-006'), opts);
    expect(a.actions[0]!.deadline).toBeNull();
    expect(initialStateFor(a)).toBe('needs_review');
  });
  test('divergência entre número e extenso é sinalizada', () => {
    const a = classify({ ...pub('SIM-001'), fullText: 'Manifeste-se no prazo de 10 (quinze) dias.' }, opts);
    expect(a.actions[0]!.ambiguityReasons.join()).toContain('Divergência');
  });
  test('feriados não verificados sempre sinalizados; responsável ausente também', () => {
    const a = classify(pub('SIM-001'));
    expect(a.flags).toContain('feriados_locais_nao_verificados');
    expect(a.flags).toContain('responsavel_nao_definido');
  });
  test('modalidade presumida: padrão da config; texto explícito sempre prevalece', () => {
    const base = { ...pub('SIM-001'), fullText: 'Manifeste-se no prazo de 10 dias.' };
    expect(classify(base, { ...opts, defaultDayUnit: 'dias_corridos' }).actions[0]!.deadline!.unit).toBe('dias_corridos');
    expect(classify(base, opts).actions[0]!.deadline!.unit).toBe('dias_uteis');
    expect(classify({ ...base, fullText: 'Manifeste-se no prazo de 10 dias úteis.' }, { ...opts, defaultDayUnit: 'dias_corridos' }).actions[0]!.deadline!.unit).toBe('dias_uteis');
    expect(classify({ ...base, fullText: 'Manifeste-se no prazo de 10 dias corridos.' }, opts).actions[0]!.deadline!.unit).toBe('dias_corridos');
  });
  test('ciência às partes sobre acórdão: prazo presumido de 15 dias corridos, sempre análise humana', () => {
    const p = { ...pub('SIM-001'), availabilityDate: '2026-10-21', fullText: 'Fls. 43320/43327: Ciência as partes sobre o acórdão proferido nos autos de Agravo de Instrumento juntado.' };
    const a = classify(p, { ...opts, defaultDayUnit: 'dias_corridos', holidays: new Set(['2026-11-02']) });
    expect(a.actions).toHaveLength(1);
    expect(a.actions[0]!.deadline).toMatchObject({ amount: 15, unit: 'dias_corridos', startTerm: '2026-10-23', endTerm: '2026-11-06' });
    expect(a.actions[0]!.ambiguous).toBe(true);
    expect(initialStateFor(a)).toBe('needs_review');
    // a sugestão do Astrea (13/11 = 15 dias ÚTEIS) diverge do cálculo em dias corridos ⇒ alerta
    const b = classify({ ...p, hints: [{ title: null, dueDate: '2026-11-13', responsible: null }] }, { ...opts, defaultDayUnit: 'dias_corridos', holidays: new Set(['2026-11-02']) });
    expect(b.flags).toContain('sugestao_astrea_divergente');
  });
  test('TJPR "Divulgamos o acórdão": mesma regra de ciência de acórdão (15 dias corridos presumidos, análise humana)', () => {
    const p = { ...pub('SIM-001'), availabilityDate: '2026-08-25', fullText: '{SrAdvogado}Sr. Advogado, Divulgamos o acórdão proferido nos autos. Relator: Desembargadora Fictícia' };
    const a = classify(p, { ...opts, defaultDayUnit: 'dias_corridos' });
    expect(a.actions).toHaveLength(1);
    expect(a.actions[0]!.description).toContain('Ciência sobre acórdão');
    expect(a.actions[0]!.deadline).toMatchObject({ amount: 15, unit: 'dias_corridos' });
    expect(a.actions[0]!.ambiguous).toBe(true);
    expect(initialStateFor(a)).toBe('needs_review');
    // prazo explícito no texto prevalece sobre a regra presumida
    const b = classify({ ...p, fullText: `${p.fullText} Manifeste-se no prazo de 5 dias úteis.` }, opts);
    expect(b.actions.some((x) => x.deadline?.amount === 5)).toBe(true);
    expect(b.actions.some((x) => x.description.includes('presumido'))).toBe(false);
  });
  test('TJPR: aviso de distribuição e resenha de distribuição ⇒ sem providência (no_action), sem inventar prazo', () => {
    for (const t of ['Conteúdo: Intimação referente ao movimento (seq. 70) DISTRIBUÍDO POR PREVENÇÃO (18/08/2026). Acesse o sistema Projudi.',
      '{SrAdvogado}Sr. Advogado, Relação No. 2026.00037 de Publicação da Distribuição. Resenha de distribuição, automatizada por processamento eletrônico']) {
      const a = classify({ ...pub('SIM-001'), fullText: t }, opts);
      expect(a.actions[0]!.kind).toBe('sem_providencia');
      expect(initialStateFor(a)).toBe('no_action');
    }
    // mas se houver prazo explícito, o prazo prevalece
    expect(classify({ ...pub('SIM-001'), fullText: 'Resenha de distribuição. Manifeste-se no prazo de 5 dias úteis.' }, opts).actions[0]!.kind).toBe('prazo');
  });
  test('regra 1: prazo dirigido a terceiro (Administrador Judicial, Recuperanda, MP) → notOurs, análise humana', () => {
    for (const [txt, label] of [
      ['Solange e outros - Manifeste-se o(a) Administrador(a) Judicial no prazo de 15 (quinze) dias.', 'Administrador Judicial'],
      ['Intime-se a recuperanda para se manifestar no prazo de 10 dias.', 'Recuperanda'],
      ['Dê-se vista ao Ministério Público para manifestação no prazo de 5 dias.', 'Ministério Público'],
    ] as const) {
      const a = classify({ ...pub('SIM-001'), clientName: 'Copel Geração e Transmissão S.A', fullText: txt }, opts);
      expect(a.actions[0]!.notOurs).toBe(true);
      expect(a.actions[0]!.description).toContain(label);
      expect(a.actions[0]!.ambiguous).toBe(true);
      expect(initialStateFor(a)).toBe('needs_review');
    }
    // se a mesma oração cita o cliente, pode ser prazo nosso (não marca terceiro)
    const ours = classify({ ...pub('SIM-001'), clientName: 'Copel Geração e Transmissão S.A', fullText: 'Intime-se a Copel e o Administrador Judicial para manifestação no prazo de 15 dias.' }, opts);
    expect(ours.actions[0]!.notOurs).toBeUndefined();
  });
  test('regra 2: renúncia/exclusão de patrono (art. 112 CPC) sem prazo ⇒ sem providência', () => {
    const a = classify({ ...pub('SIM-001'), fullText: 'Fls. 7659: em observância ao disposto no artigo 112 do Código de Processo Civil (CPC), esta serventia encontra-se impossibilitada de proceder à exclusão do patrono sem a devida comprovação.' }, opts);
    expect(a.actions[0]!.kind).toBe('sem_providencia');
    expect(initialStateFor(a)).toBe('no_action');
  });
  test('texto com 65.535 caracteres é sinalizado como possivelmente truncado', () => {
    const a = classify({ ...pub('SIM-001'), fullText: `Manifeste-se no prazo de 15 dias úteis. ${'x'.repeat(65_535)}` }, opts);
    expect(a.flags).toContain('texto_possivelmente_truncado');
    expect(initialStateFor(a)).toBe('needs_review');
  });
  test('texto sem padrão vai para revisão humana (não inventa providência)', () => {
    const a = classify({ ...pub('SIM-001'), fullText: 'Texto qualquer sem relevância processual identificável.' }, opts);
    expect(initialStateFor(a)).toBe('needs_review');
  });
});

describe('states', () => {
  test('transições válidas e inválidas', () => {
    expect(transition('classified', 'approve')).toBe('approved');
    expect(() => transition('classified', 'verify_ok')).toThrow(InvalidTransition);
    expect(() => transition('rejected', 'queue_write')).toThrow(InvalidTransition);
  });
  test('"confirmed" só é alcançável via verify_ok a partir de write_queued', () => {
    const into = Object.entries(STATE_TABLE).flatMap(([from, evs]) => Object.entries(evs).filter(([, to]) => to === 'confirmed').map(([e]) => `${from}:${e}`));
    expect(into.sort()).toEqual(['correction_requested:reject', 'write_queued:verify_ok']);
  });
});
