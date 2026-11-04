/**
 * Processo do servidor.
 *
 * Serve a API e os arquivos estáticos da interface. Sem build: os módulos da
 * web são JavaScript que o navegador carrega direto, e o CSS é o design system
 * compartilhado em `ui/tokens/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Banco } from '../store/conexao.ts';
import { servidorDoGerador, servirEstatico } from './estaticos.ts';
import { criarApp } from './app.ts';
import { sincronizarAgendado } from './controladoria.ts';
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
  // NGA_PG_CA = caminho do certificado raiz do provedor (Supabase: prod-ca-2021.crt). Com ele a conexão é
  // cifrada E o servidor é autenticado; não há modo "cifrar sem verificar".
  ...(process.env.NGA_PG_CA ? { ssl: { ca: readFileSync(process.env.NGA_PG_CA, 'utf8'), rejectUnauthorized: true as const } } : {}),
});

// O acervo fica FORA de web/: se fosse alcançável pelo servidor de estáticos,
// a URL assinada não protegeria nada (§12.4).
const armazenamento = new ArmazenamentoLocal(
  process.env.NGA_ACERVO ?? join(RAIZ, 'acervo'));
await armazenamento.iniciar();

const api = criarApp({ banco, deposito: montarDeposito(armazenamento), analiseAutomatica: true });
const porta = Number(process.env.NGA_PORTA ?? 8790);

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Gerador de Relatórios (monorepo: ../relatorios), servido sob /gerador/ para abrir dentro do NGA LAB.
const gerador = servidorDoGerador(join(RAIZ, '../relatorios'));

// Controladoria: busca as publicações do DJEN das OABs cadastradas a cada hora (primeira rodada 3 min depois de
// subir). NGA_DJEN_AUTO=0 desliga. Sem OAB cadastrada, a rodada não faz nada. Nunca derruba o servidor.
if (process.env.NGA_DJEN_AUTO !== '0') {
  const rodar = () => sincronizarAgendado(banco).then((r) => { if (r.length) console.log(`controladoria: ${r.length} OAB(s) consultada(s), ${r.reduce((t, x) => t + x.novas, 0)} publicação(ões) nova(s)`); });
  setTimeout(rodar, 3 * 60_000); setInterval(rodar, 60 * 60_000);
}

const servidor = Bun.serve({
  port: porta,
  hostname: process.env.NGA_HOST ?? '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    const doGerador = await gerador(req, url); if (doGerador) return doGerador;

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
      return servirEstatico(arquivo, TIPOS[pedido.slice(pedido.lastIndexOf('.'))] ?? 'application/octet-stream', req);
    }

    // SPA: qualquer rota desconhecida devolve a aplicação.
    return new Response(Bun.file(join(RAIZ, 'web/index.html')), {
      headers: { 'content-type': TIPOS['.html']! },
    });
  },
});

console.log(`NGA LAB em http://${servidor.hostname}:${servidor.port}`);

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    await servidor.stop();
    await banco.encerrar();
    process.exit(0);
  });
}
