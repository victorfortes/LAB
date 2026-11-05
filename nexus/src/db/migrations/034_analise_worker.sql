-- Metadados da fila, sem publicar documentos ou resultados.
-- Somente o servidor nga_app pode enumerar documentos pendentes do portal.
CREATE OR REPLACE FUNCTION documentos_de_analise_pendentes(p_limite integer DEFAULT 1)
RETURNS TABLE(documento_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT d.id FROM documentos d
 JOIN projetos p ON p.id=d.projeto_id
 LEFT JOIN documento_processamento dp ON dp.documento_id=d.id
 WHERE d.origem='portal_cliente' AND d.tem_arquivo AND p.situacao<>'encerrado'
 AND (dp.documento_id IS NULL OR dp.estado='na_fila'
      OR (dp.estado='lendo' AND dp.atualizado_em<now()-interval '30 minutes'))
 ORDER BY d.criado_em LIMIT greatest(1,least(coalesce(p_limite,1),5))
$$;
REVOKE ALL ON FUNCTION documentos_de_analise_pendentes(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documentos_de_analise_pendentes(integer) TO nga_app;
