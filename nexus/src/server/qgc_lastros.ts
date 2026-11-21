/**
 * QGC vivo: valor sujeito, lastro de cada crédito e acesso do administrador judicial.
 *
 * - Valor do crédito x valor sujeito: garantia fiduciária (ou outra do art. 49, § 3º) que não cobre o crédito
 *   inteiro deixa o SALDO DESCOBERTO sujeito à recuperação, como quirografário. O sistema identifica (natureza
 *   fiduciária com bem gravado menor que o crédito) e sugere; a equipe aplica ou ajusta à mão.
 * - Lastro: cada crédito aponta para o(s) documento(s) que o provam. A correlação automática procura, nos
 *   documentos do projeto (título, nome do arquivo e texto já lido), o CPF/CNPJ do credor ou o nome dele.
 *   Roda de novo sempre que o cliente manda documento: o QGC é parte viva do projeto.
 * - Administrador judicial: link próprio (credencial com hash, validade e revogação), que entrega o QGC com
 *   os lastros e abre cada documento no navegador. Não alcança mais nada do sistema.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { formatarReais } from '../domain/shared/dinheiro.ts';

const FIDUCIARIAS = new Set(['proprietario_fiduciario', 'arrendamento_mercantil', 'reserva_dominio', 'promitente_vendedor_irrevogavel', 'adiantamento_contrato_cambio']);
const norm = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const so = (s: string | null) => String(s ?? '').replace(/\D/g, '');
const PALAVRAS_FRACAS = new Set(['S', 'A', 'SA', 'LTDA', 'ME', 'EPP', 'EIRELI', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'BANCO', 'COOPERATIVA', 'CREDITO', 'COMERCIO', 'INDUSTRIA', 'SERVICOS', 'BRASIL', 'DO BRASIL', 'CIA', 'COMPANHIA', 'LTDA.', 'S/A']);
/** Palavras que identificam o credor (sem "LTDA", "BANCO", "DE"...). "Banco Bradesco S/A" → ["BRADESCO"]. */
export function palavrasDoCredor(nome: string) {
  return norm(nome).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((p) => p.length >= 4 && !PALAVRAS_FRACAS.has(p));
}

export const EsquemaSujeito = z.object({
  /** Centavos (string) ou null para voltar ao automático. */
  valorSujeito: z.string().regex(/^\d+$/).nullable(),
  garantiaDescricao: z.string().trim().max(500).nullable().optional(),
});
export const EsquemaLastro = z.object({ documentoId: z.string().uuid(), pagina: z.number().int().positive().nullable().optional() });
export const EsquemaSituacaoLastro = z.object({ situacao: z.enum(['confirmado', 'recusado', 'sugerido']) });
export const EsquemaAcessoAj = z.object({
  nome: z.string().trim().min(2).max(160), email: z.string().trim().email().max(200).nullable().optional(),
  papel: z.enum(['administrador_judicial', 'perito', 'auditor', 'outro']).default('administrador_judicial'),
  dias: z.number().int().min(1).max(365).default(90), soValidado: z.boolean().default(true),
});

/** Créditos com garantia parcial: natureza do art. 49, § 3º e bem gravado menor que o crédito. */
export function sugestaoDeSujeito(c: { natureza: string; valor: string; valor_bem_gravado: string | null; valor_sujeito: string | null }) {
  if (!FIDUCIARIAS.has(c.natureza) || c.valor_bem_gravado === null) return null;
  const valor = BigInt(c.valor); const bem = BigInt(c.valor_bem_gravado);
  if (bem >= valor) return null;
  const saldo = valor - bem;
  if (c.valor_sujeito !== null && BigInt(c.valor_sujeito) === saldo) return null; // já aplicado
  return { valorSujeito: saldo.toString(), valorSujeitoFormatado: formatarReais(saldo), garantiaFormatada: formatarReais(bem),
    motivo: `Garantia de R$ ${formatarReais(bem)} não cobre o crédito de R$ ${formatarReais(valor)}: o saldo de R$ ${formatarReais(saldo)} fica sujeito à recuperação como quirografário.` };
}

