/**
 * Apuração de quórum da Assembleia Geral de Credores — arts. 45 e 58 da
 * Lei 11.101/2005, com as alterações da Lei 14.112/2020.
 *
 * Este módulo é DETERMINÍSTICO e não consulta modelo de linguagem algum.
 * Dado o conjunto de votos, o resultado é aritmética pura e auditável.
 * É de propósito: o quórum de uma AGC não é lugar para número gerado por IA.
 *
 * O que ele NÃO decide: quem tem direito a voto (art. 39), se um voto é
 * abusivo, se houve tratamento diferenciado (art. 58, § 2º) e se o plano é
 * legal. Isso é trabalho do advogado; aqui só se conta.
 */
import type { Centavos } from '../shared/dinheiro.ts';
import type { ClasseCredor } from './creditos.ts';
import { NOME_DA_CLASSE } from './creditos.ts';

export type Voto = 'sim' | 'nao' | 'abstencao';

/**
 * Um voto na assembleia. `credor` identifica a cabeça; `valor` é o valor com
 * que essa parcela vota na classe (já desdobrado pelo art. 41, § 2º).
 */
export interface VotoLancado {
  readonly credor: string;
  readonly classe: ClasseCredor;
  readonly valor: Centavos;
  readonly voto: Voto;
}

/**
 * Classes I e IV deliberam só por cabeça (art. 45, § 2º).
 * Classes II e III deliberam cumulativamente por valor e por cabeça (art. 45, § 1º).
 */
export function criterioDaClasse(classe: ClasseCredor): 'cabeca' | 'cumulativo' {
  return classe === 'I' || classe === 'IV' ? 'cabeca' : 'cumulativo';
}

export interface ApuracaoDeClasse {
  readonly classe: ClasseCredor;
  readonly nome: string;
  readonly criterio: 'cabeca' | 'cumulativo';
  readonly presentes: { readonly credores: number; readonly valor: Centavos };
  readonly sim: { readonly credores: number; readonly valor: Centavos };
  readonly nao: { readonly credores: number; readonly valor: Centavos };
  readonly abstencoes: number;
  /** Aprovada por cabeça: mais da metade dos credores presentes. */
  readonly aprovadaPorCabeca: boolean;
  /** Aprovada por valor: mais da metade do valor presente. `null` nas classes I e IV. */
  readonly aprovadaPorValor: boolean | null;
  readonly aprovada: boolean;
  /** Proporção de credores favoráveis — usada no art. 58, § 1º, III. */
  readonly proporcaoSimPorCabeca: number;
  readonly fundamento: string;
}

/**
 * Abstenção conta como presente, mas não como voto favorável.
 *
 * O art. 45 exige "maioria simples dos credores presentes" — a base de cálculo
 * é a presença, não os votos válidos. Quem se abstém, portanto, empurra a
 * deliberação contra a aprovação. É o entendimento corrente e é o que está
 * implementado aqui; se o caso exigir tese diversa, o dado bruto dos votos
 * continua disponível para recontagem.
 */
export function apurarClasse(
  classe: ClasseCredor,
  votos: readonly VotoLancado[],
): ApuracaoDeClasse {
  const daClasse = votos.filter((v) => v.classe === classe);

  // Contagem por cabeça: credores DISTINTOS. O mesmo credor com dois créditos
  // na classe é uma cabeça só.
  const cabecas = new Map<string, Voto>();
  for (const v of daClasse) {
    const anterior = cabecas.get(v.credor);
    // Se o mesmo credor lançou votos divergentes na mesma classe, o caso é
    // anômalo e precisa de decisão humana; aqui o "não" prevalece para não
    // produzir uma aprovação que ninguém conferiu.
    if (anterior === undefined || anterior === 'abstencao' || v.voto === 'nao') {
      cabecas.set(v.credor, anterior === 'nao' ? 'nao' : v.voto);
    }
  }

  let valorPresente = 0n;
  let valorSim = 0n;
  let valorNao = 0n;
  for (const v of daClasse) {
    valorPresente += v.valor;
    if (v.voto === 'sim') valorSim += v.valor;
    else if (v.voto === 'nao') valorNao += v.valor;
  }

  const totalCabecas = cabecas.size;
  let cabecasSim = 0;
  let cabecasNao = 0;
  let abstencoes = 0;
  for (const voto of cabecas.values()) {
    if (voto === 'sim') cabecasSim++;
    else if (voto === 'nao') cabecasNao++;
    else abstencoes++;
  }

  const criterio = criterioDaClasse(classe);
  // "Mais da metade": estritamente maior, sem empate. Em inteiros, 2*sim > total.
  const aprovadaPorCabeca = totalCabecas > 0 && cabecasSim * 2 > totalCabecas;
  const aprovadaPorValor =
    criterio === 'cabeca' ? null : valorPresente > 0n && valorSim * 2n > valorPresente;

  const aprovada =
    criterio === 'cabeca' ? aprovadaPorCabeca : aprovadaPorCabeca && aprovadaPorValor === true;

  return {
    classe,
    nome: NOME_DA_CLASSE[classe],
    criterio,
    presentes: { credores: totalCabecas, valor: valorPresente },
    sim: { credores: cabecasSim, valor: valorSim },
    nao: { credores: cabecasNao, valor: valorNao },
    abstencoes,
    aprovadaPorCabeca,
    aprovadaPorValor,
    aprovada,
    proporcaoSimPorCabeca: totalCabecas === 0 ? 0 : cabecasSim / totalCabecas,
    fundamento:
      criterio === 'cabeca'
        ? 'Art. 45, § 2º — maioria simples dos credores presentes.'
        : 'Art. 45, § 1º — maioria do valor dos créditos presentes E maioria simples dos credores presentes.',
  };
}

