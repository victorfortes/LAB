import { parseCnj } from "./cnj.ts";

export type SistemaProcessual = "projudi" | "eproc" | "pje" | "esaj" | "outro";

export interface Tribunal {
  /** "J.TR" do CNJ, ex.: "8.16" */
  codigo: string;
  sigla: string;
  nome: string;
  sistema: SistemaProcessual;
  url: string;
  /** true só quando o endereço foi usado de fato numa captura real. */
  verificado: boolean;
}

// Registro local e editável. Só o TJPR/Projudi foi exercitado de verdade (captura de 25/10/2026);
// os demais são o melhor conhecimento disponível e DEVEM ser confirmados no primeiro uso.
export const TRIBUNAIS: Tribunal[] = [
  { codigo: "8.16", sigla: "TJPR", nome: "Tribunal de Justiça do Paraná", sistema: "projudi", url: "https://projudi.tjpr.jus.br/projudi/", verificado: true },
  { codigo: "8.13", sigla: "TJMG", nome: "Tribunal de Justiça de Minas Gerais", sistema: "pje", url: "https://pje.tjmg.jus.br/pje/", verificado: false },
  { codigo: "8.24", sigla: "TJSC", nome: "Tribunal de Justiça de Santa Catarina", sistema: "eproc", url: "https://eproc1g.tjsc.jus.br/eproc/", verificado: false },
  { codigo: "8.21", sigla: "TJRS", nome: "Tribunal de Justiça do Rio Grande do Sul", sistema: "eproc", url: "https://eproc1g.tjrs.jus.br/eproc/", verificado: false },
  { codigo: "8.26", sigla: "TJSP", nome: "Tribunal de Justiça de São Paulo", sistema: "esaj", url: "https://esaj.tjsp.jus.br/", verificado: false },
  { codigo: "8.19", sigla: "TJRJ", nome: "Tribunal de Justiça do Rio de Janeiro", sistema: "pje", url: "https://tjrj.pje.jus.br/1g/", verificado: false },
  { codigo: "8.07", sigla: "TJDFT", nome: "Tribunal de Justiça do Distrito Federal", sistema: "pje", url: "https://pje.tjdft.jus.br/pje/", verificado: false },
  { codigo: "4.04", sigla: "TRF4", nome: "Tribunal Regional Federal da 4ª Região", sistema: "eproc", url: "https://eproc.trf4.jus.br/eproc2trf4/", verificado: false },
];

export interface Resolucao {
  cnj: NonNullable<ReturnType<typeof parseCnj>>;
  tribunal: Tribunal | null;
  avisos: string[];
}

export function resolverTribunal(numero: string, extras: Tribunal[] = []): Resolucao | null {
  const cnj = parseCnj(numero);
  if (!cnj) return null;
  const codigo = `${cnj.segment}.${cnj.tribunal}`;
  const tribunal = [...extras, ...TRIBUNAIS].find((t) => t.codigo === codigo) ?? null;
  const avisos: string[] = [];
  if (!cnj.checkOk) avisos.push("Dígito verificador CNJ não confere — revise o número.");
  if (!tribunal) avisos.push(`Tribunal ${codigo} fora do registro: informe o sistema e o endereço manualmente.`);
  else if (!tribunal.verificado) avisos.push(`Endereço de ${tribunal.sigla} não foi confirmado em captura real; confira antes de autenticar.`);
  return { cnj, tribunal, avisos };
}
