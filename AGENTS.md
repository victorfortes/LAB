<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Gerador de Relatórios NGA — Decisões de Arquitetura

- Stack: TanStack Start v1 (React 19 + TypeScript) com Tailwind CSS v4; roteamento file-based em `src/routes` — é a base fixa do projeto, não substituir por outro router.
- Estado atual: o código original do Gerador (Artifact do Claude) foi recebido e integrado como site estático em `public/gerador/` (ver "Integração do Gerador original" abaixo). Não inventar funcionalidades, modelos de relatórios ou componentes do gerador.
- Backend: integração com Lovable Cloud (Supabase) planejada para autenticação individual e armazenamento privado de relatórios, mas ainda não habilitada — habilitar somente quando a migração funcional começar.
- Autenticação futura: rotas protegidas devem ficar sob `src/routes/_authenticated/`; lógica de servidor via `createServerFn` (não usar Supabase Edge Functions).
- Integração futura com NGA Nexus: manter arquitetura modular; não conectar o NGA Nexus nesta etapa.
- Não reutilizar recursos de outros projetos Lovable. Publicação: autorizada pelo responsável em 12/10/2026, somente depois de concluídos os testes de produção descritos em `docs/06_IMPLANTACAO.md`.

## Integração do Gerador original (leia antes de editar)

- O Gerador é o **Artifact original preservado** (`original/*.html`, imutável, SHA-256 em `original/SHA256SUMS`). **Nunca editar `original/`.**
- `scripts/build.mjs` (Node, sem dependências) extrai a página, aplica os patches listados em `scripts/patches.json` (cada um precisa casar exatamente uma vez), injeta a CSP, copia a casca (`web/shell`), as fontes (`web/app/fonts`) e o supabase-js vendorizado (`web/vendor`) e **gera `public/gerador/`**. Esses arquivos são versionados de propósito (o pipeline do Lovable serve `public/` sem rodar o build do gerador). **Não editar `public/gerador/` à mão**: altere a fonte e rode `node scripts/build.mjs`; o CI falha se `public/gerador/` estiver desatualizado.
- `config/supabase.public.json` guarda a URL e a chave **anon** (públicas por desenho; o RLS protege os dados). O build recusa qualquer chave cujo papel não seja `anon`. **Nunca** colocar chave `service_role`/secret em nenhum arquivo.
- O banco (Supabase independente, **não** o Lovable Cloud) está em `supabase/migrations/`. Mudança de esquema = nova migração + `tests/db`.
- Testes: `cd tests && npm ci && npm test` (banco com PostgreSQL real via PGlite + Playwright). Equivalência com o original (telas e PDFs) é obrigatória a cada mudança no build.
- Não alterar o motor de PDF (jsPDF/pdf.js dentro do original) sem evidência de defeito reproduzível.
- Rota `/` (`src/routes/index.tsx`) apenas redireciona para `/gerador/`. Rotas React protegidas futuras ficam em `src/routes/_authenticated/`; o gerador faz seu próprio login (Supabase Auth) na casca.
- Keep input-only enhancements in the copied shell assets and exact-match Artifact patches; this preserves the immutable original and PDF engine while allowing regression tests of intentional UI differences.
- Serve only the three known generated HTML documents before TanStack SSR in the Vite development middleware; this makes preview match static production hosting without introducing Worker filesystem access.
