import { describe, expect, test } from 'bun:test';
import { classify, initialStateFor } from '../src/domain/classifier.ts';
import { diffDays, summarize } from '../src/server/view.ts';
import type { Rec } from '../src/store/models.ts';

const mk = (fullText: string, over: Partial<Rec> = {}): Rec => {
  const pub = { externalId: '1', processNumber: '0001234-56.2025.8.16.0001', clientName: 'Copel Geração e Transmissão S.A', availabilityDate: '2026-10-21', fullText };
  const analysis = classify(pub, { holidaysLoaded: true, holidays: new Set(['2026-11-02']), responsibleFor: () => 'Victor Fortes', defaultDayUnit: 'dias_corridos' });
  return { id: 'r1', runId: 'run', externalId: '1', processNumber: pub.processNumber, clientName: pub.clientName, availabilityDate: pub.availabilityDate, fullText, analysis,
    state: initialStateFor(analysis), version: 1, approvedBy: null, approvedAt: null, acknowledgedFlags: false, auditedBy: null, auditedAt: null, createdAt: '', updatedAt: '', ...over };
};

describe('resumo para leitura humana', () => {
  test('prazo em dias corridos (da disponibilização ao vencimento), responsável, providência, ato e classe', () => {
    const v = summarize(mk('Classe: RECUPERAÇÃO JUDICIAL\nÓrgão: 1ª Vara de Falências\nConteúdo: Intime-se a Copel para manifestar-se sobre a decisão no prazo de 15 dias.'));
    expect(v.providencia).toBe('Manifestar-se');
    expect(v.responsible).toBe('Victor Fortes');
    expect(v.prazo).toMatchObject({ amount: 15, unit: 'dias_corridos', endTerm: '2026-11-06', calendarDays: 15 });
    expect(v.ato).toBe('Decisão');
    expect(v.classe).toBe('Recuperação Judicial');
    expect(v.orgao).toBe('1ª Vara de Falências');
    expect(v.notOurs).toBe(false);
  });
  test('prazo em dias úteis também mostra os dias corridos equivalentes', () => {
    const v = summarize(mk('Intime-se a Copel para manifestar-se no prazo de 15 dias úteis.'));
    expect(v.prazo).toMatchObject({ amount: 15, unit: 'dias_uteis', endTerm: '2026-11-13', calendarDays: 22 });
  });
  test('prazo de terceiro é marcado e não é o "principal"', () => {
    const v = summarize(mk('Manifeste-se o(a) Administrador(a) Judicial no prazo de 10 dias.'));
    expect(v.notOurs).toBe(true);
  });
  test('sugestão do Astrea e divergência aparecem', () => {
    const v = summarize(mk('Intime-se a Copel para manifestar-se no prazo de 15 dias.', { hints: [{ title: null, dueDate: '2026-11-13', responsible: null }] }));
    expect(v.astreaDue).toBe('2026-11-13');
  });
  test('diffDays', () => { expect(diffDays('2026-10-21', '2026-11-06')).toBe(16); expect(diffDays('2026-11-06', '2026-10-21')).toBe(-16); });
});
