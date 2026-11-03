/**
 * Classificação de créditos na recuperação judicial — Lei 11.101/2005 (LREF),
 * com as alterações da Lei 14.112/2020.
 *
 * REGRA DE OURO DESTE MÓDULO
 * As funções aqui produzem *enquadramento sugerido* com fundamento legal
 * explícito e sempre exigem validação humana. A sujeição concursal depende de
 * fatos que não estão no dado estruturado (teor do contrato, essencialidade do
 * bem, data real do fato gerador) e de decisão judicial. Nenhuma saída deste
 * módulo deve ser tratada como definitiva sem revisão de advogado.
 *
 * O que é determinístico — e portanto confiável — é a *aritmética*: o
 * desdobramento do art. 41, § 2º e os totais por classe.
 */
import type { Centavos } from '../shared/dinheiro.ts';
import { somar } from '../shared/dinheiro.ts';

/** Classes de credores na AGC (art. 41). */
export type ClasseCredor = 'I' | 'II' | 'III' | 'IV';

export const NOME_DA_CLASSE: Readonly<Record<ClasseCredor, string>> = Object.freeze({
  I: 'Trabalhista e acidente de trabalho',
  II: 'Garantia real',
  III: 'Quirografário, privilégio especial, privilégio geral e subordinado',
  IV: 'Microempresa e empresa de pequeno porte',
});

/**
 * Natureza do crédito. É o dado que o advogado valida; a classe é derivada.
 */
export type NaturezaCredito =
  | 'trabalhista'
  | 'acidente_trabalho'
  | 'garantia_real'
  | 'quirografario'
  | 'privilegio_especial'
  | 'privilegio_geral'
  | 'subordinado'
  | 'me_epp'
  // Naturezas que, como regra, NÃO se sujeitam à recuperação:
  | 'tributario'
  | 'proprietario_fiduciario'
  | 'arrendamento_mercantil'
  | 'reserva_dominio'
  | 'promitente_vendedor_irrevogavel'
  | 'adiantamento_contrato_cambio'
  | 'posterior_ao_pedido';

export interface Credito {
  readonly id: string;
  readonly credor: string;
  /** Valor total do crédito na data do pedido. */
  readonly valor: Centavos;
  readonly natureza: NaturezaCredito;
  /**
   * Valor do bem gravado, quando a natureza é `garantia_real`.
   * Rege o desdobramento do art. 41, § 2º.
   */
  readonly valorBemGravado?: Centavos;
  /** O credor optou/foi enquadrado como ME/EPP (art. 41, IV). */
  readonly meEpp?: boolean;
  /** Marcação de que um advogado já conferiu o enquadramento. */
  readonly validadoPor?: string;
  readonly validadoEm?: string;
}

export interface Enquadramento {
  readonly creditoId: string;
  /** Sujeito aos efeitos da recuperação (art. 49). `null` = indeterminável aqui. */
  readonly sujeito: boolean | null;
  /** Classe de votação. `null` quando o crédito não vota. */
  readonly classe: ClasseCredor | null;
  /** Fundamentos legais, para auditoria e para a peça. */
  readonly fundamentos: readonly string[];
  /** Pontos que o advogado precisa verificar antes de confiar no enquadramento. */
  readonly ressalvas: readonly string[];
  /** Sempre verdadeiro: este módulo nunca decide sozinho. */
  readonly exigeValidacaoHumana: true;
}

