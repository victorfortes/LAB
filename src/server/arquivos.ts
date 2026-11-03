/**
 * Recebimento, guarda e entrega de arquivo de documento.
 *
 * O CAMINHO DE SAÍDA, que é o que o §12.4 regula, tem três conferências em
 * série, e nenhuma substitui a outra:
 *
 *   1. ASSINATURA — o link foi emitido por nós, para aquele usuário, e ainda
 *      está no prazo (`src/security/assinatura.ts`).
 *   2. AUTORIZAÇÃO — a consulta roda sob o RLS daquele usuário, AGORA. É isto
 *      que faz despublicar um documento ou revogar um vínculo matar o link na
 *      hora, em vez de esperar o prazo correr (§12.3).
 *   3. INTEGRIDADE — o conteúdo lido confere com o hash gravado, ou a entrega
 *      falha em voz alta (`src/store/arquivos.ts`).
 *
 * E toda entrega é auditada: num escritório de insolvência, saber quem baixou
 * o balanço da recuperanda e quando é parte do serviço, não enfeite.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import {
  type Armazenamento, ArquivoAusente, ArquivoCorrompido, chaveDoHash,
} from '../store/arquivos.ts';
import {
  TIPOS_ACEITOS, TipoRecusado, nomeSeguro, reconhecerTipo,
} from '../store/tipos-de-arquivo.ts';
import {
  type SegredoDeArquivos, VALIDADE_PADRAO_SEGUNDOS, assinar, segredoDeArquivos,
} from '../security/assinatura.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

/** 50 MB. Petição com anexos cabe; vídeo e imagem de disco, não. */
export const LIMITE_BYTES = 50 * 1024 * 1024;

export interface Deposito {
  readonly armazenamento: Armazenamento;
  readonly segredo: SegredoDeArquivos;
  readonly validadeSegundos: number;
  readonly limiteBytes: number;
}

export function deposito(
  armazenamento: Armazenamento,
  env: Record<string, string | undefined> = process.env,
): Deposito {
  return {
    armazenamento,
    segredo: segredoDeArquivos(env),
    validadeSegundos: Number(env['NGA_VALIDADE_LINK'] ?? VALIDADE_PADRAO_SEGUNDOS),
    limiteBytes: Number(env['NGA_LIMITE_ARQUIVO'] ?? LIMITE_BYTES),
  };
}

export const EsquemaMetadados = z.object({
  titulo: z.string().min(1).max(300),
  categoria: z.string().max(120).optional(),
  requisitoId: z.string().uuid().optional(),
});

export interface ArquivoRecebido {
  readonly documentoId: string;
  readonly hash: string;
  readonly tamanho: number;
  readonly tipo: string;
  readonly rotuloDoTipo: string;
  readonly nome: string;
  /** O conteúdo já estava no acervo: outro documento aponta para os mesmos bytes. */
  readonly deduplicado: boolean;
}

/**
 * Guarda o conteúdo e cria a linha de `documentos`.
 *
 * O id é gerado AQUI, e o INSERT não usa `RETURNING`. Isso não é estilo: a
 * política de SELECT do portal não deixa o cliente ler documento interno, e
 * com `RETURNING` o PostgreSQL aplicaria essa política à linha devolvida e
 * recusaria o comando inteiro. Ver a migração 009.
 */
