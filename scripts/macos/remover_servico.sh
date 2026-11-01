#!/bin/bash
for n in api worker; do
  f="$HOME/Library/LaunchAgents/br.adv.nga.sentinela.$n.plist"
  launchctl unload "$f" 2>/dev/null || true; rm -f "$f"
done
echo "Serviços removidos."
