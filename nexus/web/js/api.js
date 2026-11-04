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

// ------------------------------------------------------------------ cache ---
// Navegar entre telas repete as mesmas leituras (lista de projetos, tarefas,
// painel). Guardar a resposta por alguns segundos e juntar pedidos idênticos em
// andamento corta a espera sem mostrar dado velho: QUALQUER escrita limpa tudo,
// e o que é "ao vivo" (atividade, diagnóstico) nunca passa pelo cache.
const TTL_MS = 12_000;
const SEM_CACHE = /\/api\/(atividade|sessao|eu|ferramentas)\b|\/diagnostico\b|\/mensagens\b|\/financeiro\b/;
const guardadas = new Map(); const emAndamento = new Map();
const limpar = () => { guardadas.clear(); emAndamento.clear(); };

function lerComCache(caminho) {
  if (SEM_CACHE.test(caminho)) return pedir(caminho);
  const g = guardadas.get(caminho);
  if (g && Date.now() - g.em < TTL_MS) return Promise.resolve(structuredClone(g.valor));
  let p = emAndamento.get(caminho);
  if (!p) {
    p = pedir(caminho).then((v) => { guardadas.set(caminho, { valor: v, em: Date.now() }); return v; }).finally(() => emAndamento.delete(caminho));
    emAndamento.set(caminho, p);
  }
  // Cada chamador recebe a sua cópia: as telas mexem nos objetos (reverse, contadores).
  return p.then((v) => structuredClone(v));
}
const escrever = (fn) => async (...a) => { try { return await fn(...a); } finally { limpar(); } };

export const api = {
  get: lerComCache,
  /** Pré-aquece uma leitura sem esperar nem falhar alto: usado ao passar o mouse num link. */
  aquecer: (c) => { lerComCache(c).catch(() => {}); },
  post: escrever((c, corpo = {}) => pedir(c, json('POST', corpo))),
  patch: escrever((c, corpo) => pedir(c, json('PATCH', corpo))),
  del: escrever((c) => pedir(c, { method: 'DELETE' })),
  /** multipart: o navegador define a fronteira; declarar `content-type` quebra o parse. */
  enviar: escrever((c, form) => pedir(c, { method: 'POST', body: form })),
  limparCache: limpar,
};