/** Naturezas que, como regra geral, não se sujeitam à recuperação judicial. */
const NAO_SUJEITOS: Readonly<Record<string, { fundamento: string; ressalva: string }>> =
  Object.freeze({
    proprietario_fiduciario: {
      fundamento: 'Art. 49, § 3º, da Lei 11.101/2005 — proprietário fiduciário.',
      ressalva:
        'Depende do teor e do registro do contrato. Bens de capital essenciais não podem ser ' +
        'retirados do estabelecimento durante o stay period (art. 49, § 3º, parte final).',
    },
    arrendamento_mercantil: {
      fundamento: 'Art. 49, § 3º, da Lei 11.101/2005 — arrendador mercantil.',
      ressalva: 'Verificar se o contrato é efetivamente de arrendamento mercantil e sua essencialidade.',
    },
    reserva_dominio: {
      fundamento: 'Art. 49, § 3º, da Lei 11.101/2005 — venda com reserva de domínio.',
      ressalva: 'Depende de cláusula expressa de reserva de domínio no contrato.',
    },
    promitente_vendedor_irrevogavel: {
      fundamento:
        'Art. 49, § 3º, da Lei 11.101/2005 — promitente vendedor de imóvel com cláusula de ' +
        'irrevogabilidade ou irretratabilidade.',
      ressalva: 'Depende de cláusula expressa de irrevogabilidade/irretratabilidade.',
    },
    adiantamento_contrato_cambio: {
      fundamento: 'Art. 49, § 4º, c/c art. 86, II, da Lei 11.101/2005 — ACC.',
      ressalva: 'Confirmar o enquadramento como adiantamento a contrato de câmbio.',
    },
    tributario: {
      fundamento:
        'Art. 187 do CTN e art. 6º, § 7º-B, da Lei 11.101/2005 — crédito tributário não se ' +
        'sujeita à recuperação e a execução fiscal não se suspende.',
      ressalva:
        'A execução fiscal prossegue, mas o juízo da recuperação pode determinar a substituição ' +
        'de atos de constrição sobre bens essenciais (art. 6º, § 7º-B).',
    },
    posterior_ao_pedido: {
      fundamento:
        'Art. 49, caput, da Lei 11.101/2005 — sujeitam-se apenas os créditos existentes na data ' +
        'do pedido. Crédito posterior é extraconcursal.',
      ressalva:
        'Confirmar a data do fato gerador, não a do vencimento ou a da emissão da nota. ' +
        'Fornecedor que seguiu provendo após o pedido pode ter privilégio do art. 67.',
    },
  });

/**
 * Sugere o enquadramento de um crédito.
 *
 * Determinístico sobre a natureza informada — não adivinha a natureza a partir
 * de texto. A leitura de documentos é trabalho de outra camada, que alimenta
 * `natureza` e passa por conferência humana antes de chegar aqui.
 */
export function enquadrar(credito: Credito): Enquadramento {
  const base = { creditoId: credito.id, exigeValidacaoHumana: true as const };

  const naoSujeito = NAO_SUJEITOS[credito.natureza];
  if (naoSujeito) {
    return {
      ...base,
      sujeito: false,
      classe: null,
      fundamentos: [naoSujeito.fundamento, 'Art. 45, § 3º — sem direito a voto na AGC.'],
      ressalvas: [naoSujeito.ressalva],
    };
  }

  const ressalvas: string[] = [];
  const fundamentos: string[] = ['Art. 49, caput — crédito existente na data do pedido.'];

  // ME/EPP tem classe própria e prevalece sobre o enquadramento quirografário
  // genérico, mas não sobre trabalhista nem sobre garantia real.
  const ehTrabalhista =
    credito.natureza === 'trabalhista' || credito.natureza === 'acidente_trabalho';

  if (ehTrabalhista) {
    fundamentos.push('Art. 41, I — crédito trabalhista ou de acidente de trabalho.');
    fundamentos.push('Art. 41, § 1º — vota com o total do crédito, independentemente do valor.');
    ressalvas.push(
      'O limite de 150 salários mínimos do art. 83, I, é regra de classificação na FALÊNCIA; ' +
        'não reduz o valor de voto na AGC da recuperação.',
    );
    if (credito.meEpp) {
      ressalvas.push('Credor marcado como ME/EPP, mas o crédito trabalhista prevalece na classe I.');
    }
    return { ...base, sujeito: true, classe: 'I', fundamentos, ressalvas };
  }

  if (credito.natureza === 'garantia_real') {
    fundamentos.push('Art. 41, II — crédito com garantia real.');
    fundamentos.push(
      'Art. 41, § 2º — vota na classe II até o limite do bem gravado e na classe III pelo restante.',
    );
    if (credito.valorBemGravado === undefined) {
      ressalvas.push(
        'Valor do bem gravado não informado: o desdobramento do art. 41, § 2º não pôde ser ' +
          'calculado. Exige avaliação do bem.',
      );
    } else if (credito.valorBemGravado < credito.valor) {
      ressalvas.push(
        'Garantia insuficiente: parte do crédito vota como quirografário (classe III).',
      );
    }
    ressalvas.push('Confirmar a existência, o registro e a avaliação da garantia.');
    return { ...base, sujeito: true, classe: 'II', fundamentos, ressalvas };
  }

  if (credito.meEpp || credito.natureza === 'me_epp') {
    fundamentos.push('Art. 41, IV — credor enquadrado como microempresa ou empresa de pequeno porte.');
    ressalvas.push('Confirmar o enquadramento da ME/EPP na data do pedido.');
    return { ...base, sujeito: true, classe: 'IV', fundamentos, ressalvas };
  }

  fundamentos.push(
    'Art. 41, III — quirografário, com privilégio especial, com privilégio geral ou subordinado.',
  );
  if (credito.natureza === 'subordinado') {
    ressalvas.push(
      'Crédito subordinado vota na classe III, mas recebe por último no concurso (art. 83, VIII).',
    );
  }
  return { ...base, sujeito: true, classe: 'III', fundamentos, ressalvas };
}

