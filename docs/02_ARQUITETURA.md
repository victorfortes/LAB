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
| P7 | CSP também por `<meta>` (hospedagem sem cabeçalhos HTTP) |
| P8 a P11 | **Melhorias de entrada pedidas pelo escritório (feitas pela IA do Lovable em 12/10/2026 e revisadas)**: filtro de clientes por nome e área, "selecionar todos" nos últimos andamentos, barras automáticas em datas, ícone da aba. Não tocam no motor de PDF (equivalência de PDF mantida). Código em `web/shell/experiencia.js` |
| P12 a P16 | Revisão de outubro (12/10/2026, pedida pelo escritório): filtro de mês nos últimos andamentos (P12-P13) e Revisional beta só para administradores (P14-P16) |
| P17 a P24, P29, P30 | Correções do relatório executivo após o primeiro relatório real (Grupo NB, 20/10/2026): data do cadastro vale no PDF e a conferência com o Astrea vira aviso (P17); **(P18 a P24, P29 e P30 só valem para clientes com a opção "Destaques do comitê de credores e resumo de e-mails" ligada no cadastro, desligada por padrão; P17 vale para todos)** reunião do comitê de credores e comunicação ao comitê reconhecidas, e título do evento entra na classificação (P18); texto de exibição sem saudação de e-mail, com corte em fim de frase, e reunião agendada no histórico sugerida como próximo passo (P19, P20); eventos pesam pelo esforço (P21); prazo sem desfecho não vira entrega nem acontecimento (P22, P24); próxima providência sugerida na revisão (P23) |
| P25 a P28 | Opção "Texto completo no PDF" por acontecimento e por entrega na revisão do executivo (21/10/2026): mostra o conteúdo integral na tela e tira o corte de 3 linhas do cartão; textos muito longos viram blocos "(continuação)" que cabem na coluna. Só o posicionamento dos cartões muda; o motor jsPDF/pdf.js não foi tocado |

`dist/BUILD.json` registra o SHA-256 do original, da página resultante e os patches aplicados em cada build.
