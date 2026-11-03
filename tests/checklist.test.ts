import { describe, expect, test } from 'bun:test';
import {
  type ItemDeChecklist, type SituacaoRequisito, MODELOS, TransicaoInvalida,
  calcularProgresso, modeloDe, transicionar,
} from '../src/domain/portal/checklist.ts';

const item = (situacao: SituacaoRequisito, obrigatorio = true, categoria = 'Contábil'): ItemDeChecklist =>
  ({ id: Math.random().toString(36), categoria, titulo: 't', situacao, obrigatorio });

describe('máquina de situações', () => {
  test('o cliente envia; só a NGA aprova', () => {
    expect(transicionar('pendente', 'enviado', 'cliente')).toBe('enviado');
    expect(() => transicionar('enviado', 'aprovado', 'cliente')).toThrow(TransicaoInvalida);
    expect(transicionar('enviado', 'aprovado', 'nga')).toBe('aprovado');
  });

  test('o cliente não pode pular direto para aprovado', () => {
    expect(() => transicionar('pendente', 'aprovado', 'cliente')).toThrow(TransicaoInvalida);
    expect(() => transicionar('pendente', 'aprovado', 'nga')).toThrow(TransicaoInvalida);
  });

  test('rejeitado e complementação voltam para envio', () => {
    expect(transicionar('rejeitado', 'enviado', 'cliente')).toBe('enviado');
    expect(transicionar('complementacao', 'enviado', 'cliente')).toBe('enviado');
  });

  test('a NGA pode reabrir um item aprovado', () => {
    expect(transicionar('aprovado', 'complementacao', 'nga')).toBe('complementacao');
    expect(() => transicionar('aprovado', 'enviado', 'cliente')).toThrow(TransicaoInvalida);
  });

  test('a mensagem de erro diz quem não pode o quê', () => {
    expect(() => transicionar('enviado', 'aprovado', 'cliente'))
      .toThrow(/o cliente não pode marcar o item como "Aprovado"/);
  });
});

describe('progresso', () => {
  test('enviar NÃO é concluir — as duas barras divergem', () => {
    const p = calcularProgresso([
      item('aprovado'), item('enviado'), item('em_analise'), item('pendente'),
    ]);
    expect(p.percentualAprovado).toBe(25);
    expect(p.percentualEnviado).toBe(75);
    expect(p.concluido).toBe(false);
  });

  test('só fecha quando tudo que é obrigatório foi APROVADO', () => {
    expect(calcularProgresso([item('aprovado'), item('aprovado')]).concluido).toBe(true);
    expect(calcularProgresso([item('aprovado'), item('enviado')]).concluido).toBe(false);
  });

  test('item opcional não entra no denominador', () => {
    const p = calcularProgresso([item('aprovado'), item('pendente', false)]);
    expect(p.obrigatorios).toBe(1);
    expect(p.percentualAprovado).toBe(100);
    expect(p.concluido).toBe(true);
    expect(p.total).toBe(2);
  });

  test('checklist vazio não é 100 %', () => {
    const p = calcularProgresso([]);
    expect(p.percentualAprovado).toBe(0);
    expect(p.concluido).toBe(false);
  });

  test('checklist só de opcionais não anuncia conclusão', () => {
    const p = calcularProgresso([item('pendente', false), item('aprovado', false)]);
    expect(p.obrigatorios).toBe(0);
    expect(p.concluido).toBe(false);
  });

  test('separa de quem é a bola', () => {
    const p = calcularProgresso([
      item('pendente'), item('rejeitado'), item('complementacao'),
      item('enviado'), item('em_analise'), item('aprovado'),
    ]);
    expect(p.aguardandoOCliente).toBe(3);
    expect(p.aguardandoANGA).toBe(2);
  });

  test('agrupa por categoria', () => {
    const p = calcularProgresso([
      item('aprovado', true, 'Contábil'), item('pendente', true, 'Contábil'),
      item('aprovado', true, 'Fiscal'),
    ]);
    const porCat = Object.fromEntries(p.porCategoria.map((c) => [c.categoria, c]));
    expect(porCat['Contábil']).toMatchObject({ total: 2, aprovados: 1, pendentes: 1 });
    expect(porCat['Fiscal']).toMatchObject({ total: 1, aprovados: 1, pendentes: 0 });
  });
});

describe('modelos por procedimento', () => {
  test('RJ e investigação patrimonial pedem documentos diferentes', () => {
    const rj = modeloDe('recuperacao_judicial');
    const inv = modeloDe('investigacao_patrimonial');
    expect(rj.length).toBeGreaterThan(inv.length);
    expect(rj.some((r) => r.titulo.includes('Relação nominal completa de credores'))).toBe(true);
    expect(inv.some((r) => r.titulo.includes('credores'))).toBe(false);
  });

  test('os requisitos da RJ citam o art. 51', () => {
    const comFundamento = modeloDe('recuperacao_judicial').filter((r) => r.fundamento);
    expect(comFundamento.length).toBeGreaterThan(4);
    expect(comFundamento.every((r) => r.fundamento!.includes('Art. 51'))).toBe(true);
  });

  test('tipo sem modelo devolve lista vazia em vez de quebrar', () => {
    expect(modeloDe('contencioso_estrategico')).toEqual([]);
    expect(modeloDe('inexistente')).toEqual([]);
  });

  test('todo modelo tem ao menos um item obrigatório', () => {
    for (const [tipo, itens] of Object.entries(MODELOS)) {
      expect(itens.some((i) => i.obrigatorio), tipo).toBe(true);
    }
  });
});

describe('quem pode marcar o quê', () => {
  test('"enviado" aceita os dois lados: o documento chega por vários caminhos', () => {
    // Metade dos documentos de uma RJ chega por e-mail ou em papel e é a
    // equipe que registra. Quem registrou fica na auditoria.
    expect(transicionar('pendente', 'enviado', 'cliente')).toBe('enviado');
    expect(transicionar('pendente', 'enviado', 'nga')).toBe('enviado');
  });

  test('reenviar antes da análise é permitido', () => {
    expect(transicionar('enviado', 'enviado', 'cliente')).toBe('enviado');
  });

  test('mas o cliente não chega a aprovar, rejeitar nem reabrir', () => {
    for (const destino of ['aprovado', 'rejeitado', 'complementacao', 'em_analise'] as const) {
      expect(() => transicionar('enviado', destino, 'cliente')).toThrow(TransicaoInvalida);
    }
    expect(() => transicionar('aprovado', 'complementacao', 'cliente')).toThrow(TransicaoInvalida);
  });
});
