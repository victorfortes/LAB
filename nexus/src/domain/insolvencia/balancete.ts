/**
 * QGC preliminar a partir do balancete.
 *
 * O balancete é o retrato contábil do passivo; ele NÃO é a relação de credores.
 * Esta leitura serve para a equipe começar o QGC com o que a contabilidade
 * declara, e por isso:
 *   - só entra conta do PASSIVO, fora do patrimônio líquido, com saldo CREDOR;
 *   - conta de passivo com saldo devedor não entra: vira aviso (anomalia);
 *   - conta-grupo não é somada junto com as filhas (só as folhas entram);
 *   - natureza e classe são SUGESTÃO pelo nome da conta. Quando a sugestão é
 *     inferência fraca (empréstimo bancário pode ter garantia, por exemplo),
 *     a linha sai marcada como hipótese, com o motivo.
 * Nada aqui consulta fonte externa nem inventa credor que o balancete não cita.
 */
import { enquadrar, type ClasseCredor, type NaturezaCredito } from './creditos.ts';

export interface LinhaBalancete {
  readonly codigo: string | null;
  readonly conta: string;
  /** Saldo final em centavos, sempre positivo; o lado vem em `lado`. */
  readonly saldo: bigint;
  /** 'C' credor, 'D' devedor, null quando o arquivo não informa. */
  readonly lado: 'C' | 'D' | null;
  readonly referencia: string;
}

export interface LinhaQgcPreliminar {
  readonly codigo: string | null;
  readonly conta: string;
  readonly grupo: string | null;
  readonly credor: string;
  readonly natureza: NaturezaCredito;
  readonly classe: ClasseCredor | null;
  readonly sujeito: boolean | null;
  /** Centavos, como string (JSON não tem BigInt). */
  readonly valor: string;
  readonly referencia: string;
  readonly motivo: string;
  readonly hipotese: boolean;
}