export async function receber(
  db: PoolClient,
  projetoId: string,
  arquivo: File,
  dados: z.infer<typeof EsquemaMetadados>,
  identidade: Identidade,
  dep: Deposito,
  origem: 'interno' | 'portal_cliente' = 'interno',
): Promise<ArquivoRecebido> {
  if (arquivo.size > dep.limiteBytes) {
    throw new PedidoInvalido(
      `arquivo de ${(arquivo.size / 1_048_576).toFixed(1)} MB excede o limite de ` +
      `${(dep.limiteBytes / 1_048_576).toFixed(0)} MB`);
  }

  const { rows } = await db.query<{ organizacao_id: string }>(
    'SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  const organizacaoId = rows[0]?.organizacao_id;
  // No portal, o projeto é da NGA e o cliente não lê `projetos.organizacao_id`
  // por esta via; quem chama pelo portal informa a organização do requisito.
  if (!organizacaoId && origem === 'interno') throw new NaoEncontrado('projeto não encontrado');

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  // O tipo vem dos BYTES, nunca do `Content-Type` que o navegador declarou.
  const tipo = reconhecerTipo(bytes, arquivo.name);
  const guardado = await dep.armazenamento.guardar(bytes);
  const nome = nomeSeguro(arquivo.name, tipo);

  const documentoId = crypto.randomUUID();
  await db.query(
    `INSERT INTO documentos (id, organizacao_id, projeto_id, titulo, categoria, caminho,
       tipo_mime, tamanho_bytes, hash_sha256, nome_original, tem_arquivo, armazenado_em,
       origem, visibilidade, enviado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,now(),$11,'interno',$12)`,
    [documentoId, organizacaoId ?? (await organizacaoDoProjeto(db, projetoId)), projetoId,
     dados.titulo, dados.categoria ?? null, guardado.chave, tipo.mime,
     guardado.tamanho, guardado.hash, nome, origem, identidade.usuarioId]);

  await auditar(db, {
    organizacaoId: organizacaoId ?? null, usuarioId: identidade.usuarioId,
    acao: 'documento.arquivo_recebido', entidade: 'documento', entidadeId: documentoId,
    depois: {
      titulo: dados.titulo, nome, tipo: tipo.mime, bytes: guardado.tamanho,
      hash: guardado.hash, deduplicado: guardado.jaExistia, origem,
    },
    origem: origem === 'portal_cliente' ? 'portal' : 'api',
  });

  return {
    documentoId, hash: guardado.hash, tamanho: guardado.tamanho,
    tipo: tipo.mime, rotuloDoTipo: tipo.rotulo, nome,
    deduplicado: guardado.jaExistia,
  };
}

/** O cliente não lê `projetos` pela via interna; o requisito dele é que sabe. */
async function organizacaoDoProjeto(db: PoolClient, projetoId: string): Promise<string> {
  const { rows } = await db.query<{ organizacao_id: string }>(
    'SELECT organizacao_id FROM requisitos WHERE projeto_id = $1 LIMIT 1', [projetoId]);
  const id = rows[0]?.organizacao_id;
  if (!id) throw new NaoEncontrado('projeto não encontrado');
  return id;
}

export interface LinkEmitido {
  readonly url: string;
  readonly expiraEm: string;
  readonly validadeSegundos: number;
  readonly nome: string;
  readonly tamanhoBytes: number;
  readonly tipo: string;
}

/**
 * Emite o link temporário.
 *
 * A consulta roda sob o RLS de quem pede: se o usuário não alcança o
 * documento, não há link a emitir. O download refaz a conferência, porque
 * entre a emissão e o clique a autorização pode ter mudado.
 */
export async function emitirLink(
  db: PoolClient, documentoId: string, identidade: Identidade, dep: Deposito,
): Promise<LinkEmitido> {
  const { rows } = await db.query<{
    tem_arquivo: boolean; nome_original: string | null; tamanho_bytes: string | null;
    tipo_mime: string | null; titulo: string;
  }>(
    `SELECT tem_arquivo, nome_original, tamanho_bytes, tipo_mime, titulo
       FROM documentos WHERE id = $1`, [documentoId]);
  const doc = rows[0];
  if (!doc) throw new NaoEncontrado('documento não encontrado');
  if (!doc.tem_arquivo) {
    throw new PedidoInvalido(
      'este documento é só um registro de referência: não há arquivo guardado para baixar');
  }

  const token = assinar(
    { documentoId, usuarioId: identidade.usuarioId }, dep.segredo.valor, dep.validadeSegundos);

  return {
    url: `/arquivos/${token}`,
    expiraEm: new Date(Date.now() + dep.validadeSegundos * 1000).toISOString(),
    validadeSegundos: dep.validadeSegundos,
    nome: doc.nome_original ?? doc.titulo,
    tamanhoBytes: Number(doc.tamanho_bytes ?? 0),
    tipo: doc.tipo_mime ?? 'application/octet-stream',
  };
}

export interface ConteudoEntregue {
  readonly dados: Uint8Array;
  readonly nome: string;
  readonly tipo: string;
}

/**
 * Lê o conteúdo, já sob o RLS do usuário do link.
 *
 * Um documento que deixou de ser alcançável — portal desligado, publicação
 * revogada, vínculo encerrado — simplesmente não aparece nesta consulta, e o
 * link morre sem precisar de lista de revogação.
 */
export async function entregar(
  db: PoolClient, documentoId: string, usuarioId: string, dep: Deposito,
): Promise<ConteudoEntregue> {
  const { rows } = await db.query<{
    organizacao_id: string; caminho: string; hash_sha256: string | null;
    tipo_mime: string | null; nome_original: string | null; titulo: string;
    tem_arquivo: boolean;
  }>(
    `SELECT organizacao_id, caminho, hash_sha256, tipo_mime, nome_original, titulo, tem_arquivo
       FROM documentos WHERE id = $1`, [documentoId]);
  const doc = rows[0];
  if (!doc || !doc.tem_arquivo) throw new NaoEncontrado('documento não encontrado');

  // A chave usada é a derivada do HASH, não a coluna `caminho` em si: assim um
  // caminho adulterado no banco não consegue apontar para outro arquivo.
  const chave = doc.hash_sha256 ? chaveDoHash(doc.hash_sha256) : doc.caminho;
  const dados = await dep.armazenamento.ler(chave, doc.hash_sha256 ?? undefined);

  await auditar(db, {
    organizacaoId: doc.organizacao_id, usuarioId,
    acao: 'documento.baixado', entidade: 'documento', entidadeId: documentoId,
    depois: { titulo: doc.titulo, bytes: dados.byteLength },
  });

  return {
    dados,
    nome: doc.nome_original ?? doc.titulo,
    tipo: doc.tipo_mime ?? 'application/octet-stream',
  };
}

/**
 * Resposta do download.
 *
 * SEMPRE `attachment`, inclusive para PDF e imagem. Servir conteúdo de
 * terceiro inline na mesma origem da aplicação é o caminho curto para XSS
 * armazenado — o documento passa a rodar com os cookies dos advogados ao
 * alcance. Exibir PDF embutido só volta a ser aceitável quando houver uma
 * origem separada para o acervo; enquanto não houver, baixa-se.
 */
export function respostaDeDownload(c: ConteudoEntregue): Response {
  const nomeAscii = c.nome.replace(/[^\x20-\x7e]/g, '_');
  return new Response(c.dados as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': c.tipo,
      'content-length': String(c.dados.byteLength),
      'content-disposition':
        `attachment; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(c.nome)}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      // Link temporário não se guarda em cache compartilhado.
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

/** Estado honesto do armazenamento, para a interface e a operação. */
export function estado(dep: Deposito) {
  return {
    armazenamento: dep.armazenamento.nome,
    limiteBytes: dep.limiteBytes,
    validadeDoLinkSegundos: dep.validadeSegundos,
    tiposAceitos: TIPOS_ACEITOS.map((t) => ({ extensao: t.extensao, rotulo: t.rotulo })),
    segredoEfemero: dep.segredo.efemero,
    aviso: dep.segredo.aviso,
    naoConstruido: [
      'Adaptador para S3, GCS ou Azure Blob: não há credencial de objeto nesta ' +
      'instalação e nenhuma chamada real foi feita.',
      'Extração de texto de PDF e OCR: o texto da análise ainda entra colado.',
      'Antivírus no recebimento: nenhum verificador está integrado.',
    ],
  };
}

export { ArquivoAusente, ArquivoCorrompido, TipoRecusado };
