/**
 * Leitura jurídica do diagnóstico, a partir do que os documentos mostram:
 *   1. mapa do endividamento por natureza, com a sujeição à recuperação
 *      judicial (art. 49 da Lei 11.101/2005) e a abrangência pela
 *      extrajudicial (arts. 161 a 163), e a "principal dor" do caso;
 *   2. enquadramento nos requisitos para pedir RJ (arts. 1º, 2º, 48 e 51) e RE
 *      (arts. 161 a 163), separando o que está atendido, o que é indício e o que
 *      depende de certidão ou documento;
 *   3. documentos do art. 51 cruzados com o checklist e os quóruns de aprovação.
 * Redação conferida com a Lei 14.112/2020 (art. 6º, §§ 4º, 7º-A e 7º-B; art. 45-A;
 * art. 51, IX a XI; art. 51-A; art. 54, §§ 1º e 2º; art. 161, § 1º; art. 163, caput, §§ 6º a 8º).
 * Tudo é leitura indicativa para revisão: os fundamentos citam artigos, mas a
 * redação vigente e os julgados precisam ser conferidos antes de qualquer peça.
 */
import { classificarConta } from '../insolvencia/balancete.ts';
import type { NaturezaCredito } from '../insolvencia/creditos.ts';

export interface Ref { arquivo: string; local?: string }
export interface ContaDePassivo { conta: string; valor: number; grupo?: string | null }
export interface FonteDePassivo { fonte: string; ref: Ref; contas: ContaDePassivo[] }

const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Contas folha do passivo de um balanço vertical (só rótulo e saldo): o trecho
 * entre "PASSIVO" e "PATRIMÔNIO LÍQUIDO", sem os grupos. Uma linha é grupo
 * quando as linhas seguintes somam o valor dela.
 */
export function folhasDoPassivo(contas: readonly { conta: string; saldo: number }[]): ContaDePassivo[] {
  const ini = contas.findIndex((c) => /^passivo$/.test(n(c.conta)));
  const fim = contas.findIndex((c, i) => i > ini && /^patrimonio liquido/.test(n(c.conta)));
  if (ini < 0) return [];
  const trecho = contas.slice(ini + 1, fim < 0 ? undefined : fim).map((c) => ({ conta: c.conta, valor: Math.abs(c.saldo) }));
  const pular = (c: { conta: string }) => /^(passivo (circulante|nao[- ]circulante)|passivo exigivel a longo prazo|exigivel a longo prazo)$/.test(n(c.conta));
  // 1ª passada: candidatos a grupo (as linhas seguintes somam o valor) e o fim do bloco de cada um.
  const fimDoBloco = trecho.map((c, i) => {
    if (pular(c)) return -1;
    let soma = 0, j = i + 1;
    while (j < trecho.length && !pular(trecho[j]!) && soma + 0.5 < c.valor) { soma += trecho[j]!.valor; j++; }
    return j > i + 1 && Math.abs(soma - c.valor) <= 1 ? j : -1;
  });
  // 2ª passada: um "grupo" cujo único filho é outro grupo de nome diferente é, na verdade, uma conta folha
  // que só coincide em valor com o grupo seguinte (FORNECEDORES 7 mi seguido de OBRIGAÇÕES TRIBUTÁRIAS 7 mi).
  const ehGrupo = (i: number) => {
    const j = fimDoBloco[i]!; if (j < 0) return false;
    if (j === i + 2 && fimDoBloco[i + 1]! >= 0 && n(trecho[i + 1]!.conta) !== n(trecho[i]!.conta)) return false;
    return true;
  };
  const folhas: ContaDePassivo[] = []; let grupo: string | null = null;
  trecho.forEach((c, i) => {
    if (pular(c)) return;
    if (ehGrupo(i)) { grupo = c.conta; return; }
    folhas.push({ conta: c.conta, valor: c.valor, grupo });
  });
  return folhas;
}

type Categoria = 'Tributário e parcelamentos' | 'Trabalhista e encargos' | 'Fornecedores' | 'Bancos e financiamentos' | 'Garantia fiduciária e leasing'
  | 'Adiantamentos de clientes' | 'Sócios e partes relacionadas' | 'Outras obrigações';

