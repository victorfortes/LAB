# NGA Sentinela — Fases 2 e 3 (parcial): motor e primeira validação real (30/10/2026)

## Implementado (código em `sentinela/`, testes em `tests/`)
- Cadastro de clientes (vários CNPJs, nomes anteriores/alternativos), validação de CNPJ, importação CSV.
- Conectores DJEN e DataJud com limite de taxa, retentativa com espera progressiva e saúde por fonte.
- Matcher hierárquico (CNPJ matriz/filial, nome, anterior, aproximado) com classificação e evidência gravada.
- Deduplicação (comunicação, processo, correspondência, janelas já consultadas), consultas retroativas, histórico.
- Distinção ajuizamento x identificação: processo antigo achado agora não é "nova distribuição".
- Central de validação (decisão humana auditada) e opção por cliente de confirmar por nome exato.
- Enriquecimento DataJud em lote: 664 processos em ~22 s (antes: horas, um a um).
- 18 testes unitários (transporte falso): passam. Não contam como evidência de produção.

## Teste real 1 — empresa de controle (companhia aberta, não é cliente NGA)
Resultados em `docs/evidencias/teste_real_fase2*.json`: consultas reais ao DJEN e DataJud, 0 duplicidades,
repetição da janela pulada. Descoberta: o termo de busca deve ser o nome sem sufixo societário (o DJEN grafa SIA, S/A etc.).

## Teste real 2 — CNPJ [CNPJ de teste omitido] (informado pelo usuário), janela 30/07–30/10/2026
- Nome do cliente cadastrado por **dedução** a partir das partes do DJEN: cliente de teste. A confirmar.
- 62 consultas ao DJEN sem falha; 719 processos; 9 confirmados (CNPJ no texto + polo passivo), 684 prováveis
  (nome idêntico no polo passivo, sem CNPJ na fonte), 2 inconclusivos, 26 descartados (cliente no polo ativo).
- Tribunais: TRT9 (370), TRT12 (320), TJPR (26), TRF4 (4), TRT21 (1).
- DataJud: 664 com data de ajuizamento, 31 não encontrados, 0 falhas. Último ajuizamento: 30/09/2026.
  Nenhum foi classificado `nova_distribuicao` porque todos foram identificados mais de 15 dias após a distribuição (correto
  para busca retroativa). Em operação diária isso passa a distinguir novos de antigos.

## Limitações conhecidas
- O DJEN só enxerga processos que já geraram comunicação; o atraso entre distribuição e primeira comunicação não foi medido.
- Cobertura nacional validada para clientes NGA: 0 % até haver CNPJs autorizados e processos passivos conhecidos.
- Só DJEN e DataJud implementados; sem conectores próprios de tribunal (e-SAJ, PJe, eproc), sem petição inicial/IA.
- Falha de fonte provada só em teste com transporte falso; execução agendada, alertas, painel e Docker: não feitos.
- 684 "prováveis" para um nome distintivo: decidir se habilita `confirmar_por_nome_exato` para este cliente.
