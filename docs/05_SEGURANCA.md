# 05 · Segurança e confidencialidade

Este sistema trata dados de clientes de um escritório de advocacia. **Nada aqui declara o sistema "seguro" por usar Supabase**: abaixo estão
os controles implementados, o que foi **testado de verdade** e os **riscos residuais**.

## Controles implementados
| Controle | Como | Evidência |
|---|---|---|
| Autenticação individual | Supabase Auth (e-mail + senha); casca bloqueia quem não tem perfil ativo | `auth.spec` (7 testes) |
| Sem cadastro público | Usuários só por convite do administrador (Edge Function). **Exige** desligar "Allow new users to sign up" no Supabase (passo obrigatório em `06`) | Edge Function recusa quem não é admin ativo |
| Autorização no servidor | RLS forçado + gatilhos; `anon` sem privilégio algum | `tests/db` (14) + `authz.spec` (5) |
| Papéis | `admin` / `advogado` / `visualizador`, ver `04_BANCO_DE_DADOS.md` | testes de mutação: enfraquecer qualquer política quebra ≥1 teste |
| Anti-enumeração | Mesma mensagem em login errado, e-mail inexistente e recuperação de senha | `auth.spec` |
| Freio de tentativas | Limite de taxa do Supabase Auth + espera exponencial no cliente (apenas conforto; o limite real é do servidor) | revisão de código |
| Sessão | Token renovado pelo cliente Supabase; **logout automático após 30 min sem uso**; ao sair ou trocar de usuário, apaga IndexedDB e caches locais do gerador | `auth.spec` (logout limpa dados) |
| Conta padrão removida | O original tinha `admin@nga.adv.br` / senha fixa; removida (patch P2) | `auth.spec` |
| Gerador só dentro da casca | Aberto direto, redireciona ao login | `auth.spec` |
| Cabeçalhos | CSP, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, HSTS, `Permissions-Policy`, COOP | `auth.spec` + CSP exercitada em **todos** os testes de interface (o gerador funciona sob a CSP) |
| XSS | Casca monta a tela com `textContent` (sem `innerHTML` com dados); gerador original escapa seus textos; CSP sem origens externas além de Supabase/Bacen | revisão; **sem varredura dinâmica** (ver riscos) |
| CSRF | A API usa token no cabeçalho `Authorization` (não cookies): CSRF clássico não se aplica | desenho |
| Injeção SQL | Acesso via PostgREST (consultas parametrizadas); Edge Function valida entradas | desenho |
| Validação de entrada | `colecao` em lista fechada; documento ≤ 256 KiB; Edge Function valida e-mail, papel, tamanho do nome | `tests/db` |
| Chave secreta fora do navegador | O build **recusa** a chave `service_role`; CI procura tokens no repositório | `scripts/build.py`, `ci.yml` |
| Auditoria | Cada criação/alteração/exclusão/restauração, acesso e mudança de usuário, sem conteúdo | `tests/db`, `persist.spec` |
| Versões | Estado anterior preservado a cada alteração de cadastro | `tests/db`, `persist.spec` |
| Backup cifrado | `scripts/backup.mjs` (AES-256-GCM + scrypt) e restauração testada em banco novo | `tests/db/backup.test.mjs` |
| IA externa | **Nenhuma**: o recurso de IA do original só existe dentro do Claude e fica desligado | `01_AUDITORIA_ORIGINAL.md` |

## Riscos residuais (não resolvidos, com mitigação recomendada)
1. **CSP com `unsafe-inline` e `unsafe-eval`.** O gerador original usa scripts inline e bibliotecas (jsPDF/pdf.js) que exigem isso. Reduz a proteção contra XSS. Mitigação: não permitir conteúdo HTML de terceiros; revisão periódica; migrar para nonces numa fase futura (exige alterar o original).
2. **Sem MFA por padrão.** Recomenda-se ativar MFA/TOTP do Supabase para administradores e exigir senha ≥ 12 caracteres em Authentication > Policies (a tela já exige 12 ao definir a senha, mas a regra definitiva é do servidor).
3. **Plano gratuito do Supabase não tem backup automático nem PITR** e **pausa o projeto após 1 semana sem atividade** (verificado em 11/10/2026). Mitigação: rotina de `backup.mjs` (agendada) e verificação semanal de acesso; avaliar plano pago (`08_CUSTOS.md`).
4. **Last-write-wins.** O gerador original não resolve edição simultânea do mesmo cadastro (a última gravação vence; a anterior fica no histórico de versões).
5. **Dados em claro no banco** (sem criptografia por campo). Disco criptografado pelo provedor; acesso só por RLS.
6. **Dispositivo desbloqueado:** enquanto o usuário está logado, o gerador mantém dados em cache local no navegador (apagados ao sair, por inatividade ou ao trocar de usuário).
7. **E-mails de convite/recuperação:** o SMTP embutido do Supabase tem limite de envios muito baixo; usar SMTP próprio em produção.
8. **Não testados em ambiente real** (só em simulação local fiel): Edge Function de convite, envio de e-mails, políticas do Supabase Auth, limites de taxa. Ver `09_TESTES.md` e `11_RESULTADO_FINAL.md`.

## LGPD e sigilo profissional (checklist, não é parecer jurídico)
- Papéis: o escritório é **controlador**; Supabase (e Cloudflare) são **operadores**: formalizar o DPA de cada um.
- **Região do banco:** desde 12/10/2026 o banco é o projeto `nga-gerador-sp` em **`sa-east-1` (São Paulo)**, criado no plano gratuito, com esquema e RLS aplicados e verificados (teste `supabase/tests/rls_producao.sql`: 33 asserções, 0 falhas). O projeto anterior (`nga-gerador-relatorios`, `us-east-1`, nunca recebeu dado real) foi mantido sem uso; excluí-lo ou pausá-lo é decisão do responsável. Formalizar o DPA com a Supabase continua pendente.
- **Finalidade e minimização:** o sistema guarda o que já constava nos relatórios; não guarda CPF, contas, cheques (decisão já adotada no cadastro de clientes).
- **Acesso por necessidade:** perfis `visualizador` e `advogado`; revisar a lista de usuários ativos trimestralmente (aba Administração).
- **Direitos do titular e retenção:** definir prazo (sugestão: 5 anos) e procedimento de exclusão (`10_MANUTENCAO.md`).
- **Incidentes:** a auditoria identifica quem acessou o quê; definir quem comunica à ANPD/clientes.
- **Ambientes:** desenvolvimento e testes **só com dados sintéticos** (o repositório não contém dado real; o CI barra tokens).
