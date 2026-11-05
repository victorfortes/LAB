# Sincronização Astrea → NGA LAB

Depois que o NGA Prazos grava/adota um agendamento e confirma seus dados por releitura no Astrea, ele enfileira uma entrega persistente ao LAB. A recuperação também localiza gravações antigas já confirmadas; falhas de rede, processo sem cadastro ou projeto ainda não vinculado permanecem na fila com motivo visível. Não é feita nova gravação no Astrea para retentar a entrega.

## Configuração

1. No LAB, crie uma credencial de integração com aplicação **NGA Prazos** e escopo **prazos**. O token é exibido uma única vez.
2. No NGA Prazos, abra **Sincronização LAB**, informe o endereço do LAB e o token. A credencial fica cifrada no cofre local, com chave no Keychain.
3. Cadastre o processo no LAB e vincule-o ao projeto correto. Sem esse vínculo a entrega fica pendente; não se cria ou adivinha cliente por nome aproximado.
4. O servidor aplica `migrations/002_lab_sync.sql` ao iniciar e tenta entregar a fila a cada minuto. **Retentar fila agora** antecipa a tentativa.

Alternativa para instalação: defina `NGA_LAB_URL` e `NGA_LAB_TOKEN` no ambiente e execute `bun scripts/lab-configurar.ts`. O script cifra os valores e não os imprime. Nunca passe o token como argumento de linha de comando ou o registre no Git. HTTPS é obrigatório, exceto para `http://localhost`/`http://127.0.0.1`.

## O que aparece no LAB

- Prazo no processo/projeto cadastrado, com o vencimento que foi realmente confirmado no Astrea.
- Contagem CPC paralela no metadado do prazo: eventual diferença é registrada, nunca escondida por recalcular silenciosamente uma data diferente.
- Tarefa de cumprimento e acompanhamento do workflow: análise de intimação e conferência de protocolo/renúncia. São atividades separadas, vinculadas ao mesmo projeto.
- Responsável é associado somente por nome exato e único na equipe ativa da mesma organização; caso contrário a tarefa fica sem responsável para atribuição humana.

O identificador do agendamento Astrea identifica a entrega. A retentativa usa trava transacional e fonte externa para evitar duplicação de prazo/tarefas. A fila não armazena tokens. Em modo simulado, nenhum dado é enviado ao LAB.

A integração é de mão única: agendamentos confirmados no Astrea chegam ao LAB. Agendar manualmente na Controladoria do LAB cria prazo/tarefas no LAB; esse botão não lança outro agendamento no Astrea.
