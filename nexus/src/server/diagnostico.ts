/**
 * Diagnóstico inicial do cliente — o que o advogado lê antes de abrir um PDF.
 *
 * Tudo aqui é DERIVADO do que já está gravado (checklist, análises, achados,
 * identificadores). Não há texto livre de modelo: o que veio de IA aparece como
 * achado, com a sua natureza (§7.7), e o que é regra aparece como regra. O
 * diagnóstico diz o que está coberto, o que falta e o que merece atenção — não
 * decide classe de crédito nem estratégia.
 */
import type { PoolClient } from 'pg';
import { ROTULO_DO_TIPO, type TipoDeDocumento } from '../domain/analise/classificacao.ts';

/**
 * Categorias do checklist que cada tipo reconhecido normalmente satisfaz. São padrões, não nomes exatos:
 * as planilhas da NGA têm categorias como "Contábil / Financeiro", "Jurídico / Societário", "Passivo Fiscal".
 */
const CATEGORIA_DO_TIPO: Partial<Record<TipoDeDocumento, RegExp>> = {
  demonstracao_contabil: /cont[aá]bil|financeir/i,
  certidao: /fiscal|processual|trabalhista|jur[ií]dico|contencioso|im[oó]veis/i,
  contrato: /societ|patrimonial|credores|financeir|jur[ií]dico|im[oó]veis|bens|grupo/i,
  relacao_credores: /credores|passivo/i,
  procuracao: /societ|processual|jur[ií]dico/i,
  peticao_inicial_rj: /processual|jur[ií]dico|contencioso/i,
  decisao_judicial: /processual|jur[ií]dico|contencioso/i,
  nota_fiscal: /cont[aá]bil|credores|financeir/i,
};

interface Ocorrencia { tipo: string; bruto: string; canonico: string; valido: boolean }

