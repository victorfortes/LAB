/**
 * Patrimônio dos sócios: quem são, o que têm, o que está onerado e quem garantiu dívida da empresa.
 *
 * Pura e determinística: recebe os bens registrados (manual, QSA ou documento) e devolve o quadro por sócio
 * e os alertas. Não conclui sobre responsabilidade: aponta onde olhar, sempre como hipótese de trabalho.
 */
export type Natureza = 'imovel' | 'veiculo' | 'participacao' | 'aplicacao' | 'rural' | 'outro' | 'sem_bens';
export interface BemDoSocio {
  socio: string; documento?: string | null; qualificacao?: string | null; natureza: Natureza; descricao: string;
  /** Centavos. Nulo é "não informado", nunca zero. */
  valor?: number | null; onus?: string | null; garantidor?: boolean; fonte?: string; referencia?: string | null;
}
export interface QuadroDoSocio {
  socio: string; documento: string | null; qualificacao: string | null; garantidor: boolean;
  total: number; onerado: number; bens: number; semValor: number;
  porNatureza: { natureza: Natureza; rotulo: string; valor: number; quantidade: number }[];
  situacao: 'levantar' | 'sem_risco_aparente' | 'atencao' | 'critico';
}
export interface PatrimonioDosSocios {
  socios: QuadroDoSocio[]; total: number; onerado: number; garantidores: number; semLevantamento: number;
  alertas: { tom: 'erro' | 'aviso' | 'info'; titulo: string; detalhe: string }[];
}

export const ROTULO_NATUREZA: Record<Natureza, string> = {
  imovel: 'Imóveis', veiculo: 'Veículos', participacao: 'Participações societárias', aplicacao: 'Aplicações e contas',
  rural: 'Imóveis e bens rurais', outro: 'Outros bens', sem_bens: 'Bens a levantar',
};

const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const reais = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function quadroDosSocios(bens: BemDoSocio[]): PatrimonioDosSocios {
  const grupos = new Map<string, BemDoSocio[]>();
  for (const b of bens) grupos.set(chave(b.socio), [...(grupos.get(chave(b.socio)) ?? []), b]);
  const socios: QuadroDoSocio[] = [...grupos.values()].map((lista) => {
    const reaisBens = lista.filter((b) => b.natureza !== 'sem_bens');
    const total = reaisBens.reduce((s, b) => s + (b.valor ?? 0), 0);
    const onerado = reaisBens.filter((b) => b.onus && b.onus.trim()).reduce((s, b) => s + (b.valor ?? 0), 0);
    const garantidor = lista.some((b) => b.garantidor);
    const porNat = new Map<Natureza, { valor: number; quantidade: number }>();
    for (const b of reaisBens) { const a = porNat.get(b.natureza) ?? { valor: 0, quantidade: 0 }; porNat.set(b.natureza, { valor: a.valor + (b.valor ?? 0), quantidade: a.quantidade + 1 }); }
    const situacao: QuadroDoSocio['situacao'] = !reaisBens.length ? 'levantar'
      : garantidor && total > 0 ? 'critico'
        : onerado > 0 && onerado >= total * 0.5 ? 'atencao' : 'sem_risco_aparente';
    const ref = lista.find((b) => b.documento) ?? lista[0]!;
    return {
      socio: lista[0]!.socio.trim(), documento: ref.documento ?? null, qualificacao: lista.find((b) => b.qualificacao)?.qualificacao ?? null, garantidor,
      total, onerado, bens: reaisBens.length, semValor: reaisBens.filter((b) => b.valor === null || b.valor === undefined).length,
      porNatureza: [...porNat].map(([natureza, v]) => ({ natureza, rotulo: ROTULO_NATUREZA[natureza], ...v })).sort((a, b) => b.valor - a.valor),
      situacao,
    };
  }).sort((a, b) => b.total - a.total || a.socio.localeCompare(b.socio, 'pt-BR'));

  const alertas: PatrimonioDosSocios['alertas'] = [];
  for (const s of socios.filter((x) => x.situacao === 'critico')) {
    alertas.push({ tom: 'erro', titulo: `${s.socio} garantiu dívida da empresa e tem ${reais(s.total)} em bens`,
      detalhe: 'Aval e fiança não se suspendem com a recuperação judicial (STJ, Súmula 581): o credor pode executar o sócio. Mapear quais contratos ele garantiu e a essencialidade dos bens.' });
  }
  for (const s of socios.filter((x) => x.situacao === 'atencao')) {
    alertas.push({ tom: 'aviso', titulo: `${s.socio}: ${Math.round((s.onerado / Math.max(1, s.total)) * 100)}% do patrimônio está onerado`,
      detalhe: 'Bens com alienação fiduciária, hipoteca ou penhora. Conferir se garantem dívida da empresa (garantia real de terceiro).' });
  }
  const levantar = socios.filter((x) => x.situacao === 'levantar');
  if (levantar.length) alertas.push({ tom: 'info', titulo: `${levantar.length} sócio(s) sem bens levantados`, detalhe: `Pedir IRPF (declaração de bens), matrículas e CRLV de: ${levantar.map((x) => x.socio).join(', ')}.` });
  const semValor = socios.reduce((s, x) => s + x.semValor, 0);
  if (semValor) alertas.push({ tom: 'info', titulo: `${semValor} bem(ns) sem valor informado`, detalhe: 'Valor nulo fica fora das somas: informe o valor do IRPF ou de avaliação.' });

  return {
    socios, total: socios.reduce((s, x) => s + x.total, 0), onerado: socios.reduce((s, x) => s + x.onerado, 0),
    garantidores: socios.filter((x) => x.garantidor).length, semLevantamento: levantar.length, alertas,
  };
}

/** Sócios do QSA (BrasilAPI / Receita) viram linhas "bens a levantar" — nunca duplicam quem já está registrado. */
export function sociosDoQsa(qsa: { nome_socio?: string; cnpj_cpf_do_socio?: string; qualificacao_socio?: string }[], existentes: string[]): BemDoSocio[] {
  const ja = new Set(existentes.map(chave));
  return qsa.filter((q) => q.nome_socio && !ja.has(chave(q.nome_socio))).map((q) => ({
    socio: q.nome_socio!.trim(), documento: /^\d{11}$|^\d{14}$/.test(String(q.cnpj_cpf_do_socio ?? '').replace(/\D/g, '')) ? String(q.cnpj_cpf_do_socio).replace(/\D/g, '') : null,
    qualificacao: q.qualificacao_socio ?? null, natureza: 'sem_bens' as const, descricao: 'Sócio no quadro societário da Receita: bens a levantar', fonte: 'qsa',
  }));
}
