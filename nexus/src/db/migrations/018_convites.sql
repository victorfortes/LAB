-- 018 — Convite de cliente para o portal.
--
-- Até aqui o portal só existia semeando o banco à mão: não havia como a equipe
-- dar acesso a um cliente pela própria plataforma. Criar o acesso exige inserir
-- em `usuarios` e `organizacoes`, que o papel da aplicação não alcança — e está
-- certo, senão qualquer requisição criaria conta. A saída é a mesma das
-- migrações 006 e 016: função de SUPERFÍCIE MÍNIMA, que só sabe fazer UMA
-- coisa, e a faz depois de conferir quem pede.
--
-- O que a torna segura não é quem a chama, é o que ela se recusa a fazer:
--   - o papel concedido é sempre `cliente_administrador`, nunca outro;
--   - só convida para projeto de uma organização que o chamador alcança;
--   - se o projeto já tem portal, o convidado entra na MESMA organização
--     cliente — não cria uma segunda, que veria os mesmos dados sem ser a
--     mesma casa.

CREATE OR REPLACE FUNCTION convidar_cliente(
  p_projeto UUID, p_organizacao_nome TEXT, p_email TEXT, p_nome TEXT, p_senha_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org_projeto UUID;
  v_org_cliente UUID;
  v_usuario UUID;
BEGIN
  SELECT organizacao_id INTO v_org_projeto FROM projetos WHERE id = p_projeto;
  IF v_org_projeto IS NULL OR v_org_projeto NOT IN (SELECT app_organizacoes_visiveis()) THEN
    RAISE EXCEPTION 'projeto fora do alcance de quem convida';
  END IF;

  IF EXISTS (SELECT 1 FROM usuarios WHERE email = lower(p_email)) THEN
    RAISE EXCEPTION 'e-mail já cadastrado';
  END IF;

  SELECT organizacao_cliente_id INTO v_org_cliente
    FROM portais WHERE projeto_id = p_projeto ORDER BY criado_em LIMIT 1;

  IF v_org_cliente IS NULL THEN
    INSERT INTO organizacoes (tipo, nome) VALUES ('cliente', p_organizacao_nome)
      RETURNING id INTO v_org_cliente;
    INSERT INTO portais (projeto_id, organizacao_cliente_id, criado_por)
      VALUES (p_projeto, v_org_cliente, app_usuario_id());
  ELSE
    -- Portal desligado volta a valer ao convidar: convidar é pedir acesso.
    UPDATE portais SET ativo = TRUE WHERE projeto_id = p_projeto AND organizacao_cliente_id = v_org_cliente;
  END IF;

  INSERT INTO usuarios (email, nome, senha_hash) VALUES (lower(p_email), p_nome, p_senha_hash)
    RETURNING id INTO v_usuario;
  INSERT INTO vinculos (usuario_id, organizacao_id, papel)
    VALUES (v_usuario, v_org_cliente, 'cliente_administrador');

  RETURN v_usuario;
END;
$$;

REVOKE ALL ON FUNCTION convidar_cliente(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convidar_cliente(UUID, TEXT, TEXT, TEXT, TEXT) TO nga_app;

-- Quem tem acesso ao portal de um projeto. A equipe não lê `usuarios` do
-- cliente (outra organização), mas precisa saber a quem deu acesso.
CREATE OR REPLACE FUNCTION portal_do_projeto(p_projeto UUID)
RETURNS TABLE (
  organizacao_id UUID, organizacao_nome TEXT, ativo BOOLEAN,
  mostra_documentos BOOLEAN, mostra_obrigacoes BOOLEAN, mostra_financeiro BOOLEAN,
  mostra_processos BOOLEAN,
  usuario_id UUID, usuario_nome TEXT, usuario_email TEXT, ultimo_acesso TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.organizacao_cliente_id, o.nome, po.ativo,
         po.mostra_documentos, po.mostra_obrigacoes, po.mostra_financeiro, po.mostra_processos,
         u.id, u.nome, u.email, u.ultimo_acesso
    FROM portais po
    JOIN projetos pr ON pr.id = po.projeto_id
    JOIN organizacoes o ON o.id = po.organizacao_cliente_id
    LEFT JOIN vinculos v ON v.organizacao_id = po.organizacao_cliente_id AND v.revogado_em IS NULL
    LEFT JOIN usuarios u ON u.id = v.usuario_id
   WHERE po.projeto_id = p_projeto
     AND pr.organizacao_id IN (SELECT app_organizacoes_visiveis())
$$;

REVOKE ALL ON FUNCTION portal_do_projeto(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_do_projeto(UUID) TO nga_app;
