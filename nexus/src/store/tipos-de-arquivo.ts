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

/** Limites contra bomba de descompressão. */
const MAX_ENTRADAS_ZIP = 20_000;
const MAX_DESCOMPACTADO = 1024 * 1024 * 1024;

interface EntradaZip { readonly nome: string; readonly tamanho: number }

/** Lê o diretório central do ZIP: é ele, e não a primeira entrada, que diz o que há no pacote. */
function entradasDoZip(dados: Uint8Array): EntradaZip[] {
  const v = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  let fim = -1;
  for (let i = dados.length - 22; i >= Math.max(0, dados.length - 66_000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new TipoRecusado('arquivo compactado corrompido ou incompleto');
  const total = v.getUint16(fim + 10, true);
  if (total > MAX_ENTRADAS_ZIP) throw new TipoRecusado('arquivo compactado com entradas demais');
  let p = v.getUint32(fim + 16, true);
  const saida: EntradaZip[] = []; let soma = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > dados.length || v.getUint32(p, true) !== 0x02014b50) throw new TipoRecusado('arquivo compactado corrompido');
    const tamanho = v.getUint32(p + 24, true);
    const tn = v.getUint16(p + 28, true), te = v.getUint16(p + 30, true), tc = v.getUint16(p + 32, true);
    if (p + 46 + tn > dados.length) throw new TipoRecusado('arquivo compactado corrompido');
    saida.push({ nome: new TextDecoder().decode(dados.subarray(p + 46, p + 46 + tn)), tamanho });
    soma += tamanho;
    if (soma > MAX_DESCOMPACTADO) throw new TipoRecusado('arquivo compactado grande demais depois de aberto');
    p += 46 + tn + te + tc;
  }
  return saida;
}

const ATIVO_NO_ZIP = /(^|\/)(vbaProject\.bin|vbaData\.xml)$|\/activeX\/|\/embeddings\/oleObject|\.(exe|dll|com|scr|bat|cmd|ps1|vbs|js|jar|msi|lnk|hta)$/i;
function recusarConteudoAtivoNoZip(entradas: readonly EntradaZip[]): void {
  const achado = entradas.find((e) => ATIVO_NO_ZIP.test(e.nome));
  if (achado) throw new TipoRecusado('o arquivo contém macro ou programa embutido e foi recusado. Salve sem macros (.xlsx/.docx) ou em PDF');
}

/**
 * PDF não precisa rodar nada para ser documento. Nomes podem vir ofuscados
 * (`/J#61vaScript`), daí a normalização. Conteúdo dentro de stream comprimido
 * não é visto aqui: isto é uma barreira adicional, não substitui antivírus.
 */
function recusarPdfAtivo(dados: Uint8Array): void {
  const texto = new TextDecoder('latin1').decode(dados)
    .replace(/#([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  if (/\/(JavaScript|JS|Launch|RichMedia)\b/.test(texto)) {
    throw new TipoRecusado('o PDF contém script ou ação automática e foi recusado. Imprima como PDF e envie de novo');
  }
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

  if (comecaCom(dados, [0x25, 0x50, 0x44, 0x46, 0x2d])) { recusarPdfAtivo(dados); return PDF; } // %PDF-
  if (comecaCom(dados, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (comecaCom(dados, [0xff, 0xd8, 0xff])) return JPEG;

  if (comecaCom(dados, [0x50, 0x4b, 0x03, 0x04])) {                           // PK\x03\x04
    const odf = mimetypeDoOdf(dados);
    const entradas = entradasDoZip(dados);
    recusarConteudoAtivoNoZip(entradas);
    if (odf?.startsWith(ODT.mime)) return ODT;
    if (odf?.startsWith(ODS.mime)) return ODS;

    // Decide pelas partes do pacote, não pelo nome nem pela ordem: exportadores de ERP
    // e bibliotecas como openpyxl não gravam [Content_Types].xml como primeira entrada.
    const nomes = new Set(entradas.map((e) => e.nome));
    if (nomes.has('[Content_Types].xml')) {
      if (nomes.has('word/document.xml')) return DOCX;
      if (nomes.has('xl/workbook.xml')) return XLSX;
      // Pacote mínimo, sem as partes usuais: só a extensão resta para separar os dois.
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
