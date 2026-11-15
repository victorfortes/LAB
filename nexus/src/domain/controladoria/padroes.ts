/**
 * Padrões de lançamento da controladoria NGA, extraídos da agenda real do Astrea (1.103 prazos em 15/11/2026).
 *
 * O título que a controladoria lança segue "AÇÃO - ATO": a ação é o que o escritório faz (MANIFESTAR, RECURSO,
 * CONTRARRAZÕES, MERA CIÊNCIA...) e o ato é o próprio movimento intimado, copiado da publicação
 * ("MANIFESTAR - JUNTADA DE INTIMAÇÃO - CUSTAS PROCESSUAIS"). O Projudi escreve o movimento no texto
 * ("Intimação referente ao movimento (seq. 7) JUNTADA DE ... (27/10/2026)"), então o padrão é reproduzível.
 *
 * Contagem:
 *  - Prazos do CPC em dias úteis (art. 219). Sem prazo fixado: 5 dias úteis (art. 218, § 3º).
 *  - Recursos: 15 dias úteis (art. 1.003, § 5º); embargos de declaração 5 dias úteis (art. 1.023).
 *  - Recuperação judicial, falência e incidentes (habilitação, impugnação, classificação, restituição): prazos
 *    "previstos ou que decorram" da Lei 11.101 em dias corridos (art. 189, § 1º, I, Lei 14.112/2020). Os recursos
 *    continuam em dias úteis pelo CPC (entendimento do STJ), então a regra corrida vale só para o que não é recurso.
 *
 * É SUGESTÃO: a controladoria confirma antes de virar prazo. A regra aplicada vai junto, para conferência.
 */

export type Regime = 'uteis' | 'corridos';
export interface Sugestao {
  readonly acao: string;
  readonly ato: string | null;
  readonly titulo: string;
  readonly dias: number;
  readonly regime: Regime;
  readonly recursal: boolean;
  readonly fundamento: string;
  readonly regra: string;
  /** 0 a 1: alta quando o movimento foi lido literalmente e a regra é específica. */
  readonly confianca: number;
  readonly observacao?: string;
}

const ENTIDADES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&ccedil;': 'ç', '&Ccedil;': 'Ç', '&atilde;': 'ã', '&Atilde;': 'Ã', '&otilde;': 'õ', '&Otilde;': 'Õ', '&aacute;': 'á', '&Aacute;': 'Á',
  '&eacute;': 'é', '&Eacute;': 'É', '&iacute;': 'í', '&Iacute;': 'Í', '&oacute;': 'ó', '&Oacute;': 'Ó', '&uacute;': 'ú', '&Uacute;': 'Ú',
  '&ecirc;': 'ê', '&Ecirc;': 'Ê', '&ocirc;': 'ô', '&Ocirc;': 'Ô', '&acirc;': 'â', '&Acirc;': 'Â', '&agrave;': 'à', '&Agrave;': 'À', '&ordm;': 'º', '&ordf;': 'ª', '&sect;': '§' };

/** Texto da publicação sem HTML, entidades e espaços repetidos. */
export function limparTexto(bruto: string | null | undefined): string {
  return String(bruto ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z]+;|&#\d+;/g, (e) => ENTIDADES[e] ?? (/^&#(\d+);$/.test(e) ? String.fromCharCode(Number(e.slice(2, -1))) : ' '))
    .replace(/\s+/g, ' ').trim();
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Movimento intimado, quando o tribunal o escreve (Projudi e afins). */
export function extrairMovimento(texto: string): string | null {
  const m = /movimento\s*\(seq\.?\s*\d+\)\s*(.+?)\s*\(\d{2}\/\d{2}\/\d{4}\)/i.exec(texto);
  return m ? m[1]!.trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 160) : null;
}

/** Classe de insolvência: prazos da LREF em dias corridos (art. 189, § 1º, I). */
export function ehInsolvencia(classe: string | null | undefined, texto = ''): boolean {
  const c = semAcento(`${classe ?? ''} ${texto.slice(0, 400)}`);
  return /RECUPERACAO JUDICIAL|RECUPERACAO EXTRAJUDICIAL|FALENCIA|HABILITACAO DE CREDITO|IMPUGNACAO DE CREDITO|CLASSIFICACAO DE CREDITO|RESTITUICAO DE COISA OU DINHEIRO NA FALENCIA|CONCURSO DE CREDORES/.test(c);
}

