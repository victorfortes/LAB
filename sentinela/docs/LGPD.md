# Proteção de dados (LGPD) — medidas e pendências

Base legal provável: exercício regular de direitos em processo judicial e legítimo interesse do escritório (art. 7º, VI e IX;
art. 11, II, "d" para dados sensíveis eventualmente presentes). **Validação jurídica do encarregado/escritório pendente.**

Implementado: fontes exclusivamente públicas; acesso autenticado com papéis; trilha de auditoria; segredos fora do banco e do
código; senhas com hash PBKDF2; limite de tentativas de login; painel ligado só a `127.0.0.1` por padrão; textos de comunicações
exibidos com escape (sem execução de HTML); nenhuma chave nem dados reais no repositório (`data/` ignorado).

Minimização: guardamos apenas nome e polo das partes e o texto da comunicação pública. Partes pessoas físicas (autores)
aparecem nesses textos. Configuração `retencao.comunicacoes_dias` (padrão 730) existe, **mas a rotina de expurgo ainda não foi
implementada**.

Pendências: rotina de expurgo; política de resposta a titulares; criptografia do arquivo do banco em repouso (usar disco
criptografado no servidor); HTTPS obrigatório no proxy; revisão do uso de IA externa (o texto das comunicações seria enviado à
API da Anthropic quando `ANTHROPIC_API_KEY` estiver definida — decidir antes de ativar).
