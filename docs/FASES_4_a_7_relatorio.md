# Fases 4 a 7 — plataforma completa (30/10/2026)

## Verificado
- 28 testes automatizados passam (transportes falsos): RBAC, login, importação, dashboard (falha total ≠ sem resultados),
  validação manual e em lote, atribuição, fila atômica, agendador (1 execução/dia), recuperação de jobs presos,
  reprocessamento de falhas, alertas sem duplicidade, falha de SMTP registrada e retentativa, análise com origens separadas.
- Pipeline real em cópia do banco com dados reais (CNPJ [CNPJ de teste omitido]): job enfileirado → execução contra DJEN →
  31 análises → 31 alertas internos de conferência. Painel aberto no navegador: dashboard, clientes, cliente, processos,
  detalhe, validação, fontes e configurações carregaram sem erro; login funcionou.

## Não verificado
- Envio real de e-mail e Slack (sem SMTP/webhook), chamada real à IA (sem ANTHROPIC_API_KEY), Docker (não instalado),
  importação .xlsx (só CSV testado), execução agendada às 06:00 em tempo real (testada por relógio simulado).
- Alertas definitivos de "nova ação confirmada" só foram exercitados em teste com dados falsos: no mundo real ainda não
  apareceu distribuição recente para o cliente de teste.

## Limitações
- Cobertura continua limitada a DJEN + DataJud; nenhum tribunal validado individualmente; sem petição inicial.
- Muitos alertas de conferência por processo (sem resumo diário agregado).
- Sem expurgo LGPD, sem PostgreSQL, sem React/TS (ver docs/INSTALACAO.md).
