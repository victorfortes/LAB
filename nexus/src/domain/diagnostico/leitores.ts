/**
 * Leitores dos documentos que o cliente de recuperação realmente manda (pasta da Fitaflex como referência):
 * extrato bancário de qualquer banco, contrato de crédito (CCB, abertura de crédito, cessão e alienação
 * fiduciária), relatório SCR do Banco Central, vigência de apólice e licença, e as planilhas de
 * endividamento, QGC, curva ABC de fornecedores, serviço da dívida e fluxo de caixa.
 *
 * Regras:
 *  - todo número sai com a referência "arquivo | página" (ou aba) e nada é inventado;
 *  - o que é inferência (enquadramento na Lei 11.101, sinal de um lançamento deduzido pelo saldo) vem marcado;
 *  - extrato é conferido: saldo inicial + lançamentos tem de bater com o saldo final, e a conferência é gravada.
 */
import type { ExtracaoLida, ResultadoDaLeitura } from './planilhas.ts';
import { norm, partirLinha, type Valor } from './documentos.ts';

// ------------------------------------------------------------- texto sujo ---

/** PDF gerado com codificação Mac Roman lida como Latin-1 ("CÈdula de CrÈdito Banc·rio"): conserta. */
const MOJIBAKE: Record<string, string> = { 'È': 'é', '·': 'á', 'Á': 'ç', '„': 'ã', '∫': 'º', 'Í': 'ê', 'Ì': 'í', '˙': 'ú', 'Ù': 'ô', 'ı': 'õ', '‚': 'â', '‡': 'à', '”': 'Ó', '¡': 'Á', '«': 'Ç', 'ƒ': 'Ã', 'Ú': 'Ú', 'Û': 'ó' };
export function consertarTexto(paginas: string[][]): string[][] {
  const amostra = paginas.flat().join(' ');
  const sinais = (amostra.match(/[a-z][ÈÁ„Ì·ı∫][a-z]/g) ?? []).length;
  if (sinais < 5) return paginas;
  return paginas.map((p) => p.map((l) => l.replace(/[È·Á„∫ÍÌ˙Ùı‚‡”]/g, (c) => MOJIBAKE[c] ?? c)));
}

/** Texto "embaralhado" (fonte sem mapa de caracteres): letras soltas separadas por espaço, quase sem palavras. */
export function textoIlegivel(paginas: string[][]): boolean {
  const t = paginas.flat().join(' ');
  if (t.replace(/\s/g, '').length < 40 * Math.max(1, paginas.length)) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  const soltos = tokens.filter((x) => x.length === 1).length;
  const palavras = (t.match(/\b[a-záéíóúâêôãõç]{4,}\b/gi) ?? []).length;
  return tokens.length > 80 && (soltos / tokens.length > 0.45 || palavras / tokens.length < 0.08);
}

// ---------------------------------------------------------- classificação ---

export type TipoDocumento =
  | 'extrato' | 'contrato_credito' | 'scr' | 'matricula' | 'contrato_social' | 'irpf' | 'apolice' | 'licenca'
  | 'passivo_fiscal' | 'trabalhista' | 'demonstracao' | 'outro';
const ROTULO_TIPO: Record<TipoDocumento, string> = {
  extrato: 'Extrato bancário', contrato_credito: 'Contrato de crédito ou garantia', scr: 'SCR do Banco Central', matricula: 'Matrícula de imóvel',
  contrato_social: 'Contrato social ou alteração', irpf: 'IRPF', apolice: 'Apólice de seguro', licenca: 'Licença ou outorga',
  passivo_fiscal: 'Passivo fiscal', trabalhista: 'Trabalhista', demonstracao: 'Demonstração contábil', outro: 'Outro',
};
export const rotuloDoTipo = (t: TipoDocumento) => ROTULO_TIPO[t];

/** Pelo caminho (a pasta do checklist diz muito) e pelo conteúdo. */
export function classificar(contexto: string, paginas: string[][]): TipoDocumento {
  const c = norm(contexto); const t = norm(paginas.slice(0, 3).flat().join(' ')).slice(0, 12_000);
  const tem = (re: RegExp) => re.test(t);
  if (/livro razao|razao anal|razao_anal|balancete|\brazao\b/.test(c)) return 'demonstracao';
  if (/registrato|relatorio de emprestimos e financiamentos \(scr\)/.test(t) || /\bscr\b/.test(c)) return 'scr';
  // Matrícula antes de contrato: a certidão cita "alienação fiduciária" nos registros, mas é do cartório.
  if (/matricula|registro de imove/.test(c) || (/registro de imoveis|serventia registral|livro 2 ?- ?registro geral|oficial de registro de imoveis/.test(t.slice(0, 3000)) && !/cedula|contrato|instrumento particular|aditamento/.test(t.slice(0, 700)))) return 'matricula';
  if (/extrato|saldo anterior|lancamentos do periodo|historico de movimentacao/.test(t) && !/cedula de credito|contrato de/.test(t.slice(0, 1500))) return 'extrato';
  if (/extratos? bancario/.test(c)) return 'extrato';
  if (/cedula de credito|contrato de (abertura de )?credito|cessao fiduciaria|alienacao fiduciaria|contrato de financiamento|finimp|adiantamento sobre contrato de cambio|instrumento particular de (confissao|contrato)/.test(t)
    || /contratos? de (financiamento|emprestimo)|alienacao fiduciaria|cessao fiduciaria|acessao fiduciaria/.test(c)) return 'contrato_credito';
  if (/matricula|registro de imoveis|onr\.org\.br/.test(c + ' ' + t.slice(0, 2000))) return 'matricula';
  if (/contrato social|alteracao contratual|consolidacao contratual/.test(c + ' ' + t.slice(0, 1500))) return 'contrato_social';
  if (/irpf|declaracao de ajuste anual|imposto sobre a renda.*pessoa fisica/.test(c + ' ' + t.slice(0, 2000))) return 'irpf';
  if (/apolice/.test(c + ' ' + t.slice(0, 1500))) return 'apolice';
  if (/licenca|outorga|alvara/.test(c + ' ' + t.slice(0, 1500))) return 'licenca';
  if (/passivo fiscal|situacao fiscal|divida ativa|pgfn/.test(c + ' ' + t.slice(0, 2000))) return 'passivo_fiscal';
  if (/trabalhist|rescis|empregados|fgts|esocial/.test(c)) return 'trabalhista';
  if (tem(/balanco patrimonial|demonstracao do resultado|balancete/)) return 'demonstracao';
  return 'outro';
}

// ------------------------------------------------------------- utilitários ---

