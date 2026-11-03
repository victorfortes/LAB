/**
 * Verificação de referência jurídica (§7.7 do briefing).
 *
 * "Não poderá inventar legislação, julgados ou precedentes. Deverá distinguir
 * legislação, jurisprudência, doutrina, interpretação e hipótese. Toda
 * referência jurídica deverá ser verificável."
 *
 * A única forma honesta de cumprir isso é ter um CORPUS FECHADO e recusar o
 * que não está nele. É o que este módulo faz: cada referência extraída de uma
 * análise recebe um dos três status —
 *
 *   verificada      o dispositivo existe no corpus e tem fonte oficial;
 *   nao_localizada  tem forma de citação, mas não está no corpus (suspeita de
 *                   alucinação: é esta que reprova a análise);
 *   nao_verificavel não há base integrada capaz de conferir (jurisprudência,
 *                   doutrina, lei fora do corpus) — e o impedimento é nomeado.
 *
 * SOBRE A EMENTA DO CORPUS: o campo `ementa` é RÓTULO INTERNO de navegação,
 * escrito pela NGA, e NÃO é texto legal. Jamais deve ser citado como se fosse
 * a lei. O que o corpus afirma é a EXISTÊNCIA do dispositivo e ONDE LER — a
 * `fonte` é a autoridade, e é para lá que a interface manda o advogado.
 *
 * SOBRE JURISPRUDÊNCIA: não existe base de julgados integrada nesta
 * plataforma. Nenhum julgado pode, portanto, ser marcado como verificado.
 * Dizer "verificada" sem ter conferido seria o que o §22 proíbe.
 */
import { normalizar } from './texto.ts';

export type Diploma =
  | 'lref'      // Lei 11.101/2005
  | 'ctn'       // Lei 5.172/1966
  | 'cc'        // Lei 10.406/2002
  | 'cpc'       // Lei 13.105/2015
  | 'clt'       // Decreto-Lei 5.452/1943
  | 'cf';       // Constituição de 1988

export type NaturezaDaReferencia =
  | 'legislacao' | 'jurisprudencia' | 'doutrina' | 'interpretacao' | 'hipotese';

export type StatusDaVerificacao = 'verificada' | 'nao_localizada' | 'nao_verificavel';

export interface Referencia {
  readonly natureza: NaturezaDaReferencia;
  /** Como aparece no texto analisado. */
  readonly bruto: string;
  readonly posicao: number;
  /** Chave canônica no corpus, ex.: "lref:41:2". Nulo quando não se resolveu. */
  readonly chave: string | null;
  readonly status: StatusDaVerificacao;
  /** Rótulo interno de navegação. NÃO é texto legal. */
  readonly ementa?: string;
  /** Onde conferir. É isto que vale, não a ementa. */
  readonly fonte?: string;
  /** Por que não foi verificada, quando for o caso. */
  readonly motivo?: string;
  /** O diploma foi deduzido do contexto, não escrito na citação. */
  readonly diplomaPresumido?: boolean;
}

export interface Dispositivo {
  readonly chave: string;
  readonly diploma: Diploma;
  readonly rotulo: string;
  /** Rótulo interno, não texto legal. */
  readonly ementa: string;
}

const NOMES: Readonly<Record<Diploma, { nome: string; fonte: string }>> = Object.freeze({
  lref: {
    nome: 'Lei 11.101/2005 (LREF), com as alterações da Lei 14.112/2020',
    fonte: 'https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2005/lei/l11101.htm',
  },
  ctn: {
    nome: 'Lei 5.172/1966 (Código Tributário Nacional)',
    fonte: 'https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm',
  },
  cc: {
    nome: 'Lei 10.406/2002 (Código Civil)',
    fonte: 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm',
  },
  cpc: {
    nome: 'Lei 13.105/2015 (Código de Processo Civil)',
    fonte: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm',
  },
  clt: {
    nome: 'Decreto-Lei 5.452/1943 (CLT)',
    fonte: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm',
  },
  cf: {
    nome: 'Constituição da República de 1988',
    fonte: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm',
  },
});

