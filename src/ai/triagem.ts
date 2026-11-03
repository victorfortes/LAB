/**
 * Pipeline de análise documental (§7 do briefing).
 *
 * A ORDEM É O DESENHO. Primeiro roda tudo que é determinístico e conferível;
 * só depois, e opcionalmente, entra o modelo de linguagem. Consequência
 * prática: sem chave de IA a análise não deixa de existir — ela entrega
 * classificação, identificadores com dígito verificador, citações conferidas
 * contra o corpus e detecção de injeção, e DIZ que o estágio de leitura não
 * rodou e por quê (§22).
 *
 * E o que vem do modelo passa por três portões antes de existir:
 *   1. ESQUEMA — a resposta é validada por esquema estrito no provedor; não há
 *      campo onde caiba uma conclusão que não lhe cabe decidir.
 *   2. ÂNCORA — todo achado cita trecho literal, e a plataforma CONFERE que o
 *      trecho existe no documento. Não existindo, o achado é descartado e o
 *      descarte fica registrado.
 *   3. FUNDAMENTO — dispositivo invocado é conferido no corpus. Fora do
 *      corpus, o achado não pode se apresentar como legislação: desce para
 *      hipótese, com ressalva escrita.
 *
 * Nada disso depende de o modelo cooperar, e é por isso que funciona.
 */
import {
  type Classificacao, classificar,
} from '../domain/analise/classificacao.ts';
import {
  type Diploma, type StatusDaVerificacao, type AuditoriaDeCitacoes,
  auditarCitacoes, extrairReferencias,
} from '../domain/analise/citacoes.ts';
import {
  type Ocorrencia, extrairIdentificadores, formatarCnpj, formatarCpf, formatarProcesso,
} from '../domain/analise/identificadores.ts';
import {
  INSTRUCAO_DE_SISTEMA, type Envelope, envelopar, moldura,
} from '../domain/analise/sanitizacao.ts';
import { ancorar, dividir } from '../domain/analise/trechos.ts';
import {
  AnaliseRecusada, ProvedorIndisponivel, RespostaInvalida,
  type AchadoDoModelo, type Provedor,
} from './provedor.ts';

export type EstagioIa =
  'nao_executada' | 'executada' | 'indisponivel' | 'recusada' | 'falhou';

export type Natureza =
  'legislacao' | 'jurisprudencia' | 'doutrina' | 'interpretacao'
  | 'hipotese' | 'fato_do_documento';

export interface AchadoPronto {
  readonly categoria: string;
  readonly gravidade: 'informacao' | 'atencao' | 'critico';
  readonly titulo: string;
  readonly descricao: string;
  readonly natureza: Natureza;
  /** Trecho como está NO DOCUMENTO, não como o modelo o escreveu. */
  readonly trechoCitado: string | null;
  readonly trechoInicio: number | null;
  readonly trechoFim: number | null;
  readonly fundamentoChave: string | null;
  readonly fundamentoStatus: StatusDaVerificacao | null;
  readonly origem: 'deterministico' | 'ia';
  /** O que o advogado precisa saber antes de confiar neste achado. */
  readonly ressalvas: readonly string[];
}

export interface AchadoRecusado {
  readonly titulo: string;
  readonly motivo: string;
  readonly trechoCitado: string;
}

export interface ResultadoDaTriagem {
  readonly classificacao: Classificacao;
  readonly identificadores: readonly Ocorrencia[];
  readonly suspeitas: Envelope['suspeitas'];
  readonly citacoesDoDocumento: AuditoriaDeCitacoes;
  readonly partes: number;
  readonly caracteres: number;

  readonly estagioIa: EstagioIa;
  readonly motivoIa: string | null;
  readonly modeloIa: string | null;
  readonly tokensEntrada: number | null;
  readonly tokensSaida: number | null;

  readonly resumo: string | null;
  readonly achados: readonly AchadoPronto[];
  /** O que o modelo afirmou e NÃO sobreviveu aos portões. Fica visível. */
  readonly achadosRecusados: readonly AchadoRecusado[];
}

/** Tipos de documento em que "art. 41" sem mais nada significa LREF. */
const CONTEXTO_CONCURSAL = new Set([
  'peticao_inicial_rj', 'plano_recuperacao', 'plano_modificativo',
  'relacao_credores', 'edital', 'ata_agc', 'decisao_judicial', 'sentenca',
  'laudo_constatacao_previa', 'relatorio_mensal_atividades',
  'habilitacao_credito', 'impugnacao_credito', 'objecao_plano',
]);

