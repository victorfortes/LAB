#!/bin/zsh
# Roda o NGA Prazos em PRIMEIRO PLANO (o terminal fica ocupado e mostra os logs). Ctrl-C para parar.
#   scripts/run.sh            -> LEITURA     |     scripts/run.sh producao -> PRODUÇÃO
# Reinicia sozinho se o processo cair (ex.: erro do navegador interno).
export PATH=$HOME/.bun/bin:$PATH
cd "$(dirname "$0")/.." || exit 1
pkill -9 -f "server/main.ts" 2>/dev/null
(cd web && bunx vite build >/dev/null 2>&1)
export NGA_DB_CA="${NGA_DB_CA:-$PWD/config/supabase-ca.pem}" NGA_LIVE_MAX="${NGA_LIVE_MAX:-300}" NGA_PUBLICATION_LIMIT="${NGA_PUBLICATION_LIMIT:-300}"
[ "$1" = "producao" ] && export NGA_PRODUCTION=yes-i-authorize
while true; do bun src/server/main.ts --live-local; echo "[$(date +%H:%M:%S)] app parou; reiniciando em 3 s (Ctrl-C para sair)"; sleep 3; done
