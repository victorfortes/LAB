// Testes de autorização no banco (RLS, gatilhos, versões, auditoria) com PostgreSQL real (PGlite).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const U = { admin: '00000000-0000-0000-0000-0000000000a1', admin2: '00000000-0000-0000-0000-0000000000a2',
  adv: '00000000-0000-0000-0000-0000000000b1', vis: '00000000-0000-0000-0000-0000000000c1',
  inativo: '00000000-0000-0000-0000-0000000000d1', semperfil: '00000000-0000-0000-0000-0000000000e1' };
let db;

// executa como uma pessoa logada (papel "authenticated" + sub do JWT) ou como anon
async function como(uid, sql, params = []) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub','',false)`); }
}
async function falha(uid, sql, params = []) {
  try { await como(uid, sql, params); } catch (e) { return String(e.message); }
  return null;
}
const ins = (col, id, dados = {}) => ['insert into documentos (colecao,id,dados) values ($1,$2,$3)', [col, id, JSON.stringify(dados)]];

before(async () => {
  db = new PGlite();
  await db.exec(readFileSync(path.join(raiz, 'tests/db/supabase_stub.sql'), 'utf8'));
  for (const f of readdirSync(path.join(raiz, 'supabase/migrations')).sort())
    await db.exec(readFileSync(path.join(raiz, 'supabase/migrations', f), 'utf8'));
  for (const [k, v] of Object.entries(U)) await db.query('insert into auth.users (id,email) values ($1,$2)', [v, k + '@teste.local']);
  const perf = [['admin', 'admin', true], ['admin2', 'admin', true], ['adv', 'advogado', true], ['vis', 'visualizador', true], ['inativo', 'advogado', false]];
  for (const [k, papel, ativo] of perf)
    await db.query('insert into perfis (user_id,email,nome,papel,ativo) values ($1,$2,$3,$4,$5)', [U[k], k + '@teste.local', k, papel, ativo]);
});

test('anon não lê nem grava nada', async () => {
  assert.match(await falha(null, 'select * from documentos'), /permission denied/i);
  assert.match(await falha(null, ...ins('clientes', 'x')), /permission denied/i);
  assert.match(await falha(null, 'select * from perfis'), /permission denied/i);
});

test('pessoa sem perfil ou desativada não enxerga documentos', async () => {
  await como(U.adv, ...ins('clientes', 'c1', { nome: 'CLIENTE 1' }));
  for (const u of [U.semperfil, U.inativo]) {
    const r = await como(u, 'select * from documentos');
    assert.equal(r.rows.length, 0, 'sem acesso a nenhuma linha');
    assert.ok(await falha(u, ...ins('clientes', 'c9')), 'sem gravação');
  }
});

test('visualizador lê mas não grava', async () => {
  const r = await como(U.vis, 'select id from documentos where colecao=$1', ['clientes']);
  assert.equal(r.rows.length, 1);
  assert.match(await falha(U.vis, ...ins('clientes', 'c2')), /row-level security/i);
  assert.equal((await como(U.vis, `update documentos set dados='{"x":1}' where id='c1' returning id`)).rows.length, 0, 'update não afeta linhas');
  assert.equal((await como(U.vis, `delete from documentos where id='c1' returning id`)).rows.length, 0);
});

test('advogado cria e edita, mas não exclui cliente, modelo nem relatório emitido', async () => {
  await como(U.adv, ...ins('clientes', 'c3', { nome: 'A' }));
  await como(U.adv, ...ins('modelos', 'm1', { nome: 'M' }));
  await como(U.adv, ...ins('emissoes', 'e1', { nome: 'E' }));
  await como(U.adv, `update documentos set dados='{"nome":"B"}' where colecao='clientes' and id='c3'`);
  for (const [col, id] of [['clientes', 'c3'], ['modelos', 'm1'], ['emissoes', 'e1']])
    assert.match(await falha(U.adv, `update documentos set removido=true where colecao=$1 and id=$2`, [col, id]), /Somente administrador/);
  assert.equal((await como(U.adv, `delete from documentos where id='c3' returning id`)).rows.length, 0, 'sem DELETE físico');
  // regra e rascunho de projeto o advogado pode excluir (como no original)
  await como(U.adv, ...ins('regras', 'r1', { contem: 'x' }));
  await como(U.adv, `update documentos set removido=true where colecao='regras' and id='r1'`);
});