function diplomaDoContexto(classificacao: Classificacao): Diploma | undefined {
  return CONTEXTO_CONCURSAL.has(classificacao.tipo) ? 'lref' : undefined;
}

// ------------------------------------------------- achados determinísticos ---

const ROTULO_DA_SUSPEITA: Record<string, string> = {
  instrucao_direta: 'ordem para descartar instruções',
  troca_de_papel: 'tentativa de redefinir o papel do leitor',
  delimitador_forjado: 'marcador de conversa embutido no documento',
  vazamento_de_prompt: 'pedido de revelação das instruções internas',
  ocultacao: 'ordem para esconder informação do usuário',
  conclusao_forcada: 'tentativa de determinar a conclusão da análise',
  texto_invisivel: 'caracteres invisíveis no texto',
};

/**
 * Achados que não precisam de modelo nenhum.
 *
 * São os mais confiáveis do conjunto: dígito verificador é cálculo, citação
 * fora do corpus é consulta, injeção é padrão encontrado. Nenhum depende de
 * inferência.
 */
function achadosDeterministicos(
  texto: string,
  envelope: Envelope,
  identificadores: readonly Ocorrencia[],
  citacoes: AuditoriaDeCitacoes,
): AchadoPronto[] {
  const achados: AchadoPronto[] = [];

  for (const s of envelope.suspeitas) {
    achados.push({
      categoria: 'integridade do documento',
      // Conteúdo com forma de instrução dentro de documento de cliente é
      // sempre crítico: ou é ataque, ou é alguém testando o sistema.
      gravidade: s.tipo === 'texto_invisivel' ? 'atencao' : 'critico',
      titulo: `Conteúdo suspeito no documento: ${ROTULO_DA_SUSPEITA[s.tipo] ?? s.tipo}`,
      descricao: s.explicacao,
      natureza: 'fato_do_documento',
      trechoCitado: s.trecho,
      trechoInicio: s.posicao,
      trechoFim: null,
      fundamentoChave: null,
      fundamentoStatus: null,
      origem: 'deterministico',
      ressalvas: ['O conteúdo foi tratado como dado, nunca como instrução (§7.12).'],
    });
  }

  for (const o of identificadores) {
    if (o.valido) continue;
    const formatado = o.tipo === 'cnpj' ? formatarCnpj(o.bruto)
      : o.tipo === 'cpf' ? formatarCpf(o.bruto)
      : o.tipo === 'processo_cnj' ? formatarProcesso(o.bruto)
      : o.bruto;
    achados.push({
      categoria: 'identificador inválido',
      gravidade: 'atencao',
      titulo: `${o.tipo.toUpperCase().replace('_', ' ')} inconsistente: ${formatado}`,
      descricao: o.observacao ?? 'o identificador não passou na conferência.',
      natureza: 'fato_do_documento',
      trechoCitado: o.bruto,
      trechoInicio: o.posicao,
      trechoFim: o.posicao + o.bruto.length,
      fundamentoChave: null,
      fundamentoStatus: null,
      origem: 'deterministico',
      ressalvas: [],
    });
  }

  for (const r of citacoes.naoLocalizadas) {
    achados.push({
      categoria: 'citação do documento',
      gravidade: 'atencao',
      titulo: `Dispositivo citado não localizado no corpus: ${r.bruto}`,
      descricao:
        `${r.motivo ?? 'não conferido'}. Conferir na fonte antes de aceitar a ` +
        'fundamentação da peça.',
      natureza: 'hipotese',
      trechoCitado: r.bruto,
      trechoInicio: r.posicao,
      trechoFim: r.posicao + r.bruto.length,
      fundamentoChave: r.chave,
      fundamentoStatus: 'nao_localizada',
      origem: 'deterministico',
      ressalvas: ['O corpus da NGA é fechado: ausência aqui não significa inexistência na lei.'],
    });
  }

  void texto;
  return achados;
}

// ----------------------------------------------------- portões sobre a IA ---

/**
 * Converte achado do modelo em achado da plataforma, ou recusa.
 *
 * O trecho devolvido é SEMPRE o do documento. Se o modelo parafraseou, o
 * advogado lê a versão verdadeira; se inventou, não lê nada.
 */
