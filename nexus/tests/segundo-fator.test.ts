import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp, escritaDeOutroSite, ipConfiavel } from '../src/server/app.ts';
import { hashDaSenha, hashDoToken, tokenNovo } from '../src/security/sessao.ts';
import { base32, codigoDoPasso, conferirCodigo, deBase32, passoAtual } from '../src/security/totp.ts';

describe('TOTP (RFC 6238)', () => {
  // Vetor oficial: segredo ASCII "12345678901234567890", T = 59 s → 94287082 (8 dígitos) → 287082 (6).
  const RFC = base32(new TextEncoder().encode('12345678901234567890'));
  test('base32 de ida e volta', () => {
    expect(RFC).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(new TextDecoder().decode(deBase32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'))).toBe('12345678901234567890');
  });
  test('confere com o vetor da RFC', () => {
    expect(codigoDoPasso(RFC, 1)).toBe('287082');
    expect(conferirCodigo(RFC, '287082', 59_000)).toBe(1);
  });
  test('aceita um passo de folga e recusa o resto', () => {
    expect(conferirCodigo(RFC, codigoDoPasso(RFC, 2), 59_000)).toBe(2);
    expect(conferirCodigo(RFC, codigoDoPasso(RFC, 3), 59_000)).toBeNull();
    expect(conferirCodigo(RFC, 'abc123', 59_000)).toBeNull();
  });
});

describe('IP do cliente e requisição de outro site', () => {
  const S = 'x'.repeat(40);
  const r = (h: Record<string, string>, metodo = 'POST') => new Request('https://api.exemplo/api/projetos', { method: metodo, headers: h });
  test('o IP só vale com o segredo do proxy', () => {
    expect(ipConfiavel(r({ 'x-nga-ip-cliente': '200.1.2.3', 'x-nga-proxy': S }), S)).toBe('200.1.2.3');
    expect(ipConfiavel(r({ 'x-nga-ip-cliente': '200.1.2.3', 'x-nga-proxy': 'errado' }), S)).toBeUndefined();
    expect(ipConfiavel(r({ 'x-nga-ip-cliente': '200.1.2.3', 'x-forwarded-for': '9.9.9.9' }), undefined)).toBeUndefined();
  });
  test('escrita de outra origem é recusada; a do próprio site passa', () => {
    const u = new URL('https://api.exemplo/api/projetos');
    expect(escritaDeOutroSite(r({ origin: 'https://evil.example' }), u)).not.toBeNull();
    expect(escritaDeOutroSite(r({ 'sec-fetch-site': 'cross-site' }), u)).not.toBeNull();
    expect(escritaDeOutroSite(r({ origin: 'null' }), u)).not.toBeNull();
    expect(escritaDeOutroSite(r({ origin: 'https://site.lovable.app', 'x-forwarded-host': 'site.lovable.app', 'content-type': 'application/json', cookie: 'nga_sessao=a' }), u)).toBeNull();
    expect(escritaDeOutroSite(r({ origin: 'https://evil.example' }, 'GET'), u)).toBeNull();
  });
  test('com a sessão, só JSON ou upload', () => {
    const u = new URL('https://api.exemplo/api/projetos');
    expect(escritaDeOutroSite(r({ cookie: 'nga_sessao=a', 'content-type': 'text/plain' }), u)).not.toBeNull();
    expect(escritaDeOutroSite(r({ cookie: 'nga_sessao=a', 'content-type': 'application/x-www-form-urlencoded' }), u)).not.toBeNull();
    expect(escritaDeOutroSite(r({ cookie: 'nga_sessao=a', 'content-type': 'multipart/form-data; boundary=x' }), u)).toBeNull();
    expect(escritaDeOutroSite(r({ cookie: 'nga_sessao=a' }, 'DELETE'), u)).toBeNull();
    expect(escritaDeOutroSite(r({ 'content-type': 'text/plain' }), u)).toBeNull(); // sem sessão não há o que forjar
  });
});

let pg: BancoDeTeste; let banco: Banco; let app: ReturnType<typeof criarApp>;
const NGA = '11111111-1111-1111-1111-111111111111';
const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001', ADV = 'aaaaaaaa-0000-4000-8000-000000000002';
const SENHA = 'uma-senha-bem-longa';
const req = (t: string, u: string, i: RequestInit = {}) => app(new Request(`http://x${u}`, { ...i, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}` } }));
const login = (email: string, senha: string, codigo?: string) => app(new Request('http://x/api/sessao', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(codigo ? { email, senha, codigo } : { email, senha }) }));
const tok = (r: Response) => /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
let chave = '';

beforeAll(async () => {
  pg = await bancoDeTeste(); await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  app = criarApp({ banco, exigirMfa: true, segredoCofre: 'chave-do-cofre-de-teste-com-tamanho' });
  await pg.dono.query(`INSERT INTO organizacoes(id,tipo,nome) VALUES($1,'escritorio','NGA')`, [NGA]);
  for (const [id, email, papel] of [[SOCIO, 'socio@nga.adv.br', 'socio_administrador'], [ADV, 'adv@nga.adv.br', 'advogado']] as const) {
    await pg.dono.query(`INSERT INTO usuarios(id,email,nome,senha_hash) VALUES($1,$2,'Pessoa',$3)`, [id, email, await hashDaSenha(SENHA)]);
    await pg.dono.query(`INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES($1,$2,$3)`, [id, NGA, papel]);
  }
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

describe('segundo fator obrigatório para quem administra', () => {
  test('sem o fator ativo, o administrador só consegue ativá-lo', async () => {
    const t = tok(await login('socio@nga.adv.br', SENHA));
    const barrado = await req(t, '/api/projetos');
    expect(barrado.status).toBe(403);
    expect((await barrado.json()).detalhe).toEqual({ mfa: 'ativar' });
    expect((await (await req(t, '/api/eu')).json()).deveAtivarMfa).toBe(true);

    const p = await (await req(t, '/api/mfa/preparar', { method: 'POST', body: '{}' })).json();
    chave = p.chave.replaceAll(' ', ''); expect(p.endereco).toStartWith('otpauth://totp/');
    expect((await req(t, '/api/mfa/ativar', { method: 'POST', body: JSON.stringify({ codigo: '000000' === codigoDoPasso(chave, passoAtual()) ? '111111' : '000000' }) })).status).toBe(401);
    expect((await req(t, '/api/mfa/ativar', { method: 'POST', body: JSON.stringify({ codigo: codigoDoPasso(chave, passoAtual()) }) })).status).toBe(200);
    expect((await req(t, '/api/projetos')).status).toBe(200);
    // O banco guarda a chave cifrada, nunca em claro.
    const { rows } = await pg.dono.query('SELECT mfa_segredo FROM usuarios WHERE id=$1', [SOCIO]);
    expect(rows[0].mfa_segredo).toStartWith('v1:'); expect(rows[0].mfa_segredo).not.toContain(chave);
  });
  test('com o fator ativo, a senha sozinha não entra e o código não se repete', async () => {
    const semCodigo = await login('socio@nga.adv.br', SENHA);
    expect(semCodigo.status).toBe(401); expect((await semCodigo.json()).detalhe).toEqual({ mfa: true });
    expect((await login('socio@nga.adv.br', SENHA, '123456')).status).toBe(401);
    // O código do passo atual já foi usado na ativação: repetir é recusado.
    expect((await login('socio@nga.adv.br', SENHA, codigoDoPasso(chave, passoAtual()))).status).toBe(401);
    const ok = await login('socio@nga.adv.br', SENHA, codigoDoPasso(chave, passoAtual() + 1));
    expect(ok.status).toBe(200);
    expect((await req(tok(ok), '/api/projetos')).status).toBe(200);
    // Senha errada com código certo continua errada.
    expect((await login('socio@nga.adv.br', 'senha-errada-longa', codigoDoPasso(chave, passoAtual() + 1))).status).toBe(401);
  });
  test('quem não administra não é obrigado', async () => {
    const t = tok(await login('adv@nga.adv.br', SENHA));
    expect((await (await req(t, '/api/eu')).json()).deveAtivarMfa).toBe(false);
    expect((await req(t, '/api/projetos')).status).toBe(200);
  });
  test('o link de senha da administração zera o fator (celular perdido)', async () => {
    const token = tokenNovo();
    await pg.dono.query(`INSERT INTO equipe_redefinicoes(token_hash,usuario_id,organizacao_id,criado_por,expira_em) VALUES($1,$2,$3,$2,now()+interval '30 minutes')`, [hashDoToken(token), SOCIO, NGA]);
    const r = await app(new Request('http://x/api/equipe/definir-senha', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, senha: 'outra-senha-bem-longa' }) }));
    expect(r.status).toBe(200);
    const { rows } = await pg.dono.query('SELECT mfa_segredo, mfa_ativado_em FROM usuarios WHERE id=$1', [SOCIO]);
    expect(rows[0].mfa_segredo).toBeNull(); expect(rows[0].mfa_ativado_em).toBeNull();
    const t = tok(await login('socio@nga.adv.br', 'outra-senha-bem-longa'));
    expect((await (await req(t, '/api/eu')).json()).deveAtivarMfa).toBe(true);
  });
  test('formulário de outro site não escreve, mesmo com a sessão', async () => {
    const t = tok(await login('adv@nga.adv.br', SENHA));
    const r = await app(new Request('http://x/api/projetos', { method: 'POST', headers: { 'content-type': 'text/plain', cookie: `nga_sessao=${t}` }, body: '{"nome":"forjado","tipo":"recuperacao_judicial"}' }));
    expect(r.status).toBe(403);
  });
});
