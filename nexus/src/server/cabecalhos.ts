/**
 * Cabeçalhos de segurança da aplicação.
 *
 * O CSP não permite script inline nem de terceiros: mesmo que um nome de credor
 * vindo de OCR passasse pelo escape, o navegador se recusaria a executá-lo.
 * `style-src 'unsafe-inline'` fica porque as telas usam `style=""`; CSS não
 * executa código nem lê cookie HttpOnly.
 */
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

export function aplicarCabecalhos(h: Headers, opcoes: { https: boolean; pagina: boolean }): void {
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'no-referrer');
  h.set('x-frame-options', 'DENY');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  h.set('cross-origin-opener-policy', 'same-origin');
  if (opcoes.https) h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  // A página de definir senha e o download trazem CSP próprio, mais restrito: não sobrescrever.
  if (opcoes.pagina && !h.has('content-security-policy')) h.set('content-security-policy', CSP);
}
