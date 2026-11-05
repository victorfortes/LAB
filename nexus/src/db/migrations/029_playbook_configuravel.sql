-- Modelos administrativos e cópias por projeto: alterar um modelo não reescreve casos antigos.
CREATE TABLE playbook_modelos (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id),
 nome TEXT NOT NULL CHECK(length(btrim(nome)) BETWEEN 1 AND 200), tipo_projeto TEXT,
 padrao BOOLEAN NOT NULL DEFAULT false, ativo BOOLEAN NOT NULL DEFAULT true,
 criado_por UUID REFERENCES usuarios(id), criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,organizacao_id)
);
CREATE UNIQUE INDEX playbook_modelo_padrao ON playbook_modelos(organizacao_id,tipo_projeto) WHERE padrao AND ativo;
CREATE TABLE playbook_nos (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organizacao_id UUID NOT NULL REFERENCES organizacoes(id),
 modelo_id UUID, projeto_id UUID, escopo_id UUID GENERATED ALWAYS AS(coalesce(modelo_id,projeto_id)) STORED,
 pai_id UUID, fonte_no_id UUID REFERENCES playbook_nos(id), tipo TEXT NOT NULL CHECK(tipo IN('fase','etapa','tarefa')),
 nome TEXT NOT NULL CHECK(length(btrim(nome)) BETWEEN 1 AND 300), descricao TEXT NOT NULL DEFAULT '',
 ordem INTEGER NOT NULL DEFAULT 0 CHECK(ordem BETWEEN 0 AND 100000), chave_legada TEXT,
 gatilho TEXT NOT NULL DEFAULT 'manual' CHECK(gatilho IN('manual','projeto_criado','fase_iniciada','documento_cliente_enviado')),
 dias_uteis INTEGER NOT NULL DEFAULT 1 CHECK(dias_uteis BETWEEN 0 AND 365),
 prioridade TEXT NOT NULL DEFAULT 'media' CHECK(prioridade IN('baixa','media','alta','urgente')),
 arquivado_em TIMESTAMPTZ, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((modelo_id IS NULL) <> (projeto_id IS NULL)), CHECK(pai_id IS DISTINCT FROM id),
 UNIQUE(id,organizacao_id,escopo_id), UNIQUE(id,projeto_id),
 FOREIGN KEY(modelo_id,organizacao_id) REFERENCES playbook_modelos(id,organizacao_id),
 FOREIGN KEY(projeto_id,organizacao_id) REFERENCES projetos(id,organizacao_id),
 FOREIGN KEY(pai_id,organizacao_id,escopo_id) REFERENCES playbook_nos(id,organizacao_id,escopo_id) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX playbook_nos_modelo ON playbook_nos(modelo_id,ordem) WHERE arquivado_em IS NULL;
CREATE INDEX playbook_nos_projeto ON playbook_nos(projeto_id,ordem) WHERE arquivado_em IS NULL;
CREATE INDEX playbook_nos_pai ON playbook_nos(pai_id);
ALTER TABLE projetos ADD COLUMN playbook_modelo_id UUID REFERENCES playbook_modelos(id), ADD COLUMN fase_no_id UUID;
ALTER TABLE projetos ADD CONSTRAINT projeto_fase_no_mesmo_projeto FOREIGN KEY(fase_no_id,id) REFERENCES playbook_nos(id,projeto_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE tarefas ADD COLUMN playbook_no_id UUID, ADD COLUMN tarefa_pai_id UUID;
ALTER TABLE tarefas ADD CONSTRAINT tarefas_id_projeto_unique UNIQUE(id,projeto_id);
ALTER TABLE tarefas ADD CONSTRAINT tarefa_no_mesmo_projeto FOREIGN KEY(playbook_no_id,projeto_id) REFERENCES playbook_nos(id,projeto_id);
ALTER TABLE tarefas ADD CONSTRAINT tarefa_pai_mesmo_projeto FOREIGN KEY(tarefa_pai_id,projeto_id) REFERENCES tarefas(id,projeto_id);
ALTER TABLE tarefas ADD CONSTRAINT tarefa_nao_propria_mae CHECK(tarefa_pai_id IS DISTINCT FROM id);
CREATE INDEX tarefas_playbook_no ON tarefas(playbook_no_id) WHERE playbook_no_id IS NOT NULL;
CREATE INDEX tarefas_pai ON tarefas(tarefa_pai_id) WHERE tarefa_pai_id IS NOT NULL;
CREATE TABLE projeto_fluxo_historico (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),projeto_id UUID NOT NULL,organizacao_id UUID NOT NULL,
 de_no_id UUID,para_no_id UUID NOT NULL,usuario_id UUID REFERENCES usuarios(id),ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(projeto_id,organizacao_id) REFERENCES projetos(id,organizacao_id),
 FOREIGN KEY(de_no_id,projeto_id) REFERENCES playbook_nos(id,projeto_id),
 FOREIGN KEY(para_no_id,projeto_id) REFERENCES playbook_nos(id,projeto_id)
);
CREATE INDEX projeto_fluxo_historico_projeto ON projeto_fluxo_historico(projeto_id,ocorrido_em);
CREATE FUNCTION app_playbook_membro(org UUID,administrador BOOLEAN DEFAULT false) RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM vinculos v WHERE v.usuario_id=app_usuario_id() AND v.organizacao_id=org AND v.revogado_em IS NULL
 AND CASE WHEN administrador THEN v.papel='socio_administrador' ELSE v.papel IN('socio_administrador','socio','advogado','controladoria','financeiro','administrativo','estagiario') END)
