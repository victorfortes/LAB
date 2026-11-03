/**
 * ETAPA 3 — exclui UM prazo de TESTE criado pelo robô e confirma que a publicação segue "não tratada".
 * Abre a janela do navegador e ESPERA o seu login manual (a sessão do Astrea não persiste ao fechar o navegador).
 *
 * Uso: ASTREA_BASE_URL=https://astrea.net.br/ bun scripts/live-cleanup-test.ts <publicationId> "<título exato do prazo de teste>"
 * Recusa qualquer título sem o prefixo "[TESTE NGA PRAZOS] " e qualquer card sem o marcador [NGA:…] das observações.
 */
import { chromium } from 'playwright';
import { LiveAstrea } from '../src/astrea/live.ts';
import { waitForManualLogin } from '../src/astrea/live-session.ts';
import { loadSelectors } from '../src/astrea/selectors.ts';

const base = process.env.ASTREA_BASE_URL;
const [publicationId, title] = process.argv.slice(2);
if (!base || !publicationId || !title) { console.error('Uso: ASTREA_BASE_URL=... bun scripts/live-cleanup-test.ts <publicationId> "<título>"'); process.exit(1); }
const prefix = '[TESTE NGA PRAZOS] ';

const ctx = await chromium.launchPersistentContext(process.env.ASTREA_PROFILE_DIR ?? '.astrea-profile', { headless: false });
try {
  const sel = loadSelectors('config/selectors.json');
  await waitForManualLogin(ctx, base, sel, { log: (m) => console.log(m) });
  const live = new LiveAstrea(ctx, base, sel, { learnWrite: true });
  const r = await live.deleteTestSchedule({ publicationId, title, titlePrefix: prefix });
  console.log('RESULTADO:', JSON.stringify(r));
  console.log(r.deleted && r.stillUntreated ? 'OK: prazo de teste excluído e publicação continua NÃO TRATADA.' : 'ATENÇÃO: confira no Astrea (excluído=' + r.deleted + ', não tratada=' + r.stillUntreated + ')');
} catch (e) {
  console.error('ERRO (nada além do descrito foi alterado):', (e as Error).message);
  process.exitCode = 1;
} finally {
  await ctx.close();
}
