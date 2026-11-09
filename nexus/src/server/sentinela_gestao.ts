/** Sentinela: tudo o que a equipe vê e decide. A coleta fica em `sentinela.ts`. */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { normalizar as normalizarNome } from '../domain/sentinela/nomes.ts';
import { consultasDoCliente } from '../domain/sentinela/matcher.ts';
import { limparCnpj, validarCnpj } from '../domain/analise/identificadores.ts';
import { analisarAchado, buscaInicial, cliente as dadosDoCliente, enfileirar, hojeBr, pesquisarAgora } from './sentinela.ts';
import { CONFIG_PADRAO, MATRIZ_FONTES, ORDEM_STATUS, intervalosDeLacuna, obterConfig, piorStatus, somaDias, statusDaChave, type ChaveConfig, type LeituraTarefa, type StatusDia } from './sentinela_regras.ts';

function orgDe(i: Identidade): string { const o = i.organizacoes.find((x) => x.tipo === 'escritorio')?.id; if (!o) throw new PedidoInvalido('usuário não pertence ao escritório'); return o; }
const hoje = () => hojeBr(new Date());
const NUM = (s: string | null) => { if (s === null || s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };

// ------------------------------------------------------------ painel ---
const BASE_AJ = `FROM sentinela_processos p JOIN sentinela_achados a ON a.processo_id=p.id WHERE a.classificacao<>'descartada' AND p.data_ajuizamento IS NOT NULL`;
export async function painelGeral(db: PoolClient) {
  const h = hoje(), um = async (sql: string, args: unknown[] = []) => Number((await db.query<{ n: number }>(sql, args)).rows[0]?.n ?? 0);
  const ontem = somaDias(h, -1), ini30 = somaDias(h, -29);
  const porDia = new Map((await db.query<{ d: string; n: number }>(`SELECT to_char(p.data_ajuizamento,'YYYY-MM-DD') d,count(DISTINCT p.id)::int n ${BASE_AJ} AND p.data_ajuizamento>=$1 GROUP BY 1`, [ini30])).rows.map((r) => [r.d, r.n]));
  const serie_dias = Array.from({ length: 30 }, (_, i) => { const dia = somaDias(h, i - 29); return { dia, n: porDia.get(dia) ?? 0 }; });
  const [a, m] = h.split('-').map(Number) as [number, number];
  const meses = Array.from({ length: 12 }, (_, i) => { const t = a * 12 + m - 1 - (11 - i); return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; });
  const porMes = new Map((await db.query<{ m: string; n: number }>(`SELECT to_char(p.data_ajuizamento,'YYYY-MM') m,count(DISTINCT p.id)::int n ${BASE_AJ} AND p.data_ajuizamento>=$1 GROUP BY 1`, [`${meses[0]}-01`])).rows.map((r) => [r.m, r.n]));
  const ajuizados_hoje = (await db.query(`SELECT a.id,a.classificacao,a.estado_validacao,a.prioridade,p.numero_processo,p.tribunal,p.classe,c.razao_social cliente FROM sentinela_achados a JOIN sentinela_processos p ON p.id=a.processo_id JOIN sentinela_clientes c ON c.id=a.cliente_id WHERE a.classificacao<>'descartada' AND p.data_ajuizamento=$1 ORDER BY (a.classificacao='confirmada') DESC,a.identificada_em DESC LIMIT 30`, [h])).rows;
  const por_cliente = (await db.query(`SELECT c.id,c.razao_social,count(DISTINCT p.id) FILTER (WHERE p.data_ajuizamento IS NOT NULL)::int total,count(DISTINCT p.id) FILTER (WHERE p.data_ajuizamento>=$1)::int ult30,count(DISTINCT p.id) FILTER (WHERE p.data_ajuizamento=$2)::int hoje,to_char(max(p.data_ajuizamento),'YYYY-MM-DD') ultima FROM sentinela_clientes c LEFT JOIN sentinela_achados a ON a.cliente_id=c.id AND a.classificacao<>'descartada' LEFT JOIN sentinela_processos p ON p.id=a.processo_id WHERE c.ativo GROUP BY c.id ORDER BY ult30 DESC,total DESC`, [ini30, h])).rows;
  const clientes_so_cnpj = (await db.query(`SELECT c.id,c.razao_social FROM sentinela_clientes c WHERE c.ativo AND NOT EXISTS (SELECT 1 FROM sentinela_nomes n WHERE n.cliente_id=c.id AND length(replace(n.nome_norm,' ',''))>=4)`)).rows;
  const dias = (await db.query<{ dia: string; total: number; ok: number; falha: number }>(`SELECT to_char(dia,'YYYY-MM-DD') dia,count(*)::int total,count(*) FILTER (WHERE status IN ('ok','truncada'))::int ok,count(*) FILTER (WHERE status='falha')::int falha FROM sentinela_tarefas WHERE dia>=$1 GROUP BY 1`, [somaDias(h, -13)])).rows;
  const porDiaT = new Map(dias.map((d) => [d.dia, d]));
  const cadencia = Array.from({ length: 14 }, (_, i) => { const dia = somaDias(h, i - 13), d = porDiaT.get(dia); return { dia, consultas: d?.total ?? 0, resultado: !d ? 'sem_execucao' : d.falha ? 'parcial' : d.ok === d.total ? 'sucesso' : 'em_curso' }; });
  const { rows: [rot] } = await db.query<{ criado_em: Date; ok: boolean }>('SELECT * FROM sentinela_ultima_rotina()');
  const minutos = rot ? Math.round((Date.now() - new Date(rot.criado_em).getTime()) / 60000) : null;
  const falhas24 = await um(`SELECT count(*)::int n FROM sentinela_tarefas WHERE status='falha' AND atualizado_em>now()-interval '24 hours'`);
  const fontes = (await db.query<{ fonte: string; estado: string }>('SELECT fonte,estado FROM sentinela_saude')).rows;
  const rotina = { ativa: minutos !== null && minutos <= 5 && rot!.ok, minutos, ultima: rot?.criado_em ?? null };
  const semaforo = !rotina.ativa || fontes.some((f) => f.estado === 'indisponivel') ? 'vermelho' : falhas24 || fontes.some((f) => f.estado === 'degradado') ? 'amarelo' : 'verde';
  return {
    hoje: h, semaforo, rotina, cadencia, serie_dias, serie_meses: meses.map((mes) => ({ mes, n: porMes.get(mes) ?? 0 })), ajuizados_hoje, por_cliente, clientes_so_cnpj, fontes,
    ajuizados_ontem: await um(`SELECT count(DISTINCT p.id)::int n ${BASE_AJ} AND p.data_ajuizamento=$1`, [ontem]), ajuizadas_total: await um(`SELECT count(DISTINCT p.id)::int n ${BASE_AJ}`),
    sem_data_ajuizamento: await um(`SELECT count(DISTINCT p.id)::int n FROM sentinela_processos p JOIN sentinela_achados a ON a.processo_id=p.id WHERE a.classificacao<>'descartada' AND p.data_ajuizamento IS NULL`),
    clientes_monitorados: await um('SELECT count(*)::int n FROM sentinela_clientes WHERE ativo'),
    pendentes_validacao: await um(`SELECT count(*)::int n FROM sentinela_achados WHERE estado_validacao IN ('pendente','em_verificacao')`),
    novas_acoes_confirmadas: await um(`SELECT count(*)::int n FROM sentinela_achados WHERE classificacao='confirmada' AND categoria_data='nova_distribuicao'`),
    falhas_consultas_24h: falhas24, consultas_a_reprocessar: await um(`SELECT count(*)::int n FROM sentinela_tarefas WHERE status='falha' AND dia>=$1`, [somaDias(h, -7)]),
    tribunais_com_dados: await um('SELECT count(DISTINCT tribunal)::int n FROM sentinela_processos'),
    alertas_nao_lidos: await um('SELECT count(*)::int n FROM sentinela_alertas WHERE NOT lido'),
    alertas: (await db.query('SELECT id,tipo,canal,status,lido,payload,criado_em FROM sentinela_alertas ORDER BY criado_em DESC LIMIT 8')).rows,
    progresso: await progresso(db),
  };
}
export async function progresso(db: PoolClient) {
  const { rows: [r] } = await db.query<{ total: number; abertas: number; falhas: number }>(`SELECT count(*)::int total,count(*) FILTER (WHERE status IN ('pendente','executando'))::int abertas,count(*) FILTER (WHERE status='falha')::int falhas FROM sentinela_tarefas WHERE dia=$1`, [hoje()]);
  const total = r?.total ?? 0, abertas = r?.abertas ?? 0;
  return { estado: !total ? 'ocioso' : abertas ? 'executando' : 'concluido', total, abertas, falhas: r?.falhas ?? 0, pct: total ? Math.round((100 * (total - abertas)) / total) : 0 };
}

// ---------------------------------------------------------- clientes ---
const lista = z.array(z.string().trim().max(300)).max(100).default([]);
export const EsquemaClienteSentinela = z.object({ razaoSocial: z.string().trim().min(2).max(300), cnpj: z.string().max(20), nomeFantasia: z.string().trim().max(300).optional(), confirmarPorNomeExato: z.boolean().default(false), filiais: lista, anteriores: lista, alternativos: lista, grupoEconomico: z.string().trim().max(300).optional(), advogadoResponsavel: z.string().trim().max(300).optional(), equipe: z.string().trim().max(300).optional(), tribunais: z.array(z.string().trim().max(20)).max(100).default([]), frequenciaHoras: z.number().int().min(24).max(720).default(24) });
export const EsquemaEdicaoCliente = z.object({ ativo: z.boolean().optional(), frequenciaHoras: z.number().int().min(24).max(720).optional(), tribunais: z.array(z.string().trim().max(20)).max(100).optional(), advogadoResponsavel: z.string().trim().max(300).optional(), confirmarPorNomeExato: z.boolean().optional(), adicionarFiliais: lista, adicionarAnteriores: lista, adicionarAlternativos: lista });
export const EsquemaImportacao = z.object({ linhas: z.array(z.record(z.string(), z.string())).min(1).max(1000) });
const addNome = (db: PoolClient, id: string, org: string, nome: string, tipo: string) => { const n = normalizarNome(nome); return n ? db.query('INSERT INTO sentinela_nomes(cliente_id,organizacao_id,nome,nome_norm,tipo) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [id, org, nome.trim(), n, tipo]) : null; };
function cnpjValido(v: string): string { if (!validarCnpj(v)) throw new PedidoInvalido(`CNPJ inválido: ${v}`); return limparCnpj(v); }
async function cadastrar(db: PoolClient, org: string, d: z.infer<typeof EsquemaClienteSentinela>): Promise<string> {
  const cnpj = cnpjValido(d.cnpj), filiais = d.filiais.map(cnpjValido);
  if ((await db.query('SELECT 1 FROM sentinela_clientes WHERE organizacao_id=$1 AND cnpj_matriz=$2', [org, cnpj])).rowCount) throw new PedidoInvalido('Este CNPJ já está monitorado.');
  const { rows: [c] } = await db.query<{ id: string }>('INSERT INTO sentinela_clientes(organizacao_id,razao_social,nome_fantasia,cnpj_matriz,confirmar_por_nome_exato,grupo_economico,advogado_responsavel,equipe,tribunais_prioritarios,frequencia_horas) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id', [org, d.razaoSocial, d.nomeFantasia || null, cnpj, d.confirmarPorNomeExato, d.grupoEconomico || null, d.advogadoResponsavel || null, d.equipe || null, JSON.stringify(d.tribunais), d.frequenciaHoras]);
  const id = c!.id;
  await db.query(`INSERT INTO sentinela_cnpjs(cliente_id,organizacao_id,cnpj,tipo) VALUES($1,$2,$3,'matriz')`, [id, org, cnpj]);
  for (const f of filiais) await db.query(`INSERT INTO sentinela_cnpjs(cliente_id,organizacao_id,cnpj,tipo) VALUES($1,$2,$3,'filial') ON CONFLICT DO NOTHING`, [id, org, f]);
  await addNome(db, id, org, d.razaoSocial, 'razao_social'); if (d.nomeFantasia) await addNome(db, id, org, d.nomeFantasia, 'fantasia');
  for (const n of d.anteriores) await addNome(db, id, org, n, 'anterior'); for (const n of d.alternativos) await addNome(db, id, org, n, 'alternativo');
  return id;
}
export async function criarCliente(db: PoolClient, d: z.infer<typeof EsquemaClienteSentinela>, i: Identidade) {
  const org = orgDe(i), id = await cadastrar(db, org, d); const consultas = await buscaInicial(db, org, id, new Date());
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'sentinela.cliente_criado', entidade: 'sentinela_cliente', entidadeId: id, depois: { razaoSocial: d.razaoSocial } }); return { id, consultas };
}
const separar = (v?: string) => (v ?? '').split(';').map((x) => x.trim()).filter(Boolean);
export async function importarClientes(db: PoolClient, linhas: Record<string, string>[], i: Identidade) {
  const org = orgDe(i), erros: { linha: number; erro: string }[] = []; let importados = 0;
  for (const [idx, l] of linhas.entries()) {
    await db.query('SAVEPOINT linha');
    try {
      const d = EsquemaClienteSentinela.parse({ razaoSocial: l.razao_social, cnpj: l.cnpj_matriz, nomeFantasia: l.nome_fantasia || undefined, filiais: separar(l.filiais), anteriores: separar(l.anteriores), alternativos: separar(l.alternativos), grupoEconomico: l.grupo_economico || undefined, advogadoResponsavel: l.advogado_responsavel || undefined, equipe: l.equipe || undefined });
      const id = await cadastrar(db, org, d); await buscaInicial(db, org, id, new Date()); await db.query('RELEASE SAVEPOINT linha'); importados++;
    } catch (e) { await db.query('ROLLBACK TO SAVEPOINT linha'); erros.push({ linha: idx + 2, erro: e instanceof z.ZodError ? 'razão social ou CNPJ ausente' : (e as Error).message.slice(0, 200) }); }
  }
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'sentinela.clientes_importados', entidade: 'sentinela_cliente', depois: { importados, erros: erros.length } });
  return { importados, erros };
}
export const listarClientes = async (db: PoolClient) => (await db.query(`SELECT c.*,(SELECT count(*)::int FROM sentinela_achados a WHERE a.cliente_id=c.id AND a.classificacao<>'descartada') processos,(SELECT count(*)::int FROM sentinela_achados a WHERE a.cliente_id=c.id AND a.estado_validacao IN ('pendente','em_verificacao')) pendentes,(SELECT count(*)::int FROM sentinela_cnpjs k WHERE k.cliente_id=c.id) qtd_cnpjs FROM sentinela_clientes c ORDER BY c.razao_social`)).rows;
export async function verCliente(db: PoolClient, id: string) {
  const { rows: [c] } = await db.query('SELECT * FROM sentinela_clientes WHERE id=$1', [id]); if (!c) throw new NaoEncontrado('cliente não encontrado');
  return { ...c, cnpjs: (await db.query('SELECT cnpj,tipo FROM sentinela_cnpjs WHERE cliente_id=$1 ORDER BY tipo DESC,cnpj', [id])).rows, nomes: (await db.query('SELECT nome,tipo FROM sentinela_nomes WHERE cliente_id=$1 ORDER BY tipo DESC,nome', [id])).rows };
}
export async function editarCliente(db: PoolClient, id: string, d: z.infer<typeof EsquemaEdicaoCliente>, i: Identidade) {
  const org = orgDe(i); await verCliente(db, id); const filiais = d.adicionarFiliais.map(cnpjValido);
  await db.query('UPDATE sentinela_clientes SET ativo=coalesce($2,ativo),frequencia_horas=coalesce($3,frequencia_horas),tribunais_prioritarios=coalesce($4,tribunais_prioritarios),advogado_responsavel=coalesce($5,advogado_responsavel),confirmar_por_nome_exato=coalesce($6,confirmar_por_nome_exato) WHERE id=$1', [id, d.ativo ?? null, d.frequenciaHoras ?? null, d.tribunais ? JSON.stringify(d.tribunais) : null, d.advogadoResponsavel ?? null, d.confirmarPorNomeExato ?? null]);
  for (const f of filiais) await db.query(`INSERT INTO sentinela_cnpjs(cliente_id,organizacao_id,cnpj,tipo) VALUES($1,$2,$3,'filial') ON CONFLICT DO NOTHING`, [id, org, f]);
  for (const n of d.adicionarAnteriores) await addNome(db, id, org, n, 'anterior'); for (const n of d.adicionarAlternativos) await addNome(db, id, org, n, 'alternativo');
  const novo = filiais.length + d.adicionarAnteriores.length + d.adicionarAlternativos.length > 0;
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'sentinela.cliente_editado', entidade: 'sentinela_cliente', entidadeId: id, depois: d });
  return { ok: true, consultas: novo ? await buscaInicial(db, org, id, new Date()) : 0 };
}

