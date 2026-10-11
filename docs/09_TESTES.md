# 09 · Testes e evidências

Execução de 11/10/2026, máquina de desenvolvimento (macOS, Node 22.11, Chromium 131 do Playwright, PostgreSQL real em WebAssembly via PGlite 0.2.17).
Comandos: `npm run test:db` e `npm run test:e2e` (o segundo faz o build e sobe o servidor de teste).

## Resultado
| Suíte | Testes | Resultado |
|---|---|---|
| Banco (`tests/db`): RLS, gatilhos, versões, auditoria, backup/restauração | 14 | **14 passaram** |
| Interface ponta a ponta (`tests/e2e`): autenticação (7), autorização (5), persistência (3), equivalência com o original (8) | 23 | **23 passaram** (1 deles só roda com um PDF real do Astrea, executado) |

## Como o ambiente de teste funciona (e o que ele NÃO prova)
`tests/e2e/mock_supabase.mjs` serve o `dist/` com os cabeçalhos reais (`web/_headers`, inclusive a CSP) e imita a API do Supabase
(Auth + REST) **em cima do mesmo PostgreSQL das migrações, com as mesmas políticas RLS**. Logo, regras de acesso, gatilhos e SQL são exercitados de verdade.
**Não é o Supabase real:** não testa e-mail, limites de taxa, Edge Function, painel de Auth nem configuração de projeto (ver pendências).

## Equivalência com o original (mesmas entradas, original preservado × migrado)
| Item | Resultado |
|---|---|
| Telas Painel, Novo relatório, Regras, Modelos (1280×800) | 0 pixel de diferença |
| Tela Clientes (tabela) | 126 px (0,16%): 2 px de borda do selo por arredondamento de subpixel; o cartão acima muda de propósito ("guardado neste navegador" → "compartilhado com o escritório") e foi excluído da comparação |
| **Laudo revisional** (15 págs, Bacen simulado para ser determinístico) | páginas, tamanho, texto, fontes iguais; **0/16.885.560 pixels**; **bytes idênticos** após normalizar data de criação e ID |
| **Projeto, sem PDF** (12 págs) | **0/13.508.448 pixels**; bytes idênticos |
| **Quantitativo com exportação real do Astrea** (4 págs) | **0/4.502.816 pixels**; bytes idênticos |

Os PDFs são os mesmos porque a biblioteca (jsPDF) e todo o código de geração são os do original. O teste confirma que nada na casca, no iframe, na CSP ou nas fontes locais os alterou.
(A exportação real do Astrea ficou **fora do repositório**: o teste só lê o caminho em `NGA_ASTREA_PDF` e imprime contagens.)

## Autenticação
Mensagem igual para senha errada e e-mail inexistente; recuperação de senha responde igual para e-mail existente ou não; usuário **sem perfil** e **desativado** ficam bloqueados; gerador aberto fora da casca volta ao login; **a conta padrão do original não existe mais** (nem "nga2026" no HTML); login abre o gerador com o papel certo; **sair apaga IndexedDB e caches locais**; CSP e cabeçalhos presentes.
**Não testado:** expiração real de sessão do Supabase e o logout por 30 min de inatividade (implementado, sem teste automatizado).

## Autorização
- API sem token: 401. Visualizador não grava (403). Sem perfil não lê nada. Advogado não lê auditoria nem altera perfis.
- Pela interface: visualizador lê mas é recusado no banco; advogado grava mas **não exclui** cliente (permission); administrador exclui; painel de usuários muda perfil e o efeito vale no banco; ninguém altera o próprio perfil; advogado não vê nem consegue abrir a administração.
- No banco, **testes de mutação**: enfraquecer 5 políticas diferentes (leitura aberta, inserção aberta, exclusão sem admin, DELETE aberto, auditoria aberta) faz ≥ 1 teste falhar.

## Persistência
- Cliente criado por um usuário aparece para outro **depois de apagar todos os dados locais** (prova que veio do banco), com marcos preservados, **≥ 2 versões** guardadas e evento de auditoria.
- **PDF emitido** sobe em pedaços e o outro usuário baixa **exatamente os mesmos bytes** (SHA-256 igual).
- Modelo personalizado salvo reabre **editável** (texto do elemento intacto) para outro usuário.
- Defeito achado e corrigido por estes testes: o original grava PDFs na coleção `pdfs`, que a primeira versão do esquema recusava.

## Armazenamento e recuperação
- Não há bucket público; PDFs ficam no Postgres sob RLS (visualizador baixa, advogado grava, só admin exclui).
- **Backup/restauração:** dump cifrado (conteúdo ilegível sem a frase; senha errada e arquivo adulterado são rejeitados) → restauração em banco **novo** → documentos, datas, exclusões lógicas e histórico de versões **idênticos**; gatilhos reativados.

## Não testado (e por quê)
| Item | Motivo |
|---|---|
| Ambiente publicado (HTTPS real, Cloudflare, Supabase real) | Contas do escritório indisponíveis |
| Edge Function `convidar-usuario`, e-mails de convite/recuperação, MFA | Exigem projeto Supabase real |
| Limites de taxa do Supabase Auth, expiração real de JWT | Idem |
| Roteiro funcional completo (todos os botões) no ambiente migrado | Cobertura por construção (código idêntico) + QA27 anterior; reexecutar no publicado (P-1) |
| Teste de carga / vários usuários simultâneos | Fora do escopo; documentar limite do plano |
| Varredura dinâmica de vulnerabilidades (DAST), teste de invasão | Não realizado |
