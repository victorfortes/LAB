/**
 * Organização interna dos documentos: cada arquivo que o cliente mandou (solto, em pasta ou dentro de ZIP/RAR)
 * vai para o item do checklist (art. 51 da Lei 11.101) que ele atende.
 *
 * A pista mais forte é a PASTA (o cliente costuma montar o ZIP com o próprio checklist) em que o cliente guardou o arquivo (o título do documento carrega o caminho:
 * "FITAFLEX / 4. Endividamento / 03. Contratos de financiamento / Bradesco / CCB.pdf"); depois o nome do arquivo;
 * por último o que a leitura do diagnóstico reconheceu no conteúdo (extrato, contrato de crédito, QGC...).
 * Um documento pode atender mais de um item ("Balanço + DRE"). O que não se encaixa fica sem item, à vista,
 * para a equipe decidir: a regra nunca aprova nada, só junta o arquivo ao item como "enviado".
 */

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim();

/** Títulos do modelo "Checklist RJ e RE" (modelos-oficiais.ts), na forma exata, para o vínculo por título. */
export const ITEM = {
  balanco: 'Balanço Patrimonial — 3 últimos exercícios sociais',
  dre: 'DRE — 3 últimos exercícios sociais',
  especial: 'Balanço Especial e DRE para fins de ajuizamento da RJ',
  acumulados: 'Demonstração de Resultados Acumulados — 3 últimos exercícios',
  fluxo: 'Fluxo de Caixa Gerencial realizado e projetado',
  extratos: 'Extratos bancários atualizados de todas as contas e aplicações',
  bens: 'Relação de Bens e Direitos — Ativo Não Circulante',
  fiduciaria: 'Contratos de Alienação Fiduciária (se houver)',
  leasing: 'Contratos de Leasing / Arrendamento Mercantil (se houver)',
  fiscal: 'Relatório detalhado do Passivo Fiscal',
  contratoSocial: 'Contratos Sociais e todas as alterações — incl. grupo econômico',
  atas: 'Atas de nomeação dos administradores atuais',
  financiamentos: 'Contratos de financiamento e empréstimos (todos)',
  irpf: 'IRPF dos sócios controladores — 2 últimos exercícios',
  bensSocios: 'Relação de bens particulares dos sócios controladores e administradores',
  credores: 'Lista completa de credores (trabalhistas, fornecedores, fiscal, etc.)',
  origem: 'Origem do crédito de cada credor',
  contatos: 'CNPJ/CPF, endereço, e-mail e telefone de cada credor',
  valores: 'Valor atualizado e regime de vencimentos de cada crédito',
  empregados: 'Lista completa de empregados — função, salário e demais parcelas',
  indenizacoes: 'Indenizações devidas e valores pendentes de pagamento',
  civeis: 'Lista de demandas cíveis em trâmite (autos, juízo, estimativa)',
  trabalhistas: 'Lista de demandas trabalhistas em trâmite (com estimativa)',
  arbitrais: 'Lista de procedimentos arbitrais em trâmite',
  grupo: 'Descrição das sociedades do grupo econômico (de fato ou de direito)',
  contratosGrupo: 'Contratos Sociais das demais empresas do grupo',
} as const;
export type ChaveDoItem = keyof typeof ITEM;

