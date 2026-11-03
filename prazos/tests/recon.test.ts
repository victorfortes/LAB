import { describe, expect, test } from 'bun:test';
import { guardRequest, normalizePath, sanitizeText } from '../src/astrea/recon.ts';
import { NotMappedError } from '../src/astrea/port.ts';
import { loadSelectors, requireSelector } from '../src/astrea/selectors.ts';

describe('recon (somente leitura)', () => {
  test('bloqueia POST/PUT/PATCH/DELETE; permite GET; allowlist explícita', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(guardRequest(m, 'https://h.example/api/x').block).toBe(true);
    expect(guardRequest('GET', 'https://h.example/api/x').block).toBe(false);
    expect(guardRequest('POST', 'https://h.example/api/search', [/\/api\/search$/]).block).toBe(false);
  });
  test('normaliza caminho: sem query, ids trocados', () => {
    expect(normalizePath('https://h.example/publicacoes/12345/x?token=abc#y')).toBe('h.example/publicacoes/:id/x');
  });
  test('mantém a rota por hash de SPA, sem query', () => {
    expect(normalizePath('https://h.example/#/main/publicacoes/123/x?token=abc')).toBe('h.example/#/main/publicacoes/:id/x');
  });
  test('texto capturado é mascarado e truncado', () => {
    expect(sanitizeText('João 123.456.789-09 ' + 'a'.repeat(200))).not.toContain('123.456.789-09');
    expect(sanitizeText('a'.repeat(200)).length).toBe(60);
  });
  test('selectors.json: só leitura confirmada (com evidência); nenhum seletor de escrita', () => {
    const map = loadSelectors('config/selectors.json');
    expect(Object.keys(map.read).length).toBeGreaterThan(0);
    for (const e of Object.values(map.read)) { expect(e.evidence.length).toBeGreaterThan(10); expect(e.confirmedAt).toBeTruthy(); }
    // Salvar do formulário 'Adicionar prazo' foi liberado na Etapa 1 (autorizada); EDIÇÃO segue sem seletor de envio
    expect(Object.keys(map.write).some((k) => /edit/i.test(k) && /submit|save|salvar/i.test(k))).toBe(false);
    expect(() => requireSelector(map, 'write', 'editScheduleSubmit')).toThrow(NotMappedError);
  });
});
