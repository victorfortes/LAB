# NGA Prazos — Entrega completa (estado em 28/10/2026)

Plataforma de automação e auditoria de prazos processuais integrada ao Astrea. Stack: TypeScript no Bun, React/Vite, Playwright, PostgreSQL (Supabase). Este documento reúne **tudo**: o que existe, como rodar, as regras, a segurança, as decisões e os pontos pendentes.

## 1. O que o sistema faz (fluxo)
1. **Play** — o robô entra no Astrea (login automático pelo cofre cifrado), lê as publicações "Não tratadas" da lista (filtro salvo na conta do Astrea) e abre cada uma para ler texto, processo, sugestão da IA do Astrea.
2. **Classificação** — regras determinísticas (`src/domain/classifier.ts`) indicam a providência, o prazo, o responsável e a confiança; calculam o vencimento (`deadline.ts`); detectam prazo de terceiro, ciência de acórdão, aviso de distribuição, renúncia de patrono, duplicatas e divergência com a sugestão do Astrea.
3. **Revisão humana** — a interface mostra tudo; a pessoa **aprova** (individual com confirmação dos alertas, ou em lote para os sem ambiguidade), rejeita, comenta.
4. **Escrita** (publicação precisa estar "NÃO TRATADA" no momento da gravação; se a Controladoria já a tratou/descartou, o robô aborta) — com **autorização de escrita ativa** (até 2 h por processo) o robô cria o prazo no Astrea, **relê** e só então marca "Confirmada". Ao final de uma gravação **confirmada**, clica em **Concluir** para deixar a publicação TRATADA no Astrea (confirma relendo o status; falha aqui não invalida o prazo e avisa para concluir manualmente; `NGA_CONCLUDE_PUBLICATION=no` desliga). Nunca exclui.
5. **Auditoria** — a Controladoria marca "Auditoria feita"; tudo fica numa trilha imutável encadeada por hash.
6. **Correção** — ciclo de correção autorizada (um campo por vez, com justificativa, releitura e revalidação).

