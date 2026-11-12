/**
 * Andamentos: índice do DataJud pelo número CNJ, leitura da resposta e o resumo dos últimos movimentos.
 *
 * Tudo puro e determinístico. O resumo não é "IA": classifica cada movimento pelo nome/código da
 * Tabela Processual Unificada e destaca o que muda o caso (sentença, decisão, audiência, trânsito,
 * arquivamento), além dos processos parados há muito tempo.
 */

const UF_POR_TR: Record<string, string> = {
  '01': 'ac', '02': 'al', '03': 'ap', '04': 'am', '05': 'ba', '06': 'ce', '07': 'dft', '08': 'es', '09': 'go', '10': 'ma', '11': 'mt', '12': 'ms', '13': 'mg', '14': 'pa',
  '15': 'pb', '16': 'pr', '17': 'pe', '18': 'pi', '19': 'rj', '20': 'rn', '21': 'rs', '22': 'ro', '23': 'rr', '24': 'sc', '25': 'se', '26': 'sp', '27': 'to',
};
const TJM: Record<string, string> = { '13': 'tjmmg', '21': 'tjmrs', '26': 'tjmsp' };

/** Alias do índice público do DataJud (api_publica_<alias>) a partir do número CNJ. Nulo quando não há índice. */
export function indiceDataJud(numero: string): string | null {
  const m = /^\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}$/.exec(numero.trim());
  if (!m) return null;
  const [, j, tr] = m as unknown as [string, string, string];
  switch (j) {
    case '8': return UF_POR_TR[tr] ? `tj${UF_POR_TR[tr]}` : null;
    case '5': return tr === '00' ? 'tst' : `trt${Number(tr)}`;
    case '4': return tr === '90' ? null : `trf${Number(tr)}`;
    case '6': return tr === '00' ? 'tse' : UF_POR_TR[tr] ? `tre-${UF_POR_TR[tr] === 'dft' ? 'df' : UF_POR_TR[tr]}` : null;
    case '3': return 'stj';
    case '7': return 'stm';
    case '9': return TJM[tr] ?? null;
    default: return null; // STF (1) e CNJ (2) não têm índice público
  }
}

export const soDigitos = (n: string) => n.replace(/\D/g, '');

export interface MovimentoLido { id: string; data: string; titulo: string; conteudo: string; codigo: number | null }
export interface CapaLida { classe?: string; orgao?: string; tribunal?: string; assunto?: string; ajuizamento?: string }

/** Junta os movimentos de todos os graus que o DataJud devolve para o mesmo número. */
export function lerHitsDataJud(hits: { _source: Record<string, any> }[]): { movimentos: MovimentoLido[]; capa: CapaLida } {
  const vistos = new Set<string>(); const movimentos: MovimentoLido[] = []; let capa: CapaLida = {};
  for (const h of hits) {
    const s = h._source;
    if (!capa.classe) capa = {
      classe: s.classe?.nome, orgao: s.orgaoJulgador?.nome, tribunal: s.tribunal, assunto: Array.isArray(s.assuntos) ? s.assuntos.map((a: any) => a?.nome).filter(Boolean).slice(0, 2).join('; ') : undefined,
      ajuizamento: typeof s.dataAjuizamento === 'string' ? isoDaData(s.dataAjuizamento) ?? undefined : undefined,
    };
    for (const m of Array.isArray(s.movimentos) ? s.movimentos : []) {
      const data = isoDaData(m.dataHora); if (!data || !m.nome) continue;
      const comp = Array.isArray(m.complementosTabelados) ? m.complementosTabelados.map((c: any) => [c?.descricao, c?.nome].filter(Boolean).join(': ')).filter(Boolean).join(' · ') : '';
      // O id na origem é estável: grau + código + instante. É o que impede duplicar a cada consulta.
      const id = `${s.grau ?? ''}|${m.codigo ?? ''}|${m.dataHora}`;
      if (vistos.has(id)) continue; vistos.add(id);
      movimentos.push({ id, data, titulo: String(m.nome).slice(0, 500), conteudo: comp.slice(0, 2000), codigo: Number.isFinite(Number(m.codigo)) ? Number(m.codigo) : null });
    }
  }
  return { movimentos: movimentos.sort((a, b) => b.data.localeCompare(a.data)), capa };
}
function isoDaData(v: unknown): string | null {
  const s = String(v ?? '');
  const iso = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

// ------------------------------------------------------------------- resumo ---
export type Peso = 'decisivo' | 'relevante' | 'rotina';
const REGRAS: [RegExp, string, Peso][] = [
  [/transit/i, 'Trânsito em julgado', 'decisivo'],
  [/senten|julgad[oa] (im)?procedente|extin[cç]/i, 'Sentença', 'decisivo'],
  [/ac[oó]rd[aã]o|provimento|recurso.*(conhecido|provido)/i, 'Acórdão', 'decisivo'],
  [/homolog/i, 'Homologação', 'decisivo'],
  [/arquiv|baixa definitiva/i, 'Arquivamento', 'decisivo'],
  [/recupera[cç][aã]o judicial.*(defer|concedid)|defer.*processamento|fal[eê]ncia/i, 'Marco da insolvência', 'decisivo'],
  [/audi[eê]ncia|sess[aã]o de julgamento|pauta/i, 'Audiência ou sessão', 'relevante'],
  [/decis[aã]o|liminar|tutela|antecipa/i, 'Decisão', 'relevante'],
  [/penhora|bloqueio|sisbajud|bacenjud|renajud|constri/i, 'Constrição', 'relevante'],
  [/cita[cç]|intima[cç]/i, 'Citação ou intimação', 'relevante'],
  [/suspens/i, 'Suspensão', 'relevante'],
  [/conclus/i, 'Concluso ao juiz', 'rotina'],
  [/despacho|mero expediente/i, 'Despacho', 'rotina'],
  [/juntada|peti[cç]/i, 'Juntada', 'rotina'],
  [/expedi|mandado|of[ií]cio|carta/i, 'Expediente', 'rotina'],
  [/remessa|recebid|distribu/i, 'Remessa ou distribuição', 'rotina'],
];
export function classificar(titulo: string): { categoria: string; peso: Peso } {
  const t = titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [re, categoria, peso] of REGRAS) if (re.test(t)) return { categoria, peso };
  return { categoria: 'Outro', peso: 'rotina' };
}