const BANCOS: [RegExp, string][] = [
  [/banco do brasil|\bbb\b|dt\. balancete/, 'Banco do Brasil'], [/caixa econ|gerenciador.{0,8}caixa|^caixa\b|\bcef\b/, 'Caixa'], [/bradesco/, 'Bradesco'],
  [/santander/, 'Santander'], [/itau|unibanco/, 'Itaú'], [/sicoob/, 'Sicoob'], [/sicredi/, 'Sicredi'], [/cresol/, 'Cresol'], [/safra/, 'Safra'],
  [/daycoval/, 'Daycoval'], [/\bbrde\b|desenvolvimento do extremo sul/, 'BRDE'], [/bndes/, 'BNDES'], [/xp invest/, 'XP Investimentos'],
  [/banrisul/, 'Banrisul'], [/banco abc/, 'Banco ABC'], [/votorantim|\bbv\b/, 'Banco BV'], [/banco inter\b/, 'Banco Inter'], [/sofisa/, 'Sofisa'],
  [/fibra/, 'Banco Fibra'], [/\bpine\b/, 'Banco Pine'], [/unicred/, 'Unicred'], [/ailos|viacredi/, 'Ailos'], [/banco do nordeste/, 'Banco do Nordeste'],
  [/c6 bank|banco c6/, 'C6 Bank'], [/btg/, 'BTG Pactual'], [/original/, 'Banco Original'], [/mercantil/, 'Mercantil'], [/tribanco/, 'Tribanco'],
];
export function bancoDoTexto(...fontes: string[]): string | null {
  for (const f of fontes) { const t = norm(f); for (const [re, nome] of BANCOS) if (re.test(t)) return nome; }
  return null;
}
const isoDe = (d: string, anoPadrao?: number): string | null => {
  const m = /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?$/.exec(d); if (!m) return null;
  let ano = m[3] ? Number(m[3]) : anoPadrao; if (!ano) return null; if (ano < 100) ano += 2000;
  return `${ano}-${m[2]}-${m[1]}`;
};
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** "23 de julho de 2026" ou "23/07/2026" → ISO. */
export function dataDoTexto(s: string): string | null {
  const a = /(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/.exec(norm(s)); if (a) { const m = MESES.indexOf(a[2]!); if (m >= 0) return `${a[3]}-${String(m + 1).padStart(2, '0')}-${a[1]!.padStart(2, '0')}`; }
  const b = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s); return b ? `${b[3]}-${b[2]}-${b[1]}` : null;
}
const reais = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const r2 = (n: number) => Math.round(n * 100) / 100;
const valorAssinado = (v: Valor) => (v.lado === 'D' ? -Math.abs(v.reais) : v.lado === 'C' ? Math.abs(v.reais) : v.reais);

// ------------------------------------------------------------------ extrato ---

const DEBITO = /\b(pag|pgto|pagto|pagamento|tarifa|tar\b|deb\b|debito|db\b|enviad[oa]|saque|cesta|iof|juros|encargo|liquidacao|parcela|amortiz|transf.{0,12}envi|cheque compensado|ch compensado|bloq|tributo|darf|gps|fgts|folha|boleto pago|dev ch|devolucao)\b/;
const SALDO_LINHA = /saldo (do dia|dia|final|bloq|disponivel|total|em conta|atual|aplicado|investido|de abertura|para uso)|^saldo$|s a l d o|resumo|total (de )?(creditos|debitos|entradas|saidas)/;

export interface LancamentoExtrato { data: string; valor: number; historico: string; inferido?: boolean }
export interface DadosExtrato {
  banco: string; conta: string | null; agencia: string | null; periodo: { de: string | null; ate: string | null };
  saldoInicial: number | null; saldoFinal: number | null; entradas: number; saidas: number; linhas: LancamentoExtrato[];
  confere: boolean | null; diferenca: number | null; paginas: number;
  sinais: { bloqueioJudicial: number; devolucaoCheque: number; jurosEncargos: number; tarifas: number; servicoDivida: number; entreContasProprias: number };
}

