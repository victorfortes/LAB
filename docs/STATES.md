# Especificação de estados

Fonte da verdade: `src/domain/states.ts` (testada em `tests/domain.test.ts`). Transição fora da tabela ⇒ `409`.

## Registro (publicação)

| De | Evento | Para | Quem |
|---|---|---|---|
| *(captura)* | classificação | `classified` / `needs_review` / `no_action` | robô |
| `classified`, `no_action` | `approve` | `approved` | operator/auditor/admin (lote permitido) |
| `needs_review` | `approve` (+ confirmação dos alertas) | `approved` | individual, nunca em lote |
| `classified`/`needs_review`/`no_action`/`approved` | `reject` (+motivo) | `rejected` | operator/auditor/admin |
| `rejected` | `reopen` | `needs_review` | — |
| `approved`, `divergent`, `write_failed` | `queue_write` | `write_queued` | admin + autorização ativa |
| `write_queued` | `verify_ok` | `confirmed` | **somente após releitura conferida** |
| `write_queued` | `verify_mismatch` | `divergent` | robô |
| `write_queued` | `write_error` | `write_failed` | robô |
| `confirmed`, `divergent`, `revalidation_pending`, `audited` | `request_correction` | `correction_requested` | operator/auditor/admin |
| `correction_requested` | `authorize_correction` | `correction_authorized` | auditor/admin |
| `correction_authorized` | `correction_applied` | `revalidation_pending` | admin (releitura ok) |
| `correction_authorized` | `correction_failed` | `divergent` | robô |
| `no_action`, `approved`, `confirmed`, `revalidation_pending` | `mark_audited` | `audited` | auditor/admin ("Auditoria feita") |

```
classified ─approve─▶ approved ─queue_write─▶ write_queued ─verify_ok─▶ confirmed ─audited─▶ audited
needs_review ┘            │                        ├─verify_mismatch─▶ divergent ─┐
no_action ───────────────┘                        └─write_error────▶ write_failed │
confirmed/audited ─request_correction─▶ correction_requested ─authorize─▶ correction_authorized
      ─applied─▶ revalidation_pending ─mark_audited─▶ audited      ─failed─▶ divergent
```

## Execução (run)

`running` → `completed` | `failed` | `awaiting_login` (sessão expirada; `resume` ⇒ `running`) | `abandoned` (sem heartbeat).
Somente **uma** execução em `running`/`awaiting_login` por vez (índice único parcial no banco).

## Operação de escrita (`write_ops`)

`pending` → `confirmed` | `divergent` | `failed`. Chave única; `confirmed` é terminal e torna novas tentativas no-op.

## Correção

`requested` → `authorized` → `applied` | `failed`.

## Notas sobre classificação (não são estados)
- Ação com `notOurs` (prazo dirigido a terceiro) **nunca** é gravada: o `Writer` a ignora e, se for a única, recusa (`nothing_to_write`).
- Duplicata de comunicado (processo + `comunicacao_id`) não cria registro: vira comentário do registro original e `record.duplicate_communication` na auditoria.
- Ensaio no Astrea (`dryrun.executed` na auditoria) não altera o estado do registro.
