/**
 * Checklist documental do onboarding (§6.2).
 *
 * REGRA CENTRAL
 * "O simples envio não significa aprovação." O briefing é explícito em
 * distinguir recebimento, análise, validação e complementação — então o
 * progresso que o cliente vê NUNCA é a contagem de arquivos enviados. São duas
 * barras: o quanto ele já mandou e o quanto a NGA já aprovou. Só a segunda
 * fecha o onboarding.
 */

import { CHECKLIST_GESTAO_DE_PASSIVOS, CHECKLIST_PROTECAO_PATRIMONIAL, CHECKLIST_RJ_E_RE } from './modelos-oficiais.ts';

export type SituacaoRequisito =
  /** Nada enviado ainda. */
  | 'pendente'
  /** O cliente enviou; ninguém olhou. */
  | 'enviado'
  /** A NGA está analisando. */
  | 'em_analise'
  /** Conferido e aceito. Só este conta como concluído. */
  | 'aprovado'
  /** Recusado: o documento não serve. */
  | 'rejeitado'
  /** Serve em parte; falta algo. */
  | 'complementacao'
  /** A NGA decidiu que o item não vale para este caso (a coluna "N/A" da planilha). */
  | 'nao_aplicavel';

export const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoRequisito, string>> = Object.freeze({
  pendente: 'Pendente',
  enviado: 'Recebido, aguardando análise',
  em_analise: 'Em análise',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  complementacao: 'Aguardando complementação',
  nao_aplicavel: 'Não se aplica',
});

/** Situações em que a bola está com o cliente. */
export const AGUARDA_O_CLIENTE: readonly SituacaoRequisito[] =
  Object.freeze(['pendente', 'rejeitado', 'complementacao']);

/** Situações em que a bola está com a NGA. */
export const AGUARDA_A_NGA: readonly SituacaoRequisito[] =
  Object.freeze(['enviado', 'em_analise']);

/**
 * Transições permitidas.
 *
 * Quem envia é o cliente; quem aprova, rejeita ou pede complementação é a NGA.
 * O cliente não consegue marcar o próprio documento como aprovado — e isso é
 * garantido aqui, não só na interface.
 */
const TRANSICOES: Readonly<Record<SituacaoRequisito, readonly SituacaoRequisito[]>> = Object.freeze({
  // "Não se aplica" é decisão da NGA e é reversível: o item volta a pendente.
  pendente: ['enviado', 'nao_aplicavel'],
  // Reenviar antes da análise é legítimo: o cliente manda o arquivo errado,
  // percebe e manda o certo. Bloquear isso obrigaria a NGA a rejeitar primeiro.
  enviado: ['enviado', 'em_analise', 'aprovado', 'rejeitado', 'complementacao'],
  em_analise: ['aprovado', 'rejeitado', 'complementacao'],
  complementacao: ['enviado', 'nao_aplicavel'],
  rejeitado: ['enviado', 'nao_aplicavel'],
  nao_aplicavel: ['pendente'],
  // Reabrir um item aprovado é possível, mas é ato da NGA e fica na auditoria.
  aprovado: ['em_analise', 'complementacao'],
});

export type Autor = 'cliente' | 'nga';

/** Quem pode provocar cada transição. */
/**
 * Quem pode levar o item a cada situação.
 *
 * "Enviado" aceita os DOIS lados, e isso é deliberado: significa "o documento
 * chegou", não "o cliente clicou". Metade dos documentos de uma recuperação
 * judicial chega por e-mail ou em papel, e é a equipe que registra. Quem
 * registrou fica em `documentos.enviado_por`, em `origem` e na auditoria —
 * negar o caso real só faria a equipe inventar contorno.
 *
 * O que nenhum lado flexibiliza é o resto: aprovar, rejeitar, pedir
 * complementação e reabrir são atos da NGA, e o cliente não chega a eles por
 * caminho algum (§6.2).
 */
const QUEM_PODE: Readonly<Record<SituacaoRequisito, readonly Autor[]>> = Object.freeze({
  enviado: ['cliente', 'nga'],
  em_analise: ['nga'],
  aprovado: ['nga'],
  rejeitado: ['nga'],
  complementacao: ['nga'],
  pendente: ['nga'],
  nao_aplicavel: ['nga'],
});

export class TransicaoInvalida extends Error {
  override readonly name = 'TransicaoInvalida';
}

/**
 * Valida uma mudança de situação. Lança se for impossível ou se o autor não
 * puder fazê-la.
 */
export function transicionar(
  de: SituacaoRequisito, para: SituacaoRequisito, autor: Autor,
): SituacaoRequisito {
  if (!TRANSICOES[de].includes(para)) {
    throw new TransicaoInvalida(
      `transição inválida: ${ROTULO_DA_SITUACAO[de]} → ${ROTULO_DA_SITUACAO[para]}`);
  }
  if (!QUEM_PODE[para].includes(autor)) {
    throw new TransicaoInvalida(
      `${autor === 'cliente' ? 'o cliente' : 'a NGA'} não pode marcar o item como ` +
      `"${ROTULO_DA_SITUACAO[para]}"`);
  }
  return para;
}

export interface ItemDeChecklist {
  readonly id: string;
  readonly categoria: string;
  readonly titulo: string;
  readonly situacao: SituacaoRequisito;
  readonly obrigatorio: boolean;
}

export interface ProgressoDeCategoria {
  readonly categoria: string;
  readonly total: number;
  readonly aprovados: number;
  readonly enviados: number;
  readonly pendentes: number;
}

