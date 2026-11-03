/**
 * Fases do projeto, por procedimento.
 *
 * Um projeto de recuperação judicial não tem "andamento de 0 a 100%": tem
 * MARCOS, e cada marco é um ato processual com artigo. Saber que o caso está
 * em "plano apresentado" e ainda não em "assembleia" diz mais sobre o que a
 * equipe precisa fazer esta semana do que qualquer barra de progresso.
 *
 * Por isso as fases não são um campo de texto livre: são lista fechada por
 * tipo de procedimento, com o marco e o fundamento de cada uma. O que isso
 * compra, concretamente:
 *
 *   - a tela do projeto sabe o que vem a seguir, sem ninguém digitar;
 *   - a fase errada não entra (pular de "pedido" para "encerrada" é recusado);
 *   - o relatório ao cliente pode dizer em que ponto o processo está, em
 *     português, sem alguém traduzir à mão toda vez.
 *
 * E uma recusa: não há fase "em andamento" genérica. Ou o marco ocorreu, ou
 * não ocorreu. Fase vaga é fase que ninguém atualiza.
 */

export type TipoDeProjeto =
  | 'recuperacao_judicial' | 'recuperacao_extrajudicial' | 'falencia'
  | 'reestruturacao' | 'negociacao_credores' | 'investigacao_patrimonial'
  | 'contencioso_estrategico' | 'consultivo';

export interface Fase {
  readonly id: string;
  readonly nome: string;
  /** O ato que marca a entrada nesta fase. */
  readonly marco: string;
  /** Dispositivo que rege o marco, quando há. */
  readonly fundamento?: string;
  /** Fase de saída: o projeto acaba aqui. */
  readonly terminal?: boolean;
  /** Desfecho adverso, fora da sequência normal. */
  readonly excepcional?: boolean;
}

const RECUPERACAO_JUDICIAL: readonly Fase[] = Object.freeze([
  { id: 'preparacao', nome: 'Preparação do pedido',
    marco: 'Reunião da documentação exigida para a inicial.',
    fundamento: 'art. 51 da Lei 11.101/2005' },
  { id: 'distribuido', nome: 'Pedido distribuído',
    marco: 'Petição inicial protocolada e distribuída.' },
  { id: 'processamento_deferido', nome: 'Processamento deferido',
    marco: 'Decisão que defere o processamento e nomeia o administrador judicial.',
    fundamento: 'art. 52 da Lei 11.101/2005' },
  { id: 'relacao_credores', nome: 'Relação de credores publicada',
    marco: 'Edital com a relação elaborada pelo administrador judicial.',
    fundamento: 'art. 7º, § 2º, da Lei 11.101/2005' },
  { id: 'plano_apresentado', nome: 'Plano apresentado',
    marco: 'Plano de recuperação juntado aos autos.',
    fundamento: 'art. 53 da Lei 11.101/2005' },
  { id: 'assembleia', nome: 'Assembleia geral de credores',
    marco: 'Assembleia convocada para deliberar sobre o plano.',
    fundamento: 'art. 56 da Lei 11.101/2005' },
  { id: 'concedida', nome: 'Recuperação concedida',
    marco: 'Decisão que concede a recuperação judicial.',
    fundamento: 'art. 58 da Lei 11.101/2005' },
  { id: 'supervisao', nome: 'Supervisão judicial',
    marco: 'Cumprimento do plano sob supervisão do juízo.',
    fundamento: 'art. 61 da Lei 11.101/2005' },
  { id: 'encerrada', nome: 'Recuperação encerrada',
    marco: 'Sentença de encerramento.',
    fundamento: 'art. 63 da Lei 11.101/2005', terminal: true },
  { id: 'convolada_falencia', nome: 'Convolada em falência',
    marco: 'Decisão que converte a recuperação em falência.',
    fundamento: 'art. 73 da Lei 11.101/2005', terminal: true, excepcional: true },
]);

