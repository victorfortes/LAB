import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { NotMappedError, SessionExpiredError } from '../src/astrea/port.ts';
import { LiveAstrea } from '../src/astrea/live.ts';
import { ParseError, brToIso, parseActivitiesText, parseDetail, parseListRow, parsePrazoModal, parsePtShortDate, scheduleKey, splitScheduleKey } from '../src/astrea/parse.ts';
import { loadSelectors } from '../src/astrea/selectors.ts';
import { classify, initialStateFor } from '../src/domain/classifier.ts';
import { serve } from './fixtures/fake-astrea.ts';

describe('parsers', () => {
  test('datas em português', () => {
    expect(parsePtShortDate('sex, 13 de nov 2026')).toBe('2026-11-13');
    expect(parsePtShortDate('Sex, 13 De Nov 2026 | X')).toBe('2026-11-13');
    expect(parsePtShortDate('sem data')).toBeNull();
    expect(brToIso('21/10/2026')).toBe('2026-10-21');
    expect(() => brToIso('2026-10-21')).toThrow(ParseError);
  });
  test('linha da lista', () => {
    const r = parseListRow(['', '21/10/2026', 'Publicado em: 22/10/2026', '1001409-24.2022.8.26.0260', 'Recuperação Judicial Fictícia', 'Responsável: Fulano', 'Não tratada',
      'Publicação Processo: 1001409-24.2022.8.26.0260 Órgão: Vara', 'Tratamentos sugeridos:', 'Adicionar um prazo para sex, 13 de nov 2026'].join('\n'));
    expect(r.divulgadoEm).toBe('2026-10-21');
    expect(r.processNumber).toBe('1001409-24.2022.8.26.0260');
    expect(r.responsible).toBe('Fulano');
    expect(r.untreated).toBe(true);
    expect(r.hints[0]!.dueDate).toBe('2026-11-13');
    expect(() => parseListRow('lixo')).toThrow(ParseError);
  });
  test('detalhe: texto integral para antes de IA/PROCESSO e extrai campos', () => {
    const t = ['Publicação', 'NÃO TRATADA', '', 'Divulgado em: 21/10/2026 - Publicado em: 22/10/2026', 'Processo: 1001409-24.2022.8.26.0260', 'Diário: TJSPDJN', '',
      'Publicação', 'Processo: 1001409-24.2022.8.26.0260', 'Data de disponibilização: 21/10/2026', 'Conteúdo: Fls. 1: Ciência as partes sobre o acórdão proferido nos autos juntado.', '', 'IA',
      'TRATAMENTOS SUGERIDOS', 'PRAZO', 'Ciência sobre acórdão', 'Sex, 13 De Nov 2026 | Fulano', 'PROCESSO', 'Cliente: Cliente Fictício', 'Responsável: Fulano'].join('\n');
    const d = parseDetail(t);
    expect(d.availabilityDate).toBe('2026-10-21');
    expect(d.publishedDate).toBe('2026-10-22');
    expect(d.fullText).toContain('Ciência as partes');
    expect(d.fullText).not.toContain('TRATAMENTOS');
    expect(d.clientName).toBe('Cliente Fictício');
    expect(d.untreated).toBe(true);
    expect(d.hints[0]).toEqual({ title: 'Ciência sobre acórdão', dueDate: '2026-11-13', responsible: 'Fulano' });
    expect(() => parseDetail('nada reconhecível')).toThrow(ParseError);
  });
});

