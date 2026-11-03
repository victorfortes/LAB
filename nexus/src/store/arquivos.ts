/**
 * Armazenamento de arquivos, endereçado por conteúdo.
 *
 * TRÊS DECISÕES, todas com motivo jurídico antes de técnico:
 *
 * 1. A CHAVE É O HASH DO CONTEÚDO. Nenhum pedaço de entrada do usuário entra
 *    no caminho em disco — nem nome de arquivo, nem título, nem id. Travessia
 *    de diretório deixa de ser algo a filtrar e passa a ser algo impossível de
 *    exprimir. De brinde vem a deduplicação: a mesma certidão enviada por três
 *    credores ocupa espaço uma vez.
 *
 * 2. A INTEGRIDADE É CONFERIDA NA LEITURA. Documento que vai a juízo não pode
 *    sair daqui corrompido em silêncio. Se o conteúdo não bate com o hash
 *    gravado, a leitura falha em voz alta em vez de devolver bytes estragados.
 *
 * 3. A ESCRITA É ATÔMICA. Grava em temporário e renomeia. Processo morto no
 *    meio do upload deixa lixo no temporário, nunca um arquivo pela metade
 *    sob a chave de um documento válido.
 *
 * O QUE NÃO EXISTE AQUI: adaptador para S3, GCS ou Azure Blob. Não há
 * credencial de objeto nesta instalação, e o §22 proíbe afirmar que uma
 * integração funciona sem testá-la. A interface `Armazenamento` existe para
 * que esse adaptador caiba depois sem mexer no resto — mas enquanto não for
 * escrito e exercitado contra o serviço real, ele não existe.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface ArquivoGuardado {
  /** Caminho relativo dentro do armazenamento: "ab/cd/<sha256>". */
  readonly chave: string;
  readonly hash: string;
  readonly tamanho: number;
  /** O conteúdo já estava guardado: deduplicado, não regravado. */
  readonly jaExistia: boolean;
}

export interface Armazenamento {
  readonly nome: string;
  guardar(dados: Uint8Array): Promise<ArquivoGuardado>;
  /** Lê conferindo o hash. `hashEsperado` ausente usa o da própria chave. */
  ler(chave: string, hashEsperado?: string): Promise<Uint8Array>;
  existe(chave: string): Promise<boolean>;
  remover(chave: string): Promise<void>;
}

export class ErroDeArmazenamento extends Error {
  override readonly name = 'ErroDeArmazenamento';
}

/** O conteúdo em disco não corresponde ao hash gravado. */
export class ArquivoCorrompido extends ErroDeArmazenamento {
  constructor(readonly chave: string, readonly esperado: string, readonly encontrado: string) {
    super(
      `o arquivo ${chave} não confere com o hash registrado ` +
      `(esperado ${esperado.slice(0, 12)}…, encontrado ${encontrado.slice(0, 12)}…)`);
  }
}

export class ArquivoAusente extends ErroDeArmazenamento {
  constructor(readonly chave: string) {
    super(`arquivo não encontrado no armazenamento: ${chave}`);
  }
}

/** Formato da chave. Só isto é aceito, e é por isso que não há travessia. */
const CHAVE = /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/;

export function chaveDoHash(hash: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new ErroDeArmazenamento(`hash inválido: ${hash}`);
  }
  // Dois níveis de prefixo: nenhum diretório acumula milhões de entradas.
  return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

export function hashDoConteudo(dados: Uint8Array): string {
  return createHash('sha256').update(dados).digest('hex');
}

export class ArmazenamentoLocal implements Armazenamento {
  readonly nome = 'local';
  readonly #raiz: string;
  readonly #temporarios: string;

  /**
   * `raiz` tem de estar FORA da pasta servida estaticamente. Se o conteúdo
   * pudesse ser alcançado por caminho estático, a URL assinada seria enfeite:
   * bastaria pedir o arquivo direto, sem assinatura e sem expiração (§12.4).
   */
  constructor(raiz: string) {
    this.#raiz = resolve(raiz);
    this.#temporarios = join(this.#raiz, '.parciais');
  }

  async iniciar(): Promise<void> {
    await mkdir(this.#temporarios, { recursive: true });
  }

  #destino(chave: string): string {
    if (!CHAVE.test(chave)) throw new ErroDeArmazenamento(`chave inválida: ${chave}`);
    const caminho = resolve(this.#raiz, chave);
    // Cinto e suspensório: a regex já garante, mas o custo desta conferência é
    // zero e o preço de errá-la é o acervo inteiro do escritório.
    if (!caminho.startsWith(`${this.#raiz}/`)) {
      throw new ErroDeArmazenamento(`chave fora da raiz do armazenamento: ${chave}`);
    }
    return caminho;
  }

  async guardar(dados: Uint8Array): Promise<ArquivoGuardado> {
    const hash = hashDoConteudo(dados);
    const chave = chaveDoHash(hash);
    const destino = this.#destino(chave);

    if (await this.existe(chave)) {
      return { chave, hash, tamanho: dados.byteLength, jaExistia: true };
    }

    await mkdir(dirname(destino), { recursive: true });
    await mkdir(this.#temporarios, { recursive: true });
    const parcial = join(this.#temporarios, `${hash}-${crypto.randomUUID()}`);
    try {
      await writeFile(parcial, dados, { mode: 0o600 });
      // rename dentro do mesmo sistema de arquivos é atômico: ou o arquivo
      // inteiro está lá sob a chave, ou não está nada.
      await rename(parcial, destino);
    } catch (e) {
      await rm(parcial, { force: true }).catch(() => {});
      throw new ErroDeArmazenamento(`falha ao guardar ${chave}: ${(e as Error).message}`);
    }

    return { chave, hash, tamanho: dados.byteLength, jaExistia: false };
  }

  async ler(chave: string, hashEsperado?: string): Promise<Uint8Array> {
    const destino = this.#destino(chave);
    let dados: Buffer;
    try {
      dados = await readFile(destino);
    } catch {
      throw new ArquivoAusente(chave);
    }

    // O hash está na própria chave; conferir é barato e pega disco corrompido,
    // restauração incompleta e substituição indevida.
    const esperado = hashEsperado ?? chave.slice(chave.lastIndexOf('/') + 1);
    const encontrado = hashDoConteudo(dados);
    if (encontrado !== esperado) throw new ArquivoCorrompido(chave, esperado, encontrado);

    return new Uint8Array(dados);
  }

  async existe(chave: string): Promise<boolean> {
    try {
      const s = await stat(this.#destino(chave));
      return s.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Remove o conteúdo.
   *
   * CUIDADO DE QUEM CHAMAR: como o endereçamento é por conteúdo, dois
   * documentos com o mesmo arquivo compartilham a chave. Apagar aqui some com
   * o arquivo dos dois. Quem remover precisa antes conferir que nenhuma outra
   * linha de `documentos` referencia o mesmo hash.
   */
  async remover(chave: string): Promise<void> {
    await rm(this.#destino(chave), { force: true });
  }
}
