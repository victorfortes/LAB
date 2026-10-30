#!/bin/zsh
# Executado pelo launchd (serviço do macOS). Não rode à mão: use scripts/service-install.sh.
# caffeinate -i: impede o Mac de dormir por inatividade enquanto o serviço roda.
export PATH=$HOME/.bun/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin
cd "$(dirname "$0")/.." || exit 1
(cd web && bunx vite build >/dev/null 2>&1)
export NGA_DB_CA="$PWD/config/supabase-ca.pem" NGA_LIVE_MAX="${NGA_LIVE_MAX:-300}" NGA_PUBLICATION_LIMIT="${NGA_PUBLICATION_LIMIT:-300}"
export NGA_PRODUCTION=yes-i-authorize
exec /usr/bin/caffeinate -i bun src/server/main.ts --live-local
