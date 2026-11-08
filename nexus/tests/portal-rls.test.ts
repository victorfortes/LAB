import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Client } from 'pg';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';

let pg: BancoDeTeste; let db: Client; let app: Client;

const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE_A = '22222222-2222-2222-2222-222222222222';
const CLIENTE_B = '33333333-3333-3333-3333-333333333333';
const ADVOGADO = 'aaaaaaaa-0000-0000-0000-000000000001';
const USUARIO_A = 'aaaaaaaa-0000-0000-0000-000000000002';
const USUARIO_B = 'aaaaaaaa-0000-0000-0000-000000000003';

let projetoA: string, projetoB: string;
let docInterno: string, docPublicado: string;

beforeAll(async () => {
  pg = await bancoDeTeste(); db = pg.dono; app = pg.cliente;

  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES
    ($1,'escritorio','NGA'),($2,'cliente','Grupo A'),($3,'cliente','Grupo B')`, [NGA, CLIENTE_A, CLIENTE_B]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES
    ($1,'adv@nga.adv.br','Advogado','x'),($2,'a@grupoa.com','Diretor A','x'),($3,'b@grupob.com','Diretor B','x')`,
    [ADVOGADO, USUARIO_A, USUARIO_B]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES
    ($1,$4,'advogado'),($2,$5,'cliente_administrador'),($3,$6,'cliente_administrador')`,
    [ADVOGADO, USUARIO_A, USUARIO_B, NGA, CLIENTE_A, CLIENTE_B]);

  projetoA = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo)
    VALUES ($1,'RJ Grupo A','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  projetoB = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo)
    VALUES ($1,'RJ Grupo B','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;

  await db.query(`INSERT INTO portais (projeto_id,organizacao_cliente_id) VALUES ($1,$2),($3,$4)`,
    [projetoA, CLIENTE_A, projetoB, CLIENTE_B]);

  docInterno = (await db.query<{id:string}>(`INSERT INTO documentos
    (organizacao_id,projeto_id,titulo,caminho) VALUES ($1,$2,'Parecer interno sobre riscos','/x/1')
    RETURNING id`, [NGA, projetoA])).rows[0]!.id;
  docPublicado = (await db.query<{id:string}>(`INSERT INTO documentos
    (organizacao_id,projeto_id,titulo,caminho,visibilidade,publicado_por,publicado_em)
    VALUES ($1,$2,'Relatório mensal','/x/2','publicado',$3,now()) RETURNING id`,
    [NGA, projetoA, ADVOGADO])).rows[0]!.id;
}, 120_000);

afterAll(async () => { await pg?.encerrar(); });

async function como<T>(usuario: string, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  await app.query('SELECT set_config($1,$2,true)', ['app.usuario_id', usuario]);
  try { const r = await fn(); await app.query('COMMIT'); return r; }
  catch (e) { await app.query('ROLLBACK'); throw e; }
}

describe('documento interno nunca chega ao cliente', () => {
  test('o cliente vê apenas o documento publicado', async () => {
    const vistos = await como(USUARIO_A, async () =>
      (await app.query<{id:string;titulo:string}>('SELECT id, titulo FROM documentos')).rows);
    expect(vistos).toHaveLength(1);
    expect(vistos[0]!.id).toBe(docPublicado);
    expect(vistos[0]!.titulo).toBe('Relatório mensal');
  });

  test('o advogado da NGA vê os dois', async () => {
    const vistos = await como(ADVOGADO, async () =>
      (await app.query('SELECT id FROM documentos')).rows);
    expect(vistos).toHaveLength(2);
  });

  test('nem buscando pelo id o cliente alcança o interno', async () => {
    const r = await como(USUARIO_A, async () =>
      (await app.query('SELECT id FROM documentos WHERE id = $1', [docInterno])).rows);
    expect(r).toHaveLength(0);
  });

  test('despublicar tira o documento do cliente na hora', async () => {
    await db.query(`UPDATE documentos SET visibilidade='interno', publicado_por=NULL, publicado_em=NULL WHERE id=$1`, [docPublicado]);
    const r = await como(USUARIO_A, async () => (await app.query('SELECT id FROM documentos')).rows);
    expect(r).toHaveLength(0);
    await db.query(`UPDATE documentos SET visibilidade='publicado', publicado_por=$2, publicado_em=now() WHERE id=$1`, [docPublicado, ADVOGADO]);
  });

  test('desligar a exibição de documentos no portal também tira', async () => {
    await db.query(`UPDATE portais SET mostra_documentos=false WHERE projeto_id=$1`, [projetoA]);
    const r = await como(USUARIO_A, async () => (await app.query('SELECT id FROM documentos')).rows);
    expect(r).toHaveLength(0);
    await db.query(`UPDATE portais SET mostra_documentos=true WHERE projeto_id=$1`, [projetoA]);
  });

  test('portal inativo corta todo o acesso', async () => {
    await db.query(`UPDATE portais SET ativo=false WHERE projeto_id=$1`, [projetoA]);
    const docs = await como(USUARIO_A, async () => (await app.query('SELECT id FROM documentos')).rows);
    const projs = await como(USUARIO_A, async () => (await app.query('SELECT id FROM projetos')).rows);
    expect(docs).toHaveLength(0);
    expect(projs).toHaveLength(0);
    await db.query(`UPDATE portais SET ativo=true WHERE projeto_id=$1`, [projetoA]);
  });
});

describe('isolamento entre dois clientes', () => {
  test('o cliente B não vê projeto nem documento do cliente A', async () => {
    const projs = await como(USUARIO_B, async () =>
      (await app.query<{nome:string}>('SELECT nome FROM projetos')).rows);
    expect(projs.map((p) => p.nome)).toEqual(['RJ Grupo B']);

    const docs = await como(USUARIO_B, async () => (await app.query('SELECT id FROM documentos')).rows);
    expect(docs).toHaveLength(0);
  });

  test('o cliente B não grava no projeto do cliente A', async () => {
    await expect(como(USUARIO_B, async () =>
      app.query(`INSERT INTO documentos (organizacao_id,projeto_id,titulo,caminho,origem)
        VALUES ($1,$2,'Intruso','/x/9','portal_cliente')`, [NGA, projetoA])))
      .rejects.toThrow(/row-level security/i);
  });
});

describe('o cliente envia, mas não publica', () => {
  test('envio pelo portal entra como interno e some da vista do cliente', async () => {
    // O id é gerado pela aplicação, não por RETURNING — ver o teste seguinte.
    const id = crypto.randomUUID();
    const r = await como(USUARIO_A, async () =>
      app.query(`INSERT INTO documentos
        (id,organizacao_id,projeto_id,titulo,caminho,origem,visibilidade,enviado_por)
        VALUES ($1,$2,$3,'Balanço 2025','/x/3','portal_cliente','interno',$4)`,
        [id, NGA, projetoA, USUARIO_A]));
    expect(r.rowCount).toBe(1);

    // A NGA recebeu.
    const naNGA = await como(ADVOGADO, async () =>
      (await app.query('SELECT titulo FROM documentos WHERE id=$1', [id])).rows);
    expect(naNGA[0]!.titulo).toBe('Balanço 2025');

    // O cliente não vê o que acabou de mandar: está interno, aguardando análise.
    const noCliente = await como(USUARIO_A, async () =>
      (await app.query('SELECT id FROM documentos WHERE id=$1', [id])).rows);
    expect(noCliente).toHaveLength(0);
  });

  test('RETURNING é recusado no envio do cliente — e isso é a garantia funcionando', async () => {
    // Com RETURNING, o PostgreSQL aplica a política de SELECT à linha devolvida.
    // Como documento interno não é visível ao cliente, o RETURNING falha.
    // Consequência prática: o código do portal gera o id antes de inserir.
    await expect(como(USUARIO_A, async () =>
      app.query(`INSERT INTO documentos
        (organizacao_id,projeto_id,titulo,caminho,origem,visibilidade,enviado_por)
        VALUES ($1,$2,'Com returning','/x/8','portal_cliente','interno',$3) RETURNING id`,
        [NGA, projetoA, USUARIO_A])))
      .rejects.toThrow(/row-level security/i);
  });

  test('o cliente não consegue inserir documento já publicado', async () => {
    await expect(como(USUARIO_A, async () =>
      app.query(`INSERT INTO documentos
        (organizacao_id,projeto_id,titulo,caminho,origem,visibilidade,publicado_por,publicado_em)
        VALUES ($1,$2,'Forjado','/x/4','portal_cliente','publicado',$3,now())`,
        [NGA, projetoA, USUARIO_A])))
      .rejects.toThrow(/row-level security/i);
  });

  test('publicar sem identificar quem publicou é barrado pelo banco', async () => {
    await expect(db.query(`INSERT INTO documentos (organizacao_id,projeto_id,titulo,caminho,visibilidade)
      VALUES ($1,$2,'Sem autor','/x/5','publicado')`, [NGA, projetoA]))
      .rejects.toThrow(/publicacao_identificada/);
  });
});

describe('mensagens', () => {
  test('o cliente não forja mensagem vinda da NGA', async () => {
    await expect(como(USUARIO_A, async () =>
      app.query(`INSERT INTO mensagens (organizacao_id,projeto_id,autor_id,lado,texto)
        VALUES ($1,$2,$3,'nga','Mensagem falsa da NGA')`, [NGA, projetoA, USUARIO_A])))
      .rejects.toThrow(/row-level security/i);
  });

  test('mas escreve do próprio lado', async () => {
    const r = await como(USUARIO_A, async () =>
      app.query(`INSERT INTO mensagens (organizacao_id,projeto_id,autor_id,lado,texto)
        VALUES ($1,$2,$3,'cliente','Segue o balanço solicitado.')`, [NGA, projetoA, USUARIO_A]));
    expect(r.rowCount).toBe(1);
  });
});

describe('requisitos: o cliente não aprova o próprio documento', () => {
  test('o banco exige identificação de quem analisou', async () => {
    const req = (await db.query<{id:string}>(`INSERT INTO requisitos
      (organizacao_id,projeto_id,categoria,titulo) VALUES ($1,$2,'Contábil','Balanço') RETURNING id`,
      [NGA, projetoA])).rows[0]!.id;

    await expect(db.query(`UPDATE requisitos SET situacao='aprovado' WHERE id=$1`, [req]))
      .rejects.toThrow(/analise_identificada/);
  });

  test('item enviado precisa ter documento anexado', async () => {
    const req = (await db.query<{id:string}>(`INSERT INTO requisitos
      (organizacao_id,projeto_id,categoria,titulo) VALUES ($1,$2,'Fiscal','Certidões') RETURNING id`,
      [NGA, projetoA])).rows[0]!.id;
    await expect(db.query(`UPDATE requisitos SET situacao='enviado' WHERE id=$1`, [req]))
      .rejects.toThrow(/envio_tem_documento/);
  });
});

describe('financeiro da recuperanda', () => {
  let conta: string;

  test('o cliente lança no próprio caixa', async () => {
    conta = await como(USUARIO_A, async () =>
      (await app.query<{id:string}>(`INSERT INTO contas_financeiras
        (organizacao_id,projeto_id,nome,saldo_inicial,data_inicial)
        VALUES ($1,$2,'Conta principal',10000000,'2026-11-01') RETURNING id`,
        [CLIENTE_A, projetoA])).rows[0]!.id);

    const r = await como(USUARIO_A, async () =>
      app.query(`INSERT INTO lancamentos (organizacao_id,projeto_id,conta_id,data,tipo,situacao,valor,categoria)
        VALUES ($1,$2,$3,'2026-11-10','receita','realizado',5000000,'Vendas')`,
        [CLIENTE_A, projetoA, conta]));
    expect(r.rowCount).toBe(1);
  });

  test('o cliente B não enxerga o caixa do cliente A', async () => {
    const r = await como(USUARIO_B, async () => (await app.query('SELECT id FROM lancamentos')).rows);
    expect(r).toHaveLength(0);
  });

  test('a NGA lê o caixa quando o portal autoriza', async () => {
    const r = await como(ADVOGADO, async () =>
      (await app.query<{valor:string}>('SELECT valor FROM lancamentos')).rows);
    expect(r).toHaveLength(1);
    expect(r[0]!.valor).toBe('5000000');
  });

  test('e deixa de ler quando o cliente revoga', async () => {
    await db.query(`UPDATE portais SET mostra_financeiro=false WHERE projeto_id=$1`, [projetoA]);
    const r = await como(ADVOGADO, async () => (await app.query('SELECT id FROM lancamentos')).rows);
    expect(r).toHaveLength(0);
    await db.query(`UPDATE portais SET mostra_financeiro=true WHERE projeto_id=$1`, [projetoA]);
  });

  test('o banco rejeita vínculo de lançamento com projeto ou conta alheios', async () => {
    const inserir = (projetoId: string, contaId?: string) => app.query(
      `INSERT INTO lancamentos (organizacao_id,projeto_id,conta_id,data,tipo,situacao,valor,categoria)
       VALUES ($1,$2,$3,'2026-11-20','despesa','previsto',100,'Teste')`, [CLIENTE_B, projetoId, contaId ?? null]);
    await expect(como(USUARIO_B, () => inserir(projetoA))).rejects.toThrow(/row-level security/i);
    await expect(como(USUARIO_B, () => inserir(projetoB, conta))).rejects.toThrow(/foreign key/i);
  });

  test('a NGA não lança no caixa do cliente', async () => {
    await expect(como(ADVOGADO, async () =>
      app.query(`INSERT INTO lancamentos (organizacao_id,projeto_id,data,tipo,situacao,valor,categoria)
        VALUES ($1,$2,'2026-11-20','despesa','previsto',100000,'Honorários')`, [CLIENTE_A, projetoA])))
      .rejects.toThrow(/row-level security/i);
  });

  test('valor negativo é barrado: o sinal vem do tipo', async () => {
    await expect(como(USUARIO_A, async () =>
      app.query(`INSERT INTO lancamentos (organizacao_id,projeto_id,data,tipo,situacao,valor,categoria)
        VALUES ($1,$2,'2026-11-20','despesa','previsto',-100,'Erro')`, [CLIENTE_A, projetoA])))
      .rejects.toThrow(/violates check constraint/i);
  });
});
