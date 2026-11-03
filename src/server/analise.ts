/**
 * Serviços da análise documental.
 *
 * Tudo roda sob o RLS do usuário (migração 011), e não há política de portal
 * para estas tabelas: análise é trabalho interno da NGA e não existe caminho
 * que a leve ao cliente. O que o cliente vê sai por publicação de documento,
 * com `portal.publicar`, e só isso.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import type { Identidade } from '../security/sessao.ts';
import { ROTULO_DO_TIPO, type TipoDeDocumento } from '../domain/analise/classificacao.ts';
import { ROTULO_DO_STATUS, ROTULO_DA_NATUREZA } from '../domain/analise/citacoes.ts';
import { type Provedor } from '../ai/provedor.ts';
import type { Deposito } from './arquivos.ts';
import { chaveDoHash } from '../store/arquivos.ts';
import { triar } from '../ai/triagem.ts';

export const EsquemaTexto = z.object({
  texto: z.string().min(1).max(5_000_000),
  origem: z.enum(['texto_enviado', 'pdf_nativo', 'ocr', 'transcricao']),
  paginas: z.number().int().positive().optional(),
  confianca: z.number().int().min(0).max(100).optional(),
});

export const EsquemaExecucao = z.object({
  /** Falso roda só o determinístico, sem gastar chamada de modelo. */
  comIa: z.boolean().default(true),
});

export const EsquemaValidacaoDeTipo = z.object({
  tipo: z.string().min(1).max(60),
  observacao: z.string().max(2000).optional(),
});

export const EsquemaTriagem = z.object({
  situacao: z.enum(['confirmado', 'descartado']),
});

/**
 * Guarda o texto extraído do documento.
 *
 * O armazenamento de arquivo com URL assinada não está construído, então o
 * texto entra por aqui — colado, transcrito ou produzido por extrator externo.
 * A `origem` fica registrada porque análise sobre OCR ruim não vale o mesmo
 * que análise sobre texto nativo, e quem lê precisa saber de qual se trata.
 */
export async function registrarTexto(
  db: PoolClient, documentoId: string,
  dados: z.infer<typeof EsquemaTexto>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string; titulo: string }>(
    'SELECT organizacao_id, titulo FROM documentos WHERE id = $1', [documentoId]);
  const documento = rows[0];
  if (!documento) throw new NaoEncontrado('documento não encontrado');

  await db.query(
    `INSERT INTO documento_textos
       (documento_id, organizacao_id, texto, caracteres, paginas, origem, confianca, extraido_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (documento_id) DO UPDATE SET
       texto = EXCLUDED.texto, caracteres = EXCLUDED.caracteres,
       paginas = EXCLUDED.paginas, origem = EXCLUDED.origem,
       confianca = EXCLUDED.confianca, extraido_em = now(),
       extraido_por = EXCLUDED.extraido_por`,
    [documentoId, documento.organizacao_id, dados.texto, dados.texto.length,
     dados.paginas ?? null, dados.origem, dados.confianca ?? null, identidade.usuarioId]);

  await auditar(db, {
    organizacaoId: documento.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'documento.texto_registrado', entidade: 'documento', entidadeId: documentoId,
    depois: { origem: dados.origem, caracteres: dados.texto.length, paginas: dados.paginas },
  });

  return { documentoId, caracteres: dados.texto.length, origem: dados.origem };
}

/** Tipos de que se consegue tirar texto sem adivinhar nada. */
const EXTRAIVEIS = new Set(['text/plain', 'text/csv']);

/**
 * Extrai o texto do arquivo já guardado, quando o formato permite.
 *
 * O QUE ISTO NÃO FAZ, e é a maior parte dos casos: PDF e imagem. Extrair
 * texto de PDF exige interpretar a estrutura do documento, e imagem exige
 * OCR; nenhum dos dois está construído, e inventar um resultado ruim seria
 * pior do que não ter — análise sobre texto estragado produz achado estragado,
 * com a mesma cara de confiável. Então, para esses, a função recusa dizendo
 * exatamente o que falta, e o texto continua entrando colado.
 */