export async function definirSujeito(db: PoolClient, creditoId: string, d: z.infer<typeof EsquemaSujeito>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; valor: string; valor_sujeito: string | null }>('SELECT organizacao_id, valor::text, valor_sujeito::text FROM creditos WHERE id = $1', [creditoId]);
  const c = rows[0]; if (!c) throw new NaoEncontrado('crédito não encontrado');
  if (d.valorSujeito !== null && BigInt(d.valorSujeito) > BigInt(c.valor)) throw new PedidoInvalido('o valor sujeito não pode ser maior que o valor do crédito');
  await db.query(`UPDATE creditos SET valor_sujeito = $2, garantia_descricao = CASE WHEN $3::boolean THEN $4 ELSE garantia_descricao END, atualizado_em = now() WHERE id = $1`,
    [creditoId, d.valorSujeito, d.garantiaDescricao !== undefined, d.garantiaDescricao ?? null]);
  await auditar(db, { organizacaoId: c.organizacao_id, usuarioId: i.usuarioId, acao: 'credito.valor_sujeito', entidade: 'credito', entidadeId: creditoId, antes: { valorSujeito: c.valor_sujeito }, depois: d });
  return { ok: true };
}

/**
 * Correlaciona crédito ↔ documento. Peso: CPF/CNPJ do credor no título, no nome ou no texto lido = forte;
 * todas as palavras do nome do credor no título/nome do arquivo = médio. Não mexe no que alguém já confirmou ou recusou.
 */
export async function correlacionar(db: PoolClient, projetoId: string, usuarioId: string | null) {
  const { rows: creditos } = await db.query<{ id: string; organizacao_id: string; credor: string; documento: string | null }>(
    `SELECT c.id, c.organizacao_id, cr.nome credor, cr.documento FROM creditos c JOIN credores cr ON cr.id = c.credor_id WHERE c.projeto_id = $1`, [projetoId]);
  if (!creditos.length) return { novos: 0, creditosComLastro: 0, creditos: 0 };
  const { rows: docs } = await db.query<{ id: string; titulo: string; nome: string; texto: string | null }>(
    `SELECT d.id, d.titulo, coalesce(d.nome_original, '') nome, left(t.texto, 400000) texto FROM documentos d LEFT JOIN documento_textos t ON t.documento_id = d.id
      WHERE d.projeto_id = $1 AND d.tem_arquivo`, [projetoId]);
  const prep = docs.map((d) => ({ id: d.id, cab: norm(`${d.titulo} ${d.nome}`), digitos: so(`${d.titulo} ${d.nome} ${d.texto ?? ''}`), texto: d.texto ? norm(d.texto) : '' }));
  let novos = 0; const com = new Set<string>();
  for (const c of creditos) {
    const doc = so(c.documento); const palavras = palavrasDoCredor(c.credor);
    for (const d of prep) {
      let motivo: string | null = null;
      if (doc.length >= 11 && d.digitos.includes(doc)) motivo = `CPF/CNPJ do credor (${c.documento}) aparece no documento`;
      else if (palavras.length && palavras.every((p) => d.cab.includes(p))) motivo = `Nome do credor no título do arquivo (${palavras.join(' ')})`;
      else if (palavras.length >= 2 && d.texto && palavras.every((p) => d.texto.includes(p))) motivo = `Nome do credor no texto do documento (${palavras.join(' ')})`;
      if (!motivo) continue;
      com.add(c.id);
      const r = await db.query(`INSERT INTO credito_lastros (organizacao_id, projeto_id, credito_id, documento_id, situacao, motivo, criado_por) VALUES ($1,$2,$3,$4,'sugerido',$5,$6)
        ON CONFLICT (credito_id, documento_id) DO NOTHING`, [c.organizacao_id, projetoId, c.id, d.id, motivo.slice(0, 300), usuarioId]);
      novos += r.rowCount ?? 0;
    }
  }
  return { novos, creditosComLastro: com.size, creditos: creditos.length };
}

