/** Interpreta a exportação "Processos" do Astrea. Só transforma: quem grava é o importador. */
import { createHash } from 'node:crypto';
import { validarProcessoCnj } from '../analise/identificadores.ts';
import { dataBr, valorBr } from '../financeiro/importacao.ts';

export interface RegistroAstrea {
  chave: string; tipo: string; titulo: string; clienteNome: string; clienteEtiqueta: string | null; papelCliente: string; outrosEnvolvidos: string;
  numeroOriginal: string; numeroCnj: string | null; acao: string; objeto: string; pasta: string; equipe: string | null; fase: string | null; responsavel: string; etiquetas: string[];
  reestruturacao: boolean; vara: string; foro: string; comarca: string | null; uf: string | null; valorCausa: string | null; distribuidoEm: string | null; ultimoHistorico: string; urlProcesso: string;
  situacao: 'ativo' | 'suspenso' | 'arquivado';
}

/** Número sem pontuação, com sufixo de incidente ou com zeros: vira CNJ se o dígito fechar. */
export function normalizarCnj(bruto: string): string | null {
  const so = /^(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})(?:\/\d+)?$/.exec(bruto.trim());
  if (!so) return null;
  const n = `${so[1]}-${so[2]}.${so[3]}.${so[4]}.${so[5]}.${so[6]}`;
  return validarProcessoCnj(n) ? n : null;
}

export function situacaoDaFase(fase: string | null): RegistroAstrea['situacao'] {
  const f = (fase ?? '').toLowerCase();
  if (f.includes('arquivado') || f.includes('encerrado')) return 'arquivado';
  if (f.includes('suspenso')) return 'suspenso';
  return 'ativo';
}

export function interpretarLinha(cab: readonly string[], l: readonly string[]): RegistroAstrea {
  const v = (n: string) => (l[cab.indexOf(n)] ?? '').trim();
  const etiquetas = v('Etiquetas').split(',').map((t) => t.trim()).filter(Boolean);
  const pref = (p: string) => etiquetas.find((t) => t.toLowerCase().startsWith(`${p}:`))?.slice(p.length + 1).trim() ?? null;
  const foro = v('Foro'); const m = /^(.*)\/([A-Z]{2})$/.exec(foro);
  const c = valorBr(v('Valor da causa')); const numeroOriginal = v('Número'); const fase = pref('fase');
  const titulo = v('Título'); const clienteNome = v('Cliente');
  return {
    // Título + cliente + número: o mesmo processo pode aparecer para dois clientes.
    chave: createHash('sha256').update([v('Tipo'), titulo, clienteNome, numeroOriginal, v('Pasta')].join('|')).digest('hex'),
    tipo: v('Tipo'), titulo, clienteNome, clienteEtiqueta: pref('cliente'), papelCliente: v('Papel do cliente'), outrosEnvolvidos: v('Outros envolvidos'),
    numeroOriginal, numeroCnj: normalizarCnj(numeroOriginal), acao: v('Ação'), objeto: v('Objeto'), pasta: v('Pasta'), equipe: pref('equipe'), fase, responsavel: v('Responsável'), etiquetas,
    reestruturacao: etiquetas.some((t) => t.toLowerCase() === 'reestruturação'), vara: [v('Número do Juízo'), v('Vara')].filter(Boolean).join(' ª '), foro,
    comarca: m ? m[1]!.trim() : null, uf: m ? m[2]! : null, valorCausa: c !== null && c > 0n ? c.toString() : null, distribuidoEm: dataBr(v('Data de distribuição')), ultimoHistorico: v('Descrição do último histórico'), urlProcesso: v('URL do Processo'),
    situacao: situacaoDaFase(fase),
  };
}
