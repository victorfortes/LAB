// Copiado de judy-track-pro/src/lib/djen.server.ts (coletor do Radar), com paginaInicial para coletar por etapas.
/**
 * Consulta limitada ao Diário de Justiça Eletrônico Nacional (DJEN/CNJ).
 * Apenas comunicações públicas do MESMO número CNJ, sem automação de login.
 * Não é API de documentos processuais. Resultado não constitui QGC ou PDF verificado.
 *
 * Contrato verificado contra a API REAL (comunicaapi.pje.jus.br, 12/10/2026): resposta
 * `{status, message, count, items[]}`; cada item usa `numero_processo`, `data_disponibilizacao`,
 * `tipoComunicacao`, `tipoDocumento`, `hash`, `link`, `texto` (HTML com entidades).
 */
export interface ComunicacaoRelevante {
  referencia: string;
  data: string | null;
  titulo: string;
  resumo: string;
  link_processo: string | null;
  origem: "DJEN/CNJ";
  situacao: "publicacao_nao_conferida";
}
export interface ResultadoDjen {
  disponivel: boolean;
  consulta_url: string;
  comunicações: ComunicacaoRelevante[];
  motivo: string | null;
  total_consultado: number;
  /** Total informado pela API (`count`), que pode exceder o que foi lido. */
  total_api?: number;
  truncado?: boolean;
}

// Todo texto DJEN de recuperação traz "Recuperação Judicial" no cabeçalho; por isso a relevância
// vem do TIPO da comunicação ou de expressões específicas.
const RELEVANTE = /rela[cç][aã]o de credores|quadro[- ]geral de credores|lista de credores|art(?:igo|\.)? ?7[ºo°]?,? ?§ ?[12]|plano de recupera[cç][aã]o|assembleia[- ]geral de credores|decreta[cç][aã]o de fal[eê]ncia/i;
const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ccedil: "ç", Ccedil: "Ç", atilde: "ã", Atilde: "Ã", otilde: "õ", Otilde: "Õ",
  aacute: "á", Aacute: "Á", eacute: "é", Eacute: "É", iacute: "í", Iacute: "Í",
  oacute: "ó", Oacute: "Ó", uacute: "ú", Uacute: "Ú", acirc: "â", Acirc: "Â",
  ecirc: "ê", Ecirc: "Ê", ocirc: "ô", Ocirc: "Ô", agrave: "à", Agrave: "À",
  ordm: "º", ordf: "ª", sect: "§", ndash: "–", mdash: "—",
};

export function textoDjen(html: string): string {
  const cp = (c: number) => (c > 0 && c < 0x10ffff ? String.fromCodePoint(c) : " ");
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => cp(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => cp(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n] ?? m)
    .replace(/\s+/g, " ").trim();
}

export function normalizarDjen(items: unknown[], cnj: string): ComunicacaoRelevante[] {
  const esperado = cnj.replace(/\D/g, "");
  const seen = new Set<string>();
  const saida: ComunicacaoRelevante[] = [];
  for (const val of items) {
    if (!val || typeof val !== "object") continue;
    const it = val as Record<string, unknown>;
    const numero = String(it["numeroProcesso"] ?? it["numero_processo"] ?? "").replace(/\D/g, "");
    if (numero !== esperado) continue; // Nunca apresentar publicação de outro processo.
    const texto = textoDjen(String(it["texto"] ?? ""));
    const tipoCom = String(it["tipoComunicacao"] ?? it["tipo_documento"] ?? "");
    const tipoDoc = String(it["tipoDocumento"] ?? "");
    const titulo = (tipoDoc || tipoCom || "Comunicação").slice(0, 100);
    const ehEdital = /edital/i.test(tipoCom) || /edital/i.test(tipoDoc);
    if (!ehEdital && !RELEVANTE.test(texto)) continue;
    const origemLink = typeof it["link"] === "string" ? it["link"] : typeof it["url"] === "string" ? it["url"] : "";
    let link: string | null = null;
    try {
      const u = new URL(origemLink);
      if (u.protocol === "https:" && !u.username && !u.password) link = u.toString().slice(0, 1900);
    } catch { /* sem link confiável */ }
    const dataBruta = it["data_disponibilizacao"] ?? it["dataDisponibilizacao"];
    const referencia = String(it["hash"] ?? it["id"] ?? "").slice(0, 120)
      || `${numero}:${String(dataBruta ?? "")}:${saida.length}`;
    if (seen.has(referencia)) continue;
    seen.add(referencia);
    // O cabeçalho lista as partes; o resumo começa no corpo do ato.
    const corpo = texto.search(/EDITAL|DESPACHO|DECIS[ÃA]O|ATO ORDINAT/i);
    saida.push({
      referencia, data: typeof dataBruta === "string" ? dataBruta.slice(0, 30) : null,
      titulo: `DJEN — ${titulo}`, resumo: texto.slice(corpo >= 0 ? corpo : 0).slice(0, 600),
      link_processo: link, origem: "DJEN/CNJ", situacao: "publicacao_nao_conferida",
    });
  }
  return saida;
}

