# Gerador de Relatórios Jurídicos NGA (aplicação web independente)

Migração do Artifact "Relatórios Jurídicos, NGA" (Claude) para uma aplicação web própria do escritório:
**o gerador original foi preservado sem reescrita** (6 patches rastreáveis, ver `scripts/build.py`), hospedado dentro de uma
**casca** com login individual (Supabase Auth), administração de usuários e banco PostgreSQL com **RLS**.

> Estado atual: código, banco, testes e documentação prontos. **Ainda não publicado**: faltam as contas
> GitHub, Supabase e Cloudflare (ver `docs/11_RESULTADO_FINAL.md` e `docs/06_IMPLANTACAO.md`).

## Estrutura
| Pasta | O que é |
|---|---|
| `original/` | Cópia íntegra e somente leitura do Artifact (v27) + `SHA256SUMS`. Nunca editar. |
| `web/shell/` | Casca: login, recuperação de senha, ponte de sessão, administração, auditoria. |
| `web/app/fonts/` | Fontes (Newsreader, Inter, IBM Plex Mono) hospedadas localmente. |
| `scripts/build.py` | Gera `dist/` a partir do original + patches + casca. Falha se o original mudar. |
| `supabase/migrations/` | Esquema, RLS, gatilhos de versão e auditoria. |
| `supabase/functions/convidar-usuario/` | Convite de usuário (Edge Function, só administrador). |
| `scripts/backup.mjs`, `restaurar.mjs` | Backup cifrado e restauração. |
| `tests/db/` | Testes do banco com PostgreSQL real (PGlite). |
| `tests/e2e/` | Testes de interface (Playwright): login, permissões, persistência, equivalência. |
| `docs/` | Documentação 01 a 11. |

## Rodar localmente
```bash
npm ci
npx playwright install chromium
npm test            # testes do banco (RLS, versões, auditoria, backup/restauração)
npm run test:e2e    # build + servidor de teste com PostgreSQL real + Playwright
```
Para publicar de verdade, siga `docs/06_IMPLANTACAO.md`.

## Regras do projeto
- Não editar `original/`. Mudanças no gerador = novo patch em `scripts/build.py` com motivo escrito.
- Nunca commitar `.env`, chaves `service_role`, dados reais de clientes ou PDFs do Astrea.
- Em desenvolvimento use só dados sintéticos.
