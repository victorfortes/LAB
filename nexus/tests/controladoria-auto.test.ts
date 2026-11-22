import { afterAll, beforeAll, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ProvedorAusente } from '../src/ai/provedor.ts';

let pg: BancoDeTeste, banco: Banco, app: ReturnType<typeof criarApp>;
const org = 'f0800000-0000-4000-8000-000000000001', ctrl = 'f0800000-0000-4000-8000-000000000002', mau = 'f0800000-0000-4000-8000-000000000003', adv = 'f0800000-0000-4000-8000-000000000004';
const senha = 'Senha de teste segura 123';
let tc = '', ta = '', projeto = '', pubRj = '', pubCivel = '';
const req = (token: string, url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
  app(new Request('http://x' + url, { method, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
const j = async (r: Response | Promise<Response>) => (await r).json();
async function entrar(email: string) {
  const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) }));
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
}
beforeAll(async () => {
  pg = await bancoDeTeste();
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  app = criarApp({ banco, provedor: new ProvedorAusente('teste sem modelo') });
  const hash = await hashDaSenha(senha);
  await pg.dono.query("INSERT INTO organizacoes(id,tipo,nome) VALUES($1,'escritorio','NGA')", [org]);
  await pg.dono.query("INSERT INTO usuarios(id,nome,email,senha_hash) VALUES($1,'Controladoria','ctrl@nga.adv.br',$4),($2,'Maurício Graboski','mauricio@nga.adv.br',$4),($3,'Advogado','adv@nga.adv.br',$4)", [ctrl, mau, adv, hash]);
  await pg.dono.query("INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES($1,$4,'controladoria'),($2,$4,'advogado'),($3,$4,'advogado')", [ctrl, mau, adv, org]);
  tc = await entrar('ctrl@nga.adv.br'); ta = await entrar('adv@nga.adv.br');
  projeto = (await pg.dono.query<{ id: string }>("INSERT INTO projetos(organizacao_id,nome,tipo) VALUES($1,'Cliente RJ','recuperacao_judicial') RETURNING id", [org])).rows[0]!.id;
  await pg.dono.query("INSERT INTO processos(organizacao_id,projeto_id,numero,classe) VALUES($1,$2,'0001234-56.2024.8.16.0001','Recuperação Judicial'),($1,$2,'0009999-11.2025.8.16.0001','Procedimento Comum')", [org, projeto]);
  const proj = (mov: string) => `Intimação referente ao movimento (seq. 9) ${mov} (10/11/2026). Acesse o sistema Projudi.`;
  pubRj = (await pg.dono.query<{ id: string }>(`INSERT INTO publicacoes(organizacao_id,comunicacao_id,oabs,data_disponibilizacao,numero_processo,classe,tipo,texto) VALUES($1,7001,'{X}','2026-11-10','00012345620248160001','RECUPERAçãO JUDICIAL','Intimação',$2) RETURNING id`, [org, proj('JUNTADA DE PETIÇÃO DE HABILITAÇÃO')])).rows[0]!.id;
  pubCivel = (await pg.dono.query<{ id: string }>(`INSERT INTO publicacoes(organizacao_id,comunicacao_id,oabs,data_disponibilizacao,numero_processo,classe,tipo,texto) VALUES($1,7002,'{X}','2026-11-10','00099991120258160001','PROCEDIMENTO COMUM','Intimação',$2) RETURNING id`, [org, proj('PROFERIDO DESPACHO DE MERO EXPEDIENTE')])).rows[0]!.id;
  // Agenda do Astrea: Maurício lança os prazos do processo RJ.
  await pg.dono.query(`INSERT INTO bi_agenda_linhas(organizacao_id,ordem,tipo,data,hora,caso,conclusao,juizo,numero,resp,status,titulo) VALUES
    ($1,1,'Prazo','20/11/2026','','Cliente RJ','','1ª Vara','0001234-56.2024.8.16.0001','Maurício Graboski','Em andamento','MANIFESTAR - DEFERIDO O PEDIDO'),
    ($1,2,'Audiência','25/11/2026','14:00','Cliente RJ','','1ª Vara','0001234-56.2024.8.16.0001','Maurício Graboski','Em andamento','AUDIÊNCIA DE CONCILIAÇÃO'),
    ($1,3,'Prazo','21/11/2026','','Cliente RJ','','1ª Vara','0001234-56.2024.8.16.0001','Anne Marie','Em andamento','CONTRARRAZÕES'),
    ($1,4,'Prazo','22/11/2026','','Outro','','2ª Vara','5555555-55.2025.8.16.0001','Maurício Graboski','Em andamento','MANIFESTAR')`, [org]);
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

test('fila traz o lançamento no padrão do escritório e o responsável do Astrea', async () => {
  expect((await req(ta, '/api/controladoria/sugestoes')).status).toBe(403);
  const f = await j(req(tc, '/api/controladoria/sugestoes'));
  const rj = f.itens.find((i: { id: string }) => i.id === pubRj);
  expect(rj.sugestao).toMatchObject({ titulo: 'MANIFESTAR - JUNTADA DE PETIÇÃO DE HABILITAÇÃO', dias: 5, regime: 'corridos' });
  expect(rj.responsavel).toMatchObject({ id: mau, origem: 'astrea' });
  expect(rj.pronto).toBe(true);
  const civel = f.itens.find((i: { id: string }) => i.id === pubCivel);
  expect(civel.sugestao).toMatchObject({ titulo: 'MANIFESTAR - PROFERIDO DESPACHO DE MERO EXPEDIENTE', regime: 'uteis' });
});

test('confirmar em lote cria prazo e tarefa; repetir não duplica', async () => {
  const f = await j(req(tc, '/api/controladoria/sugestoes'));
  const itens = f.itens.map((i: any) => ({ publicacaoId: i.id, titulo: i.sugestao.titulo, dias: i.sugestao.dias, regime: i.sugestao.regime, responsavelId: i.responsavel?.id ?? null }));
  const r = await j(req(tc, '/api/controladoria/sugestoes/confirmar', { itens }));
  expect(r).toMatchObject({ confirmados: 2, falhas: 0 });
  const { rows } = await pg.dono.query(`SELECT z.titulo, z.vencimento::text v, z.regime, z.responsavel_id FROM prazos z ORDER BY z.titulo`);
  const rj = rows.find((x) => x.titulo.includes('HABILITAÇÃO'))!;
  expect(rj).toMatchObject({ regime: 'corridos', responsavel_id: mau });
  expect((await j(req(tc, '/api/controladoria/sugestoes'))).itens.length).toBe(0);
  const de = await j(req(tc, '/api/controladoria/sugestoes/confirmar', { itens: itens.slice(0, 1) }));
  expect(de.confirmados).toBe(1);
  expect((await pg.dono.query('SELECT count(*)::int n FROM prazos')).rows[0].n).toBe(2);
});

test('agenda do Astrea vira tarefa para quem lançou; concluído no Astrea fecha a tarefa', async () => {
  const r = await j(req(tc, '/api/controladoria/direcionar', {}));
  expect(r).toMatchObject({ criadas: 3, semProjeto: 1, semResponsavel: 1 });
  expect(r.pessoasSemCadastro).toEqual(['Anne Marie']);
  const { rows } = await pg.dono.query(`SELECT titulo, tipo, prazo::text, responsavel_id, status FROM tarefas WHERE chave_playbook LIKE 'astrea:%' ORDER BY prazo`);
  expect(rows[0]).toMatchObject({ titulo: 'MANIFESTAR - DEFERIDO O PEDIDO', tipo: 'prazo', prazo: '2026-11-20', responsavel_id: mau });
  // O tipo (prazo, evento, audiência) é campo próprio: o título fica como no Astrea.
  expect(rows[2]).toMatchObject({ titulo: 'AUDIÊNCIA DE CONCILIAÇÃO', tipo: 'audiencia' });
  expect((await j(req(tc, '/api/controladoria/direcionar', {}))).criadas).toBe(0);
  await pg.dono.query(`UPDATE bi_agenda_linhas SET status = 'Concluído' WHERE ordem = 1`);
  expect((await j(req(tc, '/api/controladoria/direcionar', {}))).concluidas).toBe(1);
  const padroes = await j(req(tc, '/api/controladoria/padroes'));
  expect(padroes.responsaveis.find((x: { resp: string }) => x.resp === 'Maurício Graboski').noLab).toBe('Maurício Graboski');
});

test('agenda lida pela API do Astrea: chave pelo id, providência e publicação de origem na tarefa; advogado não muda vencimento', async () => {
  await pg.dono.query(`INSERT INTO bi_agenda_linhas(organizacao_id,ordem,tipo,data,hora,caso,conclusao,juizo,numero,resp,status,titulo,astrea_id,detalhe,publicacao_ref,publicacao_data,publicacao_texto) VALUES
    ($1,10,'Prazo','30/11/2026','','Cliente RJ x Banco','','1ª Vara','0001234-56.2024.8.16.0001','Maurício Graboski','Em andamento','IMPUGNAR','987654321','Impugnar a relação de credores. [NGA:abc123]','361000752','2026-11-20','Intimação: fica a recuperanda intimada para impugnar no prazo de 10 dias.'),
    ($1,11,'Prazo','30/11/2026','','Cliente RJ x Banco','','1ª Vara','0001234-56.2024.8.16.0001','Maurício Graboski','Cancelado','CANCELADO NO ASTREA','987654322',NULL,NULL,NULL,NULL)`, [org]);
  await j(req(tc, '/api/controladoria/direcionar', {}));
  const { rows } = await pg.dono.query(`SELECT id, descricao FROM tarefas WHERE chave_playbook = 'astrea:id:987654321'`);
  expect(rows.length).toBe(1);
  expect(rows[0].descricao).toContain('Processo nº 0001234-56.2024.8.16.0001');
  expect(rows[0].descricao).toContain('Providência (Astrea): Impugnar a relação de credores.');
  expect(rows[0].descricao).not.toContain('[NGA:');
  expect((await pg.dono.query(`SELECT count(*)::int n FROM tarefas WHERE chave_playbook = 'astrea:id:987654322'`)).rows[0].n).toBe(0);
  const lista = await j(req(tc, '/api/tarefas'));
  const t = lista.tarefas.find((x: { id: string }) => x.id === rows[0].id);
  expect(t.publicacaoTrecho).toContain('impugnar no prazo de 10 dias');
  expect(t.publicacaoData).toBe('2026-11-20');
  expect((await req(ta, `/api/tarefas/${t.id}`, { prazo: '2026-12-30' }, 'PATCH')).status).toBe(403);
  expect((await req(tc, `/api/tarefas/${t.id}`, { prazo: '2026-12-30' }, 'PATCH')).status).toBe(200);
});