const POR_PAGINA = 100;
const MAX_PAGINAS = 3;

export async function consultarDjenPublico(
  numero: string, fetchImpl: typeof fetch = fetch, agora: Date = new Date(),
): Promise<ResultadoDjen> {
  const cnj = numero.replace(/\D/g, "");
  if (cnj.length !== 20) throw new Error("Número CNJ inválido");
  const inicio = new Date(agora.getTime() - 365 * 24 * 60 * 60 * 1000);
  const data = (d: Date) => d.toISOString().slice(0, 10);
  const montar = (pagina: number) => {
    const url = new URL("https://comunicaapi.pje.jus.br/api/v1/comunicacao");
    url.search = new URLSearchParams({
      numeroProcesso: cnj, dataDisponibilizacaoInicio: data(inicio),
      dataDisponibilizacaoFim: data(agora), pagina: String(pagina), itensPorPagina: String(POR_PAGINA),
    }).toString();
    return url.toString();
  };
  const consulta_url = montar(1);
  const base = { consulta_url, comunicações: [], total_consultado: 0 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const todos: unknown[] = [];
    let totalApi = 0;
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const res = await fetchImpl(montar(pagina), { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) return {
        ...base, disponivel: false, motivo: `DJEN respondeu HTTP ${res.status} (a rede de origem pode estar bloqueada).`,
      };
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > 5_000_000) return { ...base, disponivel: false, motivo: "Resposta DJEN excede tamanho permitido." };
      const text = await res.text();
      if (text.length > 5_000_000) return { ...base, disponivel: false, motivo: "Resposta DJEN excede tamanho permitido." };
      const raw: unknown = JSON.parse(text);
      const itens = raw && typeof raw === "object" ? (raw as { items?: unknown }).items : undefined;
      if (!Array.isArray(itens)) {
        return { ...base, disponivel: false, motivo: "Formato de resposta DJEN não reconhecido." };
      }
      const c = Number((raw as { count?: unknown }).count);
      if (Number.isFinite(c)) totalApi = c;
      todos.push(...itens);
      if (itens.length < POR_PAGINA || todos.length >= totalApi) break;
    }
    return {
      disponivel: true, consulta_url, total_consultado: todos.length,
      total_api: totalApi || todos.length, truncado: totalApi > todos.length,
      comunicações: normalizarDjen(todos, cnj), motivo: null,
    };
  } catch (e) {
    return {
      ...base, disponivel: false,
      motivo: ctrl.signal.aborted ? "Consulta DJEN excedeu 20 segundos." : `DJEN indisponível: ${e instanceof Error ? e.message : "erro de rede"}`,
    };
  } finally { clearTimeout(timer); }
}

// ---------- Descoberta GLOBAL no DJEN (sem número de processo) ----------
export interface PublicacaoDescoberta {
  tribunal: string; numero: string; classe_nome: string | null; classe_codigo: 129 | 108 | null;
  orgao: string | null; data: string; tipo: string; titulo: string; resumo: string; link: string | null; referencia: string;
  /** Texto integral decodificado da publicação (até 300 mil caracteres): algumas trazem a lista de credores. */
  texto: string;
}

/** Frases que identificam publicações de relação de credores/plano em RJ e falência (API aceita `texto` entre aspas). */
export const CONSULTAS_DESCOBERTA = [
  '"relação de credores" "art. 7º"',
  '"relação de credores" "art. 52"',
  '"plano de recuperação judicial" "objeção"',
  '"assembleia geral de credores" "convocação"',
  '"decretação da falência"',
  '"encerramento" "recuperação judicial"',
] as const;

const EH_CONCURSAL = /recupera[cç][aã]o judicial|fal[eê]ncia|massa falida/i;

