import { existsSync, readFileSync } from 'node:fs';

export interface Config {
  mode: 'simulated' | 'live';
  port: number;
  databaseUrl: string | null;
  jwtSecret: string;
  writeEnabled: boolean;
  /** Arquivo do cofre (cifrado). A chave NÃO fica aqui: NGA_VAULT_KEY ou Keychain do macOS. */
  vaultFile: string;
  /** Etapa 1 (teste): prefixo do título e aprendizado do endpoint de gravação do Astrea. */
  titlePrefix: string;
  learnWrite: boolean;
  /** Se preenchida, SÓ estas publicações (ids do Astrea) podem ser gravadas. */
  writeOnlyPublications: string[];
  /** Exceção humana e explícita: publicações cujo prazo marcado como "de terceiro" pode ser gravado mesmo assim. */
  allowThirdPartyPublications: string[];
  /** Teto de CRIAÇÕES reais por execução do app (piloto = 1). null = sem teto. */
  maxRealWrites: number | null;
  /** Regex dos caminhos de escrita liberados na janela de Salvar (fixada após o aprendizado). */
  astreaWriteAllow: string | null;
  kanbanBoard: string | null;
  kanbanColumn: string | null;
  alertDays: number | null;
  staleRunMs: number;
  publicationLimit: number;
  holidays: Set<string>;
  holidaysLoaded: boolean;
  stepDelayMs: number;
  /** Modalidade presumida quando o texto não especifica. Decisão do usuário: dias corridos. */
  defaultDayUnit: 'dias_uteis' | 'dias_corridos';
  /** Escopo por cliente (regex), ex.: "copel". Vazio = só a lista explícita de processos. */
  authorizedClientRegex: string | null;
  /** Libera o escopo "todo o escritório" no Play (desligado por padrão: NGA_ALLOW_ALL_CLIENTS=yes). */
  allowAllClients: boolean;
  /** Produção: grava prazos aprovados de QUALQUER publicação do escopo (sem lista de publicações), com teto por execução. Exige aprovação humana + autorização de escrita ativa. */
  productionWrite: boolean;
  /** Ao final de uma gravação CONFIRMADA, marca a publicação como tratada no Astrea (NGA_CONCLUDE_PUBLICATION=no desliga). */
  concludePublication: boolean;
  /** Cria as tarefas de acompanhamento (análise +1 dia útil; conferir protocolo/renúncia no dia seguinte ao vencimento). NGA_FOLLOWUP_TASKS=no desliga. */
  followUpTasks: boolean;
  /** Acompanhamento depois do prazo: "workflow" (padrão: aplica PRAZO N DIAS CORRIDOS no próprio prazo), "tasks" (cria as 2 tarefas) ou "no". */
  followUpMode: 'workflow' | 'tasks' | 'no';
  protocolResponsible: string;
  /** Base do Astrea, usada para montar o link de cada publicação. */
  astreaBaseUrl: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env, holidaysPath = 'config/holidays.json'): Config {
  const mode = (env.NGA_MODE ?? 'simulated') as Config['mode'];
  if (mode !== 'simulated' && mode !== 'live') throw new Error('NGA_MODE inválido');
  if (env.NGA_DEFAULT_DAY_UNIT && !['dias_uteis', 'dias_corridos'].includes(env.NGA_DEFAULT_DAY_UNIT)) throw new Error('NGA_DEFAULT_DAY_UNIT inválido');
  const jwtSecret = env.JWT_SECRET ?? '';
  let holidays = new Set<string>();
  let holidaysLoaded = false;
  if (existsSync(holidaysPath)) {
    const h = JSON.parse(readFileSync(holidaysPath, 'utf8')) as { verifiedBy: string | null; dates: string[] };
    holidays = new Set(h.dates);
    holidaysLoaded = !!h.verifiedBy;
  }
  return {
    mode,
    port: Number(env.PORT ?? 8787),
    databaseUrl: env.DATABASE_URL ?? null,
    jwtSecret,
    writeEnabled: env.NGA_WRITE_ENABLED === 'true',
    vaultFile: env.NGA_VAULT_FILE ?? '.nga-vault.json',
    titlePrefix: env.NGA_TITLE_PREFIX ?? '',
    learnWrite: env.NGA_LEARN_WRITE === 'true',
    maxRealWrites: env.NGA_MAX_REAL_WRITES ? Number(env.NGA_MAX_REAL_WRITES) : null,
    writeOnlyPublications: (env.NGA_WRITE_ONLY_PUBLICATIONS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    allowThirdPartyPublications: (env.NGA_ALLOW_THIRD_PARTY_PUBLICATIONS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    astreaWriteAllow: env.ASTREA_WRITE_ALLOW || null,
    kanbanBoard: env.NGA_KANBAN_BOARD ?? 'FLUXO NGA',
    kanbanColumn: env.NGA_KANBAN_COLUMN ?? 'A Fazer',
    alertDays: env.NGA_ALERT_DAYS ? Number(env.NGA_ALERT_DAYS) : 7,
    staleRunMs: Number(env.NGA_STALE_RUN_MS ?? 120_000),
    publicationLimit: Number(env.NGA_PUBLICATION_LIMIT ?? 200),
    holidays,
    holidaysLoaded,
    stepDelayMs: Number(env.NGA_STEP_DELAY_MS ?? 0),
    authorizedClientRegex: env.NGA_AUTHORIZED_CLIENT_REGEX || null,
    allowAllClients: env.NGA_ALLOW_ALL_CLIENTS === 'yes',
    productionWrite: env.NGA_PRODUCTION_WRITE === 'yes',
    concludePublication: env.NGA_CONCLUDE_PUBLICATION !== 'no',
    followUpTasks: env.NGA_FOLLOWUP_TASKS !== 'no',
    followUpMode: (env.NGA_FOLLOWUP_MODE === 'tasks' || env.NGA_FOLLOWUP_MODE === 'no' || env.NGA_FOLLOWUP_TASKS === 'no' ? (env.NGA_FOLLOWUP_MODE === 'tasks' ? 'tasks' : 'no') : 'workflow'),
    protocolResponsible: env.NGA_PROTOCOL_RESPONSIBLE ?? 'Camilla Rodrigues',
    astreaBaseUrl: env.ASTREA_BASE_URL ?? 'https://astrea.net.br/',
    defaultDayUnit: (env.NGA_DEFAULT_DAY_UNIT ?? 'dias_corridos') as Config['defaultDayUnit'],
  };
}