describe('parsers — formato REAL observado (rótulo/valor em linhas separadas, selo IA no meio do texto, maiúsculas)', () => {
  const real = ['Publicação', 'NÃO TRATADA', '', 'Divulgado em: 21/10/2026 - Publicado em: 22/10/2026', '', 'Publicação', 'Processo: 1001409-24.2022.8.26.0260',
    'Data de disponibilização: 21/10/2026', 'Parte: FICTÍCIA S/A Polo: ATIVO', 'Advogado: FULANO DE TAL - OAB SP-1', 'Conteúdo: Fls. 1: Ciência as partes sobre o acórdão proferido.', 'IA', ' - ADV: BELTRANO (continuação do texto)',
    'VOLTAR', 'TRATAMENTOS', 'DESCARTAR', 'CONCLUIR', 'PROCESSO', 'Recuperação Judicial Fictícia', 'Pasta: 1', 'Processo:', '1001409-24.2022.8.26.0260', 'Cliente:', 'Cliente Fictício S.A.',
    'Responsável:', 'Fulana Fictícia', '', 'IA', 'TRATAMENTOS SUGERIDOS', 'PRAZO', '', 'Ciência sobre acórdão', 'Sex, 13 De Nov 2026', '|', 'Fulana Fictícia', 'TAREFA', 'Notificar cliente'].join('\n');
  test('texto integral inclui o que vem depois do selo IA e para em VOLTAR', () => {
    const d = parseDetail(real);
    expect(d.fullText).toContain('continuação do texto');
    expect(d.fullText).not.toMatch(/^IA$/m);
    expect(d.fullText).not.toContain('VOLTAR');
    expect(d.fullText).not.toContain('Notificar cliente');
  });
  test('cliente/responsável e sugestão com rótulos em linhas separadas', () => {
    const d = parseDetail(real);
    expect(d.clientName).toBe('Cliente Fictício S.A.');
    expect(d.responsible).toBe('Fulana Fictícia');
    expect(d.hints).toEqual([{ title: 'Ciência sobre acórdão', dueDate: '2026-11-13', responsible: 'Fulana Fictícia' }]);
  });
  test('sugestão na lista em MAIÚSCULAS', () => {
    const r = parseListRow(['21/10/2026', 'Publicado em: 22/10/2026', '1001409-24.2022.8.26.0260', 'Caso', 'Responsável: X', 'Não tratada', 'PUBLICAÇÃO PROCESSO: 1001409-24.2022.8.26.0260', 'TRATAMENTOS SUGERIDOS:', 'ADICIONAR UM PRAZO PARA SEX, 13 DE NOV 2026'].join('\n'));
    expect(r.hints[0]!.dueDate).toBe('2026-11-13');
  });
});

describe('parsers — formato alternativo (TJPR): corpo logo após "Diário:", sem bloco "Publicação"', () => {
  const alt = ['Publicação', 'NÃO TRATADA', 'Diário do Tribunal de Justiça do Paraná', 'Vara: Divisao Fictícia', 'Divulgado em: 25/08/2026 - Publicado em: 26/08/2026', 'Processo: 0000001-00.2026.8.16.0000',
    'Termo encontrado: FULANO', 'Diário: TJPR', '{SrAdvogado}Sr. Advogado, Divulgamos o acórdão proferido nos autos.', 'Relator: Desembargadora Fictícia', 'Agravado: Fulana Ltda',
    'VOLTAR', 'TRATAMENTOS', 'DESCARTAR', 'CONCLUIR', 'PROCESSO', 'Cliente:', 'COPEL FICTÍCIA S/A', 'Responsável:', 'Victor Fortes'].join('\n');
  test('lê corpo, datas, cliente e responsável', () => {
    const d = parseDetail(alt);
    expect(d.availabilityDate).toBe('2026-08-25');
    expect(d.fullText).toContain('Divulgamos o acórdão');
    expect(d.fullText).not.toContain('VOLTAR');
    expect(d.clientName).toBe('COPEL FICTÍCIA S/A');
    expect(d.responsible).toBe('Victor Fortes');
  });
});

