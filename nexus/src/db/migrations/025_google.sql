-- Google credentials remain encrypted at rest; access is restricted to office staff.
CREATE TABLE google_conexoes (
 organizacao_id UUID PRIMARY KEY REFERENCES organizacoes(id),
 usuario_id UUID NOT NULL REFERENCES usuarios(id), credencial TEXT NOT NULL,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE google_oauth_estados (
 hash TEXT PRIMARY KEY, usuario_id UUID NOT NULL REFERENCES usuarios(id),
 organizacao_id UUID NOT NULL REFERENCES organizacoes(id), verificador TEXT NOT NULL,
 expira_em TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE TABLE google_drive_pastas (
 projeto_id UUID PRIMARY KEY REFERENCES projetos(id) ON DELETE CASCADE,
 organizacao_id UUID NOT NULL REFERENCES organizacoes(id),
 pasta_id TEXT NOT NULL, pastas JSONB NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE google_fila (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id),
 projeto_id UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
 documento_id UUID UNIQUE REFERENCES documentos(id) ON DELETE CASCADE,
 tipo TEXT NOT NULL CHECK (tipo IN ('projeto','documento')),
 estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','concluido')),
 google_id TEXT, tentativas INTEGER NOT NULL DEFAULT 0, erro TEXT,
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX google_fila_projeto ON google_fila(projeto_id) WHERE tipo='projeto';
CREATE TABLE google_eventos (
 id UUID PRIMARY KEY, organizacao_id UUID NOT NULL REFERENCES organizacoes(id),
 projeto_id UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
 titulo TEXT NOT NULL, inicio TIMESTAMPTZ NOT NULL, fim TIMESTAMPTZ NOT NULL,
 descricao TEXT NOT NULL DEFAULT '', marcador TEXT NOT NULL DEFAULT 'reuniao',
 criar_meet BOOLEAN NOT NULL DEFAULT TRUE, google_id TEXT, meet_url TEXT, google_url TEXT,
 criado_por UUID NOT NULL REFERENCES usuarios(id), criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(fim > inicio), CHECK(length(titulo) BETWEEN 1 AND 300)
);
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['google_conexoes','google_oauth_estados','google_drive_pastas','google_fila','google_eventos'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY isolamento ON %I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO nga_app',t);
 END LOOP;
END $$;
-- The trigger only enqueues the row being inserted; portal clients never read office credentials.
CREATE FUNCTION google_enfileirar() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='projetos' THEN
  INSERT INTO google_fila(organizacao_id,projeto_id,tipo) VALUES(NEW.organizacao_id,NEW.id,'projeto') ON CONFLICT DO NOTHING;
 ELSIF NEW.tem_arquivo THEN
  INSERT INTO google_fila(organizacao_id,projeto_id,documento_id,tipo) VALUES(NEW.organizacao_id,NEW.projeto_id,NEW.id,'documento') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION google_enfileirar() FROM PUBLIC;
CREATE TRIGGER google_projeto AFTER INSERT ON projetos FOR EACH ROW EXECUTE FUNCTION google_enfileirar();
CREATE TRIGGER google_documento AFTER INSERT ON documentos FOR EACH ROW EXECUTE FUNCTION google_enfileirar();
INSERT INTO google_fila(organizacao_id,projeto_id,tipo) SELECT organizacao_id,id,'projeto' FROM projetos ON CONFLICT DO NOTHING;
INSERT INTO google_fila(organizacao_id,projeto_id,documento_id,tipo) SELECT organizacao_id,projeto_id,id,'documento' FROM documentos WHERE tem_arquivo ON CONFLICT DO NOTHING;
CREATE FUNCTION organizacoes_com_google() RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT organizacao_id FROM google_conexoes $$;
REVOKE ALL ON FUNCTION organizacoes_com_google() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organizacoes_com_google() TO nga_app;

ALTER TABLE publicacoes ADD COLUMN prazo_id UUID REFERENCES prazos(id);
