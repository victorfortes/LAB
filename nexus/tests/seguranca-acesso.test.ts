import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { CSP } from '../src/server/cabecalhos.ts';
import { reconhecerTipo } from '../src/store/tipos-de-arquivo.ts';
import { montarZip } from './apoio/zip.ts';

let pg: BancoDeTeste; let banco: Banco; let app: ReturnType<typeof criarApp>; let appTroca: ReturnType<typeof criarApp>;
let socio = ''; let cliente = ''; let id = ''; let temporaria = '';
const NGA = '11111111-1111-1111-1111-111111111111', S = 'aaaaaaaa-0000-4000-8000-000000000001', SENHA = 'uma-senha-bem-longa';
const req = (t: string, u: string, i: RequestInit = {}, a = app) => a(new Request(`http://x${u}`, { ...i, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}` } }));
const login = (e: string, s: string, a = app) => a(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, senha: s }) }));
const tok = (r: Response) => /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';

beforeAll(async () => {
  pg = await bancoDeTeste(); await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  app = criarApp({ banco }); appTroca = criarApp({ banco, exigirTrocaDeSenha: true });
  await pg.dono.query(`INSERT INTO organizacoes(id,tipo,nome) VALUES($1,'escritorio','NGA')`, [NGA]);
  await pg.dono.query(`INSERT INTO usuarios(id,email,nome,senha_hash) VALUES($1,'socio@nga.adv.br','Socio',$2)`, [S, await hashDaSenha(SENHA)]);
  await pg.dono.query(`INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES($1,$2,'socio_administrador')`, [S, NGA]);
  socio = tok(await login('socio@nga.adv.br', SENHA));
  id = (await (await req(socio, '/api/projetos', { method: 'POST', body: JSON.stringify({ nome: 'Caso', tipo: 'recuperacao_judicial', resumo: 'ESTRATEGIA-SIGILOSA' }) })).json()).id;
  const c = await (await req(socio, `/api/projetos/${id}/portal/convites`, { method: 'POST', body: JSON.stringify({ nome: 'Dir', email: 'c@c.com.br', organizacao: 'Empresa C' }) })).json();
  temporaria = c.senhaTemporaria; cliente = tok(await login('c@c.com.br', temporaria));
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

describe('fronteira do portal', () => {
  test('o resumo interno do caso não chega ao cliente', async () => {
    expect(await (await req(cliente, '/api/projetos')).text()).not.toContain('ESTRATEGIA-SIGILOSA');
    const corpo = await (await req(cliente, `/api/projetos/${id}`)).text();
    expect(corpo).not.toContain('ESTRATEGIA-SIGILOSA'); expect(corpo).not.toContain('socio@nga.adv.br');
    expect(JSON.parse(corpo).fase).toBeDefined();
  });
  test('rotas internas respondem 403 ao cliente', async () => {
    for (const r of ['/api/escritorio/equipe', '/api/google/eventos', '/api/arquivos/estado']) expect((await req(cliente, r)).status).toBe(403);
  });
  test('a visão do cliente traz só marco publicado', async () => {
    await req(socio, `/api/projetos/${id}/marcos`, { method: 'POST', body: JSON.stringify({ titulo: 'interno-x', visivelCliente: false }) });
    const v = await (await req(cliente, `/api/projetos/${id}/visao`)).json();
    expect(JSON.stringify(v)).not.toContain('interno-x'); expect(v.atividades).toEqual([]);
  });
});

describe('senha', () => {
  test('senha temporária só serve para escolher a definitiva', async () => {
    expect((await req(cliente, `/api/projetos/${id}/checklist`, {}, appTroca)).status).toBe(403);
    const eu = await (await req(cliente, '/api/eu', {}, appTroca)).json(); expect(eu.deveTrocarSenha).toBe(true);
    expect((await req(cliente, '/api/senha', { method: 'POST', body: JSON.stringify({ atual: 'errada-errada', nova: 'nova-senha-do-cliente' }) }, appTroca)).status).toBe(401);
    expect((await req(cliente, '/api/senha', { method: 'POST', body: JSON.stringify({ atual: temporaria, nova: 'nova-senha-do-cliente' }) }, appTroca)).status).toBe(200);
    expect((await req(cliente, `/api/projetos/${id}/checklist`, {}, appTroca)).status).toBe(200);
    expect((await login('c@c.com.br', temporaria)).status).toBe(401);
  });
  test('força bruta é barrada, inclusive para e-mail que não existe, e o registro persiste', async () => {
    for (let i = 0; i < 8; i++) expect((await login('alvo@nga.adv.br', `errada-numero-${i}`)).status).toBe(401);
    expect((await login('alvo@nga.adv.br', 'mais-uma-tentativa')).status).toBe(429);
  });
  test('o bloqueio não derruba outra conta', async () => {
    expect((await login('socio@nga.adv.br', SENHA)).status).toBe(200);
  });
});

describe('arquivos', () => {
  const zip = (...n: string[]) => montarZip(n.map((nome) => ({ nome, conteudo: 'x' })));
  test('Excel gerado por biblioteca, sem [Content_Types] na frente, é aceito', () => {
    expect(reconhecerTipo(zip('xl/workbook.xml', '[Content_Types].xml'), 'relatorio.xlsx').extensao).toBe('xlsx');
  });
  test('o conteúdo decide entre Word e Excel, não o nome', () => {
    expect(reconhecerTipo(zip('[Content_Types].xml', 'word/document.xml'), 'x.xlsx').extensao).toBe('docx');
  });
  test('macro é recusada, mesmo renomeada para .xlsx', () => {
    expect(() => reconhecerTipo(zip('[Content_Types].xml', 'xl/workbook.xml', 'xl/vbaProject.bin'), 'a.xlsx')).toThrow('macro');
  });
  test('PDF com script é recusado, inclusive com nome ofuscado', () => {
    const pdf = (s: string) => new TextEncoder().encode(`%PDF-1.7\n1 0 obj<<${s}>>endobj`);
    expect(() => reconhecerTipo(pdf('/OpenAction<</S/JavaScript/JS(app.alert(1))>>'), 'a.pdf')).toThrow('script');
    expect(() => reconhecerTipo(pdf('/S/J#61vaScript'), 'a.pdf')).toThrow('script');
    expect(reconhecerTipo(pdf('/Type/Catalog'), 'a.pdf').extensao).toBe('pdf');
  });
  test('o CSP não admite script inline nem de terceiros', () => {
    const s = CSP.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(s).toBe("script-src 'self'");
  });
});