/** Lastros do projeto, por crédito, e os documentos novos do cliente desde a última correlação/leitura. */
export async function painel(db: PoolClient, projetoId: string) {
  const [lastros, novos, creditos, acessos] = await Promise.all([
    db.query(`SELECT l.id, l.credito_id "creditoId", l.documento_id "documentoId", l.situacao, l.motivo, l.pagina, d.titulo, coalesce(d.nome_original, d.titulo) nome, d.tipo_mime "tipoMime", d.origem
                FROM credito_lastros l JOIN documentos d ON d.id = l.documento_id WHERE l.projeto_id = $1 ORDER BY l.situacao, d.titulo`, [projetoId]),
    db.query(`SELECT d.id, d.titulo, d.criado_em "criadoEm" FROM documentos d WHERE d.projeto_id = $1 AND d.origem = 'portal_cliente' AND d.tem_arquivo
                AND d.criado_em > coalesce((SELECT max(criado_em) FROM credito_lastros WHERE projeto_id = $1), (SELECT max(criado_em) FROM qgc_preliminar WHERE projeto_id = $1), '-infinity'::timestamptz)
              ORDER BY d.criado_em DESC LIMIT 20`, [projetoId]),
    db.query<{ id: string; natureza: string; valor: string; valor_bem_gravado: string | null; valor_sujeito: string | null; garantia_descricao: string | null; credor: string }>(
      `SELECT c.id, c.natureza, c.valor::text, c.valor_bem_gravado::text, c.valor_sujeito::text, c.garantia_descricao, cr.nome credor FROM creditos c JOIN credores cr ON cr.id = c.credor_id WHERE c.projeto_id = $1`, [projetoId]),
    db.query(`SELECT id, nome, email, papel, so_validado "soValidado", criado_em "criadoEm", expira_em "expiraEm", revogado_em "revogadoEm", ultimo_uso "ultimoUso", usos
                FROM qgc_acessos_externos WHERE projeto_id = $1 ORDER BY criado_em DESC`, [projetoId]),
  ]);
  const sugestoes = creditos.rows.map((c) => ({ creditoId: c.id, credor: c.credor, ...sugestaoDeSujeito(c) })).filter((x) => 'valorSujeito' in x);
  const porCredito: Record<string, unknown[]> = {};
  for (const l of lastros.rows as any[]) (porCredito[l.creditoId] ??= []).push(l);
  return {
    lastros: porCredito,
    semLastro: creditos.rows.filter((c) => !(porCredito[c.id] ?? []).some((l: any) => l.situacao !== 'recusado')).length,
    documentosNovos: novos.rows, sugestoesSujeito: sugestoes,
    sujeitos: Object.fromEntries(creditos.rows.map((c) => [c.id, { valorSujeito: c.valor_sujeito, garantia: c.garantia_descricao }])),
    acessos: acessos.rows,
  };
}

export async function vincular(db: PoolClient, creditoId: string, d: z.infer<typeof EsquemaLastro>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; projeto_id: string }>('SELECT organizacao_id, projeto_id FROM creditos WHERE id = $1', [creditoId]);
  const c = rows[0]; if (!c) throw new NaoEncontrado('crédito não encontrado');
  const { rows: doc } = await db.query('SELECT 1 FROM documentos WHERE id = $1 AND projeto_id = $2', [d.documentoId, c.projeto_id]);
  if (!doc[0]) throw new PedidoInvalido('o documento não é deste projeto');
  await db.query(`INSERT INTO credito_lastros (organizacao_id, projeto_id, credito_id, documento_id, situacao, motivo, pagina, criado_por) VALUES ($1,$2,$3,$4,'confirmado','Vinculado pela equipe',$5,$6)
    ON CONFLICT (credito_id, documento_id) DO UPDATE SET situacao = 'confirmado', pagina = EXCLUDED.pagina`, [c.organizacao_id, c.projeto_id, creditoId, d.documentoId, d.pagina ?? null, i.usuarioId]);
  await auditar(db, { organizacaoId: c.organizacao_id, usuarioId: i.usuarioId, acao: 'credito.lastro_vinculado', entidade: 'credito', entidadeId: creditoId, depois: d });
  return { ok: true };
}

