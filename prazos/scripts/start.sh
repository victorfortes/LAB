#!/bin/zsh
# Sobe o NGA Prazos no Astrea real, com banco permanente (Supabase via Keychain) e login automático (cofre).
#   scripts/start.sh            -> LEITURA (não grava nada no Astrea)
#   scripts/start.sh producao   -> PRODUÇÃO: grava prazos APROVADOS por um humano (teto de 25 criações por execução)
# Para parar: scripts/stop.sh
export PATH=$HOME/.bun/bin:$PATH
cd "$(dirname "$0")/.." || exit 1
scripts/stop.sh >/dev/null 2>&1
(cd web && bunx vite build >/dev/null 2>&1) || { echo "falha ao montar a interface"; exit 1; }
export NGA_DB_CA="${NGA_DB_CA:-$PWD/config/supabase-ca.pem}" NGA_LIVE_MAX="${NGA_LIVE_MAX:-300}" NGA_PUBLICATION_LIMIT="${NGA_PUBLICATION_LIMIT:-300}"
[ "$1" = "producao" ] && export NGA_PRODUCTION=yes-i-authorize
nohup bun src/server/main.ts --live-local > "${NGA_LOG:-/tmp/nga-live.log}" 2>&1 &
for i in $(seq 1 40); do grep -qE "no ar|rror" "${NGA_LOG:-/tmp/nga-live.log}" && break; sleep 1; done
tail -4 "${NGA_LOG:-/tmp/nga-live.log}" | cut -c1-300