export function lerExtratoPdf(arquivo: string, contexto: string, paginasBrutas: string[][]): ExtracaoLida | null {
  const paginas = consertarTexto(paginasBrutas);
  const todas = paginas.flat(); const texto = todas.join('\n'); const t = norm(texto);
  const banco = bancoDoTexto(arquivo) ?? bancoDoTexto(texto.slice(0, 600)) ?? bancoDoTexto(texto.slice(0, 3000), contexto) ?? arquivo.replace(/\.[^.]+$/, '');
  const conta = /conta\s*:\s*([\d][\d.]*-?[\dxX]?)/i.exec(texto)?.[1] ?? /conta corrente\s+(\d[\d.]*-[\dxX])/i.exec(texto)?.[1] ?? /\bconta\s+(\d{5,}-?\d?)/i.exec(texto)?.[1] ?? /\bcc:?\s*([\d.-]{4,})/i.exec(texto)?.[1] ?? /\|\s*(\d{4,}-\d)\b/.exec(texto)?.[1] ?? null;
  const agencia = /ag[eê]ncia\s*:?\s*([\d-]{3,6})/i.exec(texto)?.[1] ?? /\bag:?\s*(\d{3,5})/i.exec(texto)?.[1] ?? /coop\.?:?\s*([\d-]{3,6})/i.exec(texto)?.[1] ?? null;
  // Período: "01/05/2026 a 31/05/2026", "Entre 01/05/2026 e 31/05/2026", "De: 01/05/2026 Até: 31/05/2026", "Período do extrato 05 / 2026", "Mês: Maio/2026".
  let de: string | null = null, ate: string | null = null;
  const p1 = /(\d{2}\/\d{2}\/\d{4})\s*(?:a|até|ate|e|-)\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto) ?? /de:?\s*(\d{2}\/\d{2}\/\d{4}).{0,12}at[eé]:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto);
  if (p1) { de = isoDe(p1[1]!); ate = isoDe(p1[2]!); }
  else {
    const p2 = /periodo do extrato\s*(\d{2})\s*\/\s*(\d{4})/.exec(t) ?? (() => { const m = /mes:?\s*([a-z]+)\/(\d{4})/.exec(t); return m && MESES.indexOf(m[1]!) >= 0 ? [m[0], String(MESES.indexOf(m[1]!) + 1).padStart(2, '0'), m[2]] as unknown as RegExpExecArray : null; })();
    if (p2) { const ano = Number(p2[2]); const mes = Number(p2[1]); de = `${ano}-${String(mes).padStart(2, '0')}-01`; ate = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10); }
  }
  const anoPadrao = Number((ate ?? de ?? '').slice(0, 4)) || Number(/(20\d{2})/.exec(contexto + arquivo)?.[1]) || undefined;

  let saldoInicial: number | null = null; let saldoFinal: number | null = null;
  type Mov = LancamentoExtrato & { saldo?: number };
  const linhas: Mov[] = [];
  let ultimo: Mov | null = null; let saldoCorrente: number | null = null; let dataAtual: string | null = null;
  let descricao: string[] = []; let valorSolto: Valor | null = null; let esperandoLadoDoInicial = false;
  const CABECALHO = /^(data|historico|lancamento|saldo \(|pagina|folha|extrato|valor|dt\.|ag\.|origem|liq mov|data mov)/;
  const IGNORAR_SALDO = /saldo (bloq|bloqueado|disponivel(?! dia)|de limite|limite|aplicado|investido|para uso)|limite (da conta|disponivel)|s a l d o/;
  let esperandoSaldoFinal = false; let ladoPendente: 'mov' | 'saldo' | null = null;
  for (const bruta of todas) {
    const l = bruta.trim(); const ln = norm(l); if (!l) continue;
    let { valores } = partirLinha(l);
    // "C" ou "D" sozinho na linha: lado do valor anterior (Sicoob).
    if (/^[cd]\*?$/.test(ln)) {
      if (ladoPendente === 'mov' && ultimo && ultimo.inferido) { ultimo.valor = ln[0] === 'd' ? -Math.abs(ultimo.valor) : Math.abs(ultimo.valor); delete ultimo.inferido; }
      else if (ladoPendente === 'saldo' && saldoCorrente !== null && ln[0] === 'd') { saldoCorrente = -Math.abs(saldoCorrente); saldoFinal = saldoCorrente; }
      else if (esperandoLadoDoInicial && saldoInicial !== null) { if (ln[0] === 'd') saldoInicial = -Math.abs(saldoInicial); saldoCorrente = saldoInicial; }
      ladoPendente = null; esperandoLadoDoInicial = false; continue;
    }
    ladoPendente = null;
    if (esperandoSaldoFinal && valores.length) { saldoFinal = valorAssinado(valores.at(-1)!); esperandoSaldoFinal = false; continue; }
    if (/s a l d o$/.test(ln)) { if (valores.length) saldoFinal = valorAssinado(valores.at(-1)!); else esperandoSaldoFinal = true; continue; }
    // Total do período encerra o extrato: o que vem depois ("Últimos lançamentos") já é do mês seguinte.
    if (/^total\b/.test(ln) && linhas.length) { if (valores.length) saldoFinal = valorAssinado(valores.at(-1)!); break; }
    if (/ultimos lancamentos|lancamentos futuros|agendamentos futuros|lancamentos programados/.test(ln) && linhas.length) break;
    // Data seguida de rótulo sem valor, com o valor na linha anterior (Sicoob): usa o valor solto.
    if (!valores.length && valorSolto && /^\d{2}\/\d{2}/.test(l)) { valores = [valorSolto]; }
    if (esperandoLadoDoInicial) { esperandoLadoDoInicial = false; if (/^[dc]$/.test(ln) && saldoInicial !== null) { if (ln === 'd') saldoInicial = -Math.abs(saldoInicial); saldoCorrente = saldoInicial; continue; } }
    if (/saldo anterior/.test(ln)) {
      const v = valores.at(-1) ?? valorSolto;
      if (v) { saldoInicial = valorAssinado(v); saldoCorrente = saldoInicial; esperandoLadoDoInicial = !valores.length && v.lado === null; }
      valorSolto = null; continue;
    }
    if (IGNORAR_SALDO.test(ln)) { valorSolto = null; continue; }
    // Pontos de conferência: "SALDO TOTAL", "SALDO DO DIA", "SALDO FINAL" (com ou sem data).
    if (/saldo (total|do dia|dia|final|atual|em conta)|^saldo$/.test(ln) && valores.length) { saldoCorrente = valorAssinado(valores.at(-1)!); saldoFinal = saldoCorrente; if (valores.at(-1)!.lado === null) ladoPendente = 'saldo'; valorSolto = null; const dm0 = /^(\d{2}\/\d{2}(?:\/\d{2,4})?)\b/.exec(l); if (dm0) dataAtual = isoDe(dm0[1]!, anoPadrao) ?? dataAtual; continue; }
    const dm = /^(\d{2}\/\d{2}(?:\/\d{2,4})?)(?!\s*\d{2}:\d{2})\s+(.*)$/.exec(l);
    const ehHora = /^\d{2}\/\d{2}\s+\d{2}:\d{2}/.test(l);
    if (dm) { const d = isoDe(dm[1]!, anoPadrao); if (d) dataAtual = d; }
    const resto = dm ? dm[2]! : l;
    // Valor sozinho na linha (o "saldo anterior" do Sicoob vem antes do rótulo).
    if (!dm && valores.length === 1 && partirLinha(l).rotulo === '' ) { valorSolto = valores[0]!; continue; }
    const movimento = dataAtual && !ehHora && !CABECALHO.test(ln) && (valores.length >= 2 || (dm && valores.length === 1));
    if (movimento) {
      const valor = valores.length >= 2 ? valores.at(-2)! : valores[0]!;
      const saldo = valores.length >= 2 ? valorAssinado(valores.at(-1)!) : undefined;
      let historico = partirLinha(resto).rotulo.replace(/\s+[\d.]{5,}\b.*$/, '').replace(/^\d{3,}(\s+\d{3,})*\s*/, '').trim();
      if (!historico || /^[\d\s.]*$/.test(historico)) { historico = descricao.join(' · '); descricao = []; }
      else if (descricao.length && ultimo) { ultimo.historico = `${ultimo.historico} · ${descricao.join(' · ')}`.slice(0, 160); descricao = []; }
      let v = valorAssinado(valor); let inferido = false;
      if (valor.lado === null && valor.reais > 0) {
        // Sem sinal: o saldo da linha decide (delta exato); sem saldo, o histórico.
        if (saldo !== undefined && saldoCorrente !== null && Math.abs(Math.abs(saldo - saldoCorrente) - valor.reais) < 0.02) v = Math.sign(saldo - saldoCorrente) * valor.reais || valor.reais;
        else if (DEBITO.test(norm(historico))) v = -valor.reais;
        inferido = true;
      }
      if (saldo !== undefined) saldoCorrente = saldo;
      ultimo = { data: dataAtual!, valor: r2(v), historico: historico.slice(0, 140), ...(saldo !== undefined ? { saldo } : {}), ...(inferido ? { inferido } : {}) };
      linhas.push(ultimo); valorSolto = null; if (inferido) ladoPendente = 'mov';
      continue;
    }
    // Sem valor: descrição do próximo lançamento (Bradesco/Santander) ou contraparte do anterior (Itaú/BB).
    if (!valores.length && !CABECALHO.test(ln) && l.length > 2) {
      if (ehHora && ultimo) ultimo.historico = `${ultimo.historico} · ${l.replace(/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s*/, '')}`.slice(0, 160);
      else descricao.push(l.slice(0, 80)); if (descricao.length > 4) descricao.shift();
    }
  }
  if (descricao.length && ultimo) ultimo.historico = `${ultimo.historico} · ${descricao.join(' · ')}`.slice(0, 160);
  // Lista do mais novo para o mais antigo (Santander): vira cronológica.
  if (linhas.length > 2 && linhas[0]!.data > linhas.at(-1)!.data) linhas.reverse();
  if (saldoInicial === null && linhas[0]?.saldo !== undefined) saldoInicial = r2(linhas[0]!.saldo! - linhas[0]!.valor);
  if (saldoFinal === null) { const comSaldo = [...linhas].reverse().find((x) => x.saldo !== undefined); if (comSaldo) saldoFinal = comSaldo.saldo!; }
  for (const x of linhas) delete x.saldo;
  // Extrato de verdade tem saldo anterior ou vários lançamentos (fatura de energia com uma linha não é extrato).
  if (saldoInicial === null && linhas.length < 3) return null;
  const entradas = r2(linhas.filter((x) => x.valor > 0).reduce((s, x) => s + x.valor, 0));
  const saidas = r2(-linhas.filter((x) => x.valor < 0).reduce((s, x) => s + x.valor, 0));
  const calculado = saldoInicial === null ? null : r2(saldoInicial + entradas - saidas);
  const diferenca = calculado !== null && saldoFinal !== null ? r2(saldoFinal - calculado) : null;
  // Titular: a primeira razão social do cabeçalho ("FITAFLEX INDUSTRIA E COMERCIO LTDA") → "fitaflex".
  const titular = norm(/\b([A-Z]{5,})\s+(?:IND|INDUSTRIA|COMERCIO|COM\b|LTDA|S\.?A\b|EIRELI|ADMINISTRADORA|PARTICIPA)/.exec(texto.slice(0, 2000))?.[1] ?? '');
  const h = (re: RegExp) => r2(linhas.filter((x) => re.test(norm(x.historico))).reduce((s, x) => s + Math.abs(x.valor), 0));
  const dados: DadosExtrato = {
    banco, conta, agencia, periodo: { de: de ?? linhas[0]?.data ?? null, ate: ate ?? linhas.at(-1)?.data ?? null },
    saldoInicial, saldoFinal, entradas, saidas, linhas, confere: diferenca === null ? null : Math.abs(diferenca) <= 1, diferenca, paginas: paginas.length,
    sinais: {
      bloqueioJudicial: h(/bloq.{0,8}jud|bacenjud|sisbajud|bloqueio judicial|transf.{0,6}judicial|penhora/),
      devolucaoCheque: h(/dev(olucao|\.)? ?(de )?ch|cheque devolvido|dev ch/), jurosEncargos: h(/juros|encargo|iof|mora\b|multa/),
      tarifas: h(/tarifa|\btar\b|cesta/), servicoDivida: h(/liquidacao de parcela|parcela|amortiz|emprestimo|financiamento|finame|capital de giro|prestacao/),
      entreContasProprias: titular ? h(new RegExp(`\\b${titular}\\b`)) : 0,
    },
  };
  return { tipo: 'extrato', referencia: `${arquivo} | ${paginas.length} pág.`, dados: dados as unknown as Record<string, unknown> };
}

