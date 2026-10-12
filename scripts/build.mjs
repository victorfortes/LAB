#!/usr/bin/env node
// Build em Node (mesma saída do scripts/build.py): usado pelo Lovable/Cloudflare, que têm Node mas não Python.
// Extrai a página do Artifact original (preservado, SHA-256 conferido), aplica os patches de scripts/patches.json
// (cada um precisa casar exatamente uma vez), injeta a CSP por <meta> e copia a casca, fontes e supabase-js para dist/.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINAL = path.join(RAIZ, 'original', 'artifact-HksuUVxXv21ftK5iF5sFG7-v27.html');
const DIST = process.env.NGA_OUT ? path.resolve(RAIZ, process.env.NGA_OUT) : path.join(RAIZ, 'public', 'gerador');   // produção: public/gerador (versionado); testes: NGA_OUT
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const falha = (m) => { console.error('ERRO: ' + m); process.exit(1); };

function cspMeta(urlSupabase) {
  const m = /^(https:\/\/[^/]+)/.exec(urlSupabase || '');
  const origem = m ? m[1] + ' ' + m[1].replace('https://', 'wss://') : '';
  const conecta = ("'self' " + origem + ' https://api.bcb.gov.br https://dadosabertos.bcb.gov.br https://cdnjs.cloudflare.com blob: data:').replace(/  /g, ' ');
  const pol = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; font-src 'self' data:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'self'; connect-src " + conecta;
  return '<meta http-equiv="Content-Security-Policy" content="' + pol + '">';
}
const conta = (txt, a) => txt.split(a).length - 1;
const troca = (txt, a, b) => { const i = txt.indexOf(a); return txt.slice(0, i) + b + txt.slice(i + a.length); };   // 1ª ocorrência, sem interpretar "$" como em replace()

const original = readFileSync(ORIGINAL);
if (sha(original) !== readFileSync(path.join(RAIZ, 'original', 'SHA256SUMS'), 'utf8').trim().split(/\s+/)[0]) falha('o arquivo original foi alterado (SHA-256 diferente).');
let txt = original.toString('utf8');
const ini = txt.indexOf('<!doctype html>\n<html lang="pt-BR">');
if (ini < 0) falha('início da página do gerador não encontrado');
let pagina = txt.slice(ini, txt.indexOf('</html>', ini) + '</html>'.length);

const patches = JSON.parse(readFileSync(path.join(RAIZ, 'scripts', 'patches.json'), 'utf8'));
const rel = [];
for (const p of patches) {
  const n = conta(pagina, p.de);
  if (n !== 1) falha(`patch ${p.id} casou ${n} vez(es) (esperado 1). O original mudou?`);
  pagina = troca(pagina, p.de, p.para); rel.push({ patch: p.id, motivo: p.motivo });
}

const env = { ...process.env };
if (existsSync(path.join(RAIZ, '.env'))) for (const ln of readFileSync(path.join(RAIZ, '.env'), 'utf8').split('\n')) {
  const k = ln.split('=')[0], v = ln.slice(k.length + 1).trim();
  if ((k === 'SUPABASE_URL' || k === 'SUPABASE_ANON_KEY') && !env[k]) env[k] = v;
}
const cfgPublica = path.join(RAIZ, 'config', 'supabase.public.json');
if ((!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) && existsSync(cfgPublica)) {
  const j = JSON.parse(readFileSync(cfgPublica, 'utf8')); env.SUPABASE_URL ||= j.url; env.SUPABASE_ANON_KEY ||= j.anonKey;
}
const url = (env.SUPABASE_URL || '').trim(), chave = (env.SUPABASE_ANON_KEY || '').trim();
if (chave.startsWith('eyJ')) {   // JWT: o papel dentro dele tem de ser "anon"
  try { const pl = JSON.parse(Buffer.from(chave.split('.')[1], 'base64url').toString()); if (pl.role !== 'anon') falha('a chave informada tem papel "' + pl.role + '", não "anon".'); } catch (e) { falha('chave JWT ilegível.'); }
}
if (chave.includes('service_role') || chave.startsWith('sb_secret_')) falha('SUPABASE_ANON_KEY parece ser a chave SECRETA. Use só a chave pública (anon).');
const meta = cspMeta(url);
if (conta(pagina, '<head>') !== 1) falha('<head> não único');
pagina = troca(pagina, '<head>', '<head>\n' + meta);
rel.push({ patch: 'P7-csp-meta', motivo: 'Política de segurança de conteúdo também por <meta> (hospedagem sem cabeçalhos HTTP).' });

rmSync(DIST, { recursive: true, force: true });
mkdirSync(path.join(DIST, 'app'), { recursive: true });
writeFileSync(path.join(DIST, 'app', 'gerador.html'), pagina, 'utf8');
cpSync(path.join(RAIZ, 'web', 'app', 'fonts'), path.join(DIST, 'app', 'fonts'), { recursive: true });
for (const f of readdirSync(path.join(RAIZ, 'web', 'shell'))) {
  if (f === 'index.html') writeFileSync(path.join(DIST, 'index.html'), troca(readFileSync(path.join(RAIZ, 'web', 'shell', f), 'utf8'), '<head>', '<head>\n' + meta), 'utf8');
  else copyFileSync(path.join(RAIZ, 'web', 'shell', f), path.join(DIST, f));
}
mkdirSync(path.join(DIST, 'vendor'));
copyFileSync(path.join(RAIZ, 'src', 'assets', 'nga-logo.png'), path.join(DIST, 'logo.png'));
copyFileSync(path.join(RAIZ, 'web', 'vendor', 'supabase.js'), path.join(DIST, 'vendor', 'supabase.js'));
writeFileSync(path.join(DIST, 'config.js'), 'window.NGA_SHELL_CONFIG = ' + JSON.stringify({ url, key: chave, inatividadeMin: 30 }) + ';\n');
writeFileSync(path.join(DIST, 'BUILD.json'), JSON.stringify({ original_sha256: sha(original), pagina_gerador_sha256: sha(Buffer.from(pagina)), patches: rel }, null, 1));
console.log(`OK ${path.relative(RAIZ, DIST)}/ pronto · gerador ${Math.floor(Buffer.byteLength(pagina) / 1024)} KiB · ${rel.length} patches · Supabase ${url && chave ? 'configurado' : 'NÃO configurado (modo de teste)'}`);
