/**
 * Onboarding do cliente, dentro do projeto: etapas em sequência, cada uma com suas tarefas, quem faz,
 * até quando e de que lado (NGA ou cliente). Vários itens se concluem sozinhos quando o sistema vê o fato
 * (grupo de WhatsApp definido, checklist gerado, CNPJ no Sentinela, fatura emitida, diagnóstico gerado...).
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

type Lado = 'nga' | 'cliente';
interface ItemModelo { titulo: string; lado?: Lado; chave?: string; descricao?: string; dias?: number }
/** Roteiro padrão do escritório. `dias` = prazo contado do início do onboarding. */
export const ROTEIRO: { etapa: string; itens: ItemModelo[] }[] = [
  { etapa: 'Boas-vindas', itens: [
    { titulo: 'Criar o grupo de WhatsApp com o cliente', chave: 'whatsapp', dias: 1, descricao: 'Cole o link do grupo em Clientes ou na visão do projeto: o cliente acessa pelo portal.' },
    { titulo: 'Avisar a equipe sobre a chegada do novo cliente', dias: 1 },
    { titulo: 'Enviar mensagem de boas-vindas ao cliente', dias: 1 },
    { titulo: 'Montar a equipe do projeto (responsável e coordenação)', chave: 'equipe', dias: 2 },
    { titulo: 'Abrir a ficha do cliente (CNPJ, sócios, contatos)', chave: 'cnpj', dias: 2 },
    { titulo: 'Cadastrar o cliente no Astrea', dias: 3 },
    { titulo: 'Colocar o CNPJ no Sentinela (monitorar novas ações)', chave: 'sentinela', dias: 3 },
  ] },
  { etapa: 'Acesso e documentos', itens: [
    { titulo: 'Liberar o portal do cliente', chave: 'portal', dias: 3 },
    { titulo: 'Gerar o checklist de documentos', chave: 'checklist', dias: 3 },
    { titulo: 'Enviar os documentos do checklist', lado: 'cliente', chave: 'documentos_metade', dias: 15, descricao: 'Pelo portal, item por item. Metade dos obrigatórios já libera o diagnóstico.' },
    { titulo: 'Conferir e aprovar os documentos recebidos', chave: 'documentos_aprovados', dias: 20 },
  ] },
  { etapa: 'Contrato e cobrança', itens: [
    { titulo: 'Assinar o contrato de honorários', lado: 'cliente', dias: 5 },
    { titulo: 'Emitir a primeira fatura', chave: 'fatura', dias: 7 },
    { titulo: 'Informar o contato do financeiro do cliente', lado: 'cliente', dias: 7 },
  ] },
  { etapa: 'Diagnóstico', itens: [
    { titulo: 'Gerar o diagnóstico inicial', chave: 'diagnostico', dias: 25 },
    { titulo: 'Mapear o patrimônio dos sócios', chave: 'socios', dias: 25 },
    { titulo: 'Agendar a reunião de apresentação (com pauta)', chave: 'reuniao', dias: 28 },
  ] },
  { etapa: 'Estratégia', itens: [
    { titulo: 'Definir o caminho (RJ, RE ou negociação) e registrar em ata', dias: 35 },
    { titulo: 'Vincular os processos do cliente ao projeto', chave: 'processos', dias: 35 },
    { titulo: 'Distribuir as primeiras tarefas da equipe', chave: 'tarefas', dias: 35 },
  ] },
];