// --------------------------------------------------------- processos ---
const VALOR = `(SELECT (n.campos->'valor_causa'->>'valor')::numeric FROM sentinela_analises n WHERE n.processo_id=p.id ORDER BY n.gerada_em DESC LIMIT 1)`;
export async function listarProcessos(db: PoolClient, q: URLSearchParams) {
  const where = ['TRUE'], args: unknown[] = []; const uuid = z.string().uuid();
  const f = (cond: string, v: unknown) => { if (v === null || v === undefined || v === '') return; args.push(v); where.push(cond.replaceAll('?', `$${args.length}`)); };
  const data = (k: string) => { const v = q.get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
  const id = (k: string) => { const v = q.get(k); return v && uuid.safeParse(v).success ? v : null; };
  f('a.cliente_id=?', id('cliente_id')); f('upper(p.tribunal)=upper(?)', q.get('tribunal')); f(`(a.identificada_em AT TIME ZONE 'America/Sao_Paulo')::date>=?::date`, data('de')); f(`(a.identificada_em AT TIME ZONE 'America/Sao_Paulo')::date<=?::date`, data('ate'));
  f('p.classe ILIKE ?', q.get('classe') ? `%${q.get('classe')}%` : null); f('a.prioridade=?', q.get('prioridade')); f('a.responsavel_id=?', id('responsavel_id')); f('a.classificacao=?', q.get('classificacao')); f('a.categoria_data=?', q.get('categoria')); f('a.estado_validacao=?', q.get('estado'));
  f(`${VALOR}>=?::numeric`, NUM(q.get('valor_min'))); f(`${VALOR}<=?::numeric`, NUM(q.get('valor_max'))); if (q.get('ajuizado_hoje')) f('p.data_ajuizamento=?::date', hoje());
  const limite = Math.max(1, Math.min(Number(q.get('limite') ?? 50) || 50, 200)), pag = Math.max(1, Number(q.get('pagina') ?? 1) || 1);
  const base = `FROM sentinela_achados a JOIN sentinela_processos p ON p.id=a.processo_id JOIN sentinela_clientes c ON c.id=a.cliente_id LEFT JOIN usuarios r ON r.id=a.responsavel_id WHERE ${where.join(' AND ')}`;
  const { rows: [t] } = await db.query<{ n: number }>(`SELECT count(*)::int n ${base}`, args);
  const { rows: itens } = await db.query(`SELECT a.id,a.classificacao,a.nivel,a.polo,a.categoria_data,a.estado_validacao,a.prioridade,a.identificada_em,p.numero_processo,p.tribunal,p.classe,p.orgao,to_char(p.data_ajuizamento,'YYYY-MM-DD') data_ajuizamento,c.razao_social cliente,c.id cliente_id,r.nome responsavel,(current_date-p.data_ajuizamento)::int dias_ajuiz,${VALOR} valor_causa ${base} ORDER BY (p.data_ajuizamento=$${args.length + 1}::date) DESC NULLS LAST,(a.classificacao='confirmada') DESC,a.identificada_em DESC LIMIT $${args.length + 2} OFFSET $${args.length + 3}`, [...args, hoje(), limite, (pag - 1) * limite]);
  return { total: t?.n ?? 0, itens };
}
export async function detalheProcesso(db: PoolClient, id: string) {
  const { rows: [d] } = await db.query<Record<string, any>>(`SELECT a.*,p.numero_processo,p.tribunal,p.classe,p.orgao,p.grau,p.sistema,p.assuntos,to_char(p.data_ajuizamento,'YYYY-MM-DD') data_ajuizamento,p.datajud_status,p.primeira_identificacao,p.ultima_verificacao ult_proc,c.razao_social cliente,c.cnpj_matriz,r.nome responsavel FROM sentinela_achados a JOIN sentinela_processos p ON p.id=a.processo_id JOIN sentinela_clientes c ON c.id=a.cliente_id LEFT JOIN usuarios r ON r.id=a.responsavel_id WHERE a.id=$1`, [id]);
  if (!d) throw new NaoEncontrado('registro não encontrado');
  const comunicacoes = (await db.query(`SELECT id,tipo,to_char(data_disponibilizacao,'YYYY-MM-DD') data_disponibilizacao,tribunal,orgao,classe,link,trecho texto,destinatarios FROM sentinela_comunicacoes WHERE organizacao_id=$1 AND numero_processo=$2 ORDER BY data_disponibilizacao DESC NULLS LAST`, [d.organizacao_id, d.numero_processo])).rows;
  const { rows: [analise] } = await db.query('SELECT * FROM sentinela_analises WHERE processo_id=$1 ORDER BY gerada_em DESC LIMIT 1', [d.processo_id]);
  const validacoes = (await db.query('SELECT usuario,decisao,classificacao_anterior,justificativa,decidida_em FROM sentinela_validacoes WHERE achado_id=$1 ORDER BY decidida_em', [id])).rows;
  const alertas = (await db.query('SELECT tipo,canal,status,criado_em FROM sentinela_alertas WHERE achado_id=$1 ORDER BY criado_em', [id])).rows;
  return { ...d, assuntos: d.assuntos ?? [], comunicacoes, analise: analise ?? null, validacoes, alertas, fontes: [{ fonte: 'DJEN', usada_para: 'partes, polo e comunicações' }, { fonte: 'DataJud', usada_para: 'data de ajuizamento, classe, órgão' }] };
}
export const equipeResponsavel = async (db: PoolClient, i: Identidade) => (await db.query(`SELECT DISTINCT u.id,u.nome FROM usuarios u JOIN vinculos v ON v.usuario_id=u.id WHERE v.organizacao_id=$1 AND v.revogado_em IS NULL AND u.ativo AND v.papel NOT IN ('cliente_administrador','cliente_usuario','integracao','parceiro_externo') ORDER BY u.nome`, [orgDe(i)])).rows;
export const EsquemaAtribuicao = z.object({ usuarioId: z.string().uuid().nullable() });
export async function atribuir(db: PoolClient, id: string, d: z.infer<typeof EsquemaAtribuicao>, i: Identidade) {
  const org = orgDe(i); if (d.usuarioId && !(await equipeResponsavel(db, i)).some((u) => u.id === d.usuarioId)) throw new PedidoInvalido('pessoa não encontrada na equipe');
  if (!(await db.query('UPDATE sentinela_achados SET responsavel_id=$2 WHERE id=$1', [id, d.usuarioId])).rowCount) throw new NaoEncontrado('registro não encontrado');
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'sentinela.atribuido', entidade: 'sentinela_achado', entidadeId: id, depois: d }); return { ok: true };
}
export async function analisar(db: PoolClient, id: string, i: Identidade) { const r = await analisarAchado(db, orgDe(i), id); if (!r) throw new NaoEncontrado('registro não encontrado'); return { id: r }; }

