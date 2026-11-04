# 09 · Testes e evidências

Execução de 11/10/2026, máquina de desenvolvimento (macOS, Node 22.11, Chromium 131 do Playwright, PostgreSQL real em WebAssembly via PGlite 0.2.17).
Comandos: `npm run test:db` e `npm run test:e2e` (o segundo faz o build e sobe o servidor de teste).

## Resultado
| Suíte | Testes | Resultado |
|---|---|---|
| Banco (`tests/db`): RLS, gatilhos, versões, auditoria, privilégios mínimos, backup/restauração, script de RLS de produção | 16 | **16 passaram** |
| Interface ponta a ponta (`tests/e2e`): autenticação (8), autorização (5), persistência (3), equivalência com o original (8) | 24 | **24 passaram** com cabeçalhos HTTP (Cloudflare). Sem cabeçalhos (caso do Lovable), a CSP por `<meta>` basta: 22 + o teste de cabeçalhos pulado de propósito; ver laudo abaixo |

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

## Atualização de 12/10/2026

### RLS no **banco Supabase real** (`supabase/tests/rls_producao.sql`)
Script que cria 5 pessoas-fantasma dentro de um sub-bloco que é desfeito (savepoint), roda 33 asserções por papel e devolve o relatório como resultado normal.
Executado no projeto `nga-gerador-relatorios`: **"RELATORIO RLS | testes: 33 | falhas: 0"**. Conferido depois: 0 usuários em `auth.users` e 0 linhas nas 4 tabelas (nenhum resíduo).
O mesmo script roda no PostgreSQL local (`tests/db/rls_producao.test.mjs`) e **detecta** as falhas quando a migração de privilégios mínimos é removida (5 falhas).
Chamadas reais à API com a chave pública `anon`: leitura/gravação de `documentos, perfis, auditoria, documentos_versoes` = **401 (permission denied)**; funções `registrar_acesso` e `papel_atual` = **401** (antes da migração 0002, `registrar_acesso` respondia 204: corrigido).

### Laudo revisional: investigação da diferença de pixels
Em 3 de 12 execuções o render do laudo (15 págs) divergiu entre original e migrado (4.870; 6.566; 77.633 px de 16,9 milhões), **sempre com bytes do PDF idênticos**.
Controle acrescentado: renderizar os **mesmos bytes** duas vezes no mesmo navegador. Resultado em 6 repetições: o controle divergiu **exatamente nos mesmos valores** (77.633 e 4.870), em 3 delas; original×migrado foi 0 em 4 de 6.
**Conclusão:** a variação é do renderizador do navegador (pdf.js/canvas nos gráficos), não do PDF nem do motor de geração. **Nenhuma alteração foi feita no motor de PDF.** O teste agora exige render idêntico apenas quando os bytes diferem; com bytes idênticos registra um aviso com o controle.

### Pacote Lovable
`npm run build` (Node) e `vite build` geram o mesmo `dist/` que o build Python (paridade byte a byte verificada). Suíte e2e executada contra esse `dist` simulando hospedagem sem cabeçalhos HTTP.

## Fichas, métricas e auditoria (28/10/2026)
- `tests/e2e/fichas-e-metricas.spec.mjs`: fixture sintético com os três cabeçalhos, R$ depois e antes do rótulo, CNJ repetido, sem número, caso e contador n/N; aviso de ficha não reconhecida; bloqueio pela auditoria; e regressão com o bruto REAL do Deville (só local, `NGA_DEVILLE_PDF`; dado de cliente não vai ao repositório).
- Auditoria conferida contra 19 combinações arquivo × mês dos brutos reais disponíveis (Deville, Grupo NB, Pauli e a carteira Trans Mosa): zero diferenças.
- **Deville, outubro/2026, o que o arquivo realmente dá:** 70 fichas (64 numeradas, 3 sem número, 3 casos; o rodapé diz 70/70), 56 CNJ distintos, 47 registros (25 tarefas, 7 prazos, 10 andamentos, 5 históricos), 14 fichas movimentadas (11 processos, 1 sem número, 2 casos), 33 atividades do escritório, 44 processos ativos (18 fichas arquivadas), valor R$ 5.374.341,44. Os valores esperados informados (69 fichas, 55 CNJ, 46 registros, 13 movimentadas) são exatamente os nossos menos a ficha 1/70 (0839557-40.2026.8.12.0001, 1 tarefa de 27/10/2026), que existe no PDF.
- Canet e Charlotte: PDFs de outubro/2026 não estavam disponíveis; a regressão deles fica pendente.

