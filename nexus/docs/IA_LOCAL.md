# IA local sem cobrança por chamada

O LAB oferece um provedor Ollama local como alternativa à API Anthropic. O modelo executa na máquina que hospeda o servidor do LAB. Não há cobrança de API por documento nesse modo; há consumo de memória, CPU e energia dessa máquina. A qualidade depende do modelo e do documento e a revisão do advogado continua necessária.

Configure o ambiente do servidor:

```dotenv
NGA_IA_PROVEDOR=ollama
NGA_MODELO_IA=qwen3:1.7b
NGA_OLLAMA_URL=http://127.0.0.1:11434
```

Instale o Ollama e baixe o modelo escolhido com `ollama pull qwen3:1.7b`. O processo do Ollama precisa estar funcionando no mesmo servidor. Se o LAB estiver hospedado em outra máquina, o Ollama deve rodar nela; o endereço 127.0.0.1 nunca representa o computador do visitante.

O provedor aceita somente o endereço de loopback e recusa modelos com sufixo `:cloud`. Ele pede JSON estruturado, valida os campos e mantém os controles do pipeline de análise: achados sem trecho verificável são descartados e citações não verificadas são identificadas. Falha do serviço ou resposta inválida é gravada como impedimento/falha de IA; não vira um diagnóstico inventado. A triagem determinística continua disponível.

PDFs com texto são extraídos automaticamente. PDFs contendo apenas imagens precisam de OCR; este provedor não adiciona OCR. A ferramenta de pesquisa do projeto busca títulos, textos já extraídos e achados exclusivamente do projeto aberto, sem enviar o conteúdo a buscadores públicos.

Referência da API: https://docs.ollama.com/api/chat
