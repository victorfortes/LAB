// Backup lógico do banco do escritório: exporta, cifra (AES-256-GCM) e gera o SQL de restauração.
import crypto from 'node:crypto';

const TABELAS = ['documentos', 'documentos_versoes', 'auditoria', 'perfis'];
const PAGINA = 1000;

// fetchJson(caminhoRest) -> array de linhas (já autenticado como administrador)
export async function exportarTudo(fetchTabela) {
  const dump = { formato: 'nga-dump', versao: 1, gerado_em: new Date().toISOString(), tabelas: {} };
  for (const t of TABELAS) {
    const linhas = []; let desde = 0;
    for (;;) { const p = await fetchTabela(t, desde, PAGINA); linhas.push(...p); if (p.length < PAGINA) break; desde += PAGINA; }
    dump.tabelas[t] = linhas;
  }
  return dump;
}

export function cifrar(texto, senha) {
  const sal = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const chave = crypto.scryptSync(senha, sal, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const c = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return JSON.stringify({ nga: 'backup-cifrado', v: 1, alg: 'aes-256-gcm+scrypt', sal: sal.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), dados: dados.toString('base64') });
}
export function decifrar(envelope, senha) {
  const e = JSON.parse(envelope);
  if (e.nga !== 'backup-cifrado') throw new Error('arquivo não é um backup NGA cifrado');
  const chave = crypto.scryptSync(senha, Buffer.from(e.sal, 'base64'), 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const d = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(e.iv, 'base64'));
  d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(e.dados, 'base64')), d.final()]).toString('utf8');   // senha errada ou arquivo adulterado: lança erro
}

const q = (v) => v === null || v === undefined ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const uuidOuNulo = (v) => v ? `(select id from auth.users where id = ${q(v)})` : 'null';

// SQL para um projeto novo (migrações já aplicadas). Usuários (auth.users) não são restaurados aqui:
// as pessoas precisam ser convidadas de novo; vínculos de autoria de quem não existir ficam nulos.
export function gerarSql(dump) {
  const L = [];
  L.push('-- Restauração do backup NGA · gerado em ' + dump.gerado_em);
  L.push('begin;');
  L.push('alter table public.documentos disable trigger documentos_antes;', 'alter table public.documentos disable trigger documentos_depois;');
  for (const d of dump.tabelas.documentos) {
    L.push(`insert into public.documentos (colecao,id,dados,removido,criado_em,criado_por,atualizado_em,atualizado_por) values (${q(d.colecao)},${q(d.id)},${q(JSON.stringify(d.dados))}::jsonb,${d.removido ? 'true' : 'false'},${q(d.criado_em)},${uuidOuNulo(d.criado_por)},${q(d.atualizado_em)},${uuidOuNulo(d.atualizado_por)}) on conflict (colecao,id) do update set dados=excluded.dados, removido=excluded.removido, criado_em=excluded.criado_em, atualizado_em=excluded.atualizado_em;`);
  }
  for (const v of dump.tabelas.documentos_versoes || []) {
    L.push(`insert into public.documentos_versoes (colecao,id,versao,dados,removido,autor,em) values (${q(v.colecao)},${q(v.id)},${v.versao},${q(JSON.stringify(v.dados))}::jsonb,${v.removido ? 'true' : 'false'},${uuidOuNulo(v.autor)},${q(v.em)}) on conflict do nothing;`);
  }
  L.push('alter table public.documentos enable trigger documentos_antes;', 'alter table public.documentos enable trigger documentos_depois;');
  L.push('commit;');
  return L.join('\n');
}
