#!/bin/zsh
# Guarda a DATABASE_URL do Supabase no Keychain do macOS (a senha é digitada aqui, sem eco, e nunca vai para arquivo nem para o chat).
# Uso: scripts/set-db-url.sh
export PATH=$HOME/.bun/bin:$PATH
HOST="${NGA_DB_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
USER_="${NGA_DB_USER:-postgres.azyjnbtjflpufuxbwwej}"
if [ "$1" = "--clipboard" ]; then PW="$(pbpaste)"; pbcopy </dev/null; else read -s "PW?Senha do banco (nga-prazos no Supabase): "; echo; fi
[ -z "$PW" ] && { echo "senha vazia"; exit 1; }
ENC=$(NGA_PW="$PW" bun -e 'console.log(encodeURIComponent(process.env.NGA_PW))')
URL="postgresql://${USER_}:${ENC}@${HOST}:5432/postgres"
security add-generic-password -U -a "$USER" -s nga-prazos-db -w "$URL" && echo "Salvo no Keychain (serviço nga-prazos-db)."
