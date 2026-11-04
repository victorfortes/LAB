import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { PLAYBOOKS, passosDa } from '../src/domain/projeto/playbooks.ts';
import { fasesDe, type TipoDeProjeto } from '../src/domain/projeto/fases.ts';

let pg: BancoDeTeste; let banco: Banco; let app: ReturnType<typeof criarApp>; let t: string;
const NGA = '11111111-1111-1111-1111-111111111111'; const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001'; const SENHA = 'uma-senha-bem-longa';
const req = (url: string, init: RequestInit = {}) => app(new Request(`http://x${url}`, { ...init, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}` } }));

beforeAll(async () => {
  pg = await bancoDeTeste(); await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' }); app = criarApp({ banco });
  await pg.dono.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  await pg.dono.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'s@nga.adv.br','Sócio',$2)`, [SOCIO, await hashDaSenha(SENHA)]);
  await pg.dono.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'socio_administrador')`, [SOCIO, NGA]);
  const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 's@nga.adv.br', senha: SENHA }) }));
  t = /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}, 120_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

describe('modelo do playbook', () => {
  test('todo passo pertence a "abertura" ou a uma fase que EXISTE no procedimento, com id único', () => {
    for (const [tipo, passos] of Object.entries(PLAYBOOKS)) {
      const fases = new Set(fasesDe(tipo as TipoDeProjeto).map((f) => f.id));
      for (const p of passos) expect(p.fase === 'abertura' || fases.has(p.fase), `${tipo}: ${p.id} → fase ${p.fase}`).toBe(true);
      expect(new Set(passos.map((p) => p.id)).size, tipo).toBe(passos.length);
    }
  });
  test('na abertura entram os passos de abertura + os da primeira fase', () => {
    expect(passosDa('recuperacao_judicial', 'preparacao', true).some((p) => p.id === 'abertura.kickoff')).toBe(true);
    expect(passosDa('recuperacao_judicial', 'assembleia').every((p) => p.fase === 'assembleia')).toBe(true);
  });
});

describe('playbook pela API', () => {
  test('projeto novo nasce com as tarefas da abertura e da primeira fase', async () => {
    const r = await (await req('/api/projetos', { method: 'POST', body: JSON.stringify({ nome: 'RJ Nova', tipo: 'recuperacao_judicial' }) })).json();
    expect(r.playbook.criadas).toBe(passosDa('recuperacao_judicial', 'preparacao', true).length);
    const tar = await (await req(`/api/tarefas?projeto=${r.id}`)).json();
    expect(tar.tarefas.length).toBe(r.playbook.criadas);
    expect(tar.tarefas.every((x: { origem: string; responsavelId: string; prazo: string }) => x.origem === 'playbook' && x.responsavelId === SOCIO && !!x.prazo)).toBe(true);
  });

  test('aplicar de novo não duplica; entrar numa fase traz só as tarefas dela', async () => {
    const r = await (await req('/api/projetos', { method: 'POST', body: JSON.stringify({ nome: 'RJ Dois', tipo: 'recuperacao_judicial' }) })).json();
    const de = await (await req(`/api/projetos/${r.id}/playbook`, { method: 'POST', body: '{}' })).json();
    expect(de.criadas).toBe(0); expect(de.jaExistiam).toBeGreaterThan(0);
    const antes = (await (await req(`/api/tarefas?projeto=${r.id}`)).json()).tarefas.length;
    const f = await (await req(`/api/projetos/${r.id}/fase`, { method: 'POST', body: JSON.stringify({ fase: 'distribuido' }) })).json();
    expect(f.playbook.criadas).toBe(passosDa('recuperacao_judicial', 'distribuido').length);
    expect((await (await req(`/api/tarefas?projeto=${r.id}`)).json()).tarefas.length).toBe(antes + f.playbook.criadas);
    // voltar e avançar de novo não recria
    await req(`/api/projetos/${r.id}/fase`, { method: 'POST', body: JSON.stringify({ fase: 'preparacao' }) });
    const f2 = await (await req(`/api/projetos/${r.id}/fase`, { method: 'POST', body: JSON.stringify({ fase: 'distribuido' }) })).json();
    expect(f2.playbook.criadas).toBe(0);
  });
});