/**
 * Corpus de dispositivos usados na prática de insolvência da NGA.
 *
 * É deliberadamente FECHADO e pequeno. Crescer o corpus é tarefa de revisão
 * jurídica — cada linha nova passa por quem responde pelo parecer, não por
 * quem escreve o código. Dispositivo fora daqui não é negado: é devolvido como
 * `nao_verificavel`, com o impedimento nomeado.
 */
const CORPUS: readonly Dispositivo[] = Object.freeze([
  // --- LREF: suspensão e verificação de créditos ---
  { chave: 'lref:6', diploma: 'lref', rotulo: 'art. 6º da LREF', ementa: 'Efeitos do deferimento sobre ações e execuções contra o devedor.' },
  { chave: 'lref:6:4', diploma: 'lref', rotulo: 'art. 6º, § 4º, da LREF', ementa: 'Prazo de suspensão das ações e execuções (stay period) e sua prorrogação.' },
  { chave: 'lref:6:7-B', diploma: 'lref', rotulo: 'art. 6º, § 7º-B, da LREF', ementa: 'Execuções fiscais não se suspendem; competência do juízo da recuperação para atos de constrição sobre bens de capital.' },
  { chave: 'lref:7', diploma: 'lref', rotulo: 'art. 7º da LREF', ementa: 'Verificação dos créditos pelo administrador judicial.' },
  { chave: 'lref:7:1', diploma: 'lref', rotulo: 'art. 7º, § 1º, da LREF', ementa: 'Prazo para habilitação e divergência contra a relação de credores do devedor.' },
  { chave: 'lref:7:2', diploma: 'lref', rotulo: 'art. 7º, § 2º, da LREF', ementa: 'Publicação do edital com a relação de credores elaborada pelo administrador judicial.' },
  { chave: 'lref:8', diploma: 'lref', rotulo: 'art. 8º da LREF', ementa: 'Impugnação à relação de credores.' },
  { chave: 'lref:10', diploma: 'lref', rotulo: 'art. 10 da LREF', ementa: 'Habilitação retardatária.' },

  // --- LREF: órgãos ---
  { chave: 'lref:22', diploma: 'lref', rotulo: 'art. 22 da LREF', ementa: 'Atribuições do administrador judicial.' },
  { chave: 'lref:26', diploma: 'lref', rotulo: 'art. 26 da LREF', ementa: 'Comitê de credores: composição.' },
  { chave: 'lref:35', diploma: 'lref', rotulo: 'art. 35 da LREF', ementa: 'Atribuições da assembleia geral de credores.' },
  { chave: 'lref:37', diploma: 'lref', rotulo: 'art. 37 da LREF', ementa: 'Presidência e instalação da assembleia; quórum de instalação.' },
  { chave: 'lref:39', diploma: 'lref', rotulo: 'art. 39 da LREF', ementa: 'Quem vota na assembleia, conforme a relação de credores.' },

  // --- LREF: classes e votação ---
  { chave: 'lref:41', diploma: 'lref', rotulo: 'art. 41 da LREF', ementa: 'Classes de credores na assembleia: I trabalhista, II garantia real, III quirografário, IV ME e EPP.' },
  { chave: 'lref:41:1', diploma: 'lref', rotulo: 'art. 41, § 1º, da LREF', ementa: 'Titular de crédito trabalhista vota com a totalidade do crédito.' },
  { chave: 'lref:41:2', diploma: 'lref', rotulo: 'art. 41, § 2º, da LREF', ementa: 'Crédito com garantia real vota na classe II até o limite do valor do bem gravado e na classe III pelo restante.' },
  { chave: 'lref:45', diploma: 'lref', rotulo: 'art. 45 da LREF', ementa: 'Aprovação do plano exige a aprovação de todas as classes votantes.' },
  { chave: 'lref:45:1', diploma: 'lref', rotulo: 'art. 45, § 1º, da LREF', ementa: 'Classes II e III: maioria do valor dos créditos presentes e, cumulativamente, maioria dos credores presentes.' },
  { chave: 'lref:45:2', diploma: 'lref', rotulo: 'art. 45, § 2º, da LREF', ementa: 'Classes I e IV: maioria apenas por cabeça, independentemente do valor.' },
  { chave: 'lref:45:3', diploma: 'lref', rotulo: 'art. 45, § 3º, da LREF', ementa: 'Credor não atingido pelo plano não vota e não integra o quórum.' },

  // --- LREF: requisitos e processamento ---
  { chave: 'lref:47', diploma: 'lref', rotulo: 'art. 47 da LREF', ementa: 'Objetivo da recuperação judicial: superação da crise e preservação da empresa.' },
  { chave: 'lref:48', diploma: 'lref', rotulo: 'art. 48 da LREF', ementa: 'Requisitos do devedor para requerer recuperação judicial.' },
  { chave: 'lref:49', diploma: 'lref', rotulo: 'art. 49 da LREF', ementa: 'Créditos sujeitos: os existentes na data do pedido, ainda que não vencidos.' },
  { chave: 'lref:49:3', diploma: 'lref', rotulo: 'art. 49, § 3º, da LREF', ementa: 'Credor titular de posição de proprietário fiduciário, arrendador mercantil ou vendedor com reserva de domínio não se sujeita aos efeitos da recuperação.' },
  { chave: 'lref:49:4', diploma: 'lref', rotulo: 'art. 49, § 4º, da LREF', ementa: 'Adiantamento a contrato de câmbio e sua não sujeição.' },
  { chave: 'lref:50', diploma: 'lref', rotulo: 'art. 50 da LREF', ementa: 'Meios de recuperação judicial, em lista exemplificativa.' },
  { chave: 'lref:51', diploma: 'lref', rotulo: 'art. 51 da LREF', ementa: 'Documentos que devem instruir a petição inicial de recuperação judicial.' },
  { chave: 'lref:51-A', diploma: 'lref', rotulo: 'art. 51-A da LREF', ementa: 'Constatação prévia das condições de funcionamento do devedor antes do deferimento.' },
  { chave: 'lref:52', diploma: 'lref', rotulo: 'art. 52 da LREF', ementa: 'Deferimento do processamento e suas determinações.' },
  { chave: 'lref:53', diploma: 'lref', rotulo: 'art. 53 da LREF', ementa: 'Prazo para apresentação do plano de recuperação judicial pelo devedor.' },
  { chave: 'lref:54', diploma: 'lref', rotulo: 'art. 54 da LREF', ementa: 'Limites de prazo para pagamento dos créditos trabalhistas no plano.' },
  { chave: 'lref:55', diploma: 'lref', rotulo: 'art. 55 da LREF', ementa: 'Objeção ao plano pelos credores e seu prazo.' },
  { chave: 'lref:56', diploma: 'lref', rotulo: 'art. 56 da LREF', ementa: 'Convocação da assembleia em caso de objeção.' },
  { chave: 'lref:56:4', diploma: 'lref', rotulo: 'art. 56, § 4º, da LREF', ementa: 'Apresentação de plano alternativo pelos credores.' },
  { chave: 'lref:57', diploma: 'lref', rotulo: 'art. 57 da LREF', ementa: 'Certidões negativas de débitos tributários após a aprovação do plano.' },
  { chave: 'lref:58', diploma: 'lref', rotulo: 'art. 58 da LREF', ementa: 'Concessão da recuperação judicial pelo juiz.' },
  { chave: 'lref:58:1', diploma: 'lref', rotulo: 'art. 58, § 1º, da LREF', ementa: 'Concessão apesar da rejeição por classe (cram down), mediante os requisitos cumulativos dos incisos I a III.' },
  { chave: 'lref:58:2', diploma: 'lref', rotulo: 'art. 58, § 2º, da LREF', ementa: 'Vedação de tratamento diferenciado entre credores da classe que rejeitou o plano.' },
  { chave: 'lref:59', diploma: 'lref', rotulo: 'art. 59 da LREF', ementa: 'Novação dos créditos pela concessão da recuperação, sem extinção das garantias sem anuência.' },
  { chave: 'lref:61', diploma: 'lref', rotulo: 'art. 61 da LREF', ementa: 'Período de supervisão judicial após a concessão.' },
  { chave: 'lref:63', diploma: 'lref', rotulo: 'art. 63 da LREF', ementa: 'Encerramento da recuperação judicial.' },
  { chave: 'lref:67', diploma: 'lref', rotulo: 'art. 67 da LREF', ementa: 'Créditos decorrentes de obrigações contraídas durante a recuperação e seu tratamento.' },
  { chave: 'lref:73', diploma: 'lref', rotulo: 'art. 73 da LREF', ementa: 'Convolação da recuperação judicial em falência.' },

  // --- LREF: falência e extrajudicial ---
  { chave: 'lref:83', diploma: 'lref', rotulo: 'art. 83 da LREF', ementa: 'Ordem de classificação dos créditos na falência.' },
  { chave: 'lref:84', diploma: 'lref', rotulo: 'art. 84 da LREF', ementa: 'Créditos extraconcursais e sua ordem de pagamento.' },
  { chave: 'lref:94', diploma: 'lref', rotulo: 'art. 94 da LREF', ementa: 'Hipóteses de pedido de falência do devedor.' },
  { chave: 'lref:99', diploma: 'lref', rotulo: 'art. 99 da LREF', ementa: 'Conteúdo da sentença que decreta a falência.' },
  { chave: 'lref:161', diploma: 'lref', rotulo: 'art. 161 da LREF', ementa: 'Recuperação extrajudicial: cabimento e limites.' },
  { chave: 'lref:163', diploma: 'lref', rotulo: 'art. 163 da LREF', ementa: 'Homologação do plano de recuperação extrajudicial com adesão de credores abaixo da totalidade.' },

  // --- outros diplomas ---
  { chave: 'ctn:187', diploma: 'ctn', rotulo: 'art. 187 do CTN', ementa: 'Cobrança judicial do crédito tributário não se sujeita a concurso de credores.' },
  { chave: 'ctn:191-A', diploma: 'ctn', rotulo: 'art. 191-A do CTN', ementa: 'Concessão de recuperação judicial e prova de quitação de tributos.' },
  { chave: 'cc:406', diploma: 'cc', rotulo: 'art. 406 do Código Civil', ementa: 'Juros legais quando não convencionados.' },
  { chave: 'cpc:300', diploma: 'cpc', rotulo: 'art. 300 do CPC', ementa: 'Requisitos da tutela provisória de urgência.' },
]);