## 2. Como rodar
Pré-requisitos: macOS, [Bun](https://bun.sh), Chromium do Playwright.
```bash
cd nga-prazos
bun install
bunx playwright install chromium
scripts/set-db-url.sh               # guarda DATABASE_URL (Supabase) no Keychain (senha digitada sem eco; --clipboard lê da área de transferência)
NGA_NEW_PASSWORD='...' bun scripts/create-user.ts victor admin   # também: operator, auditor, viewer
scripts/start.sh                    # LEITURA (não grava no Astrea)
scripts/start.sh producao           # PRODUÇÃO (grava só o aprovado + autorizado; teto 25 criações por execução)
scripts/stop.sh
scripts/run.sh producao             # EM PRIMEIRO PLANO no terminal do app (reinicia sozinho se cair; recomendado: processos iniciados em segundo plano por ferramentas podem morrer)
NGA_NEW_PASSWORD='...' bun scripts/set-password.ts victor   # troca a senha de um usuário (mín. 12 caracteres)
```
Interface: http://127.0.0.1:8787. Credenciais do Astrea: botão **Acesso Astrea** (admin), salvas cifradas (AES-256-GCM, chave no Keychain, arquivo `.nga-vault.json`).
Demo sem Astrea: `bun run demo` (dados fictícios + simulador).
Testes: `bun test` (132) · tipos: `bunx tsc --noEmit` · interface: `cd web && bunx vite build`.

## 3. Operação diária (produção)
Play → clicar na publicação → conferir prazo/vencimento/texto → **Aprovar** → **Autorizar escrita (2 h)** → **Gravar no Astrea** (1–2 min; **não clicar duas vezes**) → conferir em **Lançamentos do robô** (botão "Abrir no Astrea") → Controladoria: **Auditoria feita**.
- "Ensaio no Astrea (não grava)" preenche o formulário, confere a data calculada pelo Astrea e cancela.
- Registros duplicados (mesmo processo + `comunicacao_id`) viram um só.
- Exportações CSV: Registros e Auditoria (barra superior; só quem tem permissão de auditoria).

## 4. Regras de negócio decididas com o usuário
- Prazo sem modalidade explícita no texto = **dias corridos**. Ciência de acórdão ("Divulgamos o acórdão"): **15 dias corridos**, sempre análise humana.
- Dias corridos vencendo em dia não útil → **antecipa para o dia útil anterior** (nunca prorroga). O robô informa ao Astrea a quantidade de dias que faz o próprio Astrea calcular a data antecipada; a trava de divergência continua valendo.
- Prazo dirigido a **terceiro** (Administrador Judicial, Recuperanda, MP) → análise humana, **não agenda** (exceção só por publicação, explícita, auditada).
- Renúncia/exclusão de patrono (art. 112 CPC) sem prazo e aviso de distribuição → "sem providência".
- Alerta: 7 dias. Kanban: FLUXO NGA / A Fazer. **Concluir: o robô nunca clica.** Responsável: o do processo no Astrea.
- Feriados: `config/holidays.json` tem os nacionais de 2026; `verifiedBy` = null ⇒ todo prazo é sinalizado "feriados não verificados" e exige análise humana (a Controladoria deve validar a lista, incluir feriados locais/suspensões, e preencher `verifiedBy`).

## 5. Segurança
Sem segredos no repositório (`.env`, `.nga-vault.json`, `.astrea-profile/` ignorados; `DATABASE_URL` no Keychain). Login por scrypt + JWT (cookie HttpOnly, SameSite=Strict, cabeçalho CSRF), RBAC (viewer/operator/auditor/admin), bloqueio de 5 tentativas/15 min por usuário+IP, auditoria hash-chained com triggers no PostgreSQL contra UPDATE/DELETE, mascaramento de dados sensíveis em logs, execução única por vez, expiração de sessão tratada, **nunca contorna CAPTCHA/MFA** (para e pede ação humana), guard de rede que bloqueia escritas ao host do Astrea fora da janela de gravação controlada (≤6 requisições), TLS verificado com o banco. Detalhes: `docs/SECURITY.md`.

## 6. Mapa do código
- `src/domain/` — `classifier.ts` (regras), `deadline.ts` (CPC arts. 219/220/224 + regra do escritório), `states.ts` (máquina de estados), `types.ts`.
- `src/astrea/` — `port.ts` (contrato), `simulated.ts` (simulador + falhas), `live.ts` (Astrea real: leitura, ensaio, criação, exclusão de teste, janela de escrita, navegador preso), `parse.ts`, `auto-login.ts`, `selectors.ts`+`config/selectors.json`, `recon.ts`, `live-session.ts`.
- `src/runner/` — `runner.ts` (Play, escopo, progresso), `workflow.ts` (aprovar/lote/rejeitar/comentar/auditar/autorizações).
- `src/writer/` — `writer.ts` (escrita idempotente, releitura, anti-duplicata, tetos), `corrections.ts`, `format.ts` (título/observações).
- `src/security/` — `auth.ts`, `rbac.ts`, `mask.ts`, `vault.ts`.
- `src/store/` — `repo.ts` (interface), `memory.ts`, `postgres.ts`, `connect.ts` (Keychain + TLS), `models.ts`; `migrations/001_init.sql`.
- `src/audit/chain.ts` — cadeia de hash. `src/server/` — `app.ts` (API), `main.ts` (modos), `services.ts`, `view.ts`.
- `web/` — interface React (identidade NGA, Play, progresso, resultados, lançamentos, gaveta de detalhes, cofre).
- `scripts/` — start/stop, set-db-url, create-user, migrate, adopt-existing, recon, live-login, live-check, live-cleanup-test, demo-cli.
- `tests/` — 132 testes (domínio, fluxo, API, segurança, cofre, auto-login, live contra página-fixture, PostgreSQL embutido).
- `docs/` — ARCHITECTURE, STATES, SECURITY, RECON-PLAYBOOK, ASTREA-MAP (mapa real do Astrea), LIMITATIONS, PLANO-ESCRITA-REAL, este arquivo.

## 7. Infraestrutura
Supabase: projeto `nga-prazos` (sa-east-1), Data API desligada, conexão direta (Session pooler), CA em `config/supabase-ca.pem`. Os outros projetos Supabase da conta são de outros sistemas. Usuários criados: `victor` (admin), `operador`, `controladoria` (auditor) — **troque as senhas temporárias** recriando os usuários com `create-user.ts` (ou peça uma tela de troca de senha).

## 8. O que já foi feito no Astrea real
Reconhecimento completo; leitura de publicações; teste real de criação e exclusão de prazo ("[TESTE NGA PRAZOS]"); **piloto**: prazo real na publicação 359780999 (processo 0001517-42.2015.8.16.0083), vencimento 30/10/2026, Victor Fortes, FLUXO NGA / A Fazer — registrado em "Lançamentos". Não regravar (a 359781085 é o mesmo comunicado).

## 9. Problemas conhecidos / pendências
- Astrea fica lento às vezes: leitura pode dar timeout em uma publicação (ignorada, registrada; apertar Play de novo). Se o navegador interno travar, o app o reinicia uma vez sozinho.
- Se uma gravação travar em "Gravando…" (`write_queued`), **não repetir**: conferir no Astrea e, se o prazo existir, usar `scripts/adopt-existing.ts`.
- O app é um processo no Mac: se o Mac reiniciar, rodar `scripts/start.sh producao` de novo (dá para configurar launchd).
- Troca de senha de usuário e gestão de usuários pela interface não existem (usar `create-user.ts`).
- Escopo "todo o escritório": preparado e desligado (`NGA_ALLOW_ALL_CLIENTS=yes`); exige ajustar o filtro no Astrea e aumentar limites.
- Não implementados: Concluir, edição de prazo já criado fora do ciclo de correção real no Astrea (Etapa 2 não exercitada), cancelamento pela interface.
- Pendências de decisão: usuário "Criado por" (hoje é o do Astrea logado), validação dos feriados, política de retenção do texto das publicações.
- `docs/ASTREA-MAP.md` e `config/selectors.json` descrevem telas reais do Astrea (podem citar nomes/números reais): tratar o pacote como confidencial.

## 10. Solução de problemas
- **"Muitas tentativas"** no login: aguardar 15 min ou reiniciar o app.
- **Não abre 127.0.0.1:8787**: o app não está rodando → `scripts/start.sh producao`.
- **Play falha com timeout em "Conexão com o Astrea"**: Astrea lento/fora; tentar de novo. Login automático falhou: reconfigurar em "Acesso Astrea" (o robô não repete por 10 min para não bloquear a conta).
- **"A DATA DIVERGE da calculadora do Astrea"**: o robô aborta de propósito; conferir feriados/regra e o prazo no Astrea.
- **Lista do Play com poucas publicações**: há filtro salvo no Astrea (status/responsável/caso); o Play avisa quando há filtro por caso.

## 11. Mudanças de 28/10/2026
- Responsável no formulário do Astrea: `fill` em vez de digitar tecla a tecla (o campo perdia caracteres e a gravação falhava por timeout).
- Guarda: nunca grava em publicação que não esteja "NÃO TRATADA" (a Controladoria trata/descarta no Astrea em paralelo).
- Conciliação no Play: registros pendentes cuja publicação saiu das "Não tratadas" são encerrados automaticamente.
- Gravação mais rápida: sem passar pela lista antes de abrir a publicação; anti-duplicata pelo histórico do robô (banco) em vez de ler a agenda.
- Concluir a publicação ao final da gravação confirmada.

## 12. Interface simplificada e prazo padrão (28/10/2026)
- Tela inicial em 3 passos: 1 Buscar publicações · 2 Decidir · 3 Lançar no Astrea, com contagem de cada etapa.
- Filas com nomes claros: Aguardando decisão · Aprovadas — lançar no Astrea · Já lançadas · Sem prazo · Encerradas (abre sozinha na fila que pede ação).
- Gaveta guiada "O que fazer": sugestão em português, alertas, caixa "Conferi os alertas", Aprovar/Rejeitar e "Lançar no Astrea" (autoriza e grava em um clique para administradores).
- Regra do escritório: publicação sem prazo próprio (texto sem prazo, ou só prazo de terceiro) ganha **prazo padrão de 5 dias corridos** (CPC art. 218 §3º), sempre com alerta e aprovação humana. Botão "Agendar prazo padrão de 5 dias" para registros já capturados. Informativas (juntada, distribuição, renúncia) não ganham prazo.

## 13. Edição antes do lançamento (28/10/2026)
- Na gaveta "O que fazer": botão **Editar prazo e texto antes de lançar** — título, quantidade de dias, tipo (corridos/úteis) e texto das Observações. O vencimento é recalculado pelo motor de prazos (corridos que caem em dia não útil são antecipados).
- O que a pessoa digita vai **exatamente** para o Astrea e é o que a releitura confere. Editar depois de aprovar devolve a publicação para decisão (nova aprovação). Tudo auditado (`record.edited`, com antes/depois). API: `PUT /api/records/:id/edit`.
- Conexão com o banco mais resistente (descarta ociosas, repete falhas transitórias) e sessão de login fixa entre reinícios (chave no Keychain `nga-prazos-jwt`).

## 14. Dispensar publicações (28/10/2026)
- Para publicações que não precisam de lançamento (ex.: o prazo já existe no Astrea): botão **Dispensar esta publicação** na gaveta e **Dispensar as selecionadas** (lote, com caixas de seleção nas filas de ação). Motivo obrigatório (Já existe prazo no Astrea · Não precisa de prazo · Tratada fora do sistema); sai das pendentes e vai para "Encerradas"; fica na auditoria. API: `POST /api/records/batch/reject`.

## 15. Padrão visual NGA Lab e filtro de dia (28/10/2026)
- Interface refeita no padrão do NGA Lab (`NGA_Lab.HTML exportado.html`): fundo escuro com grade, âmbar `#F0A32E`/ciano/verde, Barlow Condensed (títulos) + Barlow (texto) + JetBrains Mono (rótulos "01 // …"), cartões de vidro com brilho que segue o mouse, pílulas de status com ponto pulsante. Tema em `web/src/styles.css`; fontes carregadas do Google Fonts em `web/index.html`.
- **Filtro de dia** (dia da publicação/disponibilização) em cada fila: "Todos os dias", chips com os dias que existem na fila (Hoje/Ontem/dia da semana) e seletor de data. Os contadores dos passos e das abas respeitam o dia escolhido.

## 16. Tarefas de acompanhamento (28/10/2026)
Depois de gravar e conferir o prazo, o robô cria, pela tela da publicação (Tratamentos > Adicionar tarefa), duas tarefas (espelham os workflows "PRAZO N DIAS CORRIDOS" do Astrea):
1. **Analisar Intimação + Verificar Providências** — no **dia útil seguinte ao agendamento** (agendou hoje ⇒ amanhã; sexta ⇒ segunda), responsável = o do prazo.
2. **Conferir Protocolo / Renúncia** — no **dia útil seguinte ao vencimento (fatal)**, responsável = Camilla Rodrigues (`NGA_PROTOCOL_RESPONSIBLE`).
Prioridade como nos workflows: prazos de 5 e 15 dias = Média; 10 e 30 = Baixa; outros = Média. Mesmo quadro/coluna Kanban do prazo (FLUXO NGA / A Fazer), lista "Tarefas diárias".
- Idempotente: cada tarefa tem chave própria e é adotada se já existir na publicação. Aparecem em "Lançamentos do robô" com a etiqueta TAREFA.
- Se faltar alguma tarefa, o prazo continua confirmado, mas a publicação **não é concluída** (continua visível) e a tela avisa. `NGA_FOLLOWUP_TASKS=no` desliga.
- Ordem: prazo → releitura → tarefas → conclusão da publicação. Seletores em `config/selectors.json` (`task*`), observados no Astrea real e testados na página fictícia.

## 17. Workflow no próprio prazo (30/10/2026) — substitui a criação avulsa de tarefas
- Depois de gravar e conferir o prazo, o robô abre o prazo (publicação > cartão do prazo > Acessar detalhes > **Adicionar workflows**) e aplica **PRAZO N DIAS CORRIDOS** (N = menor de 5/10/15/30 que cubra os dias do prazo; acima de 30, o de 30). O workflow cria no Astrea: *Analisar Intimação + Verificar Providências* (+1 dia útil da criação, responsável pela atividade) e *Conferir Protocolo / Renúncia* (Camilla), com as datas e prioridades definidas no próprio workflow.
- Idempotente (se o prazo já tem as atividades, não aplica de novo), confirmado lendo as atividades do prazo, janela de escrita curta. Se não confirmar, a publicação **não é concluída**.
- `NGA_FOLLOWUP_MODE`: `workflow` (padrão) · `tasks` (cria as 2 tarefas avulsas, como na seção 16) · `no`.
- Seletores do Astrea usados: `data-test="component-clippingTreatment-eventCard"`, `component-predefinedActivity-card`, `component-formSubmitButton-discard`.

## 18. Serviço automático no macOS (30/10/2026)
- `scripts/service-install.sh` instala o NGA Prazos como serviço do launchd (`br.adv.nga.prazos`): **sobe ao entrar no Mac e reinicia sozinho se cair** (testado derrubando o processo). Usa `caffeinate -i` para o Mac não dormir por inatividade (com a tampa fechada, ele ainda dorme).
- O serviço roda de uma **cópia em `~/NGA/prazos`** (o macOS impede serviços de ler Desktop/Documentos). **Depois de qualquer alteração no código, rode `scripts/service-install.sh` de novo** (sincroniza e reinicia). Log: `~/Library/Logs/nga-prazos.log`.
- `scripts/service-status.sh` mostra estado/saúde/log; `scripts/service-uninstall.sh` remove.
- Próximo passo planejado: levar para um servidor na nuvem (o Lovable não roda Chromium/Playwright; usar container com disco persistente para o perfil do Astrea).
