-- 067 — Pauta das reuniões (preenchida no convite), onboarding visual do projeto e alerta do Sentinela no portal.

-- Pauta: lista de itens {texto, responsavel, minutos, feito, decisao}. Vai na descrição do convite do Google.
ALTER TABLE google_eventos ADD COLUMN IF NOT EXISTS pauta JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(pauta) = 'array' AND jsonb_array_length(pauta) <= 40);
ALTER TABLE google_eventos ADD COLUMN IF NOT EXISTS pauta_atualizada_em TIMESTAMPTZ;

-- Onboarding: cada etapa do roteiro com suas tarefas; o progresso é marcado por pessoa e por data.
CREATE TABLE onboarding_itens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  etapa          TEXT NOT NULL CHECK (length(btrim(etapa)) BETWEEN 2 AND 120),
  ordem_etapa    INTEGER NOT NULL DEFAULT 0,
  titulo         TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 2 AND 300),
  ordem          INTEGER NOT NULL DEFAULT 0,
  responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  prazo          DATE,
  -- Quem precisa agir: equipe NGA ou o cliente (aparece no portal).
  lado           TEXT NOT NULL DEFAULT 'nga' CHECK (lado IN ('nga','cliente')),
  -- Sinal automático que conclui o item sozinho (ex.: 'whatsapp', 'checklist', 'fatura'); nulo = só manual.
  chave          TEXT,
  descricao      TEXT CHECK (length(descricao) <= 1000),
  feito_em       TIMESTAMPTZ,
  feito_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_onboarding_projeto ON onboarding_itens(projeto_id, ordem_etapa, ordem);

-- Avisos ao cliente no portal (hoje: nova ação encontrada pelo Sentinela). Nasce como rascunho,
-- a NGA confirma o texto e só então o cliente vê, se o envio automático não estiver ligado.
CREATE TABLE portal_avisos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  origem         TEXT NOT NULL CHECK (origem IN ('sentinela','manual')),
  chave          TEXT NOT NULL,
  titulo         TEXT NOT NULL CHECK (length(titulo) <= 300),
  texto          TEXT NOT NULL CHECK (length(texto) <= 4000),
  dados          JSONB NOT NULL DEFAULT '{}',
  situacao       TEXT NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho','publicado','descartado')),
  publicado_em   TIMESTAMPTZ,
  publicado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  lido_em        TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, chave)
);
-- Liga/desliga por projeto: publicar sozinho (sem conferência) o aviso do Sentinela.
ALTER TABLE projetos ADD COLUMN IF NOT EXISTS sentinela_aviso_automatico BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['onboarding_itens','portal_avisos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %1$I_iso ON %1$I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t);
    EXECUTE format('CREATE POLICY %1$I_equipe ON %1$I AS RESTRICTIVE USING (NOT app_equipe_restrita() OR projeto_id IN (SELECT app_projetos_da_pessoa()) OR projeto_id IN (SELECT app_projetos_do_portal()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- O cliente vê só o que foi publicado no próprio portal, e marca como lido; o onboarding dele, só o lado "cliente".
CREATE POLICY portal_avisos_cliente ON portal_avisos FOR SELECT USING (situacao = 'publicado' AND projeto_id IN (SELECT app_projetos_do_portal()));
CREATE POLICY portal_avisos_cliente_ler ON portal_avisos FOR UPDATE USING (situacao = 'publicado' AND projeto_id IN (SELECT app_projetos_do_portal())) WITH CHECK (situacao = 'publicado');
CREATE POLICY onboarding_cliente ON onboarding_itens FOR SELECT USING (lado = 'cliente' AND projeto_id IN (SELECT app_projetos_do_portal()));

-- Quando o Sentinela confirma (ou acha provável) uma ação contra um cliente, gera o aviso no projeto do cliente.
-- O vínculo cliente → projeto é pelo CNPJ: sentinela_cnpjs × empresas do projeto.
CREATE FUNCTION sentinela_aviso_ao_portal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pr RECORD; proc RECORD;
BEGIN
  -- Descartada depois: o rascunho que ninguém publicou sai de cena.
  IF NEW.classificacao = 'descartada' THEN
    UPDATE portal_avisos SET situacao = 'descartado' WHERE chave = 'sentinela:' || NEW.processo_id AND situacao = 'rascunho';
    RETURN NEW;
  END IF;
  IF NEW.classificacao NOT IN ('confirmada','provavel') THEN RETURN NEW; END IF;
  -- Provável que virou confirmada: publica o rascunho dos projetos com envio automático.
  IF TG_OP = 'UPDATE' AND OLD.classificacao = 'provavel' AND NEW.classificacao = 'confirmada' THEN
    UPDATE portal_avisos a SET situacao = 'publicado', publicado_em = now() FROM projetos p
     WHERE a.chave = 'sentinela:' || NEW.processo_id AND a.situacao = 'rascunho' AND p.id = a.projeto_id AND p.sentinela_aviso_automatico;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.classificacao IN ('confirmada','provavel') THEN RETURN NEW; END IF;
  SELECT numero_processo, tribunal, classe, orgao, data_ajuizamento INTO proc FROM sentinela_processos WHERE id = NEW.processo_id;
  FOR pr IN SELECT DISTINCT p.id, p.organizacao_id, p.sentinela_aviso_automatico FROM sentinela_cnpjs k
              JOIN empresas e ON regexp_replace(coalesce(e.cnpj,''), '\D', '', 'g') = k.cnpj
              JOIN projetos_empresas pe ON pe.empresa_id = e.id JOIN projetos p ON p.id = pe.projeto_id AND p.situacao <> 'encerrado'
             WHERE k.cliente_id = NEW.cliente_id LOOP
    INSERT INTO portal_avisos (organizacao_id, projeto_id, origem, chave, titulo, texto, dados, situacao, publicado_em)
    VALUES (pr.organizacao_id, pr.id, 'sentinela', 'sentinela:' || NEW.processo_id,
            'Nova ação identificada contra a empresa',
            'Identificamos um novo processo em que a empresa figura como parte' || coalesce(' (' || proc.classe || ')', '') || coalesce(', no ' || proc.tribunal, '') ||
            '. A equipe NGA já está analisando e entrará em contato com as orientações.',
            jsonb_build_object('numero', proc.numero_processo, 'tribunal', proc.tribunal, 'classe', proc.classe, 'orgao', proc.orgao, 'ajuizamento', proc.data_ajuizamento, 'polo', NEW.polo, 'classificacao', NEW.classificacao),
            CASE WHEN pr.sentinela_aviso_automatico AND NEW.classificacao = 'confirmada' THEN 'publicado' ELSE 'rascunho' END,
            CASE WHEN pr.sentinela_aviso_automatico AND NEW.classificacao = 'confirmada' THEN now() END)
    ON CONFLICT (projeto_id, chave) DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER sentinela_achados_portal AFTER INSERT OR UPDATE OF classificacao ON sentinela_achados FOR EACH ROW EXECUTE FUNCTION sentinela_aviso_ao_portal();
