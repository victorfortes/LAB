/**
 * Cumprimento de tarefa: o advogado cumpre o prazo DENTRO do LAB.
 *
 * A peça é juntada como documento do projeto (e já sincroniza para a pasta do
 * cliente no Drive pela fila durável). Ao concluir, o sistema lê a peça e grava
 * um resumo como andamento do processo — e aqui está a regra do §22: o resumo
 * usa o provedor de IA, que é HONESTO. Sem chave, não se inventa resumo: o
 * andamento nasce com "resumo pendente — IA não configurada" e o motivo exato,
 * e a rotina `reprocessarResumosPendentes` o preenche sozinha quando a chave
 * passar a existir.
 *
 * Nada aqui chama o processo eletrônico: o contexto (processo, intimação de
 * origem, últimos andamentos) é lido pela própria tarefa, e a peça sobe pelo
 * mesmo caminho de documento do projeto.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar, type Banco } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import type { Provedor } from '../ai/provedor.ts';
import type { Deposito } from './arquivos.ts';
import * as analiseAuto from './analise_auto.ts';
import { registrarHistorico } from './andamentos.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

export const EsquemaCumprimento = z.object({
  /** Documento já enviado como peça do projeto (POST /api/projetos/:id/documentos). */
  documentoId: z.string().uuid(),
});

const hojeBr = (): string =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

interface Resumo {
  readonly estado: 'gerado' | 'pendente';
  readonly resumo: string | null;
  readonly motivo: string | null;
  readonly modelo: string | null;
}

/**
 * Lê o resumo que o estágio de IA produziu para o documento, já analisado.
 * Resumo só existe quando a IA rodou (`estagio_ia = 'executada'`); em qualquer
 * outro caso o resultado é pendente, com o impedimento nomeado.
 */
async function lerResumo(db: PoolClient, documentoId: string): Promise<Resumo> {
  const { rows } = await db.query<{ estagio_ia: string; motivo_ia: string | null; modelo_ia: string | null; resumo: string | null }>(
    `SELECT estagio_ia, motivo_ia, modelo_ia, resumo FROM analises
      WHERE documento_id = $1 ORDER BY criado_em DESC LIMIT 1`, [documentoId]);
  const a = rows[0];
  if (a && a.estagio_ia === 'executada' && a.resumo && a.resumo.trim()) {
    return { estado: 'gerado', resumo: a.resumo.trim(), motivo: null, modelo: a.modelo_ia };
  }
  // Sem resumo da IA: diz por quê. Prefere o motivo da análise; se nem análise
  // houve (p.ex. PDF sem texto), usa o detalhe do processamento.
  let motivo = a?.motivo_ia ?? null;
  if (!motivo) {
    const { rows: p } = await db.query<{ estado: string; detalhe: string | null }>(
      'SELECT estado, detalhe FROM documento_processamento WHERE documento_id = $1', [documentoId]);
    motivo = p[0]?.detalhe ?? 'IA não configurada nesta instalação';
  }
  return { estado: 'pendente', resumo: null, motivo, modelo: null };
}

/** O texto do andamento, fiel ao estado: resumo real ou aviso de pendência. */
function textoDoAndamento(r: Resumo): string {
  if (r.estado === 'gerado') {
    return `Resumo automático da peça${r.modelo ? ` (IA · ${r.modelo})` : ' (IA)'}:\n\n${r.resumo}\n\n` +
      '⚠ Resumo gerado por IA a partir da peça juntada. Confira antes de usar.';
  }
  return 'Resumo automático pendente — IA não configurada.\n' +
    `Motivo: ${r.motivo}\n` +
    'A leitura da peça roda sozinha quando a chave da IA for configurada; o resumo então preenche este andamento.';
}

interface Alvo {
  readonly projetoId: string;
  readonly organizacaoId: string;
  readonly titulo: string;
  readonly processoId: string | null;
  readonly processoNumero: string | null;
}

