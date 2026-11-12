/**
 * Leitura de planilhas (XLSX e CSV) para o diagnóstico: reconhece extrato, faturamento, curva ABC, balanço e DRE
 * pelo CABEÇALHO e pelos RÓTULOS, nunca por posição fixa. Aba que não é reconhecida vira aviso, não palpite.
 * Valores em reais. Cada extração sai com `referencia` = "arquivo | aba".
 */
import { lerXlsx } from '../analise/planilha.ts';
import { csv, dataBr, valorBr } from '../financeiro/importacao.ts';

export interface ExtracaoLida { tipo: 'balanco' | 'dre_contabil' | 'dre_gerencial' | 'faturamento' | 'extrato' | 'clientes_abc'; referencia: string; dados: Record<string, unknown> }
export interface ResultadoDaLeitura { extracoes: ExtracaoLida[]; avisos: string[] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const reais = (t: string | undefined): number | null => { if (t === undefined) return null; const c = valorBr(t); return c === null ? null : Number(c) / 100; };

export function tabelasDe(nome: string, bytes: Uint8Array): { aba: string; linhas: string[][] }[] {
  const ext = nome.toLowerCase().split('.').pop();
  if (ext === 'xlsx') return lerXlsx(bytes).map((a) => ({ aba: a.nome, linhas: a.linhas }));
  if (ext === 'csv' || ext === 'txt') { let t = new TextDecoder('utf-8').decode(bytes); if (t.includes('�')) t = new TextDecoder('latin1').decode(bytes); return [{ aba: 'csv', linhas: csv(t) }]; }
  throw new Error(`formato .${ext} não lido automaticamente (use XLSX ou CSV)`);
}

const col = (cab: string[], re: RegExp) => cab.findIndex((c) => re.test(norm(c)));
const bancoDe = (arquivo: string) => (/itau|ita[uú]/i.test(arquivo) ? 'Itaú' : /santander/i.test(arquivo) ? 'Santander' : /bradesco/i.test(arquivo) ? 'Bradesco' : /bb|brasil/i.test(arquivo) ? 'Banco do Brasil' : /caixa/i.test(arquivo) ? 'Caixa' : arquivo.replace(/\.[^.]+$/, ''));

function lerTabela(arquivo: string, aba: string, linhas: string[][], out: ResultadoDaLeitura) {
  const ref = `${arquivo} | ${aba}`;
  // Procura o cabeçalho nas primeiras 15 linhas (extratos costumam ter título antes).
  let h = -1;
  for (let i = 0; i < Math.min(15, linhas.length); i++) { const c = linhas[i]!.map(norm); if (c.some((x) => /^(data|ano|cliente|nome|descricao|conta)/.test(x)) && c.filter(Boolean).length >= 2) { h = i; break; } }
  if (h < 0) { out.avisos.push(`${ref}: cabeçalho não encontrado`); return; }
  const cab = linhas[h]!; const corpo = linhas.slice(h + 1).filter((l) => l.some((x) => x.trim()));

  // Extrato: data + (valor | crédito/débito) + histórico.
  const iData = col(cab, /^(data|dt)/); const iHist = col(cab, /(historico|descricao|lancamento|memo|favorecido)/);
  const iValor = col(cab, /^(valor|montante|vlr)/); const iCred = col(cab, /(credito|entrada)/); const iDeb = col(cab, /(debito|saida)/);
  if (iData >= 0 && iHist >= 0 && (iValor >= 0 || (iCred >= 0 && iDeb >= 0))) {
    const lin: { data: string; valor: number; historico: string }[] = []; let ignoradas = 0;
    for (const l of corpo) {
      const data = dataBr(l[iData] ?? ''); const v = iValor >= 0 ? reais(l[iValor]) : (reais(l[iCred]) ?? 0) - Math.abs(reais(l[iDeb]) ?? 0);
      if (!data || v === null || Number.isNaN(v) || v === 0) { ignoradas++; continue; }
      lin.push({ data, valor: v, historico: (l[iHist] ?? '').trim() });
    }
    if (lin.length) { out.extracoes.push({ tipo: 'extrato', referencia: ref, dados: { banco: bancoDe(arquivo), linhas: lin } }); if (ignoradas > 2) out.avisos.push(`${ref}: ${ignoradas} linhas sem data ou valor foram ignoradas (saldos, totais ou texto)`); return; }
  }
  // Faturamento: ano + fiscal + gerencial.
  const iAno = col(cab, /^(ano|exercicio|periodo)/); const iFis = col(cab, /fiscal/); const iGer = col(cab, /gerencial/);
  if (iAno >= 0 && (iFis >= 0 || iGer >= 0)) {
    let n = 0; for (const l of corpo) { const ano = Number(/\d{4}/.exec(l[iAno] ?? '')?.[0]); if (!ano) continue; out.extracoes.push({ tipo: 'faturamento', referencia: ref, dados: { ano, fiscal: iFis >= 0 ? reais(l[iFis]) : null, gerencial: iGer >= 0 ? reais(l[iGer]) : null } }); n++; }
    if (n) return;
  }
  // Curva ABC de clientes: nome + valor, sem data.
  const iNome = col(cab, /^(cliente|nome|razao)/); const iVal = col(cab, /(valor|faturamento|total|receita)/);
  if (iNome >= 0 && iVal >= 0 && iData < 0) {
    const clientes = corpo.map((l) => ({ nome: (l[iNome] ?? '').trim(), valor: reais(l[iVal]) ?? 0 })).filter((c) => c.nome && c.valor > 0 && !/^total/i.test(c.nome));
    if (clientes.length) { out.extracoes.push({ tipo: 'clientes_abc', referencia: ref, dados: { clientes } }); return; }
  }
  // Demonstrações: rótulo na primeira coluna e anos nas colunas de valor.
  const cabAnos = cab.map((c, i) => ({ i, ano: /^(?:\D*)(20\d{2}|19\d{2})\D*$/.exec(c.trim())?.[1] })).filter((x) => x.ano);
  if (cabAnos.length) {
    const achar = (re: RegExp) => corpo.find((l) => re.test(norm(l[0] ?? '')));
    const pistas = { ac: achar(/^ativo circulante/), anc: achar(/^ativo nao circulante|^ativo permanente|^ativo realizavel a longo/), pc: achar(/^passivo circulante/), pnc: achar(/^passivo nao circulante|^exigivel a longo/), pl: achar(/^patrimonio liquido/), rec: achar(/^receita (operacional )?bruta|^faturamento bruto|^receita bruta/), res: achar(/^(resultado|lucro|prejuizo)( liquido)?( do (exercicio|periodo))?$|^lucro\/prejuizo|^resultado liquido/) };
    const gerencial = /gerencial/i.test(`${arquivo} ${aba}`);
    for (const { i, ano } of cabAnos) {
      const v = (l?: string[]) => (l ? reais(l[i]) : null);
      if (pistas.ac && pistas.anc && pistas.pc && pistas.pnc && pistas.pl) out.extracoes.push({ tipo: 'balanco', referencia: ref, dados: { exercicio: Number(ano), ativoCirculante: v(pistas.ac), ativoNaoCirculante: v(pistas.anc), passivoCirculante: v(pistas.pc), passivoNaoCirculante: v(pistas.pnc), patrimonioLiquido: v(pistas.pl), convencao: 'sinal' } });
      else if (pistas.rec || pistas.res) out.extracoes.push({ tipo: gerencial ? 'dre_gerencial' : 'dre_contabil', referencia: ref, dados: { exercicio: Number(ano), receitaBruta: v(pistas.rec), resultado: v(pistas.res) } });
    }
    if (out.extracoes.some((x) => x.referencia === ref)) return;
  }
  out.avisos.push(`${ref}: layout não reconhecido (esperado: extrato, faturamento por ano, clientes ou demonstração por exercício)`);
}

export function lerPlanilha(arquivo: string, bytes: Uint8Array): ResultadoDaLeitura {
  const out: ResultadoDaLeitura = { extracoes: [], avisos: [] };
  let tabelas; try { tabelas = tabelasDe(arquivo, bytes); } catch (e) { out.avisos.push(`${arquivo}: ${(e as Error).message}`); return out; }
  for (const t of tabelas) { if (t.linhas.length < 2) continue; try { lerTabela(arquivo, t.aba, t.linhas, out); } catch (e) { out.avisos.push(`${arquivo} | ${t.aba}: falha na leitura (${(e as Error).message})`); } }
  if (!out.extracoes.length && !out.avisos.length) out.avisos.push(`${arquivo}: planilha vazia`);
  return out;
}

/**
 * Balanço e DRE em PDF com texto: cada linha visual vira uma linha de tabela
 * (rótulo + valores) e o cabeçalho é a linha com os exercícios. Assim o mesmo
 * reconhecedor das planilhas lê o PDF, pelos rótulos, sem posição fixa.
 * Só entra página que tem cabeçalho de exercícios; o resto vira aviso.
 */
export function lerTextoDeDemonstracao(arquivo: string, paginas: string[][]): ResultadoDaLeitura {
  const out: ResultadoDaLeitura = { extracoes: [], avisos: [] };
  const NUM = /\(?-?\d{1,3}(?:\.\d{3})*,\d{2}\)?|\(?-?\d+,\d{2}\)?/g;
  paginas.forEach((linhas, p) => {
    const aba = `página ${p + 1}`;
    const iCab = linhas.findIndex((l) => (l.match(/\b(?:19|20)\d{2}\b/g) ?? []).length >= 1 && !(l.match(NUM) ?? []).length && /(exerc|31\/12|dezembro|\b20\d{2}\b)/i.test(l));
    if (iCab < 0) return;
    const anos = [...new Set(linhas[iCab]!.match(/\b(?:19|20)\d{2}\b/g) ?? [])];
    const tabela: string[][] = [['Conta', ...anos]];
    for (const l of linhas.slice(iCab + 1)) {
      const nums = [...l.matchAll(NUM)]; if (!nums.length) continue;
      const rotulo = l.slice(0, nums[0]!.index).replace(/\s+\d{1,3}$/, '').trim(); if (!/[a-zA-ZÀ-ú]{3}/.test(rotulo)) continue;
      // Valores alinhados à direita: com mais valores que anos (nota explicativa etc.), ficam os últimos.
      const v = nums.map((m) => m[0]).slice(-anos.length);
      tabela.push([rotulo, ...Array(anos.length - v.length).fill(''), ...v]);
    }
    if (tabela.length > 2) { try { lerTabela(arquivo, aba, tabela, out); } catch (e) { out.avisos.push(`${arquivo} | ${aba}: falha na leitura (${(e as Error).message})`); } }
  });
  if (!out.extracoes.length) out.avisos.push(`${arquivo}: PDF lido, mas sem balanço ou DRE reconhecível (procurei uma linha de exercícios e contas como "Ativo circulante" e "Receita bruta").`);
  // Leitura de PDF é menos firme que planilha: o diagnóstico mostra a origem para conferência.
  return out;
}
