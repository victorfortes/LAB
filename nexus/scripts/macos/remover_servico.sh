#!/bin/bash
# Remove o serviço. Os dados em ~/Library/Application Support/NGA-Nexus
# ficam onde estão: desinstalar o serviço não apaga banco nem acervo.
set -euo pipefail
ROTULO="br.adv.nga.nexus"
launchctl bootout "gui/$UID/$ROTULO" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$ROTULO.plist"
echo "  serviço removido. Os dados continuam em ~/Library/Application Support/NGA-Nexus"