export interface Progresso {
  readonly total: number;
  readonly obrigatorios: number;
  /** Itens aprovados pela NGA. É o que realmente conta. */
  readonly aprovados: number;
  /** Itens que o cliente já mandou (enviado, em análise ou aprovado). */
  readonly enviados: number;
  /** Percentual de conclusão REAL: aprovados sobre obrigatórios. */
  readonly percentualAprovado: number;
  /** Percentual enviado — mostrado separado para não enganar o cliente. */
  readonly percentualEnviado: number;
  readonly aguardandoOCliente: number;
  readonly aguardandoANGA: number;
  readonly concluido: boolean;
  readonly porCategoria: readonly ProgressoDeCategoria[];
}

function jaEnviou(s: SituacaoRequisito): boolean {
  return s === 'enviado' || s === 'em_analise' || s === 'aprovado';
}

/**
 * Calcula o progresso do onboarding.
 *
 * O denominador são os itens OBRIGATÓRIOS: documento opcional enviado não
 * infla a barra, e documento opcional faltando não trava o onboarding.
 */
export function calcularProgresso(itens: readonly ItemDeChecklist[]): Progresso {
  // Item "não se aplica" sai da conta: não pesa no denominador nem conta como entregue.
  const aplicaveis = itens.filter((i) => i.situacao !== 'nao_aplicavel');
  const obrigatorios = aplicaveis.filter((i) => i.obrigatorio);
  const base = obrigatorios.length;

  const aprovados = obrigatorios.filter((i) => i.situacao === 'aprovado').length;
  const enviados = obrigatorios.filter((i) => jaEnviou(i.situacao)).length;

  const categorias = [...new Set(aplicaveis.map((i) => i.categoria))];
  const porCategoria = categorias.map((categoria) => {
    const daCategoria = aplicaveis.filter((i) => i.categoria === categoria);
    return {
      categoria,
      total: daCategoria.length,
      aprovados: daCategoria.filter((i) => i.situacao === 'aprovado').length,
      enviados: daCategoria.filter((i) => jaEnviou(i.situacao)).length,
      pendentes: daCategoria.filter((i) => AGUARDA_O_CLIENTE.includes(i.situacao)).length,
    };
  });

  return {
    total: aplicaveis.length,
    obrigatorios: base,
    aprovados,
    enviados,
    // Sem itens obrigatórios o onboarding não está 100 % — está indefinido.
    // Devolver 0 evita anunciar conclusão de um checklist vazio.
    percentualAprovado: base === 0 ? 0 : Math.round((aprovados / base) * 100),
    percentualEnviado: base === 0 ? 0 : Math.round((enviados / base) * 100),
    aguardandoOCliente: aplicaveis.filter((i) => AGUARDA_O_CLIENTE.includes(i.situacao)).length,
    aguardandoANGA: aplicaveis.filter((i) => AGUARDA_A_NGA.includes(i.situacao)).length,
    concluido: base > 0 && aprovados === base,
    porCategoria,
  };
}

/**
 * Modelos de checklist por tipo de procedimento (§6.2).
 *
 * "Uma recuperação judicial exige documentação diferente de uma investigação
 * patrimonial." Os modelos são ponto de partida configurável, não camisa de
 * força: a instância do projeto é que vale.
 */
export interface ModeloDeRequisito {
  readonly categoria: string;
  readonly titulo: string;
  readonly obrigatorio: boolean;
  readonly fundamento?: string;
  /** Quem deve entregar, como na planilha da NGA: CLIENTE, CONTABILIDADE, SÓCIOS ou combinação. */
  readonly atribuicao?: string;
}

export const MODELOS: Readonly<Record<string, readonly ModeloDeRequisito[]>> = Object.freeze({
  // Os três abaixo vêm das planilhas oficiais da NGA (ver modelos-oficiais.ts).
  recuperacao_judicial: CHECKLIST_RJ_E_RE,
  recuperacao_extrajudicial: CHECKLIST_RJ_E_RE,
  falencia: Object.freeze([
    { categoria: 'Contábil', titulo: 'Demonstrações contábeis do último exercício', obrigatorio: true },
    { categoria: 'Credores', titulo: 'Relação de credores', obrigatorio: true },
    { categoria: 'Patrimonial', titulo: 'Relação de bens e direitos', obrigatorio: true },
    { categoria: 'Societário', titulo: 'Contrato social e alterações', obrigatorio: true },
    { categoria: 'Processual', titulo: 'Relação de ações e execuções em curso', obrigatorio: true },
  ]),
  investigacao_patrimonial: Object.freeze([
    { categoria: 'Identificação', titulo: 'Qualificação completa do investigado', obrigatorio: true },
    { categoria: 'Identificação', titulo: 'CPF ou CNPJ e documentos de identificação', obrigatorio: true },
    { categoria: 'Documental', titulo: 'Título executivo ou contrato que embasa o crédito', obrigatorio: true },
    { categoria: 'Processual', titulo: 'Processos em que o crédito é discutido', obrigatorio: false },
  ]),
  reestruturacao: CHECKLIST_GESTAO_DE_PASSIVOS,
  negociacao_credores: CHECKLIST_GESTAO_DE_PASSIVOS,
  protecao_patrimonial: CHECKLIST_PROTECAO_PATRIMONIAL,
});

/** Modelo do procedimento, ou lista vazia quando não houver (nunca lança). */
export function modeloDe(tipoDeProjeto: string): readonly ModeloDeRequisito[] {
  return MODELOS[tipoDeProjeto] ?? [];
}
