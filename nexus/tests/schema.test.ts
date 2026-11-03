import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Client } from 'pg';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';

let banco: BancoDeTeste;
/** Conexão de manutenção: monta cenário e testa CHECK/RULE sem o filtro de RLS. */
let db: Client;
/** Conexão da aplicação: papel comum, é nela que o RLS tem de valer. */
let app: Client;

// IDs fixos para poder cruzar as asserções entre os blocos.
const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE_A = '22222222-2222-2222-2222-222222222222';
const CLIENTE_B = '33333333-3333-3333-3333-333333333333';
const USUARIO_NGA = 'aaaaaaaa-0000-0000-0000-000000000001';
const USUARIO_A = 'aaaaaaaa-0000-0000-0000-000000000002';

beforeAll(async () => {
  banco = await bancoDeTeste();
  db = banco.dono;
  app = banco.cliente;

  // O dono do schema ignora RLS por padrão; FORCE ROW LEVEL SECURITY na
  // migração 003 faz a política valer até para ele, que é o que queremos testar.
  await db.query(
    `INSERT INTO organizacoes (id, tipo, nome) VALUES
      ($1,'escritorio','NGA Advogados'), ($2,'cliente','Cliente A'), ($3,'cliente','Cliente B')`,
    [NGA, CLIENTE_A, CLIENTE_B],
  );
  await db.query(
    `INSERT INTO usuarios (id, email, nome, senha_hash) VALUES
      ($1,'socio@nga.adv.br','Sócio NGA','x'), ($2,'dir@clientea.com.br','Diretor A','x')`,
    [USUARIO_NGA, USUARIO_A],
  );
  await db.query(
    `INSERT INTO vinculos (usuario_id, organizacao_id, papel) VALUES
      ($1,$3,'socio_administrador'), ($1,$4,'advogado'), ($1,$5,'advogado'),
      ($2,$4,'cliente_administrador')`,
    [USUARIO_NGA, USUARIO_A, NGA, CLIENTE_A, CLIENTE_B],
  );
}, 120_000);

afterAll(async () => { await banco?.encerrar(); });

/** Executa como um usuário, com o contexto de RLS da requisição. */
async function como<T>(usuarioId: string, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  await app.query('SELECT set_config($1,$2,true)', ['app.usuario_id', usuarioId]);
  try {
    const r = await fn();
    await app.query('COMMIT');
    return r;
  } catch (erro) {
    // Sem o ROLLBACK a conexão fica em "transaction aborted" e TODOS os
    // testes seguintes falham por contaminação, não pelo que testam.
    await app.query('ROLLBACK');
    throw erro;
  }
}

describe('migrations', () => {
  test('todas as migrations aplicaram e ficaram registradas', async () => {
    const { rows } = await db.query<{ nome: string }>('SELECT nome FROM schema_migracoes ORDER BY nome');
    expect(rows.map((r) => r.nome)).toEqual([
      '001_nucleo.sql', '002_insolvencia.sql', '003_rls.sql', '004_papel_aplicacao.sql',
      '005_sessoes.sql', '006_autenticacao.sql', '007_portal.sql',
      '008_financeiro_recuperanda.sql', '009_rls_portal.sql',
      '010_analise.sql', '011_rls_analise.sql', '012_arquivos.sql',
      '013_processos.sql', '014_rls_processos.sql', '015_projeto.sql', '016_integracoes.sql', '017_tarefas.sql', '018_convites.sql']);
  });

  test('rodar de novo é idempotente', async () => {
    const { migrar } = await import('../src/db/migrar.ts');
    const r = await migrar(db);
    expect(r.every((m) => m.jaEstava)).toBe(true);
  });
});

