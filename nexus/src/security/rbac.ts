/**
 * Permissões por papel (§13 do briefing).
 *
 * O RBAC decide O QUE o usuário pode fazer; o RLS decide SOBRE QUAIS LINHAS.
 * São camadas distintas e ambas obrigatórias: o RBAC sozinho não impede um
 * advogado da NGA de ler dados do cliente errado, e o RLS sozinho não impede
 * um estagiário de validar classe de crédito.
 */
export type Papel =
  | 'socio_administrador' | 'socio' | 'advogado' | 'controladoria'
  | 'financeiro' | 'administrativo' | 'estagiario'
  | 'cliente_administrador' | 'cliente_usuario' | 'parceiro_externo'
  /** Usuário de serviço das aplicações do NGA Lab. Ver `integracoes`. */
  | 'integracao';

export type Permissao =
  | 'cliente.ler' | 'cliente.escrever'
  | 'projeto.ler' | 'projeto.escrever'
  | 'credito.ler' | 'credito.escrever'
  /** Validar enquadramento de crédito é ato jurídico: não é de todo mundo. */
  | 'credito.validar'
  | 'plano.ler' | 'plano.escrever'
  | 'agc.ler' | 'agc.registrar_voto' | 'agc.apurar'
  /** Finanças DO ESCRITÓRIO: honorários, receitas, despesas da NGA. */
  | 'financeiro.ler' | 'financeiro.escrever'
  /**
   * Caixa DA RECUPERANDA (§6.6). É coisa distinta das finanças do escritório:
   * o advogado do caso precisa acompanhar o fluxo de caixa do cliente, mas não
   * tem nada que ver o faturamento da NGA. Juntar os dois numa permissão só
   * obriga a escolher entre vazar uma ou travar a outra.
   */
  | 'financeiro_cliente.ler' | 'financeiro_cliente.escrever'
  | 'processo.ler' | 'processo.escrever'
  /**
   * Prazo é controle da controladoria e do advogado. O estagiário cadastra
   * processo e redige, mas não fecha prazo: marcar como cumprido o que não
   * foi cumprido é o erro que faz o escritório descobrir tarde demais.
   */
  | 'prazo.ler' | 'prazo.escrever'
  | 'documento.ler' | 'documento.escrever'
  /**
   * Rodar a análise documental. É separada de `documento.escrever` por dois
   * motivos: consome chamada paga de modelo, e produz afirmação sobre
   * documento de cliente.
   */
  | 'analise.executar'
  /**
   * Validar o tipo do documento sugerido pela máquina (§7.7). Mesmo desenho do
   * `credito.validar`: a sugestão é de máquina, a validação é de quem responde.
   */
  | 'analise.validar'
  /**
   * Gerar relatório. Separada de `documento.escrever` porque o cliente TEM
   * essa permissão (envia documento pelo portal) e não pode emitir relatório
   * em papel timbrado da NGA.
   */
  | 'relatorio.gerar'
  /** Publicar para o portal do cliente: nada vaza para fora sem isto (§13). */
  | 'portal.publicar'
  | 'auditoria.ler'
  /** Criar e revogar credencial de integração. É chave de porta: fica com a sócia. */
  | 'integracao.gerir'
  | 'admin.gerir';

const INTERNO_LEITURA: Permissao[] = [
  'cliente.ler', 'projeto.ler', 'credito.ler', 'plano.ler', 'agc.ler', 'documento.ler',
  'processo.ler', 'prazo.ler',
  // O caixa da recuperanda é insumo do trabalho jurídico, quando o cliente
  // autoriza pelo portal. A autorização é checada pelo RLS, não aqui.
  'financeiro_cliente.ler',
];

const ADVOGADO: Permissao[] = [
  ...INTERNO_LEITURA,
  'cliente.escrever', 'projeto.escrever', 'credito.escrever', 'credito.validar',
  'plano.escrever', 'agc.registrar_voto', 'agc.apurar', 'documento.escrever',
  'portal.publicar', 'analise.executar', 'analise.validar',
  'processo.escrever', 'prazo.escrever', 'relatorio.gerar',
];

export const PERMISSOES: Readonly<Record<Papel, readonly Permissao[]>> = Object.freeze({
  socio_administrador: [
    ...ADVOGADO, 'financeiro.ler', 'financeiro.escrever', 'auditoria.ler',
    'integracao.gerir', 'admin.gerir',
  ],
  socio: [...ADVOGADO, 'financeiro.ler', 'auditoria.ler'],
  advogado: ADVOGADO,
  controladoria: [...INTERNO_LEITURA, 'projeto.escrever', 'documento.escrever',
    'analise.executar', 'processo.escrever', 'prazo.escrever', 'relatorio.gerar',
    'auditoria.ler'],
  financeiro: [...INTERNO_LEITURA, 'financeiro.ler', 'financeiro.escrever'],
  administrativo: [...INTERNO_LEITURA, 'documento.escrever', 'processo.escrever'],
  // Estagiário lê e redige, mas não valida enquadramento nem publica para fora.
  estagiario: [...INTERNO_LEITURA, 'credito.escrever', 'documento.escrever',
    'analise.executar', 'processo.escrever', 'relatorio.gerar'],
  cliente_administrador: [
    'projeto.ler', 'documento.ler', 'documento.escrever', 'plano.ler', 'processo.ler',
    // O cliente lança no PRÓPRIO caixa; nunca vê as finanças da NGA.
    'financeiro_cliente.ler', 'financeiro_cliente.escrever',
  ],
  cliente_usuario: [
    'projeto.ler', 'documento.ler', 'documento.escrever', 'plano.ler', 'processo.ler',
    'financeiro_cliente.ler',
  ],
  parceiro_externo: ['documento.ler'],

  /**
   * O que uma aplicação do NGA Lab pode fazer ao entregar o que produziu.
   *
   * Deliberadamente curto. Nenhuma integração publica no portal do cliente,
   * valida enquadramento de crédito, emite relatório ou gera outra credencial:
   * script que roda sozinho não assume ato que é de pessoa. O escopo da
   * própria credencial estreita isto ainda mais, por aplicação.
   */
  integracao: [
    'projeto.ler',
    'processo.ler', 'processo.escrever',
    'prazo.ler', 'prazo.escrever',
    'documento.ler', 'documento.escrever',
  ],
});

export function podeComPapeis(papeis: readonly Papel[], permissao: Permissao): boolean {
  return papeis.some((p) => PERMISSOES[p].includes(permissao));
}

export class SemPermissao extends Error {
  override readonly name = 'SemPermissao';
  constructor(readonly permissao: Permissao) {
    super(`sem permissão: ${permissao}`);
  }
}

export function exigir(papeis: readonly Papel[], permissao: Permissao): void {
  if (!podeComPapeis(papeis, permissao)) throw new SemPermissao(permissao);
}