// --------------------------------------------------------- validação ---
const PENDENTES = ['pendente', 'em_verificacao'];
export async function painel(db: PoolClient, filtro: string) {
  const estados = filtro === 'novas' ? ['automatico', 'confirmado_manual'] : PENDENTES;
  const { rows: itens } = await db.query(`SELECT a.id,a.classificacao,a.nivel,a.polo,a.nome_na_fonte,a.categoria_data,a.estado_validacao,a.identificada_em,a.evidencia->>'regra' regra,a.evidencia->>'trecho' trecho,
      p.numero_processo,p.tribunal,p.classe,p.orgao,p.data_ajuizamento,c.razao_social cliente,m.link,m.tipo comunicacao_tipo
    FROM sentinela_achados a JOIN sentinela_processos p ON p.id=a.processo_id JOIN sentinela_clientes c ON c.id=a.cliente_id LEFT JOIN sentinela_comunicacoes m ON m.organizacao_id=a.organizacao_id AND m.id=a.comunicacao_id
    WHERE a.estado_validacao=ANY($1) ORDER BY ${filtro === 'novas' ? "(a.categoria_data='nova_distribuicao') DESC, a.identificada_em DESC" : "(a.classificacao='provavel') DESC, a.identificada_em DESC"} LIMIT 200`, [estados]);
  const { rows: clientes } = await db.query(`SELECT c.id,c.razao_social,c.nome_fantasia,c.cnpj_matriz,c.ativo,c.confirmar_por_nome_exato,c.ultima_verificacao,count(a.id)::int achados,count(a.id) FILTER (WHERE a.estado_validacao=ANY($1))::int pendentes FROM sentinela_clientes c LEFT JOIN sentinela_achados a ON a.cliente_id=c.id GROUP BY c.id ORDER BY c.razao_social`, [PENDENTES]);
  const { rows: [r] } = await db.query(`SELECT count(*) FILTER (WHERE estado_validacao=ANY($1))::int pendentes, count(*) FILTER (WHERE estado_validacao IN ('automatico','confirmado_manual'))::int confirmadas, count(*) FILTER (WHERE categoria_data='nova_distribuicao')::int novas, count(*) FILTER (WHERE estado_validacao IN ('descartado_auto','descartado_manual'))::int descartadas FROM sentinela_achados`, [PENDENTES]);
  const { rows: fila } = await db.query(`SELECT status,count(*)::int n,to_char(max(atualizado_em) AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI') ultima FROM sentinela_tarefas WHERE dia>=current_date-1 GROUP BY 1`);
  return { itens, clientes, resumo: r, fila, saude: (await db.query(`SELECT fonte,estado,ultimo_sucesso,ultima_falha,ultimo_erro FROM sentinela_saude`)).rows };
}
export const EsquemaDecisao = z.object({ decisao: z.enum(['confirmada', 'descartada']), justificativa: z.string().trim().max(1000).optional() });
export const EsquemaLote = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), decisao: z.enum(['confirmada', 'descartada']), justificativa: z.string().trim().min(3, 'Decisão em lote exige justificativa.').max(1000) });
export async function decidir(db: PoolClient, id: string, d: z.infer<typeof EsquemaDecisao>, i: Identidade) {
  const { rows: [a] } = await db.query<{ organizacao_id: string; classificacao: string }>('SELECT organizacao_id,classificacao FROM sentinela_achados WHERE id=$1', [id]); if (!a) throw new NaoEncontrado('registro não encontrado');
  await db.query('UPDATE sentinela_achados SET classificacao=$2,estado_validacao=$3,decidido_por=$4,decidido_em=now(),justificativa=$5 WHERE id=$1', [id, d.decisao, d.decisao === 'confirmada' ? 'confirmado_manual' : 'descartado_manual', i.usuarioId, d.justificativa ?? null]);
  const { rows: [u] } = await db.query<{ nome: string }>('SELECT nome FROM usuarios WHERE id=$1', [i.usuarioId]);
  await db.query('INSERT INTO sentinela_validacoes(organizacao_id,achado_id,usuario,decisao,classificacao_anterior,justificativa) VALUES($1,$2,$3,$4,$5,$6)', [a.organizacao_id, id, u?.nome ?? i.usuarioId, d.decisao, a.classificacao, d.justificativa ?? null]);
  await auditar(db, { organizacaoId: a.organizacao_id, usuarioId: i.usuarioId, acao: 'sentinela.decisao', entidade: 'sentinela_achado', entidadeId: id, antes: { classificacao: a.classificacao }, depois: d }); return { ok: true };
}
export async function decidirLote(db: PoolClient, d: z.infer<typeof EsquemaLote>, i: Identidade) { let n = 0; for (const id of d.ids) { await decidir(db, id, { decisao: d.decisao, justificativa: d.justificativa }, i); n++; } return { decididas: n }; }

