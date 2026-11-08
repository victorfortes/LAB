/**
 * Lançamento por linguagem natural, sem modelo: extração por regras, sempre com
 * prévia e confirmação. O que não está na frase vira campo faltante, nunca palpite.
 * Nada aqui movimenta dinheiro: só prepara um registro.
 */
export interface Interpretacao {
  natureza: 'lancamento' | 'titulo'; tipo: 'receita' | 'despesa'; valor: string | null; data: string | null; situacao: 'realizado' | 'previsto';
  parcelas: number; contraparte: string | null; categoria: string; faltando: string[];
}
const MESES: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const EXTENSO: Record<string, number> = { duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12 };
const CATEGORIAS: Array<[RegExp, string]> = [[/aluguel|locacao/, 'Aluguel'], [/folha|salario|funcionari/, 'Folha'], [/fornecedor/, 'Fornecedores'], [/imposto|tributo|das\b|icms|iss\b|inss|fgts/, 'Tributos'], [/combustivel|diesel|pedagio/, 'Frota'], [/energia|agua|internet|telefone/, 'Utilidades'], [/venda|cliente|frete/, 'Receita operacional'], [/honorario/, 'Honorários']];
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function valorEmCentavos(t: string): string | null {
  const m = /r\$\s*([\d.]+(?:,\d{1,2})?)|\b(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{2})\b/i.exec(t); const bruto = m?.[1] ?? m?.[2]; if (!bruto) return null;
  const [i, c = ''] = bruto.replaceAll('.', '').split(','); return (BigInt(i!) * 100n + BigInt(c.padEnd(2, '0'))).toString();
}

function dataDe(t: string, hoje: string): string | null {
  const base = new Date(`${hoje}T12:00:00Z`);
  if (/\banteontem\b/.test(t)) { base.setUTCDate(base.getUTCDate() - 2); return iso(base); }
  if (/\bontem\b/.test(t)) { base.setUTCDate(base.getUTCDate() - 1); return iso(base); }
  if (/\bamanha\b/.test(t)) { base.setUTCDate(base.getUTCDate() + 1); return iso(base); }
  if (/\bhoje\b/.test(t)) return hoje;
  const num = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  const porNome = /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/.exec(t);
  const d = num ? Number(num[1]) : porNome ? Number(porNome[1]) : 0; const m = num ? Number(num[2]) : porNome ? MESES[porNome[2]!]! : 0;
  if (!d || !m || m > 12 || d > 31) return null;
  const a = num?.[3] ? Number(num[3].length === 2 ? `20${num[3]}` : num[3]) : porNome?.[3] ? Number(porNome[3]) : Number(hoje.slice(0, 4));
  let r = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Sem ano escrito, data já passada num recebível aponta para o próximo ano.
  if (!num?.[3] && !porNome?.[3] && r < hoje && /receber|vence|vai/.test(t)) r = `${a + 1}${r.slice(4)}`;
  return r;
}

export function interpretar(frase: string, hoje: string): Interpretacao {
  const t = semAcento(frase);
  const aReceber = /(para|a|vou) receber|recebivel/.test(t); const aPagar = /(para|a|vou|tenho que) pagar|boleto|vence|em \w+ parcelas|\d+x\b/.test(t);
  const recebi = /\b(recebi|recebemos|entrou|vendi|vendemos)\b/.test(t);
  const tipo: Interpretacao['tipo'] = aReceber || recebi ? 'receita' : 'despesa';
  const pm = /em\s+(\d+|\w+)\s+parcelas|(\d+)x\b/.exec(t); const parcelas = pm ? (pm[2] ? Number(pm[2]) : /^\d+$/.test(pm[1]!) ? Number(pm[1]) : EXTENSO[pm[1]!] ?? 1) : 1;
  const natureza: Interpretacao['natureza'] = aReceber || aPagar || parcelas > 1 ? 'titulo' : 'lancamento';
  const valor = valorEmCentavos(frase); const data = dataDe(t, hoje);
  const cm = /\b(?:da|do|de)\s+(?:empresa\s+)?([A-ZÀ-Ú][\wÀ-ú&.-]*(?:\s+[A-ZÀ-Ú][\wÀ-ú&.-]*)*)/.exec(frase);
  const categoria = CATEGORIAS.find(([r]) => r.test(t))?.[1] ?? 'Sem categoria';
  const faltando: string[] = [];
  if (!valor) faltando.push('valor');
  if (!data) faltando.push(natureza === 'titulo' ? 'vencimento' : 'data');
  if (natureza === 'titulo' && !cm) faltando.push('contraparte');
  return { natureza, tipo, valor, data, situacao: natureza === 'titulo' ? 'previsto' : 'realizado', parcelas, contraparte: cm?.[1] ?? null, categoria, faltando };
}