/**
 * Natureza de cada grupo do passivo diante da Lei 11.101/2005, na redação da Lei 14.112/2020.
 * `classe` é a classe de votação na assembleia (art. 41); "fora" quando o crédito não se sujeita à RJ.
 */
export const CATEGORIA: Record<Categoria, { rj: 'sujeito' | 'nao_sujeito' | 'depende'; re: 'abrangido' | 'excluido' | 'depende'; classe: string; fundamento: string }> = {
  'Tributário e parcelamentos': { rj: 'nao_sujeito', re: 'excluido', classe: 'Não concorre',
    fundamento: 'O crédito tributário não se sujeita à RJ: as execuções fiscais não se suspendem (art. 6º, § 7º-B) e a cobrança não se sujeita a concurso (art. 187 do CTN); a concessão exige certidão de regularidade fiscal (art. 57). Também fica fora da RE (art. 161, § 1º). Tratar por transação ou parcelamento próprio de empresa em recuperação (arts. 10-A a 10-C da Lei 10.522/2002, com a redação da Lei 14.112/2020; Lei 13.988/2020). O FGTS não é tributo (Súmula 353 do STJ), mas é cobrado por execução fiscal (Lei 8.844/1994): conferir a sujeição caso a caso.' },
  'Trabalhista e encargos': { rj: 'sujeito', re: 'depende', classe: 'Classe I (art. 41, I)',
    fundamento: 'Créditos derivados da legislação do trabalho e de acidente de trabalho votam na classe I (art. 41, I). O plano deve pagá-los em até 1 ano (art. 54, caput), prazo que pode ser estendido em até 2 anos nas condições cumulativas do art. 54, § 2º, e os salários dos 3 meses anteriores ao pedido, até 5 salários-mínimos, em até 30 dias (art. 54, § 1º). O limite de 150 salários-mínimos do art. 83, I, rege a classificação na falência. Na RE, só com negociação coletiva com o sindicato (art. 161, § 1º).' },
  'Fornecedores': { rj: 'sujeito', re: 'abrangido', classe: 'Classe III ou IV (art. 41, III e IV)',
    fundamento: 'Crédito quirografário vota na classe III; o de microempresa ou empresa de pequeno porte, na classe IV (art. 41, III e IV). Sujeito à RJ (art. 49, caput) e abrangível pela RE (art. 163, § 1º).' },
  'Bancos e financiamentos': { rj: 'depende', re: 'depende', classe: 'Classe II ou III, ou fora',
    fundamento: 'Crédito com garantia real vota na classe II até o valor do bem (art. 41, II, e § 2º); o restante e o crédito sem garantia, na classe III. Fica fora da RJ e da RE o credor com alienação ou cessão fiduciária, arrendamento mercantil (art. 49, § 3º) e adiantamento de contrato de câmbio (art. 49, § 4º, e art. 86, II; art. 161, § 1º). Depende de cada contrato.' },
  'Garantia fiduciária e leasing': { rj: 'nao_sujeito', re: 'excluido', classe: 'Fora (art. 49, §§ 3º e 4º)',
    fundamento: 'Proprietário fiduciário, arrendador mercantil, vendedor com reserva de domínio e credor de ACC não se sujeitam à RJ (art. 49, §§ 3º e 4º) nem à RE (art. 161, § 1º). Durante o prazo de suspensão (art. 6º, § 4º: 180 dias, prorrogável uma vez), não se admite a venda ou retirada dos bens de capital essenciais à atividade (art. 49, § 3º, parte final; art. 6º, § 7º-A).' },
  'Adiantamentos de clientes': { rj: 'sujeito', re: 'abrangido', classe: 'Classe III (art. 41, III)',
    fundamento: 'Cliente que pagou e não recebeu é credor do devedor e se sujeita à RJ (art. 49, caput), na classe III (art. 41, III); a relação de credores precisa incluir as obrigações de dar ou de fazer (art. 51, III). Saldo alto pede prova de lastro: sem contratos e notas, é ponto de impugnação (art. 8º) e de questionamento sobre a contabilidade.' },
  'Sócios e partes relacionadas': { rj: 'sujeito', re: 'depende', classe: 'Classe III, sem voto (art. 43)',
    fundamento: 'Crédito de sócio, coligada, controladora ou controlada participa da assembleia sem direito a voto e não conta para o quórum (art. 43); na RE, também não entra no cálculo da adesão (art. 163, § 3º, II). Na falência, o crédito de sócio ou administrador sem vínculo empregatício contratado fora de condições comutativas é subordinado (art. 83, VIII, "b") e os atos com partes relacionadas podem ser revistos (arts. 129 e 130).' },
  'Outras obrigações': { rj: 'depende', re: 'depende', classe: 'A definir', fundamento: 'Natureza a definir conta a conta (arts. 41, 49 e 83).' },
};

