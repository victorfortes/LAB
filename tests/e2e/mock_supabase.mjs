// Servidor de TESTE: serve dist/ (aplicando os cabeçalhos de web/_headers, inclusive a CSP) e imita a API do
// Supabase (Auth + REST) em cima de PostgreSQL real (PGlite) com as migrações e o RLS do projeto.
// Não é usado em produção. Só existe para testar o gerador original de ponta a ponta sem uma conta Supabase.
import http from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export async function iniciar({ porta = 0, usuarios, dist = path.join(raiz, 'dist') } = {}) {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(raiz, 'tests/db/supabase_stub.sql'), 'utf8'));
  for (const f of readdirSync(path.join(raiz, 'supabase/migrations')).sort()) await db.exec(readFileSync(path.join(raiz, 'supabase/migrations', f), 'utf8'));
  const contas = new Map();   // email -> {id, senha}
  for (const u of usuarios) {
    const id = crypto.randomUUID();
    contas.set(u.email, { id, senha: u.senha });
    await db.query('insert into auth.users (id,email) values ($1,$2)', [id, u.email]);
    if (u.papel) await db.query('insert into perfis (user_id,email,nome,papel,ativo) values ($1,$2,$3,$4,$5)', [id, u.email, u.nome || u.email, u.papel, u.ativo !== false]);
  }
  const tokens = new Map();   // access_token -> {id,email}
  const emitir = (email) => {
    const c = contas.get(email), exp = Math.floor(Date.now() / 1000) + 3600;
    const t = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: c.id, email, role: 'authenticated', aud: 'authenticated', exp })}.mock`;
    tokens.set(t, { id: c.id, email });
    return { access_token: t, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r_' + crypto.randomUUID(), user: { id: c.id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
  };

  // cabeçalhos de segurança do projeto (web/_headers), para validar a CSP de verdade
  const regras = readFileSync(path.join(raiz, 'web/_headers'), 'utf8').split('\n'); let globais = {}, atual = null;
  for (const ln of regras) { if (/^\S/.test(ln)) { atual = ln.trim(); } else if (ln.trim() && atual === '/*') { const i = ln.indexOf(':'); globais[ln.slice(0, i).trim()] = ln.slice(i + 1).trim(); } }
  delete globais['Strict-Transport-Security'];

  const filtros = (sp, colunasOk) => {
    const w = [], p = [];
    for (const [k, v] of sp) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
      if (!colunasOk.includes(k)) throw new Error('coluna ' + k);
      const m = /^(eq|gt)\.(.*)$/.exec(v); if (!m) throw new Error('filtro ' + v);
      p.push(k === 'removido' ? m[2] === 'true' : m[2]); w.push(`${k} ${m[1] === 'eq' ? '=' : '>'} $${p.length}`);
    }
    return { where: w.length ? ' where ' + w.join(' and ') : '', p };
  };
  const ordem = (sp, ok) => { const o = sp.get('order'); if (!o) return ''; const [c, d] = o.split('.'); if (!ok.includes(c)) throw new Error('order'); return ` order by ${c} ${d === 'desc' ? 'desc' : 'asc'}`; };

  async function comoUsuario(uid, fn) {
    await db.exec('set role authenticated'); await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [uid]);
    try { return await fn(); } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub','',false)`); }
  }

  const servidor = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const corpoBruto = await new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });
    const json = (st, o, extra = {}) => { res.writeHead(st, { 'Content-Type': 'application/json', ...extra }); res.end(o === undefined ? '' : JSON.stringify(o)); };
    try {
      if (u.pathname === '/__test/sql' && req.method === 'POST') { const { sql, params } = JSON.parse(corpoBruto); const r = await db.query(sql, params || []); return json(200, r.rows); }   // SÓ no servidor de teste
      /* ---------------- Auth ---------------- */
      if (u.pathname === '/auth/v1/token') {
        const b = JSON.parse(corpoBruto || '{}'); const c = contas.get(b.email);
        if (u.searchParams.get('grant_type') === 'password' && c && c.senha === b.password) return json(200, emitir(b.email));
        if (u.searchParams.get('grant_type') === 'refresh_token') { const ult = [...tokens.values()].pop(); if (ult) return json(200, emitir(ult.email)); }
        return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      if (u.pathname === '/auth/v1/user') { const t = (req.headers.authorization || '').replace('Bearer ', ''); const q = tokens.get(t); return q ? json(200, { id: q.id, email: q.email, aud: 'authenticated' }) : json(401, { msg: 'invalid' }); }
      if (u.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end(); }
      if (u.pathname === '/auth/v1/recover') return json(200, {});
      /* ---------------- REST ---------------- */
      if (u.pathname.startsWith('/rest/v1/')) {
        const t = (req.headers.authorization || '').replace('Bearer ', ''); const quem = tokens.get(t);
        if (!quem) return json(401, { message: 'JWT inválido' });
        const tab = u.pathname.slice('/rest/v1/'.length), sp = u.searchParams;
        const exec = (fn) => comoUsuario(quem.id, fn);
        if (tab === 'rpc/registrar_acesso') { await exec(() => db.query('select registrar_acesso()')); return json(204); }
        if (tab === 'documentos') {
          const cols = ['colecao', 'id', 'removido', 'atualizado_em'];
          if (req.method === 'GET') {
            const { where, p } = filtros(sp, cols); const lim = +sp.get('limit') || 1000, off = +sp.get('offset') || 0;
            const r = await exec(() => db.query(`select id, dados, removido, to_char(atualizado_em at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as atualizado_em from documentos${where}${ordem(sp, ['id', 'atualizado_em'])} limit ${lim} offset ${off}`, p));
            return json(200, r.rows);
          }
          if (req.method === 'POST') {
            const b = JSON.parse(corpoBruto);
            try { await exec(() => db.query(`insert into documentos (colecao,id,dados,removido) values ($1,$2,$3,$4) on conflict (colecao,id) do update set dados=excluded.dados, removido=excluded.removido`, [b.colecao, b.id, JSON.stringify(b.dados), !!b.removido])); }
            catch (e) { return json(/row-level security|Somente/.test(e.message) ? 403 : 400, { message: e.message }); }
            return json(201);
          }
          if (req.method === 'PATCH') {
            const b = JSON.parse(corpoBruto); const { where, p } = filtros(sp, cols);
            try { await exec(() => db.query(`update documentos set removido=$${p.length + 1}, dados=$${p.length + 2}${where}`, [...p, !!b.removido, JSON.stringify(b.dados ?? {})])); }
            catch (e) { return json(/row-level security|Somente/.test(e.message) ? 403 : 400, { message: e.message }); }
            return json(204);
          }
        }
        if (tab === 'perfis') {
          const cols = ['user_id', 'email'];
          if (req.method === 'GET') { const { where, p } = filtros(sp, cols); const r = await exec(() => db.query(`select user_id,email,nome,papel,ativo,ultimo_acesso from perfis${where}${ordem(sp, ['nome', 'email'])}`, p)); return json(200, sp.get('select') && /maybeSingle|single/.test(req.headers.accept || '') ? r.rows[0] : r.rows); }
          if (req.method === 'PATCH') { const b = JSON.parse(corpoBruto); const { where, p } = filtros(sp, cols); const ks = Object.keys(b).filter(k => ['papel', 'ativo'].includes(k)); try { const r = await exec(() => db.query(`update perfis set ${ks.map((k, i) => `${k}=$${p.length + i + 1}`).join(',')}${where} returning user_id`, [...p, ...ks.map(k => b[k])])); return json(200, r.rows); } catch (e) { return json(400, { message: e.message }); } }
        }
        if (tab === 'auditoria' && req.method === 'GET') { const r = await exec(() => db.query(`select to_char(em at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"') as em,email,acao,colecao,doc_id from auditoria order by em desc limit 200`)); return json(200, r.rows); }
        return json(404, { message: 'rota não implementada no mock: ' + req.method + ' ' + tab });
      }
      /* ---------------- estático ---------------- */
      let rel = decodeURIComponent(u.pathname); if (rel.endsWith('/')) rel += 'index.html';
      const arq = path.join(dist, rel);
      if (!arq.startsWith(dist) || !existsSync(arq) || statSync(arq).isDirectory()) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'application/octet-stream', ...globais });
      res.end(readFileSync(arq));
    } catch (e) { json(500, { message: String(e.message) }); }
  });
  await new Promise(r => servidor.listen(porta, '127.0.0.1', r));
  const p = servidor.address().port;
  return { url: `http://127.0.0.1:${p}`, db, contas, fechar: () => new Promise(r => servidor.close(r)) };
}

// execução direta:  node tests/e2e/mock_supabase.mjs  (sobe com 3 usuários de teste)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await iniciar({ porta: +process.env.PORT || 8788, usuarios: [
    { email: 'admin@teste.local', senha: 'Senha-de-teste-123', papel: 'admin', nome: 'Admin Teste' },
    { email: 'adv@teste.local', senha: 'Senha-de-teste-123', papel: 'advogado', nome: 'Advogado Teste' },
    { email: 'vis@teste.local', senha: 'Senha-de-teste-123', papel: 'visualizador', nome: 'Visualizador Teste' },
    { email: 'semperfil@teste.local', senha: 'Senha-de-teste-123' }] });
  console.log('mock em', s.url);
}
