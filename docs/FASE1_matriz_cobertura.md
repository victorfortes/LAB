# NGA Sentinela — Fase 1: investigação das fontes (30/10/2026)

Tudo abaixo foi testado em chamadas reais nesta data, salvo onde marcado "não testado".
Script reproduzível: `tools/probe_sources.py` (evidência em `docs/evidencias/`).
O protótipo `NGA_Sentinela_motor_inicial.zip` **não foi encontrado** no ambiente; o projeto parte do zero.

## Achados principais

1. **DataJud (CNJ) não identifica partes.** Glossário oficial (datajud-wiki.cnj.jus.br/api-publica/glossario)
   não tem campo de parte, polo, nome ou documento. Respostas reais de TJSP, TJMG, TRF1 e TRT2 trazem apenas:
   `numeroProcesso, tribunal, dataAjuizamento, grau, classe, assuntos, orgaoJulgador, sistema, movimentos,
   nivelSigilo, formato`. Serve para **metadados e data de ajuizamento**, nunca para dizer "contra o cliente".
   - Autenticação: chave pública publicada na wiki do CNJ (pode ser trocada a qualquer momento).
   - Endpoint por tribunal: `https://api-publica.datajud.cnj.jus.br/api_publica_<sigla>/_search` (Elasticsearch).
   - Consulta por número retornou o processo com 19 movimentos (teste real, TJSP).
   - `dataAjuizamento` vem como string `yyyyMMddHHmmss`; filtro `range` com `now-2d` NÃO funcionou
     como esperado (devolveu processos de 2021/2023). Usar formato explícito. Pendente de validar.
   - Houve um 429 (fila do Elasticsearch cheia) na primeira chamada; as seguintes passaram. Exige retry com backoff.
2. **DJEN / Comunica PJe (CNJ) é a candidata principal para "quem é parte".** API pública, sem autenticação:
   `https://comunicaapi.pje.jus.br/api/v1/comunicacao`. Cada item traz `numero_processo`, `siglaTribunal`,
   `tipoComunicacao` (inclui "Lista de distribuição"), `data_disponibilizacao`, `nomeClasse`, `link`, texto, e
   `destinatarios[]` com **nome e polo (A = ativo, P = passivo)**.
   - `nomeParte=MAGAZINE LUIZA` → 1.984 comunicações em 3 dias; polo "P" confirmado em item real.
   - `nomeParte=<CNPJ só dígitos>` → 0 resultados: **não busca por CNPJ**.
   - `texto=47.960.950/0001-21` → 29 resultados: busca textual por CNPJ formatado funciona no corpo da comunicação.
   - `numeroDocumento=` foi ignorado (devolveu base inteira): **parâmetro inexistente/sem efeito**. Não usar.
   - Limites: o DJEN só vê processos que geraram comunicação publicada; um processo novo pode aparecer só
     dias depois (citação/intimação). Cobertura por tribunal ainda a medir. Termos de uso e rate limit: a verificar.
3. **Consultas públicas de cada tribunal** (e-SAJ, PJe, eproc, Projudi, PDPJ): as páginas iniciais respondem
   HTTP 200 (TJSP e-SAJ, TJMG PJe, TRF1, TRT2, eproc TRF4, PDPJ, Projudi TJPR), mas a busca por nome/CNPJ
   exige formulário, e muitos usam CAPTCHA. A presença de CAPTCHA **não foi verificada de forma confiável**
   (requer navegador). Conforme a regra do projeto, não será contornado: fluxo de verificação assistida.

## Matriz de cobertura (v0)

| Fonte | Sistema | Busca CNPJ | Busca nome | Partes/polo | Data distrib. | Auth | Estado | Último teste real |
|---|---|---|---|---|---|---|---|---|
| DataJud — todos os 90+ tribunais | API Elasticsearch | Não | Não | **Não** | Sim (`dataAjuizamento`) | Chave pública | Parcialmente operacional (metadados) | 30/10/26: 200 em TJSP, TJMG, TRF1, TRT2; 1×429 |
| DJEN / Comunica PJe | API REST | Só por texto (`texto=`) | Sim (`nomeParte`) | **Sim (A/P)** | Parcial (data de disponibilização; "Lista de distribuição") | Nenhuma | Parcialmente operacional | 30/10/26: 200, polo P confirmado |
| TJSP e-SAJ cpopg | e-SAJ | Não testado | Não testado | Não testado | Não testado | Não testado | Em desenvolvimento | Página inicial 200 |
| TJMG, TRF1, TRT2 (PJe consulta pública) | PJe | Não testado | Não testado | Não testado | Não testado | Possível CAPTCHA | Em desenvolvimento | Página inicial 200 |
| TRF4 eproc | eproc | Não testado | Não testado | Não testado | Não testado | Possível CAPTCHA | Em desenvolvimento | Página inicial 200 |
| TJPR Projudi | Projudi | Não testado | Não testado | Não testado | Não testado | Não testado | Em desenvolvimento | Página inicial 200 |
| PDPJ Portal de Serviços | Portal CNJ | Não testado | Não testado | Não testado | Não testado | Provável login gov.br | Em desenvolvimento | Página inicial 200 |
| Demais tribunais | — | — | — | — | — | — | Não investigado | — |

## Cobertura validada

**0 % de cobertura validada para "ações contra cliente por CNPJ"** até agora. Metodologia a adotar na Fase 3:
para cada tribunal, usar um CNPJ autorizado com processo passivo conhecido e contar como "validado" somente se
o conector o encontrar com polo passivo e data corretos. Ausência de resultado não conta como cobertura.

## Arquitetura resultante (proposta)

Pipeline em dois estágios, que respeita as limitações acima:
1. **Descoberta de partes (DJEN)**: para cada cliente, `nomeParte` (razão social, anteriores, alternativos) +
   `texto` (CNPJ formatado), por janela de datas, paginado, deduplicado por `numero_processo`.
2. **Enriquecimento (DataJud)**: por `numero_processo` → `dataAjuizamento`, classe, assuntos, órgão, sistema;
   isso separa "distribuição nova" de "processo antigo achado agora".
3. Polo passivo só é "confirmado" quando o DJEN lista o cliente com polo P e o CNPJ/nome bate; nome aproximado vai para a Central de Validação.
4. Conectores de tribunais específicos (e-SAJ, PJe, eproc) entram depois como fontes complementares/assistidas.

Stack proposta (a confirmar na Fase 2): Python/FastAPI, PostgreSQL, worker com fila, React/TypeScript, Docker.
Ambiente atual: Python 3.9.6; **sem Node, Docker ou PostgreSQL** instalados (impede rodar o stack completo localmente
sem instalação; ver bloqueios).

## Bloqueios e decisões que dependem do escritório

- Instalar Docker/Node/PostgreSQL neste Mac (ou aceitar SQLite no desenvolvimento local).
- CNPJs autorizados para teste real e, se possível, um número de processo passivo conhecido de cada.
- Termos de uso do DJEN quanto a consulta automatizada diária por cliente (verificar antes de produção).
- Servidor de produção, remetente de e-mail e webhook do Slack.