test('administrador exclui (lógico e definitivo) e restaura', async () => {
  await como(U.admin, `update documentos set removido=true where colecao='clientes' and id='c3'`);
  const r = await como(U.admin, `select removido from documentos where colecao='clientes' and id='c3'`);
  assert.equal(r.rows[0].removido, true);
  await como(U.admin, `update documentos set removido=false where colecao='clientes' and id='c3'`);
  await como(U.admin, `delete from documentos where colecao='emissoes' and id='e1'`);
});

test('coleção inválida e documento acima de 256 KiB são recusados', async () => {
  assert.match(await falha(U.adv, ...ins('papeis', 'p1')), /documentos_colecao_valida/);
  assert.match(await falha(U.adv, ...ins('clientes', 'grande', { t: 'x'.repeat(270000) })), /documentos_tamanho/);
});

test('upsert do gerador (insert ... on conflict) respeita o papel', async () => {
  const up = `insert into documentos (colecao,id,dados,removido) values ('clientes','c5',$1,false)
    on conflict (colecao,id) do update set dados=excluded.dados, removido=false`;
  await como(U.adv, up, ['{"v":1}']);
  await como(U.adv, up, ['{"v":2}']);
  assert.match(await falha(U.vis, up, ['{"v":3}']), /row-level security/i);
  assert.equal((await como(U.adv, `select dados->>'v' v from documentos where id='c5'`)).rows[0].v, '2');
});

test('atualizado_em e autor vêm do servidor e não podem ser forjados', async () => {
  await como(U.adv, `update documentos set dados='{"v":9}', atualizado_em='2000-01-01', atualizado_por=$1 where colecao='clientes' and id='c5'`, [U.admin]);
  const r = await como(U.admin, `select atualizado_em > now() - interval '1 minute' as recente, atualizado_por from documentos where id='c5'`);
  assert.equal(r.rows[0].recente, true);
  assert.equal(r.rows[0].atualizado_por, U.adv);
});

test('versões: cada alteração de cadastro preserva o estado anterior', async () => {
  const r = await como(U.adv, `select versao, dados->>'v' v from documentos_versoes where colecao='clientes' and id='c5' order by versao`);
  assert.deepEqual(r.rows.map(x => x.v), ['1', '2']);
  assert.equal((await como(U.vis, 'select * from documentos_versoes')).rows.length, 0, 'visualizador não vê versões');
  assert.ok(await falha(U.adv, `update documentos_versoes set dados='{}'`), 'ninguém altera versões');
});

test('auditoria: só administrador lê; registra ações sem conteúdo', async () => {
  assert.equal((await como(U.adv, 'select * from auditoria')).rows.length, 0);
  const r = await como(U.admin, `select acao, colecao, doc_id, meta from auditoria where doc_id='c3' order by evento`);
  assert.ok(r.rows.some(x => x.acao === 'criar') && r.rows.some(x => x.acao === 'excluir'));
  const tudo = JSON.stringify((await como(U.admin, 'select * from auditoria')).rows);
  assert.ok(!tudo.includes('CLIENTE 1'), 'conteúdo do relatório não vai para a auditoria');
  assert.ok(await falha(U.admin, `update auditoria set acao='x'`) || (await como(U.admin, `delete from auditoria returning 1`)).rows.length === 0, 'auditoria é imutável para usuários');
});

