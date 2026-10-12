import { execFileSync } from 'node:child_process';
import { iniciar } from './mock_supabase.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export default async function () {
  const distAlternativo = process.env.NGA_DIST;   // ex.: lovable_out/dist (pacote publicado pelo Lovable)
  // build do app apontando para o servidor de teste (chave anon fictícia: o mock não a valida)
  if (!distAlternativo) execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: raiz, env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:8788', SUPABASE_ANON_KEY: 'chave-anon-de-teste' }, stdio: 'inherit' });
  const S = 'Senha-de-teste-123';
  globalThis.__mock = await iniciar({ porta: 8788, dist: distAlternativo ? path.resolve(raiz, distAlternativo) : undefined, usuarios: [
    { email: 'admin@teste.local', senha: S, papel: 'admin', nome: 'Admin Teste' },
    { email: 'adv@teste.local', senha: S, papel: 'advogado', nome: 'Advogado Teste' },
    { email: 'vis@teste.local', senha: S, papel: 'visualizador', nome: 'Visualizador Teste' },
    { email: 'inativo@teste.local', senha: S, papel: 'advogado', nome: 'Inativo Teste', ativo: false },
    { email: 'semperfil@teste.local', senha: S }] });
}
