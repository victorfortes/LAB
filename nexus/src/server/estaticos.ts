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

// ------------------------------------------------------------ Gerador de Relatórios ---

/**
 * O Gerador de Relatórios (pasta `relatorios/` do monorepo) é uma aplicação estática com login próprio
 * (Supabase Auth). Servi-la POR AQUI, sob `/gerador/`, evita mais um processo e mais uma porta para manter, e
 * faz a ferramenta responder no mesmo endereço do NGA NEXUS (inclusive quando o acesso não for 127.0.0.1).
 *
 * NÃO abre dentro de um iframe do NGA NEXUS, e isso é desenho dela, não defeito daqui: o `shell.js` do gerador
 * expulsa a página do quadro (`window.top.location = window.self.location`) como defesa contra clickjacking
 * na tela de login. Por isso a tela de Ferramentas abre o gerador em nova aba.
 *
 * Os cabeçalhos de segurança são os do próprio `public/_headers` do gerador, lidos do arquivo — não copiados. */
import { join, normalize, sep } from 'node:path';
import { readFile } from 'node:fs/promises';

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

type Regras = Array<{ padrao: string; cabecalhos: Array<[string, string]> }>;
async function lerCabecalhos(arquivo: string): Promise<Regras> {
  let texto = '';
  try { texto = await readFile(arquivo, 'utf8'); } catch { return []; }
  const regras: Regras = [];
  for (const linha of texto.split('\n')) {
    if (!linha.trim()) continue;
    if (!/^\s/.test(linha)) { regras.push({ padrao: linha.trim(), cabecalhos: [] }); continue; }
    const i = linha.indexOf(':'); const atual = regras[regras.length - 1];
    if (i > 0 && atual) atual.cabecalhos.push([linha.slice(0, i).trim(), linha.slice(i + 1).trim()]);
  }
  return regras;
}
const casa = (padrao: string, caminho: string) => (padrao.endsWith('/*') ? caminho.startsWith(padrao.slice(0, -1)) : padrao === caminho);

export function servidorDoGerador(raizDoRepo: string, https = false) {
  const pasta = join(raizDoRepo, 'public');
  const regrasP = lerCabecalhos(join(pasta, '_headers'));
  return async function servir(req: Request, url: URL): Promise<Response | null> {
    if (url.pathname === '/gerador') return Response.redirect(`${url.origin}/gerador/`, 308);
    if (!url.pathname.startsWith('/gerador/')) return null;
    let relativo = decodeURIComponent(url.pathname);
    if (relativo.endsWith('/')) relativo += 'index.html';
    const destino = normalize(join(pasta, relativo));
    // Dentro de public/gerador, não de public/: `/gerador/..%2f_headers` decodifica para um irmão da pasta.
    if (!destino.startsWith(join(pasta, 'gerador') + sep)) return new Response('não encontrado', { status: 404 });
    const arquivo = Bun.file(destino);
    if (!(await arquivo.exists())) return new Response('não encontrado', { status: 404 });
    const base = await servirEstatico(arquivo, TIPOS[destino.slice(destino.lastIndexOf('.'))] ?? 'application/octet-stream', req);
    const h = new Headers(base.headers);
    for (const r of await regrasP) {
      if (!casa(r.padrao, url.pathname)) continue;
      for (const [k, v] of r.cabecalhos) {
        if (!https && k.toLowerCase() === 'strict-transport-security') continue;   // HSTS só vale em HTTPS
        h.set(k, v);
      }
    }
    return new Response(base.body, { status: base.status, headers: h });
  };
}
