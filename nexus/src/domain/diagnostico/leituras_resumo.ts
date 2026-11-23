/**
 * Consolida, para o diagnóstico, o que os leitores de documentos extraíram (leitores.ts): contas bancárias
 * mês a mês com a conferência de saldo, contratos de crédito sem duplicidade, endividamento, QGC, serviço da
 * dívida, fluxo de caixa projetado, fornecedores, SCR e vigências. Aritmética por código; cada número mantém
 * o arquivo de origem; o que é indício (enquadramento na Lei 11.101) continua marcado como indício.
 */
import type { DadosContrato, DadosExtrato } from './leitores.ts';

export interface Extraida { tipo: string; referencia: string; dados: Record<string, unknown> }
const r2 = (n: number) => Math.round(n * 100) / 100;
const arq = (ref: string) => ref.split(' | ')[0]!;
const soma = (xs: readonly number[]) => r2(xs.reduce((t, x) => t + x, 0));

export function resumirLeituras(ex: readonly Extraida[], hoje: string) {
  const de = (t: string) => ex.filter((x) => x.tipo === t);

  // ---- contas bancárias (extratos em PDF) ----
  const porConta = new Map<string, { banco: string; conta: string | null; meses: (Pick<DadosExtrato, 'periodo' | 'saldoInicial' | 'saldoFinal' | 'entradas' | 'saidas' | 'confere' | 'diferenca'> & { arquivo: string })[]; sinais: Record<string, number> }>();
  for (const x of de('extrato')) {
    const d = x.dados as unknown as DadosExtrato; if (!d.periodo || !Array.isArray(d.linhas)) continue; // extrato de planilha segue o caminho antigo
    const k = `${d.banco}|${(d.conta ?? '').replace(/\D/g, '').replace(/^0+/, '')}`;
    const c = porConta.get(k) ?? { banco: d.banco, conta: d.conta, meses: [], sinais: {} };
    if (!c.meses.some((m) => m.periodo.de === d.periodo.de && m.periodo.ate === d.periodo.ate && m.entradas === d.entradas)) {
      c.meses.push({ periodo: d.periodo, saldoInicial: d.saldoInicial, saldoFinal: d.saldoFinal, entradas: d.entradas, saidas: d.saidas, confere: d.confere, diferenca: d.diferenca, arquivo: arq(x.referencia) });
      for (const [s, v] of Object.entries(d.sinais ?? {})) c.sinais[s] = r2((c.sinais[s] ?? 0) + v);
    }
    porConta.set(k, c);
  }
  const contas = [...porConta.values()].map((c) => {
    const meses = c.meses.sort((a, b) => String(a.periodo.de).localeCompare(String(b.periodo.de)));
    const ok = meses.filter((m) => m.confere === true);
    return { banco: c.banco, conta: c.conta, meses, mesesConferidos: ok.length, mesesSemConferencia: meses.length - ok.length,
      entradas: soma(ok.map((m) => m.entradas)), saidas: soma(ok.map((m) => m.saidas)), saldoFinal: meses.at(-1)?.saldoFinal ?? null, sinais: c.sinais };
  }).sort((a, b) => b.entradas - a.entradas);

  // ---- contratos de crédito ----
  const vistos = new Set<string>();
  const contratos = de('contrato_credito').map((x) => ({ ...(x.dados as unknown as DadosContrato & { moeda?: string }), arquivo: arq(x.referencia) }))
    .filter((c) => { const k = `${c.credor}|${c.numero ?? ''}|${c.valor ?? ''}|${c.instrumento}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
  const emReais = contratos.filter((c) => (c.moeda ?? 'BRL') === 'BRL' && c.valor !== null);
  const porCredor = new Map<string, { credor: string; n: number; total: number; fora: number }>();
  for (const c of emReais) { const k = c.credor ?? 'Credor não identificado'; const p = porCredor.get(k) ?? { credor: k, n: 0, total: 0, fora: 0 }; p.n++; p.total = r2(p.total + c.valor!); if (c.enquadramento.rj === 'fora') p.fora = r2(p.fora + c.valor!); porCredor.set(k, p); }
  const avalistas = new Map<string, { nome: string; documento: string | null; contratos: number; valor: number }>();
  for (const c of contratos) for (const a of c.avalistas ?? []) { const k = a.documento ?? a.nome; const v = avalistas.get(k) ?? { nome: a.nome, documento: a.documento, contratos: 0, valor: 0 }; v.contratos++; v.valor = r2(v.valor + (c.valor ?? 0)); avalistas.set(k, v); }
  const resumoContratos = contratos.length ? {
    quantidade: contratos.length, totalContratado: soma(emReais.map((c) => c.valor!)), foraDaRj: soma(emReais.filter((c) => c.enquadramento.rj === 'fora').map((c) => c.valor!)),
    emMoedaEstrangeira: contratos.filter((c) => (c.moeda ?? 'BRL') !== 'BRL').map((c) => ({ credor: c.credor, moeda: c.moeda!, valor: c.valor })),
    porCredor: [...porCredor.values()].sort((a, b) => b.total - a.total), avalistas: [...avalistas.values()].sort((a, b) => b.valor - a.valor),
    comFundoGarantidor: contratos.filter((c) => c.fundoGarantidor).length,
  } : null;

  // ---- planilhas ----
  const endividamento = de('endividamento').map((x) => ({ ...(x.dados as { itens: { credor: string; modalidade: string | null; valorContrato: number | null; saldoDevedor: number | null; parcelas: number | null; valorParcela: number | null; data: string | null }[]; totalContratado: number; totalSaldo: number }), arquivo: arq(x.referencia) }));
  const qgc = de('qgc').map((x) => ({ ...(x.dados as { porClasse: Record<string, number>; totalSujeito: number; total: number; credores: number; maiores: { classe: string; credor: string; valor: number }[] }), arquivo: arq(x.referencia) }));
  const servicoDivida = de('servico_divida').map((x) => ({ ...(x.dados as { periodo: string | null; bancos: { banco: string; amortizacao: number; juros: number; total: number }[]; total: number }), arquivo: arq(x.referencia) }));
  const fluxo = de('fluxo_projetado').map((x) => ({ ...(x.dados as { de: string; ate: string; dias: number; diasNegativos: number; piorSaldo: number; piorDia: string; entradas: number; saidas: number; saldoInicial: number; saldoFinal: number }), arquivo: arq(x.referencia) }));
  const fornecedores = de('fornecedores_abc').map((x) => ({ ...(x.dados as { total: number; quantidade: number; top10: { nome: string; valor: number; percentual: number }[]; percentualTop10: number }), arquivo: arq(x.referencia) })).sort((a, b) => b.quantidade - a.quantidade).slice(0, 1);
  const scr = de('scr').map((x) => ({ ...(x.dados as { referencia: string | null; emDia: number | null; vencida: number | null; limites: number | null; coobrigacoes: number | null; dividas: number | null; instituicoes: string[] }), arquivo: arq(x.referencia) }));
  const vigencias = de('vigencia').map((x) => { const d = x.dados as { documento: string; numero: string | null; vence: string }; return { ...d, vencido: d.vence < hoje, arquivo: arq(x.referencia) }; }).sort((a, b) => a.vence.localeCompare(b.vence));

  const imoveis = de('matricula').map((x) => ({ ...(x.dados as { numero: string | null; comarca: string | null; area: string | null; proprietario: string | null; onus: { ato: string | null; tipo: string; credor: string | null; cancelado: boolean }[]; onusAtivos: number; livre: boolean }), arquivo: arq(x.referencia) }));
  const sociedade = de('contrato_social').map((x) => ({ ...(x.dados as { empresa: string | null; capital: number | null; socios: { nome: string; documento: string | null; quotas: number | null; valor: number | null }[]; administradores: string[] }), arquivo: arq(x.referencia) }));

  // ---- riscos que os documentos mostram ----
  const riscos: { tema: string; achado: string; porQueImporta: string; natureza: 'fato' | 'hipotese' | 'pendencia'; prioridade: 'Alta' | 'Media' }[] = [];
  const f0 = fluxo[0];
  if (f0 && f0.diasNegativos) riscos.push({ tema: 'Caixa', achado: `Fluxo de caixa projetado negativo em ${f0.diasNegativos} de ${f0.dias} dias; pior saldo R$ ${(f0.piorSaldo / 1e6).toFixed(2).replace('.', ',')} mi em ${f0.piorDia.split('-').reverse().join('/')}`, porQueImporta: 'Mostra a urgência: sem medida (RJ, stay, renegociação), o caixa não cobre os compromissos do período.', natureza: 'fato', prioridade: f0.diasNegativos / f0.dias >= 0.3 ? 'Alta' : 'Media' });
  if (resumoContratos && resumoContratos.foraDaRj) riscos.push({ tema: 'Garantias fiduciárias', achado: `${Math.round((resumoContratos.foraDaRj / Math.max(1, resumoContratos.totalContratado)) * 100)}% do valor contratado nos contratos lidos tem garantia fiduciária (R$ ${(resumoContratos.foraDaRj / 1e6).toFixed(1).replace('.', ',')} mi)`, porQueImporta: 'Crédito com alienação ou cessão fiduciária fica fora da RJ (art. 49, § 3º): esses bancos podem manter travas e retomar bens. Conferir registro e valor das garantias.', natureza: 'hipotese', prioridade: 'Alta' });
  const bloq = contas.reduce((t, c) => t + (c.sinais.bloqueioJudicial ?? 0), 0);
  if (bloq > 0) riscos.push({ tema: 'Constrição judicial', achado: `Bloqueios judiciais nos extratos somam R$ ${bloq.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, porQueImporta: 'Indica execuções em curso atingindo o caixa: entram no mapa do passivo e na urgência do pedido.', natureza: 'fato', prioridade: 'Alta' });
  const vencidas = vigencias.filter((v) => v.vencido);
  if (vencidas.length) riscos.push({ tema: 'Licenças e seguros', achado: `${vencidas.length} documento(s) com validade vencida: ${vencidas.slice(0, 3).map((v) => `${v.documento} ${v.numero ?? ''} (${v.vence.split('-').reverse().join('/')})`).join('; ')}`, porQueImporta: 'Licença vencida pode parar a operação; apólice vencida deixa ativos dados em garantia descobertos.', natureza: 'fato', prioridade: 'Media' });
  if (resumoContratos?.avalistas.length) riscos.push({ tema: 'Sócios garantidores', achado: `${resumoContratos.avalistas.length} avalista(s) nos contratos: ${resumoContratos.avalistas.slice(0, 3).map((a) => a.nome).join(', ')}`, porQueImporta: 'A RJ não protege o avalista (Súmula 581 do STJ): os bancos podem cobrar dos sócios. Mapear o patrimônio deles.', natureza: 'fato', prioridade: 'Alta' });
  const onerados = imoveis.filter((i) => !i.livre);
  if (onerados.length) riscos.push({ tema: 'Imóveis', achado: `${onerados.length} de ${imoveis.length} matrícula(s) com ônus ativo: ${onerados.slice(0, 3).map((i) => `nº ${i.numero ?? '?'} (${i.onus.filter((o) => !o.cancelado).map((o) => `${o.tipo}${o.credor ? ` · ${o.credor}` : ''}`).join(', ')})`).join('; ')}`, porQueImporta: 'Imóvel alienado fiduciariamente garante crédito fora da RJ; penhora e indisponibilidade mostram execução avançando sobre o ativo.', natureza: 'fato', prioridade: 'Alta' });
  const semConf = contas.reduce((t, c) => t + c.mesesSemConferencia, 0);
  if (semConf) riscos.push({ tema: 'Extratos', achado: `${semConf} extrato(s) mensal(is) não fecham com o saldo do banco na leitura automática`, porQueImporta: 'Os números dessas contas ficam fora dos indicadores até a conferência manual ou o envio em planilha/OFX.', natureza: 'pendencia', prioridade: 'Media' });

  return { imoveis, sociedade, contas, contratos, resumoContratos, endividamento, qgc, servicoDivida, fluxo, fornecedores, scr, vigencias, riscos,
    vazio: !imoveis.length && !sociedade.length && !contas.length && !contratos.length && !endividamento.length && !qgc.length && !servicoDivida.length && !fluxo.length && !scr.length };
}
export type ResumoDeLeituras = ReturnType<typeof resumirLeituras>;
