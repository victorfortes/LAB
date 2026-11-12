/**
 * Monta o JSON do diagnóstico inicial, sempre com as mesmas 11 seções, na mesma ordem.
 *
 * Seção sem dado não some: fica com `semDados` e a lista do que pedir. Todo número carrega a referência do
 * arquivo de onde veio (campo `ref`), para a tela mostrar a origem e a auditoria conferir.
 */
import {
  analisarBalanco, analisarExtrato, assinaturaTardia, coberturaDoChecklist, compararDre, compararFaturamento, curvaAbc,
  exerciciosAusentes, faixaDePassivo, limparTextos, matrizDeRiscos, type Balanco, type Dre, type Extrato, type Faturamento,
  type ItemDoChecklist, type PassivoFonte, type Qualidade,
} from './analises.ts';
import { enquadramento, type MapaDoEndividamento } from './juridico.ts';
import type { PatrimonioDosSocios } from './socios.ts';

export interface DocumentoLido { id: string; nome: string; area: string; estado: string; qualidade: Qualidade; detalhe: string | null }
export interface EntradaDoDiagnostico {
  projeto: { nome: string; razaoSocial: string | null; posicao: 'devedor' | 'credor' };
  dataBase: string; geradoPor: string; versao: number;
  documentos: DocumentoLido[];
  checklist: ItemDoChecklist[];
  portal: { obrigatorios: number; enviados: number; aprovados: number };
  balancos: Balanco[]; dres: Dre[]; faturamento: Faturamento[]; extratos: Extrato[]; passivo: PassivoFonte[];
  clientesAbc: { nome: string; valor: number; ref: { arquivo: string; local?: string } }[];
  relacionadas: string[];
  /** Documentos que a lei exige e o checklist não traz: sempre listados como pendência. */
  foraDoChecklist?: string[];
  /** Avisos da leitura automática de planilhas (layout não reconhecido, linhas ignoradas). Entram em "Limites desta análise". */
  avisosDeLeitura?: string[];
  /** Mapa do endividamento por natureza (balanço e balancete mais recentes). */
  endividamento?: MapaDoEndividamento[];
  /** Respostas do cliente ao checklist em planilha; quando existem, a cobertura usa elas. */
  respostasCliente?: ItemDoChecklist[];
  /** Patrimônio dos sócios (quadro por sócio e alertas). */
  socios?: PatrimonioDosSocios;
}

export const AVISO = 'Leitura automática para revisão profissional. Não conclui sobre viabilidade. Confira vigência e julgados antes de citar qualquer tese.';
const FORA_PADRAO = ['Relação de empregados', 'Certidões de protesto', 'Extratos de todas as contas bancárias', 'Contrato de locação do imóvel da operação'];

const semDados = (pedir: string[]) => ({ semDados: true as const, pedir });

