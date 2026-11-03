/**
 * Contagem de prazo processual. Determinística, com o caminho inteiro à vista.
 *
 * O §7.3 e o §9 do briefing mandam usar regra determinística em vez de modelo
 * de linguagem sempre que possível. Prazo é o caso extremo disso: errar por um
 * dia perde o direito do cliente, e nenhuma resposta "provavelmente dia 12"
 * tem valor aqui.
 *
 * AS TRÊS REGRAS QUE A MÁQUINA APLICA, e que são a fonte da maior parte dos
 * erros humanos:
 *
 *   1. ART. 224, § 2º — publicar não é disponibilizar. O que sai no Diário
 *      eletrônico num dia considera-se publicado no PRIMEIRO DIA ÚTIL
 *      SEGUINTE. Quem conta a partir da disponibilização perde um dia.
 *   2. ART. 224, CAPUT E § 3º — exclui-se o dia do começo. A contagem só
 *      principia no primeiro dia útil seguinte ao da publicação. São, no caso
 *      do Diário, DOIS saltos, não um.
 *   3. ART. 219 — em dias úteis, e dia útil forense não é dia útil bancário:
 *      o recesso do art. 220 e as suspensões do tribunal também não contam.
 *
 * O RESULTADO NUNCA SAI COMO DEFINITIVO. `exigeConferencia` é sempre
 * verdadeiro, e as ressalvas dizem o que não foi considerado — feriado da
 * comarca e portaria do tribunal não estão integrados a esta plataforma. O
 * cálculo adianta o trabalho do advogado; não o substitui.
 */
import { type DataISO, comparar, somarDias } from '../shared/datas.ts';
import {
  type Calendario, type DiaNaoUtil, ehDiaUtilForense, porQueNaoCorre, proximoDiaUtil,
} from './feriados.ts';

export type OrigemDoPrazo =
  /** Saiu no Diário de Justiça eletrônico: a publicação é no dia útil seguinte. */
  | 'disponibilizacao_dje'
  /** Já é a data da publicação. */
  | 'publicacao'
  /** Intimação pessoal, por oficial ou por portal (art. 231). */
  | 'intimacao_pessoal'
  /** Juntada do aviso de recebimento aos autos (art. 231, I). */
  | 'juntada_ar'
  | 'citacao'
  | 'audiencia'
  /** Termo inicial fixado à mão; a contagem começa no dia útil seguinte. */
  | 'manual';

export type Regime = 'uteis' | 'corridos';

export interface PedidoDePrazo {
  /** Data do evento que dá origem ao prazo. */
  readonly evento: DataISO;
  readonly origem: OrigemDoPrazo;
  readonly dias: number;
  /** Padrão `uteis`: é a regra do art. 219 do CPC e do art. 189, § 1º, I, da LREF. */
  readonly regime?: Regime;
  /** Arts. 183, 186 e 229 do CPC. */
  readonly emDobro?: boolean;
  readonly motivoDoDobro?: string;
  readonly calendario?: Calendario;
}

export interface PrazoCalculado {
  readonly evento: DataISO;
  /** Depois da regra do art. 224, § 2º, quando a origem é o Diário. */
  readonly publicacao: DataISO;
  readonly primeiroDiaContado: DataISO;
  readonly vencimento: DataISO;
  /** Dias efetivamente contados, já com o dobro aplicado. */
  readonly dias: number;
  readonly regime: Regime;
  /** Cada dia pulado no caminho, com o motivo. É a auditoria da contagem. */
  readonly naoCorreram: readonly DiaNaoUtil[];
  readonly fundamentos: readonly string[];
  readonly ressalvas: readonly string[];
  /** Sempre verdadeiro. Ver o cabeçalho deste arquivo. */
  readonly exigeConferencia: true;
}

export class ErroDePrazo extends Error {
  override readonly name = 'ErroDePrazo';
}

const LIMITE_DE_DIAS = 3650;

const ROTULO_DA_ORIGEM: Readonly<Record<OrigemDoPrazo, string>> = Object.freeze({
  disponibilizacao_dje: 'disponibilização no Diário de Justiça eletrônico',
  publicacao: 'publicação',
  intimacao_pessoal: 'intimação pessoal',
  juntada_ar: 'juntada do aviso de recebimento',
  citacao: 'citação',
  audiencia: 'audiência',
  manual: 'termo inicial informado',
});