export async function situacaoDoLastro(db: PoolClient, lastroId: string, d: z.infer<typeof EsquemaSituacaoLastro>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; credito_id: string }>('UPDATE credito_lastros SET situacao = $2 WHERE id = $1 RETURNING organizacao_id, credito_id', [lastroId, d.situacao]);
  if (!rows[0]) throw new NaoEncontrado('lastro não encontrado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'credito.lastro_' + d.situacao, entidade: 'credito', entidadeId: rows[0].credito_id });
  return { ok: true };
}

// ---------------------------------------------------- administrador judicial ---
export const PREFIXO_AJ = 'nga_aj_';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
export const pareceTokenAj = (t: string | null | undefined): t is string => !!t && /^nga_aj_[A-Za-z0-9_-]{40,64}$/.test(t);

export async function criarAcesso(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaAcessoAj>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  if (!rows[0]) throw new NaoEncontrado('projeto não encontrado');
  const token = PREFIXO_AJ + randomBytes(32).toString('base64url');
  const { rows: [a] } = await db.query<{ id: string; expira_em: Date }>(
    `INSERT INTO qgc_acessos_externos (organizacao_id, projeto_id, token_hash, nome, email, papel, so_validado, criado_por, expira_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(days => $9)) RETURNING id, expira_em`,
    [rows[0].organizacao_id, projetoId, hash(token), d.nome, d.email ?? null, d.papel, d.soValidado, i.usuarioId, d.dias]);
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'qgc.acesso_externo_criado', entidade: 'projeto', entidadeId: projetoId, depois: { nome: d.nome, papel: d.papel, dias: d.dias } });
  return { id: a!.id, token, expiraEm: a!.expira_em, caminho: `/qgc-aj.html#${token}` };
}
export async function revogarAcesso(db: PoolClient, id: string, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; projeto_id: string }>('UPDATE qgc_acessos_externos SET revogado_em = now() WHERE id = $1 AND revogado_em IS NULL RETURNING organizacao_id, projeto_id', [id]);
  if (!rows[0]) throw new NaoEncontrado('acesso não encontrado ou já revogado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'qgc.acesso_externo_revogado', entidade: 'projeto', entidadeId: rows[0].projeto_id });
  return { ok: true };
}

/** Leitura sem sessão (página do AJ). */
export async function lerPeloAcesso(db: PoolClient, token: string) {
  const { rows } = await db.query<{ acesso_id: string; projeto: string; nome: string; so_validado: boolean; creditos: any[] }>('SELECT * FROM qgc_pelo_acesso($1)', [hash(token)]);
  const a = rows[0]; if (!a) return null;
  let total = 0n, sujeito = 0n; const porClasse: Record<string, bigint> = {};
  for (const c of a.creditos) {
    total += BigInt(c.valor); sujeito += BigInt(c.valorSujeito);
    if (BigInt(c.valorSujeito) > 0n) porClasse[c.classe ?? '?'] = (porClasse[c.classe ?? '?'] ?? 0n) + BigInt(c.valorSujeito);
    c.valorFormatado = formatarReais(BigInt(c.valor)); c.valorSujeitoFormatado = formatarReais(BigInt(c.valorSujeito));
  }
  return { projeto: a.projeto, destinatario: a.nome, soValidado: a.so_validado, creditos: a.creditos,
    resumo: { credores: new Set(a.creditos.map((c) => c.credor)).size, total: formatarReais(total), sujeito: formatarReais(sujeito), extraconcursal: formatarReais(total - sujeito),
      porClasse: Object.entries(porClasse).sort().map(([classe, v]) => ({ classe, valor: formatarReais(v) })),
      comLastro: a.creditos.filter((c) => c.lastros.length).length } };
}
export async function lastroPeloAcesso(db: PoolClient, token: string, documentoId: string) {
  const { rows } = await db.query<{ documento_id: string; organizacao_id: string; caminho: string; hash_sha256: string | null; conteudo: Buffer | null; nome: string; tipo_mime: string | null; acesso_id: string; projeto_id: string }>(
    'SELECT * FROM lastro_pelo_acesso($1, $2)', [hash(token), documentoId]);
  return rows[0] ?? null;
}
