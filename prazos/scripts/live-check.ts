/**
 * Verificação SOMENTE LEITURA do adaptador LiveAstrea contra o Astrea real.
 * Uso: ASTREA_BASE_URL=https://astrea.net.br/ bun run live:check [N=2] [--headed]
 * Requer sessão já autenticada no perfil (bun run live:login). Imprime resumo MASCARADO (sem texto integral).
 */
import { chromium } from 'playwright';
import { LiveAstrea } from '../src/astrea/live.ts';
import { SessionExpiredError } from '../src/astrea/port.ts';
import { loadSelectors } from '../src/astrea/selectors.ts';
import { classify, initialStateFor } from '../src/domain/classifier.ts';
import { loadConfig } from '../src/config.ts';
import { maskString } from '../src/security/mask.ts';

const base = process.env.ASTREA_BASE_URL;
if (!base) { console.error('Defina ASTREA_BASE_URL'); process.exit(1); }
const n = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 2);
const procArg = process.argv.find((a) => a.startsWith('--process='))?.slice(10);
const cfg = loadConfig();
const ctx = await chromium.launchPersistentContext(process.env.ASTREA_PROFILE_DIR ?? '.astrea-profile', { headless: !process.argv.includes('--headed') });
const live = new LiveAstrea(ctx, base, loadSelectors('config/selectors.json'), { maxPerRun: n });
try {
  await live.assertSession();
  console.log('sessão: OK');
  if (procArg) {
    const sch = await live.findSchedules(procArg);
    console.log(`prazos encontrados em ${maskString(procArg)}: ${sch.length}`);
    for (const x of sch) console.log({ data: x.dueDate, titulo: `${x.title.slice(0, 12)}…`, responsavel: x.responsible?.slice(0, 4) + '…', observacoes: x.description ? `${x.description.length} chars` : '(vazio)', id: x.id.split('|').slice(1, 3).join('|') });
    if (sch.length) {
      const again = await live.readSchedule(sch[0]!.id);
      console.log('readSchedule(1º) confere:', again?.dueDate === sch[0]!.dueDate && again?.title === sch[0]!.title);
    }
    process.exit(0);
  }
  const pubs = await live.listUntreatedPublications({ limit: n });
  console.log(`publicações lidas: ${pubs.length}`);
  for (const e of live.takeReadErrors()) console.log('  ⚠ não lida:', maskString(e));
  for (const p of pubs) {
    const a = classify(p, { holidays: cfg.holidays, holidaysLoaded: cfg.holidaysLoaded, defaultDayUnit: cfg.defaultDayUnit, responsibleFor: () => null });
    console.log({
      id: p.externalId, processo: maskString(p.processNumber), cliente: p.clientName.slice(0, 3) + '…', disponibilizacao: p.availabilityDate,
      chars: p.fullText.length, hintsAstrea: p.hints?.map((h) => h.dueDate),
      proposta: a.actions.map((x) => ({ tipo: x.kind, fim: x.deadline?.endTerm ?? null, amb: x.ambiguous })), flags: a.flags, estado: initialStateFor(a),
    });
  }
} catch (e) {
  if (e instanceof SessionExpiredError) console.error('SESSÃO EXPIRADA: rode "bun run live:login" e faça login manualmente.');
  else console.error('erro:', (e as Error).message);
  process.exitCode = 1;
} finally {
  console.log('requisições de escrita bloqueadas pelo guard:', live.blockedMutations.length, live.blockedMutations);
  await ctx.close();
}
