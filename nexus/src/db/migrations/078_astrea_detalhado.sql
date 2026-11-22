-- 078: agenda do Astrea lida pela API (22/11/2026). Cada linha passa a trazer o id do Astrea, a providência
-- escrita no Astrea, o local (audiência) e a publicação de origem com o texto, para a tarefa dizer
-- qual é o processo e qual é a publicação.
ALTER TABLE bi_agenda_linhas ADD COLUMN IF NOT EXISTS astrea_id TEXT CHECK (length(astrea_id) <= 40);
ALTER TABLE bi_agenda_linhas ADD COLUMN IF NOT EXISTS detalhe TEXT CHECK (length(detalhe) <= 4000);
ALTER TABLE bi_agenda_linhas ADD COLUMN IF NOT EXISTS local TEXT CHECK (length(local) <= 500);
ALTER TABLE bi_agenda_linhas ADD COLUMN IF NOT EXISTS publicacao_ref TEXT CHECK (length(publicacao_ref) <= 40);
ALTER TABLE bi_agenda_linhas ADD COLUMN IF NOT EXISTS publicacao_data DATE;
ALTER TABLE bi_agenda_linhas ADD COLUMN IF NOT EXISTS publicacao_texto TEXT CHECK (length(publicacao_texto) <= 12000);
CREATE INDEX IF NOT EXISTS idx_bi_agenda_astrea_id ON bi_agenda_linhas (organizacao_id, astrea_id) WHERE astrea_id IS NOT NULL;
