# NGA Lab

Os projetos de tecnologia do NGA Advogados, escritório de insolvência.

Cada pasta é um projeto independente, com sua própria stack, seus próprios
testes e seu próprio ciclo. Eles **não compartilham código**: o que atravessa
de um para outro é artefato — processo, prazo, documento —, por contrato HTTP
explícito. A decisão foi deliberada; absorver tudo numa aplicação só exigiria
reescrever o que já funciona.

| Pasta | O que é | Stack | Estado |
|---|---|---|---|
| [`nexus/`](nexus) | A plataforma: núcleo de insolvência, portal do cliente, análise documental, acervo, processos e relatórios | Bun · TypeScript · PostgreSQL | 587 testes · é aqui que os outros entregam |
| [`sentinela/`](sentinela) | Monitora novas ações contra clientes pelo DJEN e DataJud | Python · SQLite | Cópia — o repositório oficial é [victorfortes/Sentinela](https://github.com/victorfortes/Sentinela) |
| [`prazos/`](prazos) | Agendamento e auditoria de prazos, integrado ao Astrea | Bun · TypeScript · React | 58 testes · leitura real do Astrea verificada; escrita não liberada |
| [`integra/`](integra) | Captura a íntegra dos autos, divide em partes e dispara a triagem | Bun · TypeScript · Playwright | Divisão de PDF testada em autos reais; captura em tribunal não exercitada |
| [`bi-de-prazos/`](bi-de-prazos) | Painel de prazos entregue | HTML estático | Artefato, sem código-fonte de geração |

## O que está ligado a quê

O Nexus recebe pelas rotas `/api/integracao/*`, com credencial de escopo
limitado e usuário de serviço sob as mesmas regras de isolamento que valem
para pessoas.

- **Sentinela → Nexus**: ligado. `sentinela nexus-enviar` entrega processo e
  movimentação, e só o que foi confirmado por pessoa.
- **Prazos → Nexus**: não ligado. O Nexus já recebe em
  `POST /api/integracao/prazos`.
- **Íntegra → Nexus**: não ligado. O Nexus já recebe em
  `POST /api/integracao/documentos`.

## Antes de confiar em qualquer número daqui

O estado real de cada módulo do Nexus está em `nexus/src/server/modulos.ts` e
aparece na própria interface. O que não foi construído, ou foi construído e
não exercitado contra o serviço real, está declarado lá, no `nexus/README.md`
e no `nexus/INVENTARIO.md` — inclusive o que não funciona.
