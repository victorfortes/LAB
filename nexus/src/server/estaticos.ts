/**
 * Entrega de arquivos estáticos do front.
 *
 * Duas coisas fazem a navegação parecer instantânea: revalidar com ETag (a
 * segunda visita vira um 304 sem corpo) e comprimir JS/CSS/HTML uma vez só,
 * guardando o resultado em memória até o arquivo mudar. O cache é `no-cache`
 * (revalida sempre) e não `max-age`: uma versão nova do sistema aparece no
 * próximo carregamento, sem ninguém precisar limpar o navegador.
 */
const COMPRIMIVEIS = /^(text\/|image\/svg)/;
const comprimidos = new Map<string, { chave: string; corpo: Uint8Array }>();

export async function servirEstatico(
  arquivo: ReturnType<typeof Bun.file>, tipo: string, req: Request,
): Promise<Response> {
  const tamanho = arquivo.size; const mtime = arquivo.lastModified;
  const etag = `W/"${tamanho.toString(36)}-${Math.floor(mtime).toString(36)}"`;
  const imagem = tipo.startsWith('image/');
  const base: Record<string, string> = {
    'content-type': tipo, 'x-content-type-options': 'nosniff', etag,
    'cache-control': imagem ? 'public, max-age=3600' : 'no-cache', vary: 'accept-encoding',
  };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: base });

  if (COMPRIMIVEIS.test(tipo) && tamanho > 1024 && (req.headers.get('accept-encoding') ?? '').includes('gzip')) {
    const caminho = arquivo.name ?? '';
    let c = comprimidos.get(caminho);
    if (!c || c.chave !== etag) {
      c = { chave: etag, corpo: Bun.gzipSync(new Uint8Array(await arquivo.arrayBuffer())) };
      comprimidos.set(caminho, c);
    }
    return new Response(c.corpo as unknown as BodyInit, { headers: { ...base, 'content-encoding': 'gzip', 'content-length': String(c.corpo.length) } });
  }
  return new Response(arquivo, { headers: base });
}