describe('isolamento entre clientes (RLS)', () => {
  test('o cliente A não enxerga empresa do cliente B', async () => {
    await db.query(
      `INSERT INTO empresas (organizacao_id, cnpj, razao_social) VALUES
        ($1,'11111111000111','Empresa do A'), ($2,'22222222000122','Empresa do B')`,
      [CLIENTE_A, CLIENTE_B],
    );

    const doA = await como(USUARIO_A, async () =>
      (await app.query('SELECT razao_social FROM empresas ORDER BY razao_social')).rows);
    expect(doA.map((r) => r.razao_social)).toEqual(['Empresa do A']);

    // O sócio da NGA tem vínculo com as duas e vê as duas.
    const daNGA = await como(USUARIO_NGA, async () =>
      (await app.query('SELECT razao_social FROM empresas ORDER BY razao_social')).rows);
    expect(daNGA.map((r) => r.razao_social)).toEqual(['Empresa do A', 'Empresa do B']);
  });

  test('sem contexto de usuário, não se vê nada', async () => {
    await app.query('BEGIN');
    await app.query('SELECT set_config($1,$2,true)', ['app.usuario_id', '']);
    const { rows } = await app.query('SELECT * FROM empresas');
    await app.query('COMMIT');
    expect(rows).toHaveLength(0);
  });

  test('o cliente A não consegue GRAVAR na organização do B', async () => {
    await expect(
      como(USUARIO_A, async () =>
        app.query(`INSERT INTO empresas (organizacao_id, razao_social) VALUES ($1,'Invasora')`, [CLIENTE_B])),
    ).rejects.toThrow(/row-level security/i);
  });

  test('vínculo revogado deixa de dar acesso', async () => {
    const usuario = 'aaaaaaaa-0000-0000-0000-000000000003';
    await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'ex@nga.adv.br','Ex','x')`, [usuario]);
    await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'advogado')`, [usuario, CLIENTE_A]);
    expect((await como(usuario, async () => (await app.query('SELECT 1 FROM empresas')).rows)).length).toBe(1);

    await db.query(`UPDATE vinculos SET revogado_em=now() WHERE usuario_id=$1`, [usuario]);
    expect((await como(usuario, async () => (await app.query('SELECT 1 FROM empresas')).rows)).length).toBe(0);
  });
});

describe('garantias do domínio de insolvência', () => {
  let projeto: string;
  let credor: string;

  beforeAll(async () => {
    const p = await db.query<{ id: string }>(
      `INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'RJ Grupo X','recuperacao_judicial') RETURNING id`,
      [NGA]);
    projeto = p.rows[0]!.id;
    const c = await db.query<{ id: string }>(
      `INSERT INTO credores (organizacao_id,projeto_id,nome) VALUES ($1,$2,'Banco Y') RETURNING id`,
      [NGA, projeto]);
    credor = c.rows[0]!.id;
  });

  test('valor monetário é BIGINT e aguenta bilhões sem perder centavo', async () => {
    const valor = '900719925474099301'; // 9,007 quatrilhões de centavos
    const { rows } = await db.query<{ valor: string }>(
      `INSERT INTO creditos (organizacao_id,projeto_id,credor_id,valor,natureza)
       VALUES ($1,$2,$3,$4,'quirografario') RETURNING valor`,
      [NGA, projeto, credor, valor]);
    expect(rows[0]!.valor).toBe(valor);
  });

  test('validação de crédito exige assinatura: classe sem validador é rejeitada', async () => {
    await expect(db.query(
      `INSERT INTO creditos (organizacao_id,projeto_id,credor_id,valor,natureza,classe_validada)
       VALUES ($1,$2,$3,1000,'quirografario','III')`,
      [NGA, projeto, credor])).rejects.toThrow(/validacao_completa/);
  });

  test('classe II validada exige avaliação do bem gravado (art. 41, § 2º)', async () => {
    await expect(db.query(
      `INSERT INTO creditos (organizacao_id,projeto_id,credor_id,valor,natureza,
         classe_validada,validado_por,validado_em)
       VALUES ($1,$2,$3,1000,'garantia_real','II',$4,now())`,
      [NGA, projeto, credor, USUARIO_NGA])).rejects.toThrow(/garantia_avaliada/);

    // Com o bem avaliado, passa.
    const ok = await db.query(
      `INSERT INTO creditos (organizacao_id,projeto_id,credor_id,valor,natureza,
         valor_bem_gravado,classe_validada,validado_por,validado_em)
       VALUES ($1,$2,$3,100000,'garantia_real',60000,'II',$4,now()) RETURNING id`,
      [NGA, projeto, credor, USUARIO_NGA]);
    expect(ok.rows).toHaveLength(1);
  });

  test('obrigação do plano precisa fechar: valor = amortização + juros', async () => {
    const plano = (await db.query<{ id: string }>(
      `INSERT INTO planos (organizacao_id,projeto_id,titulo,data_base)
       VALUES ($1,$2,'PRJ','2026-11-01') RETURNING id`, [NGA, projeto])).rows[0]!.id;
    const credito = (await db.query<{ id: string }>(
      `INSERT INTO creditos (organizacao_id,projeto_id,credor_id,valor,natureza)
       VALUES ($1,$2,$3,100000,'quirografario') RETURNING id`, [NGA, projeto, credor])).rows[0]!.id;

    await expect(db.query(
      `INSERT INTO obrigacoes (organizacao_id,plano_id,credito_id,numero,vencimento,
         saldo_inicial,juros,amortizacao,valor,saldo_final)
       VALUES ($1,$2,$3,1,'2026-12-01',100000,500,10000,99999,90000)`,
      [NGA, plano, credito])).rejects.toThrow(/valor_fecha/);

    await expect(db.query(
      `INSERT INTO obrigacoes (organizacao_id,plano_id,credito_id,numero,vencimento,
         saldo_inicial,juros,amortizacao,valor,saldo_final)
       VALUES ($1,$2,$3,1,'2026-12-01',100000,500,10000,10500,85000)`,
      [NGA, plano, credito])).rejects.toThrow(/saldo_fecha/);

    const ok = await db.query(
      `INSERT INTO obrigacoes (organizacao_id,plano_id,credito_id,numero,vencimento,
         saldo_inicial,juros,amortizacao,valor,saldo_final)
       VALUES ($1,$2,$3,1,'2026-12-01',100000,500,10000,10500,90000) RETURNING id`,
      [NGA, plano, credito]);
    expect(ok.rows).toHaveLength(1);
  });

  test('o mesmo crédito não vota duas vezes na mesma classe', async () => {
    const assembleia = (await db.query<{ id: string }>(
      `INSERT INTO assembleias (organizacao_id,projeto_id,data_hora)
       VALUES ($1,$2,'2027-03-01 14:00+00') RETURNING id`, [NGA, projeto])).rows[0]!.id;
    const credito = (await db.query<{ id: string }>(
      `INSERT INTO creditos (organizacao_id,projeto_id,credor_id,valor,natureza)
       VALUES ($1,$2,$3,50000,'quirografario') RETURNING id`, [NGA, projeto, credor])).rows[0]!.id;

    await db.query(`INSERT INTO votos (assembleia_id,credito_id,classe,valor,voto)
       VALUES ($1,$2,'III',50000,'sim')`, [assembleia, credito]);
    await expect(db.query(`INSERT INTO votos (assembleia_id,credito_id,classe,valor,voto)
       VALUES ($1,$2,'III',50000,'nao')`, [assembleia, credito])).rejects.toThrow(/duplicate key/);

    // Mas o desdobramento do art. 41, § 2º permite votar na II e na III.
    const ok = await db.query(`INSERT INTO votos (assembleia_id,credito_id,classe,valor,voto)
       VALUES ($1,$2,'II',30000,'sim') RETURNING id`, [assembleia, credito]);
    expect(ok.rows).toHaveLength(1);
  });
});

