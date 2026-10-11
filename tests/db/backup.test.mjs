// Teste de recuperação: banco A -> backup cifrado -> restauração em banco B NOVO -> dados idênticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportarTudo, cifrar, decifrar, gerarSql } from '../../scripts/lib/backup.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function novoBanco() {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(raiz, 'tests/db/supabase_stub.sql'), 'utf8'));
  for (const f of readdirSync(path.join(raiz, 'supabase/migrations')).sort()) await db.exec(readFileSync(path.join(raiz, 'supabase/migrations', f), 'utf8'));
  return db;
}

test('backup cifrado e restauração em banco novo preservam todos os dados', async () => {
  const A = await novoBanco(), adm = '00000000-0000-0000-0000-0000000000a1';
  await A.query('insert into auth.users (id,email) values ($1,$2)', [adm, 'a@t.local']);
  await A.query(`insert into perfis (user_id,email,nome,papel) values ($1,'a@t.local','A','admin')`, [adm]);
  await A.query(`select set_config('request.jwt.claim.sub',$1,false)`, [adm]);
  const aspas = `Cliente D'AVILA "teste" ç ã é 日本`;
  await A.query(`insert into documentos (colecao,id,dados) values ('clientes','c1',$1)`, [JSON.stringify({ nome: aspas, n: [1, 2, { x: null }] })]);
  await A.query(`update documentos set dados=$1 where id='c1'`, [JSON.stringify({ nome: aspas + ' v2' })]);       // gera versão
  await A.query(`insert into documentos (colecao,id,dados) values ('pdfs','em_1__0',$1)`, [JSON.stringify({ dados: 'JVBERi0xLjQK'.repeat(50) })]);
  await A.query(`insert into documentos (colecao,id,dados,removido) values ('modelos','m1','{"nome":"M"}',true)`);

  const dump = await exportarTudo(async (t, desde, lim) => (await A.query(`select * from ${t} order by 1,2 limit ${lim} offset ${desde}`)).rows);
  const enc = cifrar(JSON.stringify(dump), 'frase-de-teste-bem-longa');
  assert.ok(!enc.includes('D\'AVILA'), 'o arquivo cifrado não revela o conteúdo');
  assert.throws(() => decifrar(enc, 'senha-errada-qualquer!!'), /./, 'senha errada não abre');
  const adulterado = JSON.parse(enc); adulterado.dados = adulterado.dados.slice(0, -4) + 'AAAA';
  assert.throws(() => decifrar(JSON.stringify(adulterado), 'frase-de-teste-bem-longa'), /./, 'arquivo adulterado é rejeitado');

  const B = await novoBanco();
  await B.exec(gerarSql(JSON.parse(decifrar(enc, 'frase-de-teste-bem-longa'))));
  const cmp = async (db, sql) => JSON.stringify((await db.query(sql)).rows);
  const q1 = `select colecao,id,dados,removido,atualizado_em from documentos order by 1,2`;
  assert.equal(await cmp(B, q1), await cmp(A, q1), 'documentos idênticos (inclusive datas e exclusões lógicas)');
  const q2 = `select colecao,id,versao,dados from documentos_versoes order by 1,2,3`;
  assert.equal(await cmp(B, q2), await cmp(A, q2), 'histórico de versões idêntico');
  assert.equal((await B.query(`select count(*)::int n from auditoria`)).rows[0].n, 0, 'restauração não gera auditoria falsa');
  // gatilhos voltam a funcionar depois da restauração
  await B.query(`insert into documentos (colecao,id,dados) values ('clientes','novo','{}')`);
  assert.ok((await B.query(`select atualizado_em from documentos where id='novo'`)).rows.length === 1);
  assert.equal((await B.query(`select count(*)::int n from pg_trigger where tgname in ('documentos_antes','documentos_depois') and tgenabled='O'`)).rows[0].n, 2);
});