// --------------------------------------------------------- cobertura ---
async function leituras(db: PoolClient, h: string) {
  const { rows } = await db.query<LeituraTarefa & { cliente_id: string; chave: string }>(`SELECT cliente_id,chave,to_char(inicio,'YYYY-MM-DD') inicio,to_char(fim,'YYYY-MM-DD') fim,status,to_char(atualizado_em AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') lido FROM sentinela_tarefas WHERE status IN ('ok','truncada') AND fim>=$1`, [somaDias(h, -130)]);
  const m = new Map<string, LeituraTarefa[]>(); for (const r of rows) { const k = `${r.cliente_id}|${r.chave}`; m.set(k, [...(m.get(k) ?? []), r]); } return m;
}
const clientesAtivos = async (db: PoolClient) => { const cs = (await db.query<{ id: string; razao_social: string }>('SELECT id,razao_social FROM sentinela_clientes WHERE ativo ORDER BY razao_social')).rows; return Promise.all(cs.map(async (c) => ({ ...c, consultas: consultasDoCliente(await dadosDoCliente(db, c.id)) }))); };
export async function cobertura(db: PoolClient, diasPedidos: number) {
  const dias = Math.max(7, Math.min(diasPedidos || 45, 120)), h = hoje(), lidas = await leituras(db, h), lacunas: { cliente_id: string; chave: string; ini: string; fim: string }[] = [];
  const clientes = (await clientesAtivos(db)).map((c) => {
    const por = c.consultas.map((q) => statusDaChave(lidas.get(`${c.id}|${q.chave}`) ?? [], h, dias));
    for (const [i, st] of por.entries()) for (const [ini, fim] of intervalosDeLacuna(st, h)) lacunas.push({ cliente_id: c.id, chave: c.consultas[i]!.chave, ini, fim });
    const lista = Array.from({ length: dias }, (_, i) => { const dia = somaDias(h, i - dias + 1); return { dia, status: piorStatus(por.map((p) => p[dia]!).concat(por.length ? [] : ['sem_historico' as StatusDia])) }; });
    const contagem = Object.fromEntries(ORDEM_STATUS.map((k) => [k, lista.filter((x) => x.status === k).length])) as Record<StatusDia, number>;
    const fechados = contagem.coberto + contagem.lacuna + contagem.incompleto + contagem.provisorio;
    return { cliente_id: c.id, cliente: c.razao_social, dias: lista, contagem, consultas: c.consultas.map((q) => q.chave), pct_coberto: fechados ? Math.round((1000 * contagem.coberto) / fechados) / 10 : null };
  });
  const total = Object.fromEntries(ORDEM_STATUS.map((k) => [k, clientes.reduce((n, c) => n + c.contagem[k], 0)])) as Record<StatusDia, number>;
  const controle = (await db.query('SELECT k.*,c.razao_social cliente FROM sentinela_controle k JOIN sentinela_clientes c ON c.id=k.cliente_id ORDER BY k.criado_em DESC')).rows;
  return { hoje: h, dias, clientes, total, integra: !total.lacuna && !total.incompleto, lacunas, controle, rescan_dias: 7 };
}
export async function preencherLacunas(db: PoolClient, i: Identidade) {
  const org = orgDe(i), h = hoje(), lidas = await leituras(db, h); let n = 0;
  for (const c of await clientesAtivos(db)) for (const q of c.consultas) for (const [ini, fim] of intervalosDeLacuna(statusDaChave(lidas.get(`${c.id}|${q.chave}`) ?? [], h, 95), h)) n += await enfileirar(db, org, c.id, h, q, ini, fim, true);
  return { consultas: n };
}
export const EsquemaControle = z.object({ clienteId: z.string().uuid(), numeroProcesso: z.string().max(40), observacao: z.string().trim().max(500).optional() });
export async function adicionarControle(db: PoolClient, d: z.infer<typeof EsquemaControle>, i: Identidade) {
  const n = d.numeroProcesso.replace(/\D/g, ''); if (n.length !== 20) throw new PedidoInvalido('O número CNJ deve ter 20 dígitos.');
  const { rows: [r] } = await db.query<{ id: string }>('INSERT INTO sentinela_controle(organizacao_id,cliente_id,numero_processo,observacao,criado_por) VALUES($1,$2,$3,$4,$5) ON CONFLICT (cliente_id,numero_processo) DO NOTHING RETURNING id', [orgDe(i), d.clienteId, n, d.observacao ?? null, i.usuarioId]);
  if (!r) throw new PedidoInvalido('Este processo-controle já está cadastrado para o cliente.'); return { id: r.id };
}
export async function removerControle(db: PoolClient, id: string) { if (!(await db.query('DELETE FROM sentinela_controle WHERE id=$1', [id])).rowCount) throw new NaoEncontrado('processo-controle não encontrado'); return { ok: true }; }
export const verificarControles = async (db: PoolClient) => ({ enfileirados: (await db.query('UPDATE sentinela_controle SET verificar=TRUE').then((r) => r.rowCount)) ?? 0 });

