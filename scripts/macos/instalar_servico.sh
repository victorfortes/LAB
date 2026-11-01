#!/bin/bash
# Instala o NGA Sentinela como serviço do macOS (launchd): sobe no login, reinicia se cair e impede a suspensão por ociosidade.
# Uso: bash scripts/macos/instalar_servico.sh        | remover: bash scripts/macos/remover_servico.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTES="$HOME/Library/LaunchAgents"
mkdir -p "$AGENTES" "$RAIZ/data"
gerar() {  # $1=nome  $2=comando python
cat > "$AGENTES/br.adv.nga.sentinela.$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>br.adv.nga.sentinela.$1</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>$RAIZ/.venv/bin/python</string><string>-m</string><string>sentinela</string><string>$2</string>
  </array>
  <key>WorkingDirectory</key><string>$RAIZ</string>
  <key>EnvironmentVariables</key><dict><key>SENTINELA_PORT</key><string>8000</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$RAIZ/data/$1.log</string><key>StandardErrorPath</key><string>$RAIZ/data/$1.log</string>
</dict></plist>
PLIST
launchctl unload "$AGENTES/br.adv.nga.sentinela.$1.plist" 2>/dev/null || true
launchctl load "$AGENTES/br.adv.nga.sentinela.$1.plist"
}
gerar api api
gerar worker worker
echo "Serviços instalados. Verifique: launchctl list | grep sentinela  e  http://127.0.0.1:8000"
