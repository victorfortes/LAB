# Trabalho em dupla: dois Claude Code no NGA Nexus

Dois Claude Code trabalham ao mesmo tempo no repositório `victorfortes/LAB`,
cada um na sua pasta e no seu ramo, sem pisar no arquivo do outro. O GitHub é o
ponto de encontro. Este arquivo é a fonte da verdade da divisão: quem muda a
divisão muda aqui, no mesmo commit.

## Ramos e pastas

| Quem | Pasta no Mac | Ramo | Papel |
|---|---|---|---|
| Claude A (integrador) | `~/Desktop/Tecnologias Jurídicas/LAB` | `nexus/frente-a` | Portal, escritório, telas; junta as frentes |
| Claude B | `~/Desktop/Tecnologias Jurídicas/LAB-frente-b` (git worktree) | `nexus/frente-b` | Dados contábeis e financeiros: diagnóstico, QGC, ERP do cliente |

- `main` é o que está publicado (Lovable + função Edge). Ninguém comita direto em `main`.
- `nexus/integracao` é onde as duas frentes se encontram. Partiu do commit que
  guardou a rodada de 09 e 10/11.
- Cada frente abre PR do seu ramo para `nexus/integracao`. O Claude A revisa e
  junta; o Victor aprova a ida de `nexus/integracao` para `main` e o deploy.
- A pasta `NGA Nexus` é um clone antigo: não usar.

## Quem é dono de quê

Arquivo com dono só é editado pelo dono. Se o outro precisar de algo ali, pede
pelo PR ou pelo bloco "Pedidos" no fim deste arquivo.

**Frente A**
- Identidade NGA Nexus em tudo (`web/css/lab.css`, `ui/tokens`, textos, README).
- Portal do cliente: `web/js/views/portal.js`, `src/server/portal.ts`, `src/server/faturas.ts`
  (tag do portal, vários documentos por requisito, faturas, plano só para RJ,
  sem mensagens, link do WhatsApp, próxima parcela de honorários).
- Escritório: `src/security/rbac.ts`, visibilidade por equipe (RLS), `calendario.js`,
  `google.ts`, `clientes.js`, `projetos.js`, `equipe.ts`, importação de responsáveis.
- Projeto: `projeto.js`, `projeto_visao_cards.js`, `projeto_pesquisa.js`,
  `projeto_negociacoes.js` (PMT acima do kanban), `projeto_atas.js`, `relatorios.js`.

**Frente B**
- Diagnóstico: `src/domain/diagnostico/**`, `src/server/diagnostico*.ts`,
  `web/js/views/projeto_diagnostico.js`, `projeto_diag_relatorio.js`, `projeto_raiox.js`.
- QGC: `web/js/views/projeto_creditos.js`, leitura de balancete para QGC
  preliminar, QGC automático x validado, popup de novo crédito.
- ERP financeiro do cliente: `src/domain/financeiro/**`, `web/js/views/projeto_financeiro.js`
  e uma tela nova `web/js/views/portal_financeiro.js` (o Claude A só pluga a aba no portal).

**Compartilhados (cuidado)**
- `src/server/app.ts`: cada frente registra suas rotas num arquivo próprio
  (`rotas_frente_a.ts`, `rotas_frente_b.ts`) e toca `app.ts` só para importar.
- Migrações: números reservados. A usa 047 a 059 (já usadas: 047, 048, 049); B usa 060 a 079. Nunca renumerar
  migração já juntada.
- `scripts/demo.ts`, `web/js/main.js`, `web/js/shell.js`: mudança mínima, uma linha por vez.

## Rotina de cada Claude

1. Ao começar: `git fetch` e `git rebase origin/nexus/integracao` no seu ramo.
2. Trabalhar só nos seus arquivos. Commits pequenos, mensagem em português.
3. Antes de cada push: `bun run typecheck` e `bun test` verdes.
4. Push do seu ramo e PR para `nexus/integracao`, com o que mudou e o que não foi testado.
5. Atualizar a tabela de status abaixo no mesmo PR.
6. Nada de deploy, `supabase db push` ou publicação no Lovable sem ordem do Victor.

## Status

| Item | Frente | Situação |
|---|---|---|
| Rebrand NGA Nexus | A | feito (frente-a) |
| Portal: tag, multi-documento, faturas, plano RJ, WhatsApp, próxima parcela | A | feito (frente-a), migração 047 |
| Visibilidade por equipe e coordenação | A | feito (frente-a), migração 048 |
| Calendário: convites, filtros, conta ngaa@ | A | convites e filtros feitos (migração 049); conta ngaa@ depende do Victor conectar |
| Clientes e Projetos: filtros e busca | A | feito (frente-a) |
| Responsáveis da planilha e usuários | A | planilha lida; aguardando e-mail e papel de cada pessoa |
| Visão do projeto, negociações, relatórios, atas | A | feito (frente-a) |
| Diagnóstico automático e PDF | B | base versionada feita em 10/11; leitura de PDF e PDF final pendentes |
| QGC preliminar do balancete, automático x validado | B | pendente |
| ERP financeiro do cliente | B | pendente |

## Pedidos entre frentes

- A → B: a 048 põe trava de equipe em toda tabela com `projeto_id` criada até ela. Tabela nova da Frente B com `projeto_id` precisa da mesma política (`<tabela>_equipe_restrita`, ver 048).
- A → B: testes que montam projeto direto no banco recebem equipe automática (`tests/apoio/postgres.ts`); para testar visibilidade use `bancoDeTeste({ equipeAutomatica: false })`.
- A fez na B, só troca de marca: `src/server/diagnostico_html.ts` e `src/domain/diagnostico/relatorio.ts` (NGA LAB → NGA Nexus).