export interface ResultadoCramDown {
  readonly cabivel: boolean;
  /** I — mais da metade do valor de TODOS os créditos presentes, sem distinção de classe. */
  readonly incisoI: { readonly atendido: boolean; readonly valorSim: Centavos; readonly valorPresente: Centavos };
  /** II — aprovação de 2 classes; ou de 1 delas, se só houver 2 classes votantes. */
  readonly incisoII: { readonly atendido: boolean; readonly classesAprovadas: number; readonly classesVotantes: number; readonly exigidas: number };
  /** III — na classe que rejeitou, voto favorável de mais de 1/3 dos credores. */
  readonly incisoIII: { readonly atendido: boolean; readonly classesRejeitantes: readonly { classe: ClasseCredor; proporcao: number; atendido: boolean }[] };
  readonly ressalvas: readonly string[];
}

export interface ApuracaoDaAssembleia {
  readonly classes: readonly ApuracaoDeClasse[];
  /** Aprovado na forma do art. 45 (todas as classes votantes aprovaram). */
  readonly aprovadoPeloArt45: boolean;
  readonly cramDown: ResultadoCramDown;
  /** O plano pode ser concedido: por aprovação do art. 45 ou por cram down. */
  readonly concessaoPossivel: boolean;
  readonly ressalvas: readonly string[];
}

/**
 * Apura a assembleia inteira: por classe, pelo art. 45 e pelo art. 58, § 1º
 * (cram down).
 *
 * O resultado diz se a concessão é *possível* pela contagem — nunca que ela é
 * devida. O art. 58, § 2º veda o cram down se houver tratamento diferenciado
 * entre os credores da classe que rejeitou, e isso é juízo de valor sobre o
 * texto do plano, não aritmética. Sai como ressalva.
 */
export function apurarAssembleia(votos: readonly VotoLancado[]): ApuracaoDaAssembleia {
  const presentes = new Set(votos.map((v) => v.classe));
  const ordem: ClasseCredor[] = ['I', 'II', 'III', 'IV'];
  const classes = ordem.filter((c) => presentes.has(c)).map((c) => apurarClasse(c, votos));

  const aprovadoPeloArt45 = classes.length > 0 && classes.every((c) => c.aprovada);

  // Art. 58, § 1º, I — valor, somando todas as classes.
  let valorPresente = 0n;
  let valorSim = 0n;
  for (const v of votos) {
    valorPresente += v.valor;
    if (v.voto === 'sim') valorSim += v.valor;
  }
  const incisoI = {
    atendido: valorPresente > 0n && valorSim * 2n > valorPresente,
    valorSim,
    valorPresente,
  };

  // Art. 58, § 1º, II — duas classes; ou uma, se só houver duas votantes.
  const classesVotantes = classes.length;
  const classesAprovadas = classes.filter((c) => c.aprovada).length;
  const exigidas = classesVotantes <= 2 ? 1 : 2;
  const incisoII = {
    atendido: classesVotantes > 0 && classesAprovadas >= exigidas,
    classesAprovadas,
    classesVotantes,
    exigidas,
  };

  // Art. 58, § 1º, III — mais de 1/3 dos credores na classe que rejeitou.
  const rejeitantes = classes.filter((c) => !c.aprovada);
  const classesRejeitantes = rejeitantes.map((c) => ({
    classe: c.classe,
    proporcao: c.proporcaoSimPorCabeca,
    // "mais de 1/3": estritamente maior. Em inteiros, 3*sim > total.
    atendido: c.sim.credores * 3 > c.presentes.credores,
  }));
  const incisoIII = {
    atendido: classesRejeitantes.every((r) => r.atendido),
    classesRejeitantes,
  };

  const cabivel =
    !aprovadoPeloArt45 && incisoI.atendido && incisoII.atendido && incisoIII.atendido;

  const ressalvasCramDown: string[] = [];
  if (cabivel) {
    ressalvasCramDown.push(
      'Art. 58, § 2º — a concessão pelo § 1º exige que o plano NÃO dê tratamento diferenciado ' +
        'entre os credores da classe que o rejeitou. Essa verificação é de mérito e não foi feita aqui.',
    );
  }

  const ressalvas: string[] = [
    'A apuração pressupõe que o direito a voto já foi conferido (art. 39) e que créditos não ' +
      'sujeitos foram excluídos (art. 45, § 3º).',
    'Abstenções contam como presentes e não como voto favorável.',
  ];

  return {
    classes,
    aprovadoPeloArt45,
    cramDown: { cabivel, incisoI, incisoII, incisoIII, ressalvas: ressalvasCramDown },
    concessaoPossivel: aprovadoPeloArt45 || cabivel,
    ressalvas,
  };
}