function validarAchadoDaIa(
  texto: string,
  bruto: AchadoDoModelo,
  diplomaPresumido: Diploma | undefined,
): AchadoPronto | AchadoRecusado {
  const ancora = ancorar(texto, bruto.trecho_citado);
  if (!ancora) {
    return {
      titulo: bruto.titulo,
      trechoCitado: bruto.trecho_citado,
      motivo:
        'o trecho citado não existe no documento (ou é curto demais para ancorar): ' +
        'o achado foi descartado sem chegar à análise',
    };
  }

  const ressalvas: string[] = [];
  if (ancora.divergeDoCitado) {
    ressalvas.push(
      'A citação do modelo diferia do documento em grafia ou espaçamento; ' +
      'o trecho exibido é o do documento.',
    );
  }

  let natureza: Natureza = bruto.natureza;
  let fundamentoChave: string | null = null;
  let fundamentoStatus: StatusDaVerificacao | null = null;

  if (bruto.fundamento) {
    const referencias = extrairReferencias(
      bruto.fundamento,
      diplomaPresumido ? { diplomaPresumido } : {},
    );
    const primeira = referencias[0];
    if (primeira) {
      fundamentoChave = primeira.chave;
      fundamentoStatus = primeira.status;

      if (primeira.status === 'nao_localizada') {
        // Não se apaga o achado: pode ser observação verdadeira com rótulo
        // errado. Mas ele perde o direito de se chamar legislação.
        natureza = 'hipotese';
        ressalvas.push(
          `O dispositivo "${primeira.bruto}" não está no corpus verificado da NGA. ` +
          'O achado foi rebaixado a hipótese e precisa de conferência na fonte.',
        );
      } else if (primeira.status === 'nao_verificavel') {
        if (natureza === 'legislacao' || natureza === 'jurisprudencia') natureza = 'interpretacao';
        ressalvas.push(
          `Não há base integrada para conferir "${primeira.bruto}": ${primeira.motivo ?? ''}`.trim(),
        );
      }
    }
  }

  // Jurisprudência e doutrina não têm corpus nenhum nesta plataforma: a
  // ressalva é obrigatória, haja fundamento declarado ou não.
  if (bruto.natureza === 'jurisprudencia' || bruto.natureza === 'doutrina') {
    ressalvas.push(
      'Jurisprudência e doutrina não são conferidas automaticamente: confirmar na fonte ' +
      'antes de levar a qualquer peça.',
    );
  }

  return {
    categoria: bruto.categoria,
    gravidade: bruto.gravidade,
    titulo: bruto.titulo,
    descricao: bruto.descricao,
    natureza,
    trechoCitado: ancora.trechoReal,
    trechoInicio: ancora.inicio,
    trechoFim: ancora.fim,
    fundamentoChave,
    fundamentoStatus,
    origem: 'ia',
    ressalvas,
  };
}

function ehRecusado(x: AchadoPronto | AchadoRecusado): x is AchadoRecusado {
  return 'motivo' in x;
}

// ----------------------------------------------------------------- tarefa ---

/**
 * A tarefa da chamada. Fica no código, nunca no documento.
 *
 * Note o que NÃO se pede: não se pede classe de crédito, não se pede cálculo,
 * não se pede conclusão sobre sujeição concursal. Isso é determinístico
 * (§7.3, §9) ou é ato de pessoa (§7.7).
 */
export function tarefaDaTriagem(tipoSugerido: string, certeza: string): string {
  return [
    'Analise o documento delimitado abaixo e devolve achados conferíveis.',
    '',
    `Classificação automática prévia: ${tipoSugerido} (certeza ${certeza}). ` +
      'Pode estar errada — se o documento for outra coisa, diga no resumo.',
    '',
    'Para CADA achado:',
    '- cite em `trecho_citado` um recorte LITERAL do documento, com pelo menos ' +
      '12 caracteres, copiado exatamente como está escrito;',
    '- declare a `natureza` da afirmação: `fato_do_documento` para o que está ' +
      'escrito, `legislacao` só com dispositivo citado, `interpretacao` para ' +
      'leitura sua, `hipotese` para o que você suspeita sem base no texto;',
    '- em `fundamento`, cite o dispositivo exatamente como "art. 41, § 2º, da ' +
      'Lei 11.101/2005", ou `null` se não houver.',
    '',
    'NÃO faça: não calcule valores, juros, prazos nem quórum; não determine ' +
      'classe de crédito nem sujeição concursal; não cite julgado, súmula ou ' +
      'doutrina de memória; não invente dispositivo.',
    '',
    'Um achado sem trecho literal do documento será descartado pela plataforma ' +
      'antes de chegar ao advogado. Prefira cinco achados ancorados a vinte ' +
      'genéricos.',
  ].join('\n');
}

