# Gerador de Relatórios Jurídicos NGA (aplicação web independente)

Migração do Artifact "Relatórios Jurídicos, NGA" (Claude) para uma aplicação web própria do escritório:
**o gerador original foi preservado sem reescrita** (6 patches rastreáveis, ver `scripts/build.py`), hospedado dentro de uma
**casca** com login individual (Supabase Auth), administração de usuários e banco PostgreSQL com **RLS**.

> Este repositório é também o projeto do Lovable (TanStack Start). O Gerador vive em `public/gerador/` (gerado) e o
> scaffold React do Lovable fica intacto em `src/`. Estado e pendências: `docs/11_RESULTADO_FINAL.md`.

## Estrutura
| Pasta | O que é |
|---|---|
| `original/` | Cópia íntegra e somente leitura do Artifact (v27) + `SHA256SUMS`. Nunca editar. |
| `public/gerador/` | **Gerado** por `scripts/build.mjs` (casca + gerador original com patches + fontes + supabase-js). Versionado; não editar à mão. |
| `src/`, `package.json`, `vite.config.ts` | Projeto TanStack Start do Lovable (intacto). A rota `/` redireciona para `/gerador/`. |
| `config/supabase.public.json` | URL e chave **anon** do Supabase (públicas). |
| `web/shell/` | Casca: login, recuperação de senha, ponte de sessão, administração, auditoria. |
| `web/app/fonts/` | Fontes (Newsreader, Inter, IBM Plex Mono) hospedadas localmente. |
| `scripts/build.mjs` | Gera `public/gerador/` a partir do original + patches + casca. Falha se o original mudar. |
| `supabase/migrations/` | Esquema, RLS, gatilhos de versão e auditoria. |
| `supabase/functions/convidar-usuario/` | Convite de usuário (Edge Function, só administrador). |
| `scripts/backup.mjs`, `restaurar.mjs` | Backup cifrado e restauração. |
| `tests/db/` | Testes do banco com PostgreSQL real (PGlite). |
| `tests/e2e/` | Testes de interface (Playwright): login, permissões, persistência, equivalência. |
| `docs/` | Documentação 01 a 11. |

## Rodar localmente
```bash
node scripts/build.mjs                       # regenera public/gerador
cd tests && npm ci && npx playwright install chromium
npm run test:db                              # RLS, versões, auditoria, privilégios, backup/restauração
npm run test:e2e                             # build de teste + servidor com PostgreSQL real + Playwright
```
Para publicar de verdade, siga `docs/06_IMPLANTACAO.md`.

## Regras do projeto
- Não editar `original/`. Mudanças no gerador = novo patch em `scripts/build.py` com motivo escrito.
- Nunca commitar `.env`, chaves `service_role`, dados reais de clientes ou PDFs do Astrea.
- Em desenvolvimento use só dados sintéticos.