export async function extrairDoArquivo(
  db: PoolClient, documentoId: string, identidade: Identidade, dep: Deposito,
) {
  const { rows } = await db.query<{
    organizacao_id: string; titulo: string; tem_arquivo: boolean;
    tipo_mime: string | null; hash_sha256: string | null;
  }>(
    `SELECT organizacao_id, titulo, tem_arquivo, tipo_mime, hash_sha256
       FROM documentos WHERE id = $1`, [documentoId]);
  const doc = rows[0];
  if (!doc) throw new NaoEncontrado('documento não encontrado');
  if (!doc.tem_arquivo || !doc.hash_sha256) {
    throw new PedidoInvalido('este documento não tem arquivo guardado para extrair');
  }

  const mime = (doc.tipo_mime ?? '').split(';')[0]!.trim();
  if (!EXTRAIVEIS.has(mime)) {
    throw new PedidoInvalido(
      `não há extrator para ${mime || 'este formato'}. Extração de PDF e OCR de ` +
      'imagem não foram construídas: cole o texto em POST /api/documentos/:id/texto.');
  }

  const bytes = await dep.armazenamento.ler(chaveDoHash(doc.hash_sha256), doc.hash_sha256);
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PedidoInvalido('o arquivo não é UTF-8 válido e não pôde ser lido como texto');
  }
  if (texto.trim() === '') throw new PedidoInvalido('o arquivo não tem texto');

  return registrarTexto(db, documentoId, { texto, origem: 'texto_enviado' }, identidade);
}

/**
 * O que a análise precisa do banco, lido numa transação curta.
 *
 * A leitura, a chamada de modelo e a gravação são TRÊS passos separados de
 * propósito: a chamada ao modelo pode levar mais de um minuto, e manter
 * transação aberta durante ela prende uma conexão do pool e trava escrita
 * alheia. Transação curta, chamada fora, transação curta.
 */
export interface AlvoDaAnalise {
  readonly documentoId: string;
  readonly organizacaoId: string;
  readonly projetoId: string | null;
  readonly titulo: string;
  readonly texto: string;
  readonly origemDoTexto: string;
}

export async function carregar(db: PoolClient, documentoId: string): Promise<AlvoDaAnalise> {
  const { rows } = await db.query<{
    organizacao_id: string; projeto_id: string | null; titulo: string;
    texto: string | null; origem_texto: string | null;
  }>(
    `SELECT d.organizacao_id, d.projeto_id, d.titulo,
            t.texto, t.origem AS origem_texto
       FROM documentos d LEFT JOIN documento_textos t ON t.documento_id = d.id
      WHERE d.id = $1`, [documentoId]);
  const documento = rows[0];
  if (!documento) throw new NaoEncontrado('documento não encontrado');
  if (documento.texto === null) {
    throw new PedidoInvalido(
      'documento sem texto extraído: registre o texto antes de analisar ' +
      '(POST /api/documentos/:id/texto)');
  }
  return {
    documentoId,
    organizacaoId: documento.organizacao_id,
    projetoId: documento.projeto_id,
    titulo: documento.titulo,
    texto: documento.texto,
    origemDoTexto: documento.origem_texto ?? 'texto_enviado',
  };
}

/** Roda a triagem. Sem transação aberta — ver `carregar`. */
export function rodar(
  alvo: AlvoDaAnalise, dados: z.infer<typeof EsquemaExecucao>, provedor: Provedor,
) {
  return triar(alvo.texto, { ...(dados.comIa ? { provedor } : {}) });
}

/**
 * Persiste a triagem.
 *
 * O achado que não sobreviveu aos portões NÃO é gravado como achado — mas o
 * descarte volta na resposta e vai para a auditoria. Esconder o descarte
 * tornaria a taxa de alucinação do modelo invisível, que é exatamente a
 * informação que o escritório precisa ter.
 */
