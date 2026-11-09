/** Regras puras do Sentinela: configuração, análise por regras e prova de cobertura, sem rede. */
import type { PoolClient } from 'pg';

export const CONFIG_PADRAO = {
  prioridade: {
    palavras_alta: ['tutela de urgência', 'tutela provisória', 'liminar', 'bloqueio', 'penhora', 'sisbajud', 'arresto', 'falência', 'pedido de falência', 'execução', 'busca e apreensão'],
    classes_alta: ['falência', 'execução', 'tutela', 'cautelar', 'busca e apreensão'], valor_alto: 1_000_000, valor_medio: 100_000,
  },
  motor: { dias_nova_distribuicao: 15, dias_busca_inicial: 90 },
};
export type ChaveConfig = keyof typeof CONFIG_PADRAO;
export async function obterConfig<K extends ChaveConfig>(db: PoolClient, org: string, chave: K): Promise<(typeof CONFIG_PADRAO)[K]> {
  const { rows: [r] } = await db.query<{ valor: object }>('SELECT valor FROM sentinela_config WHERE organizacao_id=$1 AND chave=$2', [org, chave]);
  return { ...CONFIG_PADRAO[chave], ...(r?.valor ?? {}) };
}

// ------------------------------------------------------------- análise ---
export type Origem = 'fonte' | 'inferencia' | 'nao_verificado';
export interface Campo { valor: unknown; origem: Origem; nota?: string }
const campo = (valor: unknown, origem: Origem, nota?: string): Campo => (nota ? { valor, origem, nota } : { valor, origem });
const NAO_DISP = (): Campo => ({ valor: null, origem: 'nao_verificado', nota: 'não disponível nas fontes públicas consultadas' });
export interface ComunicacaoAnalise { texto: string; tipo: string | null; tribunal: string | null; data_disponibilizacao: string | null; destinatarios: { nome: string; polo: string | null }[] }
export interface ProcessoAnalise { numero_processo: string; tribunal: string | null; orgao: string | null; classe: string | null; data_ajuizamento: string | null; assuntos: string[]; polo: string | null }

export function valorDaCausa(t: string): number | null {
  const m = /valor\s+da\s+causa[^R\d]{0,40}R\$\s*([\d.]+,\d{2})/i.exec(t);
  return m ? Number(m[1]!.replaceAll('.', '').replace(',', '.')) : null;
}
export function analisarPorRegras(p: ProcessoAnalise, coms: ComunicacaoAnalise[], cfg: typeof CONFIG_PADRAO.prioridade, hoje: string) {
  const texto = coms.map((c) => c.texto ?? '').join(' ');
  const nomes = (polo: string) => [...new Set(coms.flatMap((c) => c.destinatarios.filter((d) => d.polo === polo).map((d) => d.nome)))].sort();
  const ativos = nomes('A'), passivos = nomes('P'), valor = valorDaCausa(texto);
  const tutela = /tutela\s+(de\s+urg[eê]ncia|provis[oó]ria|antecipada)|liminar/i.test(texto);
  const campos: Record<string, Campo> = {
    numero_processo: campo(p.numero_processo, 'fonte'), tribunal: campo(p.tribunal, 'fonte'),
    comarca_vara: p.orgao ? campo(p.orgao, 'fonte') : NAO_DISP(),
    data_distribuicao: p.data_ajuizamento ? campo(p.data_ajuizamento, 'fonte', 'DataJud') : NAO_DISP(),
    classe: p.classe ? campo(p.classe, 'fonte') : NAO_DISP(), assunto: p.assuntos.length ? campo(p.assuntos, 'fonte', 'DataJud') : NAO_DISP(),
    autor: ativos.length ? campo(ativos, 'fonte', 'polo ativo nas comunicações do DJEN') : NAO_DISP(),
    reu: passivos.length ? campo(passivos, 'fonte', 'polo passivo nas comunicações do DJEN') : NAO_DISP(),
    valor_causa: valor ? campo(valor, 'fonte', 'extraído do texto da comunicação') : NAO_DISP(),
    tutela_provisoria: campo(tutela, 'inferencia', 'regra por palavras-chave no texto das comunicações'),
    principais_fatos: NAO_DISP(), fundamentos_juridicos: NAO_DISP(), pedidos: NAO_DISP(),
  };
  const motivos: string[] = []; let pontos = 0; const low = texto.toLowerCase();
  const termo = cfg.palavras_alta.find((k) => low.includes(k.toLowerCase()));
  if (termo) { pontos += 2; motivos.push(`termo '${termo}' no texto`); }
  const classe = (p.classe ?? '').toLowerCase();
  if (cfg.classes_alta.some((k) => classe.includes(k.toLowerCase()))) { pontos += 2; motivos.push('classe processual sensível'); }
  if (valor !== null && valor >= cfg.valor_alto) { pontos += 3; motivos.push('valor da causa elevado'); }
  else if (valor !== null && valor >= cfg.valor_medio) { pontos += 1; motivos.push('valor da causa médio'); }
  if (tutela) { pontos += 2; motivos.push('indício de tutela provisória'); }
  if (p.data_ajuizamento === hoje) { pontos += 3; motivos.push('ajuizado hoje'); }
  const prioridade = pontos >= 3 ? 'alta' : pontos >= 1 ? 'media' : 'baixa';
  campos._motivos_prioridade = campo(motivos, 'inferencia');
  const ult = coms.at(-1);
  const resumo = `Processo ${p.numero_processo} (${p.tribunal ?? 'tribunal não informado'}), classe ${p.classe ?? 'não informada'}. Posição do cliente: ${p.polo === 'P' ? 'polo passivo' : 'indeterminada'}. Análise de conteúdo indisponível: a petição inicial não é acessível pelas fontes públicas.${ult ? ` Última comunicação: ${ult.tipo ?? 'sem tipo'} (${ult.data_disponibilizacao ?? 'sem data'}).` : ''}`;
  return { campos, resumo, prioridade: prioridade as 'alta' | 'media' | 'baixa', urgencia_aparente: tutela, requer_analise_imediata: pontos >= 3, documentos: { peticao_inicial: 'indisponivel_nas_fontes_publicas', comunicacoes_djen: coms.length } };
}

