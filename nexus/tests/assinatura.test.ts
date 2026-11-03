import { describe, expect, test } from 'bun:test';
import {
  AssinaturaExpirada, AssinaturaInvalida, VALIDADE_PADRAO_SEGUNDOS,
  assinar, segredoDeArquivos, verificar,
} from '../src/security/assinatura.ts';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const OUTRO = 'outro-segredo-de-teste-com-mais-de-32-caracteres';
const DOC = '11111111-1111-1111-1111-111111111111';
const USR = '22222222-2222-2222-2222-222222222222';
const INTRUSO = '33333333-3333-3333-3333-333333333333';

describe('assinatura', () => {
  test('vai e volta com o mesmo conteúdo', () => {
    const c = verificar(assinar({ documentoId: DOC, usuarioId: USR }, SEGREDO), SEGREDO);
    expect(c.documentoId).toBe(DOC);
    expect(c.usuarioId).toBe(USR);
    expect(c.expiraEm).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('o link é emitido PARA um usuário, e isso está dentro da assinatura', () => {
    // Sem o usuário na concessão, o link serviria a qualquer um — que é a URL
    // pública permanente de volta, só que com prazo.
    const token = assinar({ documentoId: DOC, usuarioId: USR }, SEGREDO);
    expect(token).toContain(USR);
    const trocado = token.replace(USR, INTRUSO);
    expect(() => verificar(trocado, SEGREDO)).toThrow(AssinaturaInvalida);
  });

  test('trocar o documento invalida', () => {
    const token = assinar({ documentoId: DOC, usuarioId: USR }, SEGREDO);
    const outroDoc = '44444444-4444-4444-4444-444444444444';
    expect(() => verificar(token.replace(DOC, outroDoc), SEGREDO)).toThrow(AssinaturaInvalida);
  });

  test('esticar o prazo invalida', () => {
    const token = assinar({ documentoId: DOC, usuarioId: USR }, SEGREDO);
    const partes = token.split('.');
    partes[3] = String(Number(partes[3]) + 86_400);
    expect(() => verificar(partes.join('.'), SEGREDO)).toThrow(AssinaturaInvalida);
  });

  test('outro segredo não valida', () => {
    const token = assinar({ documentoId: DOC, usuarioId: USR }, SEGREDO);
    expect(() => verificar(token, OUTRO)).toThrow(AssinaturaInvalida);
  });

  test('token deformado não quebra o servidor', () => {
    for (const t of ['', 'abc', 'v1.x.y.z', 'v2.' + DOC + '.' + USR + '.999.sig',
      `v1.${DOC}.${USR}.naoNumero.sig`, `v1.nao-uuid.${USR}.999.sig`,
      `v1.${DOC}.${USR}.999.sig.extra`]) {
      expect(() => verificar(t, SEGREDO)).toThrow(AssinaturaInvalida);
    }
  });
});

describe('prazo', () => {
  test('vale dentro da janela e morre depois', () => {
    const token = assinar({ documentoId: DOC, usuarioId: USR }, SEGREDO, 60);
    expect(verificar(token, SEGREDO, Date.now() + 59_000).usuarioId).toBe(USR);
    expect(() => verificar(token, SEGREDO, Date.now() + 61_000)).toThrow(AssinaturaExpirada);
  });

  test('o padrão é curto: tempo de clicar, não de guardar e repassar', () => {
    expect(VALIDADE_PADRAO_SEGUNDOS).toBeLessThanOrEqual(300);
  });

  test('validade absurda é recusada na emissão', () => {
    expect(() => assinar({ documentoId: DOC, usuarioId: USR }, SEGREDO, 0)).toThrow(AssinaturaInvalida);
    expect(() => assinar({ documentoId: DOC, usuarioId: USR }, SEGREDO, 86_400)).toThrow(AssinaturaInvalida);
  });

  test('token forjado responde "inválido", nunca "expirado"', () => {
    // Dizer "expirou" a um token forjado confirmaria ao atacante que o resto
    // do token está certo e só falta a data.
    const antigo = assinar({ documentoId: DOC, usuarioId: USR }, SEGREDO, 1);
    const forjado = `${antigo.split('.').slice(0, 4).join('.')}.assinaturaInventada`;
    expect(() => verificar(forjado, SEGREDO, Date.now() + 10_000)).toThrow(AssinaturaInvalida);
  });
});

describe('segredo do ambiente', () => {
  test('usa a variável quando ela é longa o bastante', () => {
    const s = segredoDeArquivos({ NGA_SEGREDO_ARQUIVOS: SEGREDO });
    expect(s.valor).toBe(SEGREDO);
    expect(s.efemero).toBe(false);
    expect(s.aviso).toBeNull();
  });

  test('sem a variável, sorteia e DECLARA que sorteou', () => {
    const s = segredoDeArquivos({});
    expect(s.efemero).toBe(true);
    expect(s.aviso).toContain('a cada reinício');
    expect(s.valor.length).toBeGreaterThanOrEqual(32);
    expect(segredoDeArquivos({}).valor).not.toBe(s.valor);
  });

  test('segredo curto é ignorado, não aceito em silêncio', () => {
    const s = segredoDeArquivos({ NGA_SEGREDO_ARQUIVOS: 'curto' });
    expect(s.efemero).toBe(true);
    expect(s.aviso).toContain('menos de 32 caracteres');
    expect(s.valor).not.toBe('curto');
  });
});
