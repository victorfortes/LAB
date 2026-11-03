/**
 * Registra no controle ("Lançamentos do robô") um prazo do robô que JÁ EXISTE no Astrea (ex.: criado no piloto, quando o
 * histórico ainda ficava em memória). SOMENTE LEITURA no Astrea: relê o prazo pela publicação onde ele está, exige o marcador
 * [NGA:…] e grava a evidência da leitura. Não cria nada no Astrea.
 * Uso: bun scripts/adopt-existing.ts <publicação onde o prazo está> <nº do processo> <publicação do registro no app>
 */
import { chromium } from 'playwright';
import { LiveAstrea } from '../src/astrea/live.ts';
import { loadSelectors } from '../src/astrea/selectors.ts';
import { Vault } from '../src/security/vault.ts';
import { makePool, resolveDatabaseUrl } from '../src/store/connect.ts';
import { PgRepo } from '../src/store/postgres.ts';

const [pubWhere, processNumber, recPub] = process.argv.slice(2);
const url = resolveDatabaseUrl(process.env);
if (!pubWhere || !processNumber || !recPub || !url) { console.error('uso: adopt-existing.ts <pub do prazo> <processo> <pub do registro> (e banco configurado)'); process.exit(1); }
const repo = new PgRepo(makePool(url, process.env));
const rec = (await repo.listRecords()).find((r) => r.externalId === recPub);
if (!rec) { console.error('registro não encontrado no banco: rode o Play antes'); process.exit(1); }
const sel = loadSelectors('config/selectors.json');
const vault = new Vault('.nga-vault.json');
const ctx = await chromium.launchPersistentContext('.astrea-profile', { headless: true });
const astrea = new LiveAstrea(ctx, 'https://astrea.net.br/', sel, { autoLogin: async (page) => (await import('../src/astrea/auto-login.ts')).autoLogin(page, vault, sel) });
try {
  const found = (await astrea.listPublicationSchedules!(pubWhere, processNumber)).filter((s) => /\[NGA:[0-9a-f]+\]/.test(s.description));
  if (found.length !== 1) throw new Error(`esperava exatamente 1 prazo do robô na publicação ${pubWhere}; achei ${found.length}`);
  const s = found[0]!; const key = /\[NGA:([0-9a-f]+)\]/.exec(s.description)![1]!;
  const now = new Date().toISOString();
  const action = rec.analysis.actions.find((a) => a.kind === 'prazo')!;
  const claim = await repo.claimWriteOp({
    key, recordId: rec.id, actionId: action.id, status: 'confirmed', astreaId: s.id, adopted: true, error: null, updatedAt: now,
    expected: { title: s.title, description: s.description, dueDate: s.dueDate, responsible: s.responsible, processNumber, publicationId: pubWhere },
    readBack: s as unknown as Record<string, unknown>,
    evidence: [{ at: now, step: 'adopted_existing_readonly', detail: { origem: 'piloto de 25/10/2026 (histórico anterior em memória)', publicationId: pubWhere, astreaId: s.id, lido: s } }],
  });
  await repo.appendAudit({ actor: 'sistema', action: 'write.adopted_existing', entityType: 'record', entityId: rec.id, data: { publicationId: pubWhere, astreaId: s.id, dueDate: s.dueDate, novo: claim.claimed } });
  console.log(claim.claimed ? 'registrado' : 'já estava registrado', { astreaId: s.id, dueDate: s.dueDate, responsible: s.responsible, title: s.title });
} finally { await ctx.close(); process.exit(0); }
