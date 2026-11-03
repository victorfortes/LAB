# Mapa do Astrea

**Status: PARCIAL (fluxo de tratamento observado).** Observado em 2026-10-21 na conta real do usuário, via Claude in Chrome, em modo somente leitura
(nada foi salvo; o formulário foi aberto vazio e descartado). Fontes: observação direta (**[OBS]**) e central de ajuda
https://astrea.aurum.com.br/pt-BR/ (**[DOC]**, não verificada na conta). Nenhum dado de cliente foi transcrito.

## Observado diretamente [OBS]

| Item | Resultado |
|---|---|
| App | SPA com rotas por hash em `https://astrea.net.br/#/main/...` |
| Rotas do menu | Área de trabalho `#/main/workspace/[,]` · Kanban `#/main/kanban` · Agenda `#/main/calendar` · Processos `#/main/folders/[,,]` · **Publicações `#/main/clippings`** · Alertas `#/main/alerts` · Documentos `#/main/documents/[,,]` |
| Publicações — contadores | "NÃO TRATADAS DE HOJE", "TRATADAS HOJE", "DESCARTADAS HOJE", "NÃO TRATADAS" |
| Publicações — filtros | caixa "Digite o processo ou termo pesquisado"; dropdowns **ESTADOS** e **STATUS** (opções: *Tratada*, *Não tratada*, *Descartada*); seta de filtros avançados; botões Imprimir / Exportar Publicações / Atualizar publicações |
| Plano da conta | Tem tipos **Prazo** e **Audiência** (menu "+" → Tarefa, Evento, **Prazo**, Audiência) ⇒ compatível com Company/VIP |
| Estado da conta no momento | 0 publicações em *Tratada* e em *Não tratada* ⇒ **fluxo "Acessar publicação → Tratamentos → Adicionar prazo" NÃO pôde ser observado** |

### Formulário "Adicionar prazo" (aberto pelo menu "+" → Prazo; sem publicação associada)

| Campo (rótulo exato) | Tipo | Obrigatório |
|---|---|---|
| Título do prazo | texto (placeholder "Digite o título do prazo") | **sim** |
| Data limite | data `__/__/____` | **sim** |
| Processo ou caso | busca ("Encontre um processo ou caso") | **sim** |
| Alerta | número + select "Dia(s) antes" | não |
| Responsável | busca por nome ("Digite o nome do responsável"); link "Envolver mais pessoas" | **sim** (pré-preenchido com o usuário logado) |
| Observações | texto livre ("Digite observações sobre o prazo") | não |
| Quadro do Kanban | select (ex.: "Kanban Padrão", "Nenhum", quadros da conta) | **sim** |
| Coluna do Kanban | select (ex.: A Fazer / Fazendo / Concluído) | **sim** |
| Etiquetas | botão (ícone de etiqueta) | não |
| Ações | `CANCELAR`, `SALVAR`; fechar (X) abre diálogo HTML "Sair do prazo sem salvar?" com `VOLTAR AO PRAZO` / `SAIR MESMO ASSIM` | — |

Implicações para o robô:
- **Campo livre existe** ("Observações") ⇒ o marcador de idempotência `[NGA:<chave>]` é viável **se** o campo for persistido e relido (a confirmar no detalhe de um prazo salvo).
- **Kanban é obrigatório**: o robô precisa de quadro/coluna configurados (decisão do usuário, ex.: coluna "A Fazer").
- Responsável é obrigatório ⇒ lista de responsáveis precisa existir (já é pré-requisito do projeto).
- O formulário aberto **a partir de uma publicação** (Tratamentos) é outro, com **calculadora** (nome, dias, úteis/corridos, alerta, observações) **[DOC]** — não observado.

## Observado em publicação real da COPEL (2026-10-21, somente leitura, nada salvo) [OBS]

| Item | Resultado |
|---|---|
| Lista (`#/main/clippings`) | Chips de filtro padrão: *Status: Não tratada*, *Responsável do processo*, *Data de divulgação* (default = dia corrente; remover o chip mostra o backlog), *Tipo da publicação*, *Intimações eletrônicas*, *Vinculada a um processo*. Busca por texto sugere **processos** (autocomplete), não filtra texto livre |
| Linha da lista | Colunas: Divulgado em / Publicado em · Tipo · Processo (nº CNJ + nome do caso + "Responsável: …") · Diário · Nome pesquisado · Status; botão **ACESSAR PUBLICAÇÃO**; ícones `+`, `✓`, `⋮`; trecho do texto; faixa "IA · Tratamentos sugeridos: ADICIONAR UM PRAZO PARA <data>" |
| Tela da publicação | Rota `#/main/clippings-treatment?id=<id numérico>`. Botões: **VOLTAR**, **TRATAMENTOS ▾**, **DESCARTAR**, **CONCLUIR**; status "NÃO TRATADA" |
| Coluna esquerda | Texto integral: cabeçalho do diário, "Divulgado em / Publicado em", Processo, Termo encontrado, Diário, bloco "Publicação" (Órgão, Data de disponibilização, Tipo de comunicação, Meio, Partes, Advogados) |
| Cartão "Processo" | Nome do caso, etiquetas (ex.: **CLIENTE: COPEL**, EQUIPE, FASE, SJ), Pasta, Processo, Cliente, Status, **Responsável**, Ação; links "VER ATIVIDADES PENDENTES (n)" e "VER HISTÓRICO" |
| Cartão "Tratamentos sugeridos" (IA) | Itens **PRAZO** (título, data, responsável) com **TAREFA**s filhas; por item: lápis *Editar* e 👎 *Marcar sugestão como incorreta*; rodapé com excluir/confirmar (documentado) |
| Menu **TRATAMENTOS** | *Adicionar prazo · Adicionar audiência · Adicionar tarefa · Adicionar evento · Adicionar histórico manual* |

