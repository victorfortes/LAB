"""Matriz de cobertura: estado REAL das integrações, mantido junto ao código (atualizar após cada teste)."""
ATUALIZADA_EM = "2026-10-30"

FONTES = [
    {"fonte": "DJEN / Comunica PJe (CNJ)", "sistema": "API REST pública", "url": "https://comunicaapi.pje.jus.br/api/v1/comunicacao",
     "cnpj": "Só como texto (parâmetro texto)", "nome": "Sim (nomeParte)", "partes": "Sim, com polo A/P", "distribuicao": "Parcial (data de disponibilização)",
     "auth": "Não", "restricoes": "Limite ~20 req.; teto de 10.000 resultados por consulta; só vê processos com comunicação publicada",
     "estado": "Parcialmente operacional", "ultimo_teste": "30/10/2026: 62 consultas reais sem falha (CNPJ [CNPJ de teste omitido])"},
    {"fonte": "DataJud (CNJ) — API pública", "sistema": "Elasticsearch, 1 índice por tribunal", "url": "https://api-publica.datajud.cnj.jus.br/",
     "cnpj": "Não", "nome": "Não", "partes": "Não (glossário oficial sem partes)", "distribuicao": "Sim (dataAjuizamento)",
     "auth": "Chave pública do CNJ (pode mudar)", "restricoes": "Lento (10–25 s por consulta; lote de 50 números ≈ poucos s); instabilidade intermitente (TJMG, TJRJ, TRF3 estouraram tempo em 1 teste)",
     "estado": "Parcialmente operacional", "ultimo_teste": "30/10/2026: 664 processos enriquecidos em lote, 0 falhas"},
    {"fonte": "TJSP e-SAJ (consulta pública)", "sistema": "e-SAJ", "url": "https://esaj.tjsp.jus.br/cpopg/open.do", "cnpj": "Não testado",
     "nome": "Não testado", "partes": "Não testado", "distribuicao": "Não testado", "auth": "Possível CAPTCHA", "restricoes": "Busca automática não validada",
     "estado": "Em desenvolvimento", "ultimo_teste": "30/10/2026: página inicial HTTP 200"},
    {"fonte": "PJe consulta pública (TJMG, TRF1, TRT2 e demais)", "sistema": "PJe", "url": "vários", "cnpj": "Não testado", "nome": "Não testado",
     "partes": "Não testado", "distribuicao": "Não testado", "auth": "Possível CAPTCHA", "restricoes": "Busca automática não validada",
     "estado": "Em desenvolvimento", "ultimo_teste": "30/10/2026: páginas iniciais HTTP 200"},
    {"fonte": "eproc (TRF4 e outros)", "sistema": "eproc", "url": "https://eproc.trf4.jus.br/", "cnpj": "Não testado", "nome": "Não testado",
     "partes": "Não testado", "distribuicao": "Não testado", "auth": "Possível CAPTCHA", "restricoes": "Busca automática não validada",
     "estado": "Em desenvolvimento", "ultimo_teste": "30/10/2026: página inicial HTTP 200"},
    {"fonte": "Projudi (TJPR e outros)", "sistema": "Projudi", "url": "https://projudi.tjpr.jus.br/projudi/", "cnpj": "Não testado", "nome": "Não testado",
     "partes": "Não testado", "distribuicao": "Não testado", "auth": "Não testado", "restricoes": "Busca automática não validada",
     "estado": "Em desenvolvimento", "ultimo_teste": "30/10/2026: página inicial HTTP 200"},
    {"fonte": "PDPJ Portal de Serviços", "sistema": "Portal CNJ", "url": "https://portaldeservicos.pdpj.jus.br/consulta", "cnpj": "Não testado",
     "nome": "Não testado", "partes": "Não testado", "distribuicao": "Não testado", "auth": "Provável login gov.br", "restricoes": "Fluxo assistido a definir",
     "estado": "Bloqueada por restrição de acesso", "ultimo_teste": "não testado além da página inicial"},
]
