/**
 * Segundo fator por aplicativo autenticador (TOTP, RFC 6238).
 *
 * Código de 6 dígitos, HMAC-SHA1, passo de 30 segundos: o padrão que o Google
 * Authenticator, o Microsoft Authenticator e o 1Password entendem sem ajuste.
 * Aceita o passo anterior e o seguinte (relógio do celular adiantado ou
 * atrasado) e devolve QUAL passo conferiu, para o banco recusar o mesmo código
 * duas vezes.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PASSO_SEGUNDOS = 30;
const DIGITOS = 6;

export function base32(bytes: Uint8Array): string {
  let bits = 0; let valor = 0; let saida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { saida += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

export function deBase32(texto: string): Uint8Array {
  const limpo = texto.toUpperCase().replace(/[\s=-]/g, '');
  const saida: number[] = []; let bits = 0; let valor = 0;
  for (const c of limpo) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error('chave do autenticador inválida');
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { saida.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(saida);
}

/** 160 bits, o tamanho recomendado pela RFC 4226 para HMAC-SHA1. */
export function segredoNovo(): string {
  return base32(randomBytes(20));
}

export function codigoDoPasso(segredo: string, passo: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', Buffer.from(deBase32(segredo))).update(contador).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

export const passoAtual = (agora = Date.now()) => Math.floor(agora / 1000 / PASSO_SEGUNDOS);

/** Devolve o passo que conferiu, ou `null`. Comparação em tempo constante. */
export function conferirCodigo(segredo: string, codigo: string, agora = Date.now()): number | null {
  const limpo = codigo.replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpo)) return null;
  const atual = passoAtual(agora);
  let achado: number | null = null;
  for (const passo of [atual - 1, atual, atual + 1]) {
    const esperado = Buffer.from(codigoDoPasso(segredo, passo));
    if (timingSafeEqual(esperado, Buffer.from(limpo)) && achado === null) achado = passo;
  }
  return achado;
}

/** Endereço `otpauth://` que o aplicativo lê (abre direto no celular). */
export function enderecoOtpauth(email: string, segredo: string): string {
  const rotulo = encodeURIComponent(`NGA LAB:${email}`);
  return `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent('NGA LAB')}&algorithm=SHA1&digits=${DIGITOS}&period=${PASSO_SEGUNDOS}`;
}

/** A chave em blocos de 4, para digitar sem errar. */
export const chaveLegivel = (segredo: string) => segredo.match(/.{1,4}/g)!.join(' ');