// -------------------------------------------------------- contrato de crédito ---

export interface DadosContrato {
  instrumento: string; credor: string | null; numero: string | null; data: string | null; valor: number | null; valorRotulo: string | null;
  taxaMes: number | null; taxaAno: number | null; parcelas: number | null; valorParcela: number | null; vencimentoFinal: string | null; prazoDias: number | null;
  garantias: string[]; fundoGarantidor: string | null; avalistas: { nome: string; documento: string | null }[];
  enquadramento: { rj: 'fora' | 'dentro' | 'parcial'; classe: string; fundamento: string; natureza: 'indicio' };
}
const INSTRUMENTOS: [RegExp, string][] = [
  [/bordero|proposta de desconto|desconto de cheques?/, 'Desconto de títulos (borderô)'],
  [/cessao fiduciaria de (duplicatas|recebiveis|direitos creditorios)|cessao fiduciaria/, 'Cessão fiduciária de recebíveis'],
  [/alienacao fiduciaria de (imovel|imoveis)/, 'Abertura de crédito com alienação fiduciária de imóvel'],
  [/alienacao fiduciaria/, 'Contrato com alienação fiduciária'],
  [/adiantamento sobre contrato de cambio|\bacc\b/, 'ACC (adiantamento de câmbio)'], [/finimp/, 'FINIMP'],
  [/finame/, 'FINAME'], [/cedula de credito bancario|\bccb\b/, 'Cédula de Crédito Bancário'], [/cedula de credito (rural|comercial|industrial|a exportacao)/, 'Cédula de crédito'],
  [/conta garantida/, 'Conta garantida'], [/confissao de divida/, 'Confissão de dívida'], [/contrato de (abertura de )?credito/, 'Contrato de crédito'],
  [/contrato de financiamento/, 'Contrato de financiamento'], [/leasing|arrendamento mercantil/, 'Arrendamento mercantil'],
];
export function lerContratoCredito(arquivo: string, contexto: string, paginasBrutas: string[][]): ExtracaoLida | null {
  const paginas = consertarTexto(paginasBrutas);
  const texto = paginas.flat().join(' ').replace(/\s+/g, ' '); const t = norm(texto);
  if (texto.length < 300) return null;
  const inicio = t.slice(0, 6000);
  // O título (início do documento e nome do arquivo) manda; depois o quadro; depois a pasta.
  const titulo = `${norm(arquivo)} ${t.slice(0, 500)}`;
  const instrumento = INSTRUMENTOS.find(([re]) => re.test(titulo))?.[1] ?? INSTRUMENTOS.find(([re]) => re.test(inicio))?.[1] ?? INSTRUMENTOS.find(([re]) => re.test(norm(contexto)))?.[1] ?? 'Contrato de crédito';
  // Credor: o banco citado perto de "credor"; senão o primeiro banco do início do documento.
  const perto = /(credor(?: fiduciario)?|banco)[^.]{0,160}/.exec(inicio)?.[0] ?? '';
  const credor = bancoDoTexto(perto, inicio, arquivo, contexto);
  const ehCnpj = (x: string) => /^\d{2}\.\d{3}\.\d{3}\/\d{4}/.test(x);
  const numero = [...texto.slice(0, 6000).matchAll(/(?:n[º°]|numero da operacao|número da operação|operação n[º°]?)\s*:?\s*([\d][\d./-]{3,}\d)/gi)].map((m) => m[1]!).find((x) => !ehCnpj(x))
    ?? /n[º°]\s*([\d][\d./-]{4,}\d)/.exec(arquivo)?.[1] ?? null;
  // Valor: rótulos ancorados em R$ (mais específicos primeiro); depois USD; depois o nome do arquivo; por fim o primeiro
  // valor relevante do quadro (marcado para conferir).
  const ROT: [RegExp, string][] = [
    [/valor (?:total )?(?:liberado|do credito|do emprestimo|financiado|da operacao|contratado|da proposta|de principal|do principal|entregue)[\s\S]{0,140}?r\$\s?([\d.]+,\d{2})/, 'valor da operação'],
    [/limite de credito no valor (?:total )?de r\$\s?([\d.]+,\d{2})/, 'limite de crédito'],
    [/valor total dos (?:cheques|titulos|duplicatas)[^\d]{0,40}([\d.]+,\d{2})/, 'total do borderô'],
    [/valor total da garantia:?\s*r\$\s?([\d.]+,\d{2})/, 'valor da garantia'],
    [/dt\. operacao valor[\s\S]{0,160}?\d{2}\/\d{2}\/\d{4}\s+([\d.]+,\d{2})/, 'valor da operação'],
    [/especificacao r\$\s?([\d.]+,\d{2})/, 'valor do financiamento'],
    [/quantia (?:liquida|de)[\s\S]{0,80}?r\$\s?([\d.]+,\d{2})/, 'quantia'],
  ];
  let valor: number | null = null; let valorRotulo: string | null = null; let moeda = 'BRL';
  for (const [re, rot] of ROT) { const m = re.exec(t); if (m) { valor = reais(m[1]!); valorRotulo = rot; break; } }
  if (valor === null) { const m = /valor (?:do financiamento )?em moeda estrangeira (usd|eur)\s*([\d.]+,\d{2})/.exec(t); if (m) { valor = reais(m[2]!); moeda = m[1]!.toUpperCase(); valorRotulo = 'valor em moeda estrangeira'; } }
  if (valor === null) { const m = /[-–]\s*(\d{1,3}(?:\.\d{3}){1,3}(?:,\d{2})?)\s*(?:\(\d\))?\.pdf$/i.exec(arquivo); if (m && reais(m[1]!.includes(',') ? m[1]! : `${m[1]!},00`) >= 10_000) { valor = reais(m[1]!.includes(',') ? m[1]! : `${m[1]!},00`); valorRotulo = 'pelo nome do arquivo (conferir)'; } }
  if (valor === null) { const m = [...inicio.matchAll(/r\$\s?([\d.]{5,},\d{2})/g)].map((x) => reais(x[1]!)).find((x) => x >= 10_000); if (m) { valor = m; valorRotulo = 'primeiro valor do quadro (conferir)'; } }
  const taxaMes = (() => { const m = /([\d]{1,2},\d{1,4})\s*%?\s*(?:% )?a\.?\s?m\b/.exec(t) ?? /taxa[^%]{0,80}?([\d]{1,2},\d{1,4})\s*%\s*(?:ao mes|a\.m)/.exec(t); return m ? reais(m[1]!) : null; })();
  const taxaAno = (() => { const m = /([\d]{1,3},\d{1,4})\s*%\s*(?:a\.?\s?a\b|ao ano)/.exec(t) ?? /% a\.a\.?\s*([\d]{1,3},\d{1,4})/.exec(t); return m ? reais(m[1]!) : null; })();
  const parcelas = (() => { const m = /qtd\.? de parcela\(?s?\)?[^\d]{0,80}?\b(\d{1,3})\b\s+[\d.]+,\d{2}/.exec(t) ?? /(\d{1,3}) \(?[a-z ]{0,30}\)? parcelas (?:mensais|iguais|sucessivas)/.exec(t); return m ? Number(m[1]) : null; })();
  const valorParcela = (() => { const m = /valor da\(?s?\)? parcela\(?s?\)?(?: em r\$)?\s*([\d.]+,\d{2})/.exec(t); return m ? reais(m[1]!) : null; })();
  const prazoDias = (() => { const m = /prazo da operacao[^\d]{0,80}?(?:[\d.]+,\d{2}\s+)?(\d{2,5})\s*(?:dias)?/.exec(t); return m ? Number(m[1]) : null; })();
  const venc = /data de vencimento:?\s*([^;.]{6,40})/.exec(t)?.[1] ?? /vigera ate\s*(\d{2}\/\d{2}\/\d{4})/.exec(t)?.[1] ?? /vencimento final:?\s*(\d{2}\/\d{2}\/\d{4})/.exec(t)?.[1] ?? null;
  const vencimentoFinal = venc ? dataDoTexto(venc) : null;
  const data = (() => { const m = /dt\. operacao[^\d]{0,80}?(\d{2}\/\d{2}\/\d{4})/.exec(t) ?? /data de (?:emissao|celebracao|emissao\/celebracao)[^\d]{0,6}([^;.]{6,30})/.exec(t); return m ? dataDoTexto(m[1]!) : null; })();
  // Garantias: só no quadro inicial (as cláusulas-padrão citam hipoteca, penhor e fiança de forma genérica).
  const quadro = norm(paginas.slice(0, 3).flat().join(' '));
  const garantias: string[] = [];
  const g = (re: RegExp, nome: string) => { if (re.test(quadro) && !garantias.includes(nome)) garantias.push(nome); };
  g(/alienacao fiduciaria de (imovel|imoveis)|alienacao fiduciaria do imovel|constituicao de alienacao fiduciaria de imove/, 'Alienação fiduciária de imóvel');
  g(/alienacao fiduciaria (de|dos?) (bens|maquinas|equipamentos|veiculos)|bens alienados fiduciariamente/, 'Alienação fiduciária de bens móveis');
  g(/cessao fiduciaria|cedente fiduciari|duplicatas.{0,40}em garantia/, 'Cessão fiduciária de recebíveis');
  g(/constitui(cao|da|r) (de )?hipoteca|em hipoteca|hipoteca (cedular|de primeiro grau)/, 'Hipoteca');
  g(/penhor (mercantil|de|cedular|rural)|em penhor/, 'Penhor');
  g(/avalista\(?s?\)?\s*(nome|:|3\.1)|\baval\b/, 'Aval'); g(/fiador(es)?\s*(nome|:)|fianca bancaria|carta de fianca/, 'Fiança');
  g(/aplicacao financeira (vinculada|em garantia)|cessao de direitos sobre aplicac/, 'Aplicação financeira em garantia');
  const fundoGarantidor = /\bfgi\b|peac/.test(quadro) ? 'FGI/PEAC (BNDES)' : /pronampe|\bfgo\b/.test(t) ? 'FGO/Pronampe' : /fampe/.test(t) ? 'Fampe (Sebrae)' : null;
  // Avalistas: nomes com CPF depois de "avalista".
  const avalistas: { nome: string; documento: string | null }[] = [];
  const trecho = /avalista\(?s?\)?[\s\S]{0,900}/i.exec(texto)?.[0] ?? '';
  for (const m of trecho.matchAll(/([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{5,60}?)\s+(\d{3}\.\d{3}\.\d{3}-\d{2})/g)) {
    const nome = m[1]!.replace(/\s+/g, ' ').replace(/^(NOME|CPF|MF|DOC|3\.\d)\s+/g, '').trim();
    if (nome.length > 5 && !avalistas.some((a) => a.documento === m[2])) avalistas.push({ nome, documento: m[2]! });
    if (avalistas.length >= 6) break;
  }
  // Enquadramento indicativo na Lei 11.101 (sempre a conferir: registro da garantia, valor do bem, data).
  const fiduciaria = garantias.some((x) => /fiduci/i.test(x)) || /fiduci/i.test(instrumento);
  const enquadramento: DadosContrato['enquadramento'] = instrumento.startsWith('ACC')
    ? { rj: 'fora', classe: 'Extraconcursal', fundamento: 'Art. 49, § 4º, e art. 86, II, da Lei 11.101/2005 (ACC)', natureza: 'indicio' }
    : instrumento === 'Arrendamento mercantil' ? { rj: 'fora', classe: 'Extraconcursal', fundamento: 'Art. 49, § 3º (arrendamento mercantil)', natureza: 'indicio' }
    : fiduciaria ? { rj: 'fora', classe: 'Extraconcursal (garantia fiduciária)', fundamento: 'Art. 49, § 3º, da Lei 11.101/2005 — depende do registro da garantia e do valor dos bens; o que exceder a garantia entra na RJ', natureza: 'indicio' }
    : instrumento.startsWith('Desconto') ? { rj: 'dentro', classe: 'Classe III — quirografário (direito de regresso do desconto)', fundamento: 'Art. 41, III, da Lei 11.101/2005; títulos já descontados pertencem ao banco', natureza: 'indicio' }
    : garantias.some((x) => /hipoteca|penhor/i.test(x)) ? { rj: 'dentro', classe: 'Classe II — garantia real (até o valor do bem)', fundamento: 'Art. 41, II, e art. 83, II, da Lei 11.101/2005', natureza: 'indicio' }
    : { rj: 'dentro', classe: 'Classe III — quirografário', fundamento: `Art. 41, III, da Lei 11.101/2005${fundoGarantidor ? `; o fundo garantidor (${fundoGarantidor}) se sub-roga no que honrar` : ''}`, natureza: 'indicio' };
  if (!credor && valor === null) return null;
  const dados: DadosContrato & { moeda: string } = { moeda, instrumento, credor, numero, data, valor, valorRotulo, taxaMes, taxaAno, parcelas, valorParcela, vencimentoFinal, prazoDias, garantias, fundoGarantidor, avalistas, enquadramento };
  return { tipo: 'contrato_credito', referencia: `${arquivo} | ${paginas.length} pág.`, dados: dados as unknown as Record<string, unknown> };
}

// -------------------------------------------------------------------- SCR ---

export function lerScr(arquivo: string, paginas: string[][]): ExtracaoLida | null {
  const texto = paginas.flat().join(' | '); const t = norm(texto);
  if (!/scr|registrato/.test(t)) return null;
  const v = (re: RegExp) => { const m = re.exec(texto); return m ? reais(m[1]!) : null; };
  const emDia = v(/Em dia\s*R\$\s*([\d.]+,\d{2})/i); const vencida = v(/Vencida[^R]{0,40}R\$\s*([\d.]+,\d{2})/i);
  const limites = v(/Limites de cr[ée]dito\s*R\$\s*([\d.]+,\d{2})/i); const coobrigacoes = v(/Coobriga[çc][õo]es\s*R\$\s*([\d.]+,\d{2})/i);
  const dividas = v(/D[íi]vidas\s*\|?\s*R\$\s*([\d.]+,\d{2})/i);
  const referencia = /m[eê]s de refer[eê]ncia:?\s*(\d{2}\/\d{4})/i.exec(texto)?.[1] ?? /(\d{2}\/\d{4}) a \d{2}\/\d{4}/.exec(texto)?.[1] ?? null;
  const instituicoes = [...new Set([...texto.matchAll(/\b(BANCO [A-Z][A-Z .]{2,40}?S\.?A\.?|COOPERATIVA DE CR[ÉE]DITO [A-Z .]{3,50}|CAIXA ECON[ÔO]MICA FEDERAL)/g)].map((m) => m[1]!.replace(/\s+/g, ' ').trim()))].slice(0, 30);
  if (emDia === null && vencida === null && dividas === null) return null;
  return { tipo: 'scr', referencia: `${arquivo} | ${paginas.length} pág.`, dados: { referencia, emDia, vencida, limites, coobrigacoes, dividas, instituicoes } };
}

// ------------------------------------------------------- vigência e validade ---

export function lerVigencia(arquivo: string, tipo: 'apolice' | 'licenca', paginas: string[][]): ExtracaoLida | null {
  const texto = paginas.slice(0, 4).flat().join(' '); const t = norm(texto);
  const m = /(?:validade|vigencia|valida ate|vence em|vencimento)[^\d]{0,40}(?:\d{2}\/\d{2}\/\d{4}\s*(?:a|ate)\s*)?(\d{2}\/\d{2}\/\d{4})/.exec(t)
    ?? /val\.?\s*(\d{2}[-.]\d{2}[-.]\d{4})/i.exec(arquivo);
  const vence = m ? dataDoTexto(m[1]!.replace(/[-.]/g, '/')) : null;
  if (!vence) return null;
  const numero = /(?:apolice|portaria|licenca)[^\d]{0,15}([\d][\d./-]{3,})/.exec(t)?.[1] ?? null;
  return { tipo: 'vigencia', referencia: `${arquivo} | ${paginas.length} pág.`, dados: { documento: tipo === 'apolice' ? 'Apólice de seguro' : 'Licença / outorga', numero, vence, titular: /(?:segurado|nome\/razao social|razao social):?\s*([^|]{4,80})/i.exec(texto)?.[1]?.trim() ?? null } };
}

// ---------------------------------------------------------------- matrícula ---

/** Matrícula de imóvel (em geral via OCR): número, cartório, área, proprietário e ônus com o credor. */
export function lerMatricula(arquivo: string, paginasBrutas: string[][]): ExtracaoLida | null {
  const texto = consertarTexto(paginasBrutas).flat().join(' ').replace(/\s+/g, ' '); const t = norm(texto);
  const numero = /matr[ií]cula\s*n?[º°o.]*\s*:?\s*([\d.]{2,9})/i.exec(texto)?.[1]?.replace(/\./g, '') ?? null;
  if (!numero && !/registro de imoveis|serventia registral|livro 2/.test(t)) return null;
  const comarca = /comarca de ([a-zà-ú ]{3,40}?)(?:\s+-|\s+[A-Z]{2}\b|,|\.|\s+serventia|\s+registro|\s+wo\b|$)/i.exec(texto)?.[1]?.trim() ?? null;
  const area = (() => { const m = /([\d.]+,\d{2})\s*m2|([\d.]+,\d{2})\s*m²|([\d.]+,\d{1,4})\s*(?:ha\b|hectares)/i.exec(texto); return m ? (m[1] ? `${m[1]} m²` : m[2] ? `${m[2]} m²` : `${m[3]} ha`) : null; })();
  const proprietario = /propriet[áa]ri[oa]s?:?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ .&-]{5,90}?)(?:,|\s+inscrit|\s+cnpj|\s+cpf|\s+com sede|\s+brasileir)/i.exec(texto)?.[1]?.trim() ?? null;
  // Atos: "R-5/25342 ... ALIENAÇÃO FIDUCIÁRIA ... BANCO X" e "AV-6 ... cancelamento".
  const onus: { ato: string | null; tipo: string; credor: string | null; cancelado: boolean }[] = [];
  const TIPOS_ONUS: [RegExp, string][] = [[/aliena[cç][aã]o fiduci[áa]ria/i, 'Alienação fiduciária'], [/hipoteca/i, 'Hipoteca'], [/penhora/i, 'Penhora'], [/indisponibilidade/i, 'Indisponibilidade'], [/arrolamento/i, 'Arrolamento fiscal'], [/c[ée]dula de cr[ée]dito/i, 'Cédula (garantia)'], [/usufruto/i, 'Usufruto']];
  const atos = texto.split(/(?=\b(?:R|AV|Av)\.?\s?-?\s?\d{1,3}\s*[\/-]\s*\d{3,7}\b)/);
  for (const a of atos) {
    const tipo = TIPOS_ONUS.find(([re]) => re.test(a))?.[1]; if (!tipo) continue;
    const ato = /^((?:R|AV|Av)\.?\s?-?\s?\d{1,3})/.exec(a)?.[1]?.replace(/\s/g, '') ?? null;
    const cancelado = /cancelad|baixa d[ao]|cancelamento/i.test(a.slice(0, 400));
    const credor = bancoDoTexto(a.slice(0, 800)) ?? /(?:credor[a]?|em favor d[eo]|exequente):?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ .&-]{4,70}?)(?:,|\s+inscrit|\s+cnpj)/i.exec(a)?.[1]?.trim() ?? null;
    onus.push({ ato, tipo, credor, cancelado });
  }
  const ativos = onus.filter((o) => !o.cancelado);
  return { tipo: 'matricula', referencia: `${arquivo} | ${paginasBrutas.length} pág.`, dados: { numero, comarca, area, proprietario, onus, onusAtivos: ativos.length, livre: !ativos.length } };
}

