/**
 * URL assinada e temporária para documento privado (§12.4).
 *
 * "Não disponibilizar documentos privados por URLs públicas permanentes."
 *
 * O QUE A ASSINATURA É E O QUE ELA NÃO É
 *
 * Ela É prova de que este link foi emitido por nós, PARA AQUELE USUÁRIO, e de
 * que ainda está dentro do prazo. Por isso a concessão carrega o id do
 * usuário: um link assinado que serve a qualquer um é a URL pública permanente
 * de novo, só que com data de validade.
 *
 * Ela NÃO É autorização. O §12.3 manda verificar permissão no backend, e é o
 * que o download faz: resolve o usuário da concessão e refaz a consulta sob o
 * RLS DELE, a cada requisição. Consequência prática — e é a parte que importa
 * num escritório: despublicar um documento, desligar um portal ou revogar um
 * vínculo mata o link na hora, sem esperar o prazo correr. A assinatura
 * encurta a janela; o RLS é quem decide.
 *
 * O segredo nunca sai daqui, e a comparação é em tempo constante.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Concessao {
  readonly documentoId: string;
  /** A QUEM o link foi emitido. Sem isto, o link é portador puro. */
  readonly usuarioId: string;
  /** Unix em segundos. */
  readonly expiraEm: number;
}

export class AssinaturaInvalida extends Error {
  override readonly name = 'AssinaturaInvalida';
  constructor(motivo: string) { super(`link inválido: ${motivo}`); }
}

export class AssinaturaExpirada extends Error {
  override readonly name = 'AssinaturaExpirada';
  constructor() { super('o link expirou; peça um novo'); }
}

const VERSAO = 'v1';
/** Cinco minutos: tempo de clicar e baixar, não de guardar e repassar. */
export const VALIDADE_PADRAO_SEGUNDOS = 300;
const VALIDADE_MAXIMA_SEGUNDOS = 3600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function corpo(c: Concessao): string {
  return `${VERSAO}.${c.documentoId}.${c.usuarioId}.${c.expiraEm}`;
}

function hmac(mensagem: string, segredo: string): string {
  return createHmac('sha256', segredo).update(mensagem).digest('base64url');
}

export function assinar(
  concessao: Omit<Concessao, 'expiraEm'>,
  segredo: string,
  validadeSegundos = VALIDADE_PADRAO_SEGUNDOS,
): string {
  if (!UUID.test(concessao.documentoId)) throw new AssinaturaInvalida('documento');
  if (!UUID.test(concessao.usuarioId)) throw new AssinaturaInvalida('usuário');
  if (validadeSegundos <= 0 || validadeSegundos > VALIDADE_MAXIMA_SEGUNDOS) {
    throw new AssinaturaInvalida(
      `validade fora da faixa (1 a ${VALIDADE_MAXIMA_SEGUNDOS} segundos)`);
  }

  const completa: Concessao = {
    ...concessao,
    expiraEm: Math.floor(Date.now() / 1000) + validadeSegundos,
  };
  return `${corpo(completa)}.${hmac(corpo(completa), segredo)}`;
}

/**
 * Confere assinatura e prazo. NÃO confere permissão — quem chama tem de
 * consultar o banco sob o RLS do usuário devolvido.
 */
export function verificar(token: string, segredo: string, agora = Date.now()): Concessao {
  const partes = token.split('.');
  if (partes.length !== 5) throw new AssinaturaInvalida('formato');

  const [versao, documentoId, usuarioId, expiraTexto, assinatura] = partes as
    [string, string, string, string, string];
  if (versao !== VERSAO) throw new AssinaturaInvalida('versão');
  if (!UUID.test(documentoId) || !UUID.test(usuarioId)) {
    throw new AssinaturaInvalida('identificador');
  }
  const expiraEm = Number(expiraTexto);
  if (!Number.isSafeInteger(expiraEm) || expiraEm <= 0) {
    throw new AssinaturaInvalida('prazo');
  }

  const concessao: Concessao = { documentoId, usuarioId, expiraEm };
  const esperada = Buffer.from(hmac(corpo(concessao), segredo));
  const recebida = Buffer.from(assinatura);

  // A ASSINATURA É CONFERIDA ANTES DO PRAZO, de propósito: responder "expirou"
  // a um token forjado confirmaria ao atacante que o resto do token é válido.
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) {
    throw new AssinaturaInvalida('assinatura');
  }
  if (Math.floor(agora / 1000) >= expiraEm) throw new AssinaturaExpirada();

  return concessao;
}

export interface SegredoDeArquivos {
  readonly valor: string;
  /**
   * Verdadeiro quando o segredo foi sorteado neste processo, por falta da
   * variável de ambiente: os links param de valer no próximo reinício.
   */
  readonly efemero: boolean;
  readonly aviso: string | null;
}

const TAMANHO_MINIMO = 32;

/**
 * Resolve o segredo do ambiente.
 *
 * Sem `NGA_SEGREDO_ARQUIVOS`, sorteia um e DECLARA que sorteou. Não falha,
 * porque desenvolvimento e demonstração têm de rodar; mas também não finge que
 * está configurado — o aviso sobe até a API, para a operação saber que links
 * emitidos agora morrem no próximo deploy.
 */
export function segredoDeArquivos(
  env: Record<string, string | undefined> = process.env,
): SegredoDeArquivos {
  const bruto = env['NGA_SEGREDO_ARQUIVOS']?.trim();
  if (bruto && bruto.length >= TAMANHO_MINIMO) {
    return { valor: bruto, efemero: false, aviso: null };
  }
  const motivo = bruto
    ? `NGA_SEGREDO_ARQUIVOS tem menos de ${TAMANHO_MINIMO} caracteres e foi ignorada`
    : 'NGA_SEGREDO_ARQUIVOS não está configurada';
  return {
    valor: randomBytes(32).toString('base64url'),
    efemero: true,
    aviso:
      `${motivo}: um segredo foi sorteado para este processo. Os links assinados ` +
      'deixam de valer a cada reinício, e não funcionam com mais de uma instância ' +
      'do servidor. Configure a variável antes de pôr em produção.',
  };
}
