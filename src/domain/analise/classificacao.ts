/**
 * Classificação de documento por sinais, sem modelo de linguagem.
 *
 * Classificar "petição inicial de RJ" ou "ata de AGC" é reconhecimento de
 * forma, e forma de peça jurídica brasileira é padronizada. Não precisa de
 * inferência probabilística: precisa de leitura dos sinais que a própria peça
 * ostenta — e, ao contrário do modelo, o sinal pode ser mostrado ao advogado.
 *
 * DUAS DECISÕES DE PROJETO, as duas deliberadas:
 *
 * 1. NÃO EXISTE PROBABILIDADE AQUI. Devolver "87 % de confiança" seria inventar
 *    precisão que não se tem — não há corpus anotado, não há calibração. O que
 *    se devolve é `certeza` qualitativa com o critério explícito, mais a lista
 *    dos sinais encontrados e onde. O advogado confere o motivo, não o número.
 *
 * 2. NA DÚVIDA, 'desconhecido'. Errar o tipo do documento contamina tudo a
 *    jusante: o checklist marca o item errado, a extração busca campo que não
 *    existe. Documento sem sinal suficiente volta sem tipo, e isso é resultado
 *    correto, não falha.
 */
import { normalizar } from './texto.ts';

export type TipoDeDocumento =
  | 'peticao_inicial_rj'
  | 'plano_recuperacao'
  | 'plano_modificativo'
  | 'relacao_credores'
  | 'edital'
  | 'ata_agc'
  | 'decisao_judicial'
  | 'sentenca'
  | 'laudo_constatacao_previa'
  | 'relatorio_mensal_atividades'
  | 'habilitacao_credito'
  | 'impugnacao_credito'
  | 'objecao_plano'
  | 'contrato'
  | 'nota_fiscal'
  | 'certidao'
  | 'demonstracao_contabil'
  | 'procuracao'
  | 'desconhecido';

export type Certeza = 'alta' | 'media' | 'baixa' | 'nenhuma';

export interface SinalEncontrado {
  readonly termo: string;
  readonly peso: number;
  /** Posição no texto normalizado. Serve para o advogado ir conferir. */
  readonly posicao: number;
}

export interface Candidato {
  readonly tipo: TipoDeDocumento;
  readonly pontos: number;
  readonly sinais: readonly SinalEncontrado[];
}

export interface Classificacao {
  readonly tipo: TipoDeDocumento;
  readonly certeza: Certeza;
  readonly pontos: number;
  readonly sinais: readonly SinalEncontrado[];
  /** Os outros tipos que pontuaram, para o caso de o primeiro estar errado. */
  readonly alternativas: readonly Candidato[];
  /** Por que esta certeza, em uma frase. */
  readonly criterio: string;
  /** Sempre verdadeiro: classificação é sugestão (§7.7). */
  readonly exigeValidacaoHumana: true;
}

/**
 * Sinal é termo já normalizado (minúsculo, sem acento). O peso reflete quanto
 * o termo é EXCLUSIVO do tipo: "decreto a falencia" vale muito porque não
 * aparece em outra peça; "clausula" vale pouco porque aparece em qualquer uma.
 */
