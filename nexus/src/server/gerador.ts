/**
 * Relatórios do Gerador de Relatórios, dentro do projeto.
 *
 * O Gerador (relatorios/) é onde o relatório nasce; o LAB não gera relatório por conta própria para o cliente.
 * Aqui a equipe escolhe uma emissão do Gerador, o LAB remonta o PDF a partir das partes guardadas no Supabase e o
 * guarda no acervo DO PROJETO, interno. Publicar ao cliente continua sendo o ato explícito de sempre (§13).
 *
 * Duas salvaguardas: o tamanho remontado precisa bater com o declarado pela emissão (PDF truncado não entra), e a
 * mesma emissão não entra duas vezes no mesmo projeto.
 */
import type { PoolClient } from 'pg';
import type { Identidade } from '../security/sessao.ts';
import { auditar } from '../store/conexao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { receber, type Deposito } from './arquivos.ts';

export interface Emissao {
  emissao_id: string; nome: string | null; cliente: string | null; cliente_id: string | null; modelo: string | null;
  periodo: string | null; paginas: number | null; tamanho: string | null; partes: number | null; gerado_em: Date | null; por: string | null;
}

export async function emissoes(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<Emissao>('SELECT * FROM relatorios_do_gerador()');
  const { rows: ja } = await db.query<{ emissao_id: string; documento_id: string }>(
    'SELECT emissao_id, documento_id FROM relatorios_gerador_importados WHERE projeto_id = $1', [projetoId]);
  const importadas = new Map(ja.map((r) => [r.emissao_id, r.documento_id]));
  return {
    // Vazio pode ser "o gerador não está neste banco" ou "ninguém emitiu ainda"; a tela diz as duas coisas.
    emissoes: rows.map((e) => ({
      id: e.emissao_id, nome: e.nome, cliente: e.cliente, modelo: e.modelo, periodo: e.periodo, paginas: e.paginas,
      tamanho: e.tamanho === null ? null : Number(e.tamanho), geradoEm: e.gerado_em, por: e.por,
      documentoId: importadas.get(e.emissao_id) ?? null,
    })),
  };
}

export async function importar(
  db: PoolClient, projetoId: string, emissaoId: string, identidade: Identidade, dep: Deposito,
) {
  const { rows: proj } = await db.query<{ organizacao_id: string; nome: string }>('SELECT organizacao_id, nome FROM projetos WHERE id = $1', [projetoId]);
  if (!proj[0]) throw new NaoEncontrado('projeto não encontrado');
  const { rows: ja } = await db.query('SELECT 1 FROM relatorios_gerador_importados WHERE projeto_id = $1 AND emissao_id = $2', [projetoId, emissaoId]);
  if (ja.length) throw new PedidoInvalido('este relatório do gerador já foi importado para este projeto');

  const { rows: lista } = await db.query<Emissao>('SELECT * FROM relatorios_do_gerador()');
  const em = lista.find((e) => e.emissao_id === emissaoId);
  if (!em) throw new NaoEncontrado('emissão não encontrada no gerador');
  const { rows: partes } = await db.query<{ n: number; conteudo_base64: string }>('SELECT * FROM partes_pdf_do_gerador($1)', [emissaoId]);
  if (!partes.length) throw new PedidoInvalido('o gerador não tem o arquivo desta emissão');
  if (em.partes !== null && partes.length !== em.partes) throw new PedidoInvalido(`faltam partes do PDF no gerador (${partes.length} de ${em.partes}); emita de novo`);

  const bytes = Buffer.concat(partes.map((p) => Buffer.from(p.conteudo_base64, 'base64')));
  if (em.tamanho !== null && bytes.length !== Number(em.tamanho)) throw new PedidoInvalido('o PDF remontado não tem o tamanho declarado pelo gerador; não foi importado');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new PedidoInvalido('o arquivo do gerador não é um PDF válido');

  const titulo = [em.cliente, em.periodo, em.modelo].filter(Boolean).join(' · ') || em.nome || 'Relatório do gerador';
  const arquivo = new File([bytes], em.nome ?? `relatorio-${emissaoId}.pdf`, { type: 'application/pdf' });
  const guardado = await receber(db, projetoId, arquivo, { titulo, categoria: 'relatorio_gerador' }, identidade, dep, 'interno');
  await db.query(
    `INSERT INTO relatorios_gerador_importados (organizacao_id, projeto_id, emissao_id, documento_id, importado_por) VALUES ($1,$2,$3,$4,$5)`,
    [proj[0].organizacao_id, projetoId, emissaoId, guardado.documentoId, identidade.usuarioId]);
  await auditar(db, {
    organizacaoId: proj[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'relatorio.importado_do_gerador',
    entidade: 'documento', entidadeId: guardado.documentoId, depois: { emissao: emissaoId, projeto: proj[0].nome, bytes: bytes.length },
  });
  return { documentoId: guardado.documentoId, titulo };
}
