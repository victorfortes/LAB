-- 040 — Sem o Gerador neste banco, a lista de emissões vem vazia em vez de derrubar a aba Relatórios.
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
EXCEPTION WHEN undefined_column THEN
  -- Instalação local: `public.documentos` é a tabela do próprio LAB, não a do Gerador.
  RETURN;
END $$;
