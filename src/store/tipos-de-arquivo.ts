/**
 * Reconhecimento do tipo do arquivo pelo CONTEÚDO.
 *
 * O `Content-Type` que o navegador envia é declaração do cliente, e cliente
 * não é fonte de verdade — basta renomear um `.html` para `.pdf` e declarar
 * `application/pdf`. Se o acervo aceitasse isso, o escritório viraria
 * hospedeiro de página maliciosa servida do próprio domínio, com os cookies
 * de sessão dos advogados ao alcance.
 *
 * Então o tipo é determinado pelos bytes, e só os tipos da lista entram. O
 * nome do arquivo participa de UMA decisão apenas — distinguir .docx de .xlsx,
 * que são o mesmo contêiner ZIP — e de nenhuma outra; em especial, nunca
 * participa do caminho em disco (ver `arquivos.ts`).
 */

export interface TipoReconhecido {
  readonly mime: string;
  readonly rotulo: string;
  /** Extensão canônica, para o nome sugerido no download. */
  readonly extensao: string;
}

export class TipoRecusado extends Error {
  override readonly name = 'TipoRecusado';
  constructor(motivo: string) { super(motivo); }
}

const PDF: TipoReconhecido = { mime: 'application/pdf', rotulo: 'PDF', extensao: 'pdf' };
const PNG: TipoReconhecido = { mime: 'image/png', rotulo: 'Imagem PNG', extensao: 'png' };
const JPEG: TipoReconhecido = { mime: 'image/jpeg', rotulo: 'Imagem JPEG', extensao: 'jpg' };
const TXT: TipoReconhecido = { mime: 'text/plain; charset=utf-8', rotulo: 'Texto', extensao: 'txt' };
const CSV: TipoReconhecido = { mime: 'text/csv; charset=utf-8', rotulo: 'Planilha CSV', extensao: 'csv' };
const DOCX: TipoReconhecido = {
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rotulo: 'Documento Word', extensao: 'docx',
};
const XLSX: TipoReconhecido = {
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  rotulo: 'Planilha Excel', extensao: 'xlsx',
};
const ODT: TipoReconhecido = {
  mime: 'application/vnd.oasis.opendocument.text',
  rotulo: 'Documento ODF', extensao: 'odt',
};
const ODS: TipoReconhecido = {
  mime: 'application/vnd.oasis.opendocument.spreadsheet',
  rotulo: 'Planilha ODF', extensao: 'ods',
};

export const TIPOS_ACEITOS: readonly TipoReconhecido[] = Object.freeze([
  PDF, PNG, JPEG, TXT, CSV, DOCX, XLSX, ODT, ODS,
]);

function comecaCom(dados: Uint8Array, assinatura: readonly number[]): boolean {
  if (dados.length < assinatura.length) return false;
  return assinatura.every((b, i) => dados[i] === b);
}

/** Lê o nome da primeira entrada do ZIP, que fica logo após o cabeçalho local. */
function primeiraEntradaDoZip(dados: Uint8Array): string | null {
  if (dados.length < 30) return null;
  const tamanhoDoNome = dados[26]! | (dados[27]! << 8);
  if (tamanhoDoNome === 0 || 30 + tamanhoDoNome > dados.length) return null;
  return new TextDecoder('utf-8', { fatal: false })
    .decode(dados.subarray(30, 30 + tamanhoDoNome));
}

/**
 * ODF guarda o mimetype como primeira entrada, sem compressão, exatamente
 * para permitir esta identificação.
 */
function mimetypeDoOdf(dados: Uint8Array): string | null {
  if (primeiraEntradaDoZip(dados) !== 'mimetype') return null;
  const inicio = 38; // 30 do cabeçalho + 8 de "mimetype"
  const fim = Math.min(inicio + 80, dados.length);
  return new TextDecoder('utf-8', { fatal: false }).decode(dados.subarray(inicio, fim));
}

const AMOSTRA_DE_TEXTO = 64 * 1024;

/** Texto é o que decodifica como UTF-8 e não tem byte de controle binário. */
function pareceTexto(dados: Uint8Array): boolean {
  const amostra = dados.subarray(0, AMOSTRA_DE_TEXTO);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(amostra);
  } catch {
    return false;
  }
  for (const b of amostra) {
    // Controles C0 fora de tab, LF, CR e form feed denunciam binário.
    if (b < 0x09 || (b > 0x0d && b < 0x20)) return false;
  }
  return true;
}

function extensaoDe(nome: string): string {
  const ponto = nome.lastIndexOf('.');
  return ponto === -1 ? '' : nome.slice(ponto + 1).toLowerCase();
}

/**
 * Determina o tipo pelo conteúdo, ou recusa.
 *
 * `nomeOriginal` entra só para separar .docx de .xlsx; se faltar ou não
 * disser, o contêiner OOXML é recusado em vez de adivinhado.
 */
export function reconhecerTipo(dados: Uint8Array, nomeOriginal = ''): TipoReconhecido {
  if (dados.length === 0) throw new TipoRecusado('arquivo vazio');

  if (comecaCom(dados, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF;           // %PDF-
  if (comecaCom(dados, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (comecaCom(dados, [0xff, 0xd8, 0xff])) return JPEG;

  if (comecaCom(dados, [0x50, 0x4b, 0x03, 0x04])) {                           // PK\x03\x04
    const odf = mimetypeDoOdf(dados);
    if (odf?.startsWith(ODT.mime)) return ODT;
    if (odf?.startsWith(ODS.mime)) return ODS;

    if (primeiraEntradaDoZip(dados)?.startsWith('[Content_Types].xml')) {
      // Único ponto em que o nome do arquivo decide algo. Sem extensão que
      // resolva, recusa — melhor do que gravar um tipo que pode estar errado.
      const ext = extensaoDe(nomeOriginal);
      if (ext === 'docx') return DOCX;
      if (ext === 'xlsx') return XLSX;
      throw new TipoRecusado(
        'contêiner Office sem extensão que identifique o formato: renomeie para .docx ou .xlsx');
    }
    throw new TipoRecusado(
      'arquivo ZIP não é aceito: envie o documento em PDF, Word, Excel ou ODF');
  }

  if (pareceTexto(dados)) {
    return extensaoDe(nomeOriginal) === 'csv' ? CSV : TXT;
  }

  throw new TipoRecusado(
    'tipo de arquivo não aceito. Aceitos: ' +
    TIPOS_ACEITOS.map((t) => t.extensao).join(', '));
}

/** Tamanho máximo do nome no cabeçalho, extensão incluída. */
const LIMITE_DO_NOME = 120;

/** Nome seguro para o `Content-Disposition`, sem caminho nem controle. */
export function nomeSeguro(nomeOriginal: string, tipo: TipoReconhecido): string {
  const base = nomeOriginal
    .split(/[\\/]/).pop()!                    // descarta qualquer caminho
    .replace(/[\u0000-\u001f\u007f"]/g, '')   // controles e aspas quebram o cabeçalho
    .trim();

  let nome = base || `documento.${tipo.extensao}`;
  if (!extensaoDe(nome)) nome = `${nome}.${tipo.extensao}`;

  if (nome.length > LIMITE_DO_NOME) {
    // Trunca o miolo, nunca a extensão: nome cortado o usuário entende, nome
    // sem extensão o sistema operacional dele não abre.
    const sufixo = `.${extensaoDe(nome)}`;
    nome = nome.slice(0, LIMITE_DO_NOME - sufixo.length) + sufixo;
  }
  return nome;
}
