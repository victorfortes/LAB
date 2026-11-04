# 07 · Integração futura com o NGA Nexus

**Estado:** o Nexus (Lovable) **não foi acessado nem alterado**. Este guia descreve contratos e o caminho de integração para quando a arquitetura do Nexus for levantada.
Antes de integrar, é obrigatório: (1) mapear o esquema Supabase do Nexus; (2) decidir **um** projeto Supabase ou dois; (3) rodar tudo primeiro num ambiente de homologação.

## Contratos que já existem
| Contrato | Descrição |
|---|---|
| `NGA_SHELL_CFG = { url, key }` | Configuração do Supabase que o gerador lê da página anfitriã (patch P3). Qualquer anfitrião (inclusive o Nexus) pode fornecê-la. |
| `postMessage({nga:'token'})` → `{nga:'token', token}` | O gerador **pede** o JWT ao anfitrião (mesma origem). O anfitrião é dono da sessão e a renova. |
| `postMessage({nga:'logout'})`, `{nga:'admin'}` | O gerador pede ao anfitrião para sair / abrir a administração. |
| `sessionStorage['nga_auth_session_v1'] = {email, role, logadoEm}` com `role ∈ {admin, operador, leitor}` | Nível de acesso que o gerador aplica na interface. O anfitrião define antes de carregar o iframe. |
| Tabela `documentos(colecao,id,dados,removido,atualizado_em)` | Persistência do gerador: coleções `clientes, regras, relatorios, emissoes, pdfs, modelos, projetos`. |

## Caminhos de integração (do menos ao mais intrusivo)
1. **Link/rota no Nexus (hoje):** o Nexus abre `https://gerador…` em nova aba ou iframe. Usuários separados (login do gerador). Nenhuma mudança no Nexus.
2. **Iframe com autenticação compartilhada:** o Nexus hospeda o gerador num iframe **de mesma origem** (publicando `dist/app/` sob um caminho do Nexus), define `NGA_SHELL_CFG` apontando para **o mesmo projeto Supabase**, escreve a sessão e responde ao `postMessage` de token com o JWT do usuário do Nexus. Requisitos: mesma origem (por causa do `postMessage` com `location.origin`) e a política RLS reconhecer o usuário (tabela `perfis`, ou adaptar `papel_atual()` ao modelo de papéis do Nexus).
3. **Clientes e processos compartilhados:** hoje `clientes` do gerador é um documento JSON (`dados`) com `{nome, config, marcos, acompanhamentos, cadastro{processos[]}}`. Para ler cadastros do Nexus, criar um **adaptador** (view ou função SQL `documentos_clientes_do_nexus`) que entregue ao gerador o mesmo formato; ou o inverso, exportar do gerador para tabelas do Nexus por uma função de sincronização. O arquivo `clientes_NGA_importar.json` mostra o formato.
4. **Relatórios vinculados a processos:** `emissoes` já guarda `clienteId`, `periodo`, `modelo` e (em `cadastro.processos`) os autos; para vincular a um processo do Nexus, adicionar `processo_id` ao documento da emissão (campo livre em `dados`, sem migração) e uma view no Nexus que leia `documentos` onde `colecao='emissoes'`.
5. **Consultar/baixar do Nexus sem abrir o gerador:** via PostgREST: `GET /rest/v1/documentos?colecao=eq.emissoes` e remontar o PDF com os pedaços `colecao=eq.pdfs&id=like.EM_ID__*` (concatenar `dados.dados` base64 por `n`). Exemplo de remontagem em `tests/e2e/persist.spec.mjs` (via API do próprio gerador).
6. **Outro ambiente Supabase:** `scripts/backup.mjs` + `scripts/restaurar.mjs` migram os dados para outro projeto (usuários precisam ser convidados de novo).

## O que NÃO acoplar
O motor do gerador não conhece Supabase nem Lovable: só `NGA_NUVEM` (REST genérico) e o contrato acima. Para trocar de backend basta fornecer outro `NGA_NUVEM_CFG`/adaptador com a mesma interface (`collection/doc/get/set/delete/onSnapshot`).

## Riscos da integração
- Misturar esquemas sem isolar: manter o gerador em **schema/tabelas próprios** (`documentos`, `perfis` aqui) até decidir a unificação.
- Papéis: o Nexus pode ter mais perfis; mapear explicitamente para os três do gerador.
- Origem diferente: `postMessage` e `sessionStorage` exigem a mesma origem; entre origens diferentes, usar o caminho 1 ou um proxy reverso.
