import type { AstreaPort } from '../astrea/port.ts';
import type { Config } from '../config.ts';
import { Runner } from '../runner/runner.ts';
import { Workflow } from '../runner/workflow.ts';
import { Tokens, LoginLimiter } from '../security/auth.ts';
import { Vault } from '../security/vault.ts';
import type { Repo } from '../store/repo.ts';
import { Corrections } from '../writer/corrections.ts';
import { Writer } from '../writer/writer.ts';
import { LabSync } from './lab-sync.ts';

export interface Services {
  labSync:LabSync; cfg: Config; repo: Repo; astrea: AstreaPort; runner: Runner; workflow: Workflow;
  writer: Writer; corrections: Corrections; tokens: Tokens; limiter: LoginLimiter;
  /** Cofre das credenciais de acesso ao Astrea (cifrado; a senha nunca sai por API). */
  vault: Vault;
}

export function buildServices(cfg: Config, repo: Repo, astrea: AstreaPort, vault: Vault = new Vault(cfg.vaultFile)): Services {
  const labSync=new LabSync(repo,{vault,mode:cfg.mode,holidays:cfg.holidays,protocolResponsible:cfg.protocolResponsible});
  return {
    labSync,cfg, repo, astrea, vault,
    runner: new Runner(repo, astrea, { limit: cfg.publicationLimit, staleMs: cfg.staleRunMs, holidays: cfg.holidays, holidaysLoaded: cfg.holidaysLoaded, stepDelayMs: cfg.stepDelayMs, defaultDayUnit: cfg.defaultDayUnit, authorizedClientRegex: cfg.authorizedClientRegex, allowAllClients: cfg.allowAllClients }),
    workflow: new Workflow(repo, cfg.productionWrite),
    writer: new Writer(repo, astrea, {...cfg,onConfirmed:cfg.mode==='live'?(recordId)=>labSync.drain({recordId}):undefined}),
    corrections: new Corrections(repo, astrea, cfg),
    tokens: new Tokens(cfg.jwtSecret),
    limiter: new LoginLimiter(),
  };
}
