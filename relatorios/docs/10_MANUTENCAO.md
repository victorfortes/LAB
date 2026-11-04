# 10 · Manutenção, backup, restauração e recuperação

## Atualizar o sistema
1. Alterar código em ramo próprio → *pull request* → CI (`.github/workflows/ci.yml`) roda banco + interface.
2. Mudou o **gerador original**? Não edite `original/`. Para uma nova versão do Artifact: salve como novo arquivo em `original/` (com `SHA256SUMS`), atualize `scripts/build.py` e **rode a equivalência** (`tests/e2e/equivalencia.spec.mjs`) comparando com a versão anterior.
3. Mudança de banco = **nova migração** em `supabase/migrations/` (nunca editar uma já aplicada). Teste com `npm run test:db` e aplique com `supabase db push`.
4. Publicação: *merge* em `main` → Cloudflare Pages publica sozinho. **Rollback:** no painel do Pages, *Deployments > Rollback* (instantâneo), ou `git revert` + push.

## Backup
Frequência recomendada: **diária** (plano gratuito não tem backup automático).
```bash
export SUPABASE_URL=… SUPABASE_ANON_KEY=… BACKUP_EMAIL=conta-admin-de-backup@… BACKUP_PASSWORD=… BACKUP_PASSPHRASE='frase longa (16+)'
node scripts/backup.mjs /caminho/seguro/backups
```
- Use uma **conta de administrador dedicada** ao backup; a frase cifra o arquivo (AES-256-GCM): sem ela o backup não abre. Guarde-a no cofre, **separada** do arquivo.
- Agendar (cron/Agendador de Tarefas numa máquina do escritório). Guardar cópias em dois lugares (ex.: disco do escritório + armazenamento institucional cifrado). Manter 30 dias + 1 mensal por 12 meses.
- O backup contém `documentos` (incluindo PDFs), versões, auditoria e perfis.
- Backup manual adicional: *Clientes > Exportar backup* (no próprio gerador).

## Restauração (testada em `tests/db/backup.test.mjs`)
1. Criar projeto Supabase novo; aplicar as migrações (`supabase db push`); criar o primeiro admin (`seed_primeiro_admin.sql`).
2. `BACKUP_PASSPHRASE='…' node scripts/restaurar.mjs backups/nga-AAAAMMDDHH.json.enc > restaurar.sql`
3. Rodar `restaurar.sql` no SQL Editor. O script desliga os gatilhos só durante a carga (preserva datas e exclusões lógicas) e os religa; é idempotente (`on conflict`).
4. Reconvidar os usuários (contas de `auth.users` não fazem parte do backup lógico); vínculos de autoria de quem não existir ficam em branco.
5. Apontar `SUPABASE_URL/ANON_KEY` do Pages para o novo projeto e republicar.
Tempo esperado: < 30 min para milhares de documentos.

## Rotinas
| Quando | O quê |
|---|---|
| Semanal | Acessar o sistema (evita **pausa por inatividade** do plano gratuito); conferir último backup |
| Trimestral | Revisar usuários ativos (Administração); testar restauração em projeto de teste |
| Anual | Revisar retenção (versões e auditoria); girar a frase de backup; atualizar dependências (`npm audit`, supabase-js) |
| Ao desligar alguém | Desativar o usuário em Administração (efeito imediato: o banco recusa tudo) |

## Problemas comuns
- *"Acesso não autorizado"* após login → usuário sem perfil: admin deve convidar/criar o perfil.
- *"Configuração pendente"* → faltam `SUPABASE_URL`/`SUPABASE_ANON_KEY` na build.
- Gerador em branco no iframe → conferir CSP (`dist/_headers`) e console.
- PDF que "ficou só no computador de quem gerou" → falhou o envio ao banco; reabrir o relatório na máquina de origem e reemitir.
- Projeto pausado (plano gratuito) → *Restore project* no painel do Supabase; os dados são mantidos por tempo limitado (confira o prazo oficial).