export function montarRelatorio(e: EntradaDoDiagnostico) {
  const cobertura = coberturaDoChecklist(e.respostasCliente?.length ? e.respostasCliente : e.checklist);
  const balancos = e.balancos.map(analisarBalanco).sort((a, b) => a.exercicio - b.exercicio);
  const faturamento = e.faturamento.length ? compararFaturamento(e.faturamento) : null;
  const dre = e.dres.length ? compararDre(e.dres) : [];
  const extratos = e.extratos.map((x) => analisarExtrato(x, e.relacionadas));
  const passivo = faixaDePassivo(e.passivo);
  const abc = e.clientesAbc.length ? curvaAbc(e.clientesAbc) : null;
  const ilegiveis = e.documentos.filter((d) => d.qualidade === 'ilegivel' || d.estado === 'erro' || d.estado === 'sem_texto');
  const riscos = matrizDeRiscos({ posicao: e.projeto.posicao, faturamento: faturamento ?? undefined, dre, balancos, extratos, passivo, cobertura: cobertura.total ? cobertura : undefined, legiveis: { lidos: e.documentos.length - ilegiveis.length, ilegiveis: ilegiveis.length } });

  // Leitura jurídica: o passivo por natureza e o enquadramento na Lei 11.101.
  const mapa = e.endividamento?.[0] ?? null;
  const anos = [...e.balancos.map((b) => b.exercicio), ...e.dres.map((d) => d.exercicio), ...e.faturamento.map((f) => f.ano)];
  const juridico = enquadramento({
    razaoSocial: e.projeto.razaoSocial ?? e.projeto.nome, primeiroExercicio: anos.length ? Math.min(...anos) : null, anoBase: Number(e.dataBase.slice(0, 4)),
    pendentesArt51: cobertura.itens.filter((i) => i.status === 'pendente' || i.status === 'marcado_sem_arquivo').map((i) => i.titulo),
    mapa, patrimonioLiquido: balancos.at(-1)?.patrimonioLiquido ?? null, posicao: e.projeto.posicao,
  });

  // Resumo: cada card tem borda de status. Só entram números que existem.
  const cards: { rotulo: string; valor: string; status: 'vermelho' | 'ambar' | 'verde'; ref?: string }[] = [];
  if (faturamento && faturamento.diferencaAcumulada) cards.push({ rotulo: 'Faturamento gerencial acima do fiscal', valor: `R$ ${(faturamento.diferencaAcumulada / 1e6).toFixed(1).replace('.', ',')} mi`, status: faturamento.diferencaAcumulada > 0 ? 'vermelho' : 'verde' });
  if (mapa) cards.push({ rotulo: `do passivo fica fora da recuperação judicial (${mapa.fonte})`, valor: `${Math.round((mapa.foraDaRj / mapa.total) * 100)}%`, status: mapa.foraDaRj / mapa.total >= 0.35 ? 'vermelho' : mapa.foraDaRj / mapa.total >= 0.15 ? 'ambar' : 'verde' });
  const ult = balancos.at(-1); if (ult) cards.push({ rotulo: `Patrimônio líquido em ${ult.exercicio}`, valor: `R$ ${(ult.patrimonioLiquido / 1e6).toFixed(1).replace('.', ',')} mi`, status: ult.patrimonioLiquido < 0 ? 'vermelho' : 'verde', ref: ult.ref.arquivo });
  // O extrato que mais recebe é o que mostra a dependência de fomento.
  const ex = [...extratos].sort((a, b) => b.entradasTotal - a.entradasTotal)[0]; if (ex?.percentualFomentoNasEntradas != null) cards.push({ rotulo: 'Das entradas do extrato vieram de fomento', valor: `${Math.round(ex.percentualFomentoNasEntradas)}%`, status: ex.percentualFomentoNasEntradas >= 25 ? 'vermelho' : 'ambar' });
  cards.push({ rotulo: 'Itens do checklist entregues por completo', valor: `${cobertura.percentuais.entregue}%`, status: cobertura.percentuais.entregue < 50 ? 'vermelho' : cobertura.percentuais.entregue < 80 ? 'ambar' : 'verde' });

  const porArea = new Map<string, typeof cobertura.itens>();
  for (const i of cobertura.itens) if (i.status !== 'entregue') porArea.set(i.area, [...(porArea.get(i.area) ?? []), i]);

  const relatorio = {
    versao: e.versao, geradoEm: e.dataBase, geradoPor: e.geradoPor, aviso: AVISO,
    capa: { marca: 'NGA Nexus', titulo: 'Diagnóstico inicial da documentação', razaoSocial: e.projeto.razaoSocial ?? e.projeto.nome, projeto: e.projeto.nome, escopo: 'Financeiro, contábil e patrimônio', dataBase: e.dataBase, posicao: e.projeto.posicao, confidencialidade: 'Confidencial. Sujeito a sigilo profissional.' },
    resumo: {
      titulo: riscos.some((r) => r.prioridade === 'Alta') ? 'Há pontos críticos a esclarecer antes de avançar' : 'Quadro inicial sem pontos críticos calculáveis',
      conclusao: (e.projeto.posicao === 'credor'
        ? 'Leitura inicial voltada à avaliação do devedor: risco de crédito, indícios de simulação e estratégia de habilitação, impugnação ou objeção. Os números abaixo vêm dos arquivos indicados.'
        : 'Leitura inicial voltada à preparação da recuperação judicial ou da negociação. Os números abaixo vêm dos arquivos indicados; o que não foi entregue aparece como pendência.')
        + (mapa ? ` ${juridico.rj.alcance}` : ''),
      cards: cards.slice(0, 4),
      achados: [...(mapa?.principalDor ? [{ rotulo: 'Principal dor', texto: mapa.principalDor.texto, natureza: 'hipotese' as const }] : []), ...riscos.map((r) => ({ rotulo: r.tema, texto: r.achado, natureza: r.natureza }))].slice(0, 5),
    },
    baseDocumental: {
      documentos: e.documentos, lidos: e.documentos.length - ilegiveis.length, ilegiveis: ilegiveis.length,
      portal: { ...e.portal, percentual: e.portal.obrigatorios ? Math.round((e.portal.enviados / e.portal.obrigatorios) * 100) : 0 },
      respostas: cobertura.contagem, percentuais: cobertura.percentuais,
      marcadosSemArquivo: cobertura.itens.filter((i) => i.status === 'marcado_sem_arquivo').map((i) => i.titulo),
    },
    faltantes: { porArea: [...porArea].map(([area, itens]) => ({ area, incompletos: itens.length, total: cobertura.itens.filter((i) => i.area === area).length, itens: itens.map((i) => ({ numero: i.numero, titulo: i.titulo, artigo: i.artigo, marcador: i.status === 'parcial' || i.status === 'sem_resposta' ? 'ambar' : 'vermelho', marcadoSemArquivo: i.status === 'marcado_sem_arquivo' })) })),
      pendentes: cobertura.pendentesTotal, parcialOuSemResposta: cobertura.contagem.parcial + cobertura.contagem.sem_resposta, foraDoChecklist: e.foraDoChecklist ?? FORA_PADRAO },
    contabilI: faturamento || dre.length ? { faturamento, dre } : semDados(['DRE contábil e gerencial por exercício', 'Faturamento fiscal e gerencial por ano', 'Notas fiscais emitidas']),
    contabilII: balancos.length ? { balancos, ausentes: exerciciosAusentes(e.balancos), assinaturaTardia: e.balancos.filter(assinaturaTardia).map((b) => ({ exercicio: b.exercicio, assinadoEm: b.assinadoEm })) } : semDados(['Balanço patrimonial de cada exercício', 'Balancetes do ano corrente', 'Razão analítico das contas de adiantamento e de sócios']),
    financeiroI: extratos.length ? { extratos } : semDados(['Extratos de todas as contas bancárias dos últimos 12 meses']),
    financeiroII: passivo ? { passivo, abc } : semDados(['Relatório consolidado de endividamento', 'Relatório do passivo fiscal', 'Contratos de financiamento e garantias']),
    patrimonio: { semDados: !e.socios?.socios.length, socios: e.socios?.socios.length ? e.socios : null, pedir: ['Relação de bens da empresa e dos sócios', 'IRPF dos sócios e avalistas', 'Matrículas imobiliárias atualizadas', 'Organograma e empresas do grupo'], parteRelacionadaPorBanco: extratos.map((x) => ({ banco: x.banco, ...x.grupos.parteRelacionada })) },
    juridico: { ...juridico, aviso: 'Leitura indicativa a partir dos documentos. Confira a redação vigente da Lei 11.101/2005 e os julgados antes de usar em peça.' },
    endividamento: e.endividamento ?? [],
    riscos,
    proximosPassos: [
      { frente: 'Esclarecer com o contador', itens: ['Diferenças entre faturamento fiscal e gerencial', 'Contas de ajuste e saldos com sócios'] },
      { frente: 'Completar a contabilidade', itens: ['Exercícios e balancetes ausentes', 'Razão analítico das contas relevantes'] },
      { frente: 'Documentar o passivo', itens: ['Passivo fiscal, trabalhista e de locação', 'Contratos e garantias'] },
      { frente: 'Mapear grupo e patrimônio', itens: ['Empresas relacionadas e fluxos entre elas', 'Bens e declarações dos sócios'] },
      { frente: 'Decidir a via', itens: [e.projeto.posicao === 'credor' ? 'Habilitação, impugnação ou objeção' : 'Recuperação judicial, extrajudicial ou negociação'] },
    ],
    limites: {
      lidos: e.documentos.length - ilegiveis.length, ilegiveis: ilegiveis.map((d) => ({ nome: d.nome, motivo: d.detalhe ?? (d.estado === 'sem_texto' ? 'sem texto legível' : 'falha na leitura') })),
      leitura: e.avisosDeLeitura ?? [],
      naoConsultado: ['e-CAC', 'JUCESP e juntas comerciais', 'SCR do Banco Central', 'Certidões de distribuidores'],
      observacao: 'Nenhuma fonte externa foi consultada sem autorização. Números sem arquivo de origem não entram no relatório.',
    },
  };
  return limparTextos(relatorio);
}
export type RelatorioDiagnostico = ReturnType<typeof montarRelatorio>;

/** Compara duas versões pelos números-chave: o que mudou entre uma rodada e outra. */
export function compararVersoes(antes: RelatorioDiagnostico, depois: RelatorioDiagnostico) {
  const n = (r: RelatorioDiagnostico) => ({ pendentes: r.faltantes.pendentes, parcial: r.faltantes.parcialOuSemResposta, entregues: r.baseDocumental.respostas.entregue, lidos: r.baseDocumental.lidos, ilegiveis: r.baseDocumental.ilegiveis, riscosAltos: r.riscos.filter((x) => x.prioridade === 'Alta').length, riscos: r.riscos.length });
  const a = n(antes); const d = n(depois);
  return { de: antes.versao, para: depois.versao, mudancas: (Object.keys(a) as (keyof typeof a)[]).map((k) => ({ campo: k, antes: a[k], depois: d[k], variacao: d[k] - a[k] })),
    riscosNovos: depois.riscos.filter((r) => !antes.riscos.some((x) => x.tema === r.tema && x.achado === r.achado)).map((r) => r.achado), riscosResolvidos: antes.riscos.filter((r) => !depois.riscos.some((x) => x.tema === r.tema && x.achado === r.achado)).map((r) => r.achado) };
}
