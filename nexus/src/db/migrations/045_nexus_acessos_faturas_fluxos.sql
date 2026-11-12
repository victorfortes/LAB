-- 045 — NGA Nexus: coordenação, grupo de WhatsApp, faturas e guias, fluxos e automações editáveis,
--       e o vínculo das publicações da Controladoria com o projeto.

-- ------------------------------------------------------------------ papéis ---
-- Coordenação é um papel novo do escritório. O CHECK de vínculos é lista fechada.
DO $$
DECLARE nome TEXT;
BEGIN
  FOR nome IN SELECT conname FROM pg_constraint
               WHERE conrelid = 'vinculos'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%socio_administrador%'
  LOOP EXECUTE format('ALTER TABLE vinculos DROP CONSTRAINT %I', nome); END LOOP;
END $$;
ALTER TABLE vinculos ADD CONSTRAINT vinculos_papel_check CHECK (papel IN (
  'socio_administrador', 'socio', 'coordenacao', 'advogado', 'controladoria',
  'financeiro', 'administrativo', 'estagiario',
  'cliente_administrador', 'cliente_usuario', 'parceiro_externo', 'integracao'));

-- A função de gestão de equipe tem a lista de papéis internos no corpo: reescreve-se o corpo vigente.
DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname = 'gerir_pessoa_equipe' LIMIT 1;
  IF def IS NOT NULL AND def NOT LIKE '%coordenacao%' THEN
    def := replace(def, '''socio'',''advogado''', '''socio'',''coordenacao'',''advogado''');
    EXECUTE def;
  END IF;
END $$;

-- ---------------------------------------------------------------- whatsapp ---
-- O grupo de WhatsApp do cliente substitui o chat interno. O link é do projeto/cliente.
ALTER TABLE projetos ADD COLUMN whatsapp_grupo_url TEXT
  CHECK (whatsapp_grupo_url IS NULL OR whatsapp_grupo_url ~ '^https://(chat\.whatsapp\.com|wa\.me|api\.whatsapp\.com|whatsapp\.com)/[^[:space:]]+$');

ALTER TABLE portais ADD COLUMN mostra_faturas BOOLEAN NOT NULL DEFAULT TRUE;

-- --------------------------------------------------- financeiro por projeto ---
-- O papel `financeiro` só alcança os projetos em que está na equipe. Vale no banco, não só na tela.
CREATE FUNCTION app_financeiro_restrito() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM vinculos v WHERE v.usuario_id = app_usuario_id() AND v.revogado_em IS NULL AND v.papel = 'financeiro')
     AND NOT EXISTS (SELECT 1 FROM vinculos v WHERE v.usuario_id = app_usuario_id() AND v.revogado_em IS NULL
                      AND v.papel IN ('socio_administrador','socio','coordenacao','advogado','controladoria','administrativo','estagiario'))
$$;
REVOKE ALL ON FUNCTION app_financeiro_restrito() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_financeiro_restrito() TO nga_app;

CREATE FUNCTION app_projetos_do_financeiro() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.projeto_id FROM projeto_equipe e WHERE e.usuario_id = app_usuario_id() AND e.ate IS NULL
$$;
REVOKE ALL ON FUNCTION app_projetos_do_financeiro() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_projetos_do_financeiro() TO nga_app;

ALTER POLICY projetos_isolamento ON projetos
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis())
         AND (NOT app_financeiro_restrito() OR id IN (SELECT app_projetos_do_financeiro())))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis())
         AND (NOT app_financeiro_restrito() OR id IN (SELECT app_projetos_do_financeiro())));

ALTER POLICY documentos_isolamento ON documentos
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis())
         AND (NOT app_financeiro_restrito() OR projeto_id IN (SELECT app_projetos_do_financeiro())))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis())
         AND (NOT app_financeiro_restrito() OR projeto_id IN (SELECT app_projetos_do_financeiro())));

-- ------------------------------------------------------------------ faturas ---
CREATE SEQUENCE faturas_numero_seq;

