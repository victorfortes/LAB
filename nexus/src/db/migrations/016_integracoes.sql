-- 016 — Credencial das aplicações do NGA Lab.
--
-- O NGA Prazos, o NGA Íntegra e o NGA Sentinela continuam aplicações próprias.
-- O que entra aqui é o LADO RECEPTOR: por onde elas entregam o que produzem,
-- e com que credencial.
--
-- TRÊS DECISÕES QUE VALEM EXPLICAÇÃO
--
-- 1. A INTEGRAÇÃO TEM UM USUÁRIO DE SERVIÇO, e não um atalho que fura o RLS.
--    Toda ingestão roda em `comoUsuario(usuario_id)` como qualquer requisição
--    humana, então o isolamento entre clientes vale igual. A alternativa —
--    gravar sem contexto de RLS — transformaria a integração no único ponto
--    do sistema onde o §6.1 não se aplica, e seria exatamente por ali que um
--    dado de cliente acabaria no projeto de outro.
--
-- 2. ESCOPO POR APLICAÇÃO. O Sentinela entrega processo; não tem por que
--    poder gravar documento. O escopo é conferido antes do RBAC, e o papel
--    `integracao` já é restrito por si — nenhuma integração publica no portal
--    do cliente, valida crédito ou mexe em financeiro.
--
-- 3. O TOKEN É GUARDADO SÓ EM HASH, como a sessão de gente. Ele aparece uma
--    vez, na criação. Perdeu, gera outro — não há "ver token", porque não há
--    token para ver.

-- O papel das integrações. Restrito de propósito: ver src/security/rbac.ts.
ALTER TABLE vinculos DROP CONSTRAINT vinculos_papel_check;
ALTER TABLE vinculos ADD CONSTRAINT vinculos_papel_check CHECK (papel IN (
  'socio_administrador', 'socio', 'advogado', 'controladoria',
  'financeiro', 'administrativo', 'estagiario',
  'cliente_administrador', 'cliente_usuario', 'parceiro_externo',
  'integracao'));

CREATE TABLE integracoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  -- Usuário de serviço sob o qual a ingestão roda. É o que faz o RLS valer.
  usuario_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  nome           TEXT NOT NULL,
  aplicacao      TEXT NOT NULL
                   CHECK (aplicacao IN ('sentinela', 'integra', 'prazos', 'outra')),
  -- O que esta credencial pode entregar.
  escopos        TEXT[] NOT NULL DEFAULT '{}',
  token_hash     TEXT NOT NULL UNIQUE,

  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ultimo_uso_em  TIMESTAMPTZ,
  -- Quantas entregas esta credencial já fez. Credencial que nunca foi usada
  -- é credencial a revogar.
  usos           INTEGER NOT NULL DEFAULT 0 CHECK (usos >= 0),
  revogada_em    TIMESTAMPTZ,
  revogada_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,

  UNIQUE (organizacao_id, nome),
  CONSTRAINT escopo_declarado CHECK (array_length(escopos, 1) >= 1),
  CONSTRAINT revogacao_identificada CHECK (
    (revogada_em IS NULL AND revogada_por IS NULL)
    OR (revogada_em IS NOT NULL AND revogada_por IS NOT NULL)
  )
);

CREATE INDEX idx_integracoes_ativas ON integracoes(organizacao_id) WHERE revogada_em IS NULL;

ALTER TABLE integracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE integracoes FORCE ROW LEVEL SECURITY;

CREATE POLICY integracoes_isolamento ON integracoes
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

-- ----------------------------------------------------------- autenticação ---
-- Mesmo problema da migração 006 e mesma solução: resolver a credencial
-- acontece ANTES de haver contexto de RLS, então a consulta precisa de uma
-- função com superfície mínima, e não de uma política frouxa em `integracoes`.

CREATE OR REPLACE FUNCTION auth_integracao(p_token_hash TEXT)
RETURNS TABLE (
  integracao_id UUID, organizacao_id UUID, usuario_id UUID,
  nome TEXT, aplicacao TEXT, escopos TEXT[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.organizacao_id, i.usuario_id, i.nome, i.aplicacao, i.escopos
    FROM integracoes i
    JOIN usuarios u ON u.id = i.usuario_id
   WHERE i.token_hash = p_token_hash
     AND i.revogada_em IS NULL
     AND u.ativo
$$;

REVOKE ALL ON FUNCTION auth_integracao(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_integracao(TEXT) TO nga_app;

-- Criar o usuário de serviço é ato administrativo, e `usuarios` não aceita
-- INSERT por papel comum — corretamente, senão qualquer um criaria conta. A
-- saída é a mesma da migração 006: função de SUPERFÍCIE MÍNIMA em vez de
-- política frouxa.
--
-- O que torna esta função segura não é quem a chama, é o que ela recusa
-- fazer: o papel é sempre `integracao`, o e-mail tem de estar no domínio
-- reservado, e não há parâmetro algum que permita criar uma conta de pessoa
-- ou um sócio administrador. Mesmo chamada indevidamente, o pior que produz é
-- mais uma integração — que aparece na listagem e se revoga.
CREATE OR REPLACE FUNCTION criar_usuario_de_servico(
  p_email TEXT, p_nome TEXT, p_senha_hash TEXT, p_organizacao_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_email !~ '^integracao\+[^@]+@nga\.local$' THEN
    RAISE EXCEPTION 'usuário de serviço precisa de e-mail no domínio reservado';
  END IF;

  INSERT INTO usuarios (email, nome, senha_hash)
    VALUES (p_email, p_nome, p_senha_hash)
    RETURNING id INTO v_id;

  INSERT INTO vinculos (usuario_id, organizacao_id, papel)
    VALUES (v_id, p_organizacao_id, 'integracao');

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION criar_usuario_de_servico(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION criar_usuario_de_servico(TEXT, TEXT, TEXT, UUID) TO nga_app;

CREATE OR REPLACE FUNCTION integracao_marcar_uso(p_id UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE integracoes SET ultimo_uso_em = now(), usos = usos + 1 WHERE id = p_id
$$;

REVOKE ALL ON FUNCTION integracao_marcar_uso(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integracao_marcar_uso(UUID) TO nga_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON integracoes TO nga_app;
