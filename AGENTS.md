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
- Estado atual: estrutura inicial mínima aguardando a migração do código-fonte original (Artifact do Claude). Não inventar funcionalidades, modelos de relatórios ou componentes do gerador antes de receber o código original.
- Backend: integração com Lovable Cloud (Supabase) planejada para autenticação individual e armazenamento privado de relatórios, mas ainda não habilitada — habilitar somente quando a migração funcional começar.
- Autenticação futura: rotas protegidas devem ficar sob `src/routes/_authenticated/`; lógica de servidor via `createServerFn` (não usar Supabase Edge Functions).
- Integração futura com NGA Nexus: manter arquitetura modular; não conectar o NGA Nexus nesta etapa.
- Não reutilizar recursos de outros projetos Lovable; não publicar a aplicação até instrução explícita.