CREATE TABLE faturas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL,
  numero         TEXT NOT NULL DEFAULT ('FAT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('faturas_numero_seq')::text, 5, '0')),
  -- Honorário e despesa são do cliente; guia de custas é paga pelo escritório e pode ser repassada.
  tipo           TEXT NOT NULL DEFAULT 'honorarios' CHECK (tipo IN ('honorarios', 'guia_custas', 'despesa', 'outros')),
  pagador        TEXT NOT NULL DEFAULT 'cliente' CHECK (pagador IN ('cliente', 'escritorio')),
  descricao      TEXT NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 300),
  competencia    TEXT CHECK (competencia IS NULL OR length(competencia) <= 40),
  valor_centavos BIGINT NOT NULL CHECK (valor_centavos > 0),
  emissao        DATE NOT NULL DEFAULT CURRENT_DATE,
  vencimento     DATE NOT NULL,
  situacao       TEXT NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'paga', 'cancelada')),
  linha_digitavel TEXT CHECK (linha_digitavel IS NULL OR length(linha_digitavel) <= 120),
  processo_id    UUID REFERENCES processos(id) ON DELETE SET NULL,
  visivel_cliente BOOLEAN NOT NULL DEFAULT TRUE,
  -- Boleto, guia ou nota anexada pelo escritório.
  documento_id   UUID REFERENCES documentos(id) ON DELETE SET NULL,
  -- Comprovante: sem ele, a fatura não aparece como paga (garantido abaixo).
  comprovante_id UUID REFERENCES documentos(id) ON DELETE SET NULL,
  comprovante_em TIMESTAMPTZ,
  comprovante_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  conferido_em   TIMESTAMPTZ,
  conferido_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  pago_em        DATE,
  observacao     TEXT CHECK (observacao IS NULL OR length(observacao) <= 2000),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (projeto_id, organizacao_id) REFERENCES projetos(id, organizacao_id) ON DELETE CASCADE,
  CONSTRAINT paga_com_comprovante CHECK (situacao <> 'paga' OR (comprovante_id IS NOT NULL AND pago_em IS NOT NULL)),
  CONSTRAINT conferencia_coerente CHECK (conferido_em IS NULL OR situacao = 'paga'),
  UNIQUE (organizacao_id, numero)
);
CREATE INDEX idx_faturas_projeto ON faturas(projeto_id, vencimento);
CREATE INDEX idx_faturas_situacao ON faturas(organizacao_id, situacao, vencimento);

ALTER TABLE faturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE faturas FORCE ROW LEVEL SECURITY;

CREATE POLICY faturas_escritorio ON faturas
  USING (organizacao_id IN (SELECT app_organizacoes_visiveis())
         AND (NOT app_financeiro_restrito() OR projeto_id IN (SELECT app_projetos_do_financeiro())))
  WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis())
         AND (NOT app_financeiro_restrito() OR projeto_id IN (SELECT app_projetos_do_financeiro())));

-- O cliente lê só o que é dele: fatura do cliente, marcada visível, no projeto do seu portal ativo.
CREATE POLICY faturas_portal ON faturas FOR SELECT
  USING (visivel_cliente AND pagador = 'cliente' AND situacao <> 'cancelada'
         AND projeto_id IN (SELECT po.projeto_id FROM portais po
                             WHERE po.ativo AND po.mostra_faturas AND po.projeto_id IN (SELECT app_projetos_do_portal())));
GRANT SELECT, INSERT, UPDATE ON faturas TO nga_app;

-- O cliente baixa o boleto/guia da fatura que ele já enxerga e o próprio comprovante, sem depender de
-- a NGA "publicar" o documento: a visibilidade nasce da fatura (que já passou pela política acima).
CREATE POLICY documentos_fatura_portal ON documentos FOR SELECT
  USING (id IN (SELECT f.documento_id FROM faturas f WHERE f.documento_id IS NOT NULL)
      OR id IN (SELECT f.comprovante_id FROM faturas f WHERE f.comprovante_id IS NOT NULL));
GRANT USAGE ON SEQUENCE faturas_numero_seq TO nga_app;

-- O cliente não ganha UPDATE na tabela: anexar comprovante passa por esta função, que só mexe nos campos do comprovante.
CREATE FUNCTION faturas_anexar_comprovante(p_fatura UUID, p_documento UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f faturas%ROWTYPE;
BEGIN
  SELECT * INTO f FROM faturas WHERE id = p_fatura;
  IF NOT FOUND OR NOT (f.projeto_id IN (SELECT app_projetos_do_portal())) OR NOT f.visivel_cliente OR f.pagador <> 'cliente' THEN
    RAISE EXCEPTION 'fatura não encontrada' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM portais po WHERE po.projeto_id = f.projeto_id AND po.ativo AND po.mostra_faturas) THEN
    RAISE EXCEPTION 'faturas não liberadas neste portal' USING ERRCODE = '42501';
  END IF;
  IF f.situacao <> 'aberta' THEN RAISE EXCEPTION 'esta fatura não está em aberto'; END IF;
  IF NOT EXISTS (SELECT 1 FROM documentos d WHERE d.id = p_documento AND d.projeto_id = f.projeto_id
                  AND d.origem = 'portal_cliente' AND d.enviado_por = app_usuario_id()) THEN
    RAISE EXCEPTION 'comprovante inválido para esta fatura' USING ERRCODE = '42501';
  END IF;
  UPDATE faturas SET comprovante_id = p_documento, comprovante_em = now(), comprovante_por = app_usuario_id(),
         situacao = 'paga', pago_em = CURRENT_DATE, atualizado_em = now() WHERE id = p_fatura;