const POR_CHAVE = new Map(CORPUS.map((d) => [d.chave, d]));

export function dispositivo(chave: string): Dispositivo | undefined {
  return POR_CHAVE.get(chave);
}

export function fonteDo(diploma: Diploma): string {
  return NOMES[diploma].fonte;
}

export function tamanhoDoCorpus(): number {
  return CORPUS.length;
}

// -------------------------------------------------------------- extração ---

const APELIDOS: ReadonlyArray<readonly [RegExp, Diploma]> = Object.freeze([
  [/lei\s*n?\s*[º°.]?\s*11\.?101(?:\s*\/\s*(?:de\s*)?2005)?/i, 'lref'],
  [/lei\s*n?\s*[º°.]?\s*14\.?112(?:\s*\/\s*(?:de\s*)?2020)?/i, 'lref'],
  [/\blref\b/i, 'lref'],
  [/lei\s+de\s+recupera\S*\s+(?:judicial\s+e\s+)?fal\S*/i, 'lref'],
  [/lei\s+de\s+fal\S*/i, 'lref'],
  [/lei\s+de\s+recupera\S*\s+de\s+empresas/i, 'lref'],
  [/\bctn\b/i, 'ctn'],
  [/c[óo]digo\s+tribut[áa]rio/i, 'ctn'],
  [/lei\s*n?\s*[º°.]?\s*5\.?172/i, 'ctn'],
  [/\bcpc\b/i, 'cpc'],
  [/c[óo]digo\s+de\s+processo\s+civil/i, 'cpc'],
  [/lei\s*n?\s*[º°.]?\s*13\.?105/i, 'cpc'],
  [/\bclt\b/i, 'clt'],
  [/\bcf\b|constitui[çc][ãa]o/i, 'cf'],
  // O Código Civil vem por último: "CC" é sigla curta e ambígua.
  [/c[óo]digo\s+civil/i, 'cc'],
  [/lei\s*n?\s*[º°.]?\s*10\.?406/i, 'cc'],
  [/\bcc\b/i, 'cc'],
]);