const SINAIS: Readonly<Record<Exclude<TipoDeDocumento, 'desconhecido'>, ReadonlyArray<readonly [string, number]>>> =
  Object.freeze({
    peticao_inicial_rj: [
      ['requer a recuperacao judicial', 5],
      ['requerer a recuperacao judicial', 5],
      ['requerem a recuperacao judicial', 5],
      ['pedido de recuperacao judicial', 4],
      ['processamento da recuperacao judicial', 4],
      ['exposicao das causas concretas', 4],
      ['art. 51', 3], ['artigo 51', 3],
      ['demonstracoes contabeis dos 3', 2],
      ['excelentissimo senhor doutor juiz', 2],
      ['crise economico-financeira', 2],
      ['viabilidade economica', 1],
    ],
    plano_recuperacao: [
      ['plano de recuperacao judicial', 5],
      ['meios de recuperacao', 3],
      ['forma de pagamento dos credores', 3],
      ['novacao', 3],
      ['desagio', 3],
      ['carencia', 2],
      ['classe i', 2], ['classe iii', 2],
      ['credores quirografarios', 2],
      ['art. 50', 2],
    ],
    plano_modificativo: [
      ['plano modificativo', 6],
      ['aditivo ao plano', 5],
      ['modificacao do plano de recuperacao', 5],
      ['primeira modificacao do plano', 4],
      ['art. 56', 2],
    ],
    relacao_credores: [
      ['quadro geral de credores', 6],
      ['relacao de credores', 5],
      ['relacao nominal dos credores', 5],
      ['art. 7, 2', 4],
      ['consolidacao do quadro geral', 4],
      ['classificacao dos creditos', 2],
      ['valor atualizado do credito', 2],
    ],
    edital: [
      ['faco saber', 5],
      ['edital', 4],
      ['ficam os credores intimados', 4],
      ['ficam intimados', 3],
      ['art. 7, 1', 3],
      ['prazo de 15 (quinze) dias', 2],
      ['para apresentar habilitacao ou divergencia', 4],
    ],
    ata_agc: [
      ['ata da assembleia geral de credores', 6],
      ['assembleia geral de credores', 4],
      ['primeira convocacao', 3], ['segunda convocacao', 3],
      ['lista de presenca', 3],
      ['resultado da votacao', 3],
      ['quorum', 2],
      ['presidida pelo administrador judicial', 3],
      ['encerrada a assembleia', 3],
    ],
    decisao_judicial: [
      ['defiro o processamento', 5],
      ['publique-se, registre-se, intime-se', 4],
      ['isso posto', 3], ['isto posto', 3],
      ['decido', 3],
      ['intime-se', 2],
      ['vistos', 2],
      ['defiro', 2],
    ],
    sentenca: [
      ['decreto a falencia', 8],
      ['homologo o plano de recuperacao', 8],
      ['julgo procedente', 4], ['julgo improcedente', 4],
      ['sentenca', 3],
      ['extingo o processo', 3],
      ['concedo a recuperacao judicial', 8],
      ['art. 58', 2], ['art. 63', 2],
    ],
    laudo_constatacao_previa: [
      ['constatacao previa', 6],
      ['art. 51-a', 5],
      ['laudo de constatacao', 5],
      ['perito nomeado', 3],
      ['regular funcionamento', 2],
    ],
    relatorio_mensal_atividades: [
      ['relatorio mensal de atividades', 6],
      ['rma', 3],
      ['art. 22, ii, c', 4],
      ['administrador judicial', 2],
      ['competencia do mes', 2],
      ['faturamento do periodo', 2],
    ],
    habilitacao_credito: [
      ['habilitacao de credito', 6],
      ['requer a habilitacao', 5],
      ['divergencia de credito', 5],
      ['art. 7, 1', 2],
      ['credito nao arrolado', 3],
    ],
    impugnacao_credito: [
      ['impugnacao de credito', 6],
      ['impugna o credito', 5],
      ['art. 8', 4],
      ['exclusao do credito', 3],
    ],
    objecao_plano: [
      ['objecao ao plano', 6],
      ['objeta o plano', 5],
      ['art. 55', 4],
      ['clausula ilegal', 3],
      ['desagio abusivo', 3],
    ],
    contrato: [
      ['pelo presente instrumento', 4],
      ['clausula primeira', 4],
      ['contratante', 2], ['contratada', 2],
      ['as partes elegem o foro', 3],
      ['em duas vias de igual teor', 3],
      ['testemunhas', 1],
    ],
    nota_fiscal: [
      ['danfe', 6],
      ['documento auxiliar da nota fiscal', 6],
      ['chave de acesso', 4],
      ['natureza da operacao', 4],
      ['nota fiscal', 3],
      ['base de calculo do icms', 3],
    ],
    certidao: [
      ['certidao negativa', 6],
      ['certifico', 4],
      ['nada consta', 4],
      ['certidao', 2],
      ['validade desta certidao', 3],
    ],
    demonstracao_contabil: [
      ['balanco patrimonial', 6],
      ['demonstracao do resultado do exercicio', 6],
      ['ativo circulante', 3], ['passivo circulante', 3],
      ['patrimonio liquido', 3],
      ['notas explicativas', 2],
    ],
    procuracao: [
      ['ad judicia', 5],
      ['procuracao', 4],
      ['outorga', 3],
      ['substabelecer', 3],
      ['com os poderes da clausula', 3],
    ],
  });

/**
 * Busca o termo respeitando fronteira numérica: sem isto, o sinal "art. 8"
 * casaria dentro de "art. 83" — e art. 83 é a ordem da falência, não a
 * impugnação de crédito do art. 8º. Devolve -1 se não houver ocorrência
 * legítima.
 */