const FALENCIA: readonly Fase[] = Object.freeze([
  { id: 'pedido', nome: 'Pedido de falência',
    marco: 'Pedido distribuído.', fundamento: 'art. 94 da Lei 11.101/2005' },
  { id: 'decretada', nome: 'Falência decretada',
    marco: 'Sentença que decreta a falência.',
    fundamento: 'art. 99 da Lei 11.101/2005' },
  { id: 'arrecadacao', nome: 'Arrecadação de bens',
    marco: 'Arrecadação dos bens e documentos do falido.',
    fundamento: 'art. 108 da Lei 11.101/2005' },
  { id: 'verificacao_creditos', nome: 'Verificação de créditos',
    marco: 'Habilitações, divergências e consolidação do quadro.',
    fundamento: 'art. 7º da Lei 11.101/2005' },
  { id: 'realizacao_ativo', nome: 'Realização do ativo',
    marco: 'Alienação dos bens arrecadados.',
    fundamento: 'art. 139 da Lei 11.101/2005' },
  { id: 'pagamento_credores', nome: 'Pagamento dos credores',
    marco: 'Pagamento conforme a ordem de classificação.',
    fundamento: 'art. 149 da Lei 11.101/2005' },
  { id: 'prestacao_contas', nome: 'Prestação de contas',
    marco: 'Contas do administrador judicial apresentadas.',
    fundamento: 'art. 154 da Lei 11.101/2005' },
  { id: 'encerrada', nome: 'Falência encerrada',
    marco: 'Sentença de encerramento.',
    fundamento: 'art. 156 da Lei 11.101/2005', terminal: true },
]);

const RECUPERACAO_EXTRAJUDICIAL: readonly Fase[] = Object.freeze([
  { id: 'negociacao', nome: 'Negociação com credores',
    marco: 'Tratativas em curso, antes do pedido.',
    fundamento: 'art. 161 da Lei 11.101/2005' },
  { id: 'adesoes', nome: 'Colheita de adesões',
    marco: 'Assinaturas dos credores ao plano.',
    fundamento: 'art. 163 da Lei 11.101/2005' },
  { id: 'homologacao_requerida', nome: 'Homologação requerida',
    marco: 'Pedido de homologação distribuído.',
    fundamento: 'art. 162 da Lei 11.101/2005' },
  { id: 'homologado', nome: 'Plano homologado',
    marco: 'Sentença de homologação.', terminal: true },
  { id: 'indeferido', nome: 'Homologação indeferida',
    marco: 'Decisão que indefere a homologação.', terminal: true, excepcional: true },
]);

/** Procedimentos sem marco legal próprio seguem um ciclo de trabalho simples. */
const GENERICO: readonly Fase[] = Object.freeze([
  { id: 'diagnostico', nome: 'Diagnóstico', marco: 'Levantamento inicial do caso.' },
  { id: 'execucao', nome: 'Execução', marco: 'Trabalho em curso conforme o escopo contratado.' },
  { id: 'entrega', nome: 'Entrega', marco: 'Produto entregue ao cliente.' },
  { id: 'encerrado', nome: 'Encerrado', marco: 'Projeto encerrado.', terminal: true },
]);

const POR_TIPO: Readonly<Record<TipoDeProjeto, readonly Fase[]>> = Object.freeze({
  recuperacao_judicial: RECUPERACAO_JUDICIAL,
  falencia: FALENCIA,
  recuperacao_extrajudicial: RECUPERACAO_EXTRAJUDICIAL,
  reestruturacao: GENERICO,
  negociacao_credores: GENERICO,
  investigacao_patrimonial: GENERICO,
  contencioso_estrategico: GENERICO,
  consultivo: GENERICO,
});

export function fasesDe(tipo: TipoDeProjeto): readonly Fase[] {
  return POR_TIPO[tipo] ?? GENERICO;
}

export function fase(tipo: TipoDeProjeto, id: string): Fase | undefined {
  return fasesDe(tipo).find((f) => f.id === id);
}