export async function diagnostico(db: PoolClient, projetoId: string) {
  const { rows: docs } = await db.query<{
    id: string; titulo: string; categoria: string | null; criado_em: Date; visibilidade: string; origem: string;
    estado: string | null; detalhe: string | null; requisito: string | null; requisito_categoria: string | null;
    analise_id: string | null; tipo_sugerido: string | null; tipo_validado: string | null; certeza: string | null;
    identificadores: Ocorrencia[] | null; suspeitas: unknown[] | null; achados: string | null; criticos: string | null;
  }>(
    `SELECT d.id, d.titulo, d.categoria, d.criado_em, d.visibilidade, d.origem,
            p.estado, p.detalhe, r.titulo AS requisito, r.categoria AS requisito_categoria,
            a.id AS analise_id, a.tipo_sugerido, a.tipo_validado, a.certeza, a.identificadores, a.suspeitas,
            (SELECT count(*) FROM achados c WHERE c.analise_id = a.id) AS achados,
            (SELECT count(*) FROM achados c WHERE c.analise_id = a.id AND c.gravidade = 'critico' AND c.situacao = 'aberto') AS criticos
       FROM documentos d
       LEFT JOIN documento_processamento p ON p.documento_id = d.id
       LEFT JOIN requisitos r ON r.documento_id = d.id
       LEFT JOIN LATERAL (SELECT * FROM analises x WHERE x.documento_id = d.id ORDER BY x.criado_em DESC LIMIT 1) a ON TRUE
      WHERE d.projeto_id = $1 ORDER BY d.criado_em DESC`, [projetoId]);

  const { rows: itens } = await db.query<{ id: string; categoria: string; titulo: string; fundamento: string | null; obrigatorio: boolean; situacao: string }>(
    'SELECT id, categoria, titulo, fundamento, obrigatorio, situacao FROM requisitos WHERE projeto_id = $1', [projetoId]);

  const { rows: achados } = await db.query<{
    id: string; titulo: string; descricao: string | null; gravidade: string; categoria: string; natureza: string; origem: string; documento: string; documento_id: string;
  }>(
    `SELECT c.id, c.titulo, c.descricao, c.gravidade, c.categoria, c.natureza, c.origem, d.titulo AS documento, d.id AS documento_id
       FROM achados c JOIN analises a ON a.id = c.analise_id JOIN documentos d ON d.id = a.documento_id
      WHERE a.projeto_id = $1 AND c.situacao = 'aberto'
      ORDER BY CASE c.gravidade WHEN 'critico' THEN 0 WHEN 'atencao' THEN 1 ELSE 2 END, c.ordem LIMIT 40`, [projetoId]);

  // ---- cobertura do checklist
  // "Não se aplica" sai da conta, como no resto do sistema.
  const obrig = itens.filter((i) => i.obrigatorio && i.situacao !== 'nao_aplicavel');
  const porCategoria = new Map<string, { total: number; aprovados: number; enviados: number }>();
  for (const i of obrig) {
    const c = porCategoria.get(i.categoria) ?? { total: 0, aprovados: 0, enviados: 0 };
    c.total++; if (i.situacao === 'aprovado') c.aprovados++;
    if (['enviado', 'em_analise', 'aprovado'].includes(i.situacao)) c.enviados++;
    porCategoria.set(i.categoria, c);
  }
  const faltando = obrig.filter((i) => ['pendente', 'rejeitado', 'complementacao'].includes(i.situacao))
    .map((i) => ({ id: i.id, titulo: i.titulo, categoria: i.categoria, fundamento: i.fundamento, situacao: i.situacao }));

  // ---- identificadores consolidados (só os de dígito verificador válido contam como "confirmados")
  const vistos = new Map<string, { tipo: string; canonico: string; bruto: string; valido: boolean; documentos: Set<string> }>();
  for (const d of docs) for (const o of d.identificadores ?? []) {
    if (!['cnpj', 'cpf', 'processo'].includes(o.tipo)) continue;
    const k = `${o.tipo}:${o.canonico}`;
    const e = vistos.get(k) ?? { tipo: o.tipo, canonico: o.canonico, bruto: o.bruto, valido: o.valido, documentos: new Set<string>() };
    e.documentos.add(d.titulo); vistos.set(k, e);
  }
  const identificadores = [...vistos.values()].map((e) => ({ ...e, documentos: [...e.documentos] }))
    .sort((a, b) => b.documentos.length - a.documentos.length).slice(0, 30);

  // ---- conferência: o tipo reconhecido combina com o item do checklist onde foi enviado?
  const conferencias = docs.filter((d) => d.tipo_sugerido && d.requisito_categoria).flatMap((d) => {
    const esperado = CATEGORIA_DO_TIPO[d.tipo_sugerido as TipoDeDocumento];
    if (!esperado || esperado.test(d.requisito_categoria!)) return [];
    return [{ documento: d.titulo, documentoId: d.id, enviadoComo: d.requisito, categoria: d.requisito_categoria, parece: ROTULO_DO_TIPO[d.tipo_sugerido as TipoDeDocumento], certeza: d.certeza }];
  });

  // ---- documentos sem item: o que o tipo reconhecido sugere (a pessoa decide e vincula)
  const livres = itens.filter((i) => ['pendente', 'rejeitado', 'complementacao'].includes(i.situacao));
  const sugestoes = new Map<string, Array<{ id: string; titulo: string; categoria: string }>>();
  for (const d of docs) {
    if (d.requisito || !d.tipo_sugerido) continue;
    const cats = CATEGORIA_DO_TIPO[(d.tipo_validado ?? d.tipo_sugerido) as TipoDeDocumento];
    if (!cats) continue;
    const cand = livres.filter((i) => cats.test(i.categoria)).slice(0, 6).map((i) => ({ id: i.id, titulo: i.titulo, categoria: i.categoria }));
    if (cand.length) sugestoes.set(d.id, cand);
  }

  const estados = { analisado: 0, sem_texto: 0, erro: 0, em_andamento: 0, sem_registro: 0 };
  for (const d of docs) {
    if (d.estado === 'analisado') estados.analisado++; else if (d.estado === 'sem_texto') estados.sem_texto++;
    else if (d.estado === 'erro') estados.erro++; else if (d.estado) estados.em_andamento++; else estados.sem_registro++;
  }

  const pontos: Array<{ tom: 'erro' | 'aviso' | 'info'; titulo: string; detalhe: string; aba?: string }> = [];
  const criticos = achados.filter((a) => a.gravidade === 'critico');
  if (criticos.length) pontos.push({ tom: 'erro', titulo: `${criticos.length} achado(s) crítico(s) em aberto`, detalhe: criticos.slice(0, 3).map((c) => c.titulo).join(' · '), aba: 'documentos' });
  const soltos = docs.filter((d) => !d.requisito && d.origem === 'portal_cliente');
  if (soltos.length) pontos.push({ tom: 'info', titulo: `${soltos.length} documento(s) enviado(s) sem item do checklist`, detalhe: 'O cliente enviou soltos; o sistema sugere o item pelo tipo reconhecido — você confirma o vínculo.', aba: 'diagnostico' });
  if (conferencias.length) pontos.push({ tom: 'aviso', titulo: `${conferencias.length} documento(s) parecem estar no item errado`, detalhe: conferencias.slice(0, 2).map((c) => `“${c.documento}” parece ${c.parece.toLowerCase()}, enviado como ${c.enviadoComo}`).join(' · '), aba: 'portal' });
  if (estados.sem_texto) pontos.push({ tom: 'aviso', titulo: `${estados.sem_texto} documento(s) sem texto legível`, detalhe: 'Provavelmente digitalizados. A leitura automática exige OCR, ainda não disponível: confira manualmente.', aba: 'documentos' });
  if (estados.erro) pontos.push({ tom: 'erro', titulo: `${estados.erro} documento(s) com falha na leitura`, detalhe: 'Abra o documento para ver o motivo e rodar a análise de novo.', aba: 'documentos' });
  if (faltando.length) pontos.push({ tom: 'aviso', titulo: `${faltando.length} documento(s) obrigatório(s) ainda não entregues`, detalhe: faltando.slice(0, 3).map((f) => f.titulo).join(' · '), aba: 'portal' });
  const invalidos = identificadores.filter((i) => !i.valido && i.tipo !== 'processo');
  if (invalidos.length) pontos.push({ tom: 'aviso', titulo: `${invalidos.length} CNPJ/CPF com dígito verificador inválido`, detalhe: invalidos.slice(0, 3).map((i) => i.bruto).join(' · '), aba: 'documentos' });
  const suspeitos = docs.filter((d) => (d.suspeitas ?? []).length > 0);
  if (suspeitos.length) pontos.push({ tom: 'erro', titulo: `${suspeitos.length} documento(s) com conteúdo em forma de instrução`, detalhe: 'O texto tenta dar ordens ao sistema. Foi tratado como dado e ignorado (§7.12); vale revisar a origem.', aba: 'documentos' });

  return {
    geradoEm: new Date().toISOString(),
    cobertura: {
      obrigatorios: obrig.length,
      aprovados: obrig.filter((i) => i.situacao === 'aprovado').length,
      enviados: obrig.filter((i) => ['enviado', 'em_analise', 'aprovado'].includes(i.situacao)).length,
      porCategoria: [...porCategoria].map(([categoria, v]) => ({ categoria, ...v })).sort((a, b) => a.categoria.localeCompare(b.categoria)),
    },
    faltando, estados, pontos, conferencias, identificadores,
    achados: achados.slice(0, 12),
    documentos: docs.map((d) => ({
      id: d.id, titulo: d.titulo, enviadoEm: d.criado_em, origem: d.origem, requisito: d.requisito, estado: d.estado ?? 'sem_registro', detalhe: d.detalhe,
      tipo: d.tipo_validado ?? d.tipo_sugerido, rotuloDoTipo: (d.tipo_validado ?? d.tipo_sugerido) ? ROTULO_DO_TIPO[(d.tipo_validado ?? d.tipo_sugerido) as TipoDeDocumento] : null,
      tipoValidado: d.tipo_validado !== null, certeza: d.certeza, sugestoes: sugestoes.get(d.id) ?? [], semItem: !d.requisito, achados: Number(d.achados ?? 0), criticos: Number(d.criticos ?? 0),
    })),
  };
}
