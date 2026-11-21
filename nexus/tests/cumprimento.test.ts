/**
 * Cumprimento de tarefa: juntar a peça pelo LAB, concluir e resumir — com a
 * honestidade do §22 no resumo (sem chave de IA, "pendente"; com chave, preenche
 * sozinho).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { reprocessarResumosPendentes } from '../src/server/cumprimento.ts';
import { ProvedorAusente, type Provedor } from '../src/ai/provedor.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ArmazenamentoLocal } from '../src/store/arquivos.ts';
import { deposito as montarDeposito } from '../src/server/arquivos.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pg: BancoDeTeste; let banco: Banco;
let app: ReturnType<typeof criarApp>;
let dep: ReturnType<typeof montarDeposito>;
const NGA = '11111111-1111-1111-1111-111111111111';
const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const SENHA = 'uma-senha-bem-longa';
const NUMERO = '0000001-23.2024.8.26.0100';
let projeto: string; let processoId: string; let tarefaId: string; let tSocio: string;

async function entrar(email: string, senha = SENHA): Promise<string> {
  const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) }));
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}
const req = (t: string, url: string, init: RequestInit = {}) =>
  app(new Request(`http://x${url}`, { ...init, headers: { ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }), cookie: `nga_sessao=${t}`, ...(init.headers ?? {}) } }));

const resumoFake = 'Contestação tempestiva: arguida a prescrição e impugnado o valor da causa.';
const provedorFake: Provedor = {
  nome: 'fake', disponivel: true, impedimento: null,
  async analisar() { return { resposta: { resumo: resumoFake, achados: [], suspeitas_de_injecao: [] }, modelo: 'fake-modelo', tokensEntrada: 10, tokensSaida: 20 }; },
};

beforeAll(async () => {
  pg = await bancoDeTeste();
  await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  const dir = await mkdtemp(join(tmpdir(), 'acervo-'));
  dep = montarDeposito(new ArmazenamentoLocal(dir), { NGA_SEGREDO_ARQUIVOS: 'x'.repeat(40) });
  app = criarApp({ banco, provedor: new ProvedorAusente('teste de cumprimento: sem chave, resumo pendente'), deposito: dep, analiseAutomatica: true });
  await pg.dono.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  await pg.dono.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'socio@nga.adv.br','Sócio',$2)`, [SOCIO, await hashDaSenha(SENHA)]);
  await pg.dono.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'socio_administrador')`, [SOCIO, NGA]);
  tSocio = await entrar('socio@nga.adv.br');
  projeto = (await (await req(tSocio, '/api/projetos', { method: 'POST', body: JSON.stringify({ nome: 'RJ Teste', tipo: 'recuperacao_judicial' }) })).json()).id;

  // Processo + prazo + tarefa de cumprimento (vindos do controle de prazos).
  const pr = await pg.dono.query<{ id: string }>(`INSERT INTO processos (organizacao_id,projeto_id,numero) VALUES ($1,$2,$3) RETURNING id`, [NGA, projeto, NUMERO]);
  processoId = pr.rows[0]!.id;
  const prazo = await pg.dono.query<{ id: string }>(
    `INSERT INTO prazos (processo_id,organizacao_id,titulo,evento,origem,dias,regime,vencimento,calculo,criado_por)
     VALUES ($1,$2,'Contestar','2024-02-01','disponibilizacao_dje',15,'uteis','2024-02-22','{}'::jsonb,$3) RETURNING id`, [processoId, NGA, SOCIO]);
  const tar = await pg.dono.query<{ id: string }>(
    `INSERT INTO tarefas (organizacao_id,projeto_id,titulo,status,prioridade,origem,origem_id,criado_por)
     VALUES ($1,$2,'Protocolar contestação','a_fazer','alta','prazo',$3,$4) RETURNING id`, [NGA, projeto, prazo.rows[0]!.id, SOCIO]);
  tarefaId = tar.rows[0]!.id;
}, 120_000);
afterAll(async () => { await app.aguardarAnalises(); await banco?.encerrar(); await pg?.encerrar(); });

async function subirPeca(titulo: string): Promise<string> {
  const fd = new FormData();
  fd.append('arquivo', new File(['CONTESTACAO\n\nExcelentissimo Senhor Doutor Juiz. A re apresenta contestacao arguindo a prescricao e impugnando o valor da causa.'], `${titulo}.txt`, { type: 'text/plain' }));
  fd.append('titulo', titulo);
  const r = await req(tSocio, `/api/projetos/${projeto}/documentos`, { method: 'POST', body: fd });
  expect(r.status).toBe(201);
  await app.aguardarAnalises();
  return (await r.json()).documentoId as string;
}

describe('cumprir tarefa: peça + conclusão + resumo honesto', () => {
  test('sem IA, o resumo nasce pendente com motivo, a tarefa conclui e a peça vira andamento', async () => {
    const doc = await subirPeca('Contestação');
    const r = await req(tSocio, `/api/tarefas/${tarefaId}/cumprir`, { method: 'POST', body: JSON.stringify({ documentoId: doc }) });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.estado).toBe('pendente');
    expect(body.resumo).toBeNull();
    expect(body.motivo).toBeTruthy();
    expect(body.processo).toBe(NUMERO);

    // A tarefa foi concluída.
    const t = (await pg.dono.query('SELECT status FROM tarefas WHERE id=$1', [tarefaId])).rows[0];
    expect(t.status).toBe('concluida');

    // O andamento (movimentação manual) existe com o aviso de pendência.
    const mov = (await pg.dono.query('SELECT titulo,conteudo FROM movimentacoes WHERE processo_id=$1 AND fonte=$2', [processoId, 'manual'])).rows[0];
    expect(mov.titulo).toContain('Peça juntada');
    expect(mov.conteudo).toContain('pendente');
    expect(mov.conteudo).not.toContain(resumoFake);

    // E o registro de cumprimento ficou 'pendente'.
    const pc = (await pg.dono.query('SELECT estado FROM peca_cumprimento WHERE documento_id=$1', [doc])).rows[0];
    expect(pc.estado).toBe('pendente');
  });

  test('cumprir o mesmo documento de novo não duplica o andamento (idempotente)', async () => {
    const pc = (await pg.dono.query('SELECT documento_id FROM peca_cumprimento LIMIT 1')).rows[0];
    const r = await req(tSocio, `/api/tarefas/${tarefaId}/cumprir`, { method: 'POST', body: JSON.stringify({ documentoId: pc.documento_id }) });
    expect(r.status).toBe(201);
    expect((await r.json()).jaCumprida).toBe(true);
    const n = (await pg.dono.query('SELECT count(*)::int AS n FROM movimentacoes WHERE processo_id=$1 AND fonte=$2', [processoId, 'manual'])).rows[0];
    expect(n.n).toBe(1);
  });

  test('quando a chave da IA existe, a rotina preenche o resumo sozinha no andamento', async () => {
    const r = await reprocessarResumosPendentes(banco, dep, provedorFake);
    expect(r.atualizados).toBeGreaterThanOrEqual(1);

    const mov = (await pg.dono.query('SELECT conteudo FROM movimentacoes WHERE processo_id=$1 AND fonte=$2', [processoId, 'manual'])).rows[0];
    expect(mov.conteudo).toContain(resumoFake);
    expect(mov.conteudo).not.toContain('pendente');

    const pc = (await pg.dono.query('SELECT estado,motivo FROM peca_cumprimento WHERE processo_id=$1', [processoId])).rows[0];
    expect(pc.estado).toBe('gerado');
    expect(pc.motivo).toBeNull();
  });

  test('provedor indisponível não reprocessa nada (não inventa)', async () => {
    const r = await reprocessarResumosPendentes(banco, dep, new ProvedorAusente('sem chave'));
    expect(r).toEqual({ atualizados: 0, pendentes: 0 });
  });
});
