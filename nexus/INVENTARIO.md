# NGA LAB — Inventário verificado (01/11/2026)

Tudo abaixo foi **verificado** nesta data: leitura dos repositórios em disco,
extração do bundle público do Nexus e dos dados da apresentação do NGA Lab.
Nada aqui é suposição. O que não foi verificado está marcado como tal.

## 1. O que existe em disco (`~/Desktop/Tecnologias Jurídicas`)

| Projeto | Stack | Estado real (segundo os próprios docs do projeto) |
|---|---|---|
| **NGA Prazos** (`Agendamento de Prazos/nga-prazos`) | Bun + TS, React 19/Vite, PostgreSQL, Playwright | **O mais maduro.** 58 testes. Leitura real do Astrea verificada em conta real (21/10). 1 gravação real confirmada por releitura (24/10). Escrita/edição no Astrea real **não** habilitadas. |
| **NGA Íntegra** (`NGA Íntegra`) | Bun + TS, Playwright, pdf-lib | 10 testes. Divisão de PDF testada em autos reais (5.878 págs → 59 partes, 12 s). Captura assistida **não** exercitada em tribunal real. Análise Claude testada só com API simulada. |
| **NGA Sentinela** (`NGA Sentinela`) | Python, SQLite, DJEN + DataJud | 28 testes. Pipeline real executado (CNPJ real → 31 análises). **0 % de cobertura validada** para "ação contra cliente por CNPJ". DataJud **não** identifica partes. |
| **Bi de prazos** | HTML estático (527 KB) | Artefato único, sem código-fonte de geração. |
| **Gerador de relatórios** | — | **Pasta vazia.** |

### Achado importante: o design system do NGA Lab já existe em código
`NGA Íntegra/web/style.css` e `nga-prazos/web/src/styles.css` implementam **exatamente**
os mesmos tokens da apresentação — não é só um deck:

```
--bg:#03050A  --ink:#EAF1F8  --mut:#8DA0B5  --amber:#F0A32E  --amber2:#FFD08A
--cy:#4CC9F0  --green:#2EE6A0  --red:#FF6B6B  --line:rgba(255,255,255,.11)
--sans:Barlow  --cond:Barlow Condensed  --mono:JetBrains Mono
```
São 3 cópias divergentes do mesmo sistema. Devem virar **um pacote compartilhado**.

## 2. NGA Lab — inventário da apresentação

- **Entregues (2):** Painel de Prazos · Relatórios Visuais
- **Em desenvolvimento (5):** NGA Íntegra · BI financeiro · Robô de Prazos · Radar de RJs e Falências · Monitor de Editais de AGC
- **Biblioteca de skills (12):** contabilidade · contratos/revisional · análise de RMA · petições simples · análise de PRJ · objeção ao plano · impugnação de crédito · divergência de crédito · petição inicial de RJ · construção do PRJ · defesa em pedido de falência · contas mensais da recuperanda
- **Projetos futuros (5):** diagnóstico de empresa em crise · mapa do grupo econômico · banco de peças e teses · novas skills · precedentes e jurimetria

### Divergência entre o briefing e a realidade
O briefing (§8) manda "integrar as ferramentas existentes" e cita quatro por nome. Verificado:

| Ferramenta citada | Existe? |
|---|---|
| **NGA Sentinela** | ✅ Existe em disco, funcional com ressalvas — e **ligado ao Nexus** desde 02/11/2026 (`sentinela nexus-enviar`), entrega exercitada de ponta a ponta |
| **NGA Radar Concursal** | ⚠️ É o "Radar de RJs e Falências" do deck — **só conceito, sem código** |
| **NGA Atlas** (investigação patrimonial) | ⛔ **Não existe** — nem em disco, nem no deck |
| **NGA Orbit** (assistente executivo) | ⛔ **Não existe** — nem em disco, nem no deck |

Atlas e Orbit não são integrações: são **construções novas**.

## 3. Nexus (`nganexus.lovable.app`) — engenharia reversa do bundle público

Stack: **Lovable + React + Tailwind/shadcn + Recharts + TanStack Router + Supabase**
(projeto `oaxznvfdytewwmbmkwri`). 163 chunks, ~5 MB de JS.

