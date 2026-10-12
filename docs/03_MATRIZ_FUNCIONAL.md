# 03 · Matriz funcional

**Legenda das evidências**

- **CÓD**: o código da funcionalidade é **byte a byte o do original** (a página migrada só difere em 6 patches, nenhum toca estes recursos). É a garantia principal de preservação.
- **EQ**: teste automatizado de equivalência original × migrado com as mesmas entradas (`tests/e2e/equivalencia.spec.mjs`).
- **E2E**: teste automatizado do sistema migrado (Playwright) contra PostgreSQL real com RLS.
- **QA27**: roteiro manual completo executado no Artifact v27 (os mesmos recursos, no código que foi migrado) com resultado PASS; defeitos achados foram corrigidos na própria v27.
- **S**: recurso **substituído** por exigência da migração (acesso e usuários), com a interface e o comportamento visível preservados.

| ID | Módulo | Funcionalidade | Preservação / evidência |
|---|---|---|---|
| F-001 | Acesso | Login individual e papéis (admin, advogado, consulta) | SUBSTITUÍDO (S): Supabase Auth + RLS · E2E auth/authz |
| F-002 | Acesso | Trava de PIN do navegador | SUBSTITUÍDO (S): login de servidor; PIN não se aplica |
| F-003 | Acesso | Gerenciar usuários | SUBSTITUÍDO (S): painel Administração (casca) · E2E authz |
| F-004 | Painel | Painel de controle: KPIs, pendências do mês, gerados/faltam enviar, entrega mês a mês | CÓD · EQ visual (painel) · QA27 |
| F-005 | Painel | Banco de relatórios emitidos: abrir, baixar, status (Gerado/Enviado/Arquivado), excluir com confirmação | CÓD · E2E persist (PDF idêntico byte a byte entre usuários) · QA27 |
| F-006 | Painel | Seletor de competência (calendário de mês) | CÓD · QA27 (ano ‹ ›, escolher, Mês atual, Limpar, Esc) |
| F-007 | Clientes | Criar cliente: RJ, RE, Falência, Pré-judicial, Cível, Credor | CÓD · E2E persist · QA27 |
| F-008 | Clientes | Editar cliente, opções de exibição, marcos do procedimento, processos acompanhados (credor/cível) | CÓD · QA27 |
| F-009 | Clientes | Remover cliente com confirmação (só admin no servidor) | CÓD + RLS · E2E authz |
| F-010 | Clientes | Exportar e importar backup JSON (`nga-backup`) | CÓD · QA27 · import dos 40 clientes NGA validado |
| F-011 | Regras | Regras de classificação: criar, aplicar, rejeitar vazia, remover | CÓD · QA27 |
| F-012 | Novo relatório | Carteira Astrea: leitura do PDF, modelo, cliente, mês, Processar | CÓD · EQ opcional com Astrea real (ver 09) · QA27 |
| F-013 | Novo relatório | Indicadores do período (contagens, natureza, ritmo, peças, a confirmar) e Gerar PDF | CÓD · QA27 · EQ opcional |
| F-014 | Novo relatório | Últimos andamentos por processo (filtros, ordem, seleção, PDF) | CÓD · QA27 |
| F-015 | Novo relatório | Modelo Quantitativo (4 págs) | CÓD · QA27 · EQ opcional |
| F-016 | Novo relatório | Modelo Executivo (revisão, leitura do período, PDF) | CÓD · QA27 |
| F-017 | Novo relatório | Modelo Narrativo/credor (inserir fatos, validações, PDF) | CÓD · QA27 |
| F-018 | Novo relatório | Reestruturação extrajudicial: diagnóstico por credor, fluxo, kanban, PDF | CÓD · QA27 |
| F-019 | Novo relatório | Projeto, sem PDF: 12 páginas, presets, formulário ao vivo, aviso de campos em branco, PDF | CÓD · **EQ automatizada (12 págs idênticas)** · QA27 |
| F-020 | Novo relatório | Análise revisional: contrato único/múltiplos, série Bacen, cenários, gráficos, laudo PDF, CSV/JSON | CÓD · **EQ automatizada (15 págs idênticas)** · QA27 |
| F-021 | Modelos | Modelos de fábrica (listar, usar, editar, restaurar padrão) | CÓD · EQ visual (modelos) · QA27 |
| F-022 | Modelos | Duplicar, renomear, exportar/importar JSON `nga-modelo`, excluir | CÓD · QA27 |
| F-023 | Modelos | Salvar modelo, reabrir editável | CÓD · E2E persist (modelo reabre editável para outro usuário) |
| F-024 | Estúdio | Inserir os 74 elementos e 75 ícones; inspetor por tipo; edição de todos os campos | CÓD · QA27 |
| F-025 | Estúdio | Desfazer/refazer, Ctrl+Z/Y/S/D/C/V/A, Delete, setas | CÓD · QA27 |
| F-026 | Estúdio | Multi-seleção, alinhar, distribuir, ordem, travar/ocultar camadas | CÓD · QA27 |
| F-027 | Estúdio | Arrastar, redimensionar, edição de texto no lugar | CÓD · QA27 |
| F-028 | Estúdio | Páginas: em branco, Kanban, Fases, galeria de 30 páginas prontas, converter pronta em design | CÓD · QA27 |
| F-029 | Estúdio | Aba Quadro (colunas, cards, mover entre colunas, modelos de colunas) | CÓD · QA27 |
| F-030 | Estúdio | Visualizar PDF, Salvar, Salvar como…, fechar com alterações não salvas | CÓD · QA27 |
| F-031 | Criação livre | Paleta de blocos, ordenar, remover, Limpar, Carregar modelo, Salvar como modelo, Gerar | CÓD · QA27 |
| F-032 | PDF | Geração (jsPDF), paginação, fontes, capas, rodapés, gráficos, nomes de arquivo | **Mesma biblioteca; EQ: 0 pixel de diferença e bytes idênticos (normalizados) em 27 págs** |
| F-033 | PDF | Visualizador (prévia, Salvar arquivo, Imprimir) | CÓD · QA27 |
| F-034 | Dados | Verificação de marcos contra o Astrea ('a confirmar'), regras de contabilização, deduplicação comprovada, reconciliação | CÓD · QA27 (83 registros Fortress fecham: 58+22+2+1) |
| F-035 | Sincronização | Compartilhar clientes, regras, modelos, projetos, relatórios e PDFs entre usuários | Módulo `nuvem` do original · E2E persist (Supabase simulado com PostgreSQL real) |
| F-036 | Diagnóstico | Botão Diagnóstico da exportação | CÓD · QA27 |
| F-037 | Layout | Responsividade (celular/tablet), identidade NGA, fontes | CÓD · EQ visual · QA27 (mobile) |
| F-038 | IA | Redação de parágrafo e leitura assistida (só dentro do Claude) | Desligado fora do Claude, **como já era no original** (P-3) |

## Limites desta matriz (honestidade)
- A equivalência **automatizada** cobre telas (5), PDFs (laudo 15 págs, projeto 12 págs) e, opcionalmente, o Quantitativo com Astrea real. Os demais recursos têm **garantia por construção (código idêntico)** e foram exercitados manualmente (QA27) **antes** da migração, **não** reexecutados um a um no ambiente publicado (que ainda não existe). Pendência **P-1** em `11_RESULTADO_FINAL.md`: rodar o roteiro completo no ambiente publicado.
- A equivalência de PDF compara conteúdo e renderização (pixel a pixel e bytes com data/ID normalizados), não apenas presença de texto.
