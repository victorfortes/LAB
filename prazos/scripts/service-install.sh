#!/bin/zsh
# Instala/atualiza o NGA Prazos como serviço do macOS (launchd): sobe ao entrar no Mac e reinicia sozinho se cair.
# O serviço roda de uma CÓPIA em ~/NGA/prazos (o macOS bloqueia serviços de ler Desktop/Documentos e o caminho tem acento).
# Depois de qualquer alteração no código: rode este mesmo script de novo (sincroniza e reinicia).
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/NGA/prazos"; LABEL="br.adv.nga.prazos"; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"; LOG="$HOME/Library/Logs/nga-prazos.log"
export PATH=$HOME/.bun/bin:$PATH
mkdir -p "$DEST" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
rsync -a --delete --exclude node_modules --exclude .astrea-profile --exclude .nga-vault.json --exclude 'web/dist' --exclude recon-output "$SRC/" "$DEST/"
[ -d "$DEST/.astrea-profile" ] || cp -R "$SRC/.astrea-profile" "$DEST/.astrea-profile" 2>/dev/null || true
[ -f "$DEST/.nga-vault.json" ] || cp "$SRC/.nga-vault.json" "$DEST/.nga-vault.json" 2>/dev/null || true
chmod 600 "$DEST/.nga-vault.json" 2>/dev/null || true
(cd "$DEST" && bun install --frozen-lockfile >/dev/null 2>&1 || bun install >/dev/null 2>&1)
chmod +x "$DEST"/scripts/*.sh
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$DEST/scripts/service-run.sh</string></array>
  <key>WorkingDirectory</key><string>$DEST</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
pkill -9 -f "bun src/server/main.ts" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
echo "Serviço instalado: $LABEL  | código em $DEST | log em $LOG"
