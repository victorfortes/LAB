/**
 * Raio X da empresa em crise, a partir dos documentos juntados.
 *
 * Determinístico: cada número aponta o documento e a linha de onde veio, e o que
 * não foi lido aparece como não lido. O relatório orienta a revisão do advogado;
 * não conclui sobre viabilidade nem substitui a análise contábil e jurídica.
 * Teses citadas são ponto de partida: conferir vigência e julgados atuais antes de usar.
 */
export type TipoDocumental = 'dre' | 'balanco' | 'fluxo_caixa' | 'relacao_credores' | 'relacao_empregados' | 'frota' | 'certidao' | 'contrato_credito' | 'extrato' | 'societario' | 'passivo_fiscal' | 'processos' | 'bens' | 'outro';
export interface DocumentoLido { readonly id: string; readonly titulo: string; readonly texto: string }
export interface Evidencia { readonly documento: string; readonly trecho: string }
export interface Ponto { readonly gravidade: 'critico' | 'atencao' | 'info'; readonly area: string; readonly titulo: string; readonly detalhe: string; readonly evidencia?: Evidencia }
export interface Indicador { readonly id: string; readonly nome: string; readonly valor: number; readonly formato: 'x' | '%'; readonly leitura: 'bom' | 'atencao' | 'critico'; readonly referencia: string; readonly formula: string }

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CLASSIFICADOR: Array<[TipoDocumental, RegExp]> = [
  ['dre', /demonstra\w+ d[oe]s? resultado|\bd\.?r\.?e\.?\b|receita (operacional )?(bruta|liquida)/],
  ['balanco', /balanco patrimonial|balancete|ativo circulante/],
  ['fluxo_caixa', /fluxo de caixa|\bdfc\b/],
  ['relacao_credores', /rela\w+ (nominal )?d?e? ?credores|quadro (geral )?de credores/],
  ['relacao_empregados', /rela\w+ d[eo]s? (empregados|funcionarios)|folha de pagamento/],
  ['frota', /renavam|\bfrota\b|crlv|placa\b/],
  ['passivo_fiscal', /passivo fiscal|parcelamento (fiscal|tributario)|divida ativa/],
  ['certidao', /certid[aã]o|protesto/],
  ['contrato_credito', /cedula de credito|\bccb\b|alienacao fiduciaria|cessao fiduciaria|contrato de (financiamento|mutuo|emprestimo)/],
  ['extrato', /extrato (bancario|de conta)|saldo anterior/],
  ['societario', /contrato social|junta comercial|quadro societario/],
  ['processos', /relacao de (acoes|processos)|acoes judiciais/],
  ['bens', /ativo nao circulante|relacao de bens|bens particulares/],
];
export function classificar(d: DocumentoLido): TipoDocumental {
  const t = sem(`${d.titulo}\n${d.texto.slice(0, 6000)}`);
  // Título manda quando é explícito; só depois o conteúdo, para não confundir DRE com balanço citado nela.
  const t0 = sem(d.titulo);
  return CLASSIFICADOR.find(([, r]) => r.test(t0))?.[0] ?? CLASSIFICADOR.find(([, r]) => r.test(t))?.[0] ?? 'outro';
}