export interface QgcPreliminar {
  readonly linhas: LinhaQgcPreliminar[];
  readonly avisos: string[];
  /** Soma das linhas aceitas, em centavos. */
  readonly total: string;
  readonly contasLidas: number;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const ehCodigo = (s: string) => /^\d+([.\-/]\d+)*$/.test(s.trim()) && s.trim().length <= 30;

/** "1.234,56 C", "(1.234,56)", "-1.234,56", "1234.56D". Devolve centavos e o lado, se houver. */
export function lerValor(bruto: string): { centavos: bigint; lado: 'C' | 'D' | null } | null {
  let t = bruto.trim().replace(/r\$/i, '').replace(/\s/g, '');
  if (!t || !/\d/.test(t)) return null;
  let lado: 'C' | 'D' | null = null;
  const m = /^([DC])(.*)$|^(.*?)([DC])$/i.exec(t);
  if (m) { lado = (m[1] ?? m[4])!.toUpperCase() as 'C' | 'D'; t = (m[2] ?? m[3])!; }
  const negativo = /^\(.*\)$/.test(t) || t.startsWith('-') || t.endsWith('-');
  t = t.replace(/[()+-]/g, '');
  if (!/^[\d.,]+$/.test(t)) return null;
  const v = t.lastIndexOf(','), p = t.lastIndexOf('.'); const dec = Math.max(v, p);
  let inteiro = t, frac = '';
  if (dec >= 0 && (t.length - dec - 1 <= 2 || (v >= 0 && p >= 0))) { inteiro = t.slice(0, dec); frac = t.slice(dec + 1); }
  inteiro = inteiro.replace(/[.,]/g, '');
  if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(frac)) return null;
  const centavos = BigInt(inteiro || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  // Sem D/C explícito, valor negativo num balancete de sinais é saldo devedor no passivo.
  if (!lado && negativo) lado = 'D';
  return { centavos, lado };
}

// ------------------------------------------------------------- planilhas ---

/** Lê o balancete de uma tabela (XLSX/CSV): procura o cabeçalho, a coluna da conta e a do saldo final. */
export function linhasDeTabela(arquivo: string, aba: string, linhas: string[][]): LinhaBalancete[] {
  const ref = (i: number) => `${arquivo} | ${aba} | linha ${i + 1}`;
  let h = -1;
  for (let i = 0; i < Math.min(25, linhas.length); i++) {
    const c = linhas[i]!.map(norm);
    if (c.some((x) => /(descricao|conta|nome)/.test(x)) && c.some((x) => /saldo/.test(x))) { h = i; break; }
  }
  const saida: LinhaBalancete[] = [];
  if (h >= 0) {
    const cab = linhas[h]!.map(norm);
    const iCod = cab.findIndex((x) => /^(codigo|cod\.?|classificacao|reduzido|conta contabil|conta)$/.test(x) && linhas.slice(h + 1, h + 8).some((l) => ehCodigo(l[cab.indexOf(x)] ?? '')));
    const iDesc = cab.findIndex((x, i) => i !== iCod && /(descricao|nome da conta|nome|conta|titulo)/.test(x));
    let iSaldo = -1; cab.forEach((x, i) => { if (/saldo (atual|final)/.test(x)) iSaldo = i; });
    if (iSaldo < 0) cab.forEach((x, i) => { if (/saldo/.test(x) && !/anterior|inicial/.test(x)) iSaldo = i; });
    const iLado = cab.findIndex((x, i) => i > iSaldo && /^(d\/c|dc|natureza|d \/ c)$/.test(x));
    if (iDesc >= 0 && iSaldo >= 0) {
      linhas.slice(h + 1).forEach((l, k) => {
        const conta = (l[iDesc] ?? '').trim(); if (!conta) return;
        const valor = lerValor(`${l[iSaldo] ?? ''}${iLado >= 0 ? (l[iLado] ?? '').trim().slice(0, 1) : ''}`); if (!valor) return;
        let codigo = iCod >= 0 ? (l[iCod] ?? '').trim() || null : null;
        let nome = conta;
        // Muitos sistemas trazem "2.1.1.01 Fornecedores" na mesma célula.
        const junto = /^(\d+(?:[.\-]\d+)+)\s+(.+)$/.exec(conta); if (!codigo && junto) { codigo = junto[1]!; nome = junto[2]!; }
        saida.push({ codigo, conta: nome, saldo: valor.centavos, lado: valor.lado, referencia: ref(h + 1 + k) });
      });
      return saida;
    }
  }
  // Sem cabeçalho reconhecível: código (se houver), primeira célula com letras e o último número da linha.
  linhas.forEach((l, k) => {
    const cod = l.find((x) => ehCodigo(x)) ?? null;
    const conta = l.find((x) => /[a-zA-ZÀ-ú]{3}/.test(x) && !ehCodigo(x));
    const nums = l.map((x) => lerValor(x)).filter((x): x is NonNullable<typeof x> => !!x);
    if (!conta || !nums.length) return;
    saida.push({ codigo: cod?.trim() ?? null, conta: conta.trim(), saldo: nums[nums.length - 1]!.centavos, lado: nums[nums.length - 1]!.lado, referencia: ref(k) });
  });
  return saida;
}

// ------------------------------------------------------------------- PDF ---

/**
 * Lê linhas de texto de um balancete em PDF (já agrupadas por linha visual).
 * Formato típico: "2.1.1.01.0003   ACME LTDA   10.000,00  5.000,00  2.000,00  13.000,00C".
 * O saldo final é o último valor da linha.
 */
export function linhasDeTexto(arquivo: string, paginas: string[][]): LinhaBalancete[] {
  const saida: LinhaBalancete[] = [];
  const NUM = /\(?-?[\d]{1,3}(?:\.\d{3})*,\d{2}\)?\s?[DC]?|\(?-?\d+,\d{2}\)?\s?[DC]?/gi;
  paginas.forEach((linhas, p) => linhas.forEach((bruta, k) => {
    const linha = bruta.replace(/\s+/g, ' ').trim(); if (!linha) return;
    const nums = [...linha.matchAll(NUM)]; if (!nums.length) return;
    const primeiro = nums[0]!.index!;
    let antes = linha.slice(0, primeiro).trim();
    const cod = /^(\d+(?:[.\-]\d+)*)\s+(.*)$/.exec(antes);
    let codigo: string | null = null;
    if (cod) { codigo = cod[1]!; antes = cod[2]!; }
    // Código reduzido no fim da descrição ("Fornecedores 1023"): sai da descrição.
    antes = antes.replace(/\s+\d{1,6}$/, '').trim();
    if (!/[a-zA-ZÀ-ú]{3}/.test(antes)) return;
    const valor = lerValor(nums[nums.length - 1]![0]); if (!valor) return;
    saida.push({ codigo, conta: antes, saldo: valor.centavos, lado: valor.lado, referencia: `${arquivo} | página ${p + 1} | linha ${k + 1}` });
  }));
  return saida;
}

// ------------------------------------------------------- classificação ---

interface Regra { re: RegExp; natureza: NaturezaCredito; credor?: string; hipotese?: boolean; motivo: string }
/** Ordem importa: vale a primeira regra que casar com o nome da própria conta; só sem pista nela se olha o grupo. Tributo vem antes de folha ("INSS sobre salários" é tributo). */
const REGRAS: Regra[] = [
  { re: /(imposto|tribut|icms|\bipi\b|\bpis\b|cofins|irpj|csll|\biss\b|\binss\b|irrf|simples nacional|parcelamento|refis|\bpert\b|darf|contribuic(ao|oes) (social|sociais|previdenc)|previdencia social|fiscais a recolher|obrigacoes fiscais)/, natureza: 'tributario', credor: 'Fazenda Pública', motivo: 'Crédito tributário: não se sujeita à recuperação (art. 6º, § 7º-B; art. 187 do CTN). Valores retidos de terceiros pedem atenção.' },
  { re: /(alienacao fiduciaria|cessao fiduciaria|fiduciari)/, natureza: 'proprietario_fiduciario', motivo: 'Garantia fiduciária: em regra não se sujeita (art. 49, § 3º).' },
  { re: /(leasing|arrendamento mercantil|arrendamentos? a pagar)/, natureza: 'arrendamento_mercantil', motivo: 'Arrendamento mercantil: em regra não se sujeita (art. 49, § 3º).' },
  { re: /(\bacc\b|\bace\b|adiantamentos? (sobre|de) contratos? de cambio|contrato de cambio)/, natureza: 'adiantamento_contrato_cambio', motivo: 'ACC: não se sujeita (art. 49, § 4º, e art. 86, II).' },
  { re: /(pro.?labore|socio|mutuo|partes? relacionad|lucros? a (pagar|distribuir)|dividendos? a pagar|conta corrente.*(socio|diretor))/, natureza: 'subordinado', hipotese: true, motivo: 'Conta de sócio ou parte relacionada: crédito subordinado (art. 83, VIII, "b") se o sócio não tiver vínculo empregatício; conferir.' },
  { re: /(salario|ordenado|ferias|13.? ?salario|decimo terceiro|rescis|indeniza.*trabalh|folha de pagamento|obrigacoes trabalhistas|fgts|acordos? trabalhist|reclamat)/, natureza: 'trabalhista', credor: 'Empregados', motivo: 'Conta trabalhista (art. 83, I); classe I.' },
  { re: /(hipotec|penhor|garantia real)/, natureza: 'garantia_real', motivo: 'Conta indica garantia real (art. 83, II); classe II, até o valor do bem.' },
  { re: /(emprestimo|financiamento|capital de giro|bndes|finame|cedula|\bccb\b|conta garantida|cheque especial|banco|instituic(ao|oes) financeir|debentures?)/, natureza: 'quirografario', hipotese: true, motivo: 'Dívida bancária sugerida como quirografária; verificar se há garantia real ou fiduciária no contrato.' },
  { re: /(fornecedor|contas a pagar|duplicatas a pagar|titulos a pagar)/, natureza: 'quirografario', motivo: 'Fornecedor: quirografário (art. 83, VI).' },
  { re: /(adiantamentos? de clientes|clientes adiantamentos)/, natureza: 'quirografario', hipotese: true, motivo: 'Adiantamento de cliente: pode virar crédito quirografário se a entrega não ocorrer; conferir.' },
  { re: /(provis|contingenc)/, natureza: 'quirografario', hipotese: true, motivo: 'Provisão contábil: só vira crédito se houver obrigação concreta; conferir.' },
];

/** Natureza sugerida para uma conta de passivo pelo nome (e pelo grupo, se a conta não der pista). */
export function classificarConta(conta: string, grupo?: string | null): { natureza: NaturezaCredito; motivo: string; hipotese: boolean } {
  const nome = norm(conta);
  const regra = REGRAS.find((r) => r.re.test(nome)) ?? (grupo ? REGRAS.find((r) => r.re.test(norm(grupo))) : undefined);
  const meEpp = (regra?.natureza ?? 'quirografario') === 'quirografario' && /\b(me|epp|mei)\.?$/.test(nome);
  if (meEpp) return { natureza: 'me_epp', motivo: 'Nome termina em ME/EPP: provável classe IV (art. 41, IV).', hipotese: true };
  return regra ? { natureza: regra.natureza, motivo: regra.motivo, hipotese: !!regra.hipotese } : { natureza: 'quirografario', motivo: 'Sem pista no nome da conta: sugerido como quirografário.', hipotese: true };
}

/** Linhas que nunca são credor: grupos e totais do plano de contas. */
const GRUPO = /^(total|passivo|ativo|circulante|nao circulante|exigivel a (curto|longo) prazo|passivo (circulante|nao circulante)|obrigacoes? (de curto|de longo)|patrimonio liquido|resultado)/;
const PL = /(patrimonio liquido|capital social|reservas? de (lucro|capital)|lucros? (ou prejuizos )?acumulad|prejuizos? acumulad|ajustes? de avaliacao|acoes em tesouraria|resultado do exercicio)/;

const prefixo = (pai: string, filho: string) => filho !== pai && (filho.startsWith(pai + '.') || filho.startsWith(pai + '-') || (/^\d+$/.test(pai) && /^\d+$/.test(filho) && filho.startsWith(pai) && filho.length > pai.length));

export function qgcPreliminar(entrada: readonly LinhaBalancete[]): QgcPreliminar {
  const avisos: string[] = [];
  const linhas = entrada.filter((l) => l.saldo !== 0n);
  const comCodigo = linhas.filter((l) => l.codigo).length >= linhas.length * 0.6;

  // 1. Delimitar o passivo (fora do PL).
  let passivo: LinhaBalancete[];
  const grupos = new Map<string, string>(); // código → nome, para achar o grupo de cada folha
  if (comCodigo) {
    for (const l of linhas) if (l.codigo) grupos.set(l.codigo, l.conta);
    const raizPassivo = linhas.find((l) => /^passivo( total)?$|^passivo e patrimonio/.test(norm(l.conta)))?.codigo ?? '2';
    const raizesPl = linhas.filter((l) => /^patrimonio liquido/.test(norm(l.conta)) && l.codigo).map((l) => l.codigo!);
    passivo = linhas.filter((l) => l.codigo && (l.codigo === raizPassivo || prefixo(raizPassivo, l.codigo))
      && !raizesPl.some((pl) => l.codigo === pl || prefixo(pl, l.codigo!)));
    // 2. Só as folhas: conta que é prefixo de outra é grupo.
    const codigos = passivo.map((l) => l.codigo!);
    passivo = passivo.filter((l) => !codigos.some((c) => prefixo(l.codigo!, c)));
  } else {
    // Sem código: o trecho entre "Passivo" e "Patrimônio líquido" (ou o fim).
    const ini = linhas.findIndex((l) => /^passivo/.test(norm(l.conta)));
    const fim = linhas.findIndex((l, i) => i > ini && /^(patrimonio liquido|receita|custo|despesa|resultado)/.test(norm(l.conta)));
    passivo = ini < 0 ? [] : linhas.slice(ini + 1, fim < 0 ? undefined : fim);
    if (passivo.length) avisos.push('Balancete sem código de conta: os grupos foram separados pelo nome. Confira se algum subtotal entrou como credor.');
  }
  if (!passivo.length) {
    avisos.push('Não encontrei o passivo neste arquivo (procurei contas iniciadas por "2" ou a seção "Passivo").');
    return { linhas: [], avisos, total: '0', contasLidas: linhas.length };
  }

  const saida: LinhaQgcPreliminar[] = [];
  let total = 0n;
  for (const l of passivo) {
    const nome = norm(l.conta);
    if (GRUPO.test(nome) || PL.test(nome)) continue;
    if (l.lado === 'D') { avisos.push(`${l.conta} (${l.referencia}): conta de passivo com saldo devedor; não entrou. Pode ser adiantamento ou erro de lançamento.`); continue; }
    // Grupo imediato (para fornecedor "ACME LTDA" dentro de "Fornecedores").
    let grupo: string | null = null;
    if (l.codigo) { let melhor = ''; for (const [c, n] of grupos) if (prefixo(c, l.codigo) && c.length > melhor.length) { melhor = c; grupo = n; } }
    const regraPropria = REGRAS.find((r) => r.re.test(nome));
    const regra = regraPropria ?? (grupo ? REGRAS.find((r) => r.re.test(norm(grupo!))) : undefined);
    // Fornecedor com "ME" ou "EPP" no nome: provável classe IV (art. 41, IV), a conferir no cadastro do credor.
    const meEpp = (regra?.natureza ?? 'quirografario') === 'quirografario' && /\b(me|epp|mei)\.?$/.test(nome);
    const natureza: NaturezaCredito = meEpp ? 'me_epp' : regra?.natureza ?? 'quirografario';
    const casouNaPropria = !!regraPropria;
    // Credor: a própria conta quando ela é um nome (fornecedor, banco); o rótulo genérico quando é conta-tipo.
    const credor = regra?.credor && casouNaPropria ? `${regra.credor} (${l.conta})` : l.conta;
    const e = enquadrar({ id: l.referencia, credor, valor: l.saldo, natureza });
    saida.push({
      codigo: l.codigo, conta: l.conta, grupo, credor, natureza, classe: e.classe, sujeito: e.sujeito,
      valor: l.saldo.toString(), referencia: l.referencia,
      motivo: meEpp ? 'Nome termina em ME/EPP: provável classe IV (art. 41, IV); confirmar o porte no cadastro.' : regra ? regra.motivo : 'Sem pista no nome da conta: sugerido como quirografário.',
      hipotese: meEpp || !regra || !!regra.hipotese,
    });
    total += l.saldo;
  }
  return { linhas: saida, avisos, total: total.toString(), contasLidas: linhas.length };
}
