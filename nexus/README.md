# NGA LAB

Ecossistema NGA LAB: as ferramentas do Lab (Prazos, Sentinela, Íntegra, Radar), a
**gestão de projetos** que administra tudo, o **painel do advogado** e o **painel do
cliente**, numa só plataforma. Construída a partir do inventário em
[`INVENTARIO.md`](INVENTARIO.md).

**Front-end** (`web/`): sem etapa de build, módulos ES. O visual é o design system do
LexPane (vidro, cartões, quadro kanban, anéis de progresso) com a paleta do NGA LAB
(azul quase preto, âmbar, ciano). A gestão de projetos é o centro: cada projeto tem um
hub com fase do procedimento, tarefas, créditos, processos e prazos, documentos, portal
do cliente, plano e caixa, relatórios e equipe. O cliente entra pela mesma porta e vê só
o que é dele; quem garante isso é o RLS do banco, não a tela.

```bash
bun install
bun run demo        # http://127.0.0.1:8790 — PostgreSQL embarcado, dados fictícios
bun test            # 211 testes
bun run typecheck
```

## Estado real

Tudo abaixo foi executado nesta máquina. Nada está marcado como pronto sem teste.

| Camada | Situação |
|---|---|
| Domínio: dinheiro, datas | ✅ 34 testes. Centavos em `bigint`; soma de meses satura no último dia. |
| Domínio: classificação de créditos (arts. 41, 49) | ✅ 12 testes. Inclui o desdobramento do art. 41, § 2º. |
| Domínio: quórum de AGC (arts. 45, 58 § 1º) | ✅ 14 testes. Determinístico, sem IA. Cram down com os três incisos. |
| Domínio: cronograma do plano | ✅ 22 testes. Price, SAC e sem juros; o saldo fecha em zero sempre. |
| Design system NGA Lab | ✅ 7 testes. Token único; CSS e TS conferidos um contra o outro. |
| Schema + migrations | ✅ 16 migrations, aplicadas em PostgreSQL real a cada teste. |
| Isolamento entre clientes (RLS) | ✅ 14 testes contra PostgreSQL real, com papel de aplicação sem bypass. |
| Autenticação e sessão | ✅ Argon2id; token só em hash; cookie HttpOnly/SameSite. |
| RBAC | ✅ 8 testes. 10 perfis do §13. |
| API | ✅ 19 testes de ponta a ponta. |
| Painel de trabalho | ✅ 17 testes de API. Pendências reais: prazos, análises, créditos a validar, achados críticos e cliente sem resposta. Verificado no navegador. |
| Projeto: fases por procedimento | ✅ 16 testes. Marcos da LREF com fundamento; pular fase é recusado e o erro diz qual marco ficou sem registro. |
| Projeto: hub e equipe | ✅ Um líder ativo por projeto, garantido por índice parcial. Sair da equipe não apaga a linha. |
| Portal: isolamento e publicação | ✅ 22 testes de RLS. Documento interno não chega ao cliente, provado contra PostgreSQL real. |
| Portal: onboarding documental | ✅ 16 testes de domínio + 25 de API. Checklist por procedimento, com progresso real. |
| Portal: fluxo de caixa da recuperanda | ✅ 15 testes. Previsto e realizado separados, com alerta de projeção negativa. |
| Portal: interface | ✅ Verificada no navegador como cliente: checklist, publicados, plano e fluxo de caixa. |
| Análise: fronteira contra injeção de prompt (§7.12) | ✅ 20 testes. Moldura com delimitador aleatório; o texto é relatado, nunca reescrito. |
| Análise: identificadores com dígito verificador | ✅ 22 testes. CNPJ (inclusive alfanumérico da IN RFB 2.229/2024), CPF e número único do CNJ. |
| Análise: classificação de documento por sinais | ✅ 12 testes. Sem IA; na dúvida devolve "não classificado" em vez de palpite. |
| Análise: verificação de citação jurídica (§7.7) | ✅ 18 testes. Corpus fechado de 51 dispositivos; julgado nunca é marcado como verificado. |
| Análise: ancoragem do achado no documento | ✅ 16 testes. Achado que não ancora em trecho real é descartado. |
| Análise: pipeline e portões | ✅ 19 testes + 17 de API. Esquema, âncora e fundamento aplicados ao que vem do modelo. |
| Análise: interface | ✅ Verificada no navegador: triagem real de petição fictícia, com CNPJ e CPF inválidos e dispositivo inexistente achados sem IA. |
| Leitura por modelo de linguagem | ⚠️ Construída com o SDK oficial (`claude-opus-5-5`, saída validada por esquema), mas **não exercitada contra a API real**: não há chave Anthropic. Sem chave o sistema nomeia o impedimento e entrega o determinístico. |
| Acervo: guarda endereçada por conteúdo | ✅ 17 testes. Chave derivada do SHA-256, escrita atômica, integridade conferida em toda leitura. |
| Acervo: tipo reconhecido pelos bytes | ✅ 15 testes. HTML renomeado para .pdf é recusado como PDF; executável é recusado. |
| Acervo: URL assinada e temporária (§12.4) | ✅ 14 testes. HMAC ligado ao usuário, 5 minutos, comparação em tempo constante. |
| Acervo: upload e download de ponta a ponta | ✅ 24 testes de API. Despublicar ou desligar o portal mata o link no mesmo instante, dentro do prazo. |
| Extração de texto de PDF e OCR | ⛔ Não construídas. De .txt e .csv o texto sai do próprio arquivo; de PDF e imagem, continua entrando colado, e a recusa diz isso. |
| Armazenamento em S3, GCS ou Azure | ⛔ Não construído. Não há credencial de objeto nesta instalação e nenhuma chamada real foi feita. |
| Antivírus no recebimento de arquivo | ⛔ Nenhum verificador integrado. |
| Processos: calendário forense | ✅ 15 testes. Páscoa calculada, feriados móveis derivados dela, recesso do art. 220. |
| Processos: contagem de prazo (CPC) | ✅ 20 testes contra datas conferidas por implementação independente. Os dois saltos do art. 224, dias úteis do art. 219, prorrogação do § 1º. |
| Processos: cadastro, partes, andamento e prazos | ✅ 24 testes de API. Número conferido pelo dígito do CNJ; agenda da controladoria com vencidos em primeiro lugar. |
| Acompanhamento processual no portal | ✅ Movimentação nasce invisível; publicar exige resumo escrito por gente e usa a mesma permissão de publicar documento. Verificado no navegador dos dois lados. |
| Calendário de feriado local e suspensão do tribunal | ⛔ Não integrado. Entra informado por quem cadastra o prazo, e toda data sai com ressalva. |
| Integração com o NGA Lab: lado receptor | ✅ 21 testes. Credencial com escopo, usuário de serviço sob RLS, idempotência por identificador de origem. |
| Integração: NGA Sentinela → Nexus | ✅ 13 testes no Sentinela + entrega exercitada de ponta a ponta contra este servidor. Só sai correspondência confirmada por pessoa. |
| Integração: NGA Prazos e Íntegra | ⛔ Ainda não chamam as rotas. O contrato existe e está testado do lado do Nexus. |
| Relatórios: motor de PDF | ✅ 16 testes. Quebra de linha, paginação com cabeçalho repetido e codificação conferidos abrindo o PDF gerado, não só contando bytes. |
| Relatórios: acompanhamento e quadro de credores | ✅ 15 testes de API, do dado no banco ao PDF baixado por URL assinada. |
| Fonte Barlow e JetBrains Mono no PDF | ⛔ Os arquivos de fonte não estão no repositório; o PDF usa Helvetica e Courier, que são padrão do formato. |
| CRM, financeiro do escritório, processos | ⛔ Não iniciados. Ver `/api/modulos`. |
| NGA Atlas, NGA Orbit, Radar Concursal | ⛔ Não existem em lugar nenhum. São construção nova. |

