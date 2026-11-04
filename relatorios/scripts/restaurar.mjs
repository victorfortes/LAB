#!/usr/bin/env node
// Gera o SQL de restauração a partir de um backup cifrado.  BACKUP_PASSPHRASE=... node scripts/restaurar.mjs arquivo.json.enc > restaurar.sql
// Rode o SQL no SQL Editor do Supabase (projeto novo, com as migrações já aplicadas). Veja docs/10_MANUTENCAO.md.
import { readFileSync } from 'node:fs';
import { decifrar, gerarSql } from './lib/backup.mjs';
if (!process.argv[2] || !process.env.BACKUP_PASSPHRASE) { console.error('Uso: BACKUP_PASSPHRASE=... node scripts/restaurar.mjs arquivo.json.enc'); process.exit(2); }
process.stdout.write(gerarSql(JSON.parse(decifrar(readFileSync(process.argv[2], 'utf8'), process.env.BACKUP_PASSPHRASE))));
