# 08 · Custos

Valores consultados nas páginas oficiais em **11/10/2026** (podem mudar; reconfirme antes de contratar). Nada foi contratado nem habilitado.

## Serviços e limites do plano gratuito
| Serviço | Uso | Limite gratuito (oficial) | Comportamento ao exceder / risco |
|---|---|---|---|
| **GitHub** (privado) | Código, CI | Repositórios privados ilimitados; minutos de Actions limitados no plano gratuito | CI para; não afeta o sistema em produção |
| **Supabase Free** | Banco, Auth, Edge Function | **500 MB** de banco · 1 GB de arquivos · 50.000 usuários ativos/mês · **5 GB** de tráfego (+5 GB em cache) · 500.000 invocações de função · **2 projetos** gratuitos · logs de 1 dia | Passando o limite, o projeto é limitado/bloqueado até regularizar; **o projeto é pausado após 1 semana sem atividade** |
| **Supabase Free: backups** | Recuperação | **Sem backups automáticos e sem PITR** | Perda de dados em incidente → por isso `backup.mjs` |
| **Cloudflare Pages Free** | Hospedagem estática | 500 builds/mês · 20.000 arquivos/site · 25 MiB por arquivo · 100 domínios | Passando de 500 builds/mês, novas publicações esperam o mês virar; o site no ar continua |
| **Domínio** | URL | Subdomínio `*.pages.dev` gratuito | Domínio próprio é opcional e pago |
| **SMTP próprio** (convites/recuperação) | E-mail | Vários provedores têm plano gratuito (ex.: ~3.000/mês) | O SMTP embutido do Supabase é muito limitado; sem SMTP próprio, convites falham em volume |

## Estimativa de uso do NGA
- Tamanho de um relatório PDF: 60 a 110 KB (≈ 80 a 150 KB em base64 no banco). **500 MB ≈ 3.000 a 5.000 relatórios**, mais cadastros (poucos KB cada). Para um escritório com dezenas de clientes e relatórios mensais, **cabe com folga por anos**.
- Tráfego: abrir o gerador baixa ≈ 2,8 MB (cacheável pelo navegador); 10 usuários × 20 acessos/dia ≈ 0,6 GB/mês.
- Sincronização: consulta incremental a cada 10 s por aba aberta (aba oculta não consulta); volume de requisições baixo para 10 a 20 usuários.

## Quando pensar em pagar (decisão do escritório)
1. **Supabase Pro (a partir de US$ 25/mês):** backups diários, 8 GB, sem pausa. **Recomendado** assim que o sistema guardar dados reais de clientes, pelo risco de perda sem backup gerenciado.
2. SMTP transacional pago, se o volume de e-mails crescer.
3. Domínio próprio (ex.: `relatorios.nga.adv.br`).

**Regra seguida:** nenhum recurso pago habilitado. A ausência de backup automático no plano gratuito é um **risco registrado** (não foi contornada com enfraquecimento de segurança); mitigação em `10_MANUTENCAO.md`.
