SET search_path = nga_lab, public;

-- Entregas confirmadas que aguardam a identificação do projeto pela Controladoria.
CREATE TABLE prazos_astrea_pendentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  integracao_id UUID NOT NULL REFERENCES integracoes(id) ON DELETE RESTRICT,
  numero_processo TEXT NOT NULL,
  externo_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, externo_id)
);

CREATE INDEX prazos_astrea_pendentes_processo ON prazos_astrea_pendentes(organizacao_id, numero_processo);

ALTER TABLE prazos_astrea_pendentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE prazos_astrea_pendentes FORCE ROW LEVEL SECURITY;

CREATE POLICY prazos_astrea_pendentes_ler ON prazos_astrea_pendentes FOR SELECT USING (
  EXISTS (SELECT 1 FROM vinculos v WHERE v.organizacao_id = prazos_astrea_pendentes.organizacao_id
    AND v.usuario_id = app_usuario_id() AND v.revogado_em IS NULL
    AND v.papel IN ('socio_administrador', 'controladoria'))
);

CREATE POLICY prazos_astrea_pendentes_receber ON prazos_astrea_pendentes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM integracoes i WHERE i.id = prazos_astrea_pendentes.integracao_id
    AND i.organizacao_id = prazos_astrea_pendentes.organizacao_id
    AND i.usuario_id = app_usuario_id() AND i.revogada_em IS NULL
    AND i.aplicacao = 'prazos' AND 'prazos' = ANY(i.escopos))
);

-- ON CONFLICT também verifica a visibilidade do recebimento pela credencial emissora.
CREATE POLICY prazos_astrea_pendentes_reentregar ON prazos_astrea_pendentes FOR SELECT USING (
  EXISTS (SELECT 1 FROM integracoes i WHERE i.id = prazos_astrea_pendentes.integracao_id
    AND i.organizacao_id = prazos_astrea_pendentes.organizacao_id
    AND i.usuario_id = app_usuario_id() AND i.revogada_em IS NULL
    AND i.aplicacao = 'prazos' AND 'prazos' = ANY(i.escopos))
);

CREATE POLICY prazos_astrea_pendentes_resolver ON prazos_astrea_pendentes FOR DELETE USING (
  EXISTS (SELECT 1 FROM vinculos v WHERE v.organizacao_id = prazos_astrea_pendentes.organizacao_id
    AND v.usuario_id = app_usuario_id() AND v.revogado_em IS NULL
    AND v.papel IN ('socio_administrador', 'controladoria'))
);

REVOKE ALL ON prazos_astrea_pendentes FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON prazos_astrea_pendentes TO nga_app;

REVOKE ALL ON prazos_astrea_pendentes FROM anon, authenticated;
INSERT INTO schema_migracoes(nome) VALUES ('035_prazos_astrea_pendentes.sql') ON CONFLICT DO NOTHING;