## Como colocar em pé

Três passos, nesta ordem. O segundo existe porque banco recém-migrado não tem
usuário nenhum: a instância sobe, responde e ninguém entra.

```bash
cp .env.example .env            # preencha as senhas e o segredo de arquivos
docker compose up -d banco
docker compose run --rm nexus bun run migrate
docker compose run --rm -e NGA_SENHA='...' nexus \
  bun run criar-usuario voce@nga.adv.br "Seu Nome" socio_administrador
docker compose up -d nexus
```

Sem Docker, os mesmos três passos com as variáveis no ambiente: `bun run
migrate`, `bun run criar-usuario` e `bun start`.

**A migração é passo separado de propósito.** Ela conecta como dono do schema
para criar tabela, política e o papel `nga_app`; a aplicação roda como
`nga_app`, que não fura o RLS — é isso que mantém o isolamento entre clientes
de pé. Rodar migração no arranque de cada réplica é como duas instâncias
migram o mesmo banco ao mesmo tempo.

**`NGA_SEGREDO_ARQUIVOS` não é opcional em produção.** Sem ele um segredo é
sorteado por processo: os links de download morrem a cada reinício e não
funcionam com mais de uma réplica. O `/api/arquivos/estado` denuncia isso.

**O acervo fica fora de `web/`.** Se o servidor de estáticos alcançasse os
arquivos, a URL assinada não protegeria nada (§12.4). No compose ele é um
volume próprio.

## Decisões que valem explicação

**Dinheiro é `bigint` em centavos.** Estes números vão para habilitação de
crédito e quadro-geral de credores. `0,1 + 0,2 ≠ 0,3` é tolerável num gráfico e
inaceitável numa petição. Na API trafegam como string: JSON não tem inteiro
grande.

