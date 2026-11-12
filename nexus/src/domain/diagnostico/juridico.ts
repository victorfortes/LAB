/**
 * Leitura jurídica do diagnóstico, a partir do que os documentos mostram:
 *   1. mapa do endividamento por natureza, com a sujeição à recuperação
 *      judicial (art. 49 da Lei 11.101/2005) e a abrangência pela
 *      extrajudicial (arts. 161 a 163), e a "principal dor" do caso;
 *   2. enquadramento nos requisitos para pedir RJ (arts. 1º, 2º, 48 e 51) e RE
 *      (art. 161), separando o que está atendido, o que é indício e o que
 *      depende de certidão ou documento.
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

const CATEGORIA: Record<Categoria, { rj: 'sujeito' | 'nao_sujeito' | 'depende'; re: 'abrangido' | 'excluido' | 'depende'; fundamento: string }> = {
  'Tributário e parcelamentos': { rj: 'nao_sujeito', re: 'excluido', fundamento: 'Crédito tributário não se sujeita à RJ (art. 6º, § 7º-B, e art. 57 da Lei 11.101; art. 187 do CTN) nem à RE (art. 161, § 1º). O caminho é transação ou parcelamento (Lei 13.988/2020).' },
  'Trabalhista e encargos': { rj: 'sujeito', re: 'depende', fundamento: 'Salários e verbas trabalhistas se sujeitam à RJ como classe I, até 150 salários-mínimos por credor (art. 83, I) e com pagamento em até 1 ano (art. 54). Na RE, só com negociação coletiva com o sindicato (art. 161, § 1º). INSS e FGTS recolhidos de terceiros seguem a lógica tributária.' },
  'Fornecedores': { rj: 'sujeito', re: 'abrangido', fundamento: 'Quirografário (art. 83, VI) ou ME/EPP (art. 41, IV); sujeito à RJ (art. 49) e abrangível pela RE.' },
  'Bancos e financiamentos': { rj: 'depende', re: 'depende', fundamento: 'Sujeito à RJ se quirografário ou com garantia real (art. 41, II); fora da RJ se houver alienação ou cessão fiduciária, leasing ou ACC (art. 49, §§ 3º e 4º). Depende de cada contrato.' },
  'Garantia fiduciária e leasing': { rj: 'nao_sujeito', re: 'excluido', fundamento: 'Proprietário fiduciário e arrendador não se sujeitam (art. 49, § 3º); bens essenciais ficam protegidos no período de suspensão (art. 6º, § 4º).' },
  'Adiantamentos de clientes': { rj: 'sujeito', re: 'abrangido', fundamento: 'Se o produto não for entregue, o cliente vira credor quirografário (art. 83, VI). Saldo alto pede prova de lastro: sem contratos e notas, é ponto de impugnação (arts. 8º e 13) e de questionamento sobre a contabilidade.' },
  'Sócios e partes relacionadas': { rj: 'sujeito', re: 'depende', fundamento: 'Crédito de sócio sem vínculo empregatício é subordinado (art. 83, VIII, "b"); parte relacionada não vota para formar maioria (art. 43) e atos com ela podem ser revistos (art. 129).' },
  'Outras obrigações': { rj: 'depende', re: 'depende', fundamento: 'Natureza a definir conta a conta.' },
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
  categorias: { categoria: Categoria; valor: number; percentual: number; rj: string; re: string; fundamento: string; contas: { conta: string; valor: number; hipotese: boolean }[] }[];
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
}

const EXCLUIDAS = /(banco|financeira|cooperativa de credito|seguradora|previdencia|capitalizacao|consorcio|plano de saude|sociedade de credito|empresa publica|sociedade de economia mista)/;

export function enquadramento(e: EntradaDoEnquadramento) {
  const rs = n(e.razaoSocial ?? '');
  const tipo = /\b(ltda|limitada)\b/.test(rs) ? 'sociedade limitada' : /\b(s\.?a\.?|sociedade anonima)\b/.test(rs) ? 'sociedade anônima' : /\beireli\b/.test(rs) ? 'EIRELI (hoje transformada em sociedade limitada unipessoal)' : null;
  const comum: Requisito[] = [
    { requisito: 'Ser empresário ou sociedade empresária', fundamento: 'art. 1º', situacao: tipo ? 'atendido' : 'pendente', base: tipo ? `Razão social indica ${tipo}.` : 'Conferir o tipo societário no contrato social.' },
    { requisito: 'Não estar entre as atividades excluídas', fundamento: 'art. 2º', situacao: EXCLUIDAS.test(rs) ? 'impeditivo' : rs ? 'indicio' : 'pendente', base: EXCLUIDAS.test(rs) ? 'A razão social sugere atividade excluída (instituição financeira, seguradora, cooperativa de crédito etc.).' : 'Nada na razão social indica atividade excluída; confirmar o objeto social.' },
    { requisito: 'Exercer regularmente a atividade há mais de 2 anos', fundamento: 'art. 48, caput', situacao: e.primeiroExercicio && e.anoBase - e.primeiroExercicio >= 2 ? 'indicio' : 'pendente', base: e.primeiroExercicio ? `Há demonstrações desde ${e.primeiroExercicio}; a prova é a certidão da Junta Comercial (art. 51, V).` : 'Sem demonstração antiga entre os documentos; pedir certidão da Junta Comercial.' },
    { requisito: 'Não ser falido, ou ter as obrigações declaradas extintas', fundamento: 'art. 48, I', situacao: 'pendente', base: 'Pedir certidão de distribuição de falências e recuperações.' },
    { requisito: 'Não ter obtido RJ nos últimos 5 anos', fundamento: 'art. 48, II e III', situacao: 'pendente', base: 'Mesma certidão de distribuição.' },
    { requisito: 'Administrador ou sócio controlador sem condenação por crime falimentar', fundamento: 'art. 48, IV', situacao: 'pendente', base: 'Pedir certidões criminais dos sócios e administradores.' },
  ];
  const art51: Requisito = {
    requisito: 'Instruir a petição com os documentos obrigatórios', fundamento: 'art. 51', situacao: e.pendentesArt51.length ? 'pendente' : 'atendido',
    base: e.pendentesArt51.length ? `${e.pendentesArt51.length} item(ns) do checklist pendente(s), por exemplo: ${e.pendentesArt51.slice(0, 2).map((t) => (t.length > 60 ? `${t.slice(0, 57).trim()}...` : t).replace(/\.$/, '')).join('; ')}.` : 'Checklist sem pendências.',
  };
  const m = e.mapa;
  const pct = (v: number) => (m && m.total ? `${((v / m.total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '');
  const rj = {
    requisitos: [...comum, art51],
    alcance: m ? `Pelo passivo de ${m.fonte}, cerca de ${pct(m.sujeitoRj)} se sujeita à RJ, ${pct(m.foraDaRj)} fica fora e ${pct(m.aDefinir)} depende dos contratos.` : 'Sem passivo detalhado para medir o alcance da RJ.',
  };
  const re = {
    requisitos: [...comum.map((x) => ({ ...x, fundamento: `${x.fundamento} c/c art. 161` })),
      { requisito: 'Não ter pedido de RJ pendente nem ter obtido RJ ou homologação de RE há menos de 2 anos', fundamento: 'art. 161, § 3º', situacao: 'pendente' as Situacao, base: 'Conferir na certidão de distribuição.' },
      { requisito: 'Adesão de mais da metade dos créditos de cada espécie abrangida (pode-se pedir com 1/3 e completar em 90 dias)', fundamento: 'art. 163, caput e § 7º', situacao: 'pendente' as Situacao, base: m ? `Créditos abrangíveis pela RE somam cerca de ${pct(m.abrangivelRe)} do passivo; a adesão depende de negociação.` : 'Depende do passivo e da negociação.' }],
    alcance: m ? `A RE só alcança os créditos que ela pode abranger (cerca de ${pct(m.abrangivelRe)}); tributos, credores fiduciários e, sem negociação sindical, os trabalhistas ficam fora (art. 161, § 1º).` : 'Sem passivo detalhado para medir o alcance da RE.',
  };
  // Leitura de caminho: o que os números sugerem, sempre como hipótese de trabalho.
  const caminhos: string[] = [];
  if (m) {
    const fora = m.foraDaRj / m.total;
    if (fora >= 0.35) caminhos.push(`Mais de um terço do passivo fica fora da RJ (${pct(m.foraDaRj)}): sem tratar essa parte (transação tributária, acordo com credor fiduciário), a RJ não devolve fôlego de caixa.`);
    if (m.abrangivelRe / m.total >= 0.5) caminhos.push('Boa parte do passivo é abrangível pela RE; se houver poucos credores relevantes e diálogo com eles, a extrajudicial é mais rápida e barata que a judicial.');
    else caminhos.push('A parcela abrangível pela RE é pequena; a extrajudicial tende a não resolver o caso sozinha.');
  }
  if (e.patrimonioLiquido !== null && e.patrimonioLiquido < 0) caminhos.push('Patrimônio líquido negativo: a viabilidade econômica precisará ser demonstrada no plano (art. 53, II) e o administrador judicial e os credores vão examinar a contabilidade com lupa.');
  if (e.pendentesArt51.length) caminhos.push('Faltam documentos do art. 51: a petição seria emendada ou indeferida; completar antes de distribuir.');
  if (e.posicao === 'credor') caminhos.unshift('O NGA atua pelo credor: use este quadro para avaliar o risco do devedor e a estratégia de habilitação, impugnação ou objeção ao plano.');
  return { rj, re, caminhos };
}
