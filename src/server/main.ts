/**
 * Processo do servidor.
 *
 * Serve a API e os arquivos estáticos da interface. Sem build: os módulos da
 * web são JavaScript que o navegador carrega direto, e o CSS é o design system
 * compartilhado em `ui/tokens/`.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Banco } from '../store/conexao.ts';
import { criarApp } from './app.ts';
import { ArmazenamentoLocal } from '../store/arquivos.ts';
import { deposito as montarDeposito } from './arquivos.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

function exigirEnv(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`\n  Falta a variável ${nome}.\n`);
    process.exit(1);
  }
  return valor;
}

const banco = new Banco({
  host: process.env.NGA_PG_HOST ?? 'localhost',
  port: Number(process.env.NGA_PG_PORT ?? 5432),
  user: process.env.NGA_PG_USER ?? 'nga_app',
  password: exigirEnv('NGA_PG_PASSWORD'),
  database: process.env.NGA_PG_DATABASE ?? 'nga_nexus',
});

// O acervo fica FORA de web/: se fosse alcançável pelo servidor de estáticos,
// a URL assinada não protegeria nada (§12.4).
const armazenamento = new ArmazenamentoLocal(
  process.env.NGA_ACERVO ?? join(RAIZ, 'acervo'));
await armazenamento.iniciar();

const api = criarApp({ banco, deposito: montarDeposito(armazenamento) });
const porta = Number(process.env.NGA_PORTA ?? 8790);

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const servidor = Bun.serve({
  port: porta,
  hostname: process.env.NGA_HOST ?? '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);

    // O download vive fora de /api/ porque o link é usado como URL comum, em
    // nova aba e sem cookie; quem autentica ali é o token assinado.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/arquivos/')) {
      const resposta = await api(req);
      // Cabeçalhos de segurança em toda resposta da API.
      resposta.headers.set('x-content-type-options', 'nosniff');
      resposta.headers.set('referrer-policy', 'no-referrer');
      return resposta;
    }

    // O design system vive fora de web/ para ser compartilhado com os demais
    // módulos; aqui ele é exposto num caminho estável.
    if (url.pathname === '/nga.css') {
      return new Response(Bun.file(join(RAIZ, 'ui/tokens/nga.css')), {
        headers: { 'content-type': TIPOS['.css']! },
      });
    }

    // Caminho normalizado: nada de ../ para fora de web/.
    const pedido = url.pathname === '/' ? '/index.html' : url.pathname;
    const destino = join(RAIZ, 'web', pedido);
    if (!destino.startsWith(join(RAIZ, 'web'))) {
      return new Response('não encontrado', { status: 404 });
    }

    const arquivo = Bun.file(destino);
    if (await arquivo.exists()) {
      const ext = pedido.slice(pedido.lastIndexOf('.'));
      return new Response(arquivo, {
        headers: {
          'content-type': TIPOS[ext] ?? 'application/octet-stream',
          'x-content-type-options': 'nosniff',
        },
      });
    }

    // SPA: qualquer rota desconhecida devolve a aplicação.
    return new Response(Bun.file(join(RAIZ, 'web/index.html')), {
      headers: { 'content-type': TIPOS['.html']! },
    });
  },
});

console.log(`NGA Nexus em http://${servidor.hostname}:${servidor.port}`);

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    await servidor.stop();
    await banco.encerrar();
    process.exit(0);
  });
}