/** Quanto do texto após o artigo é lido em busca de § e diploma. */
const JANELA = 120;

const RE_ARTIGO =
  /\bart(?:igo)?s?\.?\s*(\d{1,4})(?:\s*[-–]\s*([A-Za-z]))?\s*[ºo°]?/gi;
// O sufixo de letra é essencial: o § 7º-B do art. 6º (execução fiscal) é
// dispositivo próprio, e tratá-lo como § 7º cita coisa diferente.
const RE_PARAGRAFO =
  /^[\s,;]*(?:§\s*(\d{1,2}\s*[º°]?(?:\s*[-–]\s*[A-Za-z])?)|par[áa]grafo\s+(?:(único|unico)|(\d{1,2})))/i;

/** "7 - b" → "7-B", para casar com a chave do corpus. */
function normalizarParagrafo(bruto: string): string {
  const m = /^(\d{1,2})\s*[º°]?\s*(?:[-–]\s*([A-Za-z]))?/.exec(bruto);
  if (!m) return bruto.trim();
  return m[2] ? `${m[1]}-${m[2].toUpperCase()}` : m[1]!;
}

const RE_SUMULA = /\bs[úu]mula\s*(?:vinculante\s*)?n?[º°.]?\s*(\d{1,4})\s*(?:\/?\s*(?:do\s+)?(stj|stf|tst))?/gi;
const RE_JULGADO =
  /\b(resp|aresp|agint|edcl|ag|re|rcl|cc|ri|aglnst)\b[\s.]*n?[º°.]?\s*([\d.]{4,}(?:\s*\/\s*[a-z]{2})?)/gi;