export async function gravar(
  db: PoolClient, alvo: AlvoDaAnalise,
  resultado: Awaited<ReturnType<typeof triar>>, identidade: Identidade,
) {
  const { rows: criadas } = await db.query<{ id: string }>(
    `INSERT INTO analises (organizacao_id, documento_id, projeto_id,
       tipo_sugerido, certeza, pontos, criterio,
       estagio_ia, motivo_ia, modelo_ia, tokens_entrada, tokens_saida,
       identificadores, suspeitas, citacoes, alternativas, partes, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [alvo.organizacaoId, alvo.documentoId, alvo.projetoId,
     resultado.classificacao.tipo, resultado.classificacao.certeza,
     resultado.classificacao.pontos, resultado.classificacao.criterio,
     resultado.estagioIa, resultado.motivoIa, resultado.modeloIa,
     resultado.tokensEntrada, resultado.tokensSaida,
     JSON.stringify(resultado.identificadores),
     JSON.stringify(resultado.suspeitas),
     JSON.stringify(resultado.citacoesDoDocumento.referencias),
     JSON.stringify(resultado.classificacao.alternativas),
     resultado.partes, identidade.usuarioId]);
  const analiseId = criadas[0]!.id;

  let ordem = 0;
  for (const a of resultado.achados) {
    await db.query(
      `INSERT INTO achados (analise_id, organizacao_id, ordem, categoria, gravidade,
         titulo, descricao, natureza, trecho_citado, trecho_inicio, trecho_fim,
         fundamento_chave, fundamento_status, origem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [analiseId, alvo.organizacaoId, ordem++, a.categoria, a.gravidade,
       a.titulo,
       // As ressalvas vão junto da descrição: é o que o advogado precisa ler
       // antes de confiar, e separá-las em outra tela significa não ler.
       [a.descricao, ...a.ressalvas.map((r) => `⚠ ${r}`)].join('\n'),
       a.natureza, a.trechoCitado, a.trechoInicio, a.trechoFim,
       a.fundamentoChave, a.fundamentoStatus, a.origem]);
  }

  await auditar(db, {
    organizacaoId: alvo.organizacaoId, usuarioId: identidade.usuarioId,
    acao: 'analise.executada', entidade: 'analise', entidadeId: analiseId,
    depois: {
      documento: alvo.titulo,
      origemDoTexto: alvo.origemDoTexto,
      tipoSugerido: resultado.classificacao.tipo,
      estagioIa: resultado.estagioIa, motivoIa: resultado.motivoIa,
      achados: resultado.achados.length,
      // A taxa de descarte é informação de gestão: fica na trilha.
      achadosRecusados: resultado.achadosRecusados,
    },
  });

  return {
    id: analiseId,
    origemDoTexto: alvo.origemDoTexto,
    ...resumir(resultado),
    achadosRecusados: resultado.achadosRecusados,
  };
}

function resumir(r: Awaited<ReturnType<typeof triar>>) {
  return {
    tipoSugerido: r.classificacao.tipo,
    rotuloDoTipo: ROTULO_DO_TIPO[r.classificacao.tipo],
    certeza: r.classificacao.certeza,
    criterio: r.classificacao.criterio,
    sinais: r.classificacao.sinais,
    alternativas: r.classificacao.alternativas.map((a) => ({
      ...a, rotulo: ROTULO_DO_TIPO[a.tipo],
    })),
    estagioIa: r.estagioIa,
    motivoIa: r.motivoIa,
    modeloIa: r.modeloIa,
    resumo: r.resumo,
    partes: r.partes,
    caracteres: r.caracteres,
    identificadores: r.identificadores,
    suspeitas: r.suspeitas,
    citacoes: {
      resumo: r.citacoesDoDocumento.resumo,
      aprovada: r.citacoesDoDocumento.aprovada,
      referencias: r.citacoesDoDocumento.referencias.map((x) => ({
        ...x,
        rotuloDoStatus: ROTULO_DO_STATUS[x.status],
        rotuloDaNatureza: ROTULO_DA_NATUREZA[x.natureza],
      })),
    },
    achados: r.achados,
  };
}

/** Análises de um documento, da mais recente para a mais antiga. */
export async function analises(db: PoolClient, documentoId: string) {
  const { rows } = await db.query(
    `SELECT a.id, a.tipo_sugerido, a.tipo_validado, a.certeza, a.criterio,
            a.estagio_ia, a.motivo_ia, a.modelo_ia, a.partes, a.criado_em,
            a.validado_em, u.nome AS validado_por,
            (SELECT count(*) FROM achados c WHERE c.analise_id = a.id) AS achados,
            (SELECT count(*) FROM achados c WHERE c.analise_id = a.id
               AND c.gravidade = 'critico' AND c.situacao = 'aberto') AS criticos_abertos
       FROM analises a LEFT JOIN usuarios u ON u.id = a.validado_por
      WHERE a.documento_id = $1
      ORDER BY a.criado_em DESC`, [documentoId]);
  return rows.map((r) => ({
    ...r,
    rotuloDoTipo: ROTULO_DO_TIPO[(r as { tipo_sugerido: TipoDeDocumento }).tipo_sugerido],
    // Enquanto não houver validação humana, nada a jusante pode tratar o tipo
    // como definitivo.
    definitivo: (r as { tipo_validado: string | null }).tipo_validado !== null,
  }));
}

