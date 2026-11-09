/**
 * Leva a base do Sentinela local (SQLite) para a plataforma. Sem --aplicar só conta. Idempotente.
 * Preserva as decisões humanas; do texto das comunicações guarda só o início.
 */
import { readFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { Banco } from '../src/store/conexao.ts';

const e = process.env; const arq = process.argv[2]!; const aplicar = process.argv.includes('--aplicar');
const s = new Database(arq, { readonly: true });
const q = (sql: string) => s.query(sql).all() as Record<string, any>[];
const cl = q('SELECT * FROM clientes'), nomes = q('SELECT * FROM cliente_nomes WHERE ativo IS NOT 0'), cnpjs = q('SELECT * FROM cliente_cnpjs'), procs = q(`SELECT * FROM processos`), achs = q('SELECT * FROM correspondencias');
const coms = q(`SELECT id,numero_processo,tribunal,tipo,data_disponibilizacao,classe,orgao,link,substr(texto,1,6000) trecho,destinatarios FROM comunicacoes WHERE id IN (SELECT comunicacao_id FROM correspondencias)`);
const ultimas = q(`SELECT cliente_id,chave,max(janela_fim) f FROM consultas WHERE status='ok' GROUP BY 1,2`);
console.log(JSON.stringify({ clientes: cl.length, nomes: nomes.length, cnpjs: cnpjs.length, processos: procs.length, achados: achs.length, comunicacoes: coms.length, janelas: ultimas.length }));
if (!aplicar) process.exit(0);
const banco = new Banco({ host: e.NGA_PG_HOST!, port: 5432, user: e.NGA_PG_USER!, password: e.NGA_PG_PASSWORD!, database: 'postgres', max: 2, ssl: { ca: readFileSync(e.NGA_PG_CA!, 'utf8'), rejectUnauthorized: true } });
const uid = await banco.semContexto(async (db) => (await db.query<{ id: string }>('SELECT id FROM auth_credenciais($1)', [e.NGA_IMPORTADOR])).rows[0]!.id);
const org = await banco.comoUsuario(uid, async (db) => (await db.query<{ id: string }>(`SELECT o.id FROM organizacoes o JOIN vinculos v ON v.organizacao_id=o.id WHERE v.usuario_id=$1 AND v.revogado_em IS NULL AND o.tipo='escritorio' LIMIT 1`, [uid])).rows[0]!.id);
const lote = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const clientes = new Map<number, string>();
await banco.comoUsuario(uid, async (db) => {
  for (const c of cl) { const { rows: [r] } = await db.query<{ id: string }>(`INSERT INTO sentinela_clientes(organizacao_id,razao_social,nome_fantasia,cnpj_matriz,advogado_responsavel,equipe,ativo,confirmar_por_nome_exato,ultima_verificacao,origem_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(organizacao_id,origem_id) DO UPDATE SET razao_social=EXCLUDED.razao_social RETURNING id`, [org, c.razao_social, c.nome_fantasia, c.cnpj_matriz, c.advogado_responsavel, c.equipe, c.status_monitoramento === 'ativo', !!c.confirmar_por_nome_exato, c.ultima_verificacao, c.id]); clientes.set(c.id, r!.id); }
  for (const n of nomes) await db.query('INSERT INTO sentinela_nomes(cliente_id,organizacao_id,nome,nome_norm,tipo) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [clientes.get(n.cliente_id), org, n.nome, n.nome_norm, n.tipo]);
  for (const x of cnpjs) await db.query('INSERT INTO sentinela_cnpjs(cliente_id,organizacao_id,cnpj,tipo) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [clientes.get(x.cliente_id), org, x.cnpj, x.tipo]);
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  for (const u of ultimas) { const [param, ...v] = String(u.chave).split(':'); await db.query(`INSERT INTO sentinela_tarefas(organizacao_id,cliente_id,dia,chave,param,valor,inicio,fim,status) VALUES($1,$2,$3::date-1,$4,$5,$6,$7,$7,'ok') ON CONFLICT DO NOTHING`, [org, clientes.get(u.cliente_id), hoje, u.chave, param, v.join(':'), u.f]); }
});
for (const b of lote(procs, 200)) await banco.comoUsuario(uid, (db) => db.query(`INSERT INTO sentinela_processos(organizacao_id,numero_processo,tribunal,classe,orgao,grau,sistema,assuntos,data_ajuizamento,datajud_status,primeira_identificacao,ultima_verificacao) SELECT $1,x.n,x.t,x.c,x.o,x.g,x.s,x.a,x.d,x.ds,x.p,x.u FROM jsonb_to_recordset($2::jsonb) x(n text,t text,c text,o text,g text,s text,a jsonb,d date,ds text,p timestamptz,u timestamptz) ON CONFLICT DO NOTHING`, [org, JSON.stringify(b.map((p) => ({ n: p.numero_processo, t: p.tribunal, c: p.classe, o: p.orgao, g: p.grau, s: p.sistema, a: p.assuntos ? JSON.parse(p.assuntos) : null, d: p.data_ajuizamento, ds: p.datajud_status ?? 'pendente', p: p.primeira_identificacao, u: p.ultima_verificacao })))]));
for (const b of lote(coms, 100)) await banco.comoUsuario(uid, (db) => db.query(`INSERT INTO sentinela_comunicacoes(id,organizacao_id,numero_processo,tribunal,tipo,data_disponibilizacao,classe,orgao,link,trecho,destinatarios) SELECT x.i,$1,x.n,x.t,x.ti,x.d,x.c,x.o,x.l,x.tr,x.de FROM jsonb_to_recordset($2::jsonb) x(i text,n text,t text,ti text,d date,c text,o text,l text,tr text,de jsonb) ON CONFLICT DO NOTHING`, [org, JSON.stringify(b.map((c) => ({ i: String(c.id), n: c.numero_processo, t: c.tribunal, ti: c.tipo, d: c.data_disponibilizacao, c: c.classe, o: c.orgao, l: c.link, tr: String(c.trecho ?? '').replaceAll('\u0000', ''), de: JSON.parse(c.destinatarios || '[]') })))]));
const numero = new Map(procs.map((p) => [p.id, p.numero_processo])); let novos = 0;
for (const b of lote(achs, 200)) novos += await banco.comoUsuario(uid, async (db) => (await db.query(`INSERT INTO sentinela_achados(organizacao_id,cliente_id,processo_id,comunicacao_id,nivel,classificacao,polo,nome_na_fonte,evidencia,estado_validacao,categoria_data,identificada_em,ultima_verificacao) SELECT $1,x.cl,(SELECT id FROM sentinela_processos p WHERE p.organizacao_id=$1 AND p.numero_processo=x.n),x.co,x.ni,x.cf,x.po,x.nf,x.ev,x.es,x.ca,x.id_,x.uv FROM jsonb_to_recordset($2::jsonb) x(cl uuid,n text,co text,ni int,cf text,po text,nf text,ev jsonb,es text,ca text,id_ timestamptz,uv timestamptz) ON CONFLICT DO NOTHING`, [org, JSON.stringify(b.map((a) => ({ cl: clientes.get(a.cliente_id), n: numero.get(a.processo_id), co: a.comunicacao_id == null ? null : String(a.comunicacao_id), ni: a.nivel, cf: a.classificacao, po: a.polo, nf: a.nome_na_fonte, ev: a.evidencia ? JSON.parse(a.evidencia) : {}, es: a.estado_validacao, ca: a.categoria_data, id_: a.identificada_em, uv: a.ultima_verificacao })))])).rowCount ?? 0);
console.log(JSON.stringify({ achadosNovos: novos })); await banco.encerrar();
