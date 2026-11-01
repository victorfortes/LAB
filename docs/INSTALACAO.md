# Instalação e operação

## Local (sem Docker, testado neste Mac)
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
SENTINELA_NOVA_SENHA='senha-com-10+-caracteres' .venv/bin/python -m sentinela criar-usuario voce@nga.adv.br "Seu Nome" --papel admin
.venv/bin/python -m sentinela api      # painel em http://127.0.0.1:8000
.venv/bin/python -m sentinela worker   # outro terminal: pesquisa diária, fila, alertas
```
Atenção: se a porta 8000 já estiver em uso, defina `SENTINELA_PORT`.

## Servidor (Docker; NÃO testado: Docker não existe neste Mac)
`cp .env.example .env`, preencher, `docker compose up -d --build`, criar o admin com
`docker compose run --rm -e SENTINELA_NOVA_SENHA=... api python -m sentinela --db /app/data/sentinela.db criar-usuario ...`.
Colocar atrás de proxy reverso com HTTPS (Caddy/Nginx). Não exponha a porta 8000 diretamente.

## Operação
- Pesquisa diária às 06:00 (Configurações > Agendamento), com reprocessamento automático de falhas a cada 30 min.
- Falha do worker: ao reiniciar, jobs presos voltam à fila e execuções órfãs são marcadas como interrompidas.
- Backup: copiar `data/sentinela.db` (SQLite em WAL: use `sqlite3 data/sentinela.db ".backup arquivo"`).
- Segredos só em variáveis de ambiente; o painel mostra apenas se estão definidos.

## Decisões de arquitetura e desvios do que foi pedido
- **SQLite em vez de PostgreSQL**: um único servidor, dois processos, carga baixa. O esquema é relacional simples e as
  migrações são versionadas (`sentinela/db.py`); migrar para PostgreSQL exige trocar a camada de acesso (SQL com `?` e
  `INSERT OR IGNORE`/`ON CONFLICT`). Não feito.
- **Painel em JS puro, sem React/TypeScript**: não há Node neste ambiente. O painel é servido pela própria API, sem build.
- **Fila em banco** (tabela `jobs`) em vez de Redis/Celery: menos infraestrutura, suficiente para o volume.
- Autenticação por token assinado (HMAC) e senhas PBKDF2; três papéis (admin, advogado, leitura); auditoria de ações.