/** Os sinais que concluem item sozinho, calculados de uma vez para o projeto. */
async function sinais(db: PoolClient, projetoId: string): Promise<Record<string, boolean>> {
  const { rows: [s] } = await db.query<Record<string, boolean>>(`SELECT
      (p.whatsapp_grupo_url IS NOT NULL) AS whatsapp,
      EXISTS (SELECT 1 FROM projeto_equipe e WHERE e.projeto_id = p.id AND e.ate IS NULL) AS equipe,
      EXISTS (SELECT 1 FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id WHERE pe.projeto_id = p.id AND coalesce(e.cnpj, '') <> '') AS cnpj,
      EXISTS (SELECT 1 FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id JOIN sentinela_cnpjs k ON k.cnpj = regexp_replace(coalesce(e.cnpj, ''), '\\D', '', 'g') WHERE pe.projeto_id = p.id) AS sentinela,
      EXISTS (SELECT 1 FROM portais po WHERE po.projeto_id = p.id AND po.ativo) AS portal,
      EXISTS (SELECT 1 FROM requisitos r WHERE r.projeto_id = p.id) AS checklist,
      coalesce((SELECT count(*) FILTER (WHERE r.situacao IN ('enviado','em_analise','aprovado')) * 2 >= count(*) AND count(*) > 0 FROM requisitos r WHERE r.projeto_id = p.id AND r.obrigatorio), FALSE) AS documentos_metade,
      coalesce((SELECT count(*) FILTER (WHERE r.situacao = 'aprovado') * 10 >= count(*) * 8 AND count(*) > 0 FROM requisitos r WHERE r.projeto_id = p.id AND r.obrigatorio), FALSE) AS documentos_aprovados,
      EXISTS (SELECT 1 FROM faturas f WHERE f.projeto_id = p.id AND f.situacao <> 'cancelada') AS fatura,
      EXISTS (SELECT 1 FROM diagnostico_versoes v WHERE v.projeto_id = p.id) AS diagnostico,
      EXISTS (SELECT 1 FROM socios_patrimonio s WHERE s.projeto_id = p.id AND s.natureza <> 'sem_bens') AS socios,
      EXISTS (SELECT 1 FROM google_eventos g WHERE g.projeto_id = p.id AND jsonb_array_length(g.pauta) > 0) AS reuniao,
      EXISTS (SELECT 1 FROM processos x WHERE x.projeto_id = p.id) AS processos,
      EXISTS (SELECT 1 FROM tarefas t WHERE t.projeto_id = p.id) AS tarefas
    FROM projetos p WHERE p.id = $1`, [projetoId]);
  return s ?? {};
}

const somaDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Cria o roteiro padrão no projeto (só se ainda não houver nenhum item). */
export async function iniciar(db: PoolClient, projetoId: string, i: Identidade, inicio?: string) {
  const { rows: [p] } = await db.query<{ organizacao_id: string; responsavel_id: string | null }>('SELECT organizacao_id, responsavel_id FROM projetos WHERE id = $1', [projetoId]);
  if (!p) throw new NaoEncontrado('projeto não encontrado');
  if ((await db.query('SELECT 1 FROM onboarding_itens WHERE projeto_id = $1 LIMIT 1', [projetoId])).rowCount) throw new PedidoInvalido('o onboarding deste projeto já foi iniciado');
  const base = inicio ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  for (const [e, etapa] of ROTEIRO.entries()) {
    for (const [o, it] of etapa.itens.entries()) {
      await db.query(`INSERT INTO onboarding_itens (organizacao_id, projeto_id, etapa, ordem_etapa, titulo, ordem, lado, chave, descricao, prazo, responsavel_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [p.organizacao_id, projetoId, etapa.etapa, e, it.titulo, o, it.lado ?? 'nga', it.chave ?? null, it.descricao ?? null, it.dias ? somaDias(base, it.dias) : null, (it.lado ?? 'nga') === 'nga' ? p.responsavel_id : null]);
    }
  }
  await auditar(db, { organizacaoId: p.organizacao_id, usuarioId: i.usuarioId, acao: 'onboarding.iniciado', entidade: 'projeto', entidadeId: projetoId });
  return obter(db, projetoId);
}

export async function obter(db: PoolClient, projetoId: string, somenteCliente = false) {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const { rows } = await db.query<{ id: string; etapa: string; ordem_etapa: number; titulo: string; descricao: string | null; lado: Lado; chave: string | null; prazo: string | null; feito_em: Date | null; responsavel_id: string | null; responsavel: string | null; feito_por: string | null }>(
    `SELECT o.id, o.etapa, o.ordem_etapa, o.titulo, o.descricao, o.lado, o.chave, o.prazo::text, o.feito_em, o.responsavel_id, u.nome AS responsavel, f.nome AS feito_por
       FROM onboarding_itens o LEFT JOIN usuarios u ON u.id = o.responsavel_id LEFT JOIN usuarios f ON f.id = o.feito_por
      WHERE o.projeto_id = $1 ${somenteCliente ? "AND o.lado = 'cliente'" : ''} ORDER BY o.ordem_etapa, o.ordem, o.criado_em`, [projetoId]);
  const sinal = await sinais(db, projetoId);
  const itens = rows.map((r) => {
    const automatico = !!(r.chave && sinal[r.chave]);
    const feito = !!r.feito_em || automatico;
    return { id: r.id, etapa: r.etapa, titulo: r.titulo, descricao: r.descricao, lado: r.lado, chave: r.chave, prazo: r.prazo, responsavelId: r.responsavel_id, responsavel: r.responsavel,
      feito, automatico: automatico && !r.feito_em, feitoEm: r.feito_em, feitoPor: r.feito_por, atrasado: !feito && !!r.prazo && r.prazo < hoje, diasAtraso: !feito && r.prazo && r.prazo < hoje ? Math.round((Date.parse(hoje) - Date.parse(r.prazo)) / 86_400_000) : 0 };
  });
  const etapas: { nome: string; itens: typeof itens; feitos: number; total: number; estado: 'concluida' | 'atual' | 'futura' }[] = [];
  for (const it of itens) { let e = etapas.find((x) => x.nome === it.etapa); if (!e) { e = { nome: it.etapa, itens: [], feitos: 0, total: 0, estado: 'futura' }; etapas.push(e); } e.itens.push(it); e.total++; if (it.feito) e.feitos++; }
  let atualAchada = false;
  for (const e of etapas) { if (e.feitos === e.total) e.estado = 'concluida'; else if (!atualAchada) { e.estado = 'atual'; atualAchada = true; } }
  const total = itens.length; const feitos = itens.filter((x) => x.feito).length;
  const proximas = itens.filter((x) => !x.feito).sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999')).slice(0, 5);
  let tarefas: unknown[] = [];
  if (!somenteCliente) tarefas = (await db.query(`SELECT t.id, t.titulo, t.status, t.prazo::text, u.nome AS responsavel FROM tarefas t LEFT JOIN usuarios u ON u.id = t.responsavel_id WHERE t.projeto_id = $1 AND t.status <> 'concluida' ORDER BY t.prazo NULLS LAST, t.criado_em DESC LIMIT 12`, [projetoId])).rows;
  return { iniciado: total > 0, total, feitos, percentual: total ? Math.round((feitos / total) * 100) : 0, atrasados: itens.filter((x) => x.atrasado).length,
    etapaAtual: etapas.find((e) => e.estado === 'atual')?.nome ?? (total ? 'Concluído' : null), etapas, proximas, tarefas };
}

export const EsquemaItem = z.object({ etapa: z.string().trim().min(2).max(120), titulo: z.string().trim().min(2).max(300), lado: z.enum(['nga', 'cliente']).default('nga'), prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), responsavelId: z.string().uuid().nullable().optional(), descricao: z.string().trim().max(1000).optional() });
export const EsquemaEdicaoItem = z.object({ feito: z.boolean().optional(), prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), responsavelId: z.string().uuid().nullable().optional(), titulo: z.string().trim().min(2).max(300).optional() });

export async function criarItem(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaItem>, i: Identidade) {
  const { rows: [p] } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  if (!p) throw new NaoEncontrado('projeto não encontrado');
  const { rows: [o] } = await db.query<{ oe: number; o: number }>('SELECT coalesce((SELECT ordem_etapa FROM onboarding_itens WHERE projeto_id = $1 AND etapa = $2 LIMIT 1), (SELECT coalesce(max(ordem_etapa), -1) + 1 FROM onboarding_itens WHERE projeto_id = $1)) AS oe, (SELECT coalesce(max(ordem), -1) + 1 FROM onboarding_itens WHERE projeto_id = $1 AND etapa = $2) AS o', [projetoId, d.etapa]);
  const { rows } = await db.query<{ id: string }>('INSERT INTO onboarding_itens (organizacao_id, projeto_id, etapa, ordem_etapa, titulo, ordem, lado, prazo, responsavel_id, descricao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
    [p.organizacao_id, projetoId, d.etapa, o!.oe, d.titulo, o!.o, d.lado, d.prazo ?? null, d.responsavelId ?? null, d.descricao ?? null]);
  await auditar(db, { organizacaoId: p.organizacao_id, usuarioId: i.usuarioId, acao: 'onboarding.item_criado', entidade: 'projeto', entidadeId: projetoId, depois: { titulo: d.titulo } });
  return { id: rows[0]!.id };
}

export async function editarItem(db: PoolClient, id: string, d: z.infer<typeof EsquemaEdicaoItem>, i: Identidade) {
  const sets: string[] = []; const args: unknown[] = [id];
  if (d.feito !== undefined) { args.push(d.feito ? i.usuarioId : null); sets.push(`feito_em = ${d.feito ? 'now()' : 'NULL'}, feito_por = $${args.length}`); }
  if (d.prazo !== undefined) { args.push(d.prazo); sets.push(`prazo = $${args.length}`); }
  if (d.responsavelId !== undefined) { args.push(d.responsavelId); sets.push(`responsavel_id = $${args.length}`); }
  if (d.titulo !== undefined) { args.push(d.titulo); sets.push(`titulo = $${args.length}`); }
  if (!sets.length) throw new PedidoInvalido('nada a alterar');
  const { rows } = await db.query<{ organizacao_id: string; projeto_id: string; titulo: string }>(`UPDATE onboarding_itens SET ${sets.join(', ')} WHERE id = $1 RETURNING organizacao_id, projeto_id, titulo`, args);
  if (!rows[0]) throw new NaoEncontrado('item não encontrado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'onboarding.item_alterado', entidade: 'projeto', entidadeId: rows[0].projeto_id, depois: { titulo: rows[0].titulo, ...d } });
  return { ok: true };
}

export async function excluirItem(db: PoolClient, id: string, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; projeto_id: string }>('DELETE FROM onboarding_itens WHERE id = $1 RETURNING organizacao_id, projeto_id', [id]);
  if (!rows[0]) throw new NaoEncontrado('item não encontrado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'onboarding.item_excluido', entidade: 'projeto', entidadeId: rows[0].projeto_id });
  return { ok: true };
}

/** Painel lateral: onboardings em andamento de todos os projetos visíveis, do mais atrasado ao mais adiantado. */
export async function emAndamento(db: PoolClient) {
  const { rows } = await db.query<{ projeto_id: string }>(`SELECT DISTINCT projeto_id FROM onboarding_itens`);
  const lista = [];
  for (const r of rows) {
    const o = await obter(db, r.projeto_id);
    if (o.feitos === o.total) continue;
    const { rows: [p] } = await db.query<{ nome: string }>('SELECT nome FROM projetos WHERE id = $1', [r.projeto_id]);
    lista.push({ projetoId: r.projeto_id, projeto: p?.nome ?? '—', percentual: o.percentual, etapaAtual: o.etapaAtual, atrasados: o.atrasados, proxima: o.proximas[0] ?? null });
  }
  return lista.sort((a, b) => b.atrasados - a.atrasados || a.percentual - b.percentual).slice(0, 30);
}
