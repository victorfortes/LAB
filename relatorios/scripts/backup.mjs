#!/usr/bin/env node
// Backup cifrado do banco do escritório (documentos, versões, auditoria, perfis).
// Uso:  SUPABASE_URL=... SUPABASE_ANON_KEY=... BACKUP_EMAIL=... BACKUP_PASSWORD=... BACKUP_PASSPHRASE=... node scripts/backup.mjs [pasta]
// Use uma conta de administrador. A frase-senha cifra o arquivo (AES-256-GCM); sem ela o backup não abre. Guarde-a fora do repositório.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { exportarTudo, cifrar } from './lib/backup.mjs';

const { SUPABASE_URL: url, SUPABASE_ANON_KEY: chave, BACKUP_EMAIL: email, BACKUP_PASSWORD: senha, BACKUP_PASSPHRASE: frase } = process.env;
if (!url || !chave || !email || !senha || !frase) { console.error('Defina SUPABASE_URL, SUPABASE_ANON_KEY, BACKUP_EMAIL, BACKUP_PASSWORD e BACKUP_PASSPHRASE.'); process.exit(2); }
if (frase.length < 16) { console.error('BACKUP_PASSPHRASE precisa ter ao menos 16 caracteres.'); process.exit(2); }

const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: chave, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: senha }) });
if (!r.ok) { console.error('Login do backup recusado.'); process.exit(1); }
const { access_token: token } = await r.json();
const ordem = { documentos: 'colecao.asc,id.asc', documentos_versoes: 'colecao.asc,id.asc,versao.asc', auditoria: 'evento.asc', perfis: 'email.asc' };
const dump = await exportarTudo(async (tabela, desde, lim) => {
  const resp = await fetch(`${url}/rest/v1/${tabela}?select=*&order=${ordem[tabela]}&limit=${lim}&offset=${desde}`, { headers: { apikey: chave, Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`falha lendo ${tabela}: ${resp.status}`);
  return resp.json();
});
const pasta = process.argv[2] || 'backups'; mkdirSync(pasta, { recursive: true });
const nome = path.join(pasta, `nga-${new Date().toISOString().replace(/[:T]/g, '').slice(0, 13)}.json.enc`);
writeFileSync(nome, cifrar(JSON.stringify(dump), frase), { mode: 0o600 });
console.log(`Backup cifrado gravado em ${nome} (${Object.entries(dump.tabelas).map(([t, l]) => `${t}: ${l.length}`).join(', ')})`);
