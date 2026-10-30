import type { BrowserContext, Locator, Page } from 'playwright';
import type { AutoLoginResult } from './auto-login.ts';
import { DueDateMismatch, NotMappedError, SessionExpiredError, type AstreaPort, type AstreaSchedule, type DryRunInput, type DryRunResult, type ScheduleInput, type TaskInput, type WorkflowInput, workflowName, workflowSizeFor } from './port.ts';
import { brToIso, parseActivitiesText, parseCalculator, parseTreatmentCards, parseDetail, parseListRow, parsePrazoModal, scheduleKey, splitScheduleKey, type ActivityRow, type ListRow } from './parse.ts';
import { guardRequest, normalizePath } from './recon.ts';
import { requireSelector, type SelectorMap } from './selectors.ts';
import type { RawPublication } from '../domain/types.ts';

/** A página do Astrea não abriu no prazo: o navegador interno pode estar preso (ex.: após suspensão do computador). */
export class BrowserStuckError extends Error {
  constructor(m = 'O navegador interno não conseguiu abrir o Astrea (possivelmente preso após suspensão do computador).') { super(m); }
}

export interface LiveOptions {
  /** Recria o navegador interno quando a abertura do Astrea trava (1 tentativa, no início de cada execução). */
  relaunch?: () => Promise<BrowserContext>;
  /** Prazo da 1ª abertura do Astrea antes de considerar o navegador preso. */
  navTimeoutMs?: number;
  /** Máximo de publicações por execução (cada uma = 1 navegação ao detalhe). */
  maxPerRun?: number;
  /** Pausa entre navegações, para não sobrecarregar o Astrea. */
  pageDelayMs?: number;
  timeoutMs?: number;
  /** Regex (string) dos caminhos de escrita PERMITIDOS durante o clique em Salvar (fixada após o 1º teste autorizado). */
  writeAllow?: string | null;
  /** Aprendizado do endpoint de gravação: só no teste autorizado; registra método+caminho (nunca o conteúdo). */
  learnWrite?: boolean;
  /** Login automático (credenciais do cofre). Uma tentativa por vez; MFA/CAPTCHA nunca são contornados. */
  autoLogin?: (page: Page) => Promise<AutoLoginResult>;
}

/** Janela de escrita: abre SÓ durante o clique em Salvar; no máximo `max` requisições; tudo é registrado. */
const WRITE_WINDOW_MAX = 6;

/**
 * Adaptador Playwright para o Astrea REAL — leitura por padrão; escrita só pela janela controlada de createSchedule.
 *
 * Implementado (leitura): assertSession, listUntreatedPublications, findSchedules/readSchedule (ficha do processo > Atividades,
 * tipo Prazo). NÃO implementado (NotMapped): createSchedule/updateSchedule.
 *
 * Segurança:
 *  - Usa o perfil persistente autenticado MANUALMENTE; login/MFA/CAPTCHA nunca são automatizados.
 *  - Toda requisição não-GET ao host do Astrea é ABORTADA (guarda de somente leitura) e contada em `blockedMutations`.
 *  - Só clica em "Acessar publicação" e lê texto; nunca em Concluir/Descartar/Salvar/Excluir.
 *  - Seletores vêm de config/selectors.json (confirmados por observação).
 */
export class LiveAstrea implements AstreaPort {
  readonly mode = 'live' as const;
  blockedMutations: string[] = [];
  private readErrors: string[] = [];
  private guarded = false;
  private opts: Required<Omit<LiveOptions, 'autoLogin' | 'relaunch'>> & { autoLogin?: LiveOptions['autoLogin']; relaunch?: LiveOptions['relaunch'] };
  /** Janela estreita em que as requisições de escrita do Salvar são liberadas e REGISTRADAS. Fora dela, tudo não-GET é abortado. */
  private writeWindow: { observed: string[] } | null = null;
  /** Método+caminho (normalizado, sem query/conteúdo) de tudo que passou pela janela de escrita. */
  observedWrites: string[] = [];
  /** Janela do LOGIN automático: libera até 8 requisições não-GET ao host durante autoLogin() (o login não é escrita de dados). */
  private loginWindow: { count: number } | null = null;
  private autoLoginFailedAt = 0;

  constructor(private ctx: BrowserContext, private baseUrl: string, private sel: SelectorMap, opts: LiveOptions = {}) {
    this.opts = {
      maxPerRun: opts.maxPerRun ?? 25, pageDelayMs: opts.pageDelayMs ?? 800, timeoutMs: opts.timeoutMs ?? 90_000,
      writeAllow: opts.writeAllow ?? null, learnWrite: opts.learnWrite ?? false, autoLogin: opts.autoLogin, relaunch: opts.relaunch, navTimeoutMs: opts.navTimeoutMs ?? 45_000,
    };
    this.serialize(['assertSession', 'listUntreatedPublications', 'findSchedules', 'readSchedule', 'listPublicationSchedules', 'dryRunSchedule', 'deleteTestSchedule', 'createSchedule', 'concludePublication', 'createTask', 'taskExists', 'applyWorkflow']);
  }

  private get listUrl() {
    return `${this.baseUrl.replace(/#.*$/, '').replace(/\/?$/, '/')}#/main/clippings`;
  }

  private async installGuard() {
    if (this.guarded) return;
    const host = new URL(this.baseUrl).host;
    await this.ctx.route('**/*', (route) => {
      const req = route.request();
      if (new URL(req.url()).host === host) {
        const d = guardRequest(req.method(), req.url());
        if (d.block) {
          const path = normalizePath(req.url());
          const w = this.writeWindow;
          // Só dentro da janela, no máx. WRITE_WINDOW_MAX requisições, e só se o caminho foi aprendido (modo teste) ou está na lista fixada.
          if (this.loginWindow && this.loginWindow.count < 8) { this.loginWindow.count++; return route.continue(); }
          const allowed = !!w && w.observed.length < WRITE_WINDOW_MAX
            && (this.opts.learnWrite || (!!this.opts.writeAllow && new RegExp(this.opts.writeAllow).test(path)));
          if (allowed) { w!.observed.push(`${req.method()} ${path}`); return route.continue(); }
          this.blockedMutations.push(`${req.method()} ${path}`);
          return route.abort('blockedbyclient');
        }
      }
      return route.continue();
    });
    this.guarded = true;
  }