### "Adicionar prazo" a partir da publicação (formulário lateral, com calculadora)

| Campo | Detalhe |
|---|---|
| Título do prazo* | texto |
| Data da publicação / Início do prazo | **somente leitura**, exibidos após informar o prazo (ex.: 22/10/2026 e 23/10/2026) |
| Prazo | número + select **Dias úteis** (`workingDays`) / **Dias corridos** (`runningDays`) |
| Data limite* | data; **preenchida automaticamente** ao sair do campo Prazo (blur/Tab) |
| Considerar feriado e recesso | caixas por feriado nacional no intervalo (ex.: "Dia de Finados – 02/11/2026"), marcadas por padrão; aviso "cálculo é meramente uma ferramenta de auxílio" |
| Alerta | número + select "Dia(s) antes" |
| Responsável* | busca por nome; pré-preenchido com o usuário logado; "Envolver mais pessoas" |
| Observações | texto livre |
| Quadro / Coluna do Kanban* | selects (valores por conta) |
| Ações | CANCELAR · SALVAR · "VER COMPROMISSOS" |

O **processo é herdado da publicação** (não há campo). Resultado a validar após salvar: exibição na Agenda / ficha do processo, e persistência de "Observações".

### Gravação real de teste (2026-10-21, autorizada) [OBS]
Prazo `[TESTE NGA PRAZOS] …` (15 d.u., limite 13/11/2026, responsável Victor Fortes, Kanban Padrão/A Fazer) salvo em publicação da COPEL (id 359137884).
- **SALVAR** mostra toast "O prazo foi adicionado"; o prazo aparece num card **"TRATAMENTOS"** na própria tela da publicação ("Todas as alterações foram salvas") com: tipo *Prazo*, título, Data, Responsável, Quadro/Coluna, **Observações** e link "Acessar detalhes".
- **"Observações" é persistido e relido** ⇒ o marcador de idempotência `[NGA:<chave>]` é viável nesse campo.
- Salvar **não** marca a publicação como tratada (segue "NÃO TRATADA"; só **CONCLUIR** trata). "Ver atividades pendentes" do processo passou de 0 para 1.
- O card não expõe o id da atividade no DOM acessível (links sem href); localizar por título/data/processo ou pela Agenda.
- **Exclusão (observada, autorizada):** no card, menu ⋮ → *Acessar detalhes · Concluir · Cancelar · Gerar link compartilhável · Excluir*; **Excluir** abre o diálogo "Excluir prazo — Você tem certeza…?" (`CANCELAR`/`CONFIRMAR`) e mostra o toast "O tratamento foi excluído". O lápis abre **"Editar prazo"** (mesmos campos; o formulário demora a carregar e o layout muda). O contador "Ver atividades pendentes" pode ficar **desatualizado** após exclusão — conferir abrindo a lista ("Este processo ainda não possui nenhuma atividade pendente").
- O prazo de teste foi **excluído** e a publicação permanece "NÃO TRATADA".

### Validação cruzada do calculador (importante)
Disponibilização 21/10/2026, 15 dias úteis: Astrea ⇒ publicação 22/10, início 23/10, **data limite 13/11/2026** (com Finados 02/11 descontado).
O `computeDeadline` do projeto reproduz exatamente isso **quando recebe o feriado** (teste `domain.test.ts`); sem ele daria 12/11.
Conclusão: a **lista de feriados é decisiva** — o robô deve usar a mesma lista de feriados do Astrea/foro e sinalizar quando ela não estiver carregada.

## Ensaio do formulário "Adicionar prazo" em publicação real [OBS 2026-10-21, sem gravar]
Executado pelo próprio robô (`POST /api/records/:id/dry-run` / botão "Ensaio no Astrea"): preenche título, prazo e modalidade, lê a calculadora, lê o Kanban e **cancela**. 0 tentativas de escrita.
- O controle **"Tratamentos" não tem `role=button`**: localizar por texto exato (`getByText('Tratamentos', {exact:true})`).
- Calculadora: publicação 22/10/2026, 15 **dias corridos** ⇒ **06/11/2026** (igual ao cálculo do robô). Em dias úteis o bloco "Considerar feriado e recesso" lista os feriados nacionais do período (ex.: Finados 02/11).
- **Kanban:** quadros "Kanban Padrão" e "FLUXO NGA"; ambos com colunas *A Fazer · Fazendo · Concluído*.
- **Alertas:** apenas **um** campo "Alerta" (número + "Dia(s) antes"); nenhum controle para adicionar outros foi encontrado.
- O botão Cancelar do formulário inline não casou com `a:text-is("Cancelar")` na leitura automatizada; o ensaio usa um fallback (sair da página descarta o formulário não salvo).

