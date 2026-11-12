/** Fechamento financeiro mensal (cliente informa) e a saúde financeira que sai dele. */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { CAMPOS_DO_FECHAMENTO, saude, type Fechamento } from '../domain/financeiro/saude.ts';
import { formatarReais } from '../domain/shared/dinheiro.ts';

const COLUNA: Record<string, string> = { dividaBancaria: 'divida_bancaria', tributosAtraso: 'tributos_atraso' };
const col = (k: string) => COLUNA[k] ?? k;
const centavosOuNulo = z.string().regex(/^-?\d+$/, 'valor em centavos').nullable().optional();

export const EsquemaFechamento = z.object({
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mês no formato AAAA-MM'),
  empregados: z.number().int().min(0).max(1_000_000).nullable().optional(),
  observacao: z.string().max(4000).nullable().optional(),
  ...Object.fromEntries(CAMPOS_DO_FECHAMENTO.map(([k]) => [k, centavosOuNulo])),
}) as unknown as z.ZodType<{ competencia: string; empregados?: number | null; observacao?: string | null } & Record<string, string | null | undefined>>;

export async function listar(db: PoolClient, projetoId: string) {
  const { rows } = await db.query(`SELECT f.*, to_char(f.competencia, 'YYYY-MM') AS mes, u.nome AS enviado_por_nome, c.nome AS conferido_por_nome
      FROM fechamentos_mensais f LEFT JOIN usuarios u ON u.id = f.enviado_por LEFT JOIN usuarios c ON c.id = f.conferido_por
     WHERE f.projeto_id = $1 ORDER BY f.competencia`, [projetoId]);
  const fechamentos: Fechamento[] = rows.map((r) => ({
    competencia: r.mes, empregados: r.empregados,
    ...Object.fromEntries(CAMPOS_DO_FECHAMENTO.map(([k]) => [k, r[col(k)] === null ? null : BigInt(r[col(k)])])),
  }) as Fechamento);
  const s = saude(fechamentos);
  const txt = (v: bigint | null) => (v === null ? null : formatarReais(v));
  return {
    campos: CAMPOS_DO_FECHAMENTO.map(([chave, rotulo, dica]) => ({ chave, rotulo, dica })),
    meses: rows.map((r) => ({
      competencia: r.mes, empregados: r.empregados, observacao: r.observacao,
      valores: Object.fromEntries(CAMPOS_DO_FECHAMENTO.map(([k]) => [k, r[col(k)] === null ? null : String(r[col(k)])])),
      enviadoPor: r.enviado_por_nome, enviadoEm: r.atualizado_em, conferidoPor: r.conferido_por_nome, conferidoEm: r.conferido_em,
    })),
    serie: s.serie.map((x) => ({ ...x, receitaLiquida: txt(x.receitaLiquida), resultadoOperacional: txt(x.resultadoOperacional), resultado: txt(x.resultado),
      resultadoCentavos: x.resultado === null ? null : String(x.resultado), receitaCentavos: x.receitaLiquida === null ? null : String(x.receitaLiquida) })),
    alertas: s.alertas, situacao: s.situacao, faltando: s.faltando,
  };
}

/** Grava (ou corrige) o mês. O cliente não altera mês já conferido pela NGA. */
export async function salvar(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaFechamento>, identidade: Identidade) {
  const { rows: pj } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  const org = pj[0]?.organizacao_id; if (!org) throw new NaoEncontrado('projeto não encontrado');
  const chaves = CAMPOS_DO_FECHAMENTO.map(([k]) => k);
  if (chaves.every((k) => d[k] === null || d[k] === undefined)) throw new PedidoInvalido('Informe ao menos um número do mês.');
  for (const k of chaves) if (k !== 'caixa' && d[k] && d[k]!.startsWith('-')) throw new PedidoInvalido('Só o saldo de caixa pode ser negativo.');
  const cols = chaves.map(col);
  const vals = chaves.map((k) => d[k] ?? null);
  try {
    await db.query('SAVEPOINT fechamento');
    await db.query(`INSERT INTO fechamentos_mensais (organizacao_id, projeto_id, competencia, ${cols.join(', ')}, empregados, observacao, enviado_por)
       VALUES ($1, $2, $3::date, ${cols.map((_, i) => `$${i + 4}`).join(', ')}, $${cols.length + 4}, $${cols.length + 5}, $${cols.length + 6})
       ON CONFLICT (projeto_id, competencia) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
         empregados = EXCLUDED.empregados, observacao = EXCLUDED.observacao, enviado_por = EXCLUDED.enviado_por, atualizado_em = now()`,
      [org, projetoId, `${d.competencia}-01`, ...vals, d.empregados ?? null, d.observacao ?? null, identidade.usuarioId]);
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT fechamento');
    if (/row-level security|violates/i.test((e as Error).message)) throw new PedidoInvalido('Este mês já foi conferido pela NGA e não pode mais ser alterado pelo portal. Fale com a equipe.');
    throw e;
  }
  await auditar(db, { organizacaoId: org, usuarioId: identidade.usuarioId, acao: 'financeiro.fechamento_mensal', entidade: 'projeto', entidadeId: projetoId, depois: { competencia: d.competencia } });
  return { ok: true, competencia: d.competencia };
}

export async function conferir(db: PoolClient, projetoId: string, competencia: string, identidade: Identidade) {
  const r = await db.query(`UPDATE fechamentos_mensais SET conferido_por = $3, conferido_em = now() WHERE projeto_id = $1 AND competencia = $2::date RETURNING organizacao_id`, [projetoId, `${competencia}-01`, identidade.usuarioId]);
  if (!r.rowCount) throw new NaoEncontrado('mês não encontrado');
  await auditar(db, { organizacaoId: r.rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'financeiro.fechamento_conferido', entidade: 'projeto', entidadeId: projetoId, depois: { competencia } });
  return { ok: true };
}
