# Relatório de limitações

> **Situação de encerramento (2026-10-21):** aplicação completa e testada no simulador; leitura do Astrea REAL implementada e verificada
> (publicações, prazos por processo, sugestões do Astrea, ensaio do formulário). **Escrita/edição reais NÃO estão habilitadas** — ver
> [PLANO-ESCRITA-REAL.md](PLANO-ESCRITA-REAL.md). Regras de negócio decididas pelo responsável estão registradas ali.

## Bloqueadores (dependem do usuário)
1. **Astrea real: só a LEITURA de publicações está implementada** (`LiveAstrea`: lista → "Acessar publicação" → detalhe).
   Validada contra página-fixture fictícia e contra a estrutura observada (accessibility tree/`get_page_text`), **ainda não executada
   pelo Playwright em conta real** (perfil sem sessão). *Ação:* `bun run live:login` e `bun run live:check 2`.
   Os parsers dependem do texto exibido pelo Astrea (rótulos "Divulgado em:", "Data de disponibilização:", bloco "Publicação / Processo:");
   mudança de layout ⇒ `ParseError` (nunca valor inventado). O texto integral é cortado nos marcadores "IA"/"PROCESSO"/"TRATAMENTOS".
   Leitura de agendamentos (`findSchedules`/`readSchedule`, via ficha do processo > Atividades, só tipo Prazo): **implementada e verificada em conta real**
   (3 prazos de um processo, abertos e concluídos). Limites: o Astrea não expõe id de atividade (id sintético processo|tipo|data|título; títulos repetidos na
   mesma data são desambiguados pela ordem); o rótulo `Observações:` no modal **não foi verificado** (o marcador de idempotência `[NGA:...]` só foi
   comprovado no card da publicação) — sem isso, a pré-checagem de duplicata pelo marcador não é confiável no real; criação e edição: **não implementadas**.
   **Verificado em conta real (2026-10-21, somente leitura, 2 publicações):** sessão OK, ids e datas lidos, sugestão do Astrea lida
   e comparada (divergência ⇒ `needs_review`), 0 requisições de escrita. Achados: o selo "IA" aparece no MEIO do texto da publicação;
   rótulos e valores vêm em linhas separadas; o CSS força maiúsculas; o Astrea é lento às vezes (timeout padrão 90 s);
   textos com exatamente 65.535 caracteres são sinalizados como possivelmente truncados.
   O classificador por regras **não reconhece** "Ciência às partes sobre o acórdão" como prazo, mas o Astrea sugere prazo nesses casos:
   **Decisão do usuário (2026-10-21): prazos sem modalidade explícita no texto são contados em DIAS CORRIDOS** (`NGA_DEFAULT_DAY_UNIT`;
   texto com "úteis"/"corridos" prevalece). "Ciência às partes sobre o acórdão" ⇒ prazo **presumido de 15 dias corridos** (**confirmado pelo usuário em 2026-10-21**; vale para todos os prazos sem modalidade explícita),
   sempre análise humana. Atenção: o Astrea calcula em dias úteis (13/11/2026), então a conferência cruzada vai divergir (06/11/2026 em corridos)
   enquanto o Astrea sugerir em dias úteis — o robô nunca grava sozinho nesses casos (aprovação humana obrigatória).
2. **Fases 4 e 5 só foram exercitadas no simulador.** A escrita real exige: reconhecimento, selectors confirmados,
   conta de teste e autorização explícita de um teste controlado. O comportamento real do Astrea (validações, campos obrigatórios,
   latência, duplicidade) pode diferir do simulador.
3. **Marcador de idempotência** `[NGA:<chave>]` na descrição é uma hipótese: depende de existir campo de texto livre persistido e relido.
   Alternativa se não houver: chave composta (processo+título+data+responsável) com política de colisão decidida pelo usuário.
4. **Feriados forenses locais, suspensões e prazos especiais não estão carregados.** `config/holidays.json` está vazio e
   toda análise carrega o alerta `feriados_locais_nao_verificados` até alguém preencher e assinar (`verifiedBy`). A UI mostra o aviso.

## Limitações técnicas
- **Classificador por regras**: cobre padrões comuns (prazo explícito em dias/horas, audiência, providências frequentes).
  Textos fora do padrão vão para `needs_review` — por desenho prefere-se falso alerta a falsa certeza. Não substitui revisão jurídica.
  Pontos sempre sinalizados: prazo em dobro/Fazenda/MP/Defensoria, prazo comum/sucessivo, termo inicial distinto (juntada, intimação pessoal, trânsito),
  "prazo legal", divergência número×extenso, unidades não calculáveis (horas/meses/anos).
- **Cálculo de prazo** segue CPC (dias úteis, publicação = 1º dia útil após disponibilização, exclusão do dia do começo, recesso 20/12–20/01).
  Não cobre: juizados/legislação especial com regras próprias, prazos em horas, contagem de intimação por portal (10 dias tácitos), feriados locais.
- **Responsável** não é inferido do texto; vem da lista de processos autorizados. Sem responsável ⇒ bloqueia escrita.
- **Audiências** são classificadas, mas **não** gravadas (só prazos) — escopo a decidir após o mapeamento.
- **Persistência**: o modo demo usa memória. PostgreSQL foi validado em teste (migrations, lock, imutabilidade) mas a ligação
  atualização-de-registro + auditoria não é uma única transação (falha entre as duas deixa estado sem entrada de auditoria; o inverso não ocorre).
