/**
 * O NGA LAB rodando na máquina, de verdade e para valer.
 *
 * Diferente de `demo.ts` em três pontos que são o que separa demonstração de
 * instalação: o banco é PERSISTENTE, não há dado semeado, e os segredos são
 * gerados uma vez e guardados — não sorteados a cada arranque.
 *
 * POR QUE POSTGRESQL EMBUTIDO. Esta máquina não tem Docker nem Homebrew, e o
 * Nexus precisa de PostgreSQL de verdade: RLS, políticas e CHECK são o que
 * mantém o isolamento entre clientes, e nada disso existe em SQLite. O pacote
 * `embedded-postgres` baixa e roda o binário oficial do PostgreSQL — é o
 * servidor real, só que gerido por este processo em vez do sistema. Se um dia
 * houver Docker aqui, o `docker-compose.yml` faz o mesmo de forma mais
 * convencional, e os dados saem por `pg_dump`.
 *
 * ONDE FICAM OS DADOS: ~/Library/Application Support/NGA-Nexus
 *   postgres/   o banco
 *   acervo/     os arquivos, fora de web/ (§12.4)
 *   config.json os segredos, com permissão 0600
 */
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Banco } from '../src/store/conexao.ts';
import { servidorDoGerador, servirEstatico } from '../src/server/estaticos.ts';
import { criarApp } from '../src/server/app.ts';
import { migrar } from '../src/db/migrar.ts';
import { ArmazenamentoLocal } from '../src/store/arquivos.ts';
import { deposito as montarDeposito } from '../src/server/arquivos.ts';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const BASE = process.env['NGA_BASE'] ?? join(homedir(), 'Library/Application Support/NGA-Nexus');
const PORTA_PG = Number(process.env['NGA_PG_PORT'] ?? 54320);
const PORTA_WEB = Number(process.env['NGA_PORTA'] ?? 8790);

interface Config { senhaAdmin: string; senhaApp: string; segredoArquivos: string }

/**
 * Lê os segredos ou cria na primeira vez.
 *
 * Gerar a cada arranque pareceria funcionar e quebraria tudo depois: a senha
 * do banco não bateria com a gravada no cluster, e todo link de download
 * emitido antes do reinício deixaria de valer.
 */
async function config(): Promise<Config> {
  const caminho = join(BASE, 'config.json');
  try {
    return JSON.parse(await readFile(caminho, 'utf8')) as Config;
  } catch {
    const novo: Config = {
      senhaAdmin: randomBytes(24).toString('base64url'),
      senhaApp: randomBytes(24).toString('base64url'),
      segredoArquivos: randomBytes(48).toString('base64url'),
    };
    await mkdir(BASE, { recursive: true });
    await writeFile(caminho, JSON.stringify(novo, null, 2), { mode: 0o600 });
    await chmod(caminho, 0o600);
    console.log(`  segredos criados em ${caminho} (apenas leitura do dono)`);
    return novo;
  }
}

const cfg = await config();
const dirPg = join(BASE, 'postgres');
const dirAcervo = join(BASE, 'acervo');
await mkdir(dirAcervo, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dirPg, user: 'postgres', password: cfg.senhaAdmin,
  port: PORTA_PG, persistent: true,
});

// `initialise` só faz sentido no primeiro arranque; depois o cluster existe.
try {
  await pg.initialise();
  console.log('  cluster PostgreSQL criado');
} catch {
  /* já existia */
}
await pg.start();
try {
  await pg.createDatabase('nga_nexus');
  console.log('  banco nga_nexus criado');
} catch {
  /* já existia */
}

// --- migração, como dono do schema ---
const dono = new Client({
  host: '127.0.0.1', port: PORTA_PG, user: 'postgres',
  password: cfg.senhaAdmin, database: 'nga_nexus',
});
await dono.connect();
const aplicadas = await migrar(dono);
const novas = aplicadas.filter((m) => !m.jaEstava);
if (novas.length > 0) console.log(`  ${novas.length} migração(ões) aplicada(s)`);
await dono.query(`ALTER ROLE nga_app PASSWORD '${cfg.senhaApp.replace(/'/g, "''")}'`);
const { rows: contagem } = await dono.query<{ n: string }>('SELECT count(*) AS n FROM usuarios');
await dono.end();

// --- aplicação, como nga_app (sem bypass de RLS) ---
const banco = new Banco({
  host: '127.0.0.1', port: PORTA_PG, user: 'nga_app',
  password: cfg.senhaApp, database: 'nga_nexus',
});
const armazenamento = new ArmazenamentoLocal(dirAcervo);
await armazenamento.iniciar();
const api = criarApp({
  banco,
  deposito: montarDeposito(armazenamento, {
    ...process.env, NGA_SEGREDO_ARQUIVOS: cfg.segredoArquivos,
  }),
  analiseAutomatica: true,
});

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};

// Gerador de Relatórios (monorepo: ../relatorios), servido sob /gerador/ para abrir dentro do NGA LAB.
const gerador = servidorDoGerador(join(RAIZ, '../relatorios'));

const servidor = Bun.serve({
  port: PORTA_WEB,
  // 127.0.0.1 por padrão: só este Mac alcança. NGA_HOST=0.0.0.0 abre para a rede local (celular no mesmo Wi-Fi) — decisão explícita.
  hostname: process.env['NGA_HOST'] ?? '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    const doGerador = await gerador(req, url); if (doGerador) return doGerador;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/arquivos/')) {
      const r = await api(req);
      r.headers.set('x-content-type-options', 'nosniff');
      r.headers.set('referrer-policy', 'no-referrer');
      return r;
    }
    if (url.pathname === '/nga.css') {
      return new Response(Bun.file(join(RAIZ, 'ui/tokens/nga.css')),
        { headers: { 'content-type': TIPOS['.css']! } });
    }
    const pedido = url.pathname === '/' ? '/index.html' : url.pathname;
    const destino = join(RAIZ, 'web', pedido);
    if (!destino.startsWith(join(RAIZ, 'web'))) return new Response('404', { status: 404 });
    const arquivo = Bun.file(destino);
    if (await arquivo.exists()) {
      return servirEstatico(arquivo, TIPOS[pedido.slice(pedido.lastIndexOf('.'))] ?? 'application/octet-stream', req);
    }
    return new Response(Bun.file(join(RAIZ, 'web/index.html')),
      { headers: { 'content-type': TIPOS['.html']! } });
  },
});

console.log(`\n  NGA LAB  http://127.0.0.1:${servidor.port}`);
console.log(`  dados em   ${BASE}`);
if (Number(contagem[0]!.n) === 0) {
  console.log(
    '\n  Ainda não há usuário: ninguém consegue entrar. Crie o primeiro com\n' +
    '  bun run criar-usuario-local <email> "<Nome>"\n');
}

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    await servidor.stop();
    await banco.encerrar();
    await pg.stop();
    process.exit(0);
  });
}