/** Uma análise com seus achados. */
export async function detalhe(db: PoolClient, analiseId: string) {
  const { rows } = await db.query(
    `SELECT a.*, d.titulo AS documento, u.nome AS validado_por_nome
       FROM analises a JOIN documentos d ON d.id = a.documento_id
       LEFT JOIN usuarios u ON u.id = a.validado_por
      WHERE a.id = $1`, [analiseId]);
  const analise = rows[0];
  if (!analise) throw new NaoEncontrado('análise não encontrada');

  const { rows: achados } = await db.query(
    `SELECT c.*, u.nome AS revisado_por_nome
       FROM achados c LEFT JOIN usuarios u ON u.id = c.revisado_por
      WHERE c.analise_id = $1 ORDER BY
        CASE c.gravidade WHEN 'critico' THEN 0 WHEN 'atencao' THEN 1 ELSE 2 END,
        c.ordem`, [analiseId]);

  const tipo = (analise as { tipo_sugerido: TipoDeDocumento }).tipo_sugerido;
  // As colunas JSONB guardam o dado cru; os rótulos legíveis são montados na
  // leitura, para que mudar um rótulo não exija reescrever análise gravada.
  const citacoes = (analise as {
    citacoes: Array<{ status: keyof typeof ROTULO_DO_STATUS; natureza: keyof typeof ROTULO_DA_NATUREZA }>;
  }).citacoes ?? [];
  const alternativas = (analise as {
    alternativas: Array<{ tipo: TipoDeDocumento }>;
  }).alternativas ?? [];

  return {
    ...analise,
    citacoes: citacoes.map((c) => ({
      ...c,
      rotuloDoStatus: ROTULO_DO_STATUS[c.status] ?? c.status,
      rotuloDaNatureza: ROTULO_DA_NATUREZA[c.natureza] ?? c.natureza,
    })),
    alternativas: alternativas.map((a) => ({ ...a, rotulo: ROTULO_DO_TIPO[a.tipo] ?? a.tipo })),
    rotuloDoTipo: ROTULO_DO_TIPO[tipo],
    definitivo: (analise as { tipo_validado: string | null }).tipo_validado !== null,
    achados: achados.map((a) => ({
      ...a,
      rotuloDaNatureza: ROTULO_DA_NATUREZA[
        (a as { natureza: 'legislacao' }).natureza] ?? 'Fato do documento',
    })),
  };
}

/** Validação humana do tipo sugerido (§7.7). */
export async function validarTipo(
  db: PoolClient, analiseId: string,
  dados: z.infer<typeof EsquemaValidacaoDeTipo>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string; tipo_sugerido: string }>(
    'SELECT organizacao_id, tipo_sugerido FROM analises WHERE id = $1', [analiseId]);
  const analise = rows[0];
  if (!analise) throw new NaoEncontrado('análise não encontrada');

  await db.query(
    `UPDATE analises SET tipo_validado = $2, validado_por = $3, validado_em = now(),
            observacao_validacao = $4
      WHERE id = $1`,
    [analiseId, dados.tipo, identidade.usuarioId, dados.observacao ?? null]);

  await auditar(db, {
    organizacaoId: analise.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'analise.tipo_validado', entidade: 'analise', entidadeId: analiseId,
    antes: { tipoSugerido: analise.tipo_sugerido },
    depois: { tipoValidado: dados.tipo, observacao: dados.observacao },
  });

  return { id: analiseId, tipoValidado: dados.tipo, definitivo: true };
}

/** Triagem de um achado pelo advogado: confirma ou descarta. */
export async function triarAchado(
  db: PoolClient, achadoId: string,
  dados: z.infer<typeof EsquemaTriagem>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string; titulo: string; origem: string }>(
    'SELECT organizacao_id, titulo, origem FROM achados WHERE id = $1', [achadoId]);
  const achado = rows[0];
  if (!achado) throw new NaoEncontrado('achado não encontrado');

  await db.query(
    `UPDATE achados SET situacao = $2, revisado_por = $3, revisado_em = now()
      WHERE id = $1`, [achadoId, dados.situacao, identidade.usuarioId]);

  await auditar(db, {
    organizacaoId: achado.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'achado.triado', entidade: 'achado', entidadeId: achadoId,
    depois: { situacao: dados.situacao, titulo: achado.titulo, origem: achado.origem },
  });

  return { id: achadoId, situacao: dados.situacao };
}

/** Estado honesto do estágio de IA, para a interface dizer a verdade. */
export function estadoDaIa(provedor: Provedor) {
  return {
    provedor: provedor.nome,
    disponivel: provedor.disponivel,
    impedimento: provedor.impedimento,
    // O que roda sem IA alguma. Não é consolo: é a maior parte.
    deterministicoSempreDisponivel: [
      'classificação do documento por sinais',
      'CNPJ, CPF e número de processo com dígito verificador',
      'valores e datas',
      'conferência de citações contra o corpus da NGA',
      'detecção de conteúdo com forma de instrução (§7.12)',
    ],
  };
}