export function contarPrazo(pedido: PedidoDePrazo): PrazoCalculado {
  const regime = pedido.regime ?? 'uteis';
  const calendario = pedido.calendario ?? {};

  if (!Number.isInteger(pedido.dias) || pedido.dias < 1) {
    throw new ErroDePrazo(`prazo em dias precisa ser inteiro positivo: ${pedido.dias}`);
  }
  if (pedido.dias > LIMITE_DE_DIAS) {
    throw new ErroDePrazo(`prazo de ${pedido.dias} dias está fora de qualquer hipótese processual`);
  }

  const fundamentos: string[] = [];
  const naoCorreram: DiaNaoUtil[] = [];

  // --- 1. da disponibilização à publicação (art. 224, § 2º) ---
  let publicacao = pedido.evento;
  if (pedido.origem === 'disponibilizacao_dje') {
    publicacao = proximoDiaUtil(somarDias(pedido.evento, 1), calendario);
    fundamentos.push(
      'Art. 224, § 2º, do CPC: considera-se publicado no primeiro dia útil seguinte ' +
      'ao da disponibilização no Diário de Justiça eletrônico.');
  }

  // --- 2. o primeiro dia contado (art. 224, caput e § 3º) ---
  const primeiroDiaContado = proximoDiaUtil(somarDias(publicacao, 1), calendario);
  fundamentos.push(
    'Art. 224, caput, do CPC: exclui-se o dia do começo e inclui-se o do vencimento.');
  if (pedido.origem === 'disponibilizacao_dje' || pedido.origem === 'publicacao') {
    fundamentos.push(
      'Art. 224, § 3º, do CPC: a contagem tem início no primeiro dia útil seguinte ao da publicação.');
  } else {
    fundamentos.push(
      `Art. 231 do CPC: o prazo corre da ${ROTULO_DA_ORIGEM[pedido.origem]}.`);
  }

  // --- 3. o dobro, quando couber ---
  const dias = pedido.emDobro ? pedido.dias * 2 : pedido.dias;
  if (pedido.emDobro) {
    fundamentos.push(
      pedido.motivoDoDobro
        ? `Prazo em dobro: ${pedido.motivoDoDobro}.`
        : 'Prazo em dobro (arts. 183, 186 ou 229 do CPC, conforme o caso).');
  }

  // --- 4. a contagem ---
  let vencimento: DataISO;
  if (regime === 'uteis') {
    fundamentos.push('Art. 219 do CPC: computam-se somente os dias úteis.');
    let atual = primeiroDiaContado;
    let contados = 1;                 // o primeiro dia já é útil, por construção
    while (contados < dias) {
      atual = somarDias(atual, 1);
      const parado = porQueNaoCorre(atual, calendario);
      if (parado) naoCorreram.push(parado);
      else contados++;
    }
    vencimento = atual;
  } else {
    fundamentos.push('Prazo contado em dias corridos.');
    vencimento = somarDias(primeiroDiaContado, dias - 1);
  }

  // --- 5. prorrogação do vencimento (art. 224, § 1º) ---
  if (!ehDiaUtilForense(vencimento, calendario)) {
    const motivo = porQueNaoCorre(vencimento, calendario)!;
    naoCorreram.push(motivo);
    vencimento = proximoDiaUtil(vencimento, calendario);
    fundamentos.push(
      `Art. 224, § 1º, do CPC: o vencimento cairia em ${motivo.nome} e fica prorrogado ` +
      'para o primeiro dia útil seguinte.');
  }

  if (naoCorreram.some((d) => d.motivo === 'recesso_forense')) {
    fundamentos.push(
      'Art. 220 do CPC: o curso do prazo fica suspenso entre 20 de dezembro e 20 de janeiro.');
  }

  // --- 6. o que o sistema NÃO sabe ---
  const ressalvas: string[] = [];
  if (!calendario.feriadosLocais?.length) {
    ressalvas.push(
      'Feriados estaduais e municipais da comarca não foram considerados: o calendário ' +
      'local não está integrado a esta plataforma.');
  }
  if (!calendario.suspensoes?.length) {
    ressalvas.push(
      'Suspensões decretadas pelo tribunal (portaria, greve, indisponibilidade do sistema) ' +
      'não foram consideradas.');
  }
  ressalvas.push(
    'Expediente encerrado antes da hora normal equipara-se a dia sem expediente ' +
    '(art. 224, § 1º) e não é detectável automaticamente.');

  return {
    evento: pedido.evento,
    publicacao,
    primeiroDiaContado,
    vencimento,
    dias,
    regime,
    naoCorreram,
    fundamentos,
    ressalvas,
    exigeConferencia: true,
  };
}

