import { describe, expect, test } from 'bun:test';
import { PERMISSOES, type Papel, SemPermissao, exigir, podeComPapeis } from '../src/security/rbac.ts';

describe('RBAC', () => {
  test('só quem pode validar crédito valida', () => {
    const podem: Papel[] = ['socio_administrador', 'socio', 'advogado'];
    const naoPodem: Papel[] = ['estagiario', 'controladoria', 'financeiro', 'administrativo',
      'cliente_administrador', 'cliente_usuario', 'parceiro_externo'];
    for (const p of podem) expect(podeComPapeis([p], 'credito.validar')).toBe(true);
    for (const p of naoPodem) expect(podeComPapeis([p], 'credito.validar')).toBe(false);
  });

  test('o caixa da recuperanda e as finanças do escritório são permissões distintas', () => {
    // O advogado acompanha o caixa do cliente, mas não vê o faturamento da NGA.
    expect(podeComPapeis(['advogado'], 'financeiro_cliente.ler')).toBe(true);
    expect(podeComPapeis(['advogado'], 'financeiro.ler')).toBe(false);
    // O cliente lança no próprio caixa e nunca vê as finanças da NGA.
    expect(podeComPapeis(['cliente_administrador'], 'financeiro_cliente.escrever')).toBe(true);
    expect(podeComPapeis(['cliente_administrador'], 'financeiro.ler')).toBe(false);
    // O sócio vê as duas.
    expect(podeComPapeis(['socio'], 'financeiro.ler')).toBe(true);
    expect(podeComPapeis(['socio'], 'financeiro_cliente.ler')).toBe(true);
  });

  test('só o cliente escreve no próprio caixa', () => {
    for (const p of ['advogado', 'socio', 'socio_administrador', 'controladoria', 'estagiario'] as Papel[]) {
      expect(podeComPapeis([p], 'financeiro_cliente.escrever'), p).toBe(false);
    }
    expect(podeComPapeis(['cliente_administrador'], 'financeiro_cliente.escrever')).toBe(true);
  });

  test('nenhum papel de cliente publica no portal nem lê auditoria', () => {
    for (const p of ['cliente_administrador', 'cliente_usuario', 'parceiro_externo'] as Papel[]) {
      expect(podeComPapeis([p], 'portal.publicar')).toBe(false);
      expect(podeComPapeis([p], 'auditoria.ler')).toBe(false);
      expect(podeComPapeis([p], 'admin.gerir')).toBe(false);
    }
  });

  test('cliente não enxerga crédito nem AGC por RBAC', () => {
    // O isolamento por RLS já separa os dados; isto é a segunda camada.
    expect(podeComPapeis(['cliente_administrador'], 'credito.ler')).toBe(false);
    expect(podeComPapeis(['cliente_usuario'], 'agc.ler')).toBe(false);
  });

  test('parceiro externo só lê documento', () => {
    expect(PERMISSOES.parceiro_externo).toEqual(['documento.ler']);
  });

  test('papéis acumulam permissões', () => {
    expect(podeComPapeis(['estagiario', 'advogado'], 'credito.validar')).toBe(true);
    expect(podeComPapeis(['estagiario'], 'credito.validar')).toBe(false);
  });

  test('só o sócio administrador administra', () => {
    expect(podeComPapeis(['socio_administrador'], 'admin.gerir')).toBe(true);
    expect(podeComPapeis(['socio'], 'admin.gerir')).toBe(false);
  });

  test('exigir lança SemPermissao', () => {
    expect(() => exigir(['estagiario'], 'credito.validar')).toThrow(SemPermissao);
    expect(() => exigir(['advogado'], 'credito.validar')).not.toThrow();
  });

  test('sem papel nenhum, nada é permitido', () => {
    for (const permissao of Object.values(PERMISSOES).flat()) {
      expect(podeComPapeis([], permissao)).toBe(false);
    }
  });
});

describe('análise documental', () => {
  test('o estagiário roda a triagem mas não valida o tipo', () => {
    // Rodar a análise é trabalho; validar o que a máquina sugeriu é ato de
    // quem assina o parecer (§7.7).
    expect(podeComPapeis(['estagiario'], 'analise.executar')).toBe(true);
    expect(podeComPapeis(['estagiario'], 'analise.validar')).toBe(false);
    expect(podeComPapeis(['advogado'], 'analise.validar')).toBe(true);
  });

  test('cliente nunca roda nem valida análise', () => {
    for (const papel of ['cliente_administrador', 'cliente_usuario', 'parceiro_externo'] as const) {
      expect(podeComPapeis([papel], 'analise.executar')).toBe(false);
      expect(podeComPapeis([papel], 'analise.validar')).toBe(false);
    }
  });
});

describe('processos e prazos', () => {
  test('o estagiário cadastra processo, mas não fecha prazo', () => {
    // Marcar como cumprido o que não foi cumprido é o erro que faz o
    // escritório descobrir tarde demais.
    expect(podeComPapeis(['estagiario'], 'processo.escrever')).toBe(true);
    expect(podeComPapeis(['estagiario'], 'prazo.escrever')).toBe(false);
    expect(podeComPapeis(['estagiario'], 'prazo.ler')).toBe(true);
  });

  test('a controladoria é dona do prazo', () => {
    expect(podeComPapeis(['controladoria'], 'prazo.escrever')).toBe(true);
    expect(podeComPapeis(['advogado'], 'prazo.escrever')).toBe(true);
  });

  test('o cliente lê processo pelo portal e nunca alcança prazo', () => {
    for (const papel of ['cliente_administrador', 'cliente_usuario'] as const) {
      expect(podeComPapeis([papel], 'processo.ler')).toBe(true);
      expect(podeComPapeis([papel], 'processo.escrever')).toBe(false);
      expect(podeComPapeis([papel], 'prazo.ler')).toBe(false);
      expect(podeComPapeis([papel], 'prazo.escrever')).toBe(false);
    }
  });

  test('publicar movimentação usa a mesma permissão de publicar documento', () => {
    // Uma única porta de saída para o que chega ao cliente (§13).
    expect(podeComPapeis(['advogado'], 'portal.publicar')).toBe(true);
    expect(podeComPapeis(['estagiario'], 'portal.publicar')).toBe(false);
    expect(podeComPapeis(['controladoria'], 'portal.publicar')).toBe(false);
  });
});

describe('relatórios', () => {
  test('o cliente escreve documento, mas não emite relatório', () => {
    // A distinção existe porque o cliente TEM `documento.escrever`: é com ela
    // que envia pelo portal. Emitir relatório em papel timbrado da NGA, não.
    expect(podeComPapeis(['cliente_administrador'], 'documento.escrever')).toBe(true);
    expect(podeComPapeis(['cliente_administrador'], 'relatorio.gerar')).toBe(false);
    expect(podeComPapeis(['cliente_usuario'], 'relatorio.gerar')).toBe(false);
    expect(podeComPapeis(['parceiro_externo'], 'relatorio.gerar')).toBe(false);
  });

  test('a equipe interna emite; publicar continua sendo outra permissão', () => {
    expect(podeComPapeis(['coordenacao'], 'relatorio.gerar')).toBe(true);
    expect(podeComPapeis(['estagiario'], 'relatorio.gerar')).toBe(true);
    expect(podeComPapeis(['estagiario'], 'portal.publicar')).toBe(false);
  });
});