// ---------------------------------------------------------- contrato social ---

export function lerContratoSocial(arquivo: string, paginasBrutas: string[][]): ExtracaoLida | null {
  const texto = consertarTexto(paginasBrutas).flat().join(' ').replace(/\s+/g, ' ');
  const capital = (() => { const m = /capital social[^R]{0,120}R\$\s?([\d.]+,\d{2})/i.exec(texto); return m ? reais(m[1]!) : null; })();
  const empresa = /([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ .&-]{4,80}?(?:LTDA|S\/?A|EIRELI|LIMITADA))/.exec(texto)?.[1]?.trim() ?? null;
  const socios: { nome: string; documento: string | null; quotas: number | null; valor: number | null }[] = [];
  for (const m of texto.matchAll(/([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{6,60}?),?\s+(?:brasileir|portador|inscrit|natural)[\s\S]{0,260}?(\d{3}\.\d{3}\.\d{3}-\d{2})/g)) {
    const nome = m[1]!.replace(/\s+/g, ' ').trim(); if (socios.some((x) => x.documento === m[2]) || /^(SOCIO|ADMINISTRADOR|CLAUSULA)/.test(nome)) continue;
    const trecho = texto.slice(m.index!, m.index! + 900);
    const q = /([\d.]{2,12})\s*\(?[a-z ]{0,80}\)?\s*quotas/i.exec(trecho); const v = /quotas[\s\S]{0,120}?R\$\s?([\d.]+,\d{2})/i.exec(trecho);
    socios.push({ nome, documento: m[2]!, quotas: q ? Number(q[1]!.replace(/\./g, '')) : null, valor: v ? reais(v[1]!) : null });
    if (socios.length >= 12) break;
  }
  const administradores = [...new Set([...texto.matchAll(/administra[cç][aã]o[\s\S]{0,200}?(?:caber[áa]|ser[áa] exercida|compete)[\s\S]{0,40}?(?:a[o]?s?\s+s[óo]ci[oa]s?\s+)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{6,60})/gi)].map((m) => m[1]!.trim()))].slice(0, 6);
  if (capital === null && !socios.length) return null;
  return { tipo: 'contrato_social', referencia: `${arquivo} | ${paginasBrutas.length} pág.`, dados: { empresa, capital, socios, administradores } };
}

