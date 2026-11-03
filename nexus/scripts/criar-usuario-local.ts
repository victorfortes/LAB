/**
 * Cria acesso na instalação desta máquina.
 *
 * Existe porque `criar-usuario.ts` pede host, porta e senha do dono do
 * schema por variável de ambiente — e na instalação local essas senhas são
 * geradas pelo próprio sistema e guardadas em config.json. Quem instala não
 * precisa conhecê-las para criar o primeiro acesso.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env['NGA_BASE'] ?? join(homedir(), 'Library/Application Support/NGA-Nexus');
const PORTA_PG = process.env['NGA_PG_PORT'] ?? '54320';

let cfg: { senhaAdmin: string };
try {
  cfg = JSON.parse(await readFile(join(BASE, 'config.json'), 'utf8'));
} catch {
  console.error(
    `\n  Não encontrei a instalação em ${BASE}.\n` +
    '  Suba o servidor uma vez (bun run local) para ela ser criada.\n');
  process.exit(1);
}

const argumentos = process.argv.slice(2);
const resultado = Bun.spawnSync(
  ['bun', join(import.meta.dirname, 'criar-usuario.ts'), ...argumentos],
  {
    env: {
      ...process.env,
      NGA_PG_HOST: '127.0.0.1',
      NGA_PG_PORT: PORTA_PG,
      NGA_PG_ADMIN_USER: 'postgres',
      NGA_PG_ADMIN_PASSWORD: cfg.senhaAdmin,
      NGA_PG_DATABASE: 'nga_nexus',
    },
    stdout: 'inherit',
    stderr: 'inherit',
  });
process.exit(resultado.exitCode ?? 1);