describe('auditoria é append-only', () => {
  test('não aceita UPDATE nem DELETE', async () => {
    await db.query(
      `INSERT INTO auditoria (organizacao_id,usuario_id,acao,entidade,entidade_id)
       VALUES ($1,$2,'criou','credito','abc')`, [NGA, USUARIO_NGA]);

    const antes = await como(USUARIO_NGA, async () =>
      (await app.query(`SELECT acao FROM auditoria WHERE entidade_id='abc'`)).rows);
    expect(antes[0]!.acao).toBe('criou');

    // As RULEs transformam a escrita em no-op: não erra, simplesmente não muda.
    await db.query(`UPDATE auditoria SET acao='adulterou' WHERE entidade_id='abc'`);
    await db.query(`DELETE FROM auditoria WHERE entidade_id='abc'`);

    const depois = await como(USUARIO_NGA, async () =>
      (await app.query(`SELECT acao FROM auditoria WHERE entidade_id='abc'`)).rows);
    expect(depois).toHaveLength(1);
    expect(depois[0]!.acao).toBe('criou');
  });

  test('o papel da aplicação não consegue apagar a trilha', async () => {
    // A RULE reescreve o DELETE para nada ANTES da checagem de privilégio, então
    // o comando não erra — simplesmente não faz efeito. O que importa é o
    // resultado: a linha continua lá.
    await app.query(`DELETE FROM auditoria WHERE entidade_id='abc'`);
    await app.query(`UPDATE auditoria SET acao='adulterou' WHERE entidade_id='abc'`);

    const sobrou = await como(USUARIO_NGA, async () =>
      (await app.query(`SELECT acao FROM auditoria WHERE entidade_id='abc'`)).rows);
    expect(sobrou).toHaveLength(1);
    expect(sobrou[0]!.acao).toBe('criou');
  });

  test('e também não recebeu o privilégio — defesa em profundidade', async () => {
    // Verificado pelo catálogo, não por erro: a RULE mascara o erro, mas o
    // privilégio precisa estar mesmo revogado caso a RULE um dia caia.
    const { rows } = await db.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.table_privileges
        WHERE grantee='nga_app' AND table_name='auditoria'
        ORDER BY privilege_type`);
    const privilegios = rows.map((r) => r.privilege_type);
    expect(privilegios).toContain('INSERT');
    expect(privilegios).toContain('SELECT');
    expect(privilegios).not.toContain('UPDATE');
    expect(privilegios).not.toContain('DELETE');
  });
});

describe('postura de conexão', () => {
  test('o papel da aplicação não é superusuário e não fura RLS', async () => {
    const { rows } = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='nga_app'`);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});