function encontrar(alvo: string, termo: string): number {
  const terminaEmDigito = /\d$/.test(termo);
  let de = 0;
  for (;;) {
    const i = alvo.indexOf(termo, de);
    if (i === -1) return -1;
    if (!terminaEmDigito || !/\d/.test(alvo[i + termo.length] ?? '')) return i;
    de = i + 1;
  }
}

/** Abaixo disto o documento volta como 'desconhecido'. */
const MINIMO = 5;

export function classificar(texto: string): Classificacao {
  const alvo = normalizar(texto);

  const candidatos: Candidato[] = [];
  for (const [tipo, sinais] of Object.entries(SINAIS)) {
    const encontrados: SinalEncontrado[] = [];
    for (const [termo, peso] of sinais) {
      const posicao = encontrar(alvo, termo);
      if (posicao === -1) continue;
      // Conta uma vez por sinal distinto: repetir "desagio" trinta vezes num
      // plano não torna o documento mais plano do que ele já é.
      encontrados.push({ termo, peso, posicao });
    }
    // Sinal CONTIDO em outro sinal do mesmo tipo não soma: "assembleia geral
    // de credores" está dentro de "ata da assembleia geral de credores", e
    // contar os dois infla a pontuação de quem tem a lista mais redundante.
    const proprios = encontrados.filter(
      (s) => !encontrados.some((o) => o !== s && o.termo.includes(s.termo)));
    const pontosProprios = proprios.reduce((t, s) => t + s.peso, 0);

    if (pontosProprios > 0) {
      candidatos.push({
        tipo: tipo as Exclude<TipoDeDocumento, 'desconhecido'>,
        pontos: pontosProprios,
        sinais: proprios,
      });
    }
  }

  candidatos.sort((a, b) => b.pontos - a.pontos || a.tipo.localeCompare(b.tipo));
  const primeiro = candidatos[0];
  const segundo = candidatos[1];

  if (!primeiro || primeiro.pontos < MINIMO) {
    return {
      tipo: 'desconhecido',
      certeza: 'nenhuma',
      pontos: primeiro?.pontos ?? 0,
      sinais: primeiro?.sinais ?? [],
      alternativas: candidatos,
      criterio: `nenhum tipo alcançou os ${MINIMO} pontos mínimos: o documento volta sem classificação`,
      exigeValidacaoHumana: true,
    };
  }

  const margem = primeiro.pontos - (segundo?.pontos ?? 0);
  let certeza: Certeza;
  let criterio: string;
  if (primeiro.pontos >= 10 && primeiro.pontos >= (segundo?.pontos ?? 0) * 2) {
    certeza = 'alta';
    criterio = `${primeiro.pontos} pontos, o dobro ou mais do segundo colocado`;
  } else if (primeiro.pontos >= 8 && margem >= 3) {
    certeza = 'media';
    criterio = `${primeiro.pontos} pontos, ${margem} à frente do segundo colocado`;
  } else {
    certeza = 'baixa';
    criterio = segundo
      ? `${primeiro.pontos} pontos contra ${segundo.pontos} de "${segundo.tipo}": sinais disputados`
      : `${primeiro.pontos} pontos, pouco acima do mínimo`;
  }

  return {
    tipo: primeiro.tipo,
    certeza,
    pontos: primeiro.pontos,
    sinais: primeiro.sinais,
    alternativas: candidatos.slice(1, 4),
    criterio,
    exigeValidacaoHumana: true,
  };
}

export const ROTULO_DO_TIPO: Readonly<Record<TipoDeDocumento, string>> = Object.freeze({
  peticao_inicial_rj: 'Petição inicial de recuperação judicial',
  plano_recuperacao: 'Plano de recuperação judicial',
  plano_modificativo: 'Plano modificativo',
  relacao_credores: 'Relação / quadro geral de credores',
  edital: 'Edital',
  ata_agc: 'Ata de assembleia geral de credores',
  decisao_judicial: 'Decisão judicial',
  sentenca: 'Sentença',
  laudo_constatacao_previa: 'Laudo de constatação prévia',
  relatorio_mensal_atividades: 'Relatório mensal de atividades',
  habilitacao_credito: 'Habilitação ou divergência de crédito',
  impugnacao_credito: 'Impugnação de crédito',
  objecao_plano: 'Objeção ao plano',
  contrato: 'Contrato',
  nota_fiscal: 'Nota fiscal',
  certidao: 'Certidão',
  demonstracao_contabil: 'Demonstração contábil',
  procuracao: 'Procuração',
  desconhecido: 'Não classificado',
});
