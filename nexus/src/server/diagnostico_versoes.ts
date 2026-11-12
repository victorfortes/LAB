/**
 * Diagnóstico inicial versionado: reúne o que o projeto tem, monta o relatório, guarda a versão e compara versões.
 * Cada execução é uma linha em `diagnostico_versoes` (quem, quando, quais documentos). Nada é sobrescrito.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { compararVersoes, montarRelatorio, type DocumentoLido, type RelatorioDiagnostico } from '../domain/diagnostico/relatorio.ts';
import type { Qualidade } from '../domain/diagnostico/analises.ts';
import { renderizarDiagnostico } from './diagnostico_html.ts';
import { lerPlanilha, lerTextoDeDemonstracao } from '../domain/diagnostico/planilhas.ts';
import { linhasDoPdf } from './qgc.ts';
import { lerConteudoDocumento, type Deposito } from './arquivos.ts';
import { chaveDoHash } from '../store/arquivos.ts';

const TIPOS = ['balanco', 'dre_contabil', 'dre_gerencial', 'faturamento', 'extrato', 'passivo_fonte', 'clientes_abc', 'partes_relacionadas'] as const;
export const EsquemaExtracao = z.object({
  tipo: z.enum(TIPOS),
  referencia: z.string().trim().min(1).max(300),
  documentoId: z.string().uuid().optional(),
  qualidade: z.enum(['boa', 'regular', 'ruim', 'ilegivel']).default('boa'),
  origem: z.enum(['manual', 'planilha', 'modelo']).default('manual'),
  dados: z.record(z.string(), z.unknown()),
});

export async function registrarExtracao(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaExtracao>, identidade: Identidade) {
  const { rows: pj } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  if (!pj[0]) throw new NaoEncontrado('projeto não encontrado');
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO diagnostico_extracoes (organizacao_id, projeto_id, documento_id, tipo, referencia, dados, qualidade, origem, criado_por) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING id`,
    [pj[0].organizacao_id, projetoId, d.documentoId ?? null, d.tipo, d.referencia, JSON.stringify(d.dados), d.qualidade, d.origem, identidade.usuarioId]);
  await auditar(db, { organizacaoId: pj[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'diagnostico.extracao_registrada', entidade: 'projeto', entidadeId: projetoId, depois: { tipo: d.tipo, referencia: d.referencia } });
  return { id: rows[0]!.id };
}
export async function listarExtracoes(db: PoolClient, projetoId: string) {
  return (await db.query('SELECT id, tipo, referencia, qualidade, origem, criado_em AS "criadoEm" FROM diagnostico_extracoes WHERE projeto_id = $1 ORDER BY tipo, criado_em', [projetoId])).rows;
}
export async function excluirExtracao(db: PoolClient, id: string, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; tipo: string }>('DELETE FROM diagnostico_extracoes WHERE id = $1 RETURNING organizacao_id, tipo', [id]);
  if (!rows[0]) throw new NaoEncontrado('extração não encontrada');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'diagnostico.extracao_excluida', entidade: 'diagnostico_extracao', entidadeId: id, depois: { tipo: rows[0].tipo } });
  return { ok: true };
}

const refDe = (t: string) => { const [arquivo, ...resto] = t.split(' | '); return { arquivo: arquivo!, local: resto.join(' | ') || undefined }; };

/**
 * Lê as planilhas (XLSX e CSV) que o cliente enviou e ainda não foram lidas, e grava as extrações com a origem de cada número.
 * Arquivo que falha entra nos avisos e a leitura segue com os demais.
 */
