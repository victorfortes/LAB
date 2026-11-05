import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { migrar } from '../src/db/migrar.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ArmazenamentoLocal } from '../src/store/arquivos.ts';
import { deposito as montarDeposito } from '../src/server/arquivos.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Cenário real: o LAB no schema `nga_lab` e o Gerador em `public.documentos` (mesma forma da tabela dele), no MESMO
 * banco — como no Supabase. Só com os dois convivendo dá para provar que as funções de leitura cruzam o limite certo.
 */
const PORTA = 54900 + Math.floor(Math.random() * 90);
let pgx: EmbeddedPostgres; let dirpg: string; let dono: Client; let banco: Banco; let app: ReturnType<typeof criarApp>;
const NGA = '11111111-1111-1111-1111-111111111111'; const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001'; const SENHA = 'uma-senha-bem-longa';
let tS: string; let tCli: string; let projA: string; let projB: string; let pdfBytes: Buffer;
const req = (t: string, url: string, init: RequestInit = {}) => app(new Request(`http://x${url}`, { ...init, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}` } }));
const entrar = async (e: string, s: string) => { const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, senha: s }) })); return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!; };

beforeAll(async () => {
  dirpg = await mkdtemp(join(tmpdir(), 'nga-pg-ger-'));
  pgx = new EmbeddedPostgres({ databaseDir: dirpg, user: 'nga', password: 'nga', port: PORTA, persistent: false });
  await pgx.initialise(); await pgx.start(); await pgx.createDatabase('compartilhado');
  dono = new Client({ host: 'localhost', port: PORTA, user: 'nga', password: 'nga', database: 'compartilhado' }); await dono.connect();
  const d = dono;
  await migrar(d, undefined, 'nga_lab');
  await d.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`); await d.query(`ALTER ROLE nga_app SET search_path = nga_lab, public`); await d.query(`GRANT USAGE ON SCHEMA nga_lab TO nga_app`);
  await d.query(`CREATE TABLE public.documentos (colecao text NOT NULL, id text NOT NULL, dados jsonb NOT NULL DEFAULT '{}', removido boolean NOT NULL DEFAULT false, PRIMARY KEY (colecao, id))`);
  const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica); doc.addPage().drawText('Relatório de acompanhamento — Empresa Exemplo', { x: 40, y: 700, size: 14, font: f });
  pdfBytes = Buffer.from(await doc.save());
  const meio = Math.floor(pdfBytes.length / 2);                 // duas partes: a remontagem precisa juntar na ordem
  const ins = (colecao: string, id: string, dados: object, removido = false) => d.query(`INSERT INTO public.documentos (colecao,id,dados,removido) VALUES ($1,$2,$3,$4)`, [colecao, id, JSON.stringify(dados), removido]);
  await ins('emissoes', 'em_ok', { id: 'em_ok', nome: 'relatorio_exemplo.pdf', cliente: 'Empresa Exemplo Ltda', clienteId: 'c1', modelo: 'executivo', periodo: '2026-10', paginas: 1, tamanho: pdfBytes.length, partes: 2, gerado_em: '2026-10-30T19:05:36Z', status: 'gerado', por: { email: 'x@y.com' } });
  await ins('pdfs', 'em_ok__1', { n: 1, emissao: 'em_ok', total: 2, dados: pdfBytes.subarray(meio).toString('base64') });
  await ins('pdfs', 'em_ok__0', { n: 0, emissao: 'em_ok', total: 2, dados: pdfBytes.subarray(0, meio).toString('base64') });
  await ins('emissoes', 'em_trunc', { id: 'em_trunc', nome: 'truncado.pdf', cliente: 'Outra', periodo: '2026-09', tamanho: pdfBytes.length + 999, partes: 1, gerado_em: '2026-10-01T00:00:00Z', status: 'gerado' });
  await ins('pdfs', 'em_trunc__0', { n: 0, emissao: 'em_trunc', total: 1, dados: pdfBytes.toString('base64') });
  await ins('emissoes', 'em_removida', { id: 'em_removida', nome: 'removida.pdf', status: 'gerado' }, true);
  await ins('clientes', 'cli1', { nome: 'DADO SENSÍVEL DE CLIENTE' });

  banco = new Banco({ host: 'localhost', port: PORTA, user: 'nga_app', password: 'nga_app', database: 'compartilhado' });
  app = criarApp({ banco, deposito: montarDeposito(new ArmazenamentoLocal(await mkdtemp(join(tmpdir(), 'acervo-'))), { NGA_SEGREDO_ARQUIVOS: 'x'.repeat(40) }) });
  await d.query(`INSERT INTO nga_lab.organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  await d.query(`INSERT INTO nga_lab.usuarios (id,email,nome,senha_hash) VALUES ($1,'s@nga.adv.br','Sócio',$2)`, [SOCIO, await hashDaSenha(SENHA)]);
  await d.query(`INSERT INTO nga_lab.vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'socio_administrador')`, [SOCIO, NGA]);
  tS = await entrar('s@nga.adv.br', SENHA);
  projA = (await (await req(tS, '/api/projetos', { method: 'POST', body: JSON.stringify({ nome: 'Caso A', tipo: 'recuperacao_judicial', semPlaybook: true }) })).json()).id;
  projB = (await (await req(tS, '/api/projetos', { method: 'POST', body: JSON.stringify({ nome: 'Caso B', tipo: 'recuperacao_judicial', semPlaybook: true }) })).json()).id;
  const c = await (await req(tS, `/api/projetos/${projA}/portal/convites`, { method: 'POST', body: JSON.stringify({ nome: 'Dir', email: 'd@c.com', organizacao: 'Cliente A' }) })).json();
  tCli = await entrar('d@c.com', c.senhaTemporaria);
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await dono?.end(); await pgx?.stop(); await rm(dirpg, { recursive: true, force: true }); });

describe('Gerador de Relatórios integrado ao projeto', () => {
  test('lista só emissões válidas (não removidas), sem expor outras coleções', async () => {
    const r = await (await req(tS, `/api/projetos/${projA}/gerador/emissoes`)).json();
    expect(r.emissoes.map((e: { id: string }) => e.id).sort()).toEqual(['em_ok', 'em_trunc']);
    expect(JSON.stringify(r)).not.toContain('SENSÍVEL');
    expect(r.emissoes.find((e: { id: string }) => e.id === 'em_ok')).toMatchObject({ cliente: 'Empresa Exemplo Ltda', periodo: '2026-10', modelo: 'executivo', documentoId: null });
  });

  test('importa: remonta as partes na ordem, guarda como documento INTERNO do projeto e não duplica', async () => {
    const r = await req(tS, `/api/projetos/${projA}/gerador/importacoes`, { method: 'POST', body: JSON.stringify({ emissaoId: 'em_ok' }) });
    expect(r.status).toBe(201); const { documentoId, publicado } = await r.json(); expect(publicado).toBe(false);
    const docs = await (await req(tS, `/api/projetos/${projA}/documentos`)).json();
    const d = docs.find((x: { id: string }) => x.id === documentoId);
    expect(d).toMatchObject({ categoria: 'relatorio_gerador', visibilidade: 'interno' });
    expect(Number(d.tamanho_bytes)).toBe(pdfBytes.length);
    const link = await (await req(tS, `/api/documentos/${documentoId}/link`, { method: 'POST', body: '{}' })).json();
    const baixado = Buffer.from(await (await app(new Request(`http://x${link.url}`))).arrayBuffer());
    expect(baixado.equals(pdfBytes)).toBe(true);                       // idêntico, byte a byte
    expect((await req(tS, `/api/projetos/${projA}/gerador/importacoes`, { method: 'POST', body: JSON.stringify({ emissaoId: 'em_ok' }) })).status).toBe(400);
    const lista = await (await req(tS, `/api/projetos/${projA}/gerador/emissoes`)).json();
    expect(lista.emissoes.find((e: { id: string }) => e.id === 'em_ok').documentoId).toBe(documentoId);
  });

  test('o que foi importado no projeto A NÃO aparece no projeto B', async () => {
    expect((await (await req(tS, `/api/projetos/${projB}/documentos`)).json())).toEqual([]);
    const lista = await (await req(tS, `/api/projetos/${projB}/gerador/emissoes`)).json();
    expect(lista.emissoes.find((e: { id: string }) => e.id === 'em_ok').documentoId).toBeNull();
  });

  test('PDF com tamanho diferente do declarado não entra (truncado ou corrompido)', async () => {
    const r = await req(tS, `/api/projetos/${projB}/gerador/importacoes`, { method: 'POST', body: JSON.stringify({ emissaoId: 'em_trunc' }) });
    expect(r.status).toBe(400); expect((await r.json()).erro).toContain('tamanho');
    expect((await req(tS, `/api/projetos/${projB}/gerador/importacoes`, { method: 'POST', body: JSON.stringify({ emissaoId: 'em_removida' }) })).status).toBe(404);
  });

  test('importar e publicar numa só ação; o cliente do projeto passa a ver, e só ele', async () => {
    const r = await req(tS, `/api/projetos/${projB}/gerador/importacoes`, { method: 'POST', body: JSON.stringify({ emissaoId: 'em_ok', publicar: true }) });
    expect(r.status).toBe(201); expect((await r.json()).publicado).toBe(true);
    expect((await (await req(tS, `/api/projetos/${projB}/documentos`)).json()).filter((d: { visibilidade: string }) => d.visibilidade === 'publicado')).toHaveLength(1);
    // o cliente A (projeto A) não ganhou nada do projeto B
    expect((await (await req(tCli, `/api/projetos/${projA}/documentos`)).json())).toEqual([]);
  });

  test('o cliente não alcança a integração', async () => {
    expect((await req(tCli, `/api/projetos/${projA}/gerador/emissoes`)).status).toBe(403);
    expect((await req(tCli, `/api/projetos/${projA}/gerador/importacoes`, { method: 'POST', body: JSON.stringify({ emissaoId: 'em_ok' }) })).status).toBe(403);
  });
});
