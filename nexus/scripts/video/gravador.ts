// Servidor local só para gravar o vídeo de boas-vindas: serve a página e recebe o WebM gravado.
const DIR = import.meta.dir;
const DESTINO = `${DIR}/../../web/video/boas-vindas.webm`;
Bun.serve({ port: 8831, async fetch(req) {
  const u = new URL(req.url);
  if (req.method === 'POST' && u.pathname === '/salvar') { const b = new Uint8Array(await req.arrayBuffer()); await Bun.write(DESTINO, b); return new Response(`ok ${b.byteLength}`); }
  if (u.pathname === '/logo.png') return new Response(Bun.file(`${DIR}/../../web/img/nga-adv.png`));
  // Áudios da narração ficam na pasta indicada em NGA_AUDIO (gerados por narrar.sh), fora do repositório.
  if (/^\/seg\d+\.m4a$/.test(u.pathname)) return new Response(Bun.file(`${process.env.NGA_AUDIO ?? DIR}${u.pathname}`));
  const f = Bun.file(`${DIR}${u.pathname === '/' ? '/gravador.html' : u.pathname}`);
  return (await f.exists()) ? new Response(f) : new Response('não encontrado', { status: 404 });
} });
console.log('gravador em http://localhost:8831');
