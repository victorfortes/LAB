#!/bin/bash
# Instala o NGA Nexus como serviço do usuário, no mesmo padrão dos demais
# sistemas do Lab: launchd, caffeinate para o Mac não dormir no meio de uma
# requisição, e log em ~/Library/Logs.
#
#   bash scripts/macos/instalar_servico.sh
#
# Para remover: bash scripts/macos/remover_servico.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROTULO="br.adv.nga.nexus"
PLIST="$HOME/Library/LaunchAgents/$ROTULO.plist"
LOGS="$HOME/Library/Logs/NGA-Nexus"
BUN="$(command -v bun)"

if [ -z "$BUN" ]; then
  echo "bun não encontrado no PATH." >&2
  exit 1
fi

mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLISTFIM
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$ROTULO</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>$BUN</string><string>run</string><string>local</string>
  </array>
  <key>WorkingDirectory</key><string>$RAIZ</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$LOGS/servidor.log</string>
  <key>StandardErrorPath</key><string>$LOGS/servidor.log</string>
</dict></plist>
PLISTFIM

launchctl bootout "gui/$UID/$ROTULO" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl enable "gui/$UID/$ROTULO"

echo "  serviço instalado: $ROTULO"
echo "  log:    $LOGS/servidor.log"
echo "  acesso: http://127.0.0.1:8790"