- **Auditoria imutável**: garantida por triggers + cadeia de hash; um superusuário do banco ainda poderia desabilitar triggers — usar role só-INSERT e backup externo da âncora (último hash).
- **Sessão/UI**: JWT sem revogação server-side (TTL 8 h); limitador de login em memória (single instance); API só em localhost, sem TLS próprio.
- **LGPD**: textos integrais de publicações ficam no banco (necessário à auditoria). Definir retenção/criptografia em repouso do volume.
- Nenhuma execução em segundo plano agendada (somente por clique em Play).

## Regras de negócio implementadas a partir das publicações reais da COPEL
Prazo dirigido a terceiro (Administrador Judicial/Recuperanda/MP) ⇒ `notOurs`, análise humana, nunca agendado · renúncia/exclusão de patrono (art. 112) e avisos de
distribuição ⇒ sem providência · comunicado duplicado (processo + `comunicacao_id`) ⇒ um só registro · ciência/divulgação de acórdão ⇒ 15 dias corridos presumidos, análise humana ·
dias corridos como modalidade presumida · conferência cruzada com a sugestão do Astrea · texto de 65.535 caracteres ⇒ possivelmente truncado.
Amostra real pequena (8 publicações): **novos padrões vão aparecer**; o classificador por regras manda para análise humana o que não reconhece.

## Etapa 1 — primeira gravação real (2026-10-24)
Gravado e **confirmado por releitura** 1 prazo `[TESTE NGA PRAZOS]` (publicação 359781079, COPEL): título, observações com marcador, data (10/11/2026) e responsável idênticos; Kanban FLUXO NGA / A Fazer e alerta 7 dias foram preenchidos e conferidos no formulário **antes** de salvar, mas **não** são relidos depois. Excluído no mesmo dia pelo robô (Etapa 3, `scripts/live-cleanup-test.ts`: só exclui título com prefixo de teste **e** marcador `[NGA:]`, exige 1 card exato; releitura em página nova: 0 prazos, publicação segue NÃO TRATADA).
Achados importantes:
- **A guarda de somente leitura cobre apenas o host do Astrea.** A gravação **não passou por requisição não-GET ao host `astrea.net.br`** (a janela de escrita registrou 0 requisições): o Astrea grava por **Firebase** (outro host). Logo o "endpoint de gravação" não foi aprendido e **não há como bloqueá-lo por host sem quebrar as leituras** (o Firebase lê por POST). A proteção real contra escrita indevida é: nunca clicar em Salvar/Excluir/Concluir fora dos fluxos autorizados + portões do Writer + conferência antes de salvar.
- **A sessão do Astrea não sobrevive ao fechamento do navegador** (e-mail/senha, sem "lembrar-me"): o app em modo live com janela visível espera o **login manual** no início e mantém o mesmo navegador aberto (`src/astrea/live-session.ts`). Expira com o tempo.
- Publicações pendentes mudam rápido (a de teste original saiu da fila em 3 dias): o teste real exige publicação **escolhida e autorizada no momento**.
- O Writer **ignora providências sem prazo próprio** (aqui: 1 prazo gravado e 1 providência deixada para tratamento manual).

## Login automático (cofre) — limites
- Testado só contra o **fixture** (credenciais fictícias); **ainda não executado no Astrea real** (a senha só deve ser digitada por você, no app). O formulário real de login foi observado (e-mail, senha, ENTRAR), mas o comportamento com MFA/CAPTCHA/bloqueio não.
- A sessão vive no navegador do app: se o app reiniciar ou a sessão expirar, o próximo Play loga de novo (1 tentativa; 10 min de intervalo após falha).
- O cofre é local (Keychain do macOS). Em outro computador/servidor, defina `NGA_VAULT_KEY` e reconfigure o acesso.

## Verificação realizada
`bun test`: domínio, classificador, prazos, estados, segurança, auditoria, executor, lock, sessão expirada, escrita idempotente (divergência, resultado desconhecido,
retry, concorrência), correções, API HTTP e PostgreSQL real embarcado. UI conferida manualmente no navegador (login → Play → detalhe → aprovação → escrita simulada confirmada).

## Escopo "todo o escritório" (preparado, desligado)
- O Play aceita `scope: "copel" | "todos"`. "todos" só existe se `NGA_ALLOW_ALL_CLIENTS=yes`, só para administrador, e fica registrado na auditoria (`run.started`).
- A gravação continua travada por lista de processos autorizados, autorização de escrita ativa e (no piloto) lista de publicações liberadas; ampliar o escopo de LEITURA não amplia a de ESCRITA.
- A lista de publicações lida é a do filtro salvo no próprio Astrea (hoje: não tratadas, responsável Victor Fortes). Para o escritório inteiro o filtro precisa ser ajustado no Astrea.
- A leitura é sequencial (~1 publicação por alguns segundos) e limitada por `NGA_LIVE_MAX` (padrão 12) e `NGA_PUBLICATION_LIMIT`; com centenas de publicações será preciso aumentar esses limites e rodar em lotes.

## Controle de lançamentos
- A aba "Lançamentos do robô" lista o que foi gravado/tentado, com link para a publicação no Astrea. Com o repositório em memória (modo live-local) a lista zera ao reiniciar o app; para histórico permanente é preciso rodar com PostgreSQL (`DATABASE_URL`).