/**
 * Quantos dias úteis forenses faltam até o vencimento, de `hoje` (exclusive)
 * até o vencimento (inclusive). Negativo quando já venceu.
 */
export function diasUteisAte(
  hoje: DataISO, vencimento: DataISO, calendario: Calendario = {},
): number {
  if (comparar(hoje, vencimento) > 0) {
    let atual = vencimento, passados = 0;
    while (comparar(atual, hoje) < 0) {
      atual = somarDias(atual, 1);
      if (ehDiaUtilForense(atual, calendario)) passados++;
    }
    return -passados;
  }
  let atual = hoje, faltam = 0;
  while (comparar(atual, vencimento) < 0) {
    atual = somarDias(atual, 1);
    if (ehDiaUtilForense(atual, calendario)) faltam++;
  }
  return faltam;
}

// ------------------------------------------------------- prazos usuais ---

export interface PrazoUsual {
  readonly id: string;
  readonly nome: string;
  readonly dias: number;
  readonly regime: Regime;
  readonly fundamento: string;
  readonly origemUsual: OrigemDoPrazo;
  /** Ponto em que há divergência e o advogado tem de decidir. */
  readonly observacao?: string;
}

/**
 * Prazos que a prática de insolvência da NGA usa todo dia.
 *
 * É catálogo de PARTIDA, não de chegada: cada um ainda passa pela contagem
 * acima e sai com ressalva. O que o catálogo evita é o erro de digitar "15"
 * onde a lei diz 10.
 */
export const PRAZOS_USUAIS: readonly PrazoUsual[] = Object.freeze([
  {
    id: 'habilitacao', nome: 'Habilitação ou divergência de crédito', dias: 15, regime: 'uteis',
    fundamento: 'art. 7º, § 1º, da Lei 11.101/2005', origemUsual: 'publicacao',
  },
  {
    id: 'impugnacao', nome: 'Impugnação à relação de credores', dias: 10, regime: 'uteis',
    fundamento: 'art. 8º da Lei 11.101/2005', origemUsual: 'publicacao',
  },
  {
    id: 'plano', nome: 'Apresentação do plano de recuperação judicial', dias: 60, regime: 'uteis',
    fundamento: 'art. 53 da Lei 11.101/2005', origemUsual: 'publicacao',
    observacao: 'Contado da publicação da decisão que deferir o processamento.',
  },
  {
    id: 'objecao', nome: 'Objeção ao plano', dias: 30, regime: 'uteis',
    fundamento: 'art. 55, parágrafo único, da Lei 11.101/2005', origemUsual: 'publicacao',
    observacao: 'Contado da publicação da relação de credores do art. 7º, § 2º.',
  },
  {
    id: 'contestacao', nome: 'Contestação', dias: 15, regime: 'uteis',
    fundamento: 'art. 335 do CPC', origemUsual: 'juntada_ar',
  },
  {
    id: 'recurso', nome: 'Apelação, agravo de instrumento e demais recursos', dias: 15, regime: 'uteis',
    fundamento: 'art. 1.003, § 5º, do CPC', origemUsual: 'disponibilizacao_dje',
  },
  {
    id: 'embargos', nome: 'Embargos de declaração', dias: 5, regime: 'uteis',
    fundamento: 'art. 1.023 do CPC', origemUsual: 'disponibilizacao_dje',
  },
  {
    id: 'stay', nome: 'Período de suspensão (stay period)', dias: 180, regime: 'corridos',
    fundamento: 'art. 6º, § 4º, da Lei 11.101/2005', origemUsual: 'publicacao',
    observacao:
      'Há divergência sobre o regime: o art. 189, § 1º, I, da LREF manda contar os prazos ' +
      'da lei em dias úteis, e parte da doutrina e da jurisprudência sustenta que o stay ' +
      'seguiria a mesma regra. O padrão aqui é dias corridos, que é a leitura majoritária — ' +
      'confira a orientação do juízo antes de usar a data.',
  },
]);

export function prazoUsual(id: string): PrazoUsual | undefined {
  return PRAZOS_USUAIS.find((p) => p.id === id);
}
