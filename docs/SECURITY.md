# Segurança

| Requisito | Implementação | Teste |
|---|---|---|
| Sem segredos no repo | `.env` ignorado; `.env.example` sem valores; `JWT_SECRET` obrigatório (≥ 32 B); senhas de demo efêmeras | — |
| Autenticação | scrypt + salt; JWT HS256 em cookie `HttpOnly; SameSite=Strict` (+`Secure` em produção); limitador de tentativas | `security.test.ts`, `api.test.ts` |
| CSRF | Cabeçalho `X-NGA: 1` obrigatório em métodos mutáveis | `api.test.ts` |
| Permissões por função | `src/security/rbac.ts` (viewer/operator/auditor/admin) aplicado **na camada de serviço**, não só na rota | `security.test.ts`, `flow.test.ts` |
| Histórico imutável | `audit_log` encadeado por hash + triggers que bloqueiam UPDATE/DELETE/TRUNCATE; recomendação de role só-INSERT | `security.test.ts`, `pg.test.ts` |
| Processos autorizados | Publicações de processos fora da lista são descartadas **sem persistir o texto** | `flow.test.ts` |
| Mascaramento | `maskDeep` em logs/auditoria (CPF, CNPJ, e-mail, CNJ, telefone; chaves secretas; textos integrais omitidos) | `security.test.ts` |
| Bloqueio de alterações sem autorização | Escrita exige: flag, perfil, aprovação humana, processo autorizado, autorização ativa com validade ≤ 7 dias; correção exige campo+justificativa+autorização e só toca o agendamento vinculado | `flow.test.ts` |
| Execução concorrente | Índice único parcial + heartbeat | `flow.test.ts`, `pg.test.ts`, `api.test.ts` |
| Sessão expirada | `SessionExpiredError` → `awaiting_login`; sem re-login automático | `flow.test.ts` |
| CAPTCHA/MFA | **Nunca contornados.** O usuário autentica manualmente no navegador do reconhecimento/execução | — |
| Reconhecimento somente leitura | `ctx.route` aborta POST/PUT/PATCH/DELETE ao host do Astrea; saída sem query/valores, mascarada, em `recon-output/` (gitignored) | `recon.test.ts` |

Cabeçalhos: CSP restritiva, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`. API escuta apenas em `127.0.0.1`
(para expor, use proxy reverso com TLS).

## Cofre de credenciais do Astrea e login automático (2026-10-25)

| Item | Implementação |
|---|---|
| Armazenamento | `.nga-vault.json` (gitignored, permissão 600): **AES-256-GCM**, IV aleatório por gravação, AAD = nome do segredo. O arquivo só contém texto cifrado |
| Chave | **Fora do repositório e do arquivo**: `NGA_VAULT_KEY` (base64, 32 bytes) ou **Keychain do macOS** (serviço `nga-prazos-vault`). Sem chave ⇒ erro; **não há fallback em texto claro** |
| Entrada da senha | Só pelo formulário "Acesso Astrea" do app (admin, `127.0.0.1`). **Nunca pelo chat nem por mim (Claude)** |
| Saída | A API **nunca** devolve a senha (só `configurado` e e-mail mascarado `v***@dominio`); a auditoria registra apenas `vault.saved/removed` com e-mail mascarado; logs mascaram chaves `password/senha` |
| Uso | Login automático **só** quando a sessão do Astrea não está ativa e **uma tentativa por vez**; após falha, **não repete por 10 min** (senha errada repetida pode bloquear a conta) |
| MFA / CAPTCHA | **Nunca contornados.** Se a tela mostrar verificação adicional, o robô **não digita nada** e a execução pausa em `awaiting_login` pedindo login manual |
| Guarda de rede | O POST do próprio login passa por uma janela estreita (até 8 requisições, só durante `autoLogin`); fora dela a guarda de somente leitura segue ativa |
| Testes | `vault.test.ts` (cifra, adulteração, chave errada, AAD, permissão 600), `autologin.test.ts` (sucesso, senha errada sem 2ª tentativa, desafio, sem credenciais), `api.test.ts` (só admin; senha nunca na resposta/auditoria) |

Riscos aceitos/assumidos (decisão do responsável): a senha de uma conta do Astrea fica cifrada **neste computador** (quem tiver acesso ao Keychain desbloqueado
e ao arquivo consegue decifrar); recomenda-se **usuário próprio do robô** no Astrea com o menor perfil possível, e confirmar que os **Termos de Uso do Astrea**
permitem acesso automatizado. Trocar a senha no Astrea ⇒ atualizar o cofre.
