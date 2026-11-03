# Plano da escrita real no Astrea (Fases 4 e 5 em produção)

**Estado em 2026-10-21:** NADA foi habilitado. O robô só lê o Astrea real. Escrita/edição reais exigem as etapas abaixo,
com você presente e autorizando cada uma. O simulador já cobre o fluxo completo (escrita idempotente, releitura, reconciliação, correção).

## Decisões já tomadas pelo responsável (Victor)

| Tema | Decisão |
|---|---|
| Modalidade do prazo | Sem "úteis/corridos" no texto ⇒ **dias corridos** (`NGA_DEFAULT_DAY_UNIT=dias_corridos`); texto explícito prevalece |
| Ciência de acórdão ("Ciência às partes sobre o acórdão", "Divulgamos o acórdão") | Prazo **presumido de 15 dias corridos**, sempre análise humana |
| Prazo dirigido a terceiro (Administrador Judicial, Recuperanda, MP) | Análise humana, **nunca agendado** (`notOurs`) |
| Renúncia/exclusão de patrono (art. 112 CPC) e avisos de distribuição | "Sem providência" |
| Comunicado duplicado (mesmo processo + `comunicacao_id`) | **Um só registro** |
| Responsável do prazo | Responsável do processo no Astrea |
| Alertas | **7, 3, 2 e 1 dia** antes — ⚠ o formulário observado tem **um** campo de alerta; ver "Pendências" |
| Título | Padrão `Providência — Ato (Classe)` derivado da leitura (`src/writer/format.ts`) |
| CONCLUIR | O robô **pode** concluir a publicação, **somente** depois do prazo `confirmed` por releitura e da aprovação humana; a Controladoria audita na aba de auditoria |
| Quem cria no Astrea | Hoje a Camilla (Controladoria). O robô **não usa a senha dela**: recomenda-se um **usuário próprio do robô** no Astrea (trilha "Criado por" clara) |

> **Resultado (2026-10-24):** **Etapa 1** — 1 prazo de teste gravado e confirmado por releitura na publicação 359781079 (Kanban/alerta conferidos pelo responsável no Astrea).
> **Etapa 3** — o prazo de teste foi excluído pelo robô (`bun run live:cleanup-test`), publicação segue NÃO TRATADA. **Ainda não executadas:** 1b (falha forçada/reconciliação no real),
> 2 (correção/edição no real) e 4 (piloto supervisionado). Ver `docs/LIMITATIONS.md` ("Etapa 1").

## Etapa 1 — modo de teste de escrita real (implementado em 2026-10-22; autorizado pelo responsável)

Comando (exige a confirmação digitada; sem ela o modo live local NUNCA grava):

```bash
NGA_REAL_WRITE_TEST=yes-i-authorize ASTREA_BASE_URL="https://astrea.net.br/" bun run live:app
```

Travas empilhadas (todas precisam passar): confirmação digitada · `NGA_WRITE_ENABLED` (só nesse modo) · perfil `admin` · registro **aprovado por humano** ·
processo na lista (apenas 1001409-24.2022.8.26.0260) · **publicação na lista `NGA_WRITE_ONLY_PUBLICATIONS` (apenas 359137884)** ·
autorização de escrita ativa (≤ 2 h) · prefixo `[TESTE NGA PRAZOS] ` no título · prazo próprio (nunca `notOurs`).
No formulário: a "Data limite" do Astrea tem que ser igual à do robô, e título/observações/responsável/Kanban são conferidos **antes** de salvar; qualquer diferença **aborta e cancela**.
A janela de escrita abre **só no clique em Salvar** (máx. 6 requisições) e registra apenas método + caminho em `observedWrites` (aprendizado do endpoint; depois fixar em `ASTREA_WRITE_ALLOW`).
Releitura: cartão "Tratamentos" da própria publicação (formato do texto a confirmar nesta 1ª gravação; se não casar, **não há sucesso declarado**).
Kanban: `FLUXO NGA` / `A Fazer` · alerta: 7 dias (o formulário só tem 1 campo) · responsável: Victor Fortes · **não clica em Concluir** · não exclui nada.

## Etapa 4 — modo PILOTO (prazo real; implementado em 2026-10-25, NÃO executado)