END $$;
REVOKE ALL ON FUNCTION faturas_anexar_comprovante(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION faturas_anexar_comprovante(UUID, UUID) TO nga_app;

-- ---------------------------------------------------- fluxos e automações ---
CREATE TABLE modelos_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('fluxograma', 'linha_do_tempo')),
  nome           TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 160),
  descricao      TEXT NOT NULL DEFAULT '' CHECK (length(descricao) <= 2000),
  procedimento   TEXT,
  definicao      JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(definicao) < 400000),
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_modelos_config ON modelos_config(organizacao_id, tipo);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['modelos_config'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    -- Configuração do escritório: o cliente não alcança.
    EXECUTE format($f$CREATE POLICY %1$I_isolamento ON %1$I
      USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
      WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- Automações (migração 024): além de "projeto criado" e "documento do cliente enviado", agora também
-- "fase iniciada", "fatura criada" e "fatura paga". A fase opcional restringe a regra a uma fase.
ALTER TABLE automacoes DROP CONSTRAINT automacoes_gatilho_check;
ALTER TABLE automacoes ADD CONSTRAINT automacoes_gatilho_check
  CHECK (gatilho IN ('projeto_criado', 'documento_cliente_enviado', 'fase_iniciada', 'fatura_criada', 'fatura_paga'));
ALTER TABLE automacoes ADD COLUMN fase TEXT CHECK (fase IS NULL OR length(fase) <= 80);
ALTER TABLE automacoes ADD COLUMN descricao TEXT CHECK (descricao IS NULL OR length(descricao) <= 1000);
ALTER TABLE automacoes ADD COLUMN execucoes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automacoes ADD COLUMN ultima_execucao_em TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION app_automatizar_evento() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE regra RECORD; evento TEXT; projeto UUID; org UUID; fonte UUID; venc DATE; faltam INTEGER; fase_evento TEXT; resp UUID;
BEGIN
 fase_evento := NULL;
 IF TG_TABLE_NAME = 'projetos' THEN
  projeto := NEW.id; org := NEW.organizacao_id;
  IF TG_OP = 'INSERT' THEN
   evento := 'projeto_criado'; fonte := NEW.id;
  ELSE
   IF NEW.fase IS NULL OR NEW.fase IS NOT DISTINCT FROM OLD.fase THEN RETURN NEW; END IF;
   evento := 'fase_iniciada'; fase_evento := NEW.fase;
   fonte := md5(NEW.id::text || ':' || NEW.fase || ':' || coalesce(NEW.fase_desde::text, ''))::uuid;
  END IF;
 ELSIF TG_TABLE_NAME = 'faturas' THEN
  projeto := NEW.projeto_id; org := NEW.organizacao_id; fonte := NEW.id;
  IF TG_OP = 'INSERT' THEN evento := 'fatura_criada';
  ELSIF NEW.situacao = 'paga' AND OLD.situacao IS DISTINCT FROM 'paga' THEN evento := 'fatura_paga';
  ELSE RETURN NEW; END IF;
 ELSE
  IF NEW.origem <> 'portal_cliente' OR NEW.projeto_id IS NULL THEN RETURN NEW; END IF;
  evento := 'documento_cliente_enviado'; projeto := NEW.projeto_id; org := NEW.organizacao_id; fonte := NEW.id;
 END IF;
 FOR regra IN SELECT * FROM automacoes a WHERE a.ativo AND a.organizacao_id = org AND a.gatilho = evento
                 AND (a.projeto_id IS NULL OR a.projeto_id = projeto) AND (a.fase IS NULL OR a.fase = fase_evento) LOOP
  venc := (now() AT TIME ZONE 'America/Sao_Paulo')::DATE; faltam := regra.dias_uteis;
  WHILE faltam > 0 LOOP
   venc := venc + 1;
   IF extract(isodow FROM venc) < 6 THEN faltam := faltam - 1; END IF;
  END LOOP;
  -- Responsável: o líder do projeto, se houver; senão, quem criou a regra.
  SELECT e.usuario_id INTO resp FROM projeto_equipe e WHERE e.projeto_id = projeto AND e.papel = 'lider' AND e.ate IS NULL LIMIT 1;
  INSERT INTO tarefas(organizacao_id, projeto_id, titulo, descricao, prioridade, prazo, origem, origem_id, automacao_id, criado_por, responsavel_id)
  VALUES(org, projeto, regra.titulo_tarefa, coalesce(regra.descricao, 'Automação: ' || regra.nome) || '. Prazo operacional em dias de segunda a sexta; não substitui prazo processual.',
         regra.prioridade, venc, 'automacao', fonte, regra.id, regra.criado_por, coalesce(resp, regra.criado_por))
  ON CONFLICT DO NOTHING;
  IF FOUND THEN UPDATE automacoes SET execucoes = execucoes + 1, ultima_execucao_em = now() WHERE id = regra.id; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER automatizar_fase AFTER UPDATE OF fase ON projetos FOR EACH ROW EXECUTE FUNCTION app_automatizar_evento();
CREATE TRIGGER automatizar_fatura_criada AFTER INSERT ON faturas FOR EACH ROW EXECUTE FUNCTION app_automatizar_evento();
CREATE TRIGGER automatizar_fatura_paga AFTER UPDATE OF situacao ON faturas FOR EACH ROW EXECUTE FUNCTION app_automatizar_evento();

-- ------------------------------------------- publicações × processos × projetos ---
-- Vincula publicações ainda soltas ao processo (por número CNJ, só dígitos) e, daí, ao projeto.
CREATE FUNCTION controladoria_vincular_publicacoes(p_org UUID) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n INTEGER;
BEGIN
  IF p_org NOT IN (SELECT app_organizacoes_visiveis()) THEN RAISE EXCEPTION 'organização não autorizada' USING ERRCODE = '42501'; END IF;
  UPDATE publicacoes p SET processo_id = pr.id
    FROM processos pr
   WHERE p.organizacao_id = p_org AND pr.organizacao_id = p_org AND p.processo_id IS NULL
     AND p.numero_processo <> '' AND regexp_replace(pr.numero, '\D', '', 'g') = p.numero_processo;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION controladoria_vincular_publicacoes(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controladoria_vincular_publicacoes(UUID) TO nga_app;

-- Processo que entra depois (importação, cadastro) já puxa as publicações que o esperavam.
CREATE FUNCTION processos_puxar_publicacoes() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE publicacoes SET processo_id = NEW.id
   WHERE organizacao_id = NEW.organizacao_id AND processo_id IS NULL
     AND numero_processo <> '' AND numero_processo = regexp_replace(NEW.numero, '\D', '', 'g');
  RETURN NEW;
END $$;
CREATE TRIGGER processos_puxar_publicacoes AFTER INSERT ON processos
  FOR EACH ROW EXECUTE FUNCTION processos_puxar_publicacoes();

-- Primeira passada, agora: tudo o que já está no banco.
UPDATE publicacoes p SET processo_id = pr.id
  FROM processos pr
 WHERE p.organizacao_id = pr.organizacao_id AND p.processo_id IS NULL
   AND p.numero_processo <> '' AND regexp_replace(pr.numero, '\D', '', 'g') = p.numero_processo;

-- Dar acesso a cliente é chave de porta: também no banco, só administração, sócio e coordenação.
DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname = 'convidar_cliente' LIMIT 1;
  IF def IS NOT NULL AND def NOT LIKE '%sem permissão para dar acesso ao portal%' THEN
    def := replace(def, E'BEGIN\n  SELECT organizacao_id INTO v_org_projeto',
      E'BEGIN\n  IF NOT EXISTS (SELECT 1 FROM vinculos vv WHERE vv.usuario_id = app_usuario_id() AND vv.revogado_em IS NULL AND vv.papel IN (''socio_administrador'',''socio'',''coordenacao'')) THEN\n    RAISE EXCEPTION ''sem permissão para dar acesso ao portal'' USING ERRCODE = ''42501'';\n  END IF;\n  SELECT organizacao_id INTO v_org_projeto');
    IF def NOT LIKE '%sem permissão para dar acesso ao portal%' THEN RAISE EXCEPTION 'convidar_cliente: corpo inesperado, guarda não aplicada'; END IF;
    EXECUTE def;
  END IF;
END $$;
