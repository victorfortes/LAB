# Automação "Astrea → Prazos (18h)": enviar também ao Nexus

O BI de Prazos do Nexus mostra **o mesmo painel** do artefato "Controle de prazos - NGA ADV", lendo o banco do
Nexus. A automação diária continua igual (Passos 1 a 6); só ganha dois passos de envio. Nada muda no artefato.

## 1. Credencial (uma vez)

No Nexus: **Ajustes → Geral → Integrações → Nova credencial**, aplicação `prazos`, "O que pode entregar":
**automação do Astrea (BI de Prazos + publicações)**. O token (`nga_int_...`) aparece uma vez. No computador da automação (Windows), salve-o em:

```
C:\Users\Victor\.nga\nexus_token.txt
```

Endereço da API: `https://nga-lab-launchpad.lovable.app` (o mesmo do Nexus).

## 2. Texto para acrescentar às instruções da tarefa (depois do PASSO 5)

```
PASSO 5B: Enviar a mesma base ao Nexus (BI de Prazos dentro do sistema)
1. Leia o token em C:\Users\Victor\.nga\nexus_token.txt (não mostre o token em nenhuma mensagem).
2. Com Python via Bash, faça POST em https://nga-lab-launchpad.lovable.app/api/integracao/agenda com os cabeçalhos
   "Authorization: Bearer <token>" e "Content-Type: application/json" e o corpo
   {"updatedAt": <o mesmo updatedAt do Passo 4.8>, "rows": <a MESMA lista final completa do Passo 5.2>}.
3. Resposta 201 traz {"total", "prazos", "eventos", "antes"}: inclua esses números na notificação final.
4. Resposta 400 com "menos de 90%" é a trava de segurança do Nexus: NÃO reenvie com "forcar"; avise no push.
5. Qualquer outra falha (401, 5xx, sem rede): avise no push que o artefato foi atualizado mas o Nexus não.
   Este passo nunca desfaz nem bloqueia os Passos 4 e 5.

PASSO 5C: Publicações do dia no Astrea (para a conferência Astrea × Nexus)
1. No Chrome, abra https://astrea.net.br/#/main/publications (ou o menu "Publicações"). Se pedir login, PARE e
   envie push. Nunca digite senha.
2. Filtre a data de hoje (e, se for segunda-feira, desde a sexta). Leia com get_page_text cada publicação:
   data, número do processo, tribunal, órgão, um resumo (até 500 caracteres) e o prazo, se o Astrea mostrar.
3. Faça POST em https://nga-lab-launchpad.lovable.app/api/integracao/publicacoes-astrea com o mesmo token e o
   corpo {"publicacoes": [{"data": "DD/MM/AAAA", "numero": "...", "tribunal": "...", "orgao": "...",
   "resumo": "...", "prazo": "DD/MM/AAAA"}]}. Lista vazia é válida (dia sem publicação).
4. Inclua na notificação: quantas publicações foram enviadas e a resposta do Nexus.
```

## 3. O que o Nexus faz com isso

- **BI de Prazos**: troca a base inteira na mesma transação (a TV nunca vê metade). Recusa carga menor que 90%
  da atual. A tela relê a cada 2 minutos.
- **TV do escritório**: em BI de Prazos → **Link da TV**, gere o endereço e abra no navegador da TV (F11). Não
  precisa de login e só lê o BI; revogue quando trocar de aparelho.
- **Controladoria → Conferência Astrea × Nexus**: compara, todo dia, os prazos do Astrea (desta base) com os
  prazos do Nexus (mesmo processo, mesma data) e as publicações do Astrea com as do DJEN no Nexus.