describe('parsers de atividades — formato REAL observado (conteúdo fictício)', () => {
  const act = ['Fulano', 'Processo', '0000001-00.2025.8.16.0001', 'Resumo', 'Atividades', 'Histórico', '2 ABERTAS', '17 CONCLUÍDAS',
    'PRAZO', '', 'MANIFESTAR', '', 'qui, 25 de jun 2026', '', '2 atividades', 'Fulano', '+1', 'Analisar Intimação', 'sex, 19 de jun 2026', 'Fulano', 'Conferir', 'sex, 26 de jun 2026', 'Beltrana',
    'AUDIÊNCIA', 'AGC - 1', 'qua, 28 de out 2026', '10:00 às 10:30', 'Fulano', '+2', 'Baixar ATA', 'qui, 29 de out 2026', 'Beltrana',
    'PRAZO', 'MANIFESTAR', 'qui, 25 de jun 2026', 'Fulano', 'TAREFA', 'REQUISIÇÃO', 'sex, 18 de set 2026', 'Beltrana'].join('\n');
  test('só atividades de topo (com TIPO), ignorando tarefas-filhas; ocorrência desambigua repetidas', () => {
    const rows = parseActivitiesText(act);
    expect(rows.map((r) => `${r.type}|${r.title}|${r.dueDate}|${r.occurrence}`)).toEqual([
      'PRAZO|MANIFESTAR|2026-06-25|0', 'AUDIÊNCIA|AGC - 1|2026-10-28|0', 'PRAZO|MANIFESTAR|2026-06-25|1', 'TAREFA|REQUISIÇÃO|2026-09-18|0',
    ]);
  });
  test('modal de Prazo', () => {
    const body = ['Fundo da página', 'PRAZO', 'Outro título', 'qui, 25 de jun 2026', 'Prazo', 'Habilitar adv', 'Data: Seg, 14 de set 2026', 'Processo: 004531 - Caso', 'Número do processo: 0000001-00.2025.8.16.0001',
      'Quadro Kanban: Kanban Padrão', 'Coluna: A Fazer', 'Responsável: Fulano', 'Observações: [NGA:abc] texto', 'linha 2 da observação', 'Criado por: Beltrana', 'Atividades', 'Checklists'].join('\n');
    const m = parsePrazoModal(body);
    expect(m).toMatchObject({ title: 'Habilitar adv', dueDate: '2026-09-14', processNumber: '0000001-00.2025.8.16.0001', responsible: 'Fulano', kanbanBoard: 'Kanban Padrão' });
    expect(m.description).toBe('[NGA:abc] texto\nlinha 2 da observação');
    expect(() => parsePrazoModal('sem modal')).toThrow(ParseError);
  });
  test('id sintético ida e volta (título pode conter "|")', () => {
    const id = scheduleKey('0000001-00.2025.8.16.0001', 'PRAZO', '2026-11-13', 'A | B');
    expect(splitScheduleKey(id)).toEqual({ proc: '0000001-00.2025.8.16.0001', type: 'PRAZO', dueDate: '2026-11-13', title: 'A | B' });
    expect(() => splitScheduleKey('x')).toThrow(ParseError);
  });
});

describe('navegador interno preso', () => {
  test('abertura do Astrea trava ⇒ reinicia o navegador e tenta de novo UMA vez', async () => {
    const b = await chromium.launch().catch(() => null);
    if (!b) return;
    const fake = serve({ hangFirst: 1 });
    try {
      let relaunches = 0;
      const ctx = await b.newContext();
      const l = new LiveAstrea(ctx, fake.url, loadSelectors('config/selectors.json'), { pageDelayMs: 0, timeoutMs: 20000, navTimeoutMs: 2500, relaunch: async () => { relaunches++; return b.newContext(); } });
      await expect(l.assertSession()).resolves.toBeUndefined();
      expect(relaunches).toBe(1);
    } finally { fake.stop(); await b.close(); }
  }, 120_000);
  test('sem relaunch configurado: o travamento vira erro claro (BrowserStuckError)', async () => {
    const b = await chromium.launch().catch(() => null);
    if (!b) return;
    const fake = serve({ hangFirst: 5 });
    try {
      const ctx = await b.newContext();
      const l = new LiveAstrea(ctx, fake.url, loadSelectors('config/selectors.json'), { pageDelayMs: 0, timeoutMs: 3000 });
      await expect(l.assertSession()).rejects.toThrow(/navegador interno/);
    } finally { fake.stop(); await b.close(); }
  }, 120_000);
});

