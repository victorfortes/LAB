# Gerador de Relatórios NGA

Projeto independente destinado à migração integral de uma aplicação
originalmente existente como Artifact do Claude.

## Estado atual

Estrutura inicial mínima. Nenhuma funcionalidade de geração de relatórios foi
implementada — o código-fonte original será fornecido posteriormente e a
migração funcional acontecerá nessa etapa.

## Arquitetura prevista

- **React + TypeScript** (TanStack Start, Tailwind CSS)
- **Supabase (Lovable Cloud)** — integração preparada, ainda não habilitada:
  - Autenticação individual
  - Armazenamento privado de relatórios
- **Versionamento no GitHub** — via integração nativa do Lovable
- **Arquitetura modular** — preparada para futura integração ao NGA Nexus

## Desenvolvimento

```sh
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
