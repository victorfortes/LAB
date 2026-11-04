import { describe, expect, test, beforeAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { servidorDoGerador } from '../src/server/estaticos.ts';

let servir: ReturnType<typeof servidorDoGerador>;
const pedir = (caminho: string, h: Record<string, string> = {}) => {
  const url = new URL(`http://x${caminho}`);
  return servir(new Request(url, { headers: h }), url);
};

beforeAll(async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'gerador-'));
  await mkdir(join(raiz, 'public/gerador/app'), { recursive: true });
  await writeFile(join(raiz, 'public/gerador/index.html'), '<title>Gerador</title>' + 'x'.repeat(3000));
  await writeFile(join(raiz, 'public/gerador/config.js'), 'window.C={}');
  await writeFile(join(raiz, 'public/segredo.txt'), 'fora de /gerador');
  await writeFile(join(raiz, 'public/_headers'),
    '/gerador/*\n  X-Frame-Options: SAMEORIGIN\n  Strict-Transport-Security: max-age=1\n  Content-Security-Policy: frame-ancestors \'self\'\n/gerador/config.js\n  Cache-Control: no-store\n');
  servir = servidorDoGerador(raiz);
});

describe('Gerador de Relatórios servido sob /gerador/', () => {
  test('o que não é /gerador passa adiante (devolve null)', async () => {
    expect(await pedir('/api/eu')).toBeNull();
    expect(await pedir('/geradorx/')).toBeNull();
  });

  test('/gerador redireciona para /gerador/ e a raiz serve o index', async () => {
    expect((await pedir('/gerador'))!.status).toBe(308);
    const r = (await pedir('/gerador/'))!;
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>Gerador</title>');
  });

  test('aplica os cabeçalhos do _headers do próprio gerador, e o específico vence o geral', async () => {
    const i = (await pedir('/gerador/'))!;
    expect(i.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(i.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect((await pedir('/gerador/config.js'))!.headers.get('cache-control')).toBe('no-store');
  });

  test('HSTS só em HTTPS (em http://127.0.0.1 ele não tem efeito e só confunde)', async () => {
    expect((await pedir('/gerador/'))!.headers.get('strict-transport-security')).toBeNull();
  });

  test('comprime e responde 304 na revalidação', async () => {
    const r = (await pedir('/gerador/', { 'accept-encoding': 'gzip' }))!;
    expect(r.headers.get('content-encoding')).toBe('gzip');
    const etag = r.headers.get('etag')!;
    expect((await pedir('/gerador/', { 'if-none-match': etag }))!.status).toBe(304);
  });

  test('não sai da pasta: ../ e arquivo fora de /gerador não são servidos', async () => {
    expect((await pedir('/gerador/..%2F..%2Fsegredo.txt'))!.status).toBe(404);
    expect((await pedir('/gerador/..%2fsegredo.txt'))!.status).toBe(404);   // irmão da pasta, dentro de public/
    expect((await pedir('/gerador/..%2f_headers'))!.status).toBe(404);
    expect(await pedir('/gerador/%2e%2e/segredo.txt')).toBeNull();           // a URL normaliza e sai de /gerador
    expect((await pedir('/gerador/nao-existe.js'))!.status).toBe(404);
  });
});