const RE_TEMA = /\btema\s*(?:repetitivo\s*)?n?[º°.]?\s*(\d{1,4})/gi;

export interface OpcoesDeExtracao {
  /**
   * Diploma assumido quando a citação não o nomeia ("art. 41" numa peça de
   * recuperação judicial). A dedução é REGISTRADA na referência; sem isto, a
   * verificação seria um chute disfarçado de conferência.
   */
  readonly diplomaPresumido?: Diploma;
}

function diplomaNaJanela(janela: string): Diploma | null {
  let melhor: { diploma: Diploma; indice: number } | null = null;
  for (const [re, diploma] of APELIDOS) {
    const m = re.exec(janela);
    if (!m) continue;
    if (!melhor || m.index < melhor.indice) melhor = { diploma, indice: m.index };
  }
  return melhor?.diploma ?? null;
}

/** Extrai e verifica toda referência jurídica do texto. */
export function extrairReferencias(
  texto: string,
  opcoes: OpcoesDeExtracao = {},
): Referencia[] {
  const referencias: Referencia[] = [];

  // --- legislação ---
  const re = new RegExp(RE_ARTIGO.source, RE_ARTIGO.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const fimDoArtigo = m.index + m[0].length;
    const janela = texto.slice(fimDoArtigo, fimDoArtigo + JANELA);

    const p = RE_PARAGRAFO.exec(janela);
    const paragrafo = p?.[1] !== undefined
      ? normalizarParagrafo(p[1])
      : p?.[3] ?? (p?.[2] ? 'unico' : undefined);

    const diplomaCitado = diplomaNaJanela(janela);
    const diploma = diplomaCitado ?? opcoes.diplomaPresumido ?? null;

    const artigo = m[2] ? `${m[1]}-${m[2].toUpperCase()}` : m[1]!;
    const bruto = texto.slice(m.index, fimDoArtigo + (p?.[0].length ?? 0)).trim();

    if (!diploma) {
      referencias.push({
        natureza: 'legislacao', bruto, posicao: m.index, chave: null,
        status: 'nao_verificavel',
        motivo: 'a citação não identifica a lei e o contexto não permitiu deduzi-la',
      });
      continue;
    }

    const chave = paragrafo ? `${diploma}:${artigo}:${paragrafo}` : `${diploma}:${artigo}`;
    const achado = POR_CHAVE.get(chave)
      // § fora do corpus cai para o caput, que é o que se pode afirmar.
      ?? (paragrafo ? POR_CHAVE.get(`${diploma}:${artigo}`) : undefined);

    if (achado && achado.chave === chave) {
      referencias.push({
        natureza: 'legislacao', bruto, posicao: m.index, chave,
        status: 'verificada', ementa: achado.ementa, fonte: NOMES[diploma].fonte,
        ...(diplomaCitado ? {} : { diplomaPresumido: true }),
      });
    } else if (achado) {
      referencias.push({
        natureza: 'legislacao', bruto, posicao: m.index, chave,
        status: 'nao_verificavel',
        ementa: achado.ementa, fonte: NOMES[diploma].fonte,
        motivo: `o caput (${achado.rotulo}) consta do corpus, mas o § ${paragrafo} não foi conferido`,
        ...(diplomaCitado ? {} : { diplomaPresumido: true }),
      });
    } else {
      referencias.push({
        natureza: 'legislacao', bruto, posicao: m.index, chave,
        status: 'nao_localizada', fonte: NOMES[diploma].fonte,
        motivo: `dispositivo fora do corpus verificado da NGA (${NOMES[diploma].nome})`,
        ...(diplomaCitado ? {} : { diplomaPresumido: true }),
      });
    }
  }

  // --- jurisprudência: SEM base integrada, nada é verificável ---
  const semBase = (bruto: string, posicao: number, o_que: string): Referencia => ({
    natureza: 'jurisprudencia', bruto, posicao, chave: null,
    status: 'nao_verificavel',
    motivo:
      `não há base de ${o_que} integrada à plataforma: a referência precisa ser ` +
      'conferida na fonte pelo advogado antes de ir a qualquer peça',
  });

  for (const [regex, o_que] of [
    [RE_SUMULA, 'súmulas'], [RE_JULGADO, 'julgados'], [RE_TEMA, 'temas repetitivos'],
  ] as const) {
    const r = new RegExp(regex.source, regex.flags);
    let j: RegExpExecArray | null;
    while ((j = r.exec(texto)) !== null) {
      // "CC" como sigla de julgado (conflito de competência) colide com Código
      // Civil; só conta se vier seguido de número, que o padrão já exige.
      referencias.push(semBase(j[0].trim(), j.index, o_que));
    }
  }

  referencias.sort((a, b) => a.posicao - b.posicao);
  return referencias;
}