/** Regras em ordem: a primeira que casar decide (o específico vem antes do genérico). */
const REGRAS: { re: RegExp; itens: ChaveDoItem[]; so?: 'pasta' | 'nome' }[] = [
  // Material de apoio produzido pelo escritório (análises em HTML, saídas de ferramentas): não é entrega do cliente.
  { re: /claude outputs|^nga /, itens: [] },
  { re: /copel|conta de (luz|energia)|segunda ?via/, itens: [], so: 'nome' },
  // Pastas que não são item do modelo RJ/RE: param aqui para não herdar o item da pasta de cima.
  { re: /sindicato|convencao coletiva|acordo coletivo|licencas? (ambienta|de opera)|curva abc|faturamento|livro razao|sped|aging|estoques?/, itens: [], so: 'pasta' },
  { re: /\birpf\b|declaracao de (imposto de )?renda|recibo de entrega|\b(dr|rr) 20\d\d\b/, itens: ['irpf'] },
  { re: /bens particulares|patrimonio socios/, itens: ['bensSocios'] },
  { re: /contratos sociais das (sociedades|demais)|demais empresas do grupo|integradas por avalistas/, itens: ['contratosGrupo'] },
  { re: /grupo economico|bens grupo|patrimonio pjs|organograma societario/, itens: ['grupo'] },
  { re: /\batas?\b.*(nomeacao|eleicao|administrador)|nomeacao dos administradores/, itens: ['atas'] },
  { re: /contrato social|alteracao contratual|\d+\s*[ªaº°o]?\.?\s*alteracao|consolidacao contratual|cartao cnpj|\bcnpj\.pdf$|\bcnpj$/, itens: ['contratoSocial'] },
  { re: /balanco especial|balancete/, itens: ['especial'] },
  { re: /lucros? ou prejuizos? acumulados|mutacoes do patrimonio|\bdmpl\b|\bdlpa\b|resultados acumulados/, itens: ['acumulados'] },
  { re: /(balanco|banco|banço) ?\+ ?d\.?r\.?e|balanco e dre/, itens: ['balanco', 'dre'] },
  { re: /\bd\.?r\.?e\b|demonstracao do resultado/, itens: ['dre'] },
  { re: /balanco patrimonial|\bbalanco\b/, itens: ['balanco'] },
  { re: /fluxo de caixa/, itens: ['fluxo'] },
  { re: /extratos? bancario|\bextratos?\b/, itens: ['extratos'] },
  { re: /alienacao fiduciaria|acessao fiduciaria|cessao fiduciaria|avais|garantias prestadas/, itens: ['fiduciaria', 'financiamentos'] },
  { re: /leasing|arrendamento mercantil/, itens: ['leasing'] },
  { re: /passivo fiscal|situacao fiscal|parcelamentos?|transac(ao|oes) tributaria|pgfn|divida ativa/, itens: ['fiscal'] },
  { re: /contratos? de financiamento|emprestimos?|\bccb\b|cedula de credito|finimp|bordero|conta garantida|capital de giro/, itens: ['financiamentos'] },
  // Papel de banco sem pasta própria (saldo devedor, termo, procuração do banco): vai com os contratos.
  { re: /\b(cresol|sicredi|sicoob|bradesco|itau|santander|safra|daycoval|brde|banco do brasil)\b.*\b(saldo|termo|procuracao|\d{1,3}(\.\d{3})+)|\b(procuracao|termo de liberacao|liberacao pj)\b/, itens: ['financiamentos'], so: 'nome' },
  { re: /relacao (completa|integral|nominal) de credores|\bqgc\b|quadro geral de credores|lista de credores/, itens: ['credores'] },
  { re: /natureza de cada credito|origem de cada credito|lancamento contabil/, itens: ['origem'] },
  { re: /cnpj.?cpf.{0,4}endereco/, itens: ['contatos'] },
  { re: /valor atualizado e regime|endividamento|\bscr\b|registro scr|amortizacao/, itens: ['valores'] },
  { re: /relacao (integral|completa) dos empregados|relatorio de funcionarios|\bempregados\b(?!.*(sindicato|fgts|indeniza|rescis))|\bfuncionarios\b/, itens: ['empregados'] },
  { re: /indenizac|verbas rescisorias|fgts e inss em atraso/, itens: ['indenizacoes'] },
  { re: /demandas? trabalhistas|reclamac(ao|oes) trabalhista|reclamatoria/, itens: ['trabalhistas'] },
  { re: /arbitra(l|gem)/, itens: ['arbitrais'] },
  { re: /demandas? civeis|processos? (civeis|judiciais)|\bintim|\bcitacao\b|execuc(ao|oes) (fiscal|judicial|de titulo)/, itens: ['civeis'] },
  { re: /relacao de bens e direitos|ativo nao circulante|matriculas?|laudos?|avaliac|apolices?|\bcrlv\b|veiculos|maquinas|bens contabeis|imobilizado/, itens: ['bens'] },
];

/** O que o leitor de conteúdo reconheceu, quando nem pasta nem nome bastam. */
const POR_CONTEUDO: Record<string, ChaveDoItem[]> = {
  balanco: ['balanco'], dre_contabil: ['dre'], dre_gerencial: ['dre'], extrato: ['extratos'], contrato_credito: ['financiamentos'],
  qgc: ['credores'], endividamento: ['valores'], servico_divida: ['valores'], scr: ['valores'], fluxo_projetado: ['fluxo'],
  contrato_social: ['contratoSocial'], matricula: ['bens'], passivo_fonte: ['fiscal'],
};

export interface DocumentoParaOrganizar { titulo: string; nome: string; tipos?: string[] }

/**
 * Itens que o documento atende. O caminho é lido da pasta mais funda para a mais rasa: "Sócios / 03. Bens
 * particulares / A.J.V. Holding / BENS CONTÁBEIS.pdf" é bem de sócio, não ativo da empresa.
 */
export function itensDoDocumento(d: DocumentoParaOrganizar): { itens: ChaveDoItem[]; pista: 'pasta' | 'nome' | 'conteudo' | null } {
  const nome = norm(d.nome.replace(/\.[a-z0-9]{2,5}$/i, ''));
  const partes = d.titulo.split(' / ').map(norm); partes.pop();
  const pastas = partes.reverse();
  const casa = (texto: string, onde: 'pasta' | 'nome') => REGRAS.find((r) => (!r.so || r.so === onde) && r.re.test(texto));
  // Arquivo que claramente não é entrega (conta de luz no meio dos extratos) sai antes de herdar a pasta.
  const fora = REGRAS.find((r) => r.so === 'nome' && !r.itens.length && r.re.test(nome)); if (fora) return { itens: [], pista: 'nome' };
  // 1. a pasta em que o cliente guardou (da mais funda para cima): é o próprio checklist dele;
  for (const p of pastas) { const r = casa(p, 'pasta'); if (r) return r.itens.length ? { itens: r.itens, pista: 'pasta' } : porNomeOuConteudo(nome, d.tipos); }
  // 2. o nome do arquivo; 3. o que a leitura reconheceu no conteúdo.
  return porNomeOuConteudo(nome, d.tipos);
}

function porNomeOuConteudo(nome: string, tipos: string[] = []): { itens: ChaveDoItem[]; pista: 'nome' | 'conteudo' | null } {
  const r = REGRAS.find((x) => x.so !== 'pasta' && x.re.test(nome)); if (r?.itens.length) return { itens: r.itens, pista: 'nome' };
  for (const t of tipos) if (POR_CONTEUDO[t]) return { itens: POR_CONTEUDO[t]!, pista: 'conteudo' };
  return { itens: [], pista: null };
}
