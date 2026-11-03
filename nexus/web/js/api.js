/**
 * Cliente da API. Toda requisição leva o cookie de sessão; 401 manda para o
 * login. O erro devolvido pelo servidor vira a mensagem do `Error`, porque é
 * ela que a interface mostra ao usuário — "não dá para saltar de X para Y sem
 * passar por Z" é a informação, não um detalhe técnico.
 */
let aoDeslogar = () => {};
export const aoPerderSessao = (fn) => { aoDeslogar = fn; };

export class ErroDeApi extends Error {
  constructor(msg, status, detalhe) { super(msg); this.status = status; this.detalhe = detalhe; }
}

async function pedir(caminho, opcoes = {}) {
  const r = await fetch(caminho, { credentials: 'same-origin', ...opcoes });
  const corpo = r.status === 204 ? null : await r.json().catch(() => null);
  if (r.status === 401 && !caminho.startsWith('/api/sessao')) aoDeslogar();
  if (!r.ok) throw new ErroDeApi(corpo?.erro ?? `erro ${r.status}`, r.status, corpo?.detalhe);
  return corpo;
}

const json = (metodo, corpo) => ({
  method: metodo, headers: { 'content-type': 'application/json' },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});

export const api = {
  get: (c) => pedir(c),
  post: (c, corpo = {}) => pedir(c, json('POST', corpo)),
  patch: (c, corpo) => pedir(c, json('PATCH', corpo)),
  del: (c) => pedir(c, { method: 'DELETE' }),
  /** multipart: o navegador define a fronteira; declarar `content-type` quebra o parse. */
  enviar: (c, form) => pedir(c, { method: 'POST', body: form }),
};
