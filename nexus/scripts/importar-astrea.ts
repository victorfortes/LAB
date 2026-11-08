/**
 * Importa a exportação "Processos" do Astrea para a carteira. Sem --aplicar só conta.
 * Roda repetido sem duplicar. Usa o papel da aplicação sob RLS, em nome de quem importa.
 *   NGA_PG_* NGA_IMPORTADOR=email bun scripts/importar-astrea.ts arquivo.xlsx [--aplicar]
 */
import { readFileSync } from 'node:fs';
import { Banco } from '../src/store/conexao.ts';
import { lerXlsx } from '../src/domain/analise/planilha.ts';
import { interpretarLinha, type RegistroAstrea } from '../src/domain/processo/astrea.ts';
import { criar as criarProjeto, EsquemaProjeto } from '../src/server/projetos.ts';
import type { Identidade } from '../src/security/sessao.ts';

const e = process.env; const arquivo = process.argv[2]!; const aplicar = process.argv.includes('--aplicar');
const aba = lerXlsx(new Uint8Array(await Bun.file(arquivo).arrayBuffer())).find((a) => a.nome === 'Processos')!; const [cab, ...linhas] = aba.linhas;
const unicos = new Map<string, RegistroAstrea>(); for (const l of linhas) { if (!l.some((x) => x.trim())) continue; const r = interpretarLinha(cab!, l); unicos.set(r.chave, r); }
const regs = [...unicos.values()]; const etiquetas = [...new Set(regs.map((r) => r.clienteEtiqueta).filter(Boolean))] as string[];
const cnj = new Set(regs.map((r) => r.numeroCnj).filter(Boolean));
console.log(JSON.stringify({ linhas: linhas.length, unicos: regs.length, clientes: etiquetas.length, semEtiqueta: regs.filter((r) => !r.clienteEtiqueta).length, numerosCnj: cnj.size, semCnj: regs.filter((r) => !r.numeroCnj).length }));
if (!aplicar) process.exit(0);

const banco = new Banco({ host: e.NGA_PG_HOST!, port: Number(e.NGA_PG_PORT ?? 5432), user: e.NGA_PG_USER!, password: e.NGA_PG_PASSWORD!, database: e.NGA_PG_DATABASE ?? 'postgres', max: 2, ssl: { ca: readFileSync(e.NGA_PG_CA!, 'utf8'), rejectUnauthorized: true } });
const usuarioId = await banco.semContexto(async (db) => (await db.query<{ id: string }>('SELECT id FROM auth_credenciais($1)', [e.NGA_IMPORTADOR])).rows[0]!.id);
const org = await banco.comoUsuario(usuarioId, async (db) => (await db.query<{ id: string; nome: string }>(`SELECT o.id, o.nome FROM organizacoes o JOIN vinculos v ON v.organizacao_id = o.id WHERE v.usuario_id = $1 AND v.revogado_em IS NULL AND o.tipo = 'escritorio' LIMIT 1`, [usuarioId])).rows[0]!);
const identidade: Identidade = { usuarioId, nome: 'Importação Astrea', email: e.NGA_IMPORTADOR!, papeis: ['socio_administrador'], organizacoes: [{ id: org.id, nome: org.nome, tipo: 'escritorio', papel: 'socio_administrador' }] };