## Agenda e atividades do processo [OBS 2026-10-21, somente leitura]

| Item | Resultado |
|---|---|
| **Agenda** `#/main/calendar` | Visões *Em lista / Por dia / Por semana / Por mês*; filtros **Responsabilidade** (Atribuição + Equipes + Pessoas), **Exibir** (Tarefas/Eventos/Prazos/Audiências) e **Status** (A concluir / Concluídas / Canceladas / Todas), **Período** (presets + "Definir período"), busca "Pesquisar atividade, contato, processo ou caso". Linhas: tipo (PRAZO/TAREFA/…), título, processo, responsáveis |
| **Localizar por processo** | Busca global (textbox "Pesquisar contato, processo ou tarefa") → sugestão "Processo … - <nº>" (dentro do `banner`) → ficha `#/main/folders/detail/<id>` |
| **Ficha do processo** | Abas links *Resumo · Atividades · Histórico*; na aba Atividades: links "N abertas" / "N concluídas" (clicar em concluídas inclui-as na lista). Linha de topo: TIPO / título / data ("qui, 25 de jun 2026") / [horário \| "N atividades"] / responsável(is); tarefas-filhas vêm sem TIPO |
| **Detalhe** | Abre em **modal sem id na URL** (sem `role=dialog`). Título "Prazo", campos `Data:`, `Processo:`, `Número do processo:`, `Quadro Kanban:`/`Coluna:`, `Responsável:`, `Outros envolvidos:`, `Criado por:`; abas Atividades/Checklists/Comentários/Outros/Histórico de alterações. **Armadilha:** os rótulos de tipo das linhas também são `heading` ⇒ esperar por "Número do processo:" para saber que o modal abriu |
| **Observações no modal** | Rótulo `Observações:` **NÃO verificado** no modal (os prazos lidos não tinham observação). Verificado apenas no card "Tratamentos" da tela da publicação |
| **Id de atividade** | **Não exposto** no DOM/URL ⇒ o adaptador usa id sintético `processo\|tipo\|data\|título` |

Validação em conta real: `findSchedules('<nº>')` listou os 3 prazos (abertos e concluídos) de um processo e `readSchedule` releu o primeiro.

## Documentado na central de ajuda [DOC] — ainda NÃO confirmado na conta

- Fluxo: abrir a publicação → botão azul **"Tratamentos"** → **"Adicionar prazo"** (tela abre ao lado da publicação) / "Adicionar audiência" /
  Tarefa / Evento / Histórico manual / "Gravar como histórico" (exige processo vinculado). Menu de 3 pontos → "Tratar publicação" também citado.
- **Calculadora (Company/VIP)**: informa nº de dias + úteis/corridos; calcula a partir da **data de publicação no Diário Oficial**; desconta
  feriados/recessos **nacionais** só em dias úteis; permite excluir datas manualmente; o artigo adverte que a calculadora está sendo ajustada
  às regras de intimação eletrônica do CNJ — **conferir contagens com o tribunal**. Prazo salvo aparece na **Agenda**.
- **Detecção inteligente**: em publicações, aparece sugestão "Adicionar prazo de [N] dias" (com probabilidade); ícone 👎 marca a sugestão como incorreta.
- **IA de tratamentos (Company/VIP)**: publicação com tag roxa "IA"; "Tratamentos sugeridos"; lápis (editar), 👎 "Marcar sugestão como incorreta",
  **"Excluir sugestões"**, **"Confirmar tratamento"**. Só para publicações vinculadas a processo cadastrado e posteriores a 17/09/2025.
- Publicação sem processo: "Visualizar", "Cadastrar um processo manual", "Bloquear". "Descartar" remove da lista (continua pesquisável).
- Duplicadas: o Astrea envia uma cópia por advogado citado; há opção em Administração → Publicações para receber só uma (impacta idempotência de captura).
- Localização/conferência: histórico de tratamento no módulo Publicações; atividades na ficha do processo e na **Agenda**.

## Lacunas a observar (precisam de uma publicação real/de teste)

| Passo | Pendência |
|---|---|
| 07 | edição de prazo existente (o lápis abre "Editar prazo" com os mesmos campos; **escrita** ainda não implementada) |
| 08 | confirmar o rótulo `Observações:` no modal de detalhe de um prazo que tenha observação |
| Rede | endpoints de leitura/escrita (a UI usa templates HTML + chamadas não observadas aqui) |
