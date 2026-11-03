# NGA Sentinela

Monitoramento diário de novas ações judiciais contra clientes do NGA Advogados, usando fontes públicas (DJEN e DataJud).

- Estado real das fontes: `docs/FASE1_matriz_cobertura.md` e aba "Monitoramento de fontes".
- Resultados dos testes reais: `docs/FASE2_3_relatorio.md`, `docs/evidencias/`.
- Instalação: `docs/INSTALACAO.md`. LGPD: `docs/LGPD.md`.
- Testes: `.venv/bin/python -m unittest discover -s tests -p "test_*.py"` (usam transportes falsos);
  teste real contra as fontes: `python3 tests/teste_real_fontes.py`.

## Entrega ao NGA Nexus

O Sentinela continua aplicação própria: o que atravessa para a plataforma do
escritório é artefato — processo e movimentação —, não código.

```
export NEXUS_URL=https://nexus.nga.adv.br
export NEXUS_TOKEN=nga_int_...        # credencial de integração, escopo "processos"
sentinela nexus-enviar --simular      # mostra o lote sem enviar
sentinela nexus-enviar                # entrega
```

**Por padrão só sai correspondência confirmada por pessoa.** A cobertura
automática deste monitoramento nunca foi validada tribunal a tribunal, e
empurrar palpite de robô para dentro do sistema de casos do escritório
transformaria incerteza de fonte em fato no processo do cliente.
`--incluir-automaticas` e `--incluir-provaveis` afrouxam o filtro, e o relato
do comando diz quantas entraram por essa via.

A entrega é idempotente dos dois lados: o Nexus deduplica por `externoId` de
cada movimentação, e `entregas_nexus` guarda aqui o que já foi entregue. Rodar
de novo não duplica nada. O que o Nexus recusar não entra no registro local,
para que a próxima execução tente outra vez depois do conserto.

O token vem só do ambiente, nunca de flag: argumento de linha de comando
aparece em `ps` e fica no histórico do shell.
