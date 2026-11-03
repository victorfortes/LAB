# NGA Prazos

Plataforma de automação de **agendamento e auditoria de prazos processuais**, integrada operacionalmente ao Astrea.
Stack: TypeScript (Bun) · React (Vite) · Playwright · PostgreSQL.

> **Estado honesto do projeto** — leia [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).
> O fluxo de **leitura** do Astrea real foi mapeado (ver [`docs/ASTREA-MAP.md`](docs/ASTREA-MAP.md)) e o adaptador
> `LiveAstrea` lê publicações não tratadas (lista + detalhe + sugestões do Astrea) e prazos de um processo (`findSchedules`/`readSchedule`) em **modo somente leitura**
> (requisições não-GET são abortadas). Testado contra uma página-fixture fictícia; a verificação em conta real exige
> `bun run live:login` + `bun run live:check`. **Criação/edição de agendamentos no Astrea real continuam
> NÃO implementadas** (`NotMappedError`) — o simulador cobre as Fases 4 e 5.

## Demonstração em 1 comando (modo simulado, dados fictícios)

```bash
bun install
bun run demo          # build da UI + servidor em http://127.0.0.1:8787
```

O terminal imprime usuários/senhas **efêmeros** (`admin`, `operador`, `auditor`). Clique em ▶, abra um registro,
aprove, "Autorizar escrita (2h)", "Gravar no Astrea" (simulador) e depois "Solicitar correção".
Versão sem interface: `bun run demo:cli`.

## Scripts

| Comando | Função |
|---|---|
| `bun run demo` / `bun run dev` | App em modo simulado (memória, dados fictícios) |
| `bun test` | 58 testes (domínio, segurança, fluxo, API, PostgreSQL real embarcado) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run migrate` | Aplica `migrations/*.sql` em `DATABASE_URL` |
| `bun run create-user <user> <role>` | Cria usuário (senha via `NGA_NEW_PASSWORD`) |
| `bun run live:login` | Login MANUAL no perfil persistente (salva a sessão para o adaptador real) |
| `bun run live:app` | App em modo **live local**: lê o Astrea REAL (somente leitura, escrita desligada, escopo por cliente `NGA_AUTHORIZED_CLIENT_REGEX`, padrão `copel`); usuários efêmeros impressos no terminal |
| `bun run live:app` → "Acesso Astrea" | **Login automático:** salve e-mail/senha do Astrea (criptografados) no próprio app; ao apertar **Play** o app entra sozinho (MFA/CAPTCHA nunca são contornados) |
| Exportar (botões no topo) | **Controladoria:** CSV de registros e da trilha de auditoria (sem texto integral; com verificação da cadeia de hash) |
| `bun run live:cleanup-test <pubId> "<título>"` | **Etapa 3**: exclui UM prazo de TESTE criado pelo robô (espera o login manual na janela) |
| `bun run live:check [N]` | Lê N publicações do Astrea real (somente leitura, saída mascarada) |
| `bun run recon` | **Fase 1**: reconhecimento somente leitura do Astrea (ver playbook) |
| `bun run start` | Servidor com `.env` (PostgreSQL; `NGA_MODE=live` exige reconhecimento prévio) |

Configuração: copie `.env.example` → `.env` (nunca versionar). `JWT_SECRET` ≥ 32 bytes é obrigatório.

## Fases

| Fase | Entrega | Situação |
|---|---|---|
| 1 | Projeto, arquitetura, docs, testes, executor somente leitura, ferramenta de reconhecimento | ✅ ferramenta pronta · ⏳ **mapeamento real depende de você** ([playbook](docs/RECON-PLAYBOOK.md)) |
| 2 | Captura, normalização, classificação (regras explicáveis, evidências, ambiguidades) | ✅ (contra simulador) |
| 3 | Interface web: Play, progresso, resultados, auditoria, aprovação individual/lote, comentários, "Auditoria feita" | ✅ |
| 4 | Escrita idempotente + leitura após gravação + reconciliação | ✅ no simulador · ⛔ real bloqueado (não mapeado) |
| 5 | Ciclo de correção autorizado por campo/registro | ✅ no simulador · ⛔ real bloqueado |

## Documentos

- [Plano da escrita real](docs/PLANO-ESCRITA-REAL.md) — decisões, o que falta e o teste controlado (nada de escrita real está ativo)

- [Arquitetura](docs/ARCHITECTURE.md) · [Estados](docs/STATES.md) · [Segurança](docs/SECURITY.md)
- [Playbook de reconhecimento do Astrea](docs/RECON-PLAYBOOK.md) · [Mapa do Astrea (pendente)](docs/ASTREA-MAP.md)
- [Relatório de limitações](docs/LIMITATIONS.md)

## Operação no Astrea real (banco permanente + login automático)

| Comando | O que faz |
|---|---|
| `scripts/set-db-url.sh` | Guarda a `DATABASE_URL` (Supabase) no Keychain; a senha é digitada sem eco, ou lida da área de transferência com `--clipboard` |
| `scripts/start.sh` | Sobe em **LEITURA**: lê e classifica, **não grava** nada no Astrea |
| `scripts/start.sh producao` | Sobe em **PRODUÇÃO**: grava no Astrea só o que um humano aprovou **e** autorizou (teto de 25 criações por execução do app) |
| `scripts/stop.sh` | Para o app |
| `NGA_NEW_PASSWORD=… bun scripts/create-user.ts <usuário> <admin\|operator\|auditor\|viewer>` | Cria usuário no banco |
| `bun scripts/adopt-existing.ts <pub do prazo> <processo> <pub do registro>` | Registra no controle um prazo do robô que já existe no Astrea (só leitura) |

- O app lê `DATABASE_URL` do ambiente ou do Keychain (`nga-prazos-db`); o certificado do Supabase está em `config/supabase-ca.pem` (público). Migrações são aplicadas ao subir.
- Escrita em produção exige: aprovação humana individual → autorização de escrita ativa (até 2 h) → clique em "Gravar". Prazo de terceiro nunca é gravado (exceção só por publicação, via `NGA_PILOT_ALLOW_THIRD_PARTY` no piloto). O robô nunca clica em Concluir nem exclui.
- Antes de criar, o robô relê a publicação e a agenda do processo: não duplica prazo já existente (mesmo marcador ou mesmo vencimento do robô no processo).
- Dias corridos que vencem em dia não útil são **antecipados** para o dia útil anterior (regra do escritório).
- A lista lida é a do filtro salvo no Astrea (status "Não tratada", responsável). Se houver filtro por caso/processo ativo, o Play avisa.
- `config/holidays.json` traz os feriados nacionais de 2026; enquanto `verifiedBy` for `null`, todo prazo é sinalizado "feriados não verificados" e exige análise humana. A Controladoria deve conferir a lista (e feriados locais/suspensões) e preencher `verifiedBy`.
- Escopo "todo o escritório": `NGA_ALLOW_ALL_CLIENTS=yes` libera a opção no Play (somente admin). Leitura ampliada não amplia a escrita.