// ---------------------------------------------------------------- pipeline ---

export interface OpcoesDeTriagem {
  /** Sem provedor, roda só o determinístico e declara o impedimento. */
  readonly provedor?: Provedor;
  readonly maximoPorParte?: number;
}

export async function triar(
  texto: string,
  opcoes: OpcoesDeTriagem = {},
): Promise<ResultadoDaTriagem> {
  // --- determinístico, sempre ---
  const envelope = envelopar(texto);
  const classificacao = classificar(texto);
  const diplomaPresumido = diplomaDoContexto(classificacao);
  const identificadores = extrairIdentificadores(texto);
  const citacoesDoDocumento = auditarCitacoes(
    texto,
    diplomaPresumido ? { diplomaPresumido } : {},
  );
  const partes = texto.length === 0
    ? []
    : dividir(texto, opcoes.maximoPorParte ? { maximo: opcoes.maximoPorParte } : {});

  const achados: AchadoPronto[] = achadosDeterministicos(
    texto, envelope, identificadores, citacoesDoDocumento);

  const base = {
    classificacao,
    identificadores,
    suspeitas: envelope.suspeitas,
    citacoesDoDocumento,
    partes: partes.length,
    caracteres: texto.length,
  };

  const { provedor } = opcoes;
  if (!provedor) {
    return {
      ...base,
      estagioIa: 'nao_executada',
      motivoIa: 'o estágio de leitura por modelo não foi solicitado nesta análise',
      modeloIa: null, tokensEntrada: null, tokensSaida: null,
      resumo: null, achados, achadosRecusados: [],
    };
  }

  if (!provedor.disponivel) {
    return {
      ...base,
      estagioIa: 'indisponivel',
      motivoIa: provedor.impedimento,
      modeloIa: null, tokensEntrada: null, tokensSaida: null,
      resumo: null, achados, achadosRecusados: [],
    };
  }

  // --- estágio de IA, sobre a primeira parte ---
  // Documento longo roda por partes; esta versão analisa a primeira e DECLARA
  // quantas ficaram de fora, em vez de deixar o leitor supor que leu tudo.
  const primeira = partes[0];
  if (!primeira) {
    return {
      ...base,
      estagioIa: 'nao_executada',
      motivoIa: 'documento sem texto para analisar',
      modeloIa: null, tokensEntrada: null, tokensSaida: null,
      resumo: null, achados, achadosRecusados: [],
    };
  }

  const envelopeDaParte = envelopar(primeira.texto);

  try {
    const resultado = await provedor.analisar({
      sistema: INSTRUCAO_DE_SISTEMA,
      tarefa: tarefaDaTriagem(classificacao.tipo, classificacao.certeza),
      documento: moldura(envelopeDaParte),
    });

    const recusados: AchadoRecusado[] = [];
    for (const bruto of resultado.resposta.achados) {
      // Confere contra o TEXTO INTEIRO: o deslocamento devolvido é no
      // documento, não dentro do pedaço.
      const validado = validarAchadoDaIa(texto, bruto, diplomaPresumido);
      if (ehRecusado(validado)) recusados.push(validado);
      else achados.push(validado);
    }

    const ressalvaDeCobertura = partes.length > 1
      ? ` A leitura por modelo cobriu ${primeira.texto.length} de ${texto.length} caracteres (parte 1 de ${partes.length}).`
      : '';

    return {
      ...base,
      estagioIa: 'executada',
      motivoIa: null,
      modeloIa: resultado.modelo,
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      resumo: resultado.resposta.resumo + ressalvaDeCobertura,
      achados,
      achadosRecusados: recusados,
    };
  } catch (e) {
    const semIa = (estagio: EstagioIa, motivo: string): ResultadoDaTriagem => ({
      ...base,
      estagioIa: estagio, motivoIa: motivo,
      modeloIa: null, tokensEntrada: null, tokensSaida: null,
      resumo: null, achados, achadosRecusados: [],
    });

    if (e instanceof ProvedorIndisponivel) return semIa('indisponivel', e.impedimento);
    if (e instanceof AnaliseRecusada) return semIa('recusada', e.message);
    if (e instanceof RespostaInvalida) return semIa('falhou', e.message);
    // Falha desconhecida não some: o determinístico vale e o erro aparece.
    return semIa('falhou', (e as Error).message ?? 'erro desconhecido no estágio de IA');
  }
}
