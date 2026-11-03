/**
 * Leitura automática do que o cliente envia.
 *
 * Fluxo: o arquivo chega pelo portal → este módulo extrai o texto → roda a
 * triagem (determinística sempre; leitura por modelo só se houver chave) →
 * grava a análise como trabalho INTERNO → o advogado vê o diagnóstico.
 *
 * Três limites que a tela precisa dizer e este módulo não esconde:
 *  - PDF escaneado (só imagem) não tem texto: fica `sem_texto`, à espera de OCR,
 *    que não está construído. Não se inventa leitura.
 *  - Sem ANTHROPIC_API_KEY a triagem é só a determinística.
 *  - O texto do documento é dado, nunca instrução (§7.12) — a triagem já isola.
 */
import type { PoolClient } from 'pg';
import { extractText, getDocumentProxy } from 'unpdf';
import { auditar, type Banco } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import type { Provedor } from '../ai/provedor.ts';
import type { Deposito } from './arquivos.ts';
import { chaveDoHash } from '../store/arquivos.ts';
import * as analise from './analise.ts';

export type EstadoDoProcessamento = 'na_fila' | 'lendo' | 'analisado' | 'sem_texto' | 'erro';

interface Extraido { readonly texto: string; readonly origem: 'texto_enviado' | 'pdf_nativo'; readonly paginas?: number }

async function extrair(bytes: Uint8Array, mime: string): Promise<Extraido | { vazio: string }> {
  if (mime === 'text/plain' || mime === 'text/csv') {
    try {
      const texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return texto.trim() ? { texto, origem: 'texto_enviado' } : { vazio: 'o arquivo não tem texto' };
    } catch { return { vazio: 'o arquivo não é UTF-8 válido' }; }
  }
  if (mime === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const texto = (Array.isArray(text) ? text.join('\n') : text).trim();
    // Menos de ~40 caracteres por página é, na prática, um PDF de imagem.
    if (texto.length < Math.max(40, totalPages * 40)) {
      return { vazio: `PDF sem camada de texto (${totalPages} página(s), provavelmente digitalizado). Precisa de OCR, que ainda não foi construído.` };
    }
    return { texto, origem: 'pdf_nativo', paginas: totalPages };
  }
  return { vazio: `formato ${mime || 'desconhecido'} sem extrator (só texto e PDF com texto)` };
}

async function marcar(
  db: PoolClient, documentoId: string, org: string, projeto: string | null,
  estado: EstadoDoProcessamento, detalhe: string | null,
) {
  await db.query(
    `INSERT INTO documento_processamento (documento_id, organizacao_id, projeto_id, estado, detalhe)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (documento_id) DO UPDATE SET estado = EXCLUDED.estado, detalhe = EXCLUDED.detalhe, atualizado_em = now()`,
    [documentoId, org, projeto, estado, detalhe]);
}

/** Processa um documento. Nunca lança: o resultado é o estado gravado. */
export async function processar(
  banco: Banco, dep: Deposito, provedor: Provedor, documentoId: string,
): Promise<EstadoDoProcessamento> {
  let servico: Identidade | null = null;
  try {
    const hash = await Bun.password.hash(crypto.randomUUID() + crypto.randomUUID(), { algorithm: 'argon2id' });
    const usuarioId = await banco.semContexto(async (db) =>
      (await db.query<{ usuario_de_analise_automatica: string }>(
        'SELECT usuario_de_analise_automatica($1,$2)', [documentoId, hash])).rows[0]!.usuario_de_analise_automatica);

    const doc = await banco.comoUsuario(usuarioId, async (db) => {
      const { rows } = await db.query<{
        organizacao_id: string; projeto_id: string | null; tipo_mime: string | null; hash_sha256: string | null; tem_arquivo: boolean;
      }>('SELECT organizacao_id, projeto_id, tipo_mime, hash_sha256, tem_arquivo FROM documentos WHERE id = $1', [documentoId]);
      const d = rows[0];
      if (d) await marcar(db, documentoId, d.organizacao_id, d.projeto_id, 'lendo', null);
      return d;
    });
    if (!doc) return 'erro';
    servico = {
      usuarioId, nome: 'Análise automática', email: 'analise-automatica@nga.local', papeis: ['integracao'],
      organizacoes: [{ id: doc.organizacao_id, nome: '', tipo: 'escritorio', papel: 'integracao' }],
    };
    const fim = (estado: EstadoDoProcessamento, detalhe: string | null) =>
      banco.comoUsuario(usuarioId, (db) => marcar(db, documentoId, doc.organizacao_id, doc.projeto_id, estado, detalhe));

    if (!doc.tem_arquivo || !doc.hash_sha256) { await fim('sem_texto', 'o documento não tem arquivo guardado'); return 'sem_texto'; }
    const bytes = await dep.armazenamento.ler(chaveDoHash(doc.hash_sha256), doc.hash_sha256);
    const extraido = await extrair(bytes, (doc.tipo_mime ?? '').split(';')[0]!.trim());
    if ('vazio' in extraido) { await fim('sem_texto', extraido.vazio); return 'sem_texto'; }

    await banco.comoUsuario(usuarioId, (db) => analise.registrarTexto(
      db, documentoId, { texto: extraido.texto, origem: extraido.origem, ...(extraido.paginas ? { paginas: extraido.paginas } : {}) }, servico!));
    const alvo = await banco.comoUsuario(usuarioId, (db) => analise.carregar(db, documentoId));
    const resultado = await analise.rodar(alvo, { comIa: provedor.disponivel }, provedor);
    await banco.comoUsuario(usuarioId, (db) => analise.gravar(db, alvo, resultado, servico!));
    await fim('analisado', provedor.disponivel ? null : 'análise determinística (sem leitura por modelo)');
    return 'analisado';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      if (servico) {
        const s = servico;
        await banco.comoUsuario(s.usuarioId, async (db) => {
          const { rows } = await db.query<{ organizacao_id: string; projeto_id: string | null }>(
            'SELECT organizacao_id, projeto_id FROM documentos WHERE id = $1', [documentoId]);
          if (rows[0]) {
            await marcar(db, documentoId, rows[0].organizacao_id, rows[0].projeto_id, 'erro', msg.slice(0, 300));
            await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: s.usuarioId, acao: 'analise_automatica.falhou', entidade: 'documento', entidadeId: documentoId, depois: { erro: msg.slice(0, 300) } });
          }
        });
      }
    } catch { /* o banco pode já ter sido encerrado */ }
    return 'erro';
  }
}
