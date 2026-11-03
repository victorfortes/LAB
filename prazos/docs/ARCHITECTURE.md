# Arquitetura

```
 React UI ──HTTP/JSON──▶ Express API (auth, RBAC, CSRF)
                              │
        ┌─────────────────────┼───────────────────────────┐
        ▼                     ▼                           ▼
     Runner              Workflow                  Writer / Corrections
 (captura→classifica)  (aprova, comenta,          (escrita idempotente,
  SOMENTE LEITURA       audita, autoriza)          read-after-write, correção)
        │                     │                           │
        └───────────┬─────────┴──────────────┬────────────┘
                    ▼                        ▼
               Repo (interface)         AstreaPort (interface)
          MemoryRepo │ PgRepo        SimulatedAstrea │ LiveAstrea (Playwright)
```

## Decisões

- **Porta `AstreaPort`** separa leitura (`AstreaReader`) de escrita (`AstreaWriter`). O `Runner` recebe o port
  embrulhado em `readOnly()`: mesmo por bug, o executor não consegue escrever (`ReadOnlyViolation`).
- **Simulador × real**: `SimulatedAstrea` (fictício, com injeção de falhas: sessão expirada, divergência,
  resultado desconhecido) é o único adaptador funcional. `LiveAstrea` só opera com `config/selectors.json`
  preenchido **com evidência do reconhecimento**; vazio ⇒ `NotMappedError`.
- **Classificador** (`src/domain/classifier.ts`): regras determinísticas e auditáveis; cada providência traz
  `evidence[]` (trecho + offsets + regra). Cálculo de prazo em `deadline.ts` (CPC arts. 219, 220, 224).
  Qualquer ambiguidade ⇒ `needs_review` (aprovação individual com confirmação dos alertas). Um classificador
  baseado em LLM poderia ser plugado depois, mas **sempre** sob a mesma exigência de evidência + revisão humana.
- **Persistência**: PostgreSQL com colunas indexadas + `jsonb`. Garantias no banco: execução ativa única
  (índice parcial), `external_id` único, `write_ops.key` único (idempotência), `audit_log` imutável (triggers).
- **Auditoria**: cadeia de hashes SHA-256 (`prev_hash`) sobre dados já mascarados; `verifyAudit()` detecta
  adulteração/remoção.
- **Concorrência**: lock de execução por índice único + heartbeat (execução sem heartbeat vira `abandoned`);
  controle otimista de versão em registros; `claimWriteOp` atômico para escrita.
- **Sessão do Astrea**: `SessionExpiredError` pausa a execução em `awaiting_login`; o usuário autentica
  manualmente e clica em *Retomar*. O robô **nunca** automatiza login, MFA ou CAPTCHA.

## Fluxo de escrita (Fase 4)

1. Pré-condições: `NGA_WRITE_ENABLED`, perfil `admin`, registro `approved` por humano, processo na lista autorizada,
   autorização de escrita ativa (escopo de processos, ≤ 7 dias, revogável), responsável definido.
2. Chave de idempotência = hash(processo, publicação, providência, vencimento, descrição); marcador `[NGA:<chave>]`
   embutido na descrição do agendamento (⚠ a viabilidade desse marcador no Astrea real é uma hipótese a validar no reconhecimento).
3. `claimWriteOp` → pré-leitura (procura marcador) → cria se ausente → em erro, **reconcilia** (procura de novo) →
   `readSchedule` → compara campos → `confirmed` | `divergent` | `failed`.
4. O registro só vira `confirmed` se **todas** as providências forem relidas e conferirem. Nunca há mensagem de sucesso sem isso.

## Correções (Fase 5)

Pedido = `{actionId, campo ∈ {dueDate,title,responsible,description}, valor esperado, justificativa}` + autorização
(perfil `auditor`/`admin`). `apply` edita **somente** o agendamento vinculado (`write_ops.astrea_id`) e **somente**
aquele campo; relê; se outro campo mudou ou o valor lido diverge ⇒ `failed`/`divergent`. Sucesso ⇒ `revalidation_pending`.