function categoria(natureza: NaturezaCredito, conta: string): Categoria {
  const c = n(conta);
  if (/adiantamentos? (de|a) clientes|clientes adiantamentos/.test(c)) return 'Adiantamentos de clientes';
  if (natureza === 'tributario') return 'Tributário e parcelamentos';
  if (natureza === 'trabalhista' || natureza === 'acidente_trabalho' || /(obrigacoes sociais|obrigacoes com o pessoal|inss|fgts)/.test(c)) return /(inss|fgts|obrigacoes sociais)/.test(c) ? 'Tributário e parcelamentos' : 'Trabalhista e encargos';
  if (natureza === 'proprietario_fiduciario' || natureza === 'arrendamento_mercantil' || natureza === 'adiantamento_contrato_cambio') return 'Garantia fiduciária e leasing';
  if (natureza === 'subordinado') return 'Sócios e partes relacionadas';
  if (/(emprestimo|financiamento|banco|duplicatas descontadas|fomento|factoring|fidc|capital de giro)/.test(c)) return 'Bancos e financiamentos';
  if (/(fornecedor|contas a pagar)/.test(c) || natureza === 'me_epp') return 'Fornecedores';
  return 'Outras obrigações';
}

export interface MapaDoEndividamento {
  fonte: string; ref: Ref; total: number;
  categorias: { categoria: Categoria; valor: number; percentual: number; rj: string; re: string; classe: string; fundamento: string; contas: { conta: string; valor: number; hipotese: boolean }[] }[];
  sujeitoRj: number; foraDaRj: number; aDefinir: number; abrangivelRe: number;
  principalDor: { categoria: string; valor: number; percentual: number; texto: string } | null;
}

