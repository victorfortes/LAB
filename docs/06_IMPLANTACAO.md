# 06 · Implantação (passo a passo)

Tudo abaixo depende de **contas do escritório** (GitHub, Supabase, Cloudflare) que o assistente não pôde criar nem acessar. Tudo o mais já está pronto no repositório.
Tempo estimado: 1 a 2 horas.

## 0. Pré-requisitos
- Conta **GitHub** do escritório (organização) · conta **Supabase** · conta **Cloudflare** (todas gratuitas).
- Um cofre de senhas (guardar senha do banco, chaves e a frase de backup).
- Node 22 e Python 3 instalados na máquina de quem publica.

## 1. Repositório privado (GitHub)
```bash
gh auth login                       # entra na conta do escritório
gh repo create ORGANIZACAO/nga-gerador-relatorios --private --source . --remote origin --push
```
Em *Settings > Branches*, proteger `main` (revisão obrigatória) e ligar *Secret scanning*.

## 2. Supabase
1. **New project**: região **South America (São Paulo)**; guarde a senha do banco no cofre.
2. **Authentication > Providers > Email**: **desligar "Allow new users to sign up"** (obrigatório: não há cadastro público); manter "Confirm email" ligado.
3. **Authentication > Policies**: senha mínima **12**; ligar proteção de senha vazada, se disponível.
4. **Authentication > URL Configuration**: *Site URL* = `https://SEU-SITE.pages.dev` (passo 3) e adicione o mesmo endereço em *Redirect URLs*.
5. **Authentication > SMTP**: configurar SMTP próprio (o embutido tem limite de poucos e-mails por hora).
6. **Banco**: instalar a CLI (`npm i -g supabase` ou `brew install supabase/tap/supabase`) e:
```bash
supabase login
supabase link --project-ref SEU-REF
supabase db push                    # aplica supabase/migrations/*
```
(ou cole `supabase/migrations/20261011000001_base.sql` no SQL Editor).
7. **Primeiro administrador**: *Authentication > Users > Add user > Create new user* (e-mail + senha forte, "Auto Confirm"). Depois, no SQL Editor, rode `supabase/seed_primeiro_admin.sql` trocando o e-mail.
8. **Convites** (Edge Function):
```bash
supabase functions deploy convidar-usuario
supabase secrets set SITE_URL=https://SEU-SITE.pages.dev
```
   (`SUPABASE_URL` e a chave de serviço já existem dentro das funções; **nunca** copie a chave de serviço para o navegador nem para o Git.)
9. Copie *Project URL* e a chave **anon/public** (*Project Settings > API*).
10. Ative **MFA (TOTP)** para os administradores.

## 3. Cloudflare Pages
*Workers & Pages > Create > Pages > Connect to Git* → escolher o repositório.
- **Build command:** `npm ci && python3 scripts/build.py`
- **Build output directory:** `dist`
- **Variáveis de ambiente (Production):** `SUPABASE_URL`, `SUPABASE_ANON_KEY` (só a chave **anon**; o build recusa a secreta).
- Domínio inicial gratuito: `https://NOME.pages.dev`. O arquivo `_headers` aplica CSP e demais cabeçalhos.
- Se a build do Pages não tiver Python 3, use o workflow de GitHub Actions + `wrangler pages deploy dist` (documentado em `10_MANUTENCAO.md`).

## 4. Verificação em produção (checklist)
- [ ] `https://…pages.dev` abre a tela de login com cadeado (HTTPS) e **sem** erro no console.
- [ ] Login do administrador funciona; aparece o botão **Usuários**; criar um convite (e-mail chega; link abre "Defina sua senha").
- [ ] Convidar um *advogado* e um *visualizador*; cada um entra com o papel certo.
- [ ] Visualizador **não** consegue gerar relatório; advogado **não** exclui cliente.
- [ ] Importar `clientes_NGA_importar.json` (Clientes > Importar backup) e conferir que outro usuário vê os clientes.
- [ ] Gerar um relatório e abrir o PDF em **outro** computador/usuário.
- [ ] Em *Administração > Registro de auditoria* aparecem as ações.
- [ ] Executar `node scripts/backup.mjs` e restaurar num projeto de teste (`10_MANUTENCAO.md`).
- [ ] Desligar o cadastro público confirmado: tentar `signUp` direto na API deve falhar.

## 5. Lovable
Não usado na hospedagem do gerador. Motivo (documentação oficial do Lovable, consultada em 11/10/2026): *"You can only export from Lovable to GitHub"* e *"When you connect a project, Lovable creates a new GitHub repository"*. Ou seja, **não importa repositório existente** e recriar o gerador por prompts violaria a exigência de fidelidade. A integração com o NGA Nexus segue por `07_INTEGRACAO_NEXUS.md`.
