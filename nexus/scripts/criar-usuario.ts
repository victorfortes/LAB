/**
 * Cria o primeiro acesso de uma instalação.
 *
 * Banco recém-migrado não tem usuário nenhum, e sem isto a instância sobe,
 * responde e não serve para nada — ninguém entra. A demonstração semeia
 * usuários por conta própria; instalação de verdade precisava disto.
 *
 * Roda como DONO do schema, não como `nga_app`: `usuarios` tem RLS e o papel
 * da aplicação não insere ali (ver migração 003), o que é correto — criar
 * conta não é operação de requisição web.
 *
 * Uso:
 *   NGA_SENHA='...' bun scripts/criar-usuario.ts <email> "<nome>" [papel]
 *
 * A senha vem do ambiente, nunca de argumento: argumento aparece em `ps` e
 * fica no histórico do shell.
 */
import { Client } from 'pg';
import { PERMISSOES, type Papel } from '../src/security/rbac.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

const [email, nome, papelBruto = 'socio_administrador'] = process.argv.slice(2);
const papel = papelBruto as Papel;

if (!email || !nome) {
  console.error('\n  uso: NGA_SENHA=... bun scripts/criar-usuario.ts <email> "<nome>" [papel]\n' +
    `  papéis: ${Object.keys(PERMISSOES).join(', ')}\n`);
  process.exit(1);
}
if (!(papel in PERMISSOES)) {
  console.error(`\n  papel desconhecido: ${papel}\n  papéis: ${Object.keys(PERMISSOES).join(', ')}\n`);
  process.exit(1);
}

const senha = process.env['NGA_SENHA'];
if (!senha || senha.length < 12) {
  console.error('\n  defina NGA_SENHA com ao menos 12 caracteres.\n');
  process.exit(1);
}

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) { console.error(`\n  Falta a variável ${nome}.\n`); process.exit(1); }
  return valor;
}

const db = new Client({
  host: process.env['NGA_PG_HOST'] ?? 'localhost',
  port: Number(process.env['NGA_PG_PORT'] ?? 5432),
  user: process.env['NGA_PG_ADMIN_USER'] ?? 'postgres',
  password: exigir('NGA_PG_ADMIN_PASSWORD'),
  database: process.env['NGA_PG_DATABASE'] ?? 'nga_nexus',
});
await db.connect();

try {
  await db.query('BEGIN');

  // A organização do escritório é criada uma vez; depois é reaproveitada.
  const { rows: orgs } = await db.query<{ id: string; nome: string }>(
    `SELECT id, nome FROM organizacoes WHERE tipo = 'escritorio' ORDER BY criado_em LIMIT 1`);
  let organizacaoId = orgs[0]?.id;
  if (!organizacaoId) {
    const nomeDaOrg = process.env['NGA_ORGANIZACAO'] ?? 'NGA Advogados';
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO organizacoes (tipo, nome) VALUES ('escritorio', $1) RETURNING id`, [nomeDaOrg]);
    organizacaoId = rows[0]!.id;
    console.log(`  organização criada: ${nomeDaOrg}`);
  } else {
    console.log(`  organização existente: ${orgs[0]!.nome}`);
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO usuarios (email, nome, senha_hash) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash
     RETURNING id`,
    [email.toLowerCase(), nome, await hashDaSenha(senha)]);
  const usuarioId = rows[0]!.id;

  await db.query(
    `INSERT INTO vinculos (usuario_id, organizacao_id, papel) VALUES ($1,$2,$3)
     ON CONFLICT (usuario_id, organizacao_id, papel) DO NOTHING`,
    [usuarioId, organizacaoId, papel]);

  await db.query('COMMIT');
  console.log(`  usuário pronto: ${email} · ${papel}`);
  console.log('\n  A senha não é exibida nem gravada em lugar algum além do hash.');
} catch (erro) {
  await db.query('ROLLBACK');
  throw erro;
} finally {
  await db.end();
}