  private async newPage(): Promise<Page> {
    await this.installGuard();
    const page = await this.ctx.newPage();
    page.setDefaultTimeout(this.opts.timeoutMs);
    return page;
  }

  private async gotoList(page: Page, navTimeout = this.opts.timeoutMs) {
    try {
      await page.goto(this.listUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    } catch (e) {
      if ((e as Error).name === 'TimeoutError') throw new BrowserStuckError();
      throw e;
    }
    // Sessão: sem o link do menu lateral o usuário não está logado.
    const loggedIn = requireSelector(this.sel, 'read', 'loggedInIndicator');
    const wait = (ms: number) => page.locator(loggedIn).first().waitFor({ state: 'attached', timeout: Math.min(this.opts.timeoutMs, ms) });
    try {
      await wait(this.opts.autoLogin ? 12_000 : 30_000);
    } catch {
      if (!this.opts.autoLogin) throw new SessionExpiredError();
      await this.tryAutoLogin(page);
      try { await wait(30_000); } catch { throw new SessionExpiredError(); }
    }
    const article = requireSelector(this.sel, 'read', 'listArticle');
    const empty = requireSelector(this.sel, 'read', 'listEmptyState');
    // O estado vazio pode piscar durante o carregamento: o indicador estável é "Mostrando N publicações".
    const showing = page.locator(requireSelector(this.sel, 'read', 'listCount')).first();
    // Astrea lento (a lista chega a levar 40–90 s para carregar): espera com folga; só recarrega UMA vez se ainda assim não aparecer.
    const listWait = Math.max(this.opts.timeoutMs, 100_000);
    const slow = (n: number) => new Error(`O Astrea está muito lento: a lista de publicações não carregou em ${Math.round(n / 1000)} s. Tente de novo daqui a alguns minutos.`);
    try {
      await showing.or(page.locator(empty)).first().waitFor({ state: 'attached', timeout: listWait });
    } catch (e) {
      if ((e as Error).name !== 'TimeoutError') throw e;
      await page.goto('about:blank'); await page.goto(this.listUrl, { waitUntil: 'domcontentloaded' });
      try { await showing.or(page.locator(empty)).first().waitFor({ state: 'attached', timeout: listWait }); } catch { throw slow(listWait * 2); }
    }
    if ((await showing.count()) === 0) {
      try { await showing.waitFor({ state: 'attached', timeout: 6000 }); } catch { /* realmente vazio */ }
    }
    if ((await showing.count()) > 0 && !/Mostrando\s+0\s/i.test(await showing.innerText())) {
      await page.locator(article).first().waitFor({ state: 'attached', timeout: this.opts.timeoutMs });
    }
    // O filtro precisa ser "Não tratada": se o chip não existir, não assumimos nada.
    const chip = requireSelector(this.sel, 'read', 'listStatusChip');
    if ((await page.locator(chip).count()) === 0) throw new NotMappedError('filtro "status: Não tratada" não está ativo na lista; ajuste o filtro manualmente');
  }

  /** Uma tentativa; após falha, NÃO repete por 10 min (senha errada repetida pode bloquear a conta). Nunca contorna MFA/CAPTCHA. */
  private async tryAutoLogin(page: Page) {
    if (Date.now() - this.autoLoginFailedAt < 10 * 60_000) throw new SessionExpiredError('O login automático falhou há pouco e não será repetido para não bloquear a conta. Verifique o acesso salvo ou faça o login manual.');
    this.loginWindow = { count: 0 };
    let r: AutoLoginResult;
    try { r = await this.opts.autoLogin!(page); } finally { this.loginWindow = null; }
    // goto na mesma URL com hash NÃO recarrega (a lista ficaria presa no carregamento): passa por about:blank.
    if (r === 'ok') { await page.goto('about:blank'); await page.goto(this.listUrl, { waitUntil: 'domcontentloaded' }); return; }
    if (r !== 'no_credentials') this.autoLoginFailedAt = Date.now();
    throw new SessionExpiredError(
      r === 'no_credentials' ? 'Sem credenciais salvas: configure o acesso ao Astrea no sistema ou faça o login manual.'
      : r === 'challenge' ? 'O Astrea pediu verificação adicional (MFA/CAPTCHA): conclua o login manualmente. O robô não contorna verificações.'
      : 'O login automático não concluiu (senha incorreta, bloqueio ou lentidão). Não tentarei de novo agora.');
  }

  /** Recria o navegador interno (a sessão em memória se perde; o login automático a refaz). */
  private async relaunchBrowser() {
    await this.ctx.close().catch(() => {});
    this.ctx = await this.opts.relaunch!();
    this.guarded = false;
  }

  /** Uma operação de navegador por vez: ensaio, gravação, leitura e Play compartilham o mesmo navegador e NÃO podem se sobrepor. */
  private chain: Promise<unknown> = Promise.resolve();
  private serialize(names: string[]) {
    for (const n of names) {
      const orig = (this as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[n]!.bind(this);
      (this as unknown as Record<string, unknown>)[n] = (...a: unknown[]) => { const run = this.chain.then(() => orig(...a), () => orig(...a)); this.chain = run.catch(() => {}); return run; };
    }
  }

  async assertSession(): Promise<void> {
    // 1ª abertura com prazo curto: se travar (navegador preso), reinicia o navegador interno e tenta UMA vez de novo.
    for (let attempt = 0; ; attempt++) {
      const page = await this.newPage();
      try {
        await this.gotoList(page, attempt === 0 && this.opts.relaunch ? this.opts.navTimeoutMs : this.opts.timeoutMs);
        return;
      } catch (e) {
        if (attempt === 0 && this.opts.relaunch && e instanceof BrowserStuckError) { await page.close().catch(() => {}); await this.relaunchBrowser(); continue; }
        throw e;
      } finally {
        await page.close().catch(() => {});
      }
    }
  }

  async listUntreatedPublications({ limit, onProgress }: { limit: number; onProgress?: (p: { stage: 'lendo'; done: number; total: number }) => void }): Promise<RawPublication[]> {
    const page = await this.newPage();
    try {
      await this.gotoList(page);
      const articleSel = requireSelector(this.sel, 'read', 'listArticle');
      const total = await page.locator(articleSel).count();
      const n = Math.min(total, limit, this.opts.maxPerRun);

      // Filtro por processo ativo no Astrea (ficou salvo na conta): a lista lida é só a dele. Avisa em vez de assumir.
      const procChip = (await page.locator('body').innerText()).match(/^\s*(?:CASO|PROCESSO):\s*(.+)$/im);
      if (procChip) this.readErrors.push(`AVISO: o Astrea está com filtro por caso/processo ativo (${procChip[1]!.trim().slice(0, 80)}); só as publicações desse filtro foram lidas. Retire o filtro no Astrea para ler todas.`);
      onProgress?.({ stage: 'lendo', done: 0, total: n });
      const rows: ListRow[] = [];
      for (let i = 0; i < n; i++) rows.push(parseListRow(await page.locator(articleSel).nth(i).innerText()));

      const out: RawPublication[] = [];
      for (let i = 0; i < rows.length; i++) {
        await this.pause();
        if (i > 0) await this.gotoList(page); // volta à lista (estado limpo) antes de abrir a próxima
        const art = page.locator(articleSel).nth(i);
        // Reconfere que a linha i continua sendo a mesma publicação (a lista pode ter mudado).
        const again = parseListRow(await art.innerText());
        if (again.signature !== rows[i]!.signature) continue;
        try {
          out.push(await this.openAndRead(page, art, rows[i]!));
          onProgress?.({ stage: 'lendo', done: i + 1, total: n });
        } catch (e) {
          if (e instanceof SessionExpiredError) throw e;
          // Uma publicação ilegível não derruba a execução: registra e segue (nunca inventa dados).
          this.readErrors.push(`publicação #${i + 1} (${rows[i]!.processNumber}): ${(e as Error).message}`.slice(0, 300));
        }
      }
      return out;
    } finally {
      await page.close();
    }
  }

  private async openAndRead(page: Page, article: Locator, row: ListRow): Promise<RawPublication> {
    const btn = requireSelector(this.sel, 'read', 'openPublicationButton');
    await article.locator(btn).first().click();
    await page.waitForURL(/#\/main\/clippings-treatment\?id=\d+/);
    const id = /[?&]id=(\d+)/.exec(page.url())?.[1];
    if (!id) throw new Error('não foi possível obter o id da publicação');
    const main = page.locator(requireSelector(this.sel, 'read', 'detailMain'));
    await main.locator('text=/Divulgado em:/').first().waitFor({ state: 'attached' });
    const d = parseDetail(await main.innerText());
    if (d.processNumber !== row.processNumber) throw new Error('detalhe aberto não corresponde à linha da lista');
    return {
      externalId: id,
      processNumber: d.processNumber,
      clientName: d.clientName ?? row.caseName ?? '',
      availabilityDate: d.availabilityDate,
      responsible: d.responsible ?? row.responsible,
      fullText: d.fullText,
      hints: d.hints.length ? d.hints : row.hints,
    };
  }

  takeReadErrors(): string[] {
    const e = this.readErrors;
    this.readErrors = [];
    return e;
  }

  private pause() {
    return new Promise((r) => setTimeout(r, this.opts.pageDelayMs));
  }

  // ---- agendamentos: leitura pela ficha do processo > Atividades (SOMENTE LEITURA) ----
  // O Astrea não expõe id de atividade: o id é sintético (processo|tipo|data|título), ver scheduleKey().

  /** Abre a ficha do processo pela busca global e a aba Atividades (com as concluídas). */
  private async openProcessActivities(page: Page, processNumber: string): Promise<ActivityRow[]> {
    await this.gotoList(page); // garante sessão
    const search = page.locator(requireSelector(this.sel, 'read', 'globalSearchInput')).first();
    await search.click();
    await search.pressSequentially(processNumber, { delay: 20 });
    // A lista de sugestões fica dentro do cabeçalho (role banner).
    const suggestion = page.getByRole('banner').getByText(processNumber).first();
    await suggestion.waitFor({ state: 'visible', timeout: Math.min(this.opts.timeoutMs, 20_000) });
    await suggestion.click();
    await page.waitForURL(/#\/main\/folders\/detail\/\d+/);
    const main = page.locator(requireSelector(this.sel, 'read', 'detailMain'));
    await main.getByText(processNumber).first().waitFor({ state: 'visible' }); // confere que abriu o processo certo
    await main.locator(requireSelector(this.sel, 'read', 'folderActivitiesTab')).first().click();
    // Processo SEM atividades não mostra "N abertas": espera pouco e trata como lista vazia (nunca trava).
    try {
      await main.getByText(/\d+\s+abertas/i).first().waitFor({ state: 'visible', timeout: 15_000 });
    } catch {
      return parseActivitiesText(await main.innerText());
    }
    const closed = main.locator(requireSelector(this.sel, 'read', 'folderClosedToggle')).first();
    if (await closed.count()) await closed.click(); // inclui as concluídas na lista
    await this.pause();
    return parseActivitiesText(await main.innerText());
  }

  private async readModal(page: Page, row: ActivityRow, processNumber: string): Promise<AstreaSchedule> {
    const main = page.locator(requireSelector(this.sel, 'read', 'detailMain'));
    const titles = main.getByText(row.title, { exact: true });
    // `occurrence` conta só linhas de topo com o mesmo tipo+título+data; títulos repetidos em tarefas-filhas são raros.
    await titles.nth(row.occurrence).click();
    // Marcador exclusivo do modal (os rótulos de tipo das linhas também são headings).
    const marker = page.locator(requireSelector(this.sel, 'read', 'modalReadyMarker')).first();
    await marker.waitFor({ state: 'visible' });
    const m = parsePrazoModal(await page.locator('body').innerText());
    await this.closeModal(page, marker);
    return {
      id: scheduleKey(processNumber, row.type, m.dueDate, m.title), processNumber: m.processNumber ?? processNumber,
      title: m.title, description: m.description, dueDate: m.dueDate, responsible: m.responsible,
    };
  }

  private async closeModal(page: Page, marker: Locator) {
    await page.keyboard.press('Escape');
    try { await marker.waitFor({ state: 'hidden', timeout: 2000 }); return; } catch { /* Escape não fecha: usa o botão de fechar */ }
    await page.locator('text="×"').first().click({ timeout: 3000 });
    await marker.waitFor({ state: 'hidden' });
  }

  async findSchedules(processNumber: string): Promise<AstreaSchedule[]> {
    const page = await this.newPage();
    try {
      const rows = (await this.openProcessActivities(page, processNumber)).filter((r) => r.type === 'PRAZO').slice(0, 40);
      const out: AstreaSchedule[] = [];
      for (const r of rows) { await this.pause(); out.push(await this.readModal(page, r, processNumber)); }
      return out;
    } finally {
      await page.close();
    }
  }

  async readSchedule(id: string): Promise<AstreaSchedule | null> {
    const k = splitScheduleKey(id);
    const page = await this.newPage();
    try {
      const rows = await this.openProcessActivities(page, k.proc);
      const row = rows.find((r) => r.type === k.type && r.dueDate === k.dueDate && r.title === k.title);
      return row ? await this.readModal(page, row, k.proc) : null;
    } finally {
      await page.close();
    }
  }

  /**
   * Prazos já criados a partir de UMA publicação (cartão "Tratamentos" da própria tela). SOMENTE LEITURA.
   * É a fonte principal de pré-checagem de idempotência e de releitura após gravar no Astrea real.
   */
  async listPublicationSchedules(publicationId: string, processNumber: string): Promise<AstreaSchedule[]> {
    const page = await this.newPage();
    try {
      await this.gotoList(page);
      await page.goto(`${this.listUrl.replace(/#.*$/, '')}#/main/clippings-treatment?id=${encodeURIComponent(publicationId)}`, { waitUntil: 'domcontentloaded' });
      const main = page.locator(requireSelector(this.sel, 'read', 'detailMain'));
      await main.locator('text=/Divulgado em:/').first().waitFor();
      await page.waitForTimeout(2500); // o cartão "Tratamentos" carrega depois do texto
      return parseTreatmentCards(await main.innerText()).map((c) => ({
        id: scheduleKey(processNumber, 'PRAZO', c.dueDate, c.title), processNumber, title: c.title, description: c.description, dueDate: c.dueDate, responsible: c.responsible,
      }));
    } finally {
      await page.close();
    }
  }

  // ---- ENSAIO (sem gravar): preenche o formulário "Adicionar prazo", lê a calculadora e CANCELA ----
  async dryRunSchedule(i: DryRunInput): Promise<DryRunResult> {
    const page = await this.newPage();
    const blockedBefore = this.blockedMutations.length;
    const result: DryRunResult = {
      ok: false, astrea: { publicationDate: null, startDate: null, dueDate: null, holidays: [] }, matches: false,
      kanban: { boards: [], columns: {} }, multipleAlerts: false, cancelled: false, writeAttempts: 0,
    };
    const S = (name: string) => requireSelector(this.sel, 'write', name);
    let formOpen = false;
    try {
      await page.goto(`${this.listUrl.replace(/#.*$/, '')}#/main/clippings-treatment?id=${encodeURIComponent(i.publicationId)}`, { waitUntil: 'domcontentloaded' });
      const main = page.locator(requireSelector(this.sel, 'read', 'detailMain'));
      await main.locator('text=/Divulgado em:/').first().waitFor({ timeout: Math.min(45_000, this.opts.timeoutMs) });
      await page.waitForTimeout(400);
      await this.assertUntreated(page, i.publicationId);
      // O controle "Tratamentos" não expõe role=button: localiza pelo texto exato (o cartão "Tratamentos sugeridos" não casa).
      await main.getByText('Tratamentos', { exact: true }).first().click();
      await page.getByText('Adicionar prazo', { exact: true }).first().click();
      const title = page.locator(S('formTitle')).first();
      await title.waitFor({ state: 'visible' });
      formOpen = true;
      await title.fill(i.title);
      const amount = page.locator(S('formAmount')).first();
      await amount.click();
      await amount.pressSequentially(String(i.amount));
      await page.locator(S('formUnit')).first().selectOption(i.unit === 'dias_corridos' ? 'runningDays' : 'workingDays');
      await amount.click(); await page.keyboard.press('Tab'); // dispara a calculadora
      const due = page.locator(S('formDueDate')).first();
      await page.waitForFunction((el) => !!(el as HTMLInputElement).value, await due.elementHandle(), { timeout: 15_000 });
      const dueBr = await due.inputValue();
      const calc = parseCalculator(await main.innerText());
      result.astrea = { publicationDate: calc.publicationDate, startDate: calc.startDate, dueDate: brToIso(dueBr), holidays: calc.holidays };
      result.multipleAlerts = calc.multipleAlerts;
      result.matches = !!i.expectedDueDate && result.astrea.dueDate === i.expectedDueDate;

      // Quadros e colunas do Kanban (só lê as opções; o formulário será descartado)
      const board = page.locator(S('formKanbanBoard')).first();
      const boards = (await board.locator('option').allInnerTexts()).map((t) => t.trim()).filter((t) => t && t !== 'Nenhum');
      result.kanban.boards = boards;
      for (const b of boards.slice(0, 4)) {
        await board.selectOption({ label: b });
        await page.waitForTimeout(400);
        const col = board.locator('xpath=following::select[1]');
        result.kanban.columns[b] = (await col.locator('option').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
      }
      result.ok = true;
    } catch (e) {
      if (e instanceof SessionExpiredError) throw e;
      result.reason = (e as Error).message.slice(0, 300);
    } finally {
      try {
        if (formOpen) {
          // 1) botão Cancelar (por seletor confirmado ou por texto); 2) fallback: sair da página, o que DESCARTA o formulário não salvo.
          const cancel = page.locator(S('formCancel')).or(page.getByText('Cancelar', { exact: true })).first();
          try {
            await cancel.click({ timeout: 4000 });
            const confirm = page.locator(S('formDiscardConfirm')).first();
            if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
            await page.locator(S('formTitle')).first().waitFor({ state: 'hidden', timeout: 5000 });
            result.cancelled = true;
          } catch {
            await page.goto('about:blank'); // nada foi salvo: o formulário some com a página
            result.cancelled = true;
            result.reason = `${result.reason ?? ''} (botão Cancelar não localizado: formulário descartado ao sair da página)`.trim();
          }
        }
      } catch (e) { result.reason = `${result.reason ?? ''} (falha ao cancelar o formulário: ${(e as Error).message.slice(0, 120)})`.trim(); }
      result.writeAttempts = this.blockedMutations.length - blockedBefore;
      await page.close();
    }
    return result;
  }

  /**
   * CRIA UM PRAZO REAL no Astrea (Tratamentos > Adicionar prazo > Salvar). Só chega aqui depois de TODOS os portões do Writer
   * (NGA_WRITE_ENABLED, admin, aprovação humana, processo/publicação autorizados, autorização de escrita ativa).
   * Proteções locais: exige o seletor de envio configurado; ABORTA (cancelando o formulário) se a "Data limite" calculada pelo Astrea
   * diferir da do robô ou se qualquer campo não ficar exatamente como esperado; as requisições de escrita só passam durante o clique
   * em Salvar (máx. 6) e são registradas em `observedWrites` (método+caminho).
   */
  /**
   * EXCLUI um prazo de TESTE criado pelo robô (Etapa 3). Travas: prefixo de teste obrigatório; o card precisa ter o título EXATO e o
   * marcador [NGA:…] nas observações; exatamente 1 correspondência; só clica em ⋮ > Excluir > Confirmar naquele card.
   * Depois, relê a publicação: o card deve ter sumido e a publicação deve continuar "NÃO TRATADA" (nunca clica em Concluir).
   */
  async deleteTestSchedule(i: { publicationId: string; title: string; titlePrefix: string }): Promise<{ deleted: boolean; remainingMatches: number; stillUntreated: boolean; observedWrites: string[] }> {
    if (!i.titlePrefix || !i.title.startsWith(i.titlePrefix)) throw new Error('Exclusão recusada: o robô só exclui prazos de TESTE (título com o prefixo de teste)');
    if (!this.opts.learnWrite && !this.opts.writeAllow) throw new NotMappedError('endpoint de gravação não aprendido: use learnWrite no teste autorizado ou fixe writeAllow');
    const page = await this.newPage();
    const url = `${this.listUrl.replace(/#.*$/, '')}#/main/clippings-treatment?id=${encodeURIComponent(i.publicationId)}`;
    const readCards = async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const main = page.locator(requireSelector(this.sel, 'read', 'detailMain'));
      await main.locator('text=/Divulgado em:/').first().waitFor();
      await page.waitForTimeout(2500);
      const text = await main.innerText();
      return { main, text, cards: parseTreatmentCards(text) };
    };
    try {
      await this.gotoList(page);
      const first = await readCards();
      const matches = first.cards.filter((c) => c.title === i.title && /\[NGA:/.test(c.description));
      if (matches.length !== 1) throw new Error(`Exclusão recusada: ${matches.length} prazos de teste com esse título e marcador do robô (esperado exatamente 1)`);
      const titleLoc = first.main.getByText(i.title, { exact: true });
      if ((await titleLoc.count()) !== 1) throw new Error('Exclusão recusada: o título não aparece exatamente uma vez na tela');
      const card = titleLoc.locator('xpath=ancestor::*[.//*[normalize-space(.)="Acessar detalhes"]][1]');
      if ((await card.count()) !== 1) throw new Error('Exclusão recusada: card do prazo não localizado de forma inequívoca');

      // ⋮ do card: inspeção real (2026-10-24) mostrou <i class="fa fa-ellipsis-v"> SEM role/aria-label. Atenção: os ícones com
      // aria-label "action button" são "+" (adicionar tarefa) e o LÁPIS (editar): NUNCA usá-los para abrir o menu.
      const kebab = card.locator('i.fa-ellipsis-v');
      if ((await kebab.count()) !== 1) throw new Error('Ícone ⋮ do card não localizado de forma inequívoca: exclusão ABORTADA (nada foi excluído)');
      const del = page.getByText('Excluir', { exact: true }).filter({ visible: true });
      await kebab.click({ timeout: 5000 });
      try { await del.first().waitFor({ state: 'visible', timeout: 4000 }); } catch { throw new Error('Menu do card (⋮) não abriu com a opção Excluir: exclusão ABORTADA (nada foi excluído)'); }
      if ((await del.count()) !== 1) throw new Error('Mais de uma opção "Excluir" visível: exclusão ABORTADA');
      await del.first().click();
      await page.getByText(/deseja excluir o prazo/i).first().waitFor({ state: 'visible', timeout: 8000 }); // diálogo certo (prazo)

      this.writeWindow = { observed: [] };
      try {
        await page.getByText(/^\s*confirmar\s*$/i).filter({ visible: true }).first().click({ timeout: 8000 });
        await page.getByText(/foi exclu[ií]do/i).first().waitFor({ state: 'visible', timeout: Math.min(20_000, this.opts.timeoutMs) });
      } finally {
        this.observedWrites.push(...(this.writeWindow?.observed ?? []));
        this.writeWindow = null;
      }

      await page.goto('about:blank'); // goto na mesma URL com hash NÃO recarrega: força carregamento novo da publicação
      const after = await readCards();
      const remaining = after.cards.filter((c) => c.title === i.title).length;
      return { deleted: remaining === 0, remainingMatches: remaining, stillUntreated: /N[ÃA]O TRATADA/i.test(after.text.slice(0, 400)), observedWrites: [...this.observedWrites] };
    } finally {
      this.writeWindow = null;
      await page.close();
    }
  }

  /** Status da publicação aberta ("NÃO TRATADA" | "TRATADA" | "DESCARTADA"); null se não reconhecido. */
  private async publicationStatus(page: Page): Promise<string | null> {
    const t = await page.locator('body').innerText();
    return /(?:^|\n)\s*(NÃO TRATADA|TRATADA|DESCARTADA)\s*(?:\n|$)/.exec(t)?.[1] ?? null;
  }

  /** Nunca grava em publicação que outra pessoa já tratou/descartou (a lista lida pode estar defasada). */
  private async assertUntreated(page: Page, publicationId: string) {
    const st = await this.publicationStatus(page);
    if (st !== 'NÃO TRATADA') throw new Error(`A publicação ${publicationId} está "${st ?? 'com status não reconhecido'}" no Astrea (já tratada por outra pessoa?): gravação ABORTADA. Atualize com o Play.`);
  }

  private pubUrl(id: string) { return `${this.listUrl.replace(/#.*$/, '')}#/main/clippings-treatment?id=${encodeURIComponent(id)}`; }

  async taskExists(publicationId: string, title: string): Promise<boolean> {
    const page = await this.newPage();
    try {
      await page.goto(this.pubUrl(publicationId), { waitUntil: 'domcontentloaded' });
      await page.locator(requireSelector(this.sel, 'read', 'detailMain')).locator('text=/Divulgado em:/').first().waitFor({ timeout: Math.min(45_000, this.opts.timeoutMs) });
      await page.waitForTimeout(800);
      return (await page.locator('main').getByText(title, { exact: false }).count()) > 0;
    } finally { await page.close(); }
  }

  /** Tarefa pela tela da publicação (Tratamentos > Adicionar tarefa). Mesma janela de escrita controlada do prazo. */
  async createTask(i: TaskInput): Promise<{ id: string; confirmed: boolean; note?: string }> {
    if (!this.opts.learnWrite && !this.opts.writeAllow) throw new NotMappedError('escrita não habilitada neste modo');
    const S = (name: string) => requireSelector(this.sel, 'write', name);
    const page = await this.newPage();
    let formOpen = false; let submitted = false;
    try {
      await page.goto(this.pubUrl(i.publicationId), { waitUntil: 'domcontentloaded' });
      const main = page.locator(requireSelector(this.sel, 'read', 'detailMain'));
      await main.locator('text=/Divulgado em:/').first().waitFor({ timeout: Math.min(45_000, this.opts.timeoutMs) });
      await page.waitForTimeout(400);
      await main.getByText('Tratamentos', { exact: true }).first().click();
      await page.getByText(/^\s*Adicionar tarefa\s*$/i).first().click();
      const desc = page.locator(S('taskDescription')).first();
      await desc.waitFor({ state: 'visible' });
      formOpen = true;

      await desc.fill(i.title);
      const due = page.locator(S('taskDueDate')).first();
      const br = i.dueDate.split('-').reverse().join('/');
      await due.click(); await due.fill(br); await page.keyboard.press('Tab');
      if ((await due.inputValue()) !== br) throw new Error(`Data da tarefa no formulário (${await due.inputValue()}) difere da esperada (${br}): gravação ABORTADA`);
      await page.locator(S('taskPriority')).first().selectOption({ label: i.priority });
      if (i.responsible) {
        const resp = page.locator(`${requireSelector(this.sel, 'write', 'formResponsible')}:visible`).first();
        await resp.click(); await resp.fill(i.responsible);
        const esc = i.responsible.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await page.getByText(new RegExp(`^\\s*${esc}(\\s|$)`)).first().click({ timeout: 10_000 });
        if (!(await resp.inputValue()).includes(i.responsible)) throw new Error(`Responsável da tarefa não ficou "${i.responsible}": gravação ABORTADA`);
      }
      if (i.kanban) {
        await page.locator(S('taskBoard')).first().selectOption({ label: i.kanban.board });
        await page.waitForTimeout(500);
        await page.locator(S('taskColumn')).first().selectOption({ label: i.kanban.column });
      }
      // Conferência final dos campos ANTES de salvar.
      if ((await desc.inputValue()) !== i.title) throw new Error('Descrição da tarefa no formulário difere do esperado: gravação ABORTADA');
      const pri = await page.locator(S('taskPriority')).first().evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '');
      if (pri !== i.priority) throw new Error(`Prioridade no formulário (${pri}) difere da esperada (${i.priority}): gravação ABORTADA`);
      if (i.kanban) {
        const b = await page.locator(S('taskBoard')).first().evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '');
        const c = await page.locator(S('taskColumn')).first().evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '');
        if (b !== i.kanban.board || c !== i.kanban.column) throw new Error(`Kanban da tarefa (${b}/${c}) difere do esperado: gravação ABORTADA`);
      }

      // ── JANELA DE ESCRITA: só o clique em Salvar ──
      const scoped = page.locator(S('taskColumn')).first().locator('xpath=following::*[self::a or self::button][translate(normalize-space(.), "SALVAR", "salvar")="salvar"][1]');
      if ((await scoped.count()) !== 1) throw new Error('Botão Salvar da tarefa não localizado de forma inequívoca: gravação ABORTADA');
      this.writeWindow = { observed: [] };
      try {
        submitted = true;
        await scoped.click({ timeout: 10_000 });
        await desc.waitFor({ state: 'hidden', timeout: Math.min(25_000, this.opts.timeoutMs) }); // formulário fecha ao salvar
      } finally {
        this.observedWrites.push(...(this.writeWindow?.observed ?? []));
        this.writeWindow = null;
      }
      formOpen = false;
      // Releitura: recarrega a publicação e procura a tarefa (descrição e data) nos tratamentos.
      await page.goto('about:blank'); await page.goto(this.pubUrl(i.publicationId), { waitUntil: 'domcontentloaded' });
      await main.locator('text=/Divulgado em:/').first().waitFor({ timeout: Math.min(45_000, this.opts.timeoutMs) });
      await page.waitForTimeout(1200);
      const hits = await main.getByText(i.title, { exact: false }).count();
      const id = `${i.publicationId}|TAREFA|${i.dueDate}|${i.title}`;
      if (hits === 0) return { id, confirmed: false, note: 'Salvou, mas a tarefa não apareceu na releitura da publicação' };
      return { id, confirmed: true };
    } finally {
      try {
        if (formOpen && !submitted) { try { await page.getByText('Cancelar', { exact: true }).first().click({ timeout: 4000 }); } catch { await page.goto('about:blank'); } }
      } catch { /* melhor esforço */ }
      this.writeWindow = null;
      await page.close();
    }
  }

  /**
   * Workflow no próprio PRAZO: publicação > cartão do prazo > "Acessar detalhes" > "Adicionar workflows" > "PRAZO N DIAS CORRIDOS" > Adicionar.
   * Idempotente: se o prazo já tem as atividades do workflow, não aplica de novo. Janela de escrita curta (só o clique em Adicionar).
   */
  async applyWorkflow(i: WorkflowInput): Promise<{ workflow: string; confirmed: boolean; adopted: boolean; note?: string }> {
    if (!this.opts.learnWrite && !this.opts.writeAllow) throw new NotMappedError('escrita não habilitada neste modo');
    const wfName = workflowName(workflowSizeFor(i.amount));
    const n = workflowSizeFor(i.amount);
    const page = await this.newPage();
    try {
      const open = async () => {
        await page.goto('about:blank'); await page.goto(this.pubUrl(i.publicationId), { waitUntil: 'domcontentloaded' });
        const main = page.locator(requireSelector(this.sel, 'read', 'detailMain'));
        await main.locator('text=/Divulgado em:/').first().waitFor({ timeout: Math.min(45_000, this.opts.timeoutMs) });
        await page.waitForTimeout(800);
        // cartão do PRAZO desta publicação (pelo título) → Acessar detalhes
        const card = page.locator('[data-test="component-clippingTreatment-eventCard"]').filter({ hasText: i.prazoTitle.slice(0, 40) }).first();
        await card.getByText('Acessar detalhes', { exact: true }).first().click({ timeout: 10_000 });
        await page.waitForTimeout(1500);
      };
      const hasActivities = async () => {
        const t = (await page.locator('main').innerText()).toLowerCase();
        return t.includes('analisar intimação + verificar provid') || t.includes('conferir protocolo');
      };
      await open();
      if (await hasActivities()) return { workflow: wfName, confirmed: true, adopted: true };
      const btn = page.locator('button, a').filter({ hasText: /adicionar workflows/i }).filter({ visible: true }).first();
      await btn.click({ timeout: 10_000 });
      const wf = page.locator('[data-test="component-predefinedActivity-card"]').filter({ hasText: new RegExp(`^\\s*PRAZO\\s+0*${n}\\s+DIAS`, 'i') }).first();
      await wf.waitFor({ state: 'visible', timeout: 10_000 });
      this.writeWindow = { observed: [] };
      try {
        await wf.locator('[data-test="component-formSubmitButton-discard"]').first().click({ timeout: 10_000 });
        // Se o Astrea pedir confirmação, só confirma quando o diálogo fala do workflow.
        const dlg = page.locator('[role=dialog], .modal.show, .swal2-popup, .mat-dialog-container, .modal-dialog').first();
        try { await dlg.waitFor({ state: 'visible', timeout: 2500 }); } catch { /* sem diálogo */ }
        if (await dlg.isVisible().catch(() => false)) {
          const txt = (await dlg.innerText()).replace(/\s+/g, ' ');
          if (!/workflow|atividade|prazo/i.test(txt)) throw new Error(`Diálogo inesperado ao aplicar o workflow (não confirmado): ${txt.slice(0, 120)}`);
          await dlg.locator('button,a').filter({ hasText: /^\s*(confirmar|sim|adicionar|ok)\s*$/i }).first().click({ timeout: 8000 });
        }
        await page.waitForTimeout(3000);
      } finally {
        this.observedWrites.push(...(this.writeWindow?.observed ?? []));
        this.writeWindow = null;
      }
      // Confirmação: reabre o prazo e confere as atividades criadas pelo workflow.
      for (let k = 0; k < 3; k++) {
        await open();
        if (await hasActivities()) return { workflow: wfName, confirmed: true, adopted: false };
        await page.waitForTimeout(2500);
      }
      return { workflow: wfName, confirmed: false, adopted: false, note: 'Cliquei em Adicionar, mas as atividades do workflow não apareceram no prazo' };
    } finally { this.writeWindow = null; await page.close(); }
  }

  /** Botão Concluir: marca a publicação como tratada. Janela de escrita curta (≤6 requisições), confirmação por releitura do status. */
  async concludePublication(publicationId: string): Promise<{ treated: boolean; status: string }> {
    if (!this.opts.learnWrite && !this.opts.writeAllow) throw new NotMappedError('escrita não habilitada neste modo');
    const page = await this.newPage();
    try {
      await page.goto(`${this.listUrl.replace(/#.*$/, '')}#/main/clippings-treatment?id=${encodeURIComponent(publicationId)}`, { waitUntil: 'domcontentloaded' });
      await page.locator(requireSelector(this.sel, 'read', 'detailMain')).locator('text=/Divulgado em:/').first().waitFor();
      await page.waitForTimeout(600);
      if ((await this.publicationStatus(page)) === 'TRATADA') return { treated: true, status: 'TRATADA' }; // já estava
      await this.assertUntreated(page, publicationId);
      const btn = page.getByRole('button', { name: /^\s*concluir\s*$/i }).or(page.locator('a,button').filter({ hasText: /^\s*concluir\s*$/i })).first();
      this.writeWindow = { observed: [] };
      try {
        await btn.click({ timeout: 10_000 });
        // Se o Astrea pedir confirmação, só confirma quando o diálogo fala de conclusão/tratamento da publicação.
        const dlg = page.locator('[role=dialog], .modal.show, .swal2-popup, .mat-dialog-container, .modal-dialog').first();
        try { await dlg.waitFor({ state: 'visible', timeout: 3000 }); } catch { /* sem diálogo: ação direta */ }
        if (await dlg.isVisible().catch(() => false)) {
          const txt = (await dlg.innerText()).replace(/\s+/g, ' ');
          if (!/conclu|trat/i.test(txt)) throw new Error(`Diálogo inesperado ao concluir (não confirmado): ${txt.slice(0, 120)}`);
          await dlg.getByRole('button', { name: /^\s*(confirmar|sim|concluir|ok)\s*$/i }).or(dlg.locator('button,a').filter({ hasText: /^\s*(confirmar|sim|concluir|ok)\s*$/i })).first().click({ timeout: 8000 });
        }
        await page.waitForTimeout(2500);
      } finally {
        this.observedWrites.push(...(this.writeWindow?.observed ?? []));
        this.writeWindow = null;
      }
      // Confirmação: recarrega a publicação e lê o status.
      for (let k = 0; k < 3; k++) {
        await page.goto('about:blank');
        await page.goto(`${this.listUrl.replace(/#.*$/, '')}#/main/clippings-treatment?id=${encodeURIComponent(publicationId)}`, { waitUntil: 'domcontentloaded' });
        await page.locator(requireSelector(this.sel, 'read', 'detailMain')).locator('text=/Divulgado em:/').first().waitFor();
        await page.waitForTimeout(800);
        const st = await this.publicationStatus(page);
        if (st === 'TRATADA') return { treated: true, status: st };
        if (k === 2) return { treated: false, status: st ?? 'desconhecido' };
      }
      return { treated: false, status: 'desconhecido' };
    } finally { this.writeWindow = null; await page.close(); }
  }

  async createSchedule(i: ScheduleInput): Promise<{ id: string }> {
    const submitSel = requireSelector(this.sel, 'write', 'addDeadlineSubmit'); // portão: ausente ⇒ NotMappedError
    if (!i.live) throw new NotMappedError('dados do formulário (publicação/prazo) ausentes');
    if (!this.opts.learnWrite && !this.opts.writeAllow) throw new NotMappedError('endpoint de gravação não aprendido: use NGA_LEARN_WRITE no teste autorizado ou fixe ASTREA_WRITE_ALLOW');
    const S = (name: string) => requireSelector(this.sel, 'write', name);
    const page = await this.newPage();
    let formOpen = false;
    let submitted = false;
    try {
      // Direto na publicação (sem passar pela lista: economiza ~10 s). Sessão caída aparece como falha de carregamento e nada é gravado.
      await page.goto(`${this.listUrl.replace(/#.*$/, '')}#/main/clippings-treatment?id=${encodeURIComponent(i.live.publicationId)}`, { waitUntil: 'domcontentloaded' });
      const main = page.locator(requireSelector(this.sel, 'read', 'detailMain'));
      await main.locator('text=/Divulgado em:/').first().waitFor({ timeout: Math.min(45_000, this.opts.timeoutMs) });
      await page.waitForTimeout(400);
      await this.assertUntreated(page, i.live.publicationId);
      await main.getByText('Tratamentos', { exact: true }).first().click();
      await page.getByText('Adicionar prazo', { exact: true }).first().click();
      const title = page.locator(S('formTitle')).first();
      await title.waitFor({ state: 'visible' });
      formOpen = true;

      await title.fill(i.title);
      const amount = page.locator(S('formAmount')).first();
      await amount.click();
      await amount.pressSequentially(String(i.live.amount));
      await page.locator(S('formUnit')).first().selectOption(i.live.unit === 'dias_corridos' ? 'runningDays' : 'workingDays');
      await amount.click(); await page.keyboard.press('Tab'); // dispara a calculadora
      const due = page.locator(S('formDueDate')).first();
      await page.waitForFunction((el) => !!(el as HTMLInputElement).value, await due.elementHandle(), { timeout: 15_000 });
      const astreaDue = brToIso(await due.inputValue());
      if (astreaDue !== i.dueDate) throw new DueDateMismatch(astreaDue, i.dueDate);

      if (i.responsible) {
        const resp = page.locator(S('formResponsible')).first();
        await resp.click(); await resp.fill(i.responsible); // fill digita tudo de uma vez (digitar tecla a tecla perdia caracteres no campo de busca)
        const esc = i.responsible.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await page.getByText(new RegExp(`^\\s*${esc}(\\s|$)`)).first().click({ timeout: 10_000 });
        if (!(await resp.inputValue()).includes(i.responsible)) throw new Error(`Responsável não ficou "${i.responsible}": gravação ABORTADA`);
      }
      await page.locator(S('formNotes')).first().fill(i.description);
      if (i.live.kanban) {
        const board = page.locator(S('formKanbanBoard')).first();
        await board.selectOption({ label: i.live.kanban.board });
        await page.waitForTimeout(500);
        await board.locator('xpath=following::select[1]').selectOption({ label: i.live.kanban.column });
      }
      if (i.live.alertDays) await page.locator(S('formAmount')).nth(1).fill(String(i.live.alertDays));

      // Conferência final dos campos ANTES de salvar.
      if ((await title.inputValue()) !== i.title) throw new Error('Título no formulário difere do esperado: gravação ABORTADA');
      if ((await page.locator(S('formNotes')).first().inputValue()) !== i.description) throw new Error('Observações no formulário diferem do esperado: gravação ABORTADA');
      if (i.live.kanban) {
        const b = page.locator(S('formKanbanBoard')).first();
        const picked = await b.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '');
        const col = await b.locator('xpath=following::select[1]').evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '');
        if (picked !== i.live.kanban.board || col !== i.live.kanban.column) throw new Error(`Kanban no formulário (${picked}/${col}) difere do esperado: gravação ABORTADA`);
      }

      // ── JANELA DE ESCRITA: só o clique em Salvar, até a confirmação do Astrea ──
      // O "Salvar" é o que vem DEPOIS dos campos do formulário (não o primeiro "Salvar" da página). Se não houver exatamente um, NÃO clica.
      const lastField = page.locator(S('formKanbanBoard')).first().locator('xpath=following::select[1]');
      const scoped = lastField.locator('xpath=following::*[self::a or self::button][translate(normalize-space(.), "SALVAR", "salvar")="salvar"][1]');
      if ((await scoped.count()) !== 1) throw new Error('Botão Salvar do formulário não localizado de forma inequívoca: gravação ABORTADA');
      void submitSel; // o seletor configurado é o portão de habilitação; o clique usa o localizador estrutural acima
      const submit = scoped;
      this.writeWindow = { observed: [] };
      try {
        submitted = true;
        await submit.click({ timeout: 10_000 });
        await page.locator(S('formSavedToast')).first().waitFor({ state: 'visible', timeout: Math.min(25_000, this.opts.timeoutMs) });
      } finally {
        this.observedWrites.push(...(this.writeWindow?.observed ?? []));
        this.writeWindow = null;
      }
      formOpen = false;
      return { id: scheduleKey(i.processNumber, 'PRAZO', i.dueDate, i.title) };
    } finally {
      try {
        // Falha ANTES do clique: cancela o formulário (nada foi salvo). Falha DEPOIS do clique: resultado desconhecido — o Writer reconcilia pela releitura.
        if (formOpen && !submitted) {
          const cancel = page.locator(S('formCancel')).or(page.getByText('Cancelar', { exact: true })).first();
          try { await cancel.click({ timeout: 4000 }); } catch { await page.goto('about:blank'); }
        }
      } catch { /* melhor esforço */ }
      this.writeWindow = null;
      await page.close();
    }
  }
  async updateSchedule(): Promise<void> {
    requireSelector(this.sel, 'write', 'editScheduleSubmit');
    throw new NotMappedError('edição de agendamento');
  }
}
