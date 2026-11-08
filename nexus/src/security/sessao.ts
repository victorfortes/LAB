/**
 * Autenticação e sessão.
 *
 * Senha com Argon2id (padrão do `Bun.password`). Token de sessão com 256 bits
 * de entropia criptográfica, guardado como SHA-256 — o valor em claro só
 * existe na resposta do login e no cookie do navegador.
 */
import type { PoolClient } from 'pg';
import type { Papel } from './rbac.ts';

const DURACAO_PADRAO_HORAS = 8;

export interface Identidade {
  readonly usuarioId: string;
  readonly nome: string;
  readonly email: string;
  readonly papeis: readonly Papel[];
  readonly organizacoes: readonly { id: string; nome: string; tipo: string; papel: Papel }[];
}

export async function hashDaSenha(senha: string): Promise<string> {
  if (senha.length < 12) {
    throw new ErroDeAutenticacao('a senha precisa ter ao menos 12 caracteres');
  }
  return Bun.password.hash(senha, { algorithm: 'argon2id' });
}

export function tokenNovo(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hashDoToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

/**
 * Autentica e abre sessão. Devolve o token em claro uma única vez.
 *
 * Usuário inexistente e senha errada seguem o mesmo caminho e levam o mesmo
 * tempo: a resposta não revela se o e-mail existe.
 */
export async function autenticar(
  db: PoolClient, email: string, senha: string,
  contexto: { ip?: string; agente?: string } = {},
): Promise<{ token: string; expiraEm: Date }> {
  // Via função SECURITY DEFINER: `usuarios` tem RLS que exige contexto de
  // usuário, e no login ainda não há usuário. Ver migração 006.
  const { rows } = await db.query<{ id: string; senha_hash: string; ativo: boolean }>(
    'SELECT * FROM auth_credenciais($1)', [email]);

  const usuario = rows[0];
  // Hash descartável para que a comparação custe o mesmo com e sem usuário.
  const hashParaComparar = usuario?.senha_hash
    ?? '$argon2id$v=19$m=65536,t=2,p=1$aaaaaaaaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const confere = await Bun.password.verify(senha, hashParaComparar).catch(() => false);

  if (!usuario || !confere || !usuario.ativo) {
    throw new ErroDeAutenticacao('e-mail ou senha inválidos');
  }

  const token = tokenNovo();
  const expiraEm = new Date(Date.now() + DURACAO_PADRAO_HORAS * 3600_000);
  await db.query(
    `INSERT INTO sessoes (usuario_id, token_hash, expira_em, ip, agente) VALUES ($1,$2,$3,$4,$5)`,
    [usuario.id, hashDoToken(token), expiraEm, contexto.ip ?? null, contexto.agente ?? null]);
  await db.query('SELECT auth_marcar_acesso($1)', [usuario.id]);

  return { token, expiraEm };
}

/** Resolve o token numa identidade, ou `null` se inválido/expirado/revogado. */
export async function identidadeDoToken(db: PoolClient, token: string): Promise<Identidade | null> {
  const { rows } = await db.query<{
    usuario_id: string; nome: string; email: string;
    organizacao_id: string; organizacao_nome: string; organizacao_tipo: string; papel: Papel;
  }>(
    'SELECT * FROM auth_identidade($1)', [hashDoToken(token)]);

  const primeira = rows[0];
  if (!primeira) return null;

  return {
    usuarioId: primeira.usuario_id,
    nome: primeira.nome,
    email: primeira.email,
    papeis: [...new Set(rows.map((r) => r.papel))],
    organizacoes: rows.map((r) => ({
      id: r.organizacao_id, nome: r.organizacao_nome, tipo: r.organizacao_tipo, papel: r.papel,
    })),
  };
}

export async function revogar(db: PoolClient, token: string): Promise<void> {
  await db.query(
    'UPDATE sessoes SET revogada_em = now() WHERE token_hash = $1 AND revogada_em IS NULL',
    [hashDoToken(token)]);
}

/** Muitas tentativas erradas: 429, com a mesma resposta exista ou não o e-mail. */
export class LoginBloqueado extends Error {
  override readonly name = 'LoginBloqueado';
  constructor() { super('muitas tentativas. Aguarde 15 minutos e tente de novo'); }
}

export const loginBloqueado = async (db: PoolClient, email: string, ip?: string): Promise<boolean> =>
  (await db.query<{ b: boolean }>('SELECT auth_login_bloqueado($1,$2) AS b', [email, ip ?? null])).rows[0]!.b;
export const registrarFalha = async (db: PoolClient, email: string, ip?: string): Promise<void> => {
  await db.query('SELECT auth_registrar_falha($1,$2)', [email, ip ?? null]);
};
export const limparFalhas = async (db: PoolClient, email: string): Promise<void> => {
  await db.query('SELECT auth_limpar_falhas($1)', [email]);
};
export const deveTrocarSenha = async (db: PoolClient, usuarioId: string): Promise<boolean> =>
  (await db.query<{ b: boolean }>('SELECT auth_deve_trocar_senha($1) AS b', [usuarioId])).rows[0]!.b;

/** Troca a própria senha, conferindo a atual. As outras sessões do usuário caem. */
export async function trocarSenha(
  db: PoolClient, identidade: Identidade, token: string, atual: string, nova: string,
): Promise<void> {
  const { rows } = await db.query<{ senha_hash: string }>('SELECT * FROM auth_credenciais($1)', [identidade.email]);
  const confere = rows[0] ? await Bun.password.verify(atual, rows[0].senha_hash).catch(() => false) : false;
  if (!confere) throw new ErroDeAutenticacao('a senha atual não confere');
  if (nova === atual) throw new ErroDeAutenticacao('a nova senha precisa ser diferente da atual');
  await db.query('SELECT auth_trocar_senha($1,$2,$3)', [identidade.usuarioId, await hashDaSenha(nova), hashDoToken(token)]);
}

export class ErroDeAutenticacao extends Error {
  override readonly name = 'ErroDeAutenticacao';
}