describe('sugestão do Astrea como conferência cruzada', () => {
  const base = { externalId: '1', processNumber: 'p', clientName: 'c', availabilityDate: '2026-10-21', fullText: 'Manifeste-se no prazo de 15 dias úteis.' };
  const opts = { holidaysLoaded: true, holidays: new Set(['2026-11-02']), responsibleFor: () => 'R' };
  test('concorda ⇒ sem alerta', () => {
    const a = classify({ ...base, hints: [{ title: null, dueDate: '2026-11-13', responsible: null }] }, opts);
    expect(a.flags).not.toContain('sugestao_astrea_divergente');
  });
  test('diverge ⇒ alerta e análise humana', () => {
    const a = classify({ ...base, hints: [{ title: null, dueDate: '2026-11-20', responsible: null }] }, opts);
    expect(a.flags).toContain('sugestao_astrea_divergente');
    expect(initialStateFor(a)).toBe('needs_review');
  });
});

describe('LiveAstrea contra página-fixture (sem dados reais)', () => {
  let browser: Browser; let ctx: BrowserContext; let fake: ReturnType<typeof serve>; let up = true;
  beforeAll(async () => {
    try { browser = await chromium.launch(); ctx = await browser.newContext(); fake = serve(); } catch (e) { up = false; console.warn('Chromium indisponível, pulando:', (e as Error).message); }
  }, 150_000);
  afterAll(async () => { await browser?.close(); fake?.stop(); });
  const live = () => new LiveAstrea(ctx, fake.url, loadSelectors('config/selectors.json'), { pageDelayMs: 0, timeoutMs: 8000 });

  test('lê publicações não tratadas com id, texto, cliente e sugestões', async () => {
    if (!up) return;
    const pubs = await live().listUntreatedPublications({ limit: 10 });
    expect(pubs.map((p) => p.externalId)).toEqual(['9001', '9002']);
    expect(pubs[0]!.availabilityDate).toBe('2026-10-21');
    expect(pubs[0]!.clientName).toBe('Cliente Fictício A S.A.');
    expect(pubs[0]!.fullText).toContain('15 (quinze) dias úteis');
    expect(pubs[0]!.hints?.[0]?.dueDate).toBe('2026-11-13');
    expect(pubs[1]!.hints).toEqual([]);
  }, 150_000);

  test('uma publicação ilegível não derruba a leitura: é registrada em takeReadErrors', async () => {
    if (!up) return;
    const l = live();
    const orig = (l as any).openAndRead.bind(l); let n = 0;
    (l as any).openAndRead = async (...a: unknown[]) => { if (n++ === 0) throw new Error('layout inesperado'); return orig(...a); };
    const pubs = await l.listUntreatedPublications({ limit: 10 });
    expect(pubs.map((p) => p.externalId)).toEqual(['9002']);
    expect(l.takeReadErrors()[0]).toContain('layout inesperado');
    expect(l.takeReadErrors()).toEqual([]);
  }, 150_000);

  test('respeita o limite', async () => {
    if (!up) return;
    expect(await live().listUntreatedPublications({ limit: 1 })).toHaveLength(1);
  }, 150_000);

  test('assertSession ok; sem o menu logado ⇒ SessionExpiredError', async () => {
    if (!up) return;
    await expect(live().assertSession()).resolves.toBeUndefined();
    const sel = loadSelectors('config/selectors.json');
    sel.read.loggedInIndicator!.selector = 'nav a[href="#/nao-existe"]';
    const l = new LiveAstrea(ctx, fake.url, sel, { pageDelayMs: 0, timeoutMs: 8000 });
    await expect(l.assertSession()).rejects.toBeInstanceOf(SessionExpiredError);
  }, 150_000);

  test('guarda de somente leitura: POST disparado pela página é abortado e contado', async () => {
    if (!up) return;
    const l = live();
    await l.assertSession(); // instala o guard no contexto
    const page = await ctx.newPage();
    await page.goto(`${fake.url}#/main/clippings-treatment?id=9001`);
    await page.locator('#save').click();
    await page.waitForTimeout(300);
    await page.close();
    expect(fake.posts).toHaveLength(0); // o servidor nunca recebeu o POST
    expect(l.blockedMutations.some((m) => m.startsWith('POST'))).toBe(true);
  }, 150_000);

  test('findSchedules: busca → ficha → Atividades → modais; só PRAZOs, abertos e concluídos, com Observações', async () => {
    if (!up) return;
    const out = await live().findSchedules('0001234-56.2025.8.16.0001');
    expect(out.map((s) => `${s.title}|${s.dueDate}|${s.responsible}`)).toEqual([
      'Prazo fictício aberto|2026-11-13|Responsável Fictício', 'Prazo fictício concluído|2026-06-25|Outra Pessoa',
    ]);
    expect(out[0]!.description).toContain('[NGA:abc123]');
    expect(out[0]!.id).toBe('0001234-56.2025.8.16.0001|PRAZO|2026-11-13|Prazo fictício aberto');
  }, 150_000);

  test('readSchedule: acha pelo id sintético; inexistente ⇒ null; nada é gravado', async () => {
    if (!up) return;
    const l = live();
    const s = await l.readSchedule('0001234-56.2025.8.16.0001|PRAZO|2026-11-13|Prazo fictício aberto');
    expect(s?.description).toContain('[NGA:abc123]');
    expect(await l.readSchedule('0001234-56.2025.8.16.0001|PRAZO|2030-01-01|Não existe')).toBeNull();
    expect(fake.posts).toHaveLength(0);
  }, 150_000);

  test('ensaio: preenche, lê a calculadora, lê o Kanban e CANCELA sem nenhuma escrita', async () => {
    if (!up) return;
    const l = live();
    const r = await l.dryRunSchedule({ publicationId: '9001', title: '[ENSAIO] Fictício', amount: 15, unit: 'dias_corridos', expectedDueDate: '2026-11-06' });
    expect(r.ok).toBe(true);
    expect(r.astrea).toMatchObject({ publicationDate: '2026-10-22', startDate: '2026-10-23', dueDate: '2026-11-06' });
    expect(r.astrea.holidays).toEqual([{ name: 'Dia de Finados', date: '2026-11-02' }]);
    expect(r.matches).toBe(true);
    expect(r.kanban.boards).toEqual(['Kanban Padrão', 'FLUXO NGA']);
    expect(r.kanban.columns['FLUXO NGA']).toEqual(['Entrada', 'Análise', 'Feito']);
    expect(r.cancelled).toBe(true);
    expect(r.writeAttempts).toBe(0);
    expect(fake.posts).toHaveLength(0);
  }, 150_000);

  test('ensaio: data do Astrea diferente da do robô ⇒ matches=false (não gravar)', async () => {
    if (!up) return;
    const r = await live().dryRunSchedule({ publicationId: '9001', title: 'x', amount: 15, unit: 'dias_uteis', expectedDueDate: '2026-11-13' });
    expect(r.ok).toBe(true);
    expect(r.matches).toBe(false);
    expect(r.astrea.dueDate).toBe('2026-11-12'); // a página-fixture não desconta Finados
    expect(r.cancelled).toBe(true);
  }, 150_000);

  describe('createSchedule (janela de escrita controlada)', () => {
    const input = (over: Record<string, unknown> = {}) => ({
      processNumber: '0001234-56.2025.8.16.0001', title: '[TESTE NGA PRAZOS] Fictício', description: 'Observação fictícia [NGA:k1]', dueDate: '2026-11-06',
      responsible: 'Victor Fortes', idempotencyKey: 'k1',
      live: { publicationId: '9001', amount: 15, unit: 'dias_corridos' as const, kanban: { board: 'FLUXO NGA', column: 'Análise' }, alertDays: 7 }, ...over,
    });
    const mk = (o: Record<string, unknown> = {}) => new LiveAstrea(ctx, fake.url, loadSelectors('config/selectors.json'), { pageDelayMs: 0, timeoutMs: 20000, ...o });

    test('sem endpoint aprendido/fixado: NotMappedError e nada é enviado', async () => {
      if (!up) return;
      const before = fake.posts.length;
      await expect(mk().createSchedule(input() as never)).rejects.toBeInstanceOf(NotMappedError);
      expect(fake.posts.length).toBe(before);
    }, 150_000);

    test('grava 1 prazo: campos exatos, UMA requisição na janela, registrada; releitura pelo cartão da publicação', async () => {
      if (!up) return;
      const l = mk({ learnWrite: true });
      const before = fake.saved.length;
      const r = await l.createSchedule(input() as never);
      expect(r.id).toBe('0001234-56.2025.8.16.0001|PRAZO|2026-11-06|[TESTE NGA PRAZOS] Fictício');
      expect(fake.saved).toHaveLength(before + 1);
      expect(fake.saved.at(-1)).toMatchObject({ title: '[TESTE NGA PRAZOS] Fictício', due: '06/11/2026', resp: 'Victor Fortes', board: 'FLUXO NGA', col: 'Análise', alert: '7', notes: 'Observação fictícia [NGA:k1]' });
      expect(l.observedWrites).toHaveLength(1);
      expect(l.observedWrites[0]).toMatch(/^POST .*\/api\/save-prazo$/);
      const cards = await mk().listPublicationSchedules('9001', '0001234-56.2025.8.16.0001');
      const c = cards.find((x) => x.description.includes('[NGA:k1]'))!;
      expect(c).toMatchObject({ title: '[TESTE NGA PRAZOS] Fictício', dueDate: '2026-11-06', responsible: 'Victor Fortes' });
      expect(c.id).toBe(r.id);
    }, 150_000);

    test('data do Astrea diferente da do robô: ABORTA, cancela o formulário e não envia nada', async () => {
      if (!up) return;
      const l = mk({ learnWrite: true });
      const before = fake.posts.length;
      await expect(l.createSchedule(input({ dueDate: '2026-11-13' }) as never)).rejects.toThrow(/ABORTADA/);
      expect(fake.posts.length).toBe(before);
      expect(l.observedWrites).toHaveLength(0);
    }, 150_000);

    test('lista de caminhos fixada que NÃO casa: o Salvar é bloqueado pela guarda (nada chega ao servidor)', async () => {
      if (!up) return;
      const l = mk({ writeAllow: '/api/outro-caminho$', timeoutMs: 15000 });
      const before = fake.posts.length;
      const err = await l.createSchedule(input({ title: '[TESTE] bloqueado', description: 'x [NGA:k2]' }) as never).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(fake.posts.length).toBe(before);
      expect(l.blockedMutations.some((m) => m.startsWith('POST'))).toBe(true);
    }, 150_000);

    test('lista de caminhos fixada que casa: grava', async () => {
      if (!up) return;
      const before = fake.saved.length;
      await mk({ writeAllow: '/api/save-prazo$' }).createSchedule(input({ title: '[TESTE] fixado', description: 'y [NGA:k3]' }) as never);
      expect(fake.saved).toHaveLength(before + 1);
    }, 150_000);
  });

  describe('applyWorkflow (no próprio prazo)', () => {
    const mk = (o: Record<string, unknown> = {}) => new LiveAstrea(ctx, fake.url, loadSelectors('config/selectors.json'), { pageDelayMs: 0, timeoutMs: 20000, ...o });
    const input = (over: Record<string, unknown> = {}) => ({ processNumber: '0001234-56.2025.8.16.0001', title: 'Prazo para workflow', description: 'Obs [NGA:kw]', dueDate: '2026-11-06', responsible: 'Victor Fortes', idempotencyKey: 'kw', live: { publicationId: '9001', amount: 15, unit: 'dias_corridos' as const, kanban: { board: 'FLUXO NGA', column: 'Análise' }, alertDays: 7 }, ...over });

    test('sem escrita habilitada: NotMappedError e nada é enviado', async () => {
      if (!up) return;
      const before = fake.workflows.length;
      await expect(mk().applyWorkflow({ publicationId: '9001', prazoTitle: 'Prazo para workflow', amount: 15 })).rejects.toBeInstanceOf(NotMappedError);
      expect(fake.workflows.length).toBe(before);
    }, 150_000);

    test('aplica sempre o workflow de 5 dias (prazo de 15 dias ⇒ PRAZO 05), confirma pelas atividades e é idempotente', async () => {
      if (!up) return;
      const l = mk({ learnWrite: true });
      await l.createSchedule(input() as never);
      const r = await l.applyWorkflow({ publicationId: '9001', prazoTitle: 'Prazo para workflow', amount: 15 });
      expect(r).toMatchObject({ workflow: 'PRAZO 05 DIAS CORRIDOS', confirmed: true, adopted: false });
      expect(fake.workflows.at(-1)).toMatchObject({ title: 'Prazo para workflow', workflow: 'PRAZO 05 DIAS CORRIDOS' });
      expect(l.observedWrites.length).toBeLessThanOrEqual(6);
      const again = await mk({ learnWrite: true }).applyWorkflow({ publicationId: '9001', prazoTitle: 'Prazo para workflow', amount: 15 });
      expect(again).toMatchObject({ confirmed: true, adopted: true });
      expect(fake.workflows.filter((w) => w.title === 'Prazo para workflow')).toHaveLength(1);
    }, 150_000);
  });

  describe('createTask (tarefas de acompanhamento)', () => {
    const mk = (o: Record<string, unknown> = {}) => new LiveAstrea(ctx, fake.url, loadSelectors('config/selectors.json'), { pageDelayMs: 0, timeoutMs: 20000, ...o });
    const input = (over: Record<string, unknown> = {}) => ({ publicationId: '9001', title: 'Analisar Intimação + Verificar Providências', dueDate: '2026-10-29', responsible: 'Camilla Rodrigues', priority: 'Média' as const, kanban: { board: 'FLUXO NGA', column: 'Análise' }, ...over });

    test('sem escrita habilitada: NotMappedError e nada é enviado', async () => {
      if (!up) return;
      const before = fake.tasks.length;
      await expect(mk().createTask(input() as never)).rejects.toBeInstanceOf(NotMappedError);
      expect(fake.tasks.length).toBe(before);
    }, 150_000);

    test('cria a tarefa com os campos exatos, uma requisição na janela, e a releitura a encontra', async () => {
      if (!up) return;
      const l = mk({ learnWrite: true });
      const r = await l.createTask(input() as never);
      expect(r.confirmed).toBe(true);
      expect(fake.tasks.at(-1)).toMatchObject({ title: 'Analisar Intimação + Verificar Providências', due: '29/10/2026', resp: 'Camilla Rodrigues', priority: 'Média', board: 'FLUXO NGA', col: 'Análise' });
      expect(l.observedWrites).toHaveLength(1);
      expect(await mk().taskExists('9001', 'Analisar Intimação + Verificar Providências')).toBe(true);
      expect(await mk().taskExists('9001', 'Conferir Protocolo / Renúncia')).toBe(false);
    }, 150_000);
  });

  describe('concludePublication e guarda de status', () => {
    const input = (id: string) => ({
      processNumber: '0001234-56.2025.8.16.0001', title: 'Fictício', description: 'Obs [NGA:kc]', dueDate: '2026-11-06', responsible: 'Victor Fortes', idempotencyKey: 'kc',
      live: { publicationId: id, amount: 15, unit: 'dias_corridos' as const, kanban: { board: 'FLUXO NGA', column: 'Análise' }, alertDays: 7 },
    });
    const mk = (o: Record<string, unknown> = {}) => new LiveAstrea(ctx, fake.url, loadSelectors('config/selectors.json'), { pageDelayMs: 0, timeoutMs: 20000, ...o });

    test('Concluir: marca a publicação como TRATADA e confirma relendo o status', async () => {
      if (!up) return;
      const l = mk({ learnWrite: true });
      expect(await l.concludePublication('9002')).toEqual({ treated: true, status: 'TRATADA' });
      expect(l.observedWrites.length).toBeLessThanOrEqual(6);
      expect(await mk({ learnWrite: true }).concludePublication('9002')).toEqual({ treated: true, status: 'TRATADA' }); // já tratada: idempotente
    }, 150_000);

    test('publicação já TRATADA por outra pessoa: createSchedule ABORTA antes de abrir o formulário', async () => {
      if (!up) return;
      const before = fake.saved.length;
      await expect(mk({ learnWrite: true }).createSchedule(input('9002') as never)).rejects.toThrow(/TRATADA.*gravação ABORTADA/);
      expect(fake.saved.length).toBe(before);
    }, 150_000);
  });

  describe('deleteTestSchedule (Etapa 3)', () => {
    const PREFIX = '[TESTE NGA PRAZOS] ';
    const mk = (o: Record<string, unknown> = {}) => new LiveAstrea(ctx, fake.url, loadSelectors('config/selectors.json'), { pageDelayMs: 0, timeoutMs: 20000, ...o });

    test('recusa título SEM o prefixo de teste (nada é enviado)', async () => {
      if (!up) return;
      const before = fake.posts.length;
      await expect(mk({ learnWrite: true }).deleteTestSchedule({ publicationId: '9001', title: 'Prazo real do escritório', titlePrefix: PREFIX })).rejects.toThrow(/só exclui prazos de TESTE/);
      expect(fake.posts.length).toBe(before);
    }, 150_000);

    test('recusa quando não há exatamente 1 card (título inexistente) e quando o card não tem o marcador do robô', async () => {
      if (!up) return;
      const before = fake.posts.length;
      await expect(mk({ learnWrite: true }).deleteTestSchedule({ publicationId: '9001', title: `${PREFIX}Não existe`, titlePrefix: PREFIX })).rejects.toThrow(/esperado exatamente 1/);
      expect(fake.posts.length).toBe(before);
    }, 150_000);

    test('sem endpoint aprendido/fixado: NotMappedError', async () => {
      if (!up) return;
      await expect(mk().deleteTestSchedule({ publicationId: '9001', title: `${PREFIX}Fictício`, titlePrefix: PREFIX })).rejects.toBeInstanceOf(NotMappedError);
    }, 150_000);

    test('exclui o prazo de teste: ⋮ > Excluir > Confirmar; relê: sumiu e a publicação segue NÃO TRATADA', async () => {
      if (!up) return;
      const before = fake.saved.length;
      expect(fake.saved.some((x) => x.title === `${PREFIX}Fictício`)).toBe(true);
      const l = mk({ learnWrite: true });
      const r = await l.deleteTestSchedule({ publicationId: '9001', title: `${PREFIX}Fictício`, titlePrefix: PREFIX });
      expect(r).toMatchObject({ deleted: true, remainingMatches: 0, stillUntreated: true });
      expect(fake.saved).toHaveLength(before - 1);
      expect(fake.saved.some((x) => x.title === `${PREFIX}Fictício`)).toBe(false);
      expect(l.observedWrites.some((m) => /delete-prazo$/.test(m))).toBe(true);
      expect(fake.saved.some((x) => x.title === '[TESTE] fixado')).toBe(true); // o outro prazo NÃO foi tocado
    }, 150_000);
  });

  test('escrita segue NÃO mapeada', async () => {
    if (!up) return;
    const l = live();
    await expect(l.createSchedule({} as never)).rejects.toBeInstanceOf(NotMappedError);
    await expect(l.updateSchedule()).rejects.toBeInstanceOf(NotMappedError);
  });
});