// ----------------------------------------------------------- cobertura ---
export type StatusDia = 'lacuna' | 'incompleto' | 'em_curso' | 'provisorio' | 'coberto' | 'sem_historico';
export const ORDEM_STATUS: StatusDia[] = ['lacuna', 'incompleto', 'em_curso', 'provisorio', 'coberto', 'sem_historico'];
export interface LeituraTarefa { inicio: string; fim: string; status: string; lido: string | null }
export const somaDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function statusDaChave(linhas: LeituraTarefa[], hoje: string, dias: number): Record<string, StatusDia> {
  const lidas = linhas.filter((l) => l.status === 'ok' || l.status === 'truncada'); const out: Record<string, StatusDia> = {};
  const ini = lidas.reduce<string | null>((m, l) => (m === null || l.inicio < m ? l.inicio : m), null);
  for (let i = dias - 1; i >= 0; i--) {
    const d = somaDias(hoje, -i);
    if (ini === null || d < ini) { out[d] = 'sem_historico'; continue; }
    const cobre = lidas.filter((l) => l.inicio <= d && d <= l.fim), oks = cobre.filter((l) => l.status === 'ok');
    if (!oks.length) out[d] = cobre.length ? 'incompleto' : d === hoje ? 'em_curso' : 'lacuna';
    else out[d] = d === hoje || !oks.some((l) => l.lido && l.lido > d) ? 'provisorio' : 'coberto';
  }
  return out;
}
export function piorStatus(sts: StatusDia[]): StatusDia {
  const com = sts.filter((s) => s !== 'sem_historico'); if (!com.length) return 'sem_historico';
  return com.reduce((a, b) => (ORDEM_STATUS.indexOf(a) <= ORDEM_STATUS.indexOf(b) ? a : b));
}
export function intervalosDeLacuna(st: Record<string, StatusDia>, hoje: string): [string, string][] {
  const out: [string, string][] = []; let ini: string | null = null, fim: string | null = null;
  for (const d of Object.keys(st).sort()) {
    if ((st[d] === 'lacuna' || st[d] === 'incompleto') && d < hoje) { ini ??= d; fim = d; }
    else if (ini) { out.push([ini, fim!]); ini = fim = null; }
  }
  if (ini) out.push([ini, fim!]); return out;
}
export function motivoInvisivel(nomes: string[]): string {
  if (nomes.length && nomes.filter((n) => n.trim().toUpperCase() === 'SIGILO').length >= nomes.length / 2) return 'partes sob sigilo: o DJEN omite os nomes';
  if (nomes.length && nomes.filter((n) => /^(?:[A-Z]\.? ?)+$/.test(n.trim().toUpperCase())).length >= nomes.length / 2) return 'nomes abreviados por iniciais';
  return 'cliente aparece só como terceiro ou citado no texto';
}
export const MATRIZ_FONTES = [
  { fonte: 'DJEN / Comunica PJe (CNJ)', sistema: 'API REST pública', estado: 'Operacional na nuvem', cnpj: 'Só como texto', nome: 'Sim (nomeParte)', partes: 'Sim, com polo A/P', distribuicao: 'Parcial (data de disponibilização)', auth: 'Não', restricoes: 'Teto de 10.000 resultados por consulta; só vê processos com comunicação publicada' },
  { fonte: 'DataJud (CNJ), API pública', sistema: 'Elasticsearch, um índice por tribunal', estado: 'Operacional na nuvem', cnpj: 'Não', nome: 'Não', partes: 'Não', distribuicao: 'Sim (dataAjuizamento)', auth: 'Chave pública do CNJ', restricoes: 'Limita por volume e fica instável em alguns tribunais; falha espera 1 hora' },
];