/** Resolve o projeto e o processo da tarefa, do mesmo jeito que a lista de tarefas. */
async function alvoDaTarefa(db: PoolClient, tarefaId: string): Promise<Alvo> {
  const { rows } = await db.query<{ projeto_id: string; organizacao_id: string; titulo: string; processo_id: string | null; processo_numero: string | null }>(
    `SELECT t.projeto_id, t.organizacao_id, t.titulo, pr.id AS processo_id, pr.numero AS processo_numero
       FROM tarefas t
       LEFT JOIN prazos prazo ON t.origem = 'prazo' AND prazo.id = t.origem_id AND prazo.organizacao_id = t.organizacao_id
       LEFT JOIN publicacoes pub ON pub.organizacao_id = t.organizacao_id
            AND (t.chave_playbook = 'djen-analise:' || pub.id::text OR (t.origem = 'prazo' AND pub.prazo_id = t.origem_id))
       LEFT JOIN processos pr ON pr.id = coalesce(pub.processo_id, prazo.processo_id) AND pr.organizacao_id = t.organizacao_id
      WHERE t.id = $1
      LIMIT 1`, [tarefaId]);
  const a = rows[0];
  if (!a) throw new NaoEncontrado('tarefa não encontrada');
  return { projetoId: a.projeto_id, organizacaoId: a.organizacao_id, titulo: a.titulo, processoId: a.processo_id, processoNumero: a.processo_numero };
}

/** Grava o andamento (movimentação do processo, ou histórico do projeto) e devolve seu id. */
async function gravarAndamento(
  db: PoolClient, alvo: Alvo, tituloDoc: string, texto: string, identidade: Identidade,
): Promise<string> {
  const { id } = await registrarHistorico(db, alvo.projetoId, {
    data: hojeBr(),
    titulo: `Peça juntada no cumprimento: ${tituloDoc}`.slice(0, 300),
    texto,
    processoId: alvo.processoId,
  }, identidade);
  return id;
}

export interface ResultadoCumprimento {
  readonly tarefaId: string;
  readonly documentoId: string;
  readonly estado: 'gerado' | 'pendente';
  readonly resumo: string | null;
  readonly motivo: string | null;
  readonly andamentoId: string;
  readonly processo: string | null;
  readonly jaCumprida: boolean;
}

/**
 * Cumpre a tarefa: lê a peça (análise automática), grava o resumo como andamento
 * e conclui a tarefa. A peça já é documento do projeto (foi enviada antes).
 *
 * Idempotente por documento: cumprir de novo o mesmo documento não duplica o
 * andamento; apenas garante a conclusão da tarefa.
 */
