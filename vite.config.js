// Compatibilidade com o fluxo do Lovable (que roda `vite build`): o Vite só dispara o build do projeto,
// que gera dist/ com o gerador original preservado + a casca. Nenhum arquivo do gerador passa pelo bundler.
import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';

export default defineConfig({
  root: 'lovable',
  build: { outDir: '../dist', emptyOutDir: false },
  plugins: [{
    name: 'nga-build',
    apply: 'build',
    closeBundle() { execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' }); },
  }],
});
