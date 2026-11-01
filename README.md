# NGA Sentinela

Monitoramento diário de novas ações judiciais contra clientes do NGA Advogados, usando fontes públicas (DJEN e DataJud).

- Estado real das fontes: `docs/FASE1_matriz_cobertura.md` e aba "Monitoramento de fontes".
- Resultados dos testes reais: `docs/FASE2_3_relatorio.md`, `docs/evidencias/`.
- Instalação: `docs/INSTALACAO.md`. LGPD: `docs/LGPD.md`.
- Testes: `.venv/bin/python -m unittest discover -s tests -p "test_*.py"` (usam transportes falsos);
  teste real contra as fontes: `python3 tests/teste_real_fontes.py`.