**O quórum da AGC não passa por modelo de linguagem.** `src/domain/insolvencia/quorum.ts`
é aritmética pura e auditável. A IA pode ler documento e sugerir enquadramento;
contar voto de assembleia, não.

**Sugestão de máquina e validação humana são colunas separadas.** `classe_sugerida`
nunca vira `classe_validada` sozinha, e o cronograma do plano só usa crédito
validado — devolvendo quantos ficaram de fora. É o §7.7 virando constraint.

**A aplicação não conecta como superusuário.** Superusuário fura RLS
incondicionalmente, e aí o isolamento entre clientes vira decoração. A migração
004 cria `nga_app` sem `BYPASSRLS`, e `Banco` recusa conectar como `postgres`.
Descobrir isso em teste custou uma tarde; descobrir em produção custaria um
vazamento entre clientes.

**Documento interno não chega ao cliente — por estrutura, não por disciplina.**
`documentos.visibilidade` nasce `interno`, e a política de RLS do portal filtra
por ela. Publicar exige a permissão `portal.publicar`, grava quem publicou e
fica na auditoria. Efeito colateral revelador: o cliente não consegue nem ler de
volta o documento que ele mesmo acabou de enviar — por isso o envio pelo portal
não usa `RETURNING`.

**Enviar não é aprovar.** O portal mostra duas barras de progresso: o quanto o
cliente enviou e o quanto a NGA aprovou. Só a segunda fecha o onboarding, e a
máquina de situações recusa a transição para `aprovado` partindo do cliente.

**Caixa da recuperanda e finanças do escritório são permissões distintas.** O
advogado do caso acompanha o fluxo de caixa do cliente e não vê o faturamento da
NGA; o sócio vê os dois. Juntar isso numa permissão só obriga a escolher entre
vazar uma coisa e travar a outra.

**Módulo não construído aparece dito assim.** O §18 proíbe card decorativo, então
`src/server/modulos.ts` declara o estado real de cada módulo e a interface mostra
esse estado — inclusive "não existe código".

**As aplicações do NGA Lab continuam separadas, e integram por artefato.**
O Sentinela entrega processo e movimentação, o NGA Prazos entrega prazo lido do
Astrea, o Íntegra entrega as partes do PDF dos autos. Cada uma tem credencial
própria, com escopo próprio — a do Sentinela não grava documento — e um
**usuário de serviço** sob o qual a ingestão roda, de modo que o RLS vale igual
ao de uma requisição humana. Gravar sem contexto de RLS faria da integração o
único ponto do sistema onde o §6.1 não se aplica, e seria por ali que um dado
de cliente acabaria no projeto de outro.

Toda entrega é idempotente por identificador de origem: robô roda de novo, e
reentregar o mesmo lote devolve "repetido" em vez de duplicar o quadro de
movimentações. E nada chega ao cliente por essa porta — movimentação entregue
por robô nasce invisível, e o papel `integracao` não tem `portal.publicar`.

**A fase do projeto é lista fechada, não campo de texto.** Um caso de
recuperação judicial não tem "andamento de 0 a 100%": tem marcos, e cada marco
é um ato com artigo. Pular de "pedido distribuído" para "concedida" é recusado,
e o erro diz qual marco ficou sem registro — voltar, porém, é permitido, porque
decisão reformada em agravo acontece e o sistema tem de aceitar a realidade.

**Um líder ativo por projeto, garantido por índice parcial.** "Todo mundo
responde" é como um prazo passa. E sair da equipe não apaga a linha: quem
trabalhou no caso em 2024 continua tendo trabalhado nele.

**Relatório não tem número de enfeite.** A função que acrescenta tabela ao
relatório exige um texto `seVazio`: não existe como montar uma seção sem dizer
o que o leitor lê quando não houver dado. Tabela vazia nunca sai como tabela
vazia — sai como frase explicando a ausência, e a falta sobe para a lista
**O que este relatório não afirma**, impressa no fim junto com a
**Procedência dos dados**. Um PDF circula solto, sem o sistema em volta; quem
o recebe precisa saber o que ele mede e o que ele não mede.

**O quadro de credores só conta crédito validado por pessoa.** Classe sugerida
pela plataforma não entra em papel timbrado — é o §7.7 aplicado ao documento
que vai aos autos. Os pendentes aparecem contados à parte, para ninguém somar
errado por engano.

**Nenhuma data de prazo sai como definitiva.** A contagem aplica os arts. 219,
220 e 224 do CPC e mostra o caminho inteiro — publicação, primeiro dia contado,
cada dia que não correu e por quê —, mas feriado estadual, feriado municipal e
portaria do tribunal não estão integrados a esta plataforma. Então o resultado
carrega `exigeConferencia` e diz o que não considerou. Um sistema que cuspisse
vencimento com ar de definitivo, sem o calendário da comarca, seria pior do que
não ter sistema: o advogado confiaria.

