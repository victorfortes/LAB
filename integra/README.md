# NGA Íntegra (NGA Lab)

Número CNJ → captura da íntegra → divisão em partes (≤ 20 MB, ≤ 100 págs.) → triagem preliminar com Claude.

```bash
bun install
bun run set-key      # guarda a chave Anthropic no Keychain (digitada no terminal, nunca no chat)
bun run start        # http://127.0.0.1:8792
bun test             # 10 testes
```

## Estado real
| Etapa | Situação |
|---|---|
| Login local, popup do processo, CNJ + tribunal | ✅ testado |
| Divisão ≤ 20 MB com conferência de cobertura e manifesto | ✅ testado (autos reais: 5.878 págs. → 59 partes, 12 s) |
| Trava de tela para token/PIN | ✅ testado (PIN nunca passa pelo app) |
| Captura **importação** (upload de PDFs) | ✅ |
| Captura **assistida** no tribunal (navegador visível, intercepta downloads) | ⚠️ implementada, **não exercitada** em tribunal real |
| Cliques automáticos de busca/exportação (Projudi/Eproc/PJe) | ⛔ não mapeados — exigem sessão real com token |
| Análise Claude (mapa por parte + síntese) | ⚠️ testada só com API simulada; precisa da chave |
| NotebookLM | ⛔ sem API; fora do fluxo automático (pacote manifesto + roteiro serve ao envio manual) |
| Endereços dos tribunais | só TJPR/Projudi foi usado de fato; os demais são `verificado:false` e geram aviso |

Limites a confirmar na conta Anthropic: tamanho/páginas por PDF (padrão `NGA_MAX_PAGES=100`) e modelo (`NGA_CLAUDE_MODEL`).
A divisão regrava os PDFs (assinaturas digitais do original não são preservadas); sem OCR nem índice de eventos.
A triagem é preliminar e exige revisão do advogado.
