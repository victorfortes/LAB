# 04 · Banco de dados (Supabase / PostgreSQL)

Migração: `supabase/migrations/20261011000001_base.sql`. Testada em PostgreSQL real (PGlite) por `tests/db/`.

## Tabelas
| Tabela | Finalidade | Observações |
|---|---|---|
| `perfis` | Usuário do escritório: `user_id` (→ `auth.users`), `email`, `nome`, `papel` (`admin`/`advogado`/`visualizador`), `ativo`, `ultimo_acesso` | E-mail único (sem diferenciar maiúsculas). Sempre resta ao menos um administrador ativo (gatilho). |
| `documentos` | **Contrato do gerador**: `(colecao, id)` + `dados jsonb`, `removido`, `criado_em/por`, `atualizado_em/por` | Coleções válidas: `clientes, regras, relatorios, emissoes, pdfs, modelos, projetos, negociacoes, marcos`. Limite de 256 KiB por documento. `atualizado_em` é sempre do servidor (cursor de sincronização). |
| `documentos_versoes` | Estado **anterior** de cada alteração de cadastro (clientes, regras, relatórios, modelos, projetos) | Ninguém altera ou apaga por API. Nada é sobrescrito em silêncio. |
| `auditoria` | Quem fez o quê e quando (`criar/alterar/excluir/restaurar`, `usuario_*`, `acesso`) | **Sem conteúdo** de relatório, só ids e metadados mínimos. Só administrador lê. |

Mapeamento com a lista do pedido: *Usuários* = `auth.users` + `perfis`; *Relatórios/Versões* = `documentos` (`emissoes`, `relatorios`, `projetos`, `modelos`) + `documentos_versoes`; *Arquivos* = `documentos` (`pdfs`, em pedaços); *Permissões* = `perfis.papel` + RLS; *Auditoria* = `auditoria`.

## Políticas RLS (todas as tabelas com RLS **forçado**; `anon` sem nenhum privilégio)
| Tabela | Ler | Inserir | Alterar | Excluir |
|---|---|---|---|---|
| `perfis` | o próprio; admin lê todos | admin | admin (**nunca o próprio perfil**) | admin (nunca o próprio) |
| `documentos` | qualquer perfil **ativo** | admin, advogado | admin, advogado | **só admin** (físico) |
| `documentos_versoes` | admin, advogado | ninguém (gatilho) | ninguém | ninguém |
| `auditoria` | só admin | ninguém (gatilho/RPC) | ninguém | ninguém |

Regras extras em gatilho (valem mesmo com chave de serviço mal usada na interface):
- Exclusão **lógica** (`removido = true`) de `clientes`, `modelos`, `emissoes` e `pdfs` **só por administrador** (mesma matriz do original).
- `criado_em/criado_por` imutáveis; `atualizado_em/atualizado_por` forçados pelo servidor.
- Perfis inativos ou sem perfil: `papel_atual()` é nulo, então não leem nem gravam nada.

## Retenção
- Versões e auditoria: sem expiração automática (volume baixo). Política sugerida: manter 5 anos (sigilo/ônus de prova) e revisar anualmente. Procedimento de poda em `10_MANUTENCAO.md`.
- PDFs emitidos: permanecem até exclusão por administrador.

## Primeiro administrador
`supabase/seed_primeiro_admin.sql` (rodar uma vez no SQL Editor, depois de criar o usuário em Authentication). Nenhuma credencial administrativa no código.