test('perfis: ninguém altera o próprio papel; só administrador gerencia; sempre resta um admin', async () => {
  assert.equal((await como(U.adv, 'select * from perfis')).rows.length, 1, 'advogado só vê o próprio perfil');
  assert.equal((await como(U.adv, `update perfis set papel='admin' where user_id=$1 returning 1`, [U.adv])).rows.length, 0);
  assert.equal((await como(U.admin, `update perfis set papel='visualizador' where user_id=$1 returning 1`, [U.admin])).rows.length, 0, 'admin não altera a si mesmo');
  await como(U.admin, `update perfis set papel='advogado' where user_id=$1`, [U.vis]);
  await como(U.admin, `update perfis set papel='visualizador' where user_id=$1`, [U.vis]);
  await como(U.admin, `update perfis set ativo=false where user_id=$1`, [U.admin2]);       // há outro admin: ok
  // admin2 está inativo: não consegue mais agir (papel_atual() nulo), e nada muda
  assert.equal((await como(U.admin2, `update perfis set ativo=false where user_id=$1 returning 1`, [U.admin])).rows.length, 0);
  // o último administrador ativo não pode ser rebaixado nem removido, nem pelo painel do Supabase (service role)
  await assert.rejects(db.query(`update perfis set papel='advogado' where user_id=$1`, [U.admin]), /pelo menos um administrador/);
  await assert.rejects(db.query(`delete from perfis where user_id=$1`, [U.admin]), /pelo menos um administrador/);
  await como(U.admin, `update perfis set ativo=true where user_id=$1`, [U.admin2]);
});

test('papel_atual e registrar_acesso: acesso registrado só para perfil ativo', async () => {
  await como(U.adv, 'select registrar_acesso()');
  assert.ok((await como(U.admin, `select 1 from auditoria where acao='acesso' and user_id=$1`, [U.adv])).rows.length === 1);
  await como(U.inativo, 'select registrar_acesso()');
  assert.equal((await como(U.admin, `select 1 from auditoria where acao='acesso' and user_id=$1`, [U.inativo])).rows.length, 0);
  assert.equal((await como(U.semperfil, 'select papel_atual() p')).rows[0].p, null);
});

test('pedaços de PDF (coleção pdfs): advogado grava, só administrador exclui, sem auditoria por pedaço', async () => {
  await como(U.adv, ...ins('pdfs', 'em_1__0', { id: 'em_1__0', n: 0, total: 1, dados: 'AAAA' }));
  assert.match(await falha(U.adv, `update documentos set removido=true where colecao='pdfs' and id='em_1__0'`), /Somente administrador/);
  assert.equal((await como(U.vis, `select 1 from documentos where colecao='pdfs'`)).rows.length, 1, 'visualizador baixa PDFs emitidos');
  assert.ok(await falha(U.vis, ...ins('pdfs', 'em_1__1')), 'visualizador não grava PDF');
  assert.equal((await como(U.admin, `select 1 from auditoria where colecao='pdfs'`)).rows.length, 0);
  await como(U.admin, `update documentos set removido=true where colecao='pdfs' and id='em_1__0'`);
});

test('menor privilégio (com os padrões do Supabase): anon sem funções, authenticated sem TRUNCATE nem funções de gatilho', async () => {
  assert.match(await falha(null, 'select registrar_acesso()'), /permission denied/i);
  assert.match(await falha(null, 'select papel_atual()'), /permission denied/i);
  assert.match(await falha(U.adv, 'truncate documentos'), /permission denied/i);
  assert.match(await falha(U.adv, 'truncate perfis'), /permission denied/i);
  assert.match(await falha(U.adv, 'select documentos_antes()'), /permission denied/i);
  assert.match(await falha(U.adv, `insert into documentos_versoes (colecao,id,versao,dados) values ('clientes','z',1,'{}')`), /permission denied|row-level security/i);
  // continua funcionando para quem pode: gatilhos disparam e as duas funções de uso respondem
  await como(U.adv, ...ins('clientes', 'priv_ok', { a: 1 }));
  await como(U.adv, `update documentos set dados='{"a":2}' where id='priv_ok'`);
  assert.ok((await como(U.adv, 'select papel_atual() p')).rows[0].p === 'advogado');
});
