/**
 * Aplica as migrações contra um PostgreSQL de verdade.
 *
 * O `package.json` já prometia este comando; o arquivo não existia, o que só
 * não doía porque demo e testes criam o banco por conta própria. Sem ele não
 * há como colocar o sistema em pé fora da máquina de quem desenvolve — era o
 * que faltava entre "roda em demonstração" e "roda em algum lugar".
 *
 * Conecta como DONO do schema (não como `nga_app`): criar tabela, política e
 * papel exige isso. O `nga_app` é criado pela migração 004 e é ele que a
 * aplicação usa depois — justamente porque não fura o RLS.
 */
import { Client } from 'pg';
import { migrar } from '../src/db/migrar.ts';

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`\n  Falta a variável ${nome}.\n`);
    process.exit(1);
  }
  return valor;
}

const dono = new Client({
  host: process.env['NGA_PG_HOST'] ?? 'localhost',
  port: Number(process.env['NGA_PG_PORT'] ?? 5432),
  // O dono do schema, não o papel da aplicação.
  user: process.env['NGA_PG_ADMIN_USER'] ?? 'postgres',
  password: exigir('NGA_PG_ADMIN_PASSWORD'),
  database: process.env['NGA_PG_DATABASE'] ?? 'nga_nexus',
});

await dono.connect();

try {
  const aplicadas = await migrar(dono);
  const novas = aplicadas.filter((m) => !m.jaEstava);
  for (const m of novas) console.log(`  aplicada  ${m.nome}`);
  console.log(novas.length === 0
    ? `  nada a aplicar (${aplicadas.length} migrações já estavam no banco)`
    : `\n  ${novas.length} migração(ões) aplicada(s); ${aplicadas.length} no total.`);

  // A migração 004 cria `nga_app` sem senha utilizável. Definir a senha aqui
  // é o que permite a aplicação conectar — e é feito em comando separado
  // porque a senha não pode ir parar no arquivo de migração.
  const senhaDoApp = process.env['NGA_PG_PASSWORD'];
  if (senhaDoApp) {
    // Identificador fixo e senha por literal com escape: a senha vem do
    // ambiente, e ALTER ROLE não aceita parâmetro vinculado.
    await dono.query(`ALTER ROLE nga_app PASSWORD ${literal(senhaDoApp)}`);
    console.log('  senha do papel nga_app definida');
  } else {
    console.log(
      '\n  AVISO: NGA_PG_PASSWORD não foi informada, então a senha de `nga_app` não\n' +
      '  foi definida e a aplicação não vai conseguir conectar. Rode de novo com ela.');
  }
} finally {
  await dono.end();
}

/** Literal SQL com aspas simples duplicadas, como manda o PostgreSQL. */
function literal(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}
