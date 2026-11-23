#!/bin/zsh
# Gera a narração (uma faixa por linha de narracao.txt) com a voz do macOS.
# Uso: scripts/video/narrar.sh <pasta de saída>   (depois: NGA_AUDIO=<pasta> bun scripts/video/gravador.ts)
set -e; OUT=${1:?pasta}; mkdir -p "$OUT"; i=0
while IFS= read -r l; do [ -z "$l" ] && continue; i=$((i+1)); say -v Luciana -r 172 --file-format=m4af --data-format=aac -o "$OUT/seg$i.m4a" "$l"; done < "$(dirname "$0")/narracao.txt"
echo "$i faixas em $OUT"
