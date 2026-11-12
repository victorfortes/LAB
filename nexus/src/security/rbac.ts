/**
 * Permissões por papel (§13 do briefing).
 *
 * O RBAC decide O QUE o usuário pode fazer; o RLS decide SOBRE QUAIS LINHAS.
 * São camadas distintas e ambas obrigatórias: o RBAC sozinho não impede um
 * advogado da NGA de ler dados do cliente errado, e o RLS sozinho não impede
 * um estagiário de validar classe de crédito.
 */
export type Papel =
  | 'socio_administrador' | 'socio' | 'coordenacao' | 'advogado' | 'controladoria'
  | 'financeiro' | 'administrativo' | 'estagiario'
  | 'cliente_administrador' | 'cliente_usuario' | 'parceiro_externo'
  /** Usuário de serviço das aplicações do NGA Nexus. Ver `integracoes`. */
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
  /** Tarefa é trabalho interno: o cliente não alcança nenhuma. */
  | 'tarefa.ler' | 'tarefa.escrever'
  | 'negociacao.ler' | 'negociacao.escrever'
  /** Controladoria (publicações do DJEN): só sócio administrador e controladoria. */
  | 'controladoria.ler' | 'controladoria.gerir'
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
  /**
   * Módulos de navegação do escritório. Cada um é uma porta da casa: quem não a
   * tem não vê a aba e o servidor recusa a rota. Ficam separados das permissões
   * de dado (`cliente.ler` etc.) porque o advogado trabalha COM os dados do
   * cliente sem precisar da carteira de clientes do escritório.
   */
  | 'modulo.painel' | 'modulo.clientes' | 'modulo.equipe' | 'modulo.relatorios'
  | 'modulo.ferramentas' | 'modulo.entregas'
  /** Dar e administrar acesso do CLIENTE ao portal. Chave de porta, como `integracao.gerir`. */
  | 'portal.acessos'
  /** Faturas e guias: ler, gerir (juntar, emitir, conferir comprovante) e anexar comprovante (cliente). */
  | 'fatura.ler' | 'fatura.gerir' | 'fatura.comprovar'
  /** Ajustes editáveis: fluxos, linhas do tempo e automações. */
  | 'config.gerir'
  /** Criar e revogar credencial de integração. É chave de porta: fica com a sócia. */
  | 'integracao.gerir'
  | 'admin.gerir';

const INTERNO_LEITURA: Permissao[] = [
  'cliente.ler', 'projeto.ler', 'credito.ler', 'plano.ler', 'agc.ler', 'documento.ler',
  'processo.ler', 'prazo.ler', 'tarefa.ler', 'negociacao.ler',
  // O caixa da recuperanda é insumo do trabalho jurídico, quando o cliente
  // autoriza pelo portal. A autorização é checada pelo RLS, não aqui.
  'financeiro_cliente.ler',
];

const ADVOGADO: Permissao[] = [
  ...INTERNO_LEITURA,
  'cliente.escrever', 'projeto.escrever', 'credito.escrever', 'credito.validar',
  'plano.escrever', 'agc.registrar_voto', 'agc.apurar', 'documento.escrever',
  'portal.publicar', 'analise.executar', 'analise.validar',
  'processo.escrever', 'prazo.escrever', 'tarefa.escrever', 'negociacao.escrever',
  'modulo.painel', 'modulo.ferramentas', 'fatura.ler',
];

/** Tudo o que a sócia, o sócio e a coordenação veem do escritório, de ponta a ponta. */
const GESTAO: Permissao[] = [
  ...ADVOGADO, 'relatorio.gerar', 'modulo.clientes', 'modulo.equipe', 'modulo.relatorios',
  'portal.acessos', 'fatura.gerir', 'config.gerir',
];

/**
 * A matriz de acessos do escritório (curadoria):
 *
 *  - Administrador (`socio_administrador`): tudo, inclusive acessos, integrações e auditoria.
 *  - Sócio: tudo o que é do trabalho e da gestão; não administra credenciais.
 *  - Coordenação: tudo, menos Controladoria (e Sentinela, BI de Prazos) e Entregas NEXUS.
 *  - Advogado: o trabalho do caso. Sem carteira de clientes, relatórios, controladoria,
 *    equipe, entregas e sem dar acesso ao portal do cliente.
 *  - Controladoria: prazos e publicações (Controladoria, Sentinela, BI de Prazos), painel,
 *    calendário, clientes, projetos, relatórios e equipe. Não cria acesso de cliente.
 *  - Financeiro: só faturas, guias e comprovantes, e só dos projetos em que está na equipe.
 */
