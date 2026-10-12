# 02 · Arquitetura e decisões técnicas

## Decisão central: preservar o motor, não reconstruir
O Artifact original **já é uma aplicação web completa** (HTML/JS de arquivo único) e já trazia um módulo (`nuvem`) preparado para
falar com uma tabela `documentos` do Supabase, recebendo o token da página que o hospeda. Por isso a migração **não reescreve nada**:

```
 Navegador
 ┌──────────────────────────────────────────────────────────────┐
 │ CASCA  (web/shell: index.html + shell.js)         mesma origem │
 │  · login Supabase Auth · perfil/papel · inatividade (30 min)   │
 │  · administração (usuários, auditoria)                         │
 │  ┌────────────────────────────────────────────────────────┐  │
 │  │ iframe → app/gerador.html  = Artifact original + 6 patches│  │
 │  │  motor de relatórios · estúdio · modelos · PDF (jsPDF)    │  │
 │  │  módulo "nuvem" ──postMessage{nga:'token'}──► casca       │  │
 │  └────────────────────────────────────────────────────────┘  │
 └───────────────┬──────────────────────────────────────────────┘
                 │ HTTPS · JWT do usuário (anon key é pública)
        ┌────────▼─────────┐
        │ Supabase         │  Auth · PostgREST · Edge Function (convite)
        │ PostgreSQL + RLS │  perfis · documentos · versões · auditoria
        └──────────────────┘
```

## Camadas (preparadas para o NGA Nexus)
| Camada | Onde | Depende de Supabase/Lovable? |
|---|---|---|
| **Core do gerador** (modelos, layouts, edição, cálculo, preview, PDF) | `app/gerador.html` (original) | **Não**. Roda sozinho; sem backend só funciona local. |
| **Dados** | contrato `documentos` (`colecao, id, dados, removido, atualizado_em`) em `supabase/migrations` | Implementação em Postgres; o contrato é simples e portável. |
| **Identidade** | casca (`shell.js`) + tabela `perfis` | Sim (Supabase Auth), isolada na casca. |
| **Integração** | `postMessage` (token, logout, admin) e contrato `NGA_SHELL_CFG` | Ver `07_INTEGRACAO_NEXUS.md`. |

## Decisões e justificativas
1. **Casca + iframe do mesmo site**, e não embutir o gerador na aplicação do Lovable: o gerador é um HTML de 2,7 MB com scripts inline e estilos globais; isolá-lo num iframe garante **fidelidade visual e funcional** (nada herda CSS ou JS do host). Foi o desenho que o próprio módulo `nuvem` do original assume.
2. **Hospedagem estática** (Cloudflare Pages): o app é estático; o backend é o Supabase. Sem servidor próprio para manter.
3. **Build em Python, sem bundler**: o build apenas extrai a página do Artifact, aplica 6 trocas exatas e copia a casca. Cada patch precisa casar **exatamente uma vez** e o SHA-256 do original é conferido; qualquer divergência interrompe o build.
4. **Permissões no banco (RLS + gatilhos)**, não na interface.
5. **PDFs ficam em linhas do Postgres** (coleção `pdfs`, em pedaços), como o original já faz, protegidos por RLS. Não existe bucket público. Alternativa futura (Storage privado) em `07`/`11`.
6. **Sem IA externa**: o botão de redação por IA só existe dentro do Claude e foi mantido como está (desligado fora dele).

## Patches no original (lista fechada, em `scripts/build.py`)
| ID | Motivo |
|---|---|
| P1 | Fontes locais (sem Google Fonts) |
| P2 | **Remove a conta admin padrão com senha fixa** |
| P3 | Módulo `nuvem` lê a configuração do Supabase da casca |
| P4 | "Sair" encerra a sessão Supabase na casca |
| P5 | "Usuários" abre a administração real |
| P6 | Aberto fora da casca, o gerador redireciona para o login |

`dist/BUILD.json` registra o SHA-256 do original, da página resultante e os patches aplicados em cada build.