// --------------------------------------------------------------- auditoria ---

export interface AuditoriaDeCitacoes {
  readonly referencias: readonly Referencia[];
  readonly verificadas: number;
  readonly naoLocalizadas: readonly Referencia[];
  readonly naoVerificaveis: readonly Referencia[];
  /**
   * Falso quando há referência com forma de citação que não existe no corpus.
   * É o portão do §7.7: análise reprovada aqui não é publicada como se fosse
   * fundamentada.
   */
  readonly aprovada: boolean;
  readonly resumo: string;
}

export function auditarCitacoes(
  texto: string,
  opcoes: OpcoesDeExtracao = {},
): AuditoriaDeCitacoes {
  const referencias = extrairReferencias(texto, opcoes);
  const naoLocalizadas = referencias.filter((r) => r.status === 'nao_localizada');
  const naoVerificaveis = referencias.filter((r) => r.status === 'nao_verificavel');
  const verificadas = referencias.filter((r) => r.status === 'verificada').length;

  const partes = [`${verificadas} verificada(s)`];
  if (naoLocalizadas.length) partes.push(`${naoLocalizadas.length} não localizada(s) no corpus`);
  if (naoVerificaveis.length) partes.push(`${naoVerificaveis.length} sem base para conferência`);

  return {
    referencias,
    verificadas,
    naoLocalizadas,
    naoVerificaveis,
    aprovada: naoLocalizadas.length === 0,
    resumo: partes.join(', '),
  };
}

export const ROTULO_DA_NATUREZA: Readonly<Record<NaturezaDaReferencia, string>> = Object.freeze({
  legislacao: 'Legislação',
  jurisprudencia: 'Jurisprudência',
  doutrina: 'Doutrina',
  interpretacao: 'Interpretação',
  hipotese: 'Hipótese',
});

export const ROTULO_DO_STATUS: Readonly<Record<StatusDaVerificacao, string>> = Object.freeze({
  verificada: 'Verificada no corpus',
  nao_localizada: 'NÃO LOCALIZADA — conferir antes de usar',
  nao_verificavel: 'Sem base para conferência automática',
});