export interface ItemDoHistorico { data: string; titulo: string; conteudo?: string | null; fonte: string; processo?: string | null; processoId?: string | null }
export interface ResumoDosAndamentos {
  periodo: { de: string; ate: string; dias: number };
  total: number; processosComMovimento: number; processosParados: { processo: string; desde: string | null; dias: number | null }[];
  destaques: { data: string; processo: string | null; categoria: string; titulo: string; peso: Peso }[];
  porCategoria: { categoria: string; n: number }[];
  texto: string[];
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Resumo dos últimos `dias` dias: o que aconteceu, o que importa e o que está parado. */
export function resumir(itens: ItemDoHistorico[], processos: { numero: string; ultimo: string | null }[], hoje: string, dias = 30): ResumoDosAndamentos {
  const de = new Date(Date.parse(`${hoje}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
  const recentes = itens.filter((i) => i.data >= de && i.data <= hoje);
  const cls = recentes.map((i) => ({ ...i, ...classificar(i.titulo) }));
  const destaques = cls.filter((i) => i.peso !== 'rotina' || i.fonte === 'manual').sort((a, b) => (a.peso === b.peso ? b.data.localeCompare(a.data) : a.peso === 'decisivo' ? -1 : b.peso === 'decisivo' ? 1 : a.peso === 'relevante' ? -1 : 1))
    .slice(0, 12).map((i) => ({ data: i.data, processo: i.processo ?? null, categoria: i.fonte === 'manual' && i.peso === 'rotina' ? 'Registro manual' : i.categoria, titulo: i.titulo, peso: i.peso }));
  const porCat = new Map<string, number>(); for (const i of cls) porCat.set(i.categoria, (porCat.get(i.categoria) ?? 0) + 1);
  const comMov = new Set(recentes.map((i) => i.processo).filter(Boolean));
  const parados = processos.map((p) => ({ processo: p.numero, desde: p.ultimo, dias: p.ultimo ? diasEntre(p.ultimo, hoje) : null }))
    .filter((p) => p.dias === null || p.dias > 120).sort((a, b) => (b.dias ?? 1e9) - (a.dias ?? 1e9));

  const texto: string[] = [];
  if (!recentes.length) texto.push(`Nenhum andamento nos últimos ${dias} dias${processos.length ? ` nos ${processos.length} processo(s) do projeto` : ''}.`);
  else texto.push(`${recentes.length} andamento(s) nos últimos ${dias} dias, em ${comMov.size || 'nenhum'} processo(s)${processos.length ? ` de ${processos.length}` : ''}.`);
  const dec = destaques.filter((d) => d.peso === 'decisivo');
  if (dec.length) texto.push(`Atenção: ${dec.slice(0, 3).map((d) => `${d.categoria.toLowerCase()} em ${d.data.split('-').reverse().join('/')}${d.processo ? ` (${d.processo})` : ''}`).join('; ')}.`);
  const rel = destaques.filter((d) => d.peso === 'relevante');
  if (rel.length) texto.push(`Também relevante: ${rel.slice(0, 3).map((d) => `${d.categoria.toLowerCase()}${d.processo ? ` em ${d.processo}` : ''}`).join('; ')}.`);
  const rotina = cls.filter((i) => i.peso === 'rotina').length;
  if (rotina) texto.push(`${rotina} movimento(s) de rotina (juntadas, despachos, remessas).`);
  if (parados.length) texto.push(`${parados.length} processo(s) sem andamento há mais de 120 dias${parados[0]?.dias ? `; o mais antigo está parado há ${parados[0].dias} dias` : ''}.`);
  return {
    periodo: { de, ate: hoje, dias }, total: recentes.length, processosComMovimento: comMov.size, processosParados: parados.slice(0, 10), destaques,
    porCategoria: [...porCat].map(([categoria, n]) => ({ categoria, n })).sort((a, b) => b.n - a.n), texto,
  };
}