/** A primeira fase de um procedimento: onde todo projeto novo começa. */
export function faseInicial(tipo: TipoDeProjeto): Fase {
  return fasesDe(tipo)[0]!;
}

export class TransicaoDeFaseInvalida extends Error {
  override readonly name = 'TransicaoDeFaseInvalida';
}

export interface Progresso {
  readonly indice: number;
  readonly total: number;
  readonly percentual: number;
  readonly proxima: Fase | null;
  readonly terminal: boolean;
}

/**
 * Onde o projeto está na sequência.
 *
 * Fases excepcionais (convolação em falência, homologação indeferida) ficam
 * FORA da contagem: elas não são o passo seguinte de nada, e somá-las ao
 * denominador faria todo projeto normal parecer mais atrasado do que está.
 */
export function progresso(tipo: TipoDeProjeto, faseAtual: string): Progresso {
  const todas = fasesDe(tipo);
  const normais = todas.filter((f) => !f.excepcional);
  const atual = todas.find((f) => f.id === faseAtual);
  if (!atual) throw new TransicaoDeFaseInvalida(`fase desconhecida para ${tipo}: ${faseAtual}`);

  if (atual.excepcional) {
    return {
      indice: normais.length, total: normais.length, percentual: 100,
      proxima: null, terminal: true,
    };
  }

  const indice = normais.findIndex((f) => f.id === faseAtual) + 1;
  return {
    indice,
    total: normais.length,
    percentual: Math.round((indice / normais.length) * 100),
    proxima: normais[indice] ?? null,
    terminal: atual.terminal === true,
  };
}

/**
 * Valida a mudança de fase.
 *
 * Avançar é passo a passo; voltar é permitido (decisão reformada em agravo
 * acontece, e o sistema tem de aceitar a realidade); pular adiante, não —
 * saltar de "pedido distribuído" para "concedida" esconde que ninguém
 * registrou o que houve no meio.
 *
 * As fases excepcionais são alcançáveis de qualquer ponto não terminal: a
 * convolação em falência não espera o caso chegar à assembleia.
 */
export function transicionarFase(
  tipo: TipoDeProjeto, de: string, para: string,
): Fase {
  const todas = fasesDe(tipo);
  const atual = todas.find((f) => f.id === de);
  const destino = todas.find((f) => f.id === para);
  if (!atual) throw new TransicaoDeFaseInvalida(`fase atual desconhecida: ${de}`);
  if (!destino) {
    throw new TransicaoDeFaseInvalida(
      `"${para}" não é fase de ${ROTULO_DO_TIPO[tipo] ?? tipo}`);
  }
  if (de === para) throw new TransicaoDeFaseInvalida('o projeto já está nesta fase');

  if (atual.terminal) {
    throw new TransicaoDeFaseInvalida(
      `o projeto está em "${atual.nome}", que é fase final: reabrir é decisão que ` +
      'precisa ser registrada como projeto novo');
  }

  if (destino.excepcional) return destino;

  const normais = todas.filter((f) => !f.excepcional);
  const iDe = normais.findIndex((f) => f.id === de);
  const iPara = normais.findIndex((f) => f.id === para);
  // `iDe` é -1 quando se sai de uma excepcional, o que o terminal acima já barra.
  if (iPara > iDe + 1) {
    const pulada = normais[iDe + 1]!;
    throw new TransicaoDeFaseInvalida(
      `não dá para saltar de "${atual.nome}" para "${destino.nome}" sem passar por ` +
      `"${pulada.nome}"`);
  }
  return destino;
}

export const ROTULO_DO_TIPO: Readonly<Record<TipoDeProjeto, string>> = Object.freeze({
  recuperacao_judicial: 'Recuperação judicial',
  recuperacao_extrajudicial: 'Recuperação extrajudicial',
  falencia: 'Falência',
  reestruturacao: 'Reestruturação',
  negociacao_credores: 'Negociação com credores',
  investigacao_patrimonial: 'Investigação patrimonial',
  contencioso_estrategico: 'Contencioso estratégico',
  consultivo: 'Consultivo',
});