export function mapaDoEndividamento(f: FonteDePassivo): MapaDoEndividamento | null {
  const contas = f.contas.filter((c) => c.valor > 0);
  const total = contas.reduce((s, c) => s + c.valor, 0); if (!total) return null;
  const grupos = new Map<Categoria, { conta: string; valor: number; hipotese: boolean }[]>();
  for (const c of contas) {
    const cl = classificarConta(c.conta, c.grupo ?? null); const cat = categoria(cl.natureza, `${c.conta} ${c.grupo ?? ''}`);
    grupos.set(cat, [...(grupos.get(cat) ?? []), { conta: c.conta, valor: r2(c.valor), hipotese: cl.hipotese }]);
  }
  const categorias = [...grupos].map(([cat, cs]) => { const v = cs.reduce((s, x) => s + x.valor, 0); return { categoria: cat, valor: r2(v), percentual: r2((v / total) * 100), ...CATEGORIA[cat], contas: cs.sort((a, b) => b.valor - a.valor) }; })
    .sort((a, b) => b.valor - a.valor);
  const soma = (pred: (c: (typeof categorias)[number]) => boolean) => r2(categorias.filter(pred).reduce((s, c) => s + c.valor, 0));
  const top = categorias[0]!;
  const fora = soma((c) => c.rj === 'nao_sujeito');
  // A dor principal é a maior fatia; se ela fica fora da RJ, isso muda a estratégia e precisa ser dito.
  const texto = top.rj === 'nao_sujeito'
    ? `A maior fatia do passivo (${top.categoria}, ${top.percentual.toLocaleString('pt-BR')}%) não se sujeita à recuperação judicial. A RJ sozinha não resolve: é preciso tratar essa dívida em paralelo (transação tributária, negociação com o credor fiduciário).`
    : top.categoria === 'Adiantamentos de clientes'
      ? `A maior fatia do passivo são adiantamentos de clientes (${top.percentual.toLocaleString('pt-BR')}%). Antes de qualquer pedido, é preciso provar o lastro (contratos, pedidos, notas) e saber quem são esses clientes: sem isso, a lista de credores fica vulnerável e o número pode esconder outra operação.`
      : `A maior fatia do passivo é ${top.categoria.toLowerCase()} (${top.percentual.toLocaleString('pt-BR')}%), que se sujeita à recuperação. ${fora ? `Mesmo assim, ${((fora / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do passivo fica fora da RJ e pede tratamento próprio.` : ''}`;
  return {
    fonte: f.fonte, ref: f.ref, total: r2(total), categorias,
    sujeitoRj: soma((c) => c.rj === 'sujeito'), foraDaRj: fora, aDefinir: soma((c) => c.rj === 'depende'), abrangivelRe: soma((c) => c.re === 'abrangido'),
    principalDor: { categoria: top.categoria, valor: top.valor, percentual: top.percentual, texto },
  };
}

// --------------------------------------------------------------- enquadramento ---

export type Situacao = 'atendido' | 'indicio' | 'pendente' | 'impeditivo';
export interface Requisito { requisito: string; fundamento: string; situacao: Situacao; base: string }

/** Item do checklist já com o status calculado (ver `coberturaDoChecklist`). */
export interface ItemParaArt51 { titulo: string; artigo: string | null; status: string }

export interface EntradaDoEnquadramento {
  razaoSocial: string | null;
  /** Exercício mais antigo com demonstração entre os documentos. */
  primeiroExercicio: number | null;
  anoBase: number;
  /** Itens do art. 51 ainda pendentes no checklist. */
  pendentesArt51: string[];
  mapa: MapaDoEndividamento | null;
  patrimonioLiquido: number | null;
  posicao: 'devedor' | 'credor';
  /** Checklist com status, para cruzar com os incisos do art. 51. */
  checklist?: ItemParaArt51[];
}

const EXCLUIDAS = /(banco|financeira|cooperativa de credito|seguradora|previdencia|capitalizacao|consorcio|plano de saude|sociedade de credito|empresa publica|sociedade de economia mista)/;

/**
 * Documentos que instruem a petição de RJ (art. 51, com a redação da Lei 14.112/2020). `chaves` reconhece o
 * item do checklist pelo título quando ele não traz o fundamento.
 */
export const DOCUMENTOS_ART51: readonly { inciso: string; documento: string; chaves: RegExp }[] = [
  { inciso: 'I', documento: 'Exposição das causas concretas da situação patrimonial e das razões da crise', chaves: /causas da crise|exposicao das causas/ },
  { inciso: 'II', documento: 'Demonstrações contábeis dos 3 últimos exercícios e as levantadas para o pedido (balanço, resultados acumulados, resultado desde o último exercício, fluxo de caixa e projeção, descrição do grupo societário)', chaves: /balanco|\bdre\b|demonstrac|fluxo de caixa|resultados acumulados|grupo economico/ },
  { inciso: 'III', documento: 'Relação nominal completa dos credores, sujeitos ou não à RJ, com endereço físico e eletrônico, natureza (arts. 83 e 84), valor atualizado, origem e vencimentos', chaves: /credores|credor/ },
  { inciso: 'IV', documento: 'Relação integral dos empregados, com funções, salários, indenizações e valores pendentes', chaves: /empregados|folha de pagamento/ },
  { inciso: 'V', documento: 'Certidão de regularidade na Junta Comercial, ato constitutivo atualizado e atas de nomeação dos administradores', chaves: /contrato social|junta comercial|ato constitutivo|atas? de nomeacao|estatuto/ },
  { inciso: 'VI', documento: 'Relação dos bens particulares dos sócios controladores e dos administradores', chaves: /bens particulares|irpf dos socios|bens dos socios/ },
  { inciso: 'VII', documento: 'Extratos atualizados das contas bancárias e das aplicações financeiras', chaves: /extratos?/ },
  { inciso: 'VIII', documento: 'Certidões dos cartórios de protesto da sede e das filiais', chaves: /protesto/ },
  { inciso: 'IX', documento: 'Relação das ações judiciais e procedimentos arbitrais, inclusive trabalhistas, com a estimativa dos valores', chaves: /demandas|acoes judiciais|arbitra|processos judiciais/ },
  { inciso: 'X', documento: 'Relatório detalhado do passivo fiscal', chaves: /passivo fiscal/ },
  { inciso: 'XI', documento: 'Relação de bens e direitos do ativo não circulante, com os negócios celebrados com os credores do art. 49, § 3º', chaves: /ativo nao circulante|alienacao fiduciaria|leasing|arrendamento/ },
];

export type SituacaoDoDocumento = 'entregue' | 'parcial' | 'pendente' | 'fora_do_checklist';
export interface DocumentoDoArt51 { inciso: string; fundamento: string; documento: string; situacao: SituacaoDoDocumento; itens: number; entregues: number }

const incisoDe = (artigo: string | null) => { const m = /art\.?\s*51\s*,\s*([IVXL]+)\b/i.exec(artigo ?? ''); return m ? m[1]!.toUpperCase() : null; };

/** Cruza o checklist com os incisos do art. 51: pelo fundamento do item ou, sem ele, pelo título. */
export function documentosDoArt51(itens: readonly ItemParaArt51[]): DocumentoDoArt51[] {
  return DOCUMENTOS_ART51.map((d) => {
    const doInciso = itens.filter((i) => { const x = incisoDe(i.artigo); return x ? x === d.inciso : !i.artigo && d.chaves.test(n(i.titulo)); });
    const entregues = doInciso.filter((i) => i.status === 'entregue').length;
    const situacao: SituacaoDoDocumento = !doInciso.length ? 'fora_do_checklist' : entregues === doInciso.length ? 'entregue' : entregues || doInciso.some((i) => i.status === 'parcial') ? 'parcial' : 'pendente';
    return { inciso: d.inciso, fundamento: `art. 51, ${d.inciso}`, documento: d.documento, situacao, itens: doInciso.length, entregues };
  });
}

/** Quóruns de aprovação: texto de referência, com o dispositivo. */
export const QUORUNS = {
  rj: [
    { regra: 'Classes I e IV: maioria simples dos credores presentes, por cabeça', fundamento: 'art. 45, § 2º' },
    { regra: 'Classes II e III: mais da metade do valor dos créditos presentes e, cumulativamente, maioria simples dos credores presentes', fundamento: 'art. 45, § 1º' },
    { regra: 'Sem direito a voto: sócios, coligadas, controladoras, controladas e parentes; credor cujo crédito o plano não altera', fundamento: 'art. 43 e art. 45, § 3º' },
    { regra: 'Aprovação pelo juiz sem a maioria de todas as classes (cram down): mais da metade do valor de todos os créditos presentes; aprovação de 3 classes (ou 2, se só houver 3 votantes; ou 1, se só houver 2); e mais de 1/3 na classe que rejeitou', fundamento: 'art. 58, § 1º' },
    { regra: 'A assembleia pode ser substituída por termo de adesão de credores que atinjam o mesmo quórum', fundamento: 'art. 45-A' },
    { regra: 'Rejeitado o plano, o administrador judicial submete à assembleia a concessão de 30 dias para os credores apresentarem plano próprio', fundamento: 'art. 56, §§ 4º a 6º' },
  ],
  re: [
    { regra: 'Homologação com a adesão de todos os credores atingidos pelo plano', fundamento: 'art. 162' },
    { regra: 'Homologação que obriga todos os credores abrangidos: assinatura de mais da metade dos créditos de cada espécie abrangida', fundamento: 'art. 163, caput' },
    { regra: 'Pedido com pelo menos 1/3 dos créditos de cada espécie e compromisso de atingir a maioria em 90 dias improrrogáveis, com conversão em RJ facultada ao devedor', fundamento: 'art. 163, § 7º' },
    { regra: 'Não entram no cálculo os créditos das pessoas do art. 43 nem os não incluídos no plano', fundamento: 'art. 163, §§ 2º e 3º, II' },
    { regra: 'Suspensão do art. 6º desde o pedido, só para as espécies abrangidas, ratificada se comprovado o quórum inicial', fundamento: 'art. 163, § 8º' },
  ],
} as const;

export function enquadramento(e: EntradaDoEnquadramento) {
  const rs = n(e.razaoSocial ?? '');
  const tipo = /\b(ltda|limitada)\b/.test(rs) ? 'sociedade limitada' : /\b(s\.?a\.?|sociedade anonima)\b/.test(rs) ? 'sociedade anônima' : /\beireli\b/.test(rs) ? 'EIRELI (hoje transformada em sociedade limitada unipessoal)' : null;
  const comum: Requisito[] = [
    { requisito: 'Ser empresário ou sociedade empresária', fundamento: 'art. 1º', situacao: tipo ? 'atendido' : 'pendente', base: tipo ? `Razão social indica ${tipo}; conferir o registro na Junta Comercial.` : 'Conferir o tipo societário no contrato social.' },
    { requisito: 'Não estar entre as atividades excluídas (empresa pública, sociedade de economia mista, instituição financeira, cooperativa de crédito, seguradora, operadora de plano de saúde e equiparadas)', fundamento: 'art. 2º', situacao: EXCLUIDAS.test(rs) ? 'impeditivo' : rs ? 'indicio' : 'pendente', base: EXCLUIDAS.test(rs) ? 'A razão social sugere atividade excluída.' : 'Nada na razão social indica atividade excluída; confirmar o objeto social.' },
    { requisito: 'Exercer regularmente a atividade há mais de 2 anos', fundamento: 'art. 48, caput', situacao: e.primeiroExercicio && e.anoBase - e.primeiroExercicio >= 2 ? 'indicio' : 'pendente', base: e.primeiroExercicio ? `Há demonstrações desde ${e.primeiroExercicio}; a prova é a certidão da Junta Comercial (art. 51, V).` : 'Sem demonstração antiga entre os documentos; pedir certidão da Junta Comercial.' },
    { requisito: 'Não ser falido ou, se foi, ter as responsabilidades declaradas extintas por sentença transitada em julgado', fundamento: 'art. 48, I', situacao: 'pendente', base: 'Pedir certidão de distribuição de falências e recuperações.' },
    { requisito: 'Não ter obtido concessão de RJ, comum ou especial, há menos de 5 anos', fundamento: 'art. 48, II e III', situacao: 'pendente', base: 'Mesma certidão de distribuição.' },
    { requisito: 'Não ter sido condenado, nem ter administrador ou sócio controlador condenado, por crime da Lei 11.101', fundamento: 'art. 48, IV', situacao: 'pendente', base: 'Pedir certidões criminais da empresa, dos sócios e dos administradores.' },
  ];
  const docs51 = documentosDoArt51(e.checklist ?? []);
  const faltam51 = docs51.filter((d) => d.situacao !== 'entregue');
  const art51: Requisito = {
    requisito: 'Instruir a petição com os documentos obrigatórios', fundamento: 'art. 51', situacao: e.pendentesArt51.length || (e.checklist && faltam51.length) ? 'pendente' : 'atendido',
    base: e.pendentesArt51.length ? `${e.pendentesArt51.length} item(ns) do checklist pendente(s), por exemplo: ${e.pendentesArt51.slice(0, 2).map((t) => (t.length > 60 ? `${t.slice(0, 57).trim()}...` : t).replace(/\.$/, '')).join('; ')}.`
      : e.checklist && faltam51.length ? `Incisos sem documento entregue: ${faltam51.map((d) => d.inciso).join(', ')}.` : 'Checklist sem pendências.',
  };
  const m = e.mapa;
  const pct = (v: number) => (m && m.total ? `${((v / m.total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '');
  const rj = {
    requisitos: [...comum, art51],
    alcance: m ? `Pelo passivo de ${m.fonte}, cerca de ${pct(m.sujeitoRj)} se sujeita à RJ, ${pct(m.foraDaRj)} fica fora e ${pct(m.aDefinir)} depende dos contratos.` : 'Sem passivo detalhado para medir o alcance da RJ.',
  };
  const re = {
    requisitos: [...comum.map((x) => ({ ...x, fundamento: `${x.fundamento} c/c art. 161` })),
      { requisito: 'Não ter pedido de RJ pendente nem ter obtido RJ ou homologação de outro plano de RE há menos de 2 anos', fundamento: 'art. 161, § 3º', situacao: 'pendente' as Situacao, base: 'Conferir na certidão de distribuição.' },
      { requisito: 'Adesão de mais da metade dos créditos de cada espécie abrangida (pode-se pedir com 1/3 e completar em 90 dias)', fundamento: 'art. 163, caput e § 7º', situacao: 'pendente' as Situacao, base: m ? `Créditos abrangíveis pela RE somam cerca de ${pct(m.abrangivelRe)} do passivo; a adesão depende de negociação.` : 'Depende do passivo e da negociação.' },
      { requisito: 'Instruir o pedido com a justificativa e o plano assinado, a exposição da situação patrimonial, as demonstrações do último exercício e as levantadas para o pedido, os poderes dos signatários e a relação nominal de credores', fundamento: 'arts. 162 e 163, § 6º', situacao: (e.checklist && docs51.filter((d) => ['II', 'III'].includes(d.inciso)).some((d) => d.situacao !== 'entregue')) || e.pendentesArt51.length ? 'pendente' as Situacao : 'indicio' as Situacao, base: 'Os mesmos documentos dos incisos II e III do art. 51, mais procurações e atos de quem assina.' }],
    alcance: m ? `A RE só alcança os créditos que ela pode abranger (cerca de ${pct(m.abrangivelRe)}); tributos, credores fiduciários, arrendadores e ACC ficam fora, e os trabalhistas só entram com negociação sindical (art. 161, § 1º).` : 'Sem passivo detalhado para medir o alcance da RE.',
  };
  // Leitura de caminho: o que os números sugerem, sempre como hipótese de trabalho.
  const caminhos: string[] = [];
  if (m) {
    const fora = m.foraDaRj / m.total;
    if (fora >= 0.35) caminhos.push(`Mais de um terço do passivo fica fora da RJ (${pct(m.foraDaRj)}): sem tratar essa parte (transação tributária, acordo com credor fiduciário), a RJ não devolve fôlego de caixa.`);
    if (m.abrangivelRe / m.total >= 0.5) caminhos.push('Boa parte do passivo é abrangível pela RE; se houver poucos credores relevantes e diálogo com eles, a extrajudicial é mais rápida e barata que a judicial, e o pedido já suspende as execuções das espécies abrangidas (art. 163, § 8º).');
    else caminhos.push('A parcela abrangível pela RE é pequena; a extrajudicial tende a não resolver o caso sozinha.');
  }
  if (e.patrimonioLiquido !== null && e.patrimonioLiquido < 0) caminhos.push('Patrimônio líquido negativo: a viabilidade econômica precisará ser demonstrada no plano (art. 53, II), e o juiz pode determinar constatação prévia das condições de funcionamento e da documentação (art. 51-A).');
  if (e.pendentesArt51.length || (e.checklist && faltam51.length)) caminhos.push('Faltam documentos do art. 51: a petição seria emendada ou indeferida; completar antes de distribuir.');
  if (e.posicao === 'credor') caminhos.unshift('O NGA atua pelo credor: use este quadro para avaliar o risco do devedor e a estratégia de habilitação, impugnação (art. 8º) ou objeção ao plano (art. 55).');
  return { comuns: comum, rj, re, caminhos, documentosArt51: docs51, quoruns: QUORUNS };
}
