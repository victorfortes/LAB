-- 033 — Relatórios do Gerador de Relatórios dentro do LAB.
--
-- O Gerador (pasta relatorios/) guarda no MESMO banco, em `public.documentos`, coleções como `emissoes`
-- (um registro por relatório emitido) e `pdfs` (o arquivo, em partes base64). O papel `nga_app` NÃO tem acesso a
-- `public` — isso é deliberado (ver 004 e o teste de isolamento). Estas duas funções são a ÚNICA porta, e só de
-- leitura: devolvem os metadados das emissões e as partes de UM PDF. Nada de `clientes`, `relatorios` (rascunhos)
-- ou `modelos`. Quem decide se a pessoa pode usar é a aplicação (`relatorio.gerar`).
--
-- plpgsql de propósito: se o Gerador não existir neste banco (instalação local, testes), as funções devolvem vazio
-- em vez de falhar na criação.

CREATE TABLE relatorios_gerador_importados (
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  emissao_id     TEXT NOT NULL CHECK (emissao_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  documento_id   UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  importado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  importado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (projeto_id, emissao_id)
);
ALTER TABLE relatorios_gerador_importados ENABLE ROW LEVEL SECURITY;
ALTER TABLE relatorios_gerador_importados FORCE ROW LEVEL SECURITY;
CREATE POLICY relatorios_importados_isolamento ON relatorios_gerador_importados
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
GRANT SELECT, INSERT, DELETE ON relatorios_gerador_importados TO nga_app;

CREATE OR REPLACE FUNCTION relatorios_do_gerador()
RETURNS TABLE (emissao_id TEXT, nome TEXT, cliente TEXT, cliente_id TEXT, modelo TEXT, periodo TEXT,
               paginas INTEGER, tamanho BIGINT, partes INTEGER, gerado_em TIMESTAMPTZ, por TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF to_regclass('public.documentos') IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT d.id::text,
           d.dados->>'nome', d.dados->>'cliente', d.dados->>'clienteId',
           COALESCE(d.dados->>'modeloNome', d.dados->>'modelo'), d.dados->>'periodo',
           NULLIF(d.dados->>'paginas','')::integer, NULLIF(d.dados->>'tamanho','')::bigint,
           NULLIF(d.dados->>'partes','')::integer,
           NULLIF(d.dados->>'gerado_em','')::timestamptz, d.dados->'por'->>'email'
      FROM public.documentos d
     WHERE d.colecao = 'emissoes' AND NOT d.removido AND COALESCE(d.dados->>'status','gerado') = 'gerado'
     ORDER BY NULLIF(d.dados->>'gerado_em','')::timestamptz DESC NULLS LAST
     LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION relatorios_do_gerador() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION relatorios_do_gerador() TO nga_app;

CREATE OR REPLACE FUNCTION partes_pdf_do_gerador(p_emissao TEXT)
RETURNS TABLE (n INTEGER, conteudo_base64 TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_emissao !~ '^[A-Za-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'identificador de emissão inválido'; END IF;
  IF to_regclass('public.documentos') IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT (d.dados->>'n')::integer, d.dados->>'dados'
      FROM public.documentos d
     WHERE d.colecao = 'pdfs' AND NOT d.removido AND d.dados->>'emissao' = p_emissao
     ORDER BY (d.dados->>'n')::integer;
END $$;
REVOKE ALL ON FUNCTION partes_pdf_do_gerador(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partes_pdf_do_gerador(TEXT) TO nga_app;
