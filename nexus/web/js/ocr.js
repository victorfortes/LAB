/**
 * OCR no navegador (Tesseract.js, modelo de português), para PDF digitalizado ou com texto embaralhado:
 * matrícula de imóvel, contrato social escaneado, extrato impresso. Roda na máquina de quem gera o diagnóstico,
 * sem limite de tempo da nuvem; o servidor recebe só as linhas, como num PDF com texto.
 */
let trabalhadores;
const comPrazo = (p, ms) => Promise.race([p, new Promise((_, falha) => setTimeout(() => falha(new Error('tempo esgotado')), ms))]);
const PASTA = '/js/vendor/ocr';

/** Mesma regra do servidor (leitores.ts#textoIlegivel): pouco texto ou letras soltas sem palavras. */
export function precisaOcr(paginas) {
  const t = paginas.flat().join(' ');
  if (t.replace(/\s/g, '').length < 40 * Math.max(1, paginas.length)) return true;
  const tokens = t.split(/\s+/).filter(Boolean); const soltos = tokens.filter((x) => x.length === 1).length;
  const palavras = (t.match(/\b[a-záéíóúâêôãõç]{4,}\b/gi) ?? []).length;
  return tokens.length > 80 && (soltos / tokens.length > 0.45 || palavras / tokens.length < 0.08);
}

/** Dois motores em paralelo (uma página cada), o que corta pela metade o tempo de um documento longo. */
async function motores() {
  trabalhadores ??= (async () => {
    const mod = await import('./vendor/ocr/tesseract.js?v=2311'); const { createWorker } = mod.default ?? mod;
    // workerBlobURL: false — o worker vem do próprio site (a política de segurança não aceita blob:).
    const novo = () => createWorker('por', 1, { workerPath: `${PASTA}/worker.min.js`, corePath: `${PASTA}/core`, langPath: `${PASTA}/lang`, workerBlobURL: false });
    return Promise.all([novo(), novo()]);
  })().catch((e) => { trabalhadores = undefined; throw e; });
  return trabalhadores;
}

/** Linhas por página de um PDF digitalizado. `maxPaginas` evita travar o navegador com laudos de centenas de páginas. */
export async function ocrDoPdf(bytes, { maxPaginas = 12, aoProgredir } = {}) {
  const { abrirParaImagem } = await import('./vendor/pdf/pdf-linhas.js?v=2311');
  const doc = await abrirParaImagem(bytes); const ws = await motores();
  const total = Math.min(doc.paginas, maxPaginas); const paginas = new Array(total).fill(null).map(() => []); let feitas = 0; let proxima = 1; let puladas = 0; const inicio = Date.now();
  try {
    await Promise.all(ws.map(async (w) => {
      while (proxima <= total) {
        const p = proxima++;
        // Página que não termina em 60 s (imagem gigante, PDF corrompido) é pulada: não prende o diagnóstico.
        try {
          const canvas = await comPrazo(doc.desenhar(p, 1.5), 60_000);
          const { data } = await comPrazo(w.recognize(canvas), 60_000);
          paginas[p - 1] = String(data.text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
          canvas.width = canvas.height = 0;
        } catch { paginas[p - 1] = []; puladas++; }
        aoProgredir?.(++feitas, total);
        if (Date.now() - inicio > 6 * 60_000) proxima = total + 1; // teto por documento
      }
    }));
  } finally {
    await comPrazo(doc.fechar(), 10_000).catch(() => {});
    // Motor que estourou o prazo pode ter ficado preso: descarta e cria outro no próximo documento.
    if (puladas) { for (const w of ws) w.terminate?.().catch?.(() => {}); trabalhadores = undefined; }
  }
  return { paginas, truncado: doc.paginas > total || puladas > 0, totalPaginas: doc.paginas, puladas };
}