// ----------------------------------------------------------------- entrada ---

/** Leitura por tipo. Devolve null quando o tipo não tem leitor específico (segue para balanço/DRE). */
export function lerPorTipo(arquivo: string, contexto: string, paginas: string[][], out: ResultadoDaLeitura): TipoDocumento | null {
  if (textoIlegivel(paginas)) return null;
  const tipo = classificar(`${contexto} ${arquivo}`, paginas);
  const add = (x: ExtracaoLida | null, aviso: string) => { if (x) out.extracoes.push(x); else out.avisos.push(`${arquivo}: ${aviso}`); };
  if (tipo === 'extrato') { add(lerExtratoPdf(arquivo, contexto, paginas), 'extrato sem lançamentos reconhecíveis'); return tipo; }
  if (tipo === 'contrato_credito') { add(lerContratoCredito(arquivo, contexto, paginas), 'contrato sem credor ou valor reconhecível'); return tipo; }
  if (tipo === 'scr') { add(lerScr(arquivo, paginas), 'SCR sem totais reconhecíveis'); return tipo; }
  if (tipo === 'apolice' || tipo === 'licenca') { const v = lerVigencia(arquivo, tipo, paginas); if (v) out.extracoes.push(v); return tipo; }
  if (tipo === 'matricula') { add(lerMatricula(arquivo, paginas), 'matrícula sem número ou ônus reconhecíveis'); return tipo; }
  if (tipo === 'contrato_social') { add(lerContratoSocial(arquivo, paginas), 'contrato social sem capital ou sócios reconhecíveis'); return tipo; }
  return null;
}