export async function lerPlanilhasDoProjeto(db: PoolClient, projetoId: string, dep: Deposito, identidade: Identidade) {
  const { rows: pj } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  if (!pj[0]) throw new NaoEncontrado('projeto não encontrado');
  const { rows: docs } = await db.query<{ id: string; nome: string; hash_sha256: string | null }>(
    `SELECT d.id, coalesce(d.nome_original, d.titulo) AS nome, d.hash_sha256 FROM documentos d
      WHERE d.projeto_id = $1 AND d.origem = 'portal_cliente' AND d.tem_arquivo AND d.hash_sha256 IS NOT NULL
        AND lower(coalesce(d.nome_original, d.titulo)) ~ '[.](xlsx|xls|csv|pdf)$'
        AND NOT EXISTS (SELECT 1 FROM diagnostico_extracoes x WHERE x.documento_id = d.id) AND NOT EXISTS (SELECT 1 FROM diagnostico_leituras l WHERE l.documento_id = d.id)`, [projetoId]);
  const avisos: string[] = []; let extracoes = 0; let lidas = 0;
  for (const d of docs) {
    try {
      const bytes = await lerConteudoDocumento(db, d.id, dep, chaveDoHash(d.hash_sha256!), d.hash_sha256!);
      const ehPdf = /\.pdf$/i.test(d.nome);
      let r;
      if (ehPdf) {
        const paginas = await linhasDoPdf(bytes);
        // PDF sem camada de texto é digitalizado: sem OCR aqui, vira limite declarado, nunca número inventado.
        r = paginas.flat().join('').length < 40 * Math.max(1, paginas.length)
          ? { extracoes: [], avisos: [`${d.nome}: PDF digitalizado (sem texto). OCR não disponível neste servidor; números deste arquivo não foram lidos.`] }
          : lerTextoDeDemonstracao(d.nome, paginas);
      } else r = lerPlanilha(d.nome, bytes);
      avisos.push(...r.avisos);
      for (const x of r.extracoes) { await db.query(`INSERT INTO diagnostico_extracoes (organizacao_id, projeto_id, documento_id, tipo, referencia, dados, qualidade, origem, criado_por) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [pj[0].organizacao_id, projetoId, d.id, x.tipo, x.referencia, JSON.stringify(x.dados), ehPdf ? 'regular' : 'boa', ehPdf ? 'pdf_texto' : 'planilha', identidade.usuarioId]); extracoes++; }
      await db.query(`INSERT INTO diagnostico_leituras (documento_id, organizacao_id, projeto_id, extracoes, avisos) VALUES ($1,$2,$3,$4,$5::jsonb)`, [d.id, pj[0].organizacao_id, projetoId, r.extracoes.length, JSON.stringify(r.avisos)]);
      lidas++;
    } catch (e) { avisos.push(`${d.nome}: ${(e as Error).message}`); }
  }
  return { planilhasLidas: lidas, extracoes, avisos };
}

export async function gerar(db: PoolClient, projetoId: string, motivo: 'manual' | 'rodada_de_entrega', identidade: Identidade, dep?: Deposito) {
  const leitura = dep ? await lerPlanilhasDoProjeto(db, projetoId, dep, identidade) : { planilhasLidas: 0, extracoes: 0, avisos: [] as string[] };
  const { rows: antigos } = await db.query<{ avisos: string[] }>('SELECT avisos FROM diagnostico_leituras WHERE projeto_id = $1', [projetoId]);
  const avisosDeLeitura = [...new Set([...antigos.flatMap((a) => a.avisos), ...leitura.avisos])];
  const { rows: pj } = await db.query<{ organizacao_id: string; nome: string; posicao_cliente: 'devedor' | 'credor'; razao: string | null }>(
    `SELECT p.organizacao_id, p.nome, p.posicao_cliente, (SELECT coalesce(e.razao_social, e.nome_fantasia) FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id WHERE pe.projeto_id = p.id ORDER BY pe.papel LIMIT 1) AS razao
       FROM projetos p WHERE p.id = $1`, [projetoId]);
  if (!pj[0]) throw new NaoEncontrado('projeto não encontrado');
  const { rows: docs } = await db.query<{ id: string; titulo: string; nome_original: string | null; categoria: string | null; estado: string | null; detalhe: string | null }>(
    `SELECT d.id, d.titulo, d.nome_original, coalesce(r.categoria, d.categoria, 'Sem área') AS categoria, p.estado, p.detalhe
       FROM documentos d LEFT JOIN documento_processamento p ON p.documento_id = d.id LEFT JOIN requisitos r ON r.documento_id = d.id AND r.projeto_id = d.projeto_id
      WHERE d.projeto_id = $1 AND d.origem = 'portal_cliente' ORDER BY d.criado_em`, [projetoId]);
  const documentos: DocumentoLido[] = docs.map((d) => {
    const estado = d.estado ?? 'sem_registro';
    const qualidade: Qualidade = estado === 'analisado' ? 'boa' : estado === 'sem_texto' || estado === 'erro' ? 'ilegivel' : 'regular';
    return { id: d.id, nome: d.nome_original ?? d.titulo, area: d.categoria ?? 'Sem área', estado, qualidade, detalhe: d.detalhe };
  });
  const { rows: req } = await db.query<{ ordem: number; titulo: string; categoria: string; fundamento: string | null; situacao: string; documento_id: string | null; obrigatorio: boolean }>(
    'SELECT ordem, titulo, categoria, fundamento, situacao, documento_id, obrigatorio FROM requisitos WHERE projeto_id = $1 ORDER BY ordem, titulo', [projetoId]);
  const checklist = req.map((r, i) => ({ numero: i + 1, titulo: r.titulo, area: r.categoria, artigo: r.fundamento, situacao: r.situacao, temArquivo: r.documento_id !== null }));
  const obrig = req.filter((r) => r.obrigatorio && r.situacao !== 'nao_aplicavel');
  const portal = { obrigatorios: obrig.length, enviados: obrig.filter((r) => ['enviado', 'em_analise', 'aprovado'].includes(r.situacao)).length, aprovados: obrig.filter((r) => r.situacao === 'aprovado').length };

  const { rows: ex } = await db.query<{ tipo: string; referencia: string; dados: Record<string, unknown>; qualidade: string }>(
    `SELECT tipo, referencia, dados, qualidade FROM diagnostico_extracoes WHERE projeto_id = $1 AND qualidade <> 'ilegivel' ORDER BY criado_em`, [projetoId]);
  const com = (t: string) => ex.filter((x) => x.tipo === t);
  // O balancete lido no QGC automático também é fonte de passivo: total e parte fiscal, com o arquivo de origem.
  const { rows: bal } = await db.query<{ documento: string | null; total: string; fiscal: string }>(
    `SELECT d.titulo AS documento, sum(q.valor)::text AS total, sum(q.valor) FILTER (WHERE q.natureza = 'tributario')::text AS fiscal
       FROM qgc_preliminar q JOIN documentos d ON d.id = q.documento_id
      WHERE q.projeto_id = $1 AND q.situacao <> 'descartado' GROUP BY d.titulo`, [projetoId]);
  const passivoDoBalancete = bal.map((b) => ({ fonte: 'Balancete (QGC preliminar)', total: Number(b.total) / 100, fiscal: b.fiscal === null ? 0 : Number(b.fiscal) / 100, ref: { arquivo: b.documento ?? 'balancete', local: 'contas do passivo' } }) as never);
  const { rows: ult } = await db.query<{ n: number }>('SELECT coalesce(max(numero), 0) AS n FROM diagnostico_versoes WHERE projeto_id = $1', [projetoId]);
  const numero = Number(ult[0]!.n) + 1;
  const quem = (await db.query<{ nome: string }>('SELECT nome FROM usuarios WHERE id = $1', [identidade.usuarioId])).rows[0]?.nome ?? 'sistema';
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

  const relatorio = montarRelatorio({
    projeto: { nome: pj[0].nome, razaoSocial: pj[0].razao, posicao: pj[0].posicao_cliente }, dataBase: hoje, geradoPor: quem, versao: numero,
    documentos, checklist, portal,
    balancos: com('balanco').filter((x) => ['ativoCirculante', 'ativoNaoCirculante', 'passivoCirculante', 'passivoNaoCirculante', 'patrimonioLiquido'].every((k) => typeof (x.dados as Record<string, unknown>)[k] === 'number')).map((x) => ({ ...(x.dados as object), ref: refDe(x.referencia) }) as never),
    dres: [...com('dre_contabil').map((x) => ({ ...(x.dados as object), tipo: 'contabil', ref: refDe(x.referencia) })), ...com('dre_gerencial').map((x) => ({ ...(x.dados as object), tipo: 'gerencial', ref: refDe(x.referencia) }))] as never,
    faturamento: com('faturamento').map((x) => ({ ...(x.dados as object), ref: refDe(x.referencia) }) as never),
    extratos: com('extrato').map((x) => ({ ...(x.dados as object), ref: refDe(x.referencia) }) as never),
    passivo: [...com('passivo_fonte').map((x) => ({ ...(x.dados as object), ref: refDe(x.referencia) }) as never), ...passivoDoBalancete],
    clientesAbc: com('clientes_abc').flatMap((x) => ((x.dados as { clientes?: { nome: string; valor: number }[] }).clientes ?? []).map((c) => ({ ...c, ref: refDe(x.referencia) }))),
    relacionadas: com('partes_relacionadas').flatMap((x) => (x.dados as { nomes?: string[] }).nomes ?? []),
    avisosDeLeitura,
  });
  await db.query(`INSERT INTO diagnostico_versoes (organizacao_id, projeto_id, numero, gerado_por, motivo, documentos, resultado) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [pj[0].organizacao_id, projetoId, numero, identidade.usuarioId, motivo, JSON.stringify(documentos), JSON.stringify(relatorio)]);
  await auditar(db, { organizacaoId: pj[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'diagnostico.versao_gerada', entidade: 'projeto', entidadeId: projetoId, depois: { numero, documentos: documentos.length, motivo } });
  return { numero, relatorio, leitura };
}

export async function listarVersoes(db: PoolClient, projetoId: string) {
  return (await db.query(
    `SELECT v.numero, v.gerado_em AS "geradoEm", v.motivo, u.nome AS "geradoPor", jsonb_array_length(v.documentos) AS documentos,
            v.resultado->'faltantes'->>'pendentes' AS pendentes, (SELECT count(*) FROM jsonb_array_elements(v.resultado->'riscos') x WHERE x->>'prioridade' = 'Alta') AS "riscosAltos"
       FROM diagnostico_versoes v LEFT JOIN usuarios u ON u.id = v.gerado_por WHERE v.projeto_id = $1 ORDER BY v.numero DESC`, [projetoId])).rows;
}
export async function obterVersao(db: PoolClient, projetoId: string, numero: number): Promise<{ relatorio: RelatorioDiagnostico; documentos: unknown }> {
  const { rows } = await db.query<{ resultado: RelatorioDiagnostico; documentos: unknown }>('SELECT resultado, documentos FROM diagnostico_versoes WHERE projeto_id = $1 AND numero = $2', [projetoId, numero]);
  if (!rows[0]) throw new NaoEncontrado('versão não encontrada');
  return { relatorio: rows[0].resultado, documentos: rows[0].documentos };
}
export async function comparar(db: PoolClient, projetoId: string, de: number, para: number) {
  if (de === para) throw new PedidoInvalido('escolha duas versões diferentes');
  return compararVersoes((await obterVersao(db, projetoId, de)).relatorio, (await obterVersao(db, projetoId, para)).relatorio);
}
export async function html(db: PoolClient, projetoId: string, numero: number) { return renderizarDiagnostico((await obterVersao(db, projetoId, numero)).relatorio); }

/** PDF paisagem a partir do MESMO HTML, via Chromium (Playwright). Só roda onde o Playwright existe: na nuvem (Edge) devolve null. */
export async function pdf(htmlDoc: string): Promise<Uint8Array | null> {
  let chromium: { launch: (o?: object) => Promise<{ newPage: () => Promise<{ setContent: (h: string, o?: object) => Promise<void>; pdf: (o: object) => Promise<Uint8Array> }>; close: () => Promise<void> }> };
  try { chromium = (await import(/* @vite-ignore */ 'playwright' as string)).chromium; } catch { return null; }
  const nav = await chromium.launch();
  try { const pg = await nav.newPage(); await pg.setContent(htmlDoc, { waitUntil: 'load' }); return await pg.pdf({ width: '297mm', height: '210mm', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } }); }
  finally { await nav.close(); }
}
