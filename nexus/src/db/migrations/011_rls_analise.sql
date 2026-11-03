-- 011 — RLS da análise documental.
--
-- NÃO HÁ POLÍTICA DE PORTAL AQUI, e isso é deliberado.
--
-- Análise documental é trabalho interno da NGA: é onde se registra a suspeita,
-- a inconsistência, a cláusula que vai ser atacada. O §13 manda separar dado
-- interno da NGA de informação disponibilizada ao cliente, e esta é a parte
-- mais claramente interna de todas. Mesmo o texto extraído de um documento JÁ
-- PUBLICADO fica interno: o cliente lê o documento publicado, não o derivado
-- que a NGA produziu sobre ele.
--
-- Para o cliente ver uma conclusão de análise, alguém da NGA tem de publicar
-- um documento — passando pelo `portal.publicar` da migração 009. Não existe
-- outro caminho, e é essa ausência de caminho que constitui a garantia.

ALTER TABLE documento_textos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_textos FORCE ROW LEVEL SECURITY;
CREATE POLICY textos_isolamento ON documento_textos
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

ALTER TABLE analises ENABLE ROW LEVEL SECURITY;
ALTER TABLE analises FORCE ROW LEVEL SECURITY;
CREATE POLICY analises_isolamento ON analises
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

ALTER TABLE achados ENABLE ROW LEVEL SECURITY;
ALTER TABLE achados FORCE ROW LEVEL SECURITY;
CREATE POLICY achados_isolamento ON achados
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));

GRANT SELECT, INSERT, UPDATE, DELETE ON documento_textos, analises, achados TO nga_app;