// ---------------------------------------------------------------- planilhas ---

const num = (c: string | undefined): number | null => {
  if (c === undefined) return null; const s = String(c).trim().replace(/^r\$\s*/i, '');
  if (!s) return null;
  if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return Number(s); // número do Excel ("2050000", "0.38")
  if (/^-?[\d.]*\d,\d+$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  return null;
};
/** Data do Excel (número de série) ou dd/mm/aaaa → ISO. */
const dataPlanilha = (c: string | undefined): string | null => {
  if (!c) return null; const n = Number(c);
  if (/^\d{5}(\.\d+)?$/.test(String(c).trim()) && n > 20_000 && n < 80_000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000).toISOString().slice(0, 10);
  return dataDoTexto(String(c));
};
const acharCabecalho = (linhas: string[][], exigidas: RegExp[], ate = 30) => {
  for (let i = 0; i < Math.min(ate, linhas.length); i++) { const c = linhas[i]!.map(norm); if (exigidas.every((re) => c.some((x) => re.test(x)))) return i; }
  return -1;
};
const idx = (cab: string[], re: RegExp) => cab.findIndex((c) => re.test(norm(c)));

/** Planilhas que o leitor de demonstrações não reconhece: endividamento, QGC, curva ABC de fornecedores,
 *  serviço da dívida por banco e fluxo de caixa diário. */
export function lerPlanilhaFinanceira(arquivo: string, tabelas: { aba: string; linhas: string[][] }[], out: ResultadoDaLeitura): number {
  let n = 0;
  const qgc: { classe: string; credor: string; valor: number; origem: string | null }[] = []; const qgcTotais: Record<string, number> = {};
  const ehQgc = /qgc|quadro geral|relacao de credores|lista de credores/.test(norm(arquivo).replace(/[_-]+/g, " "));
  for (const { aba, linhas } of tabelas) {
    const ref = `${arquivo} | ${aba}`; const na = norm(aba);
    if (ehQgc) {
      // Aba de consolidação (rol, base, resumo) repete as abas das classes: não soma.
      if (/rol|base|relatorio|consolid/.test(na) && !/classe/.test(na)) continue;
      const classe = /trabalh|classe i\b/.test(na) ? 'I' : /garantia real|classe ii\b/.test(na) ? 'II' : /quirograf|classe iii\b/.test(na) ? 'III' : /me.?epp|microempresa|classe iv\b/.test(na) ? 'IV' : /extraconcursal|fiduci/.test(na) ? 'Extraconcursal' : /demais|outras obriga|nao sujeit/.test(na) ? 'Demais obrigações' : null;
      for (const l of linhas) { const m = /classe\s+(i{1,3}v?|iv)\b/i.exec(l.join(' ')); const v = l.map(num).filter((x): x is number => x !== null).at(-1); if (m && v !== undefined && /^(capa|resumo)/.test(na)) qgcTotais[m[1]!.toUpperCase()] = v; }
      const hq = acharCabecalho(linhas, [/^(credor|fornecedor|razao social|nome)/, /valor|saldo/]);
      if (hq >= 0 && !/^(capa|resumo)/.test(na)) {
        const cab = linhas[hq]!; const iC = idx(cab, /^(credor|fornecedor|razao social|nome)/), iV = idx(cab, /valor|saldo/), iO = idx(cab, /origem|natureza|modalidade/);
        for (const l of linhas.slice(hq + 1)) { const credor = l[iC]?.trim(); const valor = num(l[iV]); if (credor && valor && !/^(total|soma|subtotal)/i.test(credor)) qgc.push({ classe: classe ?? 'A classificar', credor, valor, origem: aba }); }
      }
      continue;
    }
    // 1. Endividamento bancário: banco + valor do contrato/saldo devedor.
    let h = acharCabecalho(linhas, [/^(banco|instituicao|credor)/, /(sld|saldo).{0,10}devedor|valor.{0,4}contrato|saldo/]);
    if (h >= 0 && !/taxa/.test(na)) {
      const cab = linhas[h]!; const iB = idx(cab, /^(banco|instituicao|credor)/), iM = idx(cab, /modalidade|produto|linha|tipo/), iV = idx(cab, /valor.{0,4}contrato|valor contratado|valor original/), iS = idx(cab, /(sld|saldo).{0,10}devedor|^saldo/), iP = idx(cab, /qtd|parcelas/), iVP = idx(cab, /(vl|valor).{0,4}parcela/), iD = idx(cab, /data/);
      const itens = linhas.slice(h + 1).filter((l) => l[iB]?.trim() && !/^total/i.test(l[iB]!.trim())).map((l) => ({ credor: l[iB]!.trim(), modalidade: iM >= 0 ? l[iM]?.trim() || null : null, valorContrato: iV >= 0 ? num(l[iV]) : null, saldoDevedor: iS >= 0 ? num(l[iS]) : null, parcelas: iP >= 0 ? num(l[iP]) : null, valorParcela: iVP >= 0 ? num(l[iVP]) : null, data: iD >= 0 ? dataPlanilha(l[iD]) : null })).filter((x) => x.valorContrato !== null || x.saldoDevedor !== null);
      if (itens.length) { out.extracoes.push({ tipo: 'endividamento', referencia: ref, dados: { itens, totalContratado: r2(itens.reduce((t, x) => t + (x.valorContrato ?? 0), 0)), totalSaldo: r2(itens.reduce((t, x) => t + (x.saldoDevedor ?? 0), 0)) } }); n++; continue; }
    }
    // 2. Serviço da dívida: "Banco | Amortização | Juros | Total".
    h = acharCabecalho(linhas, [/^banco/, /amortiza/, /juros/]);
    if (h >= 0) {
      const cab = linhas[h]!; const iB = idx(cab, /^banco/), iA = idx(cab, /amortiza/), iJ = idx(cab, /juros/), iT = idx(cab, /total/);
      const bancos = linhas.slice(h + 1).filter((l) => l[iB]?.trim() && num(l[iA]) !== null && !/^total/i.test(l[iB]!)).map((l) => ({ banco: l[iB]!.trim(), amortizacao: r2(num(l[iA])!), juros: r2(num(l[iJ]) ?? 0), total: r2(num(l[iT]) ?? (num(l[iA])! + (num(l[iJ]) ?? 0))) }));
      if (bancos.length) { const periodo = linhas.slice(0, h).flat().find((x) => /\d{4}/.test(x) && /per[ií]odo|totais/i.test(x)) ?? null; out.extracoes.push({ tipo: 'servico_divida', referencia: ref, dados: { periodo, bancos, total: r2(bancos.reduce((t, x) => t + x.total, 0)) } }); n++; continue; }
    }
    // 3. Fluxo de caixa diário: data + entradas/saídas + saldo do dia.
    h = acharCabecalho(linhas, [/vencimento|^data/, /entrada/, /saida/, /saldo/]);
    if (h >= 0) {
      const cab = linhas[h]!; const iD = idx(cab, /vencimento|^data/), iS = idx(cab, /saldo/);
      const iE = cab.map((c, i) => (/entrada/.test(norm(c)) ? i : -1)).filter((i) => i >= 0), iSa = cab.map((c, i) => (/saida/.test(norm(c)) ? i : -1)).filter((i) => i >= 0);
      const dias = linhas.slice(h + 1).map((l) => ({ data: dataPlanilha(l[iD]?.slice(0, 10)), entradas: r2(iE.reduce((t, i) => t + (num(l[i]) ?? 0), 0)), saidas: r2(iSa.reduce((t, i) => t + (num(l[i]) ?? 0), 0)), saldo: num(l[iS]) })).filter((x) => x.data && x.saldo !== null);
      if (dias.length >= 3) {
        const neg = dias.filter((d) => d.saldo! < 0); const pior = dias.reduce((a, b) => (b.saldo! < a.saldo! ? b : a));
        out.extracoes.push({ tipo: 'fluxo_projetado', referencia: ref, dados: { de: dias[0]!.data, ate: dias.at(-1)!.data, dias: dias.length, diasNegativos: neg.length, piorSaldo: pior.saldo, piorDia: pior.data, entradas: r2(dias.reduce((t, d) => t + d.entradas, 0)), saidas: r2(dias.reduce((t, d) => t + d.saidas, 0)), saldoInicial: dias[0]!.saldo, saldoFinal: dias.at(-1)!.saldo } });
        n++; break; // abas repetidas (cópias) não somam
      }
    }
    // 4. Curva ABC de fornecedores/clientes: nome + valor.
    h = acharCabecalho(linhas, [/^(fornecedor|cliente|razao social|nome)/, /valor/]);
    if (h >= 0) {
      const cab = linhas[h]!; const iN = idx(cab, /^(fornecedor|cliente|razao social|nome)/), iV = idx(cab, /valor (total|na curva)|^valor/), iDoc = idx(cab, /cnpj|cpf/);
      const fornecedor = /fornecedor/.test(norm(cab[iN]!)) || /fornecedor|despesa/.test(norm(arquivo + aba));
      const itens = linhas.slice(h + 1).map((l) => ({ nome: l[iN]?.trim() ?? '', documento: iDoc >= 0 ? l[iDoc]?.trim() || null : null, valor: num(l[iV]) })).filter((x) => x.nome && x.valor !== null && x.valor > 0 && !/^total/i.test(x.nome)) as { nome: string; documento: string | null; valor: number }[];
      if (itens.length >= 3) {
        if (fornecedor) { const tot = itens.reduce((t, x) => t + x.valor, 0); const ord = [...itens].sort((a, b) => b.valor - a.valor); out.extracoes.push({ tipo: 'fornecedores_abc', referencia: ref, dados: { total: r2(tot), quantidade: itens.length, top10: ord.slice(0, 10).map((x) => ({ ...x, percentual: r2((x.valor / tot) * 100) })), percentualTop10: r2((ord.slice(0, 10).reduce((t, x) => t + x.valor, 0) / tot) * 100) } }); }
        else out.extracoes.push({ tipo: 'clientes_abc', referencia: ref, dados: { clientes: itens.map(({ nome, valor }) => ({ nome, valor })) } });
        n++; continue;
      }
    }
    // 5. QGC: abas por classe ("Classe II - Garantia Real", "Quirografários"...) com CREDOR + VALOR, e a capa com os totais.
    const classeDaAba = /trabalh|classe i\b/.test(na) ? 'I' : /garantia real|classe ii\b/.test(na) ? 'II' : /quirograf|classe iii\b/.test(na) ? 'III' : /me.?epp|microempresa|classe iv\b/.test(na) ? 'IV' : /extraconcursal|fiduci/.test(na) ? 'Extraconcursal' : null;
    for (const l of linhas) { const m = /classe\s+(i{1,3}v?|iv)\b/i.exec(l.join(' ')); const v = l.map(num).filter((x): x is number => x !== null).at(-1); if (m && v !== undefined && /^(capa|resumo)/.test(na)) qgcTotais[m[1]!.toUpperCase()] = v; }
    h = acharCabecalho(linhas, [/^credor/, /valor/]);
    if (h >= 0 && (classeDaAba || /qgc|quadro geral|credores/.test(norm(arquivo)))) {
      const cab = linhas[h]!; const iC = idx(cab, /^credor/), iV = idx(cab, /valor/), iO = idx(cab, /origem|natureza/);
      for (const l of linhas.slice(h + 1)) { const credor = l[iC]?.trim(); const valor = num(l[iV]); if (credor && valor && !/^total/i.test(credor)) qgc.push({ classe: classeDaAba ?? 'III', credor, valor, origem: iO >= 0 ? l[iO]?.trim() || null : null }); }
    }
  }
  if (qgc.length || Object.keys(qgcTotais).length) {
    // A capa, quando existe, é o número oficial de cada classe; as abas completam o que a capa não trouxe.
    const porClasse: Record<string, number> = {};
    for (const k of new Set(qgc.map((x) => x.classe))) porClasse[k] = r2(qgc.filter((x) => x.classe === k).reduce((t, x) => t + x.valor, 0));
    Object.assign(porClasse, qgcTotais);
    out.extracoes.push({ tipo: 'qgc', referencia: `${arquivo} | QGC`, dados: { porAba: Object.fromEntries([...new Set(qgc.map((x) => x.origem ?? ''))].map((o) => [o, r2(qgc.filter((x) => (x.origem ?? '') === o).reduce((t, x) => t + x.valor, 0))])), porClasse, totalSujeito: r2(Object.entries(porClasse).filter(([k]) => /^(I|II|III|IV)$/.test(k)).reduce((t, [, x]) => t + x, 0)), total: r2(Object.values(porClasse).reduce((t, x) => t + x, 0)), credores: qgc.length, maiores: [...qgc].sort((a, b) => b.valor - a.valor).slice(0, 15) } });
    n++;
  }
  return n;
}
