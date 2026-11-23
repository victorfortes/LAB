import { afterAll, beforeAll, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { receberCarteira, EsquemaCarteira } from '../src/server/carteira_astrea_api.ts';
import { sincronizarComCarteira, confiabilidade } from '../src/server/sentinela_gestao.ts';
import type { Identidade } from '../src/security/sessao.ts';

let pg: BancoDeTeste, banco: Banco;
const org = 'f0900000-0000-4000-8000-000000000001', adm = 'f0900000-0000-4000-8000-000000000002';
const ident: Identidade = { usuarioId: adm, nome: 'Adm', email: 'adm@nga.adv.br', papeis: ['socio_administrador'], organizacoes: [{ id: org, nome: 'NGA', tipo: 'escritorio', papel: 'socio_administrador' }] };
beforeAll(async () => {
  pg = await bancoDeTeste();
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  await pg.dono.query("INSERT INTO organizacoes(id,tipo,nome) VALUES($1,'escritorio','NGA')", [org]);
  await pg.dono.query("INSERT INTO usuarios(id,nome,email,senha_hash) VALUES($1,'Adm','adm@nga.adv.br','x')", [adm]);
  await pg.dono.query("INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES($1,$2,'socio_administrador')", [adm, org]);
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

const caso = (id: string, numero: string, clienteId: string, cliente: string) => ({ id, numero, titulo: `${cliente} x Fulano`, cliente, clienteId, vara: '1ª Vara', acao: 'Cobrança', descricao: '', valor: 1234.5, pasta: '', tipo: 'CTE_LAWSUIT' });

test('carteira do Astrea pela API: grava processos com o CNPJ da ficha e põe as empresas no Sentinela', async () => {
  const casos = [
    ...Array.from({ length: 3 }, (_, i) => caso(`c${i}`, `000000${i}-11.2025.8.16.0001`, '10', 'FMM - ENGENHARIA - EIRELI')),
    caso('c9', '0000009-11.2025.8.16.0001', '20', 'João da Silva'),
    caso('c8', '0000008-11.2025.8.16.0001', '30', 'COPEL DISTRIBUIÇÃO S/A - CNPJ 04.368.898/0001-06'),
  ];
  const d = EsquemaCarteira.parse({ casos, clientes: { 10: { nome: 'FMM - ENGENHARIA - EIRELI', doc: '79.783.510/0001-32', tipo: 'COMPANY' }, 20: { nome: 'João da Silva', doc: '123.456.789-09', tipo: 'PERSON' }, 30: null } });
  const r = await banco.comoUsuario(adm, (db) => receberCarteira(db, org, d, adm));
  expect(r).toMatchObject({ casos: 5, gravados: 5, comCnpj: 4 });
  const { rows } = await pg.dono.query(`SELECT cliente_nome, cliente_documento FROM astrea_registros WHERE chave = 'api:c8'`);
  expect(rows[0]).toMatchObject({ cliente_nome: 'COPEL DISTRIBUIÇÃO S/A', cliente_documento: '04368898000106' });
  const s = await banco.comoUsuario(adm, (db) => sincronizarComCarteira(db, ident));
  expect(s.cadastrados).toBe(2);
  const k = (await pg.dono.query(`SELECT cnpj FROM sentinela_cnpjs ORDER BY cnpj`)).rows.map((x) => x.cnpj);
  expect(k).toEqual(['04368898000106', '79783510000132']);
  const c = await banco.comoUsuario(adm, (db) => confiabilidade(db));
  expect(c.carteira).toMatchObject({ empresas: 2, sem_cnpj: 0, fora: 0 });
  // Repetir não duplica.
  expect((await banco.comoUsuario(adm, (db) => sincronizarComCarteira(db, ident))).cadastrados).toBe(0);
});

test('painel: agenda do Astrea contada por urgência, próximos prazos e cumpridos por dia', async () => {
  const { painelAgenda } = await import('../src/server/bi_agenda.ts');
  await pg.dono.query(`INSERT INTO bi_agenda_linhas(organizacao_id,ordem,tipo,data,hora,caso,conclusao,juizo,numero,resp,status,titulo) VALUES
    ($1,1,'Prazo','20/11/2026','','A x B','','1ª Vara','1','Adm','Em andamento','MANIFESTAR'),
    ($1,2,'Prazo','23/11/2026','','A x B','','1ª Vara','1','Outra','Em andamento','RECURSO'),
    ($1,3,'Audiência','24/11/2026','14:00','C x D','','2ª Vara','2','Adm','Em andamento','AUDIÊNCIA'),
    ($1,4,'Prazo','15/12/2026','','E x F','','3ª Vara','3','Adm','Em andamento','CONTESTAR'),
    ($1,5,'Prazo','19/11/2026','','A x B','21/11/2026','1ª Vara','1','Adm','Concluído','EMBARGOS'),
    ($1,6,'Prazo','19/11/2026','','A x B','','1ª Vara','1','Adm','Cancelado','CANCELADO')`, [org]);
  const a = await banco.comoUsuario(adm, (db) => painelAgenda(db, 'Adm', '2026-11-22'));
  expect(a.abertos).toBe(4);
  expect(a.faixas.atrasada.total).toBe(1);
  expect(a.faixas.esta_semana).toMatchObject({ total: 2, prazos: 1, eventos: 1 });
  expect(a.faixas.adiante.total).toBe(1);
  expect(a.meusAbertos).toBe(3);
  expect(a.proximos[0]).toMatchObject({ titulo: 'RECURSO', vencimento: '2026-11-23' });
  expect(a.meusProximos[0]!.titulo).toBe('AUDIÊNCIA');
  expect(a.cumpridosPorDia.find((d) => d.dia === '2026-11-21')).toMatchObject({ total: 1, meus: 1 });
});
