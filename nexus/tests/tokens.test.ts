import { describe, expect, test } from 'bun:test';
import { CORES, FONTES, SERIES, corDoEstado } from '../ui/tokens/index.ts';

const css = await Bun.file(new URL('../ui/tokens/nga.css', import.meta.url)).text();

describe('design system', () => {
  test('cada cor do TS existe com o mesmo valor no CSS', () => {
    const mapa: Record<keyof typeof CORES, string> = {
      bg: '--nga-bg', bgElev: '--nga-bg-elev', ink: '--nga-ink', mut: '--nga-mut',
      faint: '--nga-faint', amber: '--nga-amber', amberSoft: '--nga-amber-soft',
      cy: '--nga-cy', green: '--nga-green', red: '--nga-red',
    };
    for (const [chave, variavel] of Object.entries(mapa) as [keyof typeof CORES, string][]) {
      const m = new RegExp(`${variavel}\\s*:\\s*([^;]+);`).exec(css);
      expect(m, `${variavel} ausente no CSS`).not.toBeNull();
      expect(m![1]!.trim().toUpperCase()).toBe(CORES[chave].toUpperCase());
    }
  });

  test('as fontes do NGA Nexus estão preservadas', () => {
    expect(FONTES.sans).toContain('Barlow');
    expect(FONTES.cond).toContain('Barlow Condensed');
    expect(FONTES.mono).toContain('JetBrains Mono');
    expect(css).toContain('Barlow');
    expect(css).toContain('JetBrains Mono');
  });

  test('o fundo é o azul quase preto do NGA Nexus, não um cinza qualquer', () => {
    expect(CORES.bg).toBe('#03050A');
  });

  test('a paleta de séries não repete cor', () => {
    expect(new Set(SERIES).size).toBe(SERIES.length);
  });

  test('corDoEstado cobre todos os estados', () => {
    for (const e of ['ok', 'alerta', 'risco', 'info', 'neutro'] as const) {
      expect(corDoEstado(e)).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  test('conteúdo de IA tem marcação visual obrigatória', () => {
    expect(css).toContain('.nga-ia');
    expect(css).toContain('PENDENTE DE REVISÃO');
  });

  test('respeita prefers-reduced-motion', () => {
    expect(css).toContain('prefers-reduced-motion');
  });
});