interface Regra {
  readonly nome: string;
  readonly teste: RegExp;
  readonly acao: string;
  /** null = "AÇÃO - ATO"; texto = título fixo. */
  readonly tituloFixo?: string;
  readonly dias: number;
  readonly recursal?: boolean;
  readonly fundamento: string;
  readonly confianca: number;
  readonly observacao?: string;
}

// Ordem importa: a primeira regra que casa vence. Mais específica antes da genérica.
const REGRAS: readonly Regra[] = [
  { nome: 'audiencia', teste: /AUDIENCIA .{0,60}DESIGNADA|DESIGNADA AUDIENCIA|DESIGNO AUDIENCIA|AUDIENCIA DE (CONCILIACAO|INSTRUCAO|MEDIACAO)/, acao: 'AUDIÊNCIA', dias: 5, fundamento: 'Audiência designada: cadastrar o evento com data e hora e preparar a participação', confianca: 0.85, observacao: 'Cadastre a audiência na agenda com a data do ato; o prazo aqui é o de preparação.' },
  { nome: 'edital_insolvencia', teste: /EDITAL.{0,200}(RELACAO DE CREDORES|ART\.? ?7|ART\.? ?52|ART\.? ?99|HABILITAC|IMPUGNAC|DIVERGENCI)/, acao: 'ANALISAR EDITAL', tituloFixo: 'Analisar edital - verificar habilitação/impugnação', dias: 10, fundamento: 'Edital da insolvência: habilitações e divergências em 15 dias (art. 7º, § 1º) e impugnação à relação do AJ em 10 dias (art. 8º), Lei 11.101', confianca: 0.7, observacao: 'Confira qual edital é: 15 dias (art. 7º, § 1º) ou 10 dias (art. 8º).' },
  { nome: 'pauta', teste: /INCLUIDO EM PAUTA|PAUTA DE JULGAMENTO|SESSAO VIRTUAL DE|PAUTADO/, acao: 'VERIFICAR', tituloFixo: 'Verificar necessidade de cadastro de sustentação oral / interesse', dias: 2, fundamento: 'Pauta de julgamento: pedido de sustentação ou de retirada da sessão virtual antes do início da sessão (regimento do tribunal)', confianca: 0.9, observacao: 'Confira a data da sessão no texto: o pedido precisa ser feito antes dela.' },
  { nome: 'ciencia', teste: /DELIBERADO EM SESSAO - RETIRADO|ADIADO|RETIRADO DE PAUTA|EXPEDICAO DE |CERTIDAO DE (DECURSO|TRANSITO)|TRANSITADO EM JULGADO|ATO CUMPRIDO|CIENCIA (AS|A) PARTES?|ARQUIVAD[OA]|BAIXA DEFINITIVA/, acao: 'MERA CIÊNCIA', dias: 2, fundamento: 'Ciência de ato sem providência', confianca: 0.8 },
  { nome: 'distribuicao', teste: /DISTRIBUIDO POR|^DISTRIBUIDO|RECEBIDOS? OS AUTOS|PROCESSO ENTRADO EM|REDISTRIBUIDO|REALIZADA DISTRIBUICAO|DISTRIBUICAO DO PROCESSO|LISTA DE DISTRIBUICAO/, acao: 'MERA CIÊNCIA', dias: 2, fundamento: 'Ciência da distribuição', confianca: 0.85 },
  { nome: 'resp_nao_admitido', teste: /RECURSO ESPECIAL NAO ADMITIDO|RECURSO EXTRAORDINARIO NAO ADMITIDO|NAO ADMITIDO O RECURSO/, acao: 'ARESP', tituloFixo: 'ARESP', dias: 15, recursal: true, fundamento: 'Agravo em recurso especial/extraordinário: 15 dias úteis (arts. 1.042 e 1.003, § 5º, CPC)', confianca: 0.85 },
  { nome: 'acordao', teste: /ACORDAO|CONHECIDO O RECURSO|NAO CONHECIDO|PROVIDO|PROVIMENTO|JULGAMENTO (DO|DE) RECURSO|DECISAO MONOCRATICA/, acao: 'RECURSO', tituloFixo: 'Intimação de acórdão - Verificar necessidade de agendamento de prazo recursal', dias: 15, recursal: true, fundamento: 'Recurso especial/extraordinário ou agravo interno: 15 dias úteis (art. 1.003, § 5º, CPC); embargos de declaração: 5 dias úteis (art. 1.023)', confianca: 0.8, observacao: 'Se couber embargos de declaração, o prazo é de 5 dias úteis.' },
  { nome: 'sentenca', teste: /SENTENCA|JULGAD[OA] (IM)?PROCEDENTE|EXTINT[OA]|HOMOLOGAD[OA] (O|A) (ACORDO|DESISTENCIA)/, acao: 'RECURSO / MANIFESTAR', dias: 15, recursal: true, fundamento: 'Apelação: 15 dias úteis (arts. 1.009 e 1.003, § 5º, CPC)', confianca: 0.8 },
  { nome: 'embargos_opostos', teste: /EMBARGOS DE DECLARACAO (OPOSTOS|INTERPOSTOS)|JUNTADA DE PETICAO DE EMBARGOS DE DECLARACAO|CONTRARRAZOES AOS EMBARGOS/, acao: 'RESPOSTA AOS EDs', tituloFixo: 'RESPOSTA AOS EDs', dias: 5, fundamento: 'Resposta aos embargos de declaração: 5 dias úteis (art. 1.023, § 2º, CPC)', confianca: 0.85 },
  { nome: 'contrarrazoes', teste: /CONTRARRAZOES|CONTRAMINUTA|APRESENTAR RESPOSTA AO RECURSO|JUNTADA DE PETICAO DE (APELACAO|RECURSO)/, acao: 'CONTRARRAZÕES', tituloFixo: 'CONTRARRAZÕES', dias: 15, fundamento: 'Contrarrazões: 15 dias úteis (arts. 1.010, § 1º, e 1.003, § 5º, CPC)', confianca: 0.8 },
  { nome: 'contestacao', teste: /CITACAO|CITADO|CONTESTAR|CONTESTACAO/, acao: 'CONTESTAÇÃO', tituloFixo: 'CONTESTAÇÃO', dias: 15, fundamento: 'Contestação: 15 dias úteis (art. 335, CPC)', confianca: 0.75 },
  { nome: 'administrador_judicial', teste: /VISTA AO (AJ|ADMINISTRADOR JUDICIAL)|(INTIME-SE|MANIFESTE-SE|DIGA|OUCA-SE|INTIMEM-SE) O (AJ|ADMINISTRADOR JUDICIAL)|AO ADMINISTRADOR JUDICIAL PARA|PRAZO AO AJ/, acao: 'PRAZO AO AJ', tituloFixo: 'PRAZO AO AJ', dias: 5, fundamento: 'Manifestação do administrador judicial (art. 22, Lei 11.101); sem prazo fixado, 5 dias (art. 218, § 3º, CPC)', confianca: 0.7 },
  { nome: 'decisao', teste: /DECISAO INTERLOCUTORIA|DEFERID[OA]|INDEFERID[OA]|CONCEDID[OA]|NAO CONCEDID[OA]|LIMINAR|TUTELA/, acao: 'MANIFESTAR', dias: 5, fundamento: 'Manifestação sem prazo fixado: 5 dias úteis (art. 218, § 3º, CPC). Agravo de instrumento, se cabível: 15 dias úteis (art. 1.015)', confianca: 0.8, observacao: 'Avalie agravo de instrumento (15 dias úteis).' },
  { nome: 'despacho', teste: /DESPACHO|ATO ORDINATORIO/, acao: 'MANIFESTAR', dias: 5, fundamento: 'Manifestação sem prazo fixado: 5 dias úteis (art. 218, § 3º, CPC)', confianca: 0.85 },
  { nome: 'juntada', teste: /^JUNTADA DE|JUNTADA DE (PETICAO|CERTIDAO|INTIMACAO|RESPOSTA|LAUDO|OFICIO|DOCUMENTO)/, acao: 'MANIFESTAR', dias: 5, fundamento: 'Manifestação sem prazo fixado: 5 dias úteis (art. 218, § 3º, CPC)', confianca: 0.85 },
  { nome: 'intimacao_para_manifestar', teste: /INTIME-SE .{0,120}(MANIFESTAR|QUERENDO|REGULARIZ|COMPROV|JUNTAR|RECOLHER)|MANIFESTE-SE|REGULARIZE|NOTA DE CARTORIO|NO PRAZO DE \d+/, acao: 'MANIFESTAR', dias: 5, fundamento: 'Intimação para manifestação; sem prazo fixado, 5 dias úteis (art. 218, § 3º, CPC)', confianca: 0.7 },
  { nome: 'custas', teste: /CUSTAS|PREPARO|RECOLHIMENTO/, acao: 'MANIFESTAR', dias: 5, fundamento: 'Recolhimento ou manifestação sobre custas: 5 dias úteis, salvo prazo fixado (art. 218, § 3º, CPC)', confianca: 0.75 },
];

