/**
 * Organiza os documentos do cliente nos itens do checklist (art. 51), sem ninguém precisar arrastar um por um.
 *
 * - Projeto sem checklist ganha o modelo do procedimento (RJ/RE: o "Checklist RJ e RE" da NGA). Era isso que
 *   fazia o diagnóstico sair "0 de 0" quando o cliente mandava tudo num ZIP.
 * - Documento já ligado a um item (pelo cliente ou pela equipe) não é mexido.
 * - Ligar não é aprovar: o item vai de "pendente" para "enviado" e a equipe confere.
 */
import type { PoolClient } from 'pg';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado } from './erros.ts';
import { modeloDe } from '../domain/portal/checklist.ts';
import { ITEM, itensDoDocumento, norm } from '../domain/diagnostico/organizar.ts';

export async function organizarDocumentos(db: PoolClient, projetoId: string, identidade: Identidade, opcoes: { criarChecklist?: boolean } = {}) {
  const { rows: pj } = await db.query<{ organizacao_id: string; tipo: string }>('SELECT organizacao_id, tipo FROM projetos WHERE id = $1', [projetoId]);
  const projeto = pj[0]; if (!projeto) throw new NaoEncontrado('projeto não encontrado');

  // 1. Checklist: se não existe, nasce do modelo do procedimento. Criar o checklist é ato da NGA; quando o próprio
  // cliente dispara a organização (ao subir documentos em lote), só vinculamos ao que já existe.
  let itensCriados = 0;
  const n = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM requisitos WHERE projeto_id = $1', [projetoId])).rows[0]?.n ?? 0;
  if (!n && opcoes.criarChecklist !== false) {
    // Tipo sem modelo próprio (consultivo, contencioso) não pode deixar o diagnóstico "0 de 0": usa o checklist de RJ/RE,
    // o mais completo e o da maioria dos casos de devedor.
    const modelo = modeloDe(projeto.tipo); const base = modelo.length ? modelo : modeloDe('recuperacao_judicial');
    for (const [i, r] of base.entries()) {
      await db.query(`INSERT INTO requisitos (organizacao_id, projeto_id, categoria, titulo, fundamento, obrigatorio, ordem, atribuicao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [projeto.organizacao_id, projetoId, r.categoria, r.titulo, r.fundamento ?? null, r.obrigatorio, i, r.atribuicao ?? null]);
      itensCriados++;
    }
  }
  const { rows: reqs } = await db.query<{ id: string; titulo: string; categoria: string; situacao: string }>('SELECT id, titulo, categoria, situacao FROM requisitos WHERE projeto_id = $1', [projetoId]);
  if (!reqs.length) return { itensCriados, vinculados: 0, itensAtendidos: 0, semItem: [] as string[] };
  // Título do modelo -> item do projeto (exato; se a equipe editou o título, pelo começo dele).
  const porChave = new Map<string, (typeof reqs)[number]>();
  for (const [k, t] of Object.entries(ITEM)) {
    const alvo = norm(t); const r = reqs.find((x) => norm(x.titulo) === alvo) ?? reqs.find((x) => norm(x.titulo).startsWith(alvo.slice(0, 28)));
    if (r) porChave.set(k, r);
  }

  // 2. Documentos do cliente ainda soltos, com o que a leitura reconheceu em cada um.
  const { rows: docs } = await db.query<{ id: string; titulo: string; nome: string; criado_em: Date; enviado_por: string | null; tipos: string[] }>(
    `SELECT d.id, d.titulo, coalesce(d.nome_original, d.titulo) AS nome, d.criado_em, d.enviado_por,
            coalesce((SELECT array_agg(DISTINCT x.tipo) FROM diagnostico_extracoes x WHERE x.documento_id = d.id), '{}') AS tipos
       FROM documentos d
      WHERE d.projeto_id = $1 AND d.origem = 'portal_cliente'
        AND NOT EXISTS (SELECT 1 FROM requisito_documentos rd WHERE rd.documento_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM requisitos r WHERE r.documento_id = d.id)
      ORDER BY d.criado_em`, [projetoId]);

  const novos = new Map<string, { req: (typeof reqs)[number]; docs: typeof docs }>();
  const semItem: string[] = [];
  for (const d of docs) {
    const alvo = itensDoDocumento(d).itens.map((k) => porChave.get(k)).filter((r): r is NonNullable<typeof r> => !!r);
    if (!alvo.length) { semItem.push(d.nome); continue; }
    for (const r of alvo) { const g = novos.get(r.id) ?? { req: r, docs: [] }; g.docs.push(d); novos.set(r.id, g); }
    // A área do documento passa a ser a do (primeiro) item: a lista de documentos fica agrupada como o checklist.
    await db.query(`UPDATE documentos SET categoria = $2 WHERE id = $1 AND (categoria IS NULL OR categoria = 'Enviado pelo cliente')`, [d.id, alvo[0]!.categoria]);
  }

  // 3. Liga e move a situação (pendente -> enviado). Rejeitado ou em complementação fica como está: a equipe decide.
  let vinculados = 0;
  for (const { req, docs: ds } of novos.values()) {
    for (const d of ds) {
      const r = await db.query(`INSERT INTO requisito_documentos (requisito_id, documento_id, organizacao_id, projeto_id, enviado_por, enviado_em)
                                VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [req.id, d.id, projeto.organizacao_id, projetoId, d.enviado_por ?? identidade.usuarioId, d.criado_em]);
      vinculados += r.rowCount ?? 0;
    }
    await db.query(`UPDATE requisitos SET situacao = CASE WHEN situacao = 'pendente' THEN 'enviado' ELSE situacao END,
                      documento_id = coalesce(documento_id, $2), atualizado_em = now() WHERE id = $1`, [req.id, ds.at(-1)!.id]);
  }

  if (itensCriados || vinculados) await auditar(db, {
    organizacaoId: projeto.organizacao_id, usuarioId: identidade.usuarioId, acao: 'checklist.documentos_organizados', entidade: 'projeto', entidadeId: projetoId,
    depois: { itensCriados, vinculados, itensAtendidos: novos.size, semItem: semItem.length },
  });
  return { itensCriados, vinculados, itensAtendidos: novos.size, semItem };
}
