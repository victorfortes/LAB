/**
 * OCR no navegador (Tesseract.js, modelo de português), para PDF digitalizado ou com texto embaralhado:
 * matrícula de imóvel, contrato social escaneado, extrato impresso. Roda na máquina de quem gera o diagnóstico,
 * sem limite de tempo da nuvem; o servidor recebe só as linhas, como num PDF com texto.
 */
let trabalhadores;
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
    const mod = await import('./vendor/ocr/tesseract.js'); const { createWorker } = mod.default ?? mod;
    // workerBlobURL: false — o worker vem do próprio site (a política de segurança não aceita blob:).
    const novo = () => createWorker('por', 1, { workerPath: `${PASTA}/worker.min.js`, corePath: `${PASTA}/core`, langPath: `${PASTA}/lang`, workerBlobURL: false });
    return Promise.all([novo(), novo()]);
  })().catch((e) => { trabalhadores = undefined; throw e; });
  return trabalhadores;
}

/** Linhas por página de um PDF digitalizado. `maxPaginas` evita travar o navegador com laudos de centenas de páginas. */
export async function ocrDoPdf(bytes, { maxPaginas = 30, aoProgredir } = {}) {
  const { abrirParaImagem } = await import('./vendor/pdf/pdf-linhas.js');
  const doc = await abrirParaImagem(bytes); const ws = await motores();
  const total = Math.min(doc.paginas, maxPaginas); const paginas = new Array(total); let feitas = 0; let proxima = 1;
  try {
    await Promise.all(ws.map(async (w) => {
      while (proxima <= total) {
        const p = proxima++;
        const canvas = await doc.desenhar(p, 1.7);
        const { data } = await w.recognize(canvas);
        paginas[p - 1] = String(data.text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
        canvas.width = canvas.height = 0; aoProgredir?.(++feitas, total);
      }
    }));
  } finally { await doc.fechar(); }
  return { paginas, truncado: doc.paginas > total, totalPaginas: doc.paginas };
}
