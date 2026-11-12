/** Patrimônio dos sócios do cliente: registro manual, importação do QSA e o quadro com alertas. */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { quadroDosSocios, sociosDoQsa, type BemDoSocio } from '../domain/diagnostico/socios.ts';

export const EsquemaBem = z.object({
  socio: z.string().trim().min(2).max(200),
  documento: z.string().trim().max(20).optional().transform((v) => (v ? v.replace(/\D/g, '') : null)).refine((v) => !v || v.length === 11 || v.length === 14, 'CPF ou CNPJ inválido'),
  qualificacao: z.string().trim().max(200).optional(),
  natureza: z.enum(['imovel', 'veiculo', 'participacao', 'aplicacao', 'rural', 'outro', 'sem_bens']),
  descricao: z.string().trim().min(1).max(500),
  /** Em reais, com centavos. */
  valor: z.number().min(0).max(1e12).nullable().optional(),
  onus: z.string().trim().max(300).optional(),
  garantidor: z.boolean().default(false),
  referencia: z.string().trim().max(300).optional(),
});

interface Linha { id: string; socio: string; documento: string | null; qualificacao: string | null; natureza: BemDoSocio['natureza']; descricao: string; valor: string | null; onus: string | null; garantidor: boolean; fonte: string; referencia: string | null }

async function linhas(db: PoolClient, projetoId: string) {
  return (await db.query<Linha>('SELECT id, socio, documento, qualificacao, natureza, descricao, valor::text, onus, garantidor, fonte, referencia FROM socios_patrimonio WHERE projeto_id = $1 ORDER BY socio, natureza, criado_em', [projetoId])).rows;
}
const paraBem = (l: Linha): BemDoSocio => ({ ...l, valor: l.valor === null ? null : Number(l.valor) });

export async function quadro(db: PoolClient, projetoId: string) {
  const ls = await linhas(db, projetoId);
  return { bens: ls.map((l) => ({ ...paraBem(l), id: l.id })), quadro: quadroDosSocios(ls.map(paraBem)) };
}

async function orgDoProjeto(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  if (!rows[0]) throw new NaoEncontrado('projeto não encontrado');
  return rows[0].organizacao_id;
}

export async function registrar(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaBem>, i: Identidade) {
  const org = await orgDoProjeto(db, projetoId);
  // Registrar um bem de verdade apaga o "bens a levantar" daquele sócio.
  if (d.natureza !== 'sem_bens') await db.query("DELETE FROM socios_patrimonio WHERE projeto_id = $1 AND natureza = 'sem_bens' AND upper(socio) = upper($2)", [projetoId, d.socio]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO socios_patrimonio (organizacao_id, projeto_id, socio, documento, qualificacao, natureza, descricao, valor, onus, garantidor, fonte, referencia, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual',$11,$12) RETURNING id`,
    [org, projetoId, d.socio, d.documento, d.qualificacao ?? null, d.natureza, d.descricao, d.valor === null || d.valor === undefined ? null : Math.round(d.valor * 100), d.onus || null, d.garantidor, d.referencia || null, i.usuarioId]);
  // Aval é do sócio, não do bem: marcar um bem como garantidor vale para todos os dele.
  if (d.garantidor) await db.query('UPDATE socios_patrimonio SET garantidor = TRUE WHERE projeto_id = $1 AND upper(socio) = upper($2)', [projetoId, d.socio]);
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'diagnostico.bem_socio_registrado', entidade: 'projeto', entidadeId: projetoId, depois: { socio: d.socio, natureza: d.natureza } });
  return { id: rows[0]!.id };
}

export async function excluir(db: PoolClient, id: string, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; projeto_id: string }>('DELETE FROM socios_patrimonio WHERE id = $1 RETURNING organizacao_id, projeto_id', [id]);
  if (!rows[0]) throw new NaoEncontrado('registro não encontrado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'diagnostico.bem_socio_excluido', entidade: 'projeto', entidadeId: rows[0].projeto_id });
  return { ok: true };
}

type BuscarCnpj = (cnpj: string) => Promise<{ qsa?: { nome_socio?: string; cnpj_cpf_do_socio?: string; qualificacao_socio?: string }[] } | null>;
export const buscarNaBrasilApi: BuscarCnpj = async (cnpj) => {
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new PedidoInvalido(`consulta do CNPJ indisponível agora (HTTP ${r.status}); tente de novo em instantes`);
  return await r.json() as never;
};

/** Traz os sócios do quadro societário (Receita, via BrasilAPI) de cada empresa do projeto. */
export async function importarQsa(db: PoolClient, projetoId: string, i: Identidade, buscar: BuscarCnpj = buscarNaBrasilApi) {
  const org = await orgDoProjeto(db, projetoId);
  const { rows: emp } = await db.query<{ cnpj: string | null; razao: string }>(
    `SELECT regexp_replace(coalesce(e.cnpj, ''), '\\D', '', 'g') AS cnpj, coalesce(e.razao_social, e.nome_fantasia) AS razao FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id WHERE pe.projeto_id = $1`, [projetoId]);
  const comCnpj = emp.filter((e) => e.cnpj && e.cnpj.length === 14);
  if (!comCnpj.length) throw new PedidoInvalido('nenhuma empresa do projeto tem CNPJ cadastrado: cadastre o CNPJ ou registre os sócios à mão');
  let novos = 0; const avisos: string[] = [];
  for (const e of comCnpj) {
    try {
      const r = await buscar(e.cnpj!);
      if (!r?.qsa?.length) { avisos.push(`${e.razao}: a Receita não lista sócios para este CNPJ`); continue; }
      const existentes = (await linhas(db, projetoId)).map((l) => l.socio);
      for (const b of sociosDoQsa(r.qsa, existentes)) {
        await db.query(`INSERT INTO socios_patrimonio (organizacao_id, projeto_id, socio, documento, qualificacao, natureza, descricao, fonte, referencia, criado_por) VALUES ($1,$2,$3,$4,$5,'sem_bens',$6,'qsa',$7,$8)`,
          [org, projetoId, b.socio, b.documento?.length === 11 || b.documento?.length === 14 ? b.documento : null, b.qualificacao, b.descricao, `QSA ${e.cnpj}`, i.usuarioId]);
        novos++;
      }
    } catch (er) { avisos.push(`${e.razao}: ${(er as Error).message}`); }
  }
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'diagnostico.qsa_importado', entidade: 'projeto', entidadeId: projetoId, depois: { novos } });
  return { novos, avisos };
}