const NUM = /\(?-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\)?|\(?-?\d+,\d{2}\)?/g;
const paraNumero = (s: string) => { const neg = /^\(|^-/.test(s); const n = Number(s.replace(/[()\-.]/g, '').replace(',', '.')); return neg ? -n : n; };

/** Ordem das colunas: anos crescentes no cabeçalho indicam que o exercício atual é a última coluna. */
function colunaAtualEhUltima(linhas: readonly string[]): boolean {
  for (const l of linhas.slice(0, 40)) { const a = [...l.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1])); if (a.length >= 2) return a[a.length - 1]! > a[0]!; }
  return false;
}
interface Linha { atual: number; anterior: number | null; evidencia: Evidencia }
function buscar(docs: readonly DocumentoLido[], padrao: RegExp): Linha | null {
  for (const d of docs) {
    const linhas = d.texto.split(/\r?\n/); const ultima = colunaAtualEhUltima(linhas);
    for (const bruta of linhas) {
      const l = sem(bruta); const m = padrao.exec(l); if (!m) continue;
      const nums = (bruta.slice(m.index + m[0].length).match(NUM) ?? []).map(paraNumero); if (!nums.length) continue;
      return { atual: ultima ? nums[nums.length - 1]! : nums[0]!, anterior: nums.length > 1 ? (ultima ? nums[nums.length - 2]! : nums[1]!) : null, evidencia: { documento: d.titulo, trecho: bruta.trim().slice(0, 200) } };
    }
  }
  return null;
}

const CONTAS = {
  ac: /^\W*ativo circulante/, anc: /^\W*ativo nao circulante/, at: /^\W*(total do ativo|ativo total)/, pc: /^\W*passivo circulante/, pnc: /^\W*passivo nao circulante/,
  pl: /^\W*patrimonio liquido|passivo a descoberto/, disp: /^\W*(disponibilidades|disponivel|caixa e equivalentes)/, est: /^\W*estoques?/, rlp: /^\W*realizavel a longo prazo/, cli: /^\W*(clientes|contas a receber|duplicatas a receber)/, forn: /^\W*fornecedores/, emp: /^\W*(emprestimos|financiamentos)/, trib: /^\W*(obrigacoes tributarias|impostos a recolher|tributos a recolher)/,
};
const RESULTADO = {
  rb: /^\W*receita (operacional )?bruta/, rl: /^\W*receita (operacional )?liquida/, cmv: /^\W*(custos?( das?| dos?)|cmv|cpv|csp)/, lb: /^\W*(lucro|resultado) bruto/, ebit: /^\W*(resultado|lucro) operacional|^\W*resultado antes do resultado financeiro/, df: /^\W*despesas? financeiras?/, ll: /^\W*(lucro|prejuizo|resultado)( liquido)?( do (exercicio|periodo))?\b/, dep: /^\W*depreciacao/,
};

const ind = (id: string, nome: string, valor: number, formato: 'x' | '%', bom: number, ruim: number, referencia: string, formula: string, maiorMelhor = true): Indicador => ({ id, nome, valor: Number(valor.toFixed(4)), formato, leitura: (maiorMelhor ? valor >= bom : valor <= bom) ? 'bom' : (maiorMelhor ? valor < ruim : valor > ruim) ? 'critico' : 'atencao', referencia, formula });