```bash
NGA_REAL_PILOT=yes-i-authorize NGA_PILOT_PUBLICATION=<id da publicação> NGA_PILOT_PROCESS=<nº do processo> bun run live:app
```
Sem os dois valores o app **não sobe** (não há padrão). Travas: confirmação digitada · escrita só nessa publicação e nesse processo · **teto de 1 criação por execução do app**
(reiniciar para liberar) · sem prefixo de teste · admin · registro aprovado por humano · autorização de escrita ≤ 2 h · data do Astrea = data do robô · campos conferidos antes de salvar.
Padrões: Kanban FLUXO NGA / A Fazer · alerta 7 dias · responsável = o do processo no Astrea · **não conclui** a publicação · **não exclui** (só humano) · login pelo cofre (`Acesso Astrea`) ou manual.
Revisão da Controladoria: aba/registro com "Auditoria feita" no app, **com o app rodando na sua máquina** (a auditoria é em memória; exportar antes de encerrar). Para a Controladoria há **exportação em CSV** (registros e trilha de auditoria) pelos botões do topo; persistência em PostgreSQL com usuários próprios segue pendente.

## O que falta implementar (nada disso está ativo)

1. `LiveAstrea.createSchedule`: abrir `#/main/clippings-treatment?id=<id>` → Tratamentos → Adicionar prazo → preencher título, prazo+modalidade,
   responsável, observações (com `[NGA:chave]`), quadro/coluna → **conferir a "Data limite" do Astrea = a do robô (senão cancelar)** → SALVAR → aguardar "O prazo foi adicionado".
2. Seletor de envio (`addDeadlineSubmit`) em `config/selectors.json` **só depois** do ensaio e da primeira gravação autorizada. Hoje não existe de propósito.
3. Guarda de escrita com lista de permissão do endpoint exato do SALVAR (hoje todo não-GET é abortado). O endpoint é descoberto no 1º teste autorizado.
4. Releitura: card "Tratamentos" da própria publicação (principal) + `findSchedules` pelo processo (cruzada).
5. Pré-checagem de idempotência: ler os prazos já criados na publicação (marcador `[NGA:chave]` nas Observações — **verificado no card da publicação**; no modal de detalhe o rótulo ainda não foi verificado).
6. `CONCLUIR` (opcional, controlado por configuração) após `confirmed`. Nunca clicar em "Confirmar tratamento" da IA do Astrea.
7. Edição (Fase 5): lápis → "Editar prazo" (mesmos campos), releitura, e verificação de que **só** o campo autorizado mudou.

## Teste controlado (etapas)

| Etapa | O que faz | Grava? | Critério de aceite |
|---|---|---|---|
| **0 — Ensaio** | Preenche o formulário, lê a calculadora, lê quadros/colunas do Kanban e **cancela** (botão "Ensaio no Astrea" na interface; `POST /api/records/:id/dry-run`) | **Não** | Data do Astrea = data do robô; formulário cancelado; 0 tentativas de escrita |
| 1 | 1 prazo `[TESTE NGA PRAZOS]` numa publicação da COPEL: aprovar → autorizar escrita (admin, 2 h, 1 processo) → gravar → conferir (card + `findSchedules`) → gravar de novo (**não duplica**) | Sim (1) | `confirmed` só após releitura; 2ª execução = no-op |
| 1b | Falha forçada logo após o clique (resultado desconhecido) | Sim | Reconciliação **adota** o existente, sem duplicar |
| 2 | Ciclo de correção: mudar a data do prazo de teste | Sim (edição) | Só o campo autorizado muda; vai para revalidação |
| 3 | Limpeza: excluir o prazo de teste (com confirmação) | Exclui | Publicação segue "não tratada" (ou conforme decidido), 0 atividades pendentes |
| 4 | Piloto supervisionado: 1 prazo real; depois no máx. 3 por execução com interruptor de parada | Sim | Controladoria valida na aba de auditoria |

**Parada imediata:** divergência de data, falha de releitura, sessão expirada, qualquer tentativa de escrita inesperada.

## Pendências / riscos conhecidos

- **Alertas 7/3/2/1:** o formulário observado só mostra um campo "Alerta". Verificar se há como adicionar mais (o ensaio reporta `multipleAlerts`); senão, usar o maior (7) no prazo e criar lembretes por outra via, a decidir.
- **Kanban:** quadro e coluna padrão dos prazos do robô ainda não definidos (o ensaio lista as colunas do quadro "FLUXO NGA").
- **Calculadora do Astrea:** desconta só feriados nacionais; feriados forenses locais não são conhecidos por nenhum dos dois lados.
- **Sessão do robô:** usar um usuário dedicado; nunca compartilhar credenciais de colaboradores; login sempre manual (MFA/CAPTCHA nunca automatizados).
- **Autoria:** hoje a sessão do navegador é de um usuário do escritório; o campo "Criado por" refletirá quem estiver logado no perfil do Playwright.