export async function cumprir(
  banco: Banco, dep: Deposito, provedor: Provedor,
  tarefaId: string, documentoId: string, identidade: Identidade,
): Promise<ResultadoCumprimento> {
  const alvo = await banco.comoUsuario(identidade.usuarioId, async (db) => {
    const a = await alvoDaTarefa(db, tarefaId);
    const { rows } = await db.query('SELECT 1 FROM documentos WHERE id = $1 AND projeto_id = $2', [documentoId, a.projetoId]);
    if (!rows[0]) throw new PedidoInvalido('o documento informado não é deste projeto');
    return a;
  });

  // Dispara a leitura da peça: extrai o texto e roda a triagem (determinística
  // sempre; leitura por modelo só com chave). Nunca lança — o estado fica gravado.
  await analiseAuto.processar(banco, dep, provedor, documentoId);

  return banco.comoUsuario(identidade.usuarioId, async (db) => {
    const { rows: existente } = await db.query<{ id: string; andamento_id: string | null; estado: 'gerado' | 'pendente'; motivo: string | null }>(
      'SELECT id, andamento_id, estado, motivo FROM peca_cumprimento WHERE documento_id = $1', [documentoId]);

    let andamentoId: string; let estado: 'gerado' | 'pendente'; let resumoTxt: string | null; let motivo: string | null;
    if (existente[0]) {
      // Já cumprida: não duplica andamento. Só garante a conclusão abaixo.
      andamentoId = existente[0].andamento_id ?? '';
      estado = existente[0].estado; motivo = existente[0].motivo; resumoTxt = null;
    } else {
      const r = await lerResumo(db, documentoId);
      andamentoId = await gravarAndamento(db, alvo, alvo.titulo, textoDoAndamento(r), identidade);
      estado = r.estado; motivo = r.motivo; resumoTxt = r.resumo;
      await db.query(
        `INSERT INTO peca_cumprimento (organizacao_id, tarefa_id, projeto_id, processo_id, documento_id, andamento_id, estado, motivo, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [alvo.organizacaoId, tarefaId, alvo.projetoId, alvo.processoId, documentoId, andamentoId, estado, motivo, identidade.usuarioId]);
    }

    // Conclui a tarefa (datada e identificada, como qualquer conclusão).
    const { rows: t } = await db.query<{ status: string }>('SELECT status FROM tarefas WHERE id = $1', [tarefaId]);
    if (t[0] && t[0].status !== 'concluida') {
      await db.query('UPDATE tarefas SET status = $2, concluida_em = now(), concluida_por = $3, atualizado_em = now() WHERE id = $1',
        [tarefaId, 'concluida', identidade.usuarioId]);
      await auditar(db, {
        organizacaoId: alvo.organizacaoId, usuarioId: identidade.usuarioId,
        acao: 'tarefa.cumprida', entidade: 'tarefa', entidadeId: tarefaId,
        depois: { documentoId, processo: alvo.processoNumero, resumo: estado },
      });
    }

    return {
      tarefaId, documentoId, estado, resumo: resumoTxt, motivo,
      andamentoId, processo: alvo.processoNumero, jaCumprida: !!existente[0],
    };
  });
}

export interface ResumoReprocessado { readonly atualizados: number; readonly pendentes: number }

/**
 * Rotina: completa os resumos que ficaram pendentes por falta de IA. Com a chave
 * configurada, relê cada peça e preenche o andamento. Sem chave disponível, não
 * há o que fazer — devolve sem tocar em nada (nunca inventa).
 */
export async function reprocessarResumosPendentes(
  banco: Banco, dep: Deposito, provedor: Provedor, limite = 5,
): Promise<ResumoReprocessado> {
  if (!provedor.disponivel) return { atualizados: 0, pendentes: 0 };

  const pendentes = await banco.semContexto(async (db) =>
    (await db.query<{ id: string; documento_id: string }>('SELECT id, documento_id FROM pecas_com_resumo_pendente($1)', [limite])).rows);
  if (!pendentes.length) return { atualizados: 0, pendentes: 0 };

  let atualizados = 0;
  for (const p of pendentes) {
    // Relê a peça com o provedor atual: gera uma nova análise com resumo.
    await analiseAuto.processar(banco, dep, provedor, p.documento_id);
    // Trabalha dentro da organização dona do documento (a mesma conta de serviço
    // da análise automática), para o RLS liberar a peça e o andamento.
    const senha = await Bun.password.hash(crypto.randomUUID() + crypto.randomUUID(), { algorithm: 'argon2id' });
    const uid = await banco.semContexto(async (db) =>
      (await db.query<{ usuario_de_analise_automatica: string }>('SELECT usuario_de_analise_automatica($1,$2)', [p.documento_id, senha])).rows[0]!.usuario_de_analise_automatica);

    await banco.comoUsuario(uid, async (db) => {
      const r = await lerResumo(db, p.documento_id);
      const { rows } = await db.query<{ processo_id: string | null; andamento_id: string | null }>(
        'SELECT processo_id, andamento_id FROM peca_cumprimento WHERE id = $1', [p.id]);
      const pc = rows[0];
      if (!pc) return;
      if (r.estado === 'gerado' && pc.andamento_id) {
        const texto = textoDoAndamento(r);
        if (pc.processo_id) await db.query('UPDATE movimentacoes SET conteudo = $2 WHERE id = $1', [pc.andamento_id, texto]);
        else await db.query('UPDATE projeto_historicos SET texto = $2 WHERE id = $1', [pc.andamento_id, texto]);
        await db.query("UPDATE peca_cumprimento SET estado = 'gerado', motivo = NULL, atualizado_em = now() WHERE id = $1", [p.id]);
        atualizados++;
      } else {
        // Continua pendente, mas atualiza o motivo (pode ter mudado).
        await db.query('UPDATE peca_cumprimento SET motivo = $2, atualizado_em = now() WHERE id = $1', [p.id, r.motivo]);
      }
    });
  }
  return { atualizados, pendentes: pendentes.length };
}
