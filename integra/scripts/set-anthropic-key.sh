#!/bin/bash
# Guarda a chave da API Anthropic no Keychain (serviço nga-integra-anthropic). A chave é digitada aqui, nunca no chat.
set -e
read -r -s -p "Chave da API Anthropic: " KEY
echo
[ -n "$KEY" ] || { echo "Chave vazia."; exit 1; }
security add-generic-password -U -s nga-integra-anthropic -a "$USER" -w "$KEY"
echo "Chave salva no Keychain."
