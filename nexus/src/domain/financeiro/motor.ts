/**
 * Motor do fluxo de caixa. Separa realizado, comprometido e projetado sem dupla contagem:
 * - realizado: lançamento confirmado (a baixa de um título entra aqui);
 * - comprometido: só o SALDO em aberto do título (atualizado − liquidado);
 * - projetado: lançamento previsto que não esteja ligado a um título.
 */
export type Granularidade = 'dia' | 'semana' | 'mes' | 'trimestre' | 'ano';
export interface LancamentoFluxo { readonly data: string; readonly tipo: 'receita' | 'despesa'; readonly situacao: 'previsto' | 'realizado'; readonly valor: bigint; readonly tituloId?: string | null }
export interface TituloFluxo { readonly tipo: 'pagar' | 'receber'; readonly vencimento: string; readonly valorAtualizado: bigint; readonly valorLiquidado: bigint; readonly situacao: string }
export interface Periodo {
  readonly chave: string; realizadoEntradas: bigint; realizadoSaidas: bigint; comprometidoEntradas: bigint; comprometidoSaidas: bigint;
  projetadoEntradas: bigint; projetadoSaidas: bigint; saldoFinal: bigint;
}

export function segundaDaSemana(data: string): string {
  const d = new Date(`${data}T12:00:00Z`); const s = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - s); return d.toISOString().slice(0, 10);
}
export function chaveDoPeriodo(data: string, g: Granularidade): string {
  if (g === 'dia') return data; if (g === 'semana') return segundaDaSemana(data);
  if (g === 'mes') return data.slice(0, 7); if (g === 'ano') return data.slice(0, 4);
  return `${data.slice(0, 4)}-T${Math.ceil(Number(data.slice(5, 7)) / 3)}`;
}

export function fluxo(entrada: { saldoInicial: bigint; hoje: string; lancamentos: readonly LancamentoFluxo[]; titulos: readonly TituloFluxo[]; granularidade: Granularidade }) {
  const { hoje, granularidade: g } = entrada; const mapa = new Map<string, Periodo>();
  const de = (data: string) => { const chave = chaveDoPeriodo(data, g); let p = mapa.get(chave);
    if (!p) { p = { chave, realizadoEntradas: 0n, realizadoSaidas: 0n, comprometidoEntradas: 0n, comprometidoSaidas: 0n, projetadoEntradas: 0n, projetadoSaidas: 0n, saldoFinal: 0n }; mapa.set(chave, p); } return p; };
  for (const l of entrada.lancamentos) {
    if (l.situacao === 'previsto' && l.tituloId) continue;
    const p = de(l.data); const receita = l.tipo === 'receita';
    if (l.situacao === 'realizado') { if (receita) p.realizadoEntradas += l.valor; else p.realizadoSaidas += l.valor; }
    else if (receita) p.projetadoEntradas += l.valor; else p.projetadoSaidas += l.valor;
  }
  let vencidoPagar = 0n; let vencidoReceber = 0n; let aPagar = 0n; let aReceber = 0n;
  for (const t of entrada.titulos) {
    if (t.situacao === 'cancelado' || t.situacao === 'liquidado') continue;
    const saldo = t.valorAtualizado - t.valorLiquidado; if (saldo <= 0n) continue;
    const vencido = t.vencimento < hoje;
    if (t.tipo === 'pagar') { aPagar += saldo; if (vencido) vencidoPagar += saldo; } else { aReceber += saldo; if (vencido) vencidoReceber += saldo; }
    // Vencido e não pago continua devido: entra no período de hoje, não no passado já fechado.
    const p = de(vencido ? hoje : t.vencimento);
    if (t.tipo === 'pagar') p.comprometidoSaidas += saldo; else p.comprometidoEntradas += saldo;
  }
  const periodos = [...mapa.values()].sort((a, b) => a.chave.localeCompare(b.chave));
  let saldo = entrada.saldoInicial; let realizadoLiquido = 0n;
  for (const p of periodos) {
    realizadoLiquido += p.realizadoEntradas - p.realizadoSaidas;
    saldo += p.realizadoEntradas - p.realizadoSaidas + p.comprometidoEntradas - p.comprometidoSaidas + p.projetadoEntradas - p.projetadoSaidas;
    p.saldoFinal = saldo;
  }
  return { periodos, saldoAtual: entrada.saldoInicial + realizadoLiquido, aPagar, aReceber, vencidoPagar, vencidoReceber,
    periodosNegativos: periodos.filter((p) => p.saldoFinal < 0n).map((p) => p.chave) };
}

export function concentracao(titulos: readonly { contraparte: string; saldo: bigint }[]) {
  const m = new Map<string, bigint>(); let total = 0n;
  for (const t of titulos) { m.set(t.contraparte, (m.get(t.contraparte) ?? 0n) + t.saldo); total += t.saldo; }
  return [...m].sort((a, b) => (a[1] > b[1] ? -1 : 1)).slice(0, 5).map(([contraparte, valor]) => ({ contraparte, valor, percentual: total ? Number((valor * 10000n) / total) / 100 : 0 }));
}
