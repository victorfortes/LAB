/**
 * Credencial das aplicações do NGA Nexus.
 *
 * O NGA Prazos, o NGA Íntegra e o NGA Sentinela seguem sendo aplicações
 * próprias — a decisão foi integrar por ARTEFATO, não absorver código. Então
 * o que elas precisam é de uma forma de entregar o que produzem, e de uma
 * credencial que não seja a sessão de um advogado.
 *
 * O token tem prefixo próprio (`nga_int_`) para nunca ser confundido com
 * token de sessão: são caminhos de autenticação distintos, com poderes
 * distintos, e um erro que trocasse um pelo outro daria a um script o que é
 * de uma pessoa. Guardamos só o hash, como na sessão: o token aparece uma vez
 * e não há como lê-lo depois.
 */
import type { PoolClient } from 'pg';
import { hashDoToken, tokenNovo } from './sessao.ts';

export const PREFIXO_DO_TOKEN = 'nga_int_';

export type Aplicacao = 'sentinela' | 'integra' | 'prazos' | 'outra';

/** O que cada credencial pode entregar. */
export type Escopo = 'processos' | 'prazos' | 'documentos';

export const ESCOPOS: readonly Escopo[] = Object.freeze(['processos', 'prazos', 'documentos']);

/** Escopos que cada aplicação costuma precisar, para a tela sugerir. */
export const ESCOPO_USUAL: Readonly<Record<Aplicacao, readonly Escopo[]>> = Object.freeze({
  sentinela: ['processos'],
  integra: ['documentos'],
  prazos: ['prazos', 'processos'],
  outra: [],
});

export interface Integracao {
  readonly id: string;
  readonly organizacaoId: string;
  /** Usuário de serviço: é sob ele que a ingestão roda, com RLS normal. */
  readonly usuarioId: string;
  readonly nome: string;
  readonly aplicacao: Aplicacao;
  readonly escopos: readonly Escopo[];
}

export class SemEscopo extends Error {
  override readonly name = 'SemEscopo';
  constructor(readonly escopo: Escopo, readonly integracao: string) {
    super(`a credencial "${integracao}" não tem escopo para entregar ${escopo}`);
  }
}

export function tokenDeIntegracao(): string {
  return `${PREFIXO_DO_TOKEN}${tokenNovo()}`;
}

export function pareceTokenDeIntegracao(token: string): boolean {
  return token.startsWith(PREFIXO_DO_TOKEN);
}

/**
 * Resolve a credencial.
 *
 * Roda sem contexto de RLS — é o que acontece antes de haver usuário — e por
 * isso usa a função de superfície mínima da migração 016, não uma consulta
 * livre em `integracoes`.
 */
export async function integracaoDoToken(
  db: PoolClient, token: string,
): Promise<Integracao | null> {
  if (!pareceTokenDeIntegracao(token)) return null;

  const { rows } = await db.query<{
    integracao_id: string; organizacao_id: string; usuario_id: string;
    nome: string; aplicacao: Aplicacao; escopos: string[];
  }>('SELECT * FROM auth_integracao($1)', [hashDoToken(token)]);

  const linha = rows[0];
  if (!linha) return null;

  return {
    id: linha.integracao_id,
    organizacaoId: linha.organizacao_id,
    usuarioId: linha.usuario_id,
    nome: linha.nome,
    aplicacao: linha.aplicacao,
    escopos: linha.escopos.filter((e): e is Escopo => (ESCOPOS as readonly string[]).includes(e)),
  };
}

export function exigirEscopo(integracao: Integracao, escopo: Escopo): void {
  if (!integracao.escopos.includes(escopo)) throw new SemEscopo(escopo, integracao.nome);
}

/** Registra o uso. Falhar aqui não pode derrubar a entrega já aceita. */
export async function marcarUso(db: PoolClient, integracaoId: string): Promise<void> {
  await db.query('SELECT integracao_marcar_uso($1)', [integracaoId]).catch(() => {});
}