export function deduzirClasseConcursal(classeNome: string | null, texto: string): 129 | 108 | null {
  const base = `${classeNome ?? ""}`;
  if (/recupera[cç][aã]o judicial/i.test(base)) return 129;
  if (/fal[eê]ncia/i.test(base)) return 108;
  if (/recupera[cç][aã]o extrajudicial/i.test(base)) return null;
  if (/recupera[cç][aã]o judicial/i.test(texto)) return 129;
  if (/fal[eê]ncia|massa falida/i.test(texto)) return 108;
  return null;
}

/**
 * Varre o DJEN do CNJ por TEXTO, em todos os tribunais, sem precisar do número do processo. O DJEN é atualizado
 * no dia seguinte (medido em 12/10/2026), ao contrário do índice público do DataJud, que atrasa semanas.
 * Só devolve publicações do tipo Edital de processos concursais (RJ/falência) que a classificação reconhece.
 */
export async function descobrirNoDjen(
  desde: Date, ate: Date,
  opts: { fetchImpl?: typeof fetch; maxPaginas?: number; paginaInicial?: number; timeoutMs?: number; consultas?: readonly string[] } = {},
): Promise<{ publicacoes: PublicacaoDescoberta[]; erros: string[]; totalApi: number }> {
  const f = opts.fetchImpl ?? fetch;
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  const vistos = new Set<string>();
  const publicacoes: PublicacaoDescoberta[] = [];
  const erros: string[] = [];
  let totalApi = 0;
  for (const texto of opts.consultas ?? CONSULTAS_DESCOBERTA) {
    for (let pagina = opts.paginaInicial ?? 1; pagina <= (opts.maxPaginas ?? 10); pagina++) {
      const url = new URL("https://comunicaapi.pje.jus.br/api/v1/comunicacao");
      url.search = new URLSearchParams({ texto, tipoComunicacao: "Edital", dataDisponibilizacaoInicio: dia(desde), dataDisponibilizacaoFim: dia(ate), pagina: String(pagina), itensPorPagina: "100" }).toString();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25_000);
      try {
        const res = await f(url.toString(), { signal: ctrl.signal, headers: { Accept: "application/json", "User-Agent": "NGA-Radar-Concursal/1.0 (consulta publica ao DJEN, uma vez por dia)" } });
        if (!res.ok) { erros.push(`DJEN HTTP ${res.status} em "${texto}"`); break; }
        const raw = (await res.json()) as { count?: number; items?: unknown[] };
        const itens = Array.isArray(raw.items) ? raw.items : [];
        totalApi += Number(raw.count) || 0;
        for (const val of itens) {
          const it = val as Record<string, unknown>;
          const numero = String(it["numero_processo"] ?? it["numeroProcesso"] ?? "").replace(/\D/g, "");
          if (numero.length !== 20) continue;
          const corpo = textoDjen(String(it["texto"] ?? ""));
          const ini = corpo.search(/EDITAL/i);
          const resumo = corpo.slice(ini >= 0 ? ini : 0, (ini >= 0 ? ini : 0) + 600);
          const classeNome = typeof it["nomeClasse"] === "string" ? it["nomeClasse"] : null;
          if (!EH_CONCURSAL.test(`${classeNome ?? ""} ${corpo}`)) continue;
          const ref = String(it["hash"] ?? it["id"] ?? "");
          const chave = `${numero}:${ref}`;
          if (vistos.has(chave)) continue;
          vistos.add(chave);
          let link: string | null = null;
          try { const u = new URL(String(it["link"] ?? "")); if (u.protocol === "https:" && !u.username && !u.password) link = u.toString().slice(0, 1900); } catch { /* sem link */ }
          publicacoes.push({
            tribunal: String(it["siglaTribunal"] ?? "").toUpperCase(), numero, classe_nome: classeNome, classe_codigo: deduzirClasseConcursal(classeNome, corpo),
            orgao: typeof it["nomeOrgao"] === "string" ? it["nomeOrgao"] : null, data: String(it["data_disponibilizacao"] ?? it["dataDisponibilizacao"] ?? "").slice(0, 10),
            tipo: String(it["tipoComunicacao"] ?? "Edital"), titulo: String(it["tipoDocumento"] || it["tipoComunicacao"] || "Edital").slice(0, 100), resumo, link, referencia: ref.slice(0, 120), texto: corpo.slice(0, 300_000),
          });
        }
        if (itens.length < 100) break;
      } catch (e) {
        erros.push(ctrl.signal.aborted ? `DJEN excedeu o tempo em "${texto}"` : `DJEN indisponível: ${e instanceof Error ? e.message : "erro de rede"}`);
        break;
      } finally { clearTimeout(timer); }
    }
  }
  return { publicacoes, erros, totalApi };
}