// ------------------------------------------------- fontes e operação ---
export async function fontes(db: PoolClient) {
  const saude = (await db.query('SELECT fonte,estado,ultimo_sucesso,ultima_falha,ultimo_erro,falhas_consecutivas FROM sentinela_saude')).rows;
  const consultas_7d = (await db.query(`SELECT count(*) FILTER (WHERE status='ok')::int ok,count(*) FILTER (WHERE status='falha')::int falhas,count(*) FILTER (WHERE status='truncada')::int truncadas FROM sentinela_tarefas WHERE atualizado_em>now()-interval '7 days'`)).rows[0];
  const execucoes = (await db.query(`SELECT to_char(dia,'YYYY-MM-DD') dia,count(*)::int consultas,count(*) FILTER (WHERE status IN ('ok','truncada'))::int concluidas,count(*) FILTER (WHERE status='falha')::int falhas,count(*) FILTER (WHERE status IN ('pendente','executando'))::int abertas,sum(lidos)::int lidos FROM sentinela_tarefas GROUP BY 1 ORDER BY 1 DESC LIMIT 15`)).rows;
  const { rows: [rot] } = await db.query('SELECT * FROM sentinela_ultima_rotina()');
  return { saude, consultas_7d, execucoes, matriz: MATRIZ_FONTES, rotina: rot ?? null };
}
export const EsquemaPesquisa = z.object({ tipo: z.enum(['executar', 'reprocessar_falhas', 'preencher_lacunas']) });
export async function comandarPesquisa(db: PoolClient, d: z.infer<typeof EsquemaPesquisa>, i: Identidade) {
  const org = orgDe(i); let consultas: number;
  if (d.tipo === 'executar') consultas = await pesquisarAgora(db, org, new Date());
  else if (d.tipo === 'preencher_lacunas') consultas = (await preencherLacunas(db, i)).consultas;
  else consultas = (await db.query(`UPDATE sentinela_tarefas SET status='pendente',tentativas=0,erro=NULL,atualizado_em=now() WHERE status='falha' AND dia>=$1`, [somaDias(hoje(), -7)])).rowCount ?? 0;
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: `sentinela.${d.tipo}`, entidade: 'sentinela_tarefa', depois: { consultas } }); return { consultas };
}
export const listarAlertas = async (db: PoolClient) => (await db.query('SELECT id,tipo,canal,status,erro,lido,payload,achado_id,criado_em FROM sentinela_alertas ORDER BY criado_em DESC LIMIT 100')).rows;
export const marcarAlertaLido = async (db: PoolClient, id: string) => { await db.query('UPDATE sentinela_alertas SET lido=TRUE WHERE id=$1', [id]); return { ok: true }; };
export async function verConfig(db: PoolClient, i: Identidade) { const org = orgDe(i); return { prioridade: await obterConfig(db, org, 'prioridade'), motor: await obterConfig(db, org, 'motor') }; }
const ESQUEMAS_CONFIG = {
  prioridade: z.object({ palavras_alta: z.array(z.string().trim().min(1).max(100)).max(100), classes_alta: z.array(z.string().trim().min(1).max(100)).max(100), valor_alto: z.number().positive(), valor_medio: z.number().positive() }),
  motor: z.object({ dias_nova_distribuicao: z.number().int().min(1).max(365), dias_busca_inicial: z.number().int().min(7).max(365) }),
} satisfies Record<ChaveConfig, z.ZodType>;
export async function salvarConfig(db: PoolClient, chave: string, corpo: unknown, i: Identidade) {
  if (!Object.hasOwn(CONFIG_PADRAO, chave)) throw new NaoEncontrado('configuração não encontrada');
  const v = ESQUEMAS_CONFIG[chave as ChaveConfig].safeParse(corpo); if (!v.success) throw new PedidoInvalido(v.error.issues[0]?.message ?? 'configuração inválida');
  const org = orgDe(i); await db.query('INSERT INTO sentinela_config(organizacao_id,chave,valor) VALUES($1,$2,$3) ON CONFLICT(organizacao_id,chave) DO UPDATE SET valor=EXCLUDED.valor,atualizado_em=now()', [org, chave, JSON.stringify(v.data)]);
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'sentinela.config', entidade: 'sentinela_config', depois: { chave } }); return { ok: true };
}
