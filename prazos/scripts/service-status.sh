#!/bin/zsh
LABEL="br.adv.nga.prazos"
launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|pid|last exit" | head -4 || echo "serviço não instalado"
curl -s -m 4 http://127.0.0.1:8787/api/health || echo "sem resposta em :8787"; echo
tail -3 "$HOME/Library/Logs/nga-prazos.log" 2>/dev/null | cut -c1-200