$$;
REVOKE ALL ON FUNCTION app_playbook_membro(UUID,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_playbook_membro(UUID,BOOLEAN) TO nga_app;
ALTER TABLE playbook_modelos ENABLE ROW LEVEL SECURITY; ALTER TABLE playbook_modelos FORCE ROW LEVEL SECURITY;
CREATE POLICY modelos_leitura ON playbook_modelos FOR SELECT TO nga_app USING(app_playbook_membro(organizacao_id));
CREATE POLICY modelos_escrita ON playbook_modelos FOR ALL TO nga_app USING(app_playbook_membro(organizacao_id,true)) WITH CHECK(app_playbook_membro(organizacao_id,true));
ALTER TABLE playbook_nos ENABLE ROW LEVEL SECURITY; ALTER TABLE playbook_nos FORCE ROW LEVEL SECURITY;
CREATE POLICY nos_leitura ON playbook_nos FOR SELECT TO nga_app USING(app_playbook_membro(organizacao_id));
CREATE POLICY nos_escrita ON playbook_nos FOR ALL TO nga_app USING(app_playbook_membro(organizacao_id,modelo_id IS NOT NULL)) WITH CHECK(app_playbook_membro(organizacao_id,modelo_id IS NOT NULL));
ALTER TABLE projeto_fluxo_historico ENABLE ROW LEVEL SECURITY; ALTER TABLE projeto_fluxo_historico FORCE ROW LEVEL SECURITY;
CREATE POLICY fluxo_historico_leitura ON projeto_fluxo_historico FOR SELECT TO nga_app USING(app_playbook_membro(organizacao_id));
CREATE POLICY fluxo_historico_insercao ON projeto_fluxo_historico FOR INSERT TO nga_app WITH CHECK(app_playbook_membro(organizacao_id));
GRANT SELECT,INSERT,UPDATE ON playbook_modelos,playbook_nos TO nga_app;
REVOKE DELETE ON playbook_modelos,playbook_nos FROM nga_app;
GRANT SELECT,INSERT ON projeto_fluxo_historico TO nga_app; REVOKE UPDATE,DELETE ON projeto_fluxo_historico FROM nga_app;
-- Graph integrity also applies to SQL updates: no parent cycles, no cross-scope move, no task owning a phase.
CREATE FUNCTION app_validar_no_playbook() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE pai_tipo TEXT;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.modelo_id IS DISTINCT FROM OLD.modelo_id OR NEW.projeto_id IS DISTINCT FROM OLD.projeto_id OR NEW.organizacao_id<>OLD.organizacao_id) THEN RAISE EXCEPTION 'o escopo do nó não pode ser alterado'; END IF;
 IF NEW.pai_id IS NOT NULL THEN
  SELECT tipo INTO pai_tipo FROM playbook_nos WHERE id=NEW.pai_id AND arquivado_em IS NULL;
  IF pai_tipo IS NULL THEN RAISE EXCEPTION 'o nó pai deve estar ativo'; END IF;
  IF NEW.tipo='fase' AND pai_tipo<>'fase' THEN RAISE EXCEPTION 'fase deve ficar na raiz ou sob outra fase'; END IF;
  IF NEW.tipo='etapa' AND pai_tipo='tarefa' THEN RAISE EXCEPTION 'etapa não pode ser filha de tarefa'; END IF;
  IF EXISTS(WITH RECURSIVE ancestrais AS(SELECT id,pai_id FROM playbook_nos WHERE id=NEW.pai_id UNION SELECT p.id,p.pai_id FROM playbook_nos p JOIN ancestrais a ON p.id=a.pai_id) SELECT 1 FROM ancestrais WHERE id=NEW.id) THEN RAISE EXCEPTION 'ciclo no playbook'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_validar_no_playbook() FROM PUBLIC;
