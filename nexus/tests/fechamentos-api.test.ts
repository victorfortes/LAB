/** Fechamento financeiro mensal: o cliente informa pelo portal, a NGA lê e confere. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

let pg: BancoDeTeste; let banco: Banco; let tratar: (req: Request) => Promise<Response>;
const NGA = '11111111-1111-1111-1111-111111111111', CLI = '22222222-2222-2222-2222-222222222222', OUTRA = '33333333-3333-3333-3333-333333333333';
const SENHA = 'uma-senha-bem-longa';
let projeto: string;

beforeAll(async () => {
  pg = await bancoDeTeste(); const db = pg.dono;
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  tratar = criarApp({ banco });
  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','Grupo X'),($3,'cliente','Grupo Y')`, [NGA, CLI, OUTRA]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES (gen_random_uuid(),'adv@nga.adv.br','Advogada',$1),(gen_random_uuid(),'dir@x.com','Diretora X',$1),(gen_random_uuid(),'dir@y.com','Diretor Y',$1)`, [h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) SELECT id,$1,'advogado' FROM usuarios WHERE email='adv@nga.adv.br'`, [NGA]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) SELECT id,$1,'cliente_administrador' FROM usuarios WHERE email='dir@x.com'`, [CLI]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) SELECT id,$1,'cliente_administrador' FROM usuarios WHERE email='dir@y.com'`, [OUTRA]);
  projeto = (await db.query<{ id: string }>(`INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'RJ X','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  const outro = (await db.query<{ id: string }>(`INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'RJ Y','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  await db.query(`INSERT INTO portais (projeto_id,organizacao_cliente_id) VALUES ($1,$2),($3,$4)`, [projeto, CLI, outro, OUTRA]);
}, 120_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

async function entrar(email: string) {
  const r = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha: SENHA }) }));
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}
const req = (t: string, url: string, init: RequestInit = {}) => tratar(new Request(`http://x${url}`, { ...init, headers: { cookie: `nga_sessao=${t}`, 'content-type': 'application/json' } }));
const mes = (competencia: string, faturamento: string, extra: Record<string, string | null> = {}) => JSON.stringify({ competencia, faturamento, custos: '50000000', folha: '20000000', despesas: '10000000', financeiras: '2000000', caixa: '30000000', ...extra });

describe('fechamento mensal', () => {
  test('o cliente informa o mês pelo portal', async () => {
    const t = await entrar('dir@x.com');
    expect((await req(t, `/api/projetos/${projeto}/fechamentos`, { method: 'PUT', body: mes('2026-09', '100000000') })).status).toBe(200);
    expect((await req(t, `/api/projetos/${projeto}/fechamentos`, { method: 'PUT', body: mes('2026-10', '60000000') })).status).toBe(200);
  });

  test('a NGA vê os indicadores e o alerta de queda', async () => {
    const t = await entrar('adv@nga.adv.br');
    const d = await (await req(t, `/api/projetos/${projeto}/fechamentos`)).json();
    expect(d.meses.map((m: { competencia: string }) => m.competencia)).toEqual(['2026-09', '2026-10']);
    expect(d.serie[1].variacaoFaturamento).toBe(-40);
    expect(d.alertas.some((a: { texto: string }) => a.texto.includes('caiu 40%'))).toBe(true);
    expect(d.situacao).toBe('critica');
  });

  test('outro cliente não enxerga nem grava', async () => {
    const t = await entrar('dir@y.com');
    const d = await (await req(t, `/api/projetos/${projeto}/fechamentos`)).json();
    expect(d.meses ?? []).toHaveLength(0);
    expect((await req(t, `/api/projetos/${projeto}/fechamentos`, { method: 'PUT', body: mes('2026-11', '1') })).status).not.toBe(200);
  });

  test('depois de conferido, o cliente não altera mais o mês', async () => {
    const adv = await entrar('adv@nga.adv.br');
    expect((await req(adv, `/api/projetos/${projeto}/fechamentos/2026-09/conferir`, { method: 'POST' })).status).toBe(200);
    const t = await entrar('dir@x.com');
    const r = await req(t, `/api/projetos/${projeto}/fechamentos`, { method: 'PUT', body: mes('2026-09', '999') });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('conferido');
  });
});
