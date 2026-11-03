import { describe, expect, test } from 'bun:test';
import { classify } from '../src/domain/classifier.ts';
import { detectAto, detectClasse, scheduleNotes, scheduleTitle, titleCase } from '../src/writer/format.ts';
import { parseCalculator, parseTreatmentCards } from '../src/astrea/parse.ts';

const base = { externalId: '359137884', processNumber: '0001234-56.2025.8.16.0001', clientName: 'Copel Geração e Transmissão S.A', availabilityDate: '2026-10-21' };
const opts = { holidaysLoaded: true, holidays: new Set(['2026-11-02']), responsibleFor: () => 'Victor Fortes', defaultDayUnit: 'dias_corridos' as const };

describe('padrão de título e observações', () => {
  test('título: Providência — Ato (Classe)', () => {
    const rec = { ...base, fullText: 'Publicação\nClasse: RECUPERAçãO JUDICIAL\nConteúdo: Intime-se a Copel para manifestar-se sobre a decisão no prazo de 5 dias.' };
    const a = classify(rec, opts).actions[0]!;
    expect(scheduleTitle(rec, a)).toBe('Manifestar-se — Decisão (Recuperação Judicial)');
  });
  test('ciência de acórdão: remove "(prazo presumido)" do título e avisa nas observações', () => {
    const rec = { ...base, fullText: 'Classe: AGRAVO DE INSTRUMENTO\nConteúdo: Fls. 43320: Ciência as partes sobre o acórdão proferido nos autos.' };
    const a = classify(rec, opts).actions[0]!;
    expect(scheduleTitle(rec, a)).toBe('Ciência sobre acórdão (Agravo de Instrumento)');
    const notes = scheduleNotes({ ...base, ...rec }, a);
    expect(notes).toContain('REVISADO COM ALERTAS');
    expect(notes).toContain('15 dias corridos');
    expect(notes).toContain('Publicação Astrea 359137884');
    expect(notes).toContain('sujeito à auditoria da Controladoria');
  });
  test('helpers', () => {
    expect(titleCase('AGRAVO DE INSTRUMENTO')).toBe('Agravo de Instrumento');
    expect(detectAto('Sr. Advogado, segue despacho')).toBe('Despacho');
    expect(detectClasse('Classe: RECUPERAçãO JUDICIAL\nConteúdo: x')).toBe('Recuperação Judicial');
    expect(detectClasse('sem classe')).toBeNull();
    // classe real longa: só o 1º termo
    expect(detectClasse('Classe: FALÊNCIA DE EMPRESÁRIOS, SOCIEDADES EMPRESÁRIAIS, MICROEMPRESAS\nConteúdo: x')).toBe('Falência de Empresários');
  });
});

describe('cartão "Tratamentos" da publicação (formato esperado; a confirmar na 1ª gravação autorizada)', () => {
  test('lê prazos criados, ignora tarefas e a lista de sugestões', () => {
    const t = ['Publicação', 'PROCESSO', 'TRATAMENTOS', 'Todas as alterações foram salvas', 'Prazo', '[TESTE] Ciência sobre acórdão', 'Data:', 'Sex, 13 de nov 2026', 'Responsável:', 'Victor Fortes',
      'Quadro Kanban:', 'FLUXO NGA', 'Coluna:', 'A Fazer', 'Observações:', 'Texto da observação [NGA:abc]', 'continua', 'Acessar detalhes', 'Tarefa', 'Outra coisa', 'Data:', 'Sex, 6 de nov 2026'].join('\n');
    const c = parseTreatmentCards(t);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ title: '[TESTE] Ciência sobre acórdão', dueDate: '2026-11-13', responsible: 'Victor Fortes', kanbanBoard: 'FLUXO NGA', kanbanColumn: 'A Fazer' });
    expect(c[0]!.description).toBe('Texto da observação [NGA:abc]\ncontinua');
    expect(parseTreatmentCards('sem cartão')).toEqual([]);
  });
});

describe('calculadora do Astrea (texto do formulário)', () => {
  test('lê publicação, início, feriados', () => {
    const c = parseCalculator(['ADICIONAR PRAZO', 'Data da publicação', '22/10/2026', 'Início do prazo', '23/10/2026', 'Prazo', 'Considerar feriado e recesso', 'Dia de Finados - 02/11/2026 (segunda-feira)', 'Este cálculo é meramente uma ferramenta'].join('\n'));
    expect(c.publicationDate).toBe('2026-10-22');
    expect(c.startDate).toBe('2026-10-23');
    expect(c.holidays).toEqual([{ name: 'Dia de Finados', date: '2026-11-02' }]);
    expect(c.multipleAlerts).toBe(false);
    expect(parseCalculator('Adicionar alerta').multipleAlerts).toBe(true);
    // tooltip/ícone entre o rótulo e a data, e data na mesma linha
    expect(parseCalculator(['Data da publicação 22/10/2026', 'Início do prazo', 'ⓘ', '23/10/2026'].join('\n'))).toMatchObject({ publicationDate: '2026-10-22', startDate: '2026-10-23' });
  });
});

import { followUpPlan, nextBusinessIso, priorityFor } from '../src/writer/tasks.ts';
describe('tarefas de acompanhamento (datas)', () => {
  const H = new Set<string>();
  test('análise: dia útil seguinte ao agendamento; sexta agenda ⇒ segunda', () => {
    expect(nextBusinessIso('2026-10-28', H)).toBe('2026-10-29'); // qua → qui
    expect(nextBusinessIso('2026-10-30', H)).toBe('2026-11-02'); // sex → seg
  });
  test('protocolo: dia útil seguinte ao fatal; fatal em sexta ⇒ segunda; feriado é pulado', () => {
    const p = followUpPlan({ amount: 5, endTerm: '2026-10-30' }, 'Victor Fortes', { today: '2026-10-28', holidays: new Set(['2026-11-02']), protocolResponsible: 'Camilla Rodrigues' });
    expect(p[0]).toMatchObject({ title: 'Analisar Intimação + Verificar Providências', dueDate: '2026-10-29', responsible: 'Victor Fortes', priority: 'Média' });
    expect(p[1]).toMatchObject({ title: 'Conferir Protocolo / Renúncia', dueDate: '2026-11-03', responsible: 'Camilla Rodrigues' });
  });
  test('prioridade como nos workflows: 5/15 média, 10/30 baixa', () => { expect([5, 10, 15, 30, 7].map(priorityFor)).toEqual(['Média', 'Baixa', 'Média', 'Baixa', 'Média']); });
});

import { workflowName, workflowSizeFor } from '../src/astrea/port.ts';
test('workflow: por decisão do escritório, sempre o de 5 dias', () => {
  for (const d of [1, 5, 10, 15, 30, 45]) expect(workflowName(workflowSizeFor(d))).toBe('PRAZO 05 DIAS CORRIDOS');
});
