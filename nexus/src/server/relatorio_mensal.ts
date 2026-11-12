/**
 * Relatório mensal do cliente a partir do que está no NEXUS (não mais do PDF bruto do Astrea).
 *
 * Mesmas seções do relatório que o Gerador monta hoje a partir do Astrea: indicadores da carteira, natureza dos
 * processos, acontecimentos do mês, entregas da equipe, próximos passos e linha do tempo do caso. A diferença é a
 * fonte: processos, andamentos (DataJud e manuais), publicações, prazos, tarefas, reuniões, atas e marcos do
 * projeto. Toda seção sem dado diz que não tem, e a falta vai para "O que este relatório não afirma".
 */
import type { PoolClient } from 'pg';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado } from './erros.ts';
import { classificar } from '../domain/processo/andamentos.ts';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const fimDoMes = (mes: string) => { const [a, m] = mes.split('-').map(Number); return new Date(Date.UTC(a!, m!, 0)).toISOString().slice(0, 10); };
const somar = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export async function montar(db: PoolClient, projetoId: string, mes: string, i: Identidade) {
  const de = `${mes}-01`; const ate = fimDoMes(mes);
  const { rows: [p] } = await db.query<{ nome: string; tipo: string; fase: string | null; cliente: string | null; cnpj: string | null; responsavel: string | null }>(
    `SELECT p.nome, p.tipo, p.fase, (SELECT coalesce(e.razao_social, e.nome_fantasia) FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id WHERE pe.projeto_id = p.id ORDER BY pe.papel LIMIT 1) AS cliente,
            (SELECT e.cnpj FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id WHERE pe.projeto_id = p.id ORDER BY pe.papel LIMIT 1) AS cnpj,
            (SELECT u.nome FROM usuarios u WHERE u.id = p.responsavel_id) AS responsavel FROM projetos p WHERE p.id = $1`, [projetoId]);
  if (!p) throw new NaoEncontrado('projeto não encontrado');
  const lacunas: string[] = [];

  const { rows: procs } = await db.query<{ id: string; numero: string; classe: string | null; situacao: string; valor: string | null; tribunal: string | null; orgao: string | null; movs: number }>(
    `SELECT pr.id, pr.numero, pr.classe, pr.situacao, pr.valor_causa::text AS valor, pr.tribunal, pr.orgao_julgador AS orgao,
            (SELECT count(*)::int FROM movimentacoes m WHERE m.processo_id = pr.id AND m.data BETWEEN $2 AND $3) AS movs
       FROM processos pr WHERE pr.projeto_id = $1 ORDER BY pr.distribuido_em NULLS LAST, pr.numero`, [projetoId, de, ate]);
  if (!procs.length) lacunas.push('Nenhum processo vinculado ao projeto no Nexus: indicadores processuais não calculados.');

  const { rows: movs } = await db.query<{ data: string; titulo: string; conteudo: string | null; fonte: string; numero: string; resumo: string | null }>(
    `SELECT m.data::text, m.titulo, m.conteudo, m.fonte, pr.numero, m.resumo_ao_cliente AS resumo FROM movimentacoes m JOIN processos pr ON pr.id = m.processo_id
      WHERE pr.projeto_id = $1 AND m.data BETWEEN $2 AND $3 ORDER BY m.data, m.criado_em`, [projetoId, de, ate]);
  const { rows: hist } = await db.query<{ data: string; titulo: string; texto: string | null }>('SELECT data::text, titulo, texto FROM projeto_historicos WHERE projeto_id = $1 AND data BETWEEN $2 AND $3 ORDER BY data', [projetoId, de, ate]);
  const { rows: pubs } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM publicacoes pb JOIN processos pr ON pr.id = pb.processo_id WHERE pr.projeto_id = $1 AND pb.data_disponibilizacao BETWEEN $2 AND $3`, [projetoId, de, ate]);
  const { rows: prazosFeitos } = await db.query<{ titulo: string; vencimento: string; cumprido: string; numero: string }>(
    `SELECT z.titulo, z.vencimento::text, (z.cumprido_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS cumprido, pr.numero FROM prazos z JOIN processos pr ON pr.id = z.processo_id
      WHERE pr.projeto_id = $1 AND z.situacao = 'cumprido' AND (z.cumprido_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3 ORDER BY z.cumprido_em`, [projetoId, de, ate]);
  const { rows: tarefasFeitas } = await db.query<{ titulo: string; concluida: string }>(
    `SELECT titulo, (concluida_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS concluida FROM tarefas WHERE projeto_id = $1 AND status = 'concluida' AND (concluida_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3 ORDER BY concluida_em`, [projetoId, de, ate]);
  const { rows: atas } = await db.query<{ titulo: string; realizada: string; decisoes: string | null }>('SELECT titulo, realizada_em::text AS realizada, decisoes FROM atas WHERE projeto_id = $1 AND realizada_em BETWEEN $2 AND $3 ORDER BY realizada_em', [projetoId, de, ate]);
  const { rows: reunioes } = await db.query<{ titulo: string; inicio: Date; pauta: { texto: string; feito?: boolean; decisao?: string }[] }>(
    `SELECT titulo, inicio, pauta FROM google_eventos WHERE projeto_id = $1 AND (inicio AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3 ORDER BY inicio`, [projetoId, de, ate]);
  const prox = somar(ate, 45);
  const { rows: prazosAbertos } = await db.query<{ titulo: string; vencimento: string; numero: string }>(
    `SELECT z.titulo, z.vencimento::text, pr.numero FROM prazos z JOIN processos pr ON pr.id = z.processo_id WHERE pr.projeto_id = $1 AND z.situacao = 'aberto' AND z.vencimento <= $2 ORDER BY z.vencimento LIMIT 20`, [projetoId, prox]);
  const { rows: tarefasAbertas } = await db.query<{ titulo: string; prazo: string | null }>(`SELECT titulo, prazo::text FROM tarefas WHERE projeto_id = $1 AND status <> 'concluida' ORDER BY prazo NULLS LAST LIMIT 15`, [projetoId]);
  const { rows: agendadas } = await db.query<{ titulo: string; inicio: Date }>(`SELECT titulo, inicio FROM google_eventos WHERE projeto_id = $1 AND inicio > $2::date + 1 ORDER BY inicio LIMIT 8`, [projetoId, ate]);
  const { rows: marcos } = await db.query<{ titulo: string; prevista: string | null; concluido: string | null; visivel: boolean }>(
    `SELECT titulo, data_prevista::text AS prevista, (concluido_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS concluido, visivel_cliente AS visivel FROM projeto_marcos WHERE projeto_id = $1 ORDER BY coalesce(concluido_em::date, data_prevista) NULLS LAST`, [projetoId]);

  // Indicadores no mesmo espírito do Gerador: processos (CNJ distintos), ativos, valor, movimentados e registros por tipo.
  const ativos = procs.filter((x) => ['ativo', 'suspenso'].includes(x.situacao)).length;
  const valor = procs.reduce((s, x) => s + Number(x.valor ?? 0), 0);
  const movimentados = procs.filter((x) => x.movs > 0).length;
  const registros = {
    andamentos: movs.filter((m) => m.fonte !== 'manual').length, historicosManuais: movs.filter((m) => m.fonte === 'manual').length + hist.length,
    publicacoes: pubs[0]?.n ?? 0, prazosCumpridos: prazosFeitos.length, tarefasConcluidas: tarefasFeitas.length, reunioes: reunioes.length, atas: atas.length,
  };
  const natureza = [...procs.reduce((m, x) => m.set(x.classe ?? 'Classe não informada', (m.get(x.classe ?? 'Classe não informada') ?? 0) + 1), new Map<string, number>())]
    .map(([classe, n]) => ({ classe, n })).sort((a, b) => b.n - a.n);

  // Acontecimentos: o que muda o caso (decisivo e relevante) + o que a equipe registrou. Texto ao cliente, quando houver, tem preferência.
  const acontecimentos = [
    ...movs.map((m) => ({ data: m.data, ...(m.fonte === 'manual' && classificar(m.titulo).categoria === 'Outro' ? { categoria: 'Registro da equipe', peso: 'relevante' as const } : classificar(m.titulo)), texto: m.resumo ?? m.titulo, detalhe: m.conteudo, processo: m.numero, fonte: m.fonte }))
      .filter((m) => m.peso !== 'rotina' || m.fonte === 'manual'),
    ...hist.map((h) => ({ data: h.data, categoria: 'Registro da equipe', peso: 'relevante' as const, texto: h.titulo, detalhe: h.texto, processo: null, fonte: 'manual' })),
  ].sort((a, b) => a.data.localeCompare(b.data));
  const rotina = movs.filter((m) => classificar(m.titulo).peso === 'rotina' && m.fonte !== 'manual').length;

  const entregas = [
    ...prazosFeitos.map((z) => ({ data: z.cumprido, tipo: 'Prazo cumprido', texto: z.titulo, ref: z.numero })),
    ...tarefasFeitas.map((t) => ({ data: t.concluida, tipo: 'Tarefa concluída', texto: t.titulo, ref: null })),
    ...atas.map((a) => ({ data: a.realizada, tipo: 'Reunião com ata', texto: a.titulo, ref: null })),
    ...reunioes.filter((r) => !atas.some((a) => a.titulo === r.titulo)).map((r) => ({ data: new Date(r.inicio).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), tipo: 'Reunião', texto: r.titulo, ref: (r.pauta ?? []).length ? `${(r.pauta ?? []).filter((x) => x.feito).length}/${(r.pauta ?? []).length} itens da pauta` : null })),
  ].sort((a, b) => a.data.localeCompare(b.data));

  const proximos = [
    ...prazosAbertos.map((z) => ({ data: z.vencimento, tipo: z.vencimento < new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) ? 'Prazo vencido em aberto' : 'Prazo', texto: z.titulo, ref: z.numero })),
    ...agendadas.map((r) => ({ data: new Date(r.inicio).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), tipo: 'Reunião', texto: r.titulo, ref: null })),
    ...tarefasAbertas.filter((t) => t.prazo).map((t) => ({ data: t.prazo!, tipo: 'Tarefa', texto: t.titulo, ref: null })),
  ].sort((a, b) => a.data.localeCompare(b.data)).slice(0, 15);

  if (procs.length && !movs.length) lacunas.push('Nenhum andamento registrado no mês (DataJud ou manual).');
  const semDataJud = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM processos pr LEFT JOIN datajud_monitor m ON m.processo_id = pr.id WHERE pr.projeto_id = $1 AND (m.ultimo_sucesso IS NULL)`, [projetoId])).rows[0]?.n ?? 0;
  if (semDataJud) lacunas.push(`${semDataJud} processo(s) ainda não consultado(s) no DataJud: seus andamentos podem estar incompletos.`);
  if (!marcos.length) lacunas.push('Nenhum marco cadastrado no projeto: a linha do tempo mostra só a fase atual.');
  if (!entregas.length) lacunas.push('Nenhuma entrega registrada no mês (prazo cumprido, tarefa concluída, reunião ou ata).');

  const [a, m] = mes.split('-');
  return {
    fonte: 'NGA Nexus', geradoEm: new Date().toISOString(), geradoPor: i.nome,
    cabecalho: { cliente: p.cliente ?? p.nome, cnpj: p.cnpj && p.cnpj.replace(/\D/g, '').length === 14 ? p.cnpj.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : p.cnpj, projeto: p.nome, tipo: p.tipo, fase: p.fase, responsavel: p.responsavel, periodo: { de, ate, rotulo: `${MESES[Number(m) - 1]} de ${a}` } },
    indicadores: { processos: procs.length, ativos, valorCausa: valor, movimentados, registros, totalRegistros: Object.values(registros).reduce((s, n) => s + n, 0), rotina },
    natureza, processos: procs.map((x) => ({ numero: x.numero, classe: x.classe, situacao: x.situacao, tribunal: x.tribunal, orgao: x.orgao, movimentos: x.movs })),
    acontecimentos, entregas, proximos, marcos, lacunas,
  };
}

/** Quanto cada cliente já tem de dado no Nexus para o relatório mensal sair daqui (a meta para o próximo ano). */
export async function prontidao(db: PoolClient, mes: string) {
  const de = `${mes}-01`; const ate = fimDoMes(mes);
  const { rows } = await db.query<Record<string, any>>(`SELECT p.id, p.nome,
      (SELECT count(*)::int FROM processos pr WHERE pr.projeto_id = p.id) AS processos,
      (SELECT count(*)::int FROM processos pr JOIN datajud_monitor d ON d.processo_id = pr.id WHERE pr.projeto_id = p.id AND d.ultimo_sucesso IS NOT NULL) AS no_datajud,
      (SELECT count(*)::int FROM movimentacoes mv JOIN processos pr ON pr.id = mv.processo_id WHERE pr.projeto_id = p.id AND mv.data BETWEEN $1 AND $2) AS andamentos,
      (SELECT count(*)::int FROM prazos z JOIN processos pr ON pr.id = z.processo_id WHERE pr.projeto_id = p.id AND z.vencimento BETWEEN $1 AND $2) AS prazos,
      (SELECT count(*)::int FROM tarefas t WHERE t.projeto_id = p.id AND (t.criado_em::date BETWEEN $1 AND $2 OR t.concluida_em::date BETWEEN $1 AND $2)) AS tarefas,
      (SELECT count(*)::int FROM google_eventos g WHERE g.projeto_id = p.id AND g.inicio::date BETWEEN $1 AND $2) + (SELECT count(*)::int FROM atas x WHERE x.projeto_id = p.id AND x.realizada_em BETWEEN $1 AND $2) AS reunioes,
      (SELECT count(*)::int FROM projeto_marcos k WHERE k.projeto_id = p.id) AS marcos,
      (SELECT count(*)::int FROM astrea_registros r WHERE r.projeto_id = p.id) AS astrea
    FROM projetos p WHERE p.situacao <> 'encerrado' ORDER BY p.nome`, [de, ate]);
  return rows.map((r) => {
    const pilares = [r.processos > 0, r.processos > 0 && r.no_datajud >= r.processos * 0.8, r.andamentos > 0, r.prazos + r.tarefas > 0, r.reunioes > 0, r.marcos > 0];
    return { projetoId: r.id, projeto: r.nome, processos: r.processos, noDatajud: r.no_datajud, andamentos: r.andamentos, prazos: r.prazos, tarefas: r.tarefas, reunioes: r.reunioes, marcos: r.marcos, registrosAstrea: r.astrea,
      prontidao: Math.round((pilares.filter(Boolean).length / pilares.length) * 100) };
  });
}