**~40 rotas:** `/clientes` `/projetos` `/tarefas` `/crm` `/financeiro` `/controladoria`
`/documentos` `/onboarding` `/portal` `/parceiros` `/horas` `/ia` `/auditoria`
`/permissoes` `/usuarios` `/admin` `/dashboards` `/integracao-astrea` `/integracao-cnj`
`/templates-documentos` `/biblioteca-clausulas` `/ficha/$token` …

**68 tabelas Supabase** extraídas do bundle:
```
activity_log ai_insights astrea_deadlines astrea_links astrea_processes audit_events
avatars client_cases client_products client_qsa_members client_qsa_snapshots clients
cnpj_cache contacts cost_categories costs datajud_cases datajud_movements departments
document_brand_settings document_clause_library document_template_versions
document_templates documents group_companies lead_custom_fields lead_group_companies
lead_highlights lead_products lead_responsibles lead_tag_assignments lead_tags leads
members nav_config notification_events notification_preferences onboarding_requirements
onboarding_stage_templates onboardings operational_tenant_users partner_commission_rules
partner_commissions partners pipeline_settings pipeline_stages product_catalog profiles
project_comments project_costs project_meetings project_pricing project_processes
project_tasks projects proposals required_documents roadmap_items role_definitions
task_categories task_comments task_kinds task_queue_pins task_subtasks time_entries
timer_settings user_departments user_preferences
```
RPCs: `current_operational_tenant_id` · `get_my_access_context` ·
`get_pending_contracts_for_user` · `get_profile_hourly_rate` · `get_required_doc_portal_url`

### Conclusões sobre o Nexus
1. **Não é descartável.** Multi-tenancy real (`operational_tenant_users` + RPC de contexto),
   grupo econômico e QSA (`group_companies`, `client_qsa_members/_snapshots`), Astrea e
   DataJud já modelados, auditoria, templates e biblioteca de cláusulas. O §20 do briefing
   (cadastro único reaproveitado) está **em boa parte modelado**.
2. **A identidade visual é oposta à do NGA Lab.** Tela clara, bege/dourado, `ui-sans-serif`
   genérica. Não há Barlow, nem fundo #03050A, nem JetBrains Mono. A camada visual é
   reconstrução, não ajuste.
3. **O domínio de insolvência é inexistente.** Busca por
   `creditor|credores|habilitac|quirograf|assembleia|agc|plano_recuper` no bundle inteiro:
   **0 ocorrências**. Não há credores, classes, créditos, planos, pagamentos, AGC, quóruns,
   UPI, DIP. É exatamente a especialidade da NGA e **a maior lacuna do produto**.
4. **Não há edge functions** no bundle: nenhum pipeline assíncrono de IA/OCR hoje.

## 4. Impedimentos precisos (não contornáveis por mim)

| # | Impedimento | O que destrava |
|---|---|---|
| 1 | **Sem credenciais do Nexus.** Só vejo o bundle público; não vejo comportamento, volume de dados, nem políticas RLS. | Um usuário de teste, ou acesso ao painel Supabase. |
| 2 | **Sem o código-fonte do Nexus.** Em disco só existe o bundle compilado. Refatorar (em vez de reconstruir) exige o repositório. | Sync Lovable→GitHub, ou export do projeto. |
| 3 | **Sem `service_role` do Supabase.** Não consigo ler o schema real (constraints, índices, RLS, triggers) nem migrar dados. | Chave de serviço / acesso ao projeto. |
| 4 | **Sem chave Anthropic ativa.** A análise documental determinística está construída e testada (classificação, dígitos verificadores, citações, defesa contra injeção). A leitura por modelo usa o SDK oficial com saída validada por esquema, mas **nenhuma chamada real foi feita**, então o módulo não pode ser declarado operacional. | `ANTHROPIC_API_KEY`. |
| 5 | **Astrea: escrita real não liberada**; **tribunais: 0 % de cobertura validada**. | Decisão de negócio + contas de teste. |

Nada disso é inventável. Tudo que **não** depende deles pode avançar já.
