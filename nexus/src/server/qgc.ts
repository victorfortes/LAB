/**
 * QGC do projeto em duas vistas:
 *  - automático (preliminar): lido do balancete, editável linha a linha;
 *  - validado: os créditos de `creditos`, que recebem as linhas validadas, os
 *    lançamentos manuais e a relação final de credores enviada pelo cliente.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getDocumentProxy } from 'unpdf';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { lerConteudoDocumento, type Deposito } from './arquivos.ts';
import { chaveDoHash } from '../store/arquivos.ts';
import { tabelasDe } from '../domain/diagnostico/planilhas.ts';
import { linhasDeTabela, linhasDeTexto, qgcPreliminar, type LinhaBalancete } from '../domain/insolvencia/balancete.ts';
import { enquadrar, type Credito, type NaturezaCredito } from '../domain/insolvencia/creditos.ts';
import { formatarReais } from '../domain/shared/dinheiro.ts';
import { valorBr } from '../domain/financeiro/importacao.ts';

export const NATUREZAS_QGC = ['trabalhista', 'acidente_trabalho', 'garantia_real', 'quirografario', 'privilegio_especial', 'privilegio_geral',
  'subordinado', 'me_epp', 'tributario', 'proprietario_fiduciario', 'arrendamento_mercantil', 'reserva_dominio',
  'promitente_vendedor_irrevogavel', 'adiantamento_contrato_cambio', 'posterior_ao_pedido'] as const;
const centavos = z.string().regex(/^\d+$/, 'valor em centavos, só dígitos');

async function organizacao(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  if (!rows[0]) throw new NaoEncontrado('projeto não encontrado');
  return rows[0].organizacao_id;
}

/** Linhas de texto de um PDF, agrupando os pedaços pela altura na página (uma linha visual = uma linha). */
async function linhasDoPdf(bytes: Uint8Array): Promise<string[][]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const paginas: string[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const conteudo = await (await pdf.getPage(p)).getTextContent();
    const porY = new Map<number, { x: number; s: string }[]>();
    for (const it of conteudo.items as { str?: string; transform?: number[] }[]) {
      if (!it.str?.trim() || !it.transform) continue;
      const y = Math.round(it.transform[5]! / 2) * 2;
      porY.set(y, [...(porY.get(y) ?? []), { x: it.transform[4]!, s: it.str }]);
    }
    paginas.push([...porY.entries()].sort((a, b) => b[0] - a[0]).map(([, xs]) => xs.sort((a, b) => a.x - b.x).map((x) => x.s).join(' ')));
  }
  return paginas;
}

async function lerBalancete(nome: string, bytes: Uint8Array): Promise<{ linhas: LinhaBalancete[]; avisos: string[] }> {
  const ext = nome.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    const paginas = await linhasDoPdf(bytes);
    const texto = paginas.flat().join('').length;
    if (texto < 40 * Math.max(1, paginas.length)) return { linhas: [], avisos: [`${nome}: PDF sem texto (digitalizado). Envie o balancete em XLSX, CSV ou PDF gerado pelo sistema contábil.`] };
    return { linhas: linhasDeTexto(nome, paginas), avisos: [] };
  }
  const linhas: LinhaBalancete[] = [];
  for (const t of tabelasDe(nome, bytes)) linhas.push(...linhasDeTabela(nome, t.aba, t.linhas));
  return { linhas, avisos: [] };
}

const ORDEM_NATUREZA: Record<string, number> = { trabalhista: 1, acidente_trabalho: 1, garantia_real: 2, quirografario: 3, me_epp: 4, subordinado: 5 };

