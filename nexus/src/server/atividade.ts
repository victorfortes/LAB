/** Atividade recente do escritório — a trilha de auditoria, em forma de feed. */
import type { PoolClient } from 'pg';

/** Eventos de bastidor que não ajudam quem está olhando o feed. */
const RUIDO = ['documento.texto_registrado', 'documento.baixado', 'analise.executada'];
/** Só estes campos de `depois` saem daqui: o resto da auditoria é para auditor, não para o feed. */
const CAMPOS = ['nome', 'titulo', 'numero', 'fase', 'motivo', 'situacao', 'tipo'];

export async function atividade(db: PoolClient, desde: string | null) {
  const { rows } = await db.query<{
    id: string; acao: string; entidade: string; entidade_id: string | null; ocorrido_em: Date; usuario: string | null; depois: Record<string, unknown> | null;
  }>(
    `SELECT a.id, a.acao, a.entidade, a.entidade_id, a.ocorrido_em, u.nome AS usuario, a.depois
       FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.acao <> ALL($1) AND ($2::timestamptz IS NULL OR a.ocorrido_em > $2)
      ORDER BY a.id DESC LIMIT 30`, [RUIDO, desde]);
  return rows.map((r) => ({
    id: r.id, acao: r.acao, entidade: r.entidade, entidadeId: r.entidade_id, quando: r.ocorrido_em, quem: r.usuario,
    dados: Object.fromEntries(CAMPOS.filter((c) => r.depois && typeof r.depois[c] === 'string').map((c) => [c, r.depois![c]])),
  }));
}
