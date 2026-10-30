# Playbook de reconhecimento do Astrea (Fase 1)

**Objetivo:** mapear o fluxo real *Publicações → Não tratadas → Acessar publicação → Tratamentos → Adicionar prazo*,
e a localização/edição/conferência de agendamentos, **sem inventar seletores, campos ou endpoints** e **sem salvar dados reais**.

## Pré-requisitos
- Você tem acesso legítimo ao Astrea e fará o login **manualmente** (incluindo MFA/CAPTCHA, se houver).
- Use uma conta/escritório de **teste** se possível. `bunx playwright install chromium` (uma vez).

## Execução
```bash
ASTREA_BASE_URL="<URL do Astrea que você usa>" bun run recon
# opcional: --with-aria (inclui árvore de acessibilidade mascarada)  --allow-post=<regex>
```
1. Na janela aberta, faça login. O script **não** toca em credenciais.
2. Navegue até cada tela abaixo e digite o nome do passo no terminal + Enter:
   `01-publicacoes-lista` · `02-nao-tratadas` · `03-acessar-publicacao` · `04-tratamentos` ·
   `05-adicionar-prazo-formulario` · `06-localizar-agendamento` · `07-editar-agendamento-formulario` · `08-conferir-agendamento`
3. **Nos formulários (05 e 07) abra e NÃO salve.** Mesmo que clique em salvar, requisições não-GET são bloqueadas e listadas em `blockedMutations`.
4. Digite `q`. A saída fica em `recon-output/<data>/steps.json` (gitignored): URL normalizada (sem query), atributos
   estruturais dos elementos (id, name, role, aria-label, data-testid, tipo, placeholder), texto curto mascarado, e a rede observada (método + caminho normalizado + status).

## Se o Astrea lê dados por POST
Os bloqueios aparecem em `blockedMutations`. Se algum for claramente uma **leitura** (ex.: busca), reexecute com
`--allow-post='<regex do caminho normalizado>'` — decisão sua, caso a caso.

## O que fazer com o resultado
1. Revise `steps.json` (já mascarado) e transcreva o mapa para `docs/ASTREA-MAP.md` (campos obrigatórios do "Adicionar prazo",
   opções de tipo/responsável, forma de localizar agendamentos, como ler o resultado, existência de campo livre para o marcador `[NGA:...]`).
2. Só então preencha `config/selectors.json` — cada seletor com `evidence` (passo + arquivo) e `confirmedAt`.
3. Implemente `LiveAstrea` sobre seletores confirmados; valide primeiro as **leituras** em conta de teste; só depois, e com
   autorização explícita por escrito de um teste controlado, habilite escrita (`NGA_WRITE_ENABLED=true` + autorização na UI).
4. Aponte a mim os trechos relevantes (sem dados reais) e eu implemento o adaptador.
