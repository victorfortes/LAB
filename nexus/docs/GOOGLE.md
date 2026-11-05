# Google Calendar, Meet e Drive

A conexão é da conta do escritório e fica isolada por organização. O app nunca precisa receber a senha Google. O dono da conta autoriza o acesso por OAuth e os tokens permanecem cifrados no banco.

1. No [Google Cloud](https://console.cloud.google.com/), crie ou selecione um projeto.
2. Habilite **Google Calendar API** e **Google Drive API**.
3. Configure a tela de consentimento OAuth. Em modo de teste, inclua a conta do escritório como usuário de teste. Tokens de apps externos em teste podem expirar em 7 dias; publique o app para uso permanente conforme as regras Google.
4. Crie uma credencial OAuth **Aplicativo da Web**. Cadastre o callback exato. Para o servidor local padrão: `http://localhost:8790/api/google/callback`. Se acessa por domínio HTTPS, use esse domínio. O host deve ser o mesmo usado para entrar no LAB.
5. Configure o ambiente do processo servidor (não arquivos servidos ao navegador):

```
NGA_GOOGLE_CLIENT_ID=<ID do cliente OAuth>
NGA_GOOGLE_CLIENT_SECRET=<segredo do cliente OAuth>
NGA_GOOGLE_REDIRECT_URI=http://localhost:8790/api/google/callback
NGA_GOOGLE_TOKEN_KEY=<32 bytes aleatórios, em hexadecimal: 64 caracteres>
```

A chave pode ser gerada localmente com `openssl rand -hex 32`. Guarde cópia segura: trocá-la sem recadastrar as conexões impede decifrar tokens existentes. Não registre a chave no Git.

6. Reinicie o servidor. Entre no LAB como administrador e abra **Calendário → Conectar Google** (ou o bloco Google em Ajustes). Autorize a conta do escritório.

Escopos pedidos: `calendar.events` (eventos da agenda) e `drive.file` (arquivos criados pelo LAB). A integração não pede acesso geral a todos os arquivos do Drive.

## Funcionamento

Eventos sempre têm um projeto, horário de início/fim, marcador e opção de criar Meet. Sem autorização, o evento permanece registrado como pendente; depois de conectar, a rotina tenta enviá-lo. O link Meet é fornecido pelo Google, sujeito às capacidades da conta/agenda. A API exige `conferenceDataVersion=1`; cada evento usa seu identificador estável para evitar duplicação em retentativas.

A migração cria uma fila durável para projetos e arquivos existentes/novos. A cada minuto, o servidor tenta criar a estrutura **NGA LAB → Cliente → Projeto → Documentos do cliente / Documentos do escritório / Relatórios / Processos**. Cada arquivo guarda identificadores próprios do projeto, documento e origem. O conteúdo original fica também em `nga_lab.documento_conteudos`, com hash e acesso subordinado às permissões do documento. A cópia local permanece para compatibilidade e recuperação. PDFs do gerador usam a pasta Relatórios.

Arquivos recebidos do portal entram na pasta de documentos do cliente. Documentos do escritório usam a outra pasta. Registro de referência sem arquivo físico não é enviado como se fosse arquivo.

O consentimento e os segredos OAuth são obrigatórios. O plugin Google conectado ao Codex não fornece ao servidor LAB uma autorização reutilizável.

Documentação: [OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server), [eventos e Meet](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [pastas no Drive](https://developers.google.com/workspace/drive/api/guides/folder).