const PLACA = /\b[A-Z]{3}[-\s]?\d[A-Z0-9]\d{2}\b/g;
export function analisarFrota(docs: readonly DocumentoLido[]) {
  const veiculos = new Map<string, { placa: string; ano: number | null; onerado: boolean; restricao: boolean; documento: string }>();
  for (const d of docs) for (const l of d.texto.split(/\r?\n/)) for (const m of l.toUpperCase().match(PLACA) ?? []) {
    const placa = m.replace(/[-\s]/g, ''); const s = sem(l);
    const ano = [...l.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((x) => Number(x[1])).sort().at(-1) ?? null;
    const a = veiculos.get(placa) ?? { placa, ano, onerado: false, restricao: false, documento: d.titulo };
    a.onerado ||= /aliena|fiduciari|leasing|arrendamento|reserva de dominio|gravame/.test(s); a.restricao ||= /bloqueio|penhora|renajud|restricao judicial|busca e apreensao/.test(s); a.ano ??= ano;
    veiculos.set(placa, a);
  }
  const lista = [...veiculos.values()]; if (!lista.length) return null;
  const comAno = lista.filter((v) => v.ano); const ano = new Date().getFullYear();
  return { total: lista.length, onerados: lista.filter((v) => v.onerado).length, comRestricao: lista.filter((v) => v.restricao).length, idadeMedia: comAno.length ? Number((comAno.reduce((a, v) => a + ano - v.ano!, 0) / comAno.length).toFixed(1)) : null, semAno: lista.length - comAno.length, veiculos: lista.slice(0, 300) };
}

const REQUISITOS: Array<{ inciso: string; item: string; tipos: readonly TipoDocumental[] }> = [
  { inciso: 'Art. 51, II', item: 'Balanço patrimonial e demonstrações', tipos: ['balanco', 'dre'] }, { inciso: 'Art. 51, II, d', item: 'Fluxo de caixa e projeção', tipos: ['fluxo_caixa'] },
  { inciso: 'Art. 51, III', item: 'Relação nominal de credores', tipos: ['relacao_credores'] }, { inciso: 'Art. 51, IV', item: 'Relação de empregados', tipos: ['relacao_empregados'] },
  { inciso: 'Art. 51, V', item: 'Registro e atos constitutivos', tipos: ['societario'] }, { inciso: 'Art. 51, VII', item: 'Extratos bancários', tipos: ['extrato'] },
  { inciso: 'Art. 51, VIII', item: 'Certidões de protesto', tipos: ['certidao'] }, { inciso: 'Art. 51, IX', item: 'Relação de processos', tipos: ['processos'] },
  { inciso: 'Art. 51, X', item: 'Relatório do passivo fiscal', tipos: ['passivo_fiscal'] }, { inciso: 'Art. 51, XI', item: 'Bens e direitos do ativo não circulante', tipos: ['bens'] },
];

export interface Tese { readonly titulo: string; readonly fundamento: string; readonly porque: string }
function teses(s: string, tipos: Set<TipoDocumental>, ctx: { frota: boolean; plNegativo: boolean; deficit: boolean }): Tese[] {
  const r: Tese[] = []; const add = (c: boolean, titulo: string, fundamento: string, porque: string) => { if (c) r.push({ titulo, fundamento, porque }); };
  add(/alienacao fiduciaria|cessao fiduciaria|reserva de dominio|leasing/.test(s) || ctx.frota, 'Bens de capital essenciais durante o stay period', 'LREF, art. 49, § 3º, parte final', 'Há crédito com garantia fiduciária ou frota: credor proprietário não entra na RJ, mas não retira bem essencial no stay. Levantar a essencialidade bem a bem.');
  add(/cessao fiduciaria|trava bancaria|recebiveis/.test(s), 'Travas bancárias e cessão fiduciária de recebíveis', 'LREF, art. 49, §§ 3º e 5º', 'Documentos citam recebíveis cedidos. Medir o caixa retido e checar registro e especialização da garantia.');
  add(tipos.has('relacao_credores') || tipos.has('contrato_credito'), 'Concursalidade pelo fato gerador', 'STJ, Tema 1.051', 'Para submissão à RJ, a existência do crédito é determinada pelo fato gerador. Conferir datas na relação de credores.');
  add(/aval|fianca|fiador|devedor solidario|coobrigad/.test(s), 'Garantias pessoais seguem exigíveis', 'STJ, Súmula 581 e Tema 885', 'Contratos com aval ou fiança: as execuções contra coobrigados não se suspendem. Avaliar exposição patrimonial dos sócios.');
  add(tipos.has('passivo_fiscal') || /divida ativa|execucao fiscal/.test(s), 'Equacionamento do passivo fiscal', 'LREF, arts. 6º, § 7º-B, e 57; Lei 10.522/2002, arts. 10-A e 10-B', 'Execução fiscal não se suspende e a regularidade fiscal condiciona a concessão. Mapear transação e parcelamento.');
  add(tipos.has('relacao_empregados') || /trabalhist|reclamatoria/.test(s), 'Prazo dos créditos trabalhistas', 'LREF, art. 54 e §§', 'Pagamento em até 1 ano, com extensão condicionada do § 2º. Verificar folha e passivo trabalhista.');
  add(/produtor rural|cedula de produto rural|\bcpr\b/.test(s), 'Recuperação do produtor rural', 'STJ, Tema 1.145; LREF, arts. 48, §§ 2º a 5º, e 49, § 6º', 'Há atividade rural: verificar registro na Junta no momento do pedido e quais créditos se sujeitam.');
  add(/grupo economico|coligada|controlada|holding/.test(s), 'Consolidação processual e substancial', 'LREF, arts. 69-G a 69-L', 'Sinais de grupo: analisar interconexão de ativos e passivos antes de definir o polo ativo.');
  add(ctx.plNegativo || ctx.deficit, 'Financiamento durante o processo (DIP)', 'LREF, arts. 69-A a 69-F', 'Situação de caixa ou patrimônio sugere necessidade de capital novo com tratamento extraconcursal.');
  add(tipos.has('bens') || /imovel|matricula|upi\b/.test(s), 'Alienação de ativos e UPI', 'LREF, arts. 60, 60-A, 66 e 142', 'Há ativos que podem compor o plano. Avaliar UPI sem sucessão e autorização judicial do art. 66.');
  add(/penhora|bloqueio|constricao|arresto/.test(s), 'Constrição sobre bens não abrangidos pelo plano', 'STJ, Súmula 480; LREF, art. 6º, §§ 4º e 7º-A', 'Documentos mencionam constrições: separar créditos sujeitos dos não sujeitos para definir o juízo competente.');
  return r;
}

export function raioX(entrada: { documentos: readonly DocumentoLido[]; naoLidos: readonly { titulo: string; motivo: string }[] }) {
  const docs = entrada.documentos.map((d) => ({ ...d, tipo: classificar(d) }));
  const de = (...t: TipoDocumental[]) => docs.filter((d) => t.includes(d.tipo));
  const contab = de('balanco', 'dre'); const pontos: Ponto[] = [];
  const b = Object.fromEntries(Object.entries(CONTAS).map(([k, r]) => [k, buscar(de('balanco').length ? de('balanco') : contab, r)])) as Record<keyof typeof CONTAS, Linha | null>;
  const d = Object.fromEntries(Object.entries(RESULTADO).map(([k, r]) => [k, buscar(de('dre').length ? de('dre') : contab, r)])) as Record<keyof typeof RESULTADO, Linha | null>;
  const indicadores: Indicador[] = []; const v = (l: Linha | null) => (l ? Math.abs(l.atual) : null);
  const [ac, pc, pnc, at, est, disp, rlp] = [v(b.ac), v(b.pc), v(b.pnc), v(b.at), v(b.est), v(b.disp), v(b.rlp)];
  if (ac !== null && pc) { indicadores.push(ind('lc', 'Liquidez corrente', ac / pc, 'x', 1.2, 0.8, 'acima de 1,2x', 'Ativo circulante ÷ Passivo circulante')); indicadores.push(ind('ls', 'Liquidez seca', (ac - (est ?? 0)) / pc, 'x', 1, 0.6, 'acima de 1,0x', '(AC − Estoques) ÷ PC')); if (disp !== null) indicadores.push(ind('li', 'Liquidez imediata', disp / pc, 'x', 0.2, 0.05, 'acima de 0,2x', 'Disponibilidades ÷ PC')); if (pnc !== null) indicadores.push(ind('lg', 'Liquidez geral', (ac + (rlp ?? 0)) / (pc + pnc), 'x', 1, 0.6, 'acima de 1,0x', '(AC + RLP) ÷ (PC + PNC)')); }
  if (at && pc !== null && pnc !== null) indicadores.push(ind('end', 'Endividamento geral', ((pc + pnc) / at) * 100, '%', 60, 90, 'abaixo de 60%', '(PC + PNC) ÷ Ativo total', false));
  const receita = v(d.rl) ?? v(d.rb);
  if (receita) { if (v(d.lb) !== null) indicadores.push(ind('mb', 'Margem bruta', ((d.lb!.atual) / receita) * 100, '%', 25, 10, 'acima de 25%', 'Lucro bruto ÷ Receita')); if (d.ebit) indicadores.push(ind('mo', 'Margem operacional', (d.ebit.atual / receita) * 100, '%', 8, 0, 'acima de 8%', 'Resultado operacional ÷ Receita')); if (d.ll) indicadores.push(ind('ml', 'Margem líquida', (d.ll.atual / receita) * 100, '%', 3, 0, 'acima de 3%', 'Resultado líquido ÷ Receita')); if (d.ebit && d.dep) indicadores.push(ind('ebitda', 'Margem EBITDA', ((d.ebit.atual + Math.abs(d.dep.atual)) / receita) * 100, '%', 10, 2, 'acima de 10%', '(Res. operacional + Depreciação) ÷ Receita')); }
  if (d.ebit && v(d.df)) indicadores.push(ind('cj', 'Cobertura de juros', d.ebit.atual / v(d.df)!, 'x', 2, 1, 'acima de 2,0x', 'Resultado operacional ÷ Despesas financeiras'));
  const rec = d.rl ?? d.rb;
  if (rec?.anterior) { const var_ = ((rec.atual - rec.anterior) / Math.abs(rec.anterior)) * 100; indicadores.push(ind('vr', 'Variação da receita', var_, '%', 0, -15, 'estável ou em alta', 'Receita atual ÷ anterior − 1')); if (var_ <= -15) pontos.push({ gravidade: 'atencao', area: 'Resultado', titulo: `Receita caiu ${Math.abs(var_).toFixed(1)}% no período`, detalhe: 'Compor a explicação da crise (art. 51, I) e testar a premissa de receita do plano.', evidencia: rec.evidencia }); }
  const plNeg = !!b.pl && (b.pl.atual < 0 || /descoberto/.test(sem(b.pl.evidencia.trecho)));
  if (plNeg) pontos.push({ gravidade: 'critico', area: 'Patrimônio', titulo: 'Patrimônio líquido negativo', detalhe: 'Passivo a descoberto. Exige narrativa de viabilidade e pesa na negociação com credores.', evidencia: b.pl!.evidencia });
  if (ac !== null && pc && ac < pc) pontos.push({ gravidade: 'critico', area: 'Liquidez', titulo: 'Capital circulante líquido negativo', detalhe: 'Obrigações de curto prazo superam o ativo de curto prazo: o stay period precisa render caixa.', evidencia: b.pc!.evidencia });
  if (d.ll && d.ll.atual < 0) pontos.push({ gravidade: 'atencao', area: 'Resultado', titulo: 'Prejuízo no exercício', detalhe: 'Verificar recorrência e separar efeitos não caixa.', evidencia: d.ll.evidencia });
  if (at !== null && pc !== null && pnc !== null && b.pl && !plNeg) { const dif = Math.abs(at - (pc + pnc + b.pl.atual)); if (dif > at * 0.01) pontos.push({ gravidade: 'atencao', area: 'Consistência contábil', titulo: 'Balanço não fecha', detalhe: `Ativo total difere de passivo + PL em R$ ${dif.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}. Pode ser leitura incompleta: confira com o contador.`, evidencia: b.at!.evidencia }); }
  if (contab.length && !indicadores.length) pontos.push({ gravidade: 'atencao', area: 'Leitura', titulo: 'Demonstrações encontradas, mas sem valores legíveis', detalhe: 'O layout não permitiu localizar as contas. Peça em Excel ou CSV.' });
  // fluxo
  let deficit = false; const fc = de('fluxo_caixa');
  const saldos = fc.flatMap((x) => x.texto.split(/\r?\n/).filter((l) => /saldo (final|acumulado)/.test(sem(l))).flatMap((l) => (l.match(NUM) ?? []).map(paraNumero).map((valor) => ({ valor, doc: x.titulo, l }))));
  const neg = saldos.filter((s) => s.valor < 0);
  if (neg.length) { deficit = true; pontos.push({ gravidade: 'critico', area: 'Fluxo de caixa', titulo: `${neg.length} período(s) com saldo negativo`, detalhe: 'Avaliar DIP, venda de ativos e ajuste de carência.', evidencia: { documento: neg[0]!.doc, trecho: neg[0]!.l.trim().slice(0, 200) } }); }
  // frota
  const frota = analisarFrota(docs);
  const todo = sem(docs.map((x) => `${x.titulo}\n${x.texto}`).join('\n'));
  const transportadora = /transporte rodoviario|\b49\.?30|transportadora/.test(todo) || (frota?.total ?? 0) >= 3;
  if (frota) {
    if (frota.onerados) pontos.push({ gravidade: frota.onerados / frota.total > 0.5 ? 'critico' : 'atencao', area: 'Frota', titulo: `${frota.onerados} de ${frota.total} veículos com alienação ou gravame`, detalhe: 'Risco de busca e apreensão: instruir a essencialidade (art. 49, § 3º) antes de vencer o stay.' });
    if (frota.comRestricao) pontos.push({ gravidade: 'critico', area: 'Frota', titulo: `${frota.comRestricao} veículo(s) com bloqueio ou penhora`, detalhe: 'Identificar a origem da constrição e o juízo competente.' });
    if ((frota.idadeMedia ?? 0) > 12) pontos.push({ gravidade: 'atencao', area: 'Frota', titulo: `Idade média de ${frota.idadeMedia} anos`, detalhe: 'Pressiona manutenção e capex: refletir nas premissas do plano.' });
    if (frota.semAno) pontos.push({ gravidade: 'info', area: 'Frota', titulo: `${frota.semAno} veículo(s) sem ano legível`, detalhe: 'A idade média considera só os demais.' });
  } else if (transportadora) pontos.push({ gravidade: 'atencao', area: 'Frota', titulo: 'Atividade de transporte sem controle de frota', detalhe: 'Peça a relação de veículos com placa, RENAVAM, ano e credor fiduciário.' });
  const tipos = new Set(docs.map((x) => x.tipo));
  const requisitos = REQUISITOS.map((r) => ({ ...r, atendido: r.tipos.some((t) => tipos.has(t)), documentos: docs.filter((x) => r.tipos.includes(x.tipo)).map((x) => x.titulo) }));
  for (const n of entrada.naoLidos) pontos.push({ gravidade: 'atencao', area: 'Leitura', titulo: `Não lido: ${n.titulo}`, detalhe: n.motivo });
  const ordem = { critico: 0, atencao: 1, info: 2 };
  return {
    documentos: docs.map((x) => ({ id: x.id, titulo: x.titulo, tipo: x.tipo, caracteres: x.texto.length })), naoLidos: entrada.naoLidos, indicadores,
    contas: { balanco: Object.fromEntries(Object.entries(b).filter(([, x]) => x).map(([k, x]) => [k, x])), resultado: Object.fromEntries(Object.entries(d).filter(([, x]) => x).map(([k, x]) => [k, x])) },
    pontos: pontos.sort((a, x) => ordem[a.gravidade] - ordem[x.gravidade]), requisitos, frota, transportadora, teses: teses(todo, tipos, { frota: !!frota, plNegativo: plNeg, deficit }),
    resumo: { lidos: docs.length, naoLidos: entrada.naoLidos.length, criticos: pontos.filter((p) => p.gravidade === 'critico').length, requisitosAtendidos: requisitos.filter((r) => r.atendido).length, requisitosTotal: requisitos.length },
    ressalva: 'Leitura automática para revisão profissional. Não conclui sobre viabilidade. Confira vigência e julgados antes de citar qualquer tese.',
  };
}