export async function listar(db: PoolClient, projetoId: string) {
  await organizacao(db, projetoId);
  const { rows } = await db.query(`SELECT q.id, q.documento_id AS "documentoId", d.titulo AS documento, q.referencia, q.codigo, q.conta, q.grupo, q.credor,
      q.documento_credor AS "documentoCredor", q.natureza, q.classe_sugerida AS classe, q.sujeito_sugerido AS sujeito, q.valor::text AS valor, q.motivo,
      q.hipotese, q.situacao, q.editado, q.credito_id AS "creditoId", q.criado_em AS "criadoEm"
    FROM qgc_preliminar q LEFT JOIN documentos d ON d.id = q.documento_id
   WHERE q.projeto_id = $1 AND q.situacao <> 'descartado'`, [projetoId]);
  rows.sort((a, b) => (ORDEM_NATUREZA[a.natureza] ?? 9) - (ORDEM_NATUREZA[b.natureza] ?? 9) || Number(BigInt(b.valor) - BigInt(a.valor)));
  const porClasse = new Map<string, { valor: bigint; n: number }>();
  let total = 0n, foraDaRj = 0n;
  for (const r of rows) {
    const v = BigInt(r.valor); total += v; r.valorFormatado = formatarReais(v);
    if (r.sujeito === false) { foraDaRj += v; continue; }
    const k = r.classe ?? '?'; const a = porClasse.get(k) ?? { valor: 0n, n: 0 }; porClasse.set(k, { valor: a.valor + v, n: a.n + 1 });
  }
  const { rows: fontes } = await db.query(`SELECT d.id, d.titulo, coalesce(d.nome_original, d.titulo) AS nome, d.criado_em AS "criadoEm", d.origem
      FROM documentos d WHERE d.projeto_id = $1 AND d.tem_arquivo AND lower(coalesce(d.nome_original, d.titulo)) ~ '[.](xlsx|csv|txt|pdf)$'
     ORDER BY (lower(d.titulo || ' ' || coalesce(d.nome_original, '')) LIKE '%balancete%') DESC, d.criado_em DESC LIMIT 60`, [projetoId]);
  const leitura = rows.find((r) => r.documentoId);
  return {
    linhas: rows,
    resumo: {
      linhas: rows.length, total: formatarReais(total), foraDaRecuperacao: formatarReais(foraDaRj),
      hipoteses: rows.filter((r) => r.hipotese && r.situacao === 'preliminar').length,
      validadas: rows.filter((r) => r.situacao === 'validado').length,
      porClasse: [...porClasse].sort().map(([classe, x]) => ({ classe, valor: formatarReais(x.valor), credores: x.n })),
    },
    fonte: leitura ? { documentoId: leitura.documentoId, documento: leitura.documento, lidoEm: leitura.criadoEm } : null,
    fontes,
  };
}