CREATE TRIGGER validar_no_playbook BEFORE INSERT OR UPDATE OF pai_id,tipo,modelo_id,projeto_id,organizacao_id ON playbook_nos FOR EACH ROW EXECUTE FUNCTION app_validar_no_playbook();
-- Client uploads may generate internal tasks, but clients cannot execute this function or write tasks.
CREATE FUNCTION app_playbook_documento_cliente() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n RECORD; venc DATE; faltam INTEGER; pai_tarefa UUID; chave TEXT;
BEGIN
 IF NEW.origem<>'portal_cliente' OR NEW.projeto_id IS NULL THEN RETURN NEW; END IF;
 FOR n IN WITH RECURSIVE arvore AS (
  SELECT p.*,0 AS profundidade FROM playbook_nos p WHERE p.projeto_id=NEW.projeto_id AND p.pai_id IS NULL AND p.arquivado_em IS NULL
  UNION ALL SELECT p.*,a.profundidade+1 FROM playbook_nos p JOIN arvore a ON p.pai_id=a.id WHERE p.arquivado_em IS NULL
 ) SELECT * FROM arvore WHERE tipo='tarefa' AND gatilho='documento_cliente_enviado' ORDER BY profundidade,ordem LOOP
  venc:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; faltam:=n.dias_uteis;
  WHILE faltam>0 LOOP venc:=venc+1;IF extract(isodow FROM venc)<6 THEN faltam:=faltam-1;END IF;END LOOP;
  chave:='cfg:'||n.id||':'||NEW.id; pai_tarefa:=NULL;
  SELECT t.id INTO pai_tarefa FROM tarefas t WHERE t.projeto_id=NEW.projeto_id AND t.playbook_no_id=n.pai_id AND t.chave_playbook='cfg:'||n.pai_id||':'||NEW.id LIMIT 1;
  INSERT INTO tarefas(organizacao_id,projeto_id,titulo,descricao,prioridade,responsavel_id,prazo,origem,chave_playbook,criado_por,playbook_no_id,tarefa_pai_id)
   SELECT NEW.organizacao_id,NEW.projeto_id,n.nome,n.descricao||E'\nPrazo operacional de segunda a sexta; confira feriados.',n.prioridade,p.responsavel_id,venc,'playbook',chave,p.responsavel_id,n.id,pai_tarefa FROM projetos p WHERE p.id=NEW.projeto_id AND p.organizacao_id=NEW.organizacao_id
   ON CONFLICT(projeto_id,chave_playbook) WHERE chave_playbook IS NOT NULL DO NOTHING;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_playbook_documento_cliente() FROM PUBLIC;
CREATE TRIGGER playbook_documento_cliente AFTER INSERT ON documentos FOR EACH ROW EXECUTE FUNCTION app_playbook_documento_cliente();
-- Portal-safe projection: only public phase names/order, never internal instructions or task nodes.
CREATE FUNCTION app_fases_publicas_projeto(pid UUID) RETURNS TABLE(id UUID,nome TEXT,ordem INTEGER)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT n.id,n.nome,n.ordem FROM playbook_nos n WHERE n.projeto_id=pid AND n.tipo='fase' AND n.arquivado_em IS NULL
 AND (app_playbook_membro(n.organizacao_id) OR pid IN(SELECT app_projetos_do_portal())) ORDER BY n.ordem,n.criado_em,n.id
$$;
REVOKE ALL ON FUNCTION app_fases_publicas_projeto(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_fases_publicas_projeto(UUID) TO nga_app;