const projetos = new Map<string, string>(); let criados = 0;
for (const et of etiquetas) {
  const id = await banco.comoUsuario(usuarioId, async (db) => {
    const ja = (await db.query<{ id: string }>('SELECT id FROM projetos WHERE organizacao_id=$1 AND etiqueta_astrea=$2', [org.id, et])).rows[0]; if (ja) return ja.id;
    const reest = regs.some((r) => r.clienteEtiqueta === et && r.reestruturacao);
    const nome = et === 'Pessoa Física' ? 'Pessoa Física (carteira)' : et;
    const d = EsquemaProjeto.parse({ nome, tipo: reest ? 'reestruturacao' : 'contencioso_estrategico', resumo: 'Cliente importado da etiqueta do Astrea.', cliente: { razaoSocial: nome } });
    const p = await criarProjeto(db, d, identidade); await db.query('UPDATE projetos SET etiqueta_astrea=$2 WHERE id=$1', [p.id, et]); criados++; return p.id;
  });
  projetos.set(et, id);
}
const lote = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
let novosProc = 0;
const porNumero = new Map<string, RegistroAstrea>(); for (const r of regs) if (r.numeroCnj) { const a = porNumero.get(r.numeroCnj); if (!a || (!a.clienteEtiqueta && r.clienteEtiqueta)) porNumero.set(r.numeroCnj, r); }
for (const b of lote([...porNumero.values()], 300)) {
  novosProc += await banco.comoUsuario(usuarioId, async (db) => (await db.query(`INSERT INTO processos (organizacao_id,projeto_id,numero,classe,assunto,orgao_julgador,comarca,uf,valor_causa,distribuido_em,situacao,suspenso_motivo,fonte,criado_por)
    SELECT $1,x.p,x.n,x.c,x.a,x.o,x.co,x.u,x.v,x.d,x.s,CASE WHEN x.s='suspenso' THEN 'Fase Suspenso no Astrea' END,'astrea',$2
    FROM jsonb_to_recordset($3::jsonb) AS x(p uuid,n text,c text,a text,o text,co text,u text,v bigint,d date,s text) ON CONFLICT (organizacao_id,numero) DO NOTHING`,
    [org.id, usuarioId, JSON.stringify(b.map((r) => ({ p: r.clienteEtiqueta ? projetos.get(r.clienteEtiqueta) : null, n: r.numeroCnj, c: r.acao.slice(0, 200) || null, a: r.objeto.slice(0, 300) || null, o: r.vara.slice(0, 200) || null, co: r.comarca?.slice(0, 120) ?? null, u: r.uf, v: r.valorCausa, d: r.distribuidoEm, s: r.situacao })))])).rowCount ?? 0);
}
let novosReg = 0;
for (const b of lote(regs, 300)) {
  novosReg += await banco.comoUsuario(usuarioId, async (db) => (await db.query(`INSERT INTO astrea_registros (organizacao_id,projeto_id,processo_id,chave,tipo,titulo,cliente_nome,cliente_etiqueta,papel_cliente,outros_envolvidos,numero_original,acao,pasta,equipe,fase,responsavel,etiquetas,vara,foro,valor_causa,distribuido_em,ultimo_historico,url_processo)
    SELECT $1,x.p,(SELECT id FROM processos pr WHERE pr.organizacao_id=$1 AND pr.numero=x.cnj),x.chave,x.tipo,x.titulo,x.cn,x.ce,x.pc,x.oe,x.no,x.acao,x.pasta,x.eq,x.fase,x.resp,ARRAY(SELECT jsonb_array_elements_text(x.et)),x.vara,x.foro,x.v,x.d,x.uh,x.url
    FROM jsonb_to_recordset($2::jsonb) AS x(p uuid,cnj text,chave text,tipo text,titulo text,cn text,ce text,pc text,oe text,no text,acao text,pasta text,eq text,fase text,resp text,et jsonb,vara text,foro text,v bigint,d date,uh text,url text) ON CONFLICT (organizacao_id,chave) DO NOTHING`,
    [org.id, JSON.stringify(b.map((r) => ({ p: r.clienteEtiqueta ? projetos.get(r.clienteEtiqueta) : null, cnj: r.numeroCnj, chave: r.chave, tipo: r.tipo, titulo: r.titulo, cn: r.clienteNome, ce: r.clienteEtiqueta, pc: r.papelCliente, oe: r.outrosEnvolvidos, no: r.numeroOriginal, acao: r.acao, pasta: r.pasta, eq: r.equipe, fase: r.fase, resp: r.responsavel, et: r.etiquetas, vara: r.vara, foro: r.foro, v: r.valorCausa, d: r.distribuidoEm, uh: r.ultimoHistorico, url: r.urlProcesso })))])).rowCount ?? 0);
}
console.log(JSON.stringify({ projetosCriados: criados, processosNovos: novosProc, registrosNovos: novosReg })); await banco.encerrar();