/** Uma parcela de crédito atribuída a uma classe, para fins de votação. */
export interface ParcelaDeVoto {
  readonly creditoId: string;
  readonly credor: string;
  readonly classe: ClasseCredor;
  readonly valor: Centavos;
  /** Verdadeiro quando esta parcela nasceu do desdobramento do art. 41, § 2º. */
  readonly desdobrada: boolean;
}

/**
 * Desdobra um crédito nas parcelas com que ele efetivamente vota.
 *
 * Só o crédito com garantia real se desdobra (art. 41, § 2º): vai para a classe
 * II até o limite do bem gravado e para a classe III pelo excedente. Um crédito
 * de R$ 1.000.000,00 garantido por bem de R$ 600.000,00 vota R$ 600.000,00 na
 * classe II e R$ 400.000,00 na classe III — e conta como UM credor em cada uma
 * delas na contagem por cabeça.
 *
 * Crédito não sujeito devolve lista vazia: não vota (art. 45, § 3º).
 */
export function desdobrarParaVotacao(credito: Credito): ParcelaDeVoto[] {
  const enquadramento = enquadrar(credito);
  if (enquadramento.sujeito !== true || enquadramento.classe === null) return [];

  const comum = { creditoId: credito.id, credor: credito.credor };

  if (enquadramento.classe !== 'II') {
    return [{ ...comum, classe: enquadramento.classe, valor: credito.valor, desdobrada: false }];
  }

  const bem = credito.valorBemGravado;
  // Sem avaliação do bem não há como desdobrar; vota integralmente na classe II
  // e a ressalva do enquadramento sinaliza a pendência.
  if (bem === undefined) {
    return [{ ...comum, classe: 'II', valor: credito.valor, desdobrada: false }];
  }

  const naClasseII = bem < credito.valor ? bem : credito.valor;
  const excedente = credito.valor - naClasseII;

  const parcelas: ParcelaDeVoto[] = [
    { ...comum, classe: 'II', valor: naClasseII, desdobrada: excedente > 0n },
  ];
  if (excedente > 0n) {
    parcelas.push({ ...comum, classe: 'III', valor: excedente, desdobrada: true });
  }
  return parcelas;
}

export interface TotaisPorClasse {
  readonly classe: ClasseCredor;
  readonly valor: Centavos;
  /** Número de credores distintos na classe (contagem por cabeça). */
  readonly credores: number;
}

/**
 * Consolida o quadro de credores por classe.
 *
 * A contagem por cabeça é de credores DISTINTOS: o mesmo credor com dois
 * créditos na mesma classe é uma cabeça só (art. 45, §§ 1º e 2º — "maioria
 * simples dos credores presentes"). O desdobramento do art. 41, § 2º pode
 * fazer o mesmo credor contar uma cabeça na classe II e outra na III.
 */
export function consolidarPorClasse(creditos: readonly Credito[]): TotaisPorClasse[] {
  const porClasse = new Map<ClasseCredor, { valores: Centavos[]; credores: Set<string> }>();

  for (const credito of creditos) {
    for (const parcela of desdobrarParaVotacao(credito)) {
      let acc = porClasse.get(parcela.classe);
      if (!acc) {
        acc = { valores: [], credores: new Set() };
        porClasse.set(parcela.classe, acc);
      }
      acc.valores.push(parcela.valor);
      acc.credores.add(parcela.credor);
    }
  }

  const ordem: ClasseCredor[] = ['I', 'II', 'III', 'IV'];
  return ordem
    .filter((c) => porClasse.has(c))
    .map((classe) => {
      const acc = porClasse.get(classe)!;
      return { classe, valor: somar(acc.valores), credores: acc.credores.size };
    });
}
