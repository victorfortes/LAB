/** Tipos do módulo GERADO por scripts/motor-gerador.ts (o motor original do Gerador de Relatórios). */
export const ORIGEM_SHA256: string;
export const PATCHES_LAB: string[];
export interface InstanciaMotor {
  /** `window` próprio da instância: os ganchos do motor (NGA_BASE_CASOS, NGA_ROTULOS_LAB) são lidos daqui. */
  window: Record<string, any>;
  calcularIndicadores(processos: unknown[], atividades: unknown[], inicio: Date, fim: Date, regras: unknown, administrativas?: unknown[], casos?: unknown[]): { indicadores: Record<string, any>; atividadesClassificadas: unknown[]; todasClassificadas: unknown[] };
  dataBR(valor: string | null | undefined): Date | null;
  valorBRL(valor: string | null | undefined): number;
  NUCLEO: any;
  QUALIDADE: any;
  GeradorRelatorioPDF: new () => { gerar(cliente: string, indicadores: Record<string, any>, atividades: unknown[]): { output(tipo: 'arraybuffer'): ArrayBuffer; getNumberOfPages(): number } };
  nomeCurto(nome: string, limite?: number): string;
  parseAstreaPDF(pdf: unknown): Promise<any>;
  auditarGeracao(pdf: unknown, extraido: unknown, calculo: unknown, inicio: Date, fim: Date, recalcular: () => unknown): Promise<any>;
}
export function criarMotor(): InstanciaMotor;
