import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { sincronizarAgendado, hojeSaoPaulo, type Buscador, type ItemDjen } from '../src/server/controladoria.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

let pg: BancoDeTeste; let banco: Banco; let app: ReturnType<typeof criarApp>;
const NGA = '11111111-1111-1111-1111-111111111111'; const SENHA = 'uma-senha-bem-longa';
const U = { adm: 'aaaaaaaa-0000-4000-8000-000000000001', ctrl: 'aaaaaaaa-0000-4000-8000-000000000002', adv: 'aaaaaaaa-0000-4000-8000-000000000003', soc: 'aaaaaaaa-0000-4000-8000-000000000004' };
const tok: Record<string, string> = {};
let chamadas: Array<{ numeroOab: string; pagina: number }> = [];

const item = (id: number, numero: string, texto = 'Intimação para manifestação em cinco dias.'): ItemDjen => ({
  id, data_disponibilizacao: hojeSaoPaulo(), siglaTribunal: 'TJPR', tipoComunicacao: 'Intimação', nomeOrgao: '1ª Vara', texto, numero_processo: numero, link: 'https://dje', nomeClasse: 'Recuperação Judicial', destinatarios: [{ nome: 'EMPRESA X', polo: 'A' }],
});
/** DJEN de mentira: a OAB 111 recebe as publicações 1 e 2; a OAB 222 recebe a 2 (a mesma, citando dois sócios) e a 3. */
const djen: Buscador = async (p) => {
  chamadas.push({ numeroOab: p.numeroOab, pagina: p.pagina });
  const todos: Record<string, ItemDjen[]> = {
    '111': [item(1, '00012345620248160001'), item(2, '99999999999999999999')], '222': [item(2, '99999999999999999999'), item(3, '77777777777777777777')],
  };
  const itens = todos[p.numeroOab] ?? []; return { count: itens.length, items: itens };
};
const req = (t: string, url: string, init: RequestInit = {}) => app(new Request(`http://x${url}`, { ...init, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}` } }));
const entrar = async (email: string) => { const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha: SENHA }) })); return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!; };

beforeAll(async () => {
  pg = await bancoDeTeste(); await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' }); app = criarApp({ banco, buscadorDjen: djen });
  const h = await hashDaSenha(SENHA);
  await pg.dono.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  for (const [k, id] of Object.entries(U)) await pg.dono.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,$2,$3,$4)`, [id, `${k}@nga.adv.br`, k, h]);
  await pg.dono.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$5,'socio_administrador'),($2,$5,'controladoria'),($3,$5,'advogado'),($4,$5,'socio')`, [U.adm, U.ctrl, U.adv, U.soc, NGA]);
  for (const k of Object.keys(U)) tok[k] = await entrar(`${k}@nga.adv.br`);
  // processo já cadastrado, para a publicação 1 ser vinculada sozinha
  await req(tok.adm!, '/api/processos', { method: 'POST', body: JSON.stringify({ numero: '0001234-56.2024.8.16.0001' }) });
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

describe('controladoria: quem entra', () => {
  test('administração, sócio e controladoria entram; advogado não', async () => {
    for (const k of ['adm', 'ctrl', 'soc']) expect((await req(tok[k]!, '/api/controladoria/publicacoes')).status, k).toBe(200);
    for (const k of ['adv']) {
      expect((await req(tok[k]!, '/api/controladoria/publicacoes')).status, k).toBe(403);
      expect((await req(tok[k]!, '/api/controladoria/oabs')).status, k).toBe(403);
      expect((await req(tok[k]!, '/api/controladoria/sincronizacao', { method: 'POST', body: '{}' })).status, k).toBe(403);
    }
  });
});

describe('controladoria: coleta do DJEN', () => {
  test('cadastra OABs, valida o formato e sincroniza sem duplicar', async () => {
    expect((await req(tok.ctrl!, '/api/controladoria/oabs', { method: 'POST', body: JSON.stringify({ nome: 'Sócio Um', numeroOab: 'abc', ufOab: 'PR' }) })).status).toBe(400);
    expect((await req(tok.ctrl!, '/api/controladoria/oabs', { method: 'POST', body: JSON.stringify({ nome: 'Sócio Um', numeroOab: '111', ufOab: 'pr' }) })).status).toBe(201);
    expect((await req(tok.adm!, '/api/controladoria/oabs', { method: 'POST', body: JSON.stringify({ nome: 'Sócio Dois', numeroOab: '222', ufOab: 'PR' }) })).status).toBe(201);

    const s1 = await (await req(tok.ctrl!, '/api/controladoria/sincronizacao', { method: 'POST', body: '{}' })).json();
    expect(s1.novas).toBe(3);                                   // 1, 2 e 3: a 2 veio por duas OABs e conta uma vez
    const s2 = await (await req(tok.ctrl!, '/api/controladoria/sincronizacao', { method: 'POST', body: '{}' })).json();
    expect(s2.novas).toBe(0);                                   // idempotente

    const l = await (await req(tok.ctrl!, '/api/controladoria/publicacoes')).json();
    expect(l.publicacoes).toHaveLength(3);
    expect(l.resumo.novas).toBe(3);
    const dupla = l.publicacoes.find((p: { comunicacao_id: string }) => String(p.comunicacao_id) === '2');
    expect(dupla.oabs.sort()).toEqual(['Sócio Dois', 'Sócio Um']);   // a mesma publicação, as duas OABs
  });

  test('publicação de processo já cadastrado vem vinculada ao processo', async () => {
    const l = await (await req(tok.ctrl!, '/api/controladoria/publicacoes')).json();
    const p1 = l.publicacoes.find((p: { comunicacao_id: string }) => String(p.comunicacao_id) === '1');
    expect(p1.processo_numero).toBe('0001234-56.2024.8.16.0001');
    expect(l.publicacoes.find((p: { comunicacao_id: string }) => String(p.comunicacao_id) === '3').processo_id).toBeNull();
  });

  test('filtros, tratamento (identificado e datado) e descarte', async () => {
    const l = await (await req(tok.ctrl!, '/api/controladoria/publicacoes?oab=Sócio%20Um')).json();
    expect(l.publicacoes).toHaveLength(2);
    const id = l.publicacoes[0].id;
    expect((await req(tok.ctrl!, `/api/controladoria/publicacoes/${id}`, { method: 'PATCH', body: JSON.stringify({ situacao: 'tratada', observacao: 'Prazo lançado.' }) })).status).toBe(200);
    const t = await (await req(tok.ctrl!, '/api/controladoria/publicacoes?situacao=tratada')).json();
    expect(t.publicacoes[0]).toMatchObject({ situacao: 'tratada', tratada_por_nome: 'ctrl', observacao: 'Prazo lançado.' });
    await req(tok.ctrl!, `/api/controladoria/publicacoes/${t.publicacoes[0].id}`, { method: 'PATCH', body: JSON.stringify({ situacao: 'descartada' }) });
    expect((await (await req(tok.ctrl!, '/api/controladoria/publicacoes')).json()).publicacoes).toHaveLength(2);   // descartada some da lista padrão
    expect((await (await req(tok.ctrl!, '/api/controladoria/publicacoes?q=Intimação')).json()).publicacoes.length).toBeGreaterThan(0);
  });

  test('rotina agendada: roda sem ninguém logado, com conta de serviço, e não duplica', async () => {
    chamadas = [];
    const r = await sincronizarAgendado(banco, djen);
    expect(r.length).toBe(2); expect(r.every((x) => x.erro === null)).toBe(true);
    expect(r.reduce((t, x) => t + x.novas, 0)).toBe(0);
    expect(chamadas.length).toBe(2);
  });

  test('falha do DJEN não derruba nada: o erro fica na OAB, à vista', async () => {
    const ruim: Buscador = async () => { throw new Error('DJEN indisponível: muito ocupado'); };
    const r = await sincronizarAgendado(banco, ruim);
    expect(r.every((x) => x.erro?.includes('muito ocupado'))).toBe(true);
    const oabs = await (await req(tok.ctrl!, '/api/controladoria/oabs')).json();
    expect(oabs[0].ultimo_erro).toContain('muito ocupado');
  });
});

describe('intimação detalhada: análise separada do prazo processual',()=>{
 test('decodifica o inteiro teor, agenda prazo confirmado uma vez e mantém duas atividades distintas',async()=>{
  const projectResponse=await req(tok.adm!,'/api/projetos',{method:'POST',body:JSON.stringify({nome:'Projeto DJEN',tipo:'consultivo',semPlaybook:true,cliente:{razaoSocial:'Cliente DJEN',cnpj:'33.000.167/0001-01'}})});
  expect(projectResponse.status).toBe(201);const project=await projectResponse.json();
  const pub=(await pg.dono.query('SELECT id,processo_id FROM publicacoes WHERE comunicacao_id=1')).rows[0];
  await pg.dono.query('UPDATE processos SET projeto_id=$1 WHERE id=$2',[project.id,pub.processo_id]);
  await pg.dono.query("UPDATE publicacoes SET texto='&lt;p&gt;Intima&amp;ccedil;&amp;atilde;o: prazo de 5 dias úteis.&lt;/p&gt;' WHERE id=$1",[pub.id]);
  const detail=await (await req(tok.ctrl!,`/api/controladoria/publicacoes/${pub.id}/detalhe`)).json();
  expect(detail.texto_legivel).toBe('Intimação: prazo de 5 dias úteis.');
  let tasks=(await (await req(tok.ctrl!,'/api/tarefas')).json()).tarefas;
  expect(tasks.filter((t:any)=>t.publicacaoId===pub.id&&t.tipoAtividade==='analise_intimacao')).toHaveLength(1);
  const body={titulo:'Manifestar no processo',dias:5,regime:'uteis'};
  const first=await req(tok.ctrl!,`/api/controladoria/publicacoes/${pub.id}/agendamento`,{method:'POST',body:JSON.stringify(body)});
  expect(first.status).toBe(201);expect((await first.json()).repetido).toBe(false);
  const again=await (await req(tok.ctrl!,`/api/controladoria/publicacoes/${pub.id}/agendamento`,{method:'POST',body:JSON.stringify(body)})).json();expect(again.repetido).toBe(true);
  tasks=(await (await req(tok.ctrl!,'/api/tarefas')).json()).tarefas.filter((t:any)=>t.publicacaoId===pub.id);
  expect(tasks).toHaveLength(2);
  expect(tasks.find((t:any)=>t.tipoAtividade==='analise_intimacao').status).toBe('concluida');
  expect(tasks.find((t:any)=>t.tipoAtividade==='prazo_processual').status).toBe('a_fazer');
 });
});
