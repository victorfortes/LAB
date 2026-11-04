import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ArmazenamentoLocal } from '../src/store/arquivos.ts';
import { deposito as montarDeposito } from '../src/server/arquivos.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pg: BancoDeTeste; let banco: Banco;
let app: ReturnType<typeof criarApp>;
const NGA = '11111111-1111-1111-1111-111111111111';
const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const SENHA = 'uma-senha-bem-longa';
let projeto: string; let tCliente: string; let tSocio: string;

async function pdfCom(texto: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create(); const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const pg = doc.addPage(); texto.forEach((l, i) => pg.drawText(l, { x: 40, y: 780 - i * 18, size: 11, font: fonte }));
  return doc.save();
}
async function entrar(email: string, senha = SENHA): Promise<string> {
  const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) }));
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}
const req = (t: string, url: string, init: RequestInit = {}) =>
  app(new Request(`http://x${url}`, { ...init, headers: { ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }), cookie: `nga_sessao=${t}`, ...(init.headers ?? {}) } }));

beforeAll(async () => {
  pg = await bancoDeTeste();
  await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  const dir = await mkdtemp(join(tmpdir(), 'acervo-'));
  app = criarApp({ banco, deposito: montarDeposito(new ArmazenamentoLocal(dir), { NGA_SEGREDO_ARQUIVOS: 'x'.repeat(40) }), analiseAutomatica: true });
  await pg.dono.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  await pg.dono.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'socio@nga.adv.br','Sócio',$2)`, [SOCIO, await hashDaSenha(SENHA)]);
  await pg.dono.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'socio_administrador')`, [SOCIO, NGA]);
  tSocio = await entrar('socio@nga.adv.br');
  projeto = (await (await req(tSocio, '/api/projetos', { method: 'POST', body: JSON.stringify({ nome: 'RJ Teste', tipo: 'recuperacao_judicial' }) })).json()).id;
  await req(tSocio, `/api/projetos/${projeto}/checklist`, { method: 'POST', body: '{}' });
  const conv = await (await req(tSocio, `/api/projetos/${projeto}/portal/convites`, { method: 'POST', body: JSON.stringify({ nome: 'Diretora', email: 'dir@cliente.com.br', organizacao: 'Cliente SA' }) })).json();
  tCliente = await entrar('dir@cliente.com.br', conv.senhaTemporaria);
}, 120_000);
afterAll(async () => { await app.aguardarAnalises(); await banco?.encerrar(); await pg?.encerrar(); });

describe('cliente envia → análise automática → diagnóstico para o advogado', () => {
  test('PDF com texto é lido, classificado e aparece no diagnóstico; o cliente não vê o diagnóstico', async () => {
    const check = await (await req(tCliente, `/api/projetos/${projeto}/checklist`)).json();
    const item = check.itens.find((i: { categoria: string }) => i.categoria.startsWith('Contábil'));
    const bytes = await pdfCom([
      'BALANCO PATRIMONIAL EM 31/12/2025', 'INDUSTRIA DEMONSTRACAO LTDA. CNPJ 11.222.333/0001-81',
      'Ativo circulante R$ 1.250.000,00   Passivo circulante R$ 3.400.000,00', 'Demonstracao do resultado do exercicio e notas explicativas.',
    ]);
    const fd = new FormData(); fd.append('arquivo', new File([bytes as BlobPart], 'balanco.pdf', { type: 'application/pdf' }));
    fd.append('titulo', 'Balanço 2025'); fd.append('requisitoId', item.id);
    const env = await req(tCliente, `/api/projetos/${projeto}/documentos`, { method: 'POST', body: fd });
    expect(env.status).toBe(201);
    await app.aguardarAnalises();

    const d = await (await req(tSocio, `/api/projetos/${projeto}/diagnostico`)).json();
    const doc = d.documentos.find((x: { titulo: string }) => x.titulo === 'Balanço 2025');
    expect(doc.estado).toBe('analisado');
    expect(doc.tipo).not.toBeNull();
    expect(d.identificadores.some((i: { canonico: string }) => i.canonico === '11222333000181')).toBe(true);
    expect(d.cobertura.obrigatorios).toBeGreaterThan(0);
    expect(d.faltando.length).toBeGreaterThan(0);

    expect((await req(tCliente, `/api/projetos/${projeto}/diagnostico`)).status).toBe(403);
  });

  test('PDF só de imagem não vira análise inventada: fica "sem_texto" e o diagnóstico avisa', async () => {
    const vazio = await PDFDocument.create(); vazio.addPage();
    const fd = new FormData(); fd.append('arquivo', new File([await vazio.save() as BlobPart], 'escaneado.pdf', { type: 'application/pdf' })); fd.append('titulo', 'Escaneado');
    expect((await req(tCliente, `/api/projetos/${projeto}/documentos`, { method: 'POST', body: fd })).status).toBe(201);
    await app.aguardarAnalises();
    const d = await (await req(tSocio, `/api/projetos/${projeto}/diagnostico`)).json();
    expect(d.documentos.find((x: { titulo: string }) => x.titulo === 'Escaneado').estado).toBe('sem_texto');
    expect(d.pontos.some((p: { titulo: string }) => p.titulo.includes('sem texto legível'))).toBe(true);
  });
});
