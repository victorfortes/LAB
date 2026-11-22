-- 079: carteira do Astrea lida pela API (22/11/2026). Cada processo ativo do Astrea entra (ou é atualizado)
-- em astrea_registros com o CNPJ/CPF do cliente vindo da ficha do contato. Serve para: (1) o Sentinela
-- vigiar os clientes pessoa jurídica com CNPJ; (2) a conferência "ação nova fora da base" comparar com
-- a carteira de hoje, não com a planilha antiga.
ALTER TABLE astrea_registros ADD COLUMN IF NOT EXISTS cliente_documento TEXT CHECK (length(cliente_documento) <= 20);
ALTER TABLE astrea_registros ADD COLUMN IF NOT EXISTS astrea_cliente_id TEXT CHECK (length(astrea_cliente_id) <= 40);
ALTER TABLE astrea_registros ADD COLUMN IF NOT EXISTS ativo_no_astrea BOOLEAN;
ALTER TABLE astrea_registros ADD COLUMN IF NOT EXISTS lido_api_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_astrea_registros_doc ON astrea_registros (organizacao_id, cliente_documento) WHERE cliente_documento IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_astrea_registros_num ON astrea_registros ((regexp_replace(coalesce(numero_original, ''), '\D', '', 'g')));
