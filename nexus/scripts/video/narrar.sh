#!/bin/zsh
# Gera a narração (uma faixa por linha de narracao.txt) com a voz do macOS — de graça, sem serviço pago.
#
# Voz de IA mais fluida, sem custo: baixe a voz "Luciana (Aprimorada)" ou "(Premium)" em
#   Ajustes do Sistema > Acessibilidade > Conteúdo Falado > Vozes do sistema > Gerenciar vozes
# (Português do Brasil). São vozes neurais, gratuitas, bem mais naturais que a Luciana padrão.
# Depois é só rodar: o script usa a melhor voz pt-BR instalada (ou a que você indicar em NGA_VOZ).
#
# Uso: scripts/video/narrar.sh <pasta de saída>   (depois: NGA_AUDIO=<pasta> bun scripts/video/gravador.ts)
#      NGA_VOZ="Luciana (Premium)" scripts/video/narrar.sh <pasta>   # força uma voz específica
set -e; OUT=${1:?pasta}; mkdir -p "$OUT"

# Escolhe a voz: a indicada em NGA_VOZ; senão a melhor pt-BR instalada (prefere Aprimorada/Premium); senão Luciana.
if [ -n "$NGA_VOZ" ]; then VOZ="$NGA_VOZ"
else
  VOZ=$(say -v '?' | grep -i 'pt_BR' | grep -iE 'premium|aprimorad|enhanced' | head -1 | sed -E 's/ +[a-z]{2}_[A-Z]{2}.*$//')
  [ -z "$VOZ" ] && VOZ=$(say -v '?' | grep -i 'pt_BR' | grep -i luciana | head -1 | sed -E 's/ +[a-z]{2}_[A-Z]{2}.*$//')
  [ -z "$VOZ" ] && VOZ=$(say -v '?' | grep -i 'pt_BR' | head -1 | sed -E 's/ +[a-z]{2}_[A-Z]{2}.*$//')
fi
VOZ=${VOZ:-Luciana}; echo "voz: $VOZ"

i=0
while IFS= read -r l; do [ -z "$l" ] && continue; i=$((i+1)); say -v "$VOZ" -r 168 --file-format=m4af --data-format=aac -o "$OUT/seg$i.m4a" "$l"; done < "$(dirname "$0")/narracao.txt"
echo "$i faixas em $OUT"
