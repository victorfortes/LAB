// Entrada do bundle de navegador (web/js/vendor/pdf/): extrai as linhas de texto de um PDF com o mesmo
// algoritmo de src/server/qgc.ts#linhasDoPdf, para o navegador fazer o trabalho pesado em vez da função na nuvem.
import { getDocumentProxy } from 'unpdf';
export async function linhasDoPdf(bytes: Uint8Array, aoProgredir?: (pagina: number, total: number) => void): Promise<string[][]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const paginas: string[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const conteudo = await (await pdf.getPage(p)).getTextContent();
    const porY = new Map<number, { x: number; s: string }[]>();
    for (const it of conteudo.items as { str?: string; transform?: number[] }[]) {
      if (!it.str?.trim() || !it.transform) continue;
      const y = Math.round(it.transform[5]! / 2) * 2;
      porY.set(y, [...(porY.get(y) ?? []), { x: it.transform[4]!, s: it.str }]);
    }
    paginas.push([...porY.entries()].sort((a, b) => b[0] - a[0]).map(([, xs]) => xs.sort((a, b) => a.x - b.x).map((x) => x.s).join(' ')));
    aoProgredir?.(p, pdf.numPages);
  }
  await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  return paginas;
}