/** Lê o balancete e refaz as linhas automáticas ainda não validadas. Linhas manuais e validadas ficam. */
export async function gerar(db: PoolClient, projetoId: string, documentoId: string, dep: Deposito, identidade: Identidade) {
  const org = await organizacao(db, projetoId);
  const { rows: docs } = await db.query<{ id: string; nome: string; hash_sha256: string | null; caminho: string }>(
    `SELECT id, coalesce(nome_original, titulo) AS nome, hash_sha256, caminho FROM documentos WHERE id = $1 AND projeto_id = $2 AND tem_arquivo`, [documentoId, projetoId]);
  const d = docs[0]; if (!d) throw new NaoEncontrado('documento não encontrado neste projeto');
  const bytes = await lerConteudoDocumento(db, d.id, dep, d.hash_sha256 ? chaveDoHash(d.hash_sha256) : d.caminho, d.hash_sha256 ?? undefined);
  let lido; try { lido = await lerBalancete(d.nome, bytes); } catch (e) { throw new PedidoInvalido(`Não consegui ler ${d.nome}: ${(e as Error).message}`); }
  const q = qgcPreliminar(lido.linhas);
  const avisos = [...lido.avisos, ...q.avisos];
  if (!q.linhas.length) return { linhas: 0, avisos, total: '0,00' };
  await db.query(`DELETE FROM qgc_preliminar WHERE projeto_id = $1 AND documento_id IS NOT NULL AND situacao <> 'validado'`, [projetoId]);
  // O que já foi validado (mesmo credor e valor) não volta como rascunho.
  const { rows: jaValidadas } = await db.query<{ credor: string; valor: string }>(`SELECT credor, valor::text AS valor FROM qgc_preliminar WHERE projeto_id = $1 AND situacao = 'validado'`, [projetoId]);
  const validadas = new Set(jaValidadas.map((r) => `${r.credor.toLowerCase()}|${r.valor}`)); let mantidas = 0;
  for (const l of q.linhas) {
    if (validadas.has(`${l.credor.toLowerCase()}|${l.valor}`)) { mantidas++; continue; }
    await db.query(`INSERT INTO qgc_preliminar (organizacao_id, projeto_id, documento_id, referencia, codigo, conta, grupo, credor, natureza, classe_sugerida,
        sujeito_sugerido, valor, motivo, hipotese, criado_por, atualizado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
      [org, projetoId, documentoId, l.referencia, l.codigo, l.conta, l.grupo, l.credor.slice(0, 300), l.natureza, l.classe, l.sujeito, l.valor, l.motivo, l.hipotese, identidade.usuarioId]);
  }
  await auditar(db, { organizacaoId: org, usuarioId: identidade.usuarioId, acao: 'qgc.preliminar_gerado', entidade: 'projeto', entidadeId: projetoId,
    depois: { documentoId, linhas: q.linhas.length, total: q.total, avisos: avisos.length } });
  if (mantidas) avisos.push(`${mantidas} linha(s) iguais às já validadas não foram repetidas.`);
  return { linhas: q.linhas.length, avisos, total: formatarReais(BigInt(q.total)) };
}

export const EsquemaLinha = z.object({
  credor: z.string().trim().min(1).max(300), documentoCredor: z.string().trim().max(30).optional().nullable(),
  natureza: z.enum(NATUREZAS_QGC), valor: centavos, conta: z.string().trim().max(300).optional().nullable(),
});

const sugerir = (credor: string, natureza: string, valor: string) => enquadrar({ id: 'x', credor, valor: BigInt(valor), natureza: natureza as NaturezaCredito });

export async function incluirLinha(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaLinha>, identidade: Identidade) {
  const org = await organizacao(db, projetoId); const e = sugerir(d.credor, d.natureza, d.valor);
  const { rows } = await db.query<{ id: string }>(`INSERT INTO qgc_preliminar (organizacao_id, projeto_id, credor, documento_credor, natureza, classe_sugerida, sujeito_sugerido, valor, conta, motivo, editado, criado_por, atualizado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Incluída à mão pela equipe.',true,$10,$10) RETURNING id`,
    [org, projetoId, d.credor, d.documentoCredor ?? null, d.natureza, e.classe, e.sujeito, d.valor, d.conta ?? null, identidade.usuarioId]);
  return { id: rows[0]!.id };
}

export async function editarLinha(db: PoolClient, id: string, d: Partial<z.infer<typeof EsquemaLinha>>, identidade: Identidade) {
  const { rows } = await db.query('SELECT * FROM qgc_preliminar WHERE id = $1', [id]);
  const atual = rows[0]; if (!atual) throw new NaoEncontrado('linha não encontrada');
  if (atual.situacao === 'validado') throw new PedidoInvalido('Linha já validada: edite o crédito no QGC validado.');
  const n = { credor: d.credor ?? atual.credor, natureza: d.natureza ?? atual.natureza, valor: d.valor ?? String(atual.valor), conta: d.conta === undefined ? atual.conta : d.conta, doc: d.documentoCredor === undefined ? atual.documento_credor : d.documentoCredor };
  const e = sugerir(n.credor, n.natureza, n.valor);
  await db.query(`UPDATE qgc_preliminar SET credor=$2, natureza=$3, valor=$4, conta=$5, documento_credor=$6, classe_sugerida=$7, sujeito_sugerido=$8,
      editado=true, hipotese=CASE WHEN $3 <> natureza THEN false ELSE hipotese END, atualizado_por=$9, atualizado_em=now() WHERE id=$1`,
    [id, n.credor, n.natureza, n.valor, n.conta, n.doc, e.classe, e.sujeito, identidade.usuarioId]);
  return { id, classe: e.classe, sujeito: e.sujeito };
}

export async function descartarLinha(db: PoolClient, id: string, identidade: Identidade) {
  const r = await db.query(`UPDATE qgc_preliminar SET situacao='descartado', atualizado_por=$2, atualizado_em=now() WHERE id=$1 AND situacao='preliminar'`, [id, identidade.usuarioId]);
  if (!r.rowCount) throw new NaoEncontrado('linha não encontrada ou já validada');
  return { ok: true };
}

/** Acha o credor pelo nome (sem diferenciar maiúsculas) ou cria. */
async function credorDe(db: PoolClient, org: string, projetoId: string, nome: string, documento: string | null, meEpp = false) {
  const { rows } = await db.query<{ id: string; me_epp: boolean }>(`SELECT id, me_epp FROM credores WHERE projeto_id=$1 AND lower(nome)=lower($2) LIMIT 1`, [projetoId, nome]);
  if (rows[0]) return rows[0];
  const novo = await db.query<{ id: string }>(`INSERT INTO credores (organizacao_id, projeto_id, nome, documento, me_epp) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [org, projetoId, nome, documento, meEpp]);
  return { id: novo.rows[0]!.id, me_epp: meEpp };
}

async function inserirCredito(db: PoolClient, org: string, projetoId: string, credorId: string, credor: string, meEpp: boolean, natureza: string, valor: string, bemGravado: string | null, origem: 'manual' | 'importacao', identidade: Identidade) {
  const c: Credito = { id: 'novo', credor, valor: BigInt(valor), natureza: natureza as NaturezaCredito, valorBemGravado: bemGravado ? BigInt(bemGravado) : undefined, meEpp };
  const s = enquadrar(c);
  const { rows } = await db.query<{ id: string }>(`INSERT INTO creditos (organizacao_id, projeto_id, credor_id, valor, natureza, valor_bem_gravado, classe_sugerida, sujeito_sugerido, fundamentos, ressalvas, origem)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [org, projetoId, credorId, valor, natureza, bemGravado, s.classe, s.sujeito, JSON.stringify(s.fundamentos), JSON.stringify(s.ressalvas), origem]);
  await auditar(db, { organizacaoId: org, usuarioId: identidade.usuarioId, acao: 'credito.criado', entidade: 'credito', entidadeId: rows[0]!.id, depois: { credor, natureza, valor, origem } });
  return rows[0]!.id;
}

/** Leva a linha do QGC automático para o QGC validado (cria credor e crédito). */
export async function validarLinha(db: PoolClient, id: string, identidade: Identidade) {
  const { rows } = await db.query('SELECT * FROM qgc_preliminar WHERE id = $1 AND situacao = \'preliminar\'', [id]);
  const l = rows[0]; if (!l) throw new NaoEncontrado('linha não encontrada ou já validada');
  const cr = await credorDe(db, l.organizacao_id, l.projeto_id, l.credor, l.documento_credor);
  const creditoId = await inserirCredito(db, l.organizacao_id, l.projeto_id, cr.id, l.credor, cr.me_epp, l.natureza, String(l.valor), null, 'importacao', identidade);
  await db.query(`UPDATE qgc_preliminar SET situacao='validado', credito_id=$2, atualizado_por=$3, atualizado_em=now() WHERE id=$1`, [id, creditoId, identidade.usuarioId]);
  return { creditoId };
}

export async function validarTodas(db: PoolClient, projetoId: string, identidade: Identidade) {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM qgc_preliminar WHERE projeto_id=$1 AND situacao='preliminar' ORDER BY criado_em`, [projetoId]);
  for (const r of rows) await validarLinha(db, r.id, identidade);
  return { validadas: rows.length };
}

// ------------------------------------------------------------ QGC validado ---

export const EsquemaCreditoRapido = z.object({
  credor: z.string().trim().min(1).max(300), documento: z.string().trim().max(30).optional().nullable(), meEpp: z.boolean().default(false),
  natureza: z.enum(NATUREZAS_QGC), valor: centavos, valorBemGravado: centavos.optional().nullable(),
});

/** O popup único: credor (novo ou existente) e crédito de uma vez. */
export async function creditoRapido(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaCreditoRapido>, identidade: Identidade) {
  const org = await organizacao(db, projetoId);
  const cr = await credorDe(db, org, projetoId, d.credor, d.documento ?? null, d.meEpp);
  const id = await inserirCredito(db, org, projetoId, cr.id, d.credor, cr.me_epp || d.meEpp, d.natureza, d.valor, d.valorBemGravado ?? null, 'manual', identidade);
  return { id };
}

export const EsquemaEdicaoCredito = z.object({
  credor: z.string().trim().min(1).max(300).optional(), documento: z.string().trim().max(30).optional().nullable(), meEpp: z.boolean().optional(),
  natureza: z.enum(NATUREZAS_QGC).optional(), valor: centavos.optional(), valorBemGravado: centavos.optional().nullable(),
});

/** Editar uma linha do QGC validado. Trocar a natureza desfaz a validação da classe: ela precisa ser conferida de novo. */
export async function editarCredito(db: PoolClient, id: string, d: z.infer<typeof EsquemaEdicaoCredito>, identidade: Identidade) {
  const { rows } = await db.query(`SELECT c.*, cr.nome AS credor_nome, cr.me_epp, cr.documento AS credor_doc FROM creditos c JOIN credores cr ON cr.id = c.credor_id WHERE c.id = $1`, [id]);
  const a = rows[0]; if (!a) throw new NaoEncontrado('crédito não encontrado');
  if (d.credor !== undefined || d.documento !== undefined || d.meEpp !== undefined) {
    await db.query(`UPDATE credores SET nome=coalesce($2,nome), documento=CASE WHEN $3::boolean THEN $4 ELSE documento END, me_epp=coalesce($5,me_epp) WHERE id=$1`,
      [a.credor_id, d.credor ?? null, d.documento !== undefined, d.documento ?? null, d.meEpp ?? null]);
  }
  const natureza = d.natureza ?? a.natureza; const valor = d.valor ?? String(a.valor);
  const bem = d.valorBemGravado === undefined ? (a.valor_bem_gravado === null ? null : String(a.valor_bem_gravado)) : d.valorBemGravado;
  const s = enquadrar({ id, credor: d.credor ?? a.credor_nome, valor: BigInt(valor), natureza: natureza as NaturezaCredito, valorBemGravado: bem ? BigInt(bem) : undefined, meEpp: d.meEpp ?? a.me_epp });
  const desfaz = natureza !== a.natureza;
  await db.query(`UPDATE creditos SET natureza=$2, valor=$3, valor_bem_gravado=$4, classe_sugerida=$5, sujeito_sugerido=$6, fundamentos=$7, ressalvas=$8,
      classe_validada=CASE WHEN $9 THEN NULL ELSE classe_validada END, sujeito_validado=CASE WHEN $9 THEN NULL ELSE sujeito_validado END,
      validado_por=CASE WHEN $9 THEN NULL ELSE validado_por END, validado_em=CASE WHEN $9 THEN NULL ELSE validado_em END, atualizado_em=now() WHERE id=$1`,
    [id, natureza, valor, bem, s.classe, s.sujeito, JSON.stringify(s.fundamentos), JSON.stringify(s.ressalvas), desfaz]);
  await auditar(db, { organizacaoId: a.organizacao_id, usuarioId: identidade.usuarioId, acao: 'credito.editado', entidade: 'credito', entidadeId: id,
    antes: { credor: a.credor_nome, natureza: a.natureza, valor: String(a.valor) }, depois: { ...d, validacaoDesfeita: desfaz } });
  return { id, validacaoDesfeita: desfaz };
}

export async function excluirCredito(db: PoolClient, id: string, identidade: Identidade) {
  const { rows } = await db.query('SELECT organizacao_id, valor::text, natureza FROM creditos WHERE id=$1', [id]);
  if (!rows[0]) throw new NaoEncontrado('crédito não encontrado');
  try {
    await db.query('SAVEPOINT excluir_credito');
    // A linha do QGC automático que gerou o crédito volta a ser rascunho.
    await db.query(`UPDATE qgc_preliminar SET situacao='preliminar', credito_id=NULL WHERE credito_id=$1`, [id]);
    await db.query('DELETE FROM creditos WHERE id=$1', [id]);
  } catch { await db.query('ROLLBACK TO SAVEPOINT excluir_credito'); throw new PedidoInvalido('Este crédito já tem voto ou obrigação ligada a ele e não pode ser excluído.'); }
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'credito.excluido', entidade: 'credito', entidadeId: id, antes: rows[0] });
  return { ok: true };
}

// ------------------------------------------- relação final enviada pelo cliente ---

const naturezaDaClasse = (t: string): NaturezaCredito | null => {
  const s = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/^(classe )?iv\b|me.?epp|microempresa|pequeno porte/.test(s)) return 'me_epp';
  if (/^(classe )?iii\b|quirograf/.test(s)) return 'quirografario';
  if (/^(classe )?ii\b|garantia real/.test(s)) return 'garantia_real';
  if (/^(classe )?i\b|trabalh/.test(s)) return 'trabalhista';
  if (/fiduci/.test(s)) return 'proprietario_fiduciario';
  if (/tribut|fiscal/.test(s)) return 'tributario';
  return null;
};

/**
 * Importa a relação final de credores (planilha do cliente) para o QGC validado.
 * Colunas reconhecidas pelo cabeçalho: credor/nome, CPF/CNPJ, classe ou natureza, valor.
 * Linha repetida (mesmo credor e mesmo valor já no QGC) não entra de novo.
 */
export async function importarRelacaoFinal(db: PoolClient, projetoId: string, documentoId: string, dep: Deposito, identidade: Identidade) {
  const org = await organizacao(db, projetoId);
  const { rows: docs } = await db.query<{ id: string; nome: string; hash_sha256: string | null; caminho: string }>(
    `SELECT id, coalesce(nome_original, titulo) AS nome, hash_sha256, caminho FROM documentos WHERE id = $1 AND projeto_id = $2 AND tem_arquivo`, [documentoId, projetoId]);
  const d = docs[0]; if (!d) throw new NaoEncontrado('documento não encontrado neste projeto');
  const bytes = await lerConteudoDocumento(db, d.id, dep, d.hash_sha256 ? chaveDoHash(d.hash_sha256) : d.caminho, d.hash_sha256 ?? undefined);
  let tabelas; try { tabelas = tabelasDe(d.nome, bytes); } catch (e) { throw new PedidoInvalido(`${(e as Error).message}. A relação final precisa vir em XLSX ou CSV.`); }
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  let criados = 0, repetidos = 0; const avisos: string[] = [];
  for (const t of tabelas) {
    const h = t.linhas.findIndex((l) => l.some((c) => /^(credor|nome|razao social)/.test(norm(c))) && l.some((c) => /valor/.test(norm(c))));
    if (h < 0) { avisos.push(`${t.aba}: cabeçalho com "credor" e "valor" não encontrado`); continue; }
    const cab = t.linhas[h]!.map(norm);
    const i = { nome: cab.findIndex((c) => /^(credor|nome|razao social)/.test(c)), doc: cab.findIndex((c) => /(cpf|cnpj|documento)/.test(c)), classe: cab.findIndex((c) => /(classe|natureza)/.test(c)), valor: cab.findIndex((c) => /valor/.test(c)) };
    for (const [k, l] of t.linhas.slice(h + 1).entries()) {
      const nome = (l[i.nome] ?? '').trim(); if (!nome || /^total/i.test(nome)) continue;
      const v = (l[i.valor] ?? '').replace(/r\$|\s/gi, ''); const m = /^-?[\d.]*,?\d*$/.test(v) ? v : '';
      const c = m ? valorBr(m) : null;
      if (c === null || c <= 0n) { avisos.push(`${t.aba} linha ${h + k + 2}: valor ilegível para ${nome}`); continue; }
      const natureza = (i.classe >= 0 ? naturezaDaClasse(l[i.classe] ?? '') : null) ?? 'quirografario';
      const dup = await db.query(`SELECT 1 FROM creditos c JOIN credores cr ON cr.id=c.credor_id WHERE c.projeto_id=$1 AND lower(cr.nome)=lower($2) AND c.valor=$3`, [projetoId, nome, c.toString()]);
      if (dup.rowCount) { repetidos++; continue; }
      const cr = await credorDe(db, org, projetoId, nome, i.doc >= 0 ? (l[i.doc] ?? '').trim() || null : null, natureza === 'me_epp');
      await inserirCredito(db, org, projetoId, cr.id, nome, cr.me_epp, natureza, c.toString(), null, 'importacao', identidade); criados++;
    }
  }
  await auditar(db, { organizacaoId: org, usuarioId: identidade.usuarioId, acao: 'qgc.relacao_final_importada', entidade: 'documento', entidadeId: documentoId, depois: { criados, repetidos } });
  return { criados, repetidos, avisos };
}
