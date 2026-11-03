#!/bin/zsh
LABEL="br.adv.nga.prazos"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Serviço removido."
