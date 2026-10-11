# 01 · Auditoria do Artifact original

**Fonte:** artefato `HksuUVxXv21ftK5iF5sFG7`, versão publicada **27** (a mais recente; contrato de runtime 0.2.66), lido com a ferramenta oficial de leitura de artefatos.
**Cópia preservada:** `original/artifact-HksuUVxXv21ftK5iF5sFG7-v27.html` (somente leitura, 2.821.887 bytes, 14.209 linhas).
**SHA-256:** `2d6fab8aa87d4233aa7e3564009dd89adb520108737c30ee4c9dae06b085d8a9` (também em `original/SHA256SUMS`; o build recusa rodar se mudar).

O código-fonte está **completo** no HTML (aplicação de arquivo único, sem backend). Nada foi reconstruído ou inferido.

## 1. Composição
| Item | Valor |
|---|---|
| Scripts embutidos | 33 blocos `<script>` (os maiores: jsPDF ≈ 1,09 MB, pdf.js ≈ 420 KB, pdf.js worker ≈ 320 KB) |
| Módulos próprios (marcadores `MODULO:`) | ui, pintura, extras, dados, equipe, painel, modelos, estudio, projeto, revisional, andamentos, conversor, seletor-mes, verificacao, nuvem |
| Elementos com `id` | 270 · botões 173 |
| Bibliotecas de terceiros embutidas | **jsPDF** (geração de PDF) e **pdf.js** com worker (leitura do PDF do Astrea). Mantidas exatamente como estão. |
| Fontes | Newsreader, Inter e IBM Plex Mono (Google Fonts) + 4 `@font-face` próprios |
| Interfaces globais | `NGA_ABRIR_PDF, NGA_ANDAMENTOS, NGA_AUTH, NGA_CONVERTER, NGA_CTX, NGA_EMISSOES, NGA_EQUIPE, NGA_ESTUDIO, NGA_EXTRAS, NGA_MODELOS, NGA_NUVEM, NGA_PAINEL, NGA_PINTURA, NGA_PROJETO, NGA_REVISIONAL(_CALC/_PDF/_RESUMO_PDF), NGA_SAVE, NGA_SELETOR_MES, NGA_UI, NGA_VERIFICAR, NGA_VISOR`, entre outras |

## 2. Persistência existente
- **IndexedDB** `nga_plataforma` (v3), um repositório por tipo: `clientes, regras, relatorios, negociacoes, marcos, emissoes, modelos, projetos` (+ `pdfs` para o binário dos PDFs).
- **localStorage/sessionStorage:** `nga.livre.v1` (Criação livre), `nga.leitura.v1` (cache de leitura), `nga_bacen_<código>` (cache da série Bacen), `nga.acesso.*` (PIN), `nga_auth_*` (login local).
- **Sincronização compartilhada** (classe `Sync`): seis coleções (`clientes, regras, relatorios, emissoes, modelos, projetos`) mais `pdfs` (PDFs em pedaços de ≤170.000 caracteres base64, limite de 256 KiB por documento). Vem com **consulta incremental a cada 10 s** e exclusão lógica.
- **Backup manual** em JSON (`nga-backup`, v1) de oito repositórios.

## 3. Recursos exclusivos do ambiente de Artifacts (e como foram tratados)
| Recurso do Claude | Uso no original | Tratamento na migração |
|---|---|---|
| `claude.use("db")` | Banco compartilhado do artefato | **Já havia** um módulo `nuvem` (Supabase, tabela `documentos`) pronto para hospedagem externa. Usado como está. |
| `claude.use("user")` | Identidade e papel (dono/editor) | Substituído pelo Supabase Auth + tabela `perfis`; o papel entra na sessão que o original já sabe ler. |
| `claude.use("downloads")` | Salvar arquivo | O original já tem caminho próprio de download (blob) fora do Claude. Sem alteração. |
| `claude.use("sample")` | Redigir parágrafo com IA | **Desaparece fora do Claude**, e o original já trata isso (mostra "a redação com IA só funciona com o sistema aberto dentro do Claude"). **Nenhum dado jurídico é enviado a serviço de IA.** Ver pendência P-3 em `11_RESULTADO_FINAL.md`. |

## 4. Chamadas de rede do original
1. `fonts.googleapis.com` / `fonts.gstatic.com` → **removido** (fontes agora locais, patch P1).
2. `api.bcb.gov.br` e `dadosabertos.bcb.gov.br` → **mantido** (série Bacen/SGS do laudo revisional; é recurso funcional). Liberado na CSP.
3. `cdnjs.cloudflare.com` (pdf.js worker 3.11.174 e pdfobject 2.1.1) → só alternativas de contingência; liberado na CSP, não usado no caminho normal.
4. Módulo `nuvem` → Supabase (`/rest/v1/documentos`).

## 5. Achados de segurança no original (corrigidos na migração)
- **S-1 (alto):** conta de administrador padrão `admin@nga.adv.br` com senha fixa em texto no código (`sha256("nga2026")`), recriada automaticamente. → **Removida (patch P2)**; teste automatizado garante que não existe mais.
- **S-2 (médio):** o "login" e o "PIN" do original são trancas de tela **no navegador** (hash em localStorage), sem valor como controle de acesso. → Substituídos por autenticação de servidor + RLS.
- **S-3 (médio):** no Artifact, qualquer pessoa logada no Claude com o link lia toda a carteira, e os papéis só valiam na interface. → Papéis agora aplicados no banco (`05_SEGURANCA.md`).
- **S-4 (baixo):** dados do gerador ficavam no navegador após o uso. → Limpeza ao sair e ao trocar de usuário.

## 6. Inventário funcional
Ver `03_MATRIZ_FUNCIONAL.md` (identificadores F-001 em diante).
