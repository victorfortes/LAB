/**
 * Os mesmos tokens de `nga.css`, para quem precisa deles em TypeScript:
 * gráficos, geração de PDF e qualquer render fora do CSS.
 *
 * Mantidos em sincronia manual com `nga.css` — `tests/tokens.test.ts` falha
 * se um dos dois sair de linha.
 */
export const CORES = Object.freeze({
  bg: '#03050A',
  bgElev: '#060A12',
  ink: '#EAF1F8',
  mut: '#8DA0B5',
  faint: '#5D6E82',
  amber: '#F0A32E',
  amberSoft: '#FFD08A',
  cy: '#4CC9F0',
  green: '#2EE6A0',
  red: '#FF6B6B',
});

export const FONTES = Object.freeze({
  sans: '"Barlow", "Segoe UI", system-ui, sans-serif',
  cond: '"Barlow Condensed", "Arial Narrow", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
});

/** Paleta para séries de gráfico, em ordem de uso. */
export const SERIES = Object.freeze([
  CORES.amber, CORES.cy, CORES.green, CORES.amberSoft, CORES.red, CORES.mut,
]);

/** Cor de estado, usada por indicadores e selos. */
export function corDoEstado(estado: 'ok' | 'alerta' | 'risco' | 'info' | 'neutro'): string {
  switch (estado) {
    case 'ok': return CORES.green;
    case 'alerta': return CORES.amber;
    case 'risco': return CORES.red;
    case 'info': return CORES.cy;
    case 'neutro': return CORES.mut;
  }
}