**O andamento do processo só chega ao cliente traduzido por gente.** A
movimentação nasce invisível, e publicá-la exige um resumo escrito por quem
publica, com no mínimo dez caracteres — exigência do banco, não da aplicação.
Não há tradução automática de andamento processual: "Juntada de petição de
impugnação" não diz nada a quem não é do ramo, e um resumo gerado por máquina
sobre o processo do cliente é onde se promete uma vitória que não houve.
Processo em segredo de justiça fica fora do portal, e prazo nenhum chega ao
cliente — um prazo perdido numa listagem é a pior forma de ele descobrir.

**A URL assinada não substitui a autorização; ela encurta a janela.** O link
carrega o id de quem o pediu e vale cinco minutos, mas o download refaz a
consulta sob o RLS daquele usuário a cada clique. É por isso que despublicar um
documento ou desligar um portal mata o link no mesmo instante, sem lista de
revogação e sem esperar o prazo correr. A assinatura prova a origem do link; o
banco decide se ele ainda vale.

**O nome do arquivo nunca entra no caminho em disco.** A chave é o SHA-256 do
conteúdo, então travessia de diretório deixa de ser algo a filtrar e passa a
ser inexprimível — e o mesmo documento enviado por três credores ocupa espaço
uma vez. Na leitura o hash é conferido: peça que vai a juízo não sai do acervo
corrompida em silêncio.

**O tipo do arquivo vem dos bytes, não do que o navegador declara.** Um `.html`
renomeado para `.pdf` com `Content-Type: application/pdf` entra como texto, não
como PDF, e executável é recusado. Todo download sai como `attachment`, com
`nosniff` e CSP restritiva: servir conteúdo de terceiro inline na mesma origem
da aplicação é o caminho curto para XSS armazenado com os cookies dos advogados
ao alcance.

**Três portões sobre o que vem do modelo de linguagem.** Esquema estrito
(não há campo onde caiba uma conclusão que não lhe cabe decidir), âncora
obrigatória (todo achado cita trecho literal, e a plataforma confere que o
trecho existe — achado que não ancora é descartado e o descarte fica visível)
e fundamento conferido contra corpus fechado (dispositivo fora do corpus
rebaixa o achado a hipótese, com ressalva escrita). Nenhum dos três depende de
o modelo cooperar, que é a razão de funcionarem. O `CHECK achado_ancorado` da
migração 010 põe o segundo portão no banco, onde refatoração nenhuma o remove
por acidente.

**Sem chave de IA, a análise continua existindo.** Classificação,
identificadores com dígito verificador, conferência de citações e detecção de
injeção são determinísticos e rodam sempre. O estágio de modelo vira
`indisponivel` com o motivo por escrito, e a tela diz isso. Não há provedor de
mentirinha devolvendo texto plausível: resumo inventado é pior do que resumo
nenhum, porque resumo nenhum ninguém assina embaixo.

## Estrutura

```
src/domain/     regras puras e testadas; sem banco, sem rede
  insolvencia/  créditos, quórum de AGC, cronograma do plano
  portal/       checklist documental, fluxo de caixa
  projeto/      fases por procedimento, com os marcos da LREF
  financeiro/   honorários contratuais e teto do art. 24
  processo/     calendário forense e contagem de prazo pelo CPC
  analise/      fronteira §7.12, identificadores, classificação, citações, âncoras
src/ai/         provedor Anthropic e pipeline de triagem documental
src/db/         migrations versionadas e runner idempotente
src/security/   senha, sessão, RBAC
src/store/      acesso ao banco com RLS por requisição; acervo de arquivos
src/server/     API e catálogo de módulos
src/relatorio/  motor de PDF: medição de texto, folha A4, modelo do relatório
ui/tokens/      design system NGA Lab (fonte única)
web/            Command Center
```

## O que falta e por quê

Impedimentos que não dependem de código — detalhados em `INVENTARIO.md`:
credenciais do Nexus, código-fonte dele, `service_role` do Supabase para migrar
os dados, chave Anthropic para exercitar os agentes, e liberação de escrita real
no Astrea.

## Banco compartilhado (Supabase)

`scripts/migrar-supabase.ts` leva o schema para um Postgres que já tem outra aplicação (o gerador de
relatórios), **num schema próprio `nga_lab`**: nada em `public` é alterado e o papel `nga_app` não recebe
acesso às tabelas do outro app (`tests/esquema-compartilhado.test.ts`). Sem `--aplicar` ele só lê metadados.
A string de conexão vem da variável `NGA_SUPABASE_URL`; não a coloque em arquivo versionado.