/**
 * Parte decisória de um texto longo (e-SAJ, eproc): começo (cabeçalho) e fim do conteúdo, sem a lista de
 * advogados que o DJEN anexa ("- ADV: ..."), que repete nomes e não diz nada sobre o ato.
 */
export function miolo(texto: string): string {
  const corte = texto.search(/\s-\s?ADV(OGADO)?S?:\s/i);
  const conteudo = corte > 200 ? texto.slice(0, corte) : texto;
  return conteudo.length <= 2600 ? conteudo : `${conteudo.slice(0, 600)} … ${conteudo.slice(-2000)}`;
}

/** Prazo expresso no texto ("no prazo de 15 (quinze) dias") vence a regra padrão. */
export function prazoExpresso(texto: string): number | null {
  const m = /prazo\s+(?:comum\s+)?de\s+(\d{1,3})\s*(?:\([a-zçãéêíóú\s-]+\)\s*)?dias/i.exec(texto);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 120 ? n : null;
}

/**
 * Sugere o lançamento da controladoria para uma publicação.
 * `tipo` é o tipo DJEN ("Intimação", "Pauta de julgamento", "Ata de sessão"...).
 */
export function sugerirLancamento(entrada: { texto: string | null; classe?: string | null; tipo?: string | null }): Sugestao {
  const texto = limparTexto(entrada.texto);
  const movimento = extrairMovimento(texto);
  const alvo = semAcento(`${entrada.tipo ?? ''} | ${movimento ?? ''} | ${movimento ? '' : miolo(texto)}`);
  const insolvencia = ehInsolvencia(entrada.classe, texto);
  const regra = REGRAS.find((r) => r.teste.test(alvo) || (movimento ? r.teste.test(semAcento(movimento)) : false));
  const expresso = prazoExpresso(texto);
  const base: Regra = regra ?? { nome: 'padrao', teste: /./, acao: 'Analisar intimação + Manifestar', tituloFixo: 'Analisar intimação + Manifestar', dias: 5, fundamento: 'Sem ato identificado: 5 dias úteis (art. 218, § 3º, CPC) até a análise', confianca: 0.4 };
  const recursal = !!base.recursal;
  const regime: Regime = insolvencia && !recursal ? 'corridos' : 'uteis';
  const dias = expresso ?? base.dias;
  const ato = movimento ?? null;
  const titulo = (base.tituloFixo ?? (ato ? `${base.acao} - ${ato}` : base.acao)).slice(0, 200);
  const fundamento = [
    expresso ? `Prazo fixado no próprio ato: ${expresso} dias` : base.fundamento,
    regime === 'corridos' ? 'Processo de insolvência: dias corridos (art. 189, § 1º, I, Lei 11.101/2005)' : null,
  ].filter(Boolean).join('. ');
  const confianca = Math.min(0.95, base.confianca * (movimento ? 1 : 0.85) + (expresso ? 0.05 : 0));
  return { acao: base.acao, ato, titulo, dias, regime, recursal, fundamento, regra: base.nome, confianca: Math.round(confianca * 100) / 100, ...(base.observacao ? { observacao: base.observacao } : {}) };
}

/** Normaliza nome de pessoa para casar "Maurício Graboski" do Astrea com o cadastro do LAB. */
export const chaveDeNome = (n: string | null | undefined) => semAcento(String(n ?? '')).replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
