# Garantia de cobertura — como o Sentinela prova que não perdeu nada

Nenhuma fonte pública permite prometer "100% dos processos". O que o sistema faz é **provar, dia a dia, o que foi lido**
e **medir, com processos conhecidos, o que escapa**. Tudo aparece em *Garantia de cobertura* no painel.

## Mecanismos
1. **Registro de leitura (cobertura.py).** Cada consulta ao DJEN (por nome e por CNPJ de cada cliente) grava a janela de datas lida,
   o total informado pela fonte e quantos itens vieram. Um dia só é "coberto" se TODAS as consultas do cliente o leram por inteiro,
   sem truncamento, depois de ele terminar. Senão: lacuna / leitura incompleta / provisório.
2. **Preenchimento automático.** O agendador procura lacunas a cada 30 min e refaz as janelas (Mac desligado, fonte fora do ar etc.).
3. **Relê os últimos 7 dias em cada pesquisa** (publicações tardias do DJEN).
4. **Janela truncada (>10.000 itens) é refeita dia a dia.**
5. **Consulta que a fonte recusa não trava a execução** (aborta após 3 janelas seguidas e fica para o reprocesso).
6. **Vigia:** se a pesquisa do dia não concluir até 3 h depois do horário, gera alerta.
7. **Relatório diário gravado** (`relatorios_cobertura`) como prova auditável: execuções do dia, lacunas, contagem por cliente.
8. **Processos-controle (teste de captura).** Cadastre números de processos conhecidos contra o cliente. O sistema confere se estão na base;
   se não, consulta o DJEN pelo número: se o DJEN publicou, é falha nossa (incluído na hora e sinalizado); se não publicou, é limite da fonte.
   Taxa de captura = capturados / (capturados + recuperados + a revisar).

## O que NÃO é garantido
- Processo sem nenhuma comunicação no DJEN (recém-distribuído sem citação/intimação publicada).
- Tribunais/sistemas que não alimentam o DJEN; segredo de justiça.
- Cliente com nome muito curto: só por CNPJ.
- Só existe medida real de captura depois que o escritório cadastrar processos-controle.