export const PERMISSOES: Readonly<Record<Papel, readonly Permissao[]>> = Object.freeze({
  socio_administrador: [
    ...GESTAO, 'financeiro.ler', 'financeiro.escrever', 'auditoria.ler',
    'integracao.gerir', 'admin.gerir', 'controladoria.ler', 'controladoria.gerir', 'modulo.entregas',
  ],
  socio: [...GESTAO, 'financeiro.ler', 'financeiro.escrever', 'auditoria.ler',
    'controladoria.ler', 'controladoria.gerir', 'modulo.entregas'],
  coordenacao: [...GESTAO, 'financeiro.ler'],
  advogado: ADVOGADO,
  controladoria: [...INTERNO_LEITURA, 'projeto.escrever', 'documento.escrever',
    'analise.executar', 'processo.escrever', 'prazo.escrever', 'relatorio.gerar',
    'tarefa.escrever', 'auditoria.ler', 'controladoria.ler', 'controladoria.gerir',
    'cliente.escrever', 'modulo.painel', 'modulo.clientes', 'modulo.equipe', 'modulo.relatorios'],
  financeiro: ['projeto.ler', 'documento.ler', 'documento.escrever', 'financeiro_cliente.ler',
    'financeiro.ler', 'financeiro.escrever', 'fatura.ler', 'fatura.gerir'],
  administrativo: [...INTERNO_LEITURA, 'documento.escrever', 'processo.escrever', 'tarefa.escrever',
    'modulo.painel', 'modulo.ferramentas', 'modulo.equipe'],
  // Estagiário lê e redige, mas não valida enquadramento nem publica para fora.
  estagiario: [...INTERNO_LEITURA, 'credito.escrever', 'documento.escrever',
    'analise.executar', 'processo.escrever', 'relatorio.gerar', 'tarefa.escrever',
    'modulo.painel', 'modulo.ferramentas', 'modulo.relatorios', 'modulo.equipe'],
  cliente_administrador: [
    'projeto.ler', 'documento.ler', 'documento.escrever', 'plano.ler', 'processo.ler',
    // O cliente lança no PRÓPRIO caixa; nunca vê as finanças da NGA.
    'financeiro_cliente.ler', 'financeiro_cliente.escrever',
    'fatura.ler', 'fatura.comprovar',
  ],
  cliente_usuario: [
    'projeto.ler', 'documento.ler', 'documento.escrever', 'plano.ler', 'processo.ler',
    'financeiro_cliente.ler', 'fatura.ler', 'fatura.comprovar',
  ],
  parceiro_externo: ['documento.ler'],

  /**
   * O que uma aplicação do NGA Nexus pode fazer ao entregar o que produziu.
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

/** O menu do escritório, na ordem em que aparece. A navegação e a matriz de Ajustes leem desta lista. */
export const MENU_DO_ESCRITORIO: readonly { id: string; rotulo: string; permissao: Permissao | null }[] = Object.freeze([
  { id: 'painel', rotulo: 'Painel geral', permissao: 'modulo.painel' },
  { id: 'tarefas', rotulo: 'Tarefas', permissao: 'tarefa.ler' },
  { id: 'calendario', rotulo: 'Calendário', permissao: 'prazo.ler' },
  { id: 'clientes', rotulo: 'Clientes', permissao: 'modulo.clientes' },
  { id: 'projetos', rotulo: 'Projetos', permissao: 'projeto.ler' },
  { id: 'financeiro', rotulo: 'Financeiro', permissao: 'fatura.gerir' },
  { id: 'ferramentas', rotulo: 'Ferramentas', permissao: 'modulo.ferramentas' },
  { id: 'controladoria', rotulo: 'Controladoria', permissao: 'controladoria.ler' },
  { id: 'sentinela', rotulo: 'Sentinela', permissao: 'controladoria.ler' },
  { id: 'bi-prazos', rotulo: 'BI de Prazos', permissao: 'controladoria.ler' },
  { id: 'relatorios', rotulo: 'Relatórios', permissao: 'modulo.relatorios' },
  { id: 'equipe', rotulo: 'Equipe', permissao: 'modulo.equipe' },
  { id: 'entregas', rotulo: 'Entregas NEXUS', permissao: 'modulo.entregas' },
  { id: 'ajustes', rotulo: 'Ajustes', permissao: null },
]);

export const PAPEIS_DO_ESCRITORIO: readonly { papel: Papel; rotulo: string; resumo: string }[] = Object.freeze([
  { papel: 'socio_administrador', rotulo: 'Administrador', resumo: 'Tudo, absolutamente: inclui acessos, integrações e auditoria.' },
  { papel: 'socio', rotulo: 'Sócio', resumo: 'Tudo o que é trabalho e gestão, inclusive Controladoria e Entregas.' },
  { papel: 'coordenacao', rotulo: 'Coordenação', resumo: 'Tudo, menos Controladoria (Sentinela, BI de Prazos) e Entregas NEXUS.' },
  { papel: 'advogado', rotulo: 'Advogado(a)', resumo: 'O trabalho do caso. Sem carteira de clientes, relatórios, controladoria, equipe e entregas; não cria acesso de cliente.' },
  { papel: 'controladoria', rotulo: 'Controladoria', resumo: 'Prazos e publicações: Controladoria, Sentinela e BI de Prazos, mais painel, calendário, clientes, projetos, relatórios e equipe.' },
  { papel: 'financeiro', rotulo: 'Financeiro', resumo: 'Só faturas, guias de custas e comprovantes, e só dos projetos em que está na equipe.' },
  { papel: 'administrativo', rotulo: 'Administrativo', resumo: 'Apoio operacional: lê, cadastra processos, documentos e tarefas.' },
  { papel: 'estagiario', rotulo: 'Estagiário(a)', resumo: 'Redige e lê; não valida enquadramento nem publica para fora.' },
]);

/** A matriz que a tela de Ajustes mostra: para cada papel, o que cada porta do menu faz. */
export function matrizDeAcessos() {
  return PAPEIS_DO_ESCRITORIO.map((p) => ({
    papel: p.papel, rotulo: p.rotulo, resumo: p.resumo,
    menu: MENU_DO_ESCRITORIO.map((m) => ({ id: m.id, rotulo: m.rotulo, acesso: m.permissao === null || PERMISSOES[p.papel].includes(m.permissao) })),
    extras: {
      daAcessoAoPortalDoCliente: PERMISSOES[p.papel].includes('portal.acessos'),
      administraAcessosDaEquipe: PERMISSOES[p.papel].includes('admin.gerir'),
      geraFaturas: PERMISSOES[p.papel].includes('fatura.gerir'),
      editaFluxosEAutomacoes: PERMISSOES[p.papel].includes('config.gerir'),
      publicaParaOCliente: PERMISSOES[p.papel].includes('portal.publicar'),
    },
  }));
}
