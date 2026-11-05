-- Integridade entre projeto, documento e checklist, também para escrita SQL direta.
-- NOT VALID preserva evidências legadas para auditoria; novas escritas já são conferidas.
ALTER TABLE projetos ADD CONSTRAINT projetos_id_org_unique UNIQUE (id, organizacao_id);
ALTER TABLE documentos ADD CONSTRAINT documentos_id_projeto_unique UNIQUE (id, projeto_id);
ALTER TABLE requisitos ADD CONSTRAINT requisitos_id_projeto_unique UNIQUE (id, projeto_id);
ALTER TABLE documentos ADD CONSTRAINT documentos_projeto_org_fk FOREIGN KEY (projeto_id, organizacao_id) REFERENCES projetos(id, organizacao_id) NOT VALID;
ALTER TABLE requisitos ADD CONSTRAINT requisitos_projeto_org_fk FOREIGN KEY (projeto_id, organizacao_id) REFERENCES projetos(id, organizacao_id) NOT VALID;
ALTER TABLE mensagens ADD CONSTRAINT mensagens_projeto_org_fk FOREIGN KEY (projeto_id, organizacao_id) REFERENCES projetos(id, organizacao_id) NOT VALID;
ALTER TABLE tarefas ADD CONSTRAINT tarefas_projeto_org_fk FOREIGN KEY (projeto_id, organizacao_id) REFERENCES projetos(id, organizacao_id) NOT VALID;
ALTER TABLE requisitos ADD CONSTRAINT requisitos_documento_projeto_fk FOREIGN KEY (documento_id, projeto_id) REFERENCES documentos(id, projeto_id) NOT VALID;
ALTER TABLE mensagens ADD CONSTRAINT mensagens_requisito_projeto_fk FOREIGN KEY (requisito_id, projeto_id) REFERENCES requisitos(id, projeto_id) NOT VALID;
ALTER TABLE analises ADD CONSTRAINT analises_documento_projeto_fk FOREIGN KEY (documento_id, projeto_id) REFERENCES documentos(id, projeto_id) NOT VALID;

CREATE TABLE projeto_playbook_notas (
  projeto_id UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id),
  chave TEXT NOT NULL CHECK (length(chave) BETWEEN 1 AND 120),
  resumo TEXT NOT NULL DEFAULT '' CHECK (length(resumo) <= 12000),
  pontos_atencao TEXT NOT NULL DEFAULT '' CHECK (length(pontos_atencao) <= 12000),
  atualizado_por UUID REFERENCES usuarios(id),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (projeto_id, chave),
  FOREIGN KEY (projeto_id, organizacao_id) REFERENCES projetos(id, organizacao_id)
);
ALTER TABLE projeto_playbook_notas ENABLE ROW LEVEL SECURITY;
ALTER TABLE projeto_playbook_notas FORCE ROW LEVEL SECURITY;
CREATE POLICY playbook_notas_escritorio ON projeto_playbook_notas
 USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
 WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
GRANT SELECT, INSERT, UPDATE, DELETE ON projeto_playbook_notas TO nga_app;

CREATE TABLE automacoes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organizacao_id UUID NOT NULL REFERENCES organizacoes(id),
 projeto_id UUID REFERENCES projetos(id) ON DELETE CASCADE,
 nome TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 200),
 gatilho TEXT NOT NULL CHECK (gatilho IN ('projeto_criado','documento_cliente_enviado')),
 titulo_tarefa TEXT NOT NULL CHECK (length(btrim(titulo_tarefa)) BETWEEN 1 AND 300),
 dias_uteis INTEGER NOT NULL DEFAULT 1 CHECK (dias_uteis BETWEEN 0 AND 365),
 prioridade TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa','media','alta','urgente')),
 ativo BOOLEAN NOT NULL DEFAULT true,
 criado_por UUID REFERENCES usuarios(id),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY (projeto_id, organizacao_id) REFERENCES projetos(id, organizacao_id)
);
ALTER TABLE automacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE automacoes FORCE ROW LEVEL SECURITY;
CREATE POLICY automacoes_escritorio ON automacoes
 USING (organizacao_id IN (SELECT app_organizacoes_visiveis()))
 WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
GRANT SELECT, INSERT, UPDATE, DELETE ON automacoes TO nga_app;
ALTER TABLE tarefas DROP CONSTRAINT tarefas_origem_check;
ALTER TABLE tarefas ADD CONSTRAINT tarefas_origem_check CHECK (origem IN ('manual','prazo','requisito','achado','credito','playbook','automacao'));
ALTER TABLE tarefas ADD COLUMN automacao_id UUID REFERENCES automacoes(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX tarefas_evento_automacao_unico ON tarefas(automacao_id, projeto_id, origem_id) WHERE automacao_id IS NOT NULL;

-- Executado exclusivamente por gatilho: sem endpoint que aceite organização arbitrária.
CREATE FUNCTION app_automatizar_evento() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE regra RECORD; evento TEXT; projeto UUID; org UUID; fonte UUID; venc DATE; faltam INTEGER;
BEGIN
 IF TG_TABLE_NAME = 'projetos' THEN
  evento := 'projeto_criado'; projeto := NEW.id; org := NEW.organizacao_id; fonte := NEW.id;
 ELSE
  IF NEW.origem <> 'portal_cliente' OR NEW.projeto_id IS NULL THEN RETURN NEW; END IF;
  evento := 'documento_cliente_enviado'; projeto := NEW.projeto_id; org := NEW.organizacao_id; fonte := NEW.id;
 END IF;
 FOR regra IN SELECT * FROM automacoes a WHERE a.ativo AND a.organizacao_id = org AND a.gatilho = evento AND (a.projeto_id IS NULL OR a.projeto_id = projeto) LOOP
  venc := (now() AT TIME ZONE 'America/Sao_Paulo')::DATE; faltam := regra.dias_uteis;
  WHILE faltam > 0 LOOP
   venc := venc + 1;
   IF extract(isodow FROM venc) < 6 THEN faltam := faltam - 1; END IF;
  END LOOP;
  INSERT INTO tarefas(organizacao_id, projeto_id, titulo, descricao, prioridade, prazo, origem, origem_id, automacao_id, criado_por, responsavel_id)
  VALUES(org, projeto, regra.titulo_tarefa, 'Automação: ' || regra.nome || '. Prazo operacional em dias de segunda a sexta; não substitui prazo processual.', regra.prioridade, venc, 'automacao', fonte, regra.id, regra.criado_por, regra.criado_por)
  ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_automatizar_evento() FROM PUBLIC;
CREATE TRIGGER automatizar_projeto AFTER INSERT ON projetos FOR EACH ROW EXECUTE FUNCTION app_automatizar_evento();
CREATE TRIGGER automatizar_documento_cliente AFTER INSERT ON documentos FOR EACH ROW EXECUTE FUNCTION app_automatizar_evento();
