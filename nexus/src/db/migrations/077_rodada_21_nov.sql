-- 077 — Rodada de 21/11/2026.
--
-- 1. Tarefas com TIPO (tarefa, prazo, evento, audiência, análise de intimação), ligadas ao processo ou ao
--    caso, com hora (eventos e audiências), nota de conclusão e ARQUIVO (limpeza do que apodreceu no Astrea).
--    Arquivar não apaga: a tarefa vira "concluída" com `arquivada_em` e o motivo, e sai do quadro.
-- 2. DataJud: a fila deixa de punir o processo quando quem falhou foi o DataJud (HTTP 429, tempo esgotado,
--    shards do Elasticsearch recusados). Pausa por tribunal e estado honesto ("aguardando DataJud").
-- 3. Pauta por EQUIPE (reunião semanal da equipe cobrindo todos os clientes dela), com o projeto ligado a
--    uma ou mais equipes (Cível, Empresarial, Trabalhista...).
-- 4. QGC: valor do crédito x valor sujeito (garantia fiduciária parcial) e lastro do crédito (documento).
-- 5. Portal: pedido de documento avulso pelo advogado, e-mail pessoal do cliente, manuais com leitura
--    obrigatória no primeiro acesso.
-- 6. Pré-diagnóstico por CNPJ (sócios, empresas ligadas, processos) e onboarding comercial
--    (CNPJ → pré-diagnóstico → reunião → contrato → onboarding), com aviso de novo cliente.
-- 7. Parceiros externos (trabalhista, tributário, criminal) dentro do projeto, só na área deles.

-- =============================================================== 1. tarefas ===
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'tarefa'
  CHECK (tipo IN ('tarefa', 'prazo', 'evento', 'audiencia', 'analise'));
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS hora TEXT CHECK (hora IS NULL OR hora ~ '^[0-9]{2}:[0-9]{2}$');
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS processo_id UUID REFERENCES processos(id) ON DELETE SET NULL;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS caso TEXT CHECK (length(caso) <= 500);
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS arquivada_em TIMESTAMPTZ;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS arquivada_motivo TEXT CHECK (length(arquivada_motivo) <= 300);
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS conclusao_nota TEXT CHECK (length(conclusao_nota) <= 4000);
ALTER TABLE tarefas ADD CONSTRAINT tarefa_arquivada_e_fechada CHECK (arquivada_em IS NULL OR status = 'concluida');
CREATE INDEX IF NOT EXISTS idx_tarefas_abertas_tipo ON tarefas(organizacao_id, tipo) WHERE status <> 'concluida';
CREATE INDEX IF NOT EXISTS idx_tarefas_processo ON tarefas(processo_id) WHERE processo_id IS NOT NULL;

-- O que já veio do Astrea ganha o tipo certo, o processo ligado e o título sem o prefixo "Evento: ".
UPDATE tarefas t SET
  tipo = CASE WHEN t.titulo LIKE 'Evento:%' THEN 'evento' WHEN t.titulo LIKE 'Audiência:%' THEN 'audiencia' ELSE 'prazo' END,
  titulo = regexp_replace(t.titulo, '^(Evento|Audiência): ', '')
 WHERE t.chave_playbook LIKE 'astrea:%';
UPDATE tarefas SET tipo = 'prazo' WHERE origem = 'prazo' AND tipo = 'tarefa';
UPDATE tarefas SET tipo = 'analise' WHERE (chave_playbook LIKE 'djen-analise:%' OR chave_playbook LIKE 'astrea-analise:%') AND tipo = 'tarefa';

-- ================================================================ 2. DataJud ===
-- Pausa por tribunal, compartilhada entre a rotina de andamentos e o Sentinela.
CREATE TABLE IF NOT EXISTS datajud_pausas (
  indice  TEXT PRIMARY KEY CHECK (indice ~ '^[a-z0-9-]{2,12}$'),
  ate     TIMESTAMPTZ NOT NULL,
  motivo  TEXT,
  vezes   INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE datajud_pausas ENABLE ROW LEVEL SECURITY;
ALTER TABLE datajud_pausas FORCE ROW LEVEL SECURITY;
-- Não há dado de cliente aqui (só o nome do tribunal): a rotina e o Sentinela leem e escrevem.
CREATE POLICY datajud_pausas_todos ON datajud_pausas USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON datajud_pausas TO nga_app;

ALTER TABLE datajud_monitor ADD COLUMN IF NOT EXISTS adiamentos INTEGER NOT NULL DEFAULT 0;

-- DataJud instável: reagenda SEM contar falha do processo (30 a 90 min, espalhado para não voltar tudo junto).
CREATE OR REPLACE FUNCTION datajud_adiar(p_processo UUID, p_indice TEXT, p_motivo TEXT) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE datajud_monitor SET indice = coalesce(p_indice, indice), ultima_consulta = now(),
         ultimo_erro = left('DataJud instável: ' || p_motivo, 500), adiamentos = adiamentos + 1,
         proxima = now() + make_interval(mins => 30 + floor(random() * 60)::int)
   WHERE processo_id = p_processo
$$;
REVOKE ALL ON FUNCTION datajud_adiar(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION datajud_adiar(UUID, TEXT, TEXT) TO nga_app;

-- Sucesso zera os adiamentos; "não encontrado" de verdade volta em 7 dias (sigilo ou fora do índice público),
-- encontrado volta em ~20 h. Falha real (pedido recusado) segue o castigo crescente de antes.
CREATE OR REPLACE FUNCTION datajud_registrar(p_processo UUID, p_indice TEXT, p_ok BOOLEAN, p_encontrado BOOLEAN, p_erro TEXT, p_movimentos JSONB, p_dados JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org UUID; v_novos INTEGER := 0; m JSONB; n INTEGER;
BEGIN
  SELECT organizacao_id INTO v_org FROM processos WHERE id = p_processo;
  IF v_org IS NULL THEN RETURN 0; END IF;
  IF p_ok AND p_movimentos IS NOT NULL THEN
    FOR m IN SELECT * FROM jsonb_array_elements(p_movimentos) LOOP
      INSERT INTO movimentacoes (processo_id, organizacao_id, data, titulo, conteudo, codigo_cnj, fonte, externo_id)
      VALUES (p_processo, v_org, (m->>'data')::date, left(m->>'titulo', 500), nullif(m->>'conteudo', ''), nullif(m->>'codigo', '')::int, 'datajud', m->>'id')
      ON CONFLICT (processo_id, fonte, externo_id) DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT; v_novos := v_novos + n;
    END LOOP;
    IF p_dados IS NOT NULL THEN
      UPDATE processos SET classe = coalesce(classe, nullif(p_dados->>'classe', '')), orgao_julgador = coalesce(orgao_julgador, nullif(p_dados->>'orgao', '')),
             tribunal = coalesce(tribunal, nullif(p_dados->>'tribunal', '')), assunto = coalesce(assunto, nullif(p_dados->>'assunto', '')),
             distribuido_em = coalesce(distribuido_em, nullif(p_dados->>'ajuizamento', '')::date), atualizado_em = now()
       WHERE id = p_processo;
    END IF;
  END IF;
  UPDATE datajud_monitor SET indice = coalesce(p_indice, indice), ultima_consulta = now(),
         ultimo_sucesso = CASE WHEN p_ok THEN now() ELSE ultimo_sucesso END,
         ultimo_erro = CASE WHEN p_ok THEN NULL ELSE left(p_erro, 500) END,
         falhas = CASE WHEN p_ok THEN 0 ELSE falhas + 1 END,
         adiamentos = CASE WHEN p_ok THEN 0 ELSE adiamentos END,
         encontrado = CASE WHEN p_ok THEN p_encontrado ELSE encontrado END,
         movimentos = (SELECT count(*) FROM movimentacoes WHERE processo_id = p_processo AND fonte = 'datajud'),
         ultimo_movimento = (SELECT max(data) FROM movimentacoes WHERE processo_id = p_processo),
         proxima = CASE WHEN p_ok AND p_encontrado THEN now() + interval '20 hours'
                        WHEN p_ok THEN now() + interval '7 days'
                        ELSE now() + least(interval '24 hours', interval '1 hour' * power(2, least(falhas, 5))) END
   WHERE processo_id = p_processo;
  RETURN v_novos;
END $$;

-- Fila: primeiro quem nunca deu certo, depois o mais atrasado. Até 60 por rodada (agrupados por tribunal).
CREATE OR REPLACE FUNCTION datajud_fila(p_limite INTEGER) RETURNS TABLE(processo_id UUID, organizacao_id UUID, numero TEXT, indice TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.processo_id, m.organizacao_id, p.numero, m.indice FROM datajud_monitor m JOIN processos p ON p.id = m.processo_id
   WHERE m.ativo AND m.proxima <= now() AND NOT EXISTS (SELECT 1 FROM datajud_pausas z WHERE z.indice = m.indice AND z.ate > now())
   ORDER BY (m.ultimo_sucesso IS NULL) DESC, m.proxima LIMIT greatest(1, least(p_limite, 60))
$$;

-- Conserta o estrago: quem ficou castigado por 429/tempo esgotado ou marcado "não encontrado" numa
-- resposta incompleta volta para a fila, espalhado pelas próximas 24 h (o DataJud não aguenta tudo junto).
UPDATE datajud_monitor SET falhas = 0, adiamentos = 0,
       ultimo_erro = CASE WHEN ultimo_erro IS NOT NULL THEN 'DataJud instável: ' || ultimo_erro END,
       proxima = now() + make_interval(mins => floor(random() * 1440)::int)
 WHERE ultimo_erro ~ '(429|timed out|Signal)' OR encontrado IS DISTINCT FROM TRUE;

-- ========================================================= 3. pauta por equipe ===
-- O projeto pertence a uma ou mais equipes (áreas do escritório). Vem da coluna "Equipe" do Astrea e é editável.
ALTER TABLE projetos ADD COLUMN IF NOT EXISTS equipes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE projetos ADD CONSTRAINT projetos_equipes_curtas CHECK (cardinality(equipes) <= 8);
CREATE INDEX IF NOT EXISTS idx_projetos_equipes ON projetos USING gin (equipes);
UPDATE projetos p SET equipes = x.eq
  FROM (SELECT projeto_id, array_agg(DISTINCT btrim(equipe) ORDER BY btrim(equipe)) eq FROM astrea_registros
         WHERE projeto_id IS NOT NULL AND coalesce(btrim(equipe), '') <> '' GROUP BY projeto_id) x
 WHERE x.projeto_id = p.id AND p.equipes = '{}';

-- Cadência da reunião semanal de cada equipe (dia, hora, participantes). Encerrar uma reunião agenda a próxima.
CREATE TABLE IF NOT EXISTS pauta_equipes (
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  equipe         TEXT NOT NULL CHECK (length(btrim(equipe)) BETWEEN 2 AND 60),
  dia_semana     SMALLINT NOT NULL DEFAULT 1 CHECK (dia_semana BETWEEN 0 AND 6),
  hora           TEXT NOT NULL DEFAULT '09:00' CHECK (hora ~ '^[0-9]{2}:[0-9]{2}$'),
  duracao_min    SMALLINT NOT NULL DEFAULT 60 CHECK (duracao_min BETWEEN 15 AND 480),
  participantes  TEXT CHECK (length(participantes) <= 2000),
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, equipe)
);

ALTER TABLE pauta_reunioes ALTER COLUMN projeto_id DROP NOT NULL;
ALTER TABLE pauta_reunioes ADD COLUMN IF NOT EXISTS equipe TEXT CHECK (length(equipe) <= 60);
ALTER TABLE pauta_reunioes ADD COLUMN IF NOT EXISTS hora TEXT CHECK (hora IS NULL OR hora ~ '^[0-9]{2}:[0-9]{2}$');
ALTER TABLE pauta_reunioes ADD CONSTRAINT pauta_reuniao_alvo CHECK (projeto_id IS NOT NULL OR equipe IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pauta_reunioes_equipe ON pauta_reunioes(organizacao_id, equipe, data DESC) WHERE equipe IS NOT NULL;
-- Item da pauta continua sendo de um cliente; `equipe` diz em qual reunião semanal ele é tratado
-- (vazio = na de todas as equipes do projeto).
ALTER TABLE pauta_itens ADD COLUMN IF NOT EXISTS equipe TEXT CHECK (length(equipe) <= 60);
-- Ata gerada por uma reunião de equipe aponta para a reunião (uma ata por cliente tratado).
ALTER TABLE atas ADD COLUMN IF NOT EXISTS pauta_reuniao_id UUID REFERENCES pauta_reunioes(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE pauta_equipes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE pauta_equipes FORCE ROW LEVEL SECURITY;
  CREATE POLICY pauta_equipes_isolamento ON pauta_equipes USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
  CREATE POLICY pauta_equipes_so_gestao ON pauta_equipes AS RESTRICTIVE USING (app_gestao_de_pauta()) WITH CHECK (app_gestao_de_pauta());
  GRANT SELECT, INSERT, UPDATE, DELETE ON pauta_equipes TO nga_app;
END $$;

-- ===================================================================== 4. QGC ===
-- Valor do crédito x valor sujeito. Ex.: crédito de R$ 1 mi com alienação fiduciária de um bem de R$ 600 mil:
-- a parte coberta pela garantia fica fora da recuperação (art. 49, § 3º) e o saldo descoberto se sujeita
-- (quirografário). NULL = segue o enquadramento automático (todo o crédito, ou nada, conforme a natureza).
ALTER TABLE creditos ADD COLUMN IF NOT EXISTS valor_sujeito BIGINT;
ALTER TABLE creditos ADD CONSTRAINT creditos_valor_sujeito_coerente CHECK (valor_sujeito IS NULL OR (valor_sujeito >= 0 AND valor_sujeito <= valor));
ALTER TABLE creditos ADD COLUMN IF NOT EXISTS garantia_descricao TEXT CHECK (length(garantia_descricao) <= 500);

-- Lastro de cada crédito: o documento que prova o crédito (contrato, nota, título, sentença...).
-- "sugerido" = o sistema achou pelo nome/CNPJ do credor; "confirmado" = alguém da equipe conferiu.
CREATE TABLE IF NOT EXISTS credito_lastros (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  credito_id     UUID NOT NULL REFERENCES creditos(id) ON DELETE CASCADE,
  documento_id   UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  situacao       TEXT NOT NULL DEFAULT 'sugerido' CHECK (situacao IN ('sugerido', 'confirmado', 'recusado')),
  motivo         TEXT CHECK (length(motivo) <= 300),
  pagina         INTEGER CHECK (pagina IS NULL OR pagina > 0),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (credito_id, documento_id)
);
CREATE INDEX IF NOT EXISTS idx_credito_lastros_projeto ON credito_lastros(projeto_id);

-- Acesso do administrador judicial ao QGC do projeto, com os lastros: link com credencial própria
-- (só o hash fica guardado), com validade, revogável e com registro de uso. Não dá acesso a mais nada.
CREATE TABLE IF NOT EXISTS qgc_acessos_externos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  nome           TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 2 AND 160),
  email          TEXT CHECK (length(email) <= 200),
  papel          TEXT NOT NULL DEFAULT 'administrador_judicial' CHECK (papel IN ('administrador_judicial', 'perito', 'auditor', 'outro')),
  so_validado    BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em      TIMESTAMPTZ NOT NULL,
  revogado_em    TIMESTAMPTZ,
  ultimo_uso     TIMESTAMPTZ,
  usos           INTEGER NOT NULL DEFAULT 0
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['credito_lastros', 'qgc_acessos_externos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t || '_isolamento', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
    -- Visibilidade por equipe do projeto (mesma regra da 048). O cliente não alcança: a linha é da organização do escritório.
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE USING (NOT app_equipe_restrita() OR projeto_id IN (SELECT app_projetos_da_pessoa()))', t || '_equipe', t);
  END LOOP;
END $$;

-- Leitura pelo link do administrador judicial, sem sessão: confere o hash, a validade e devolve o QGC
-- com os lastros (id e título do documento). O download do lastro passa por outra função, que confere de novo.
CREATE OR REPLACE FUNCTION qgc_pelo_acesso(p_hash TEXT) RETURNS TABLE(acesso_id UUID, projeto_id UUID, projeto TEXT, nome TEXT, so_validado BOOLEAN, creditos JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a RECORD;
BEGIN
  SELECT x.* INTO a FROM qgc_acessos_externos x WHERE x.token_hash = p_hash AND x.revogado_em IS NULL AND x.expira_em > now();
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE qgc_acessos_externos SET ultimo_uso = now(), usos = usos + 1 WHERE id = a.id;
  RETURN QUERY SELECT a.id, a.projeto_id, (SELECT p.nome FROM projetos p WHERE p.id = a.projeto_id), a.nome, a.so_validado,
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'credor', cr.nome, 'documento', cr.documento, 'natureza', c.natureza, 'valor', c.valor::text,
        'valorSujeito', coalesce(c.valor_sujeito, CASE WHEN coalesce(c.sujeito_validado, c.sujeito_sugerido) = false THEN 0 ELSE c.valor END)::text,
        'classe', coalesce(c.classe_validada, c.classe_sugerida), 'validado', c.classe_validada IS NOT NULL, 'garantia', c.garantia_descricao,
        'lastros', coalesce((SELECT jsonb_agg(jsonb_build_object('documentoId', d.id, 'titulo', d.titulo, 'nome', coalesce(d.nome_original, d.titulo), 'situacao', l.situacao, 'pagina', l.pagina) ORDER BY d.titulo)
                     FROM credito_lastros l JOIN documentos d ON d.id = l.documento_id WHERE l.credito_id = c.id AND l.situacao <> 'recusado' AND d.tem_arquivo), '[]'::jsonb)
      ) ORDER BY coalesce(c.classe_validada, c.classe_sugerida) NULLS LAST, c.valor DESC)
      FROM creditos c JOIN credores cr ON cr.id = c.credor_id
     WHERE c.projeto_id = a.projeto_id AND (NOT a.so_validado OR c.classe_validada IS NOT NULL)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION qgc_pelo_acesso(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qgc_pelo_acesso(TEXT) TO nga_app;

-- Documento que o link pode abrir: só lastro (não recusado) de crédito do projeto do acesso.
CREATE OR REPLACE FUNCTION lastro_pelo_acesso(p_hash TEXT, p_documento UUID) RETURNS TABLE(documento_id UUID, organizacao_id UUID, caminho TEXT, hash_sha256 TEXT, conteudo BYTEA, nome TEXT, tipo_mime TEXT, acesso_id UUID, projeto_id UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT d.id, d.organizacao_id, d.caminho, d.hash_sha256, dc.conteudo, coalesce(d.nome_original, d.titulo), d.tipo_mime, x.id, x.projeto_id
    FROM qgc_acessos_externos x JOIN credito_lastros l ON l.projeto_id = x.projeto_id AND l.situacao <> 'recusado'
    JOIN documentos d ON d.id = l.documento_id AND d.tem_arquivo LEFT JOIN documento_conteudos dc ON dc.documento_id = d.id
   WHERE x.token_hash = p_hash AND x.revogado_em IS NULL AND x.expira_em > now() AND d.id = p_documento LIMIT 1
$$;
REVOKE ALL ON FUNCTION lastro_pelo_acesso(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lastro_pelo_acesso(TEXT, UUID) TO nga_app;

-- ================================================================== 5. portal ===
-- Pedido avulso de documento: além do modelo do procedimento, o advogado pede o que precisar
-- ("comprovante de residência do sócio"), com prazo; vira pendência no portal e e-mail ao cliente.
ALTER TABLE requisitos ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'modelo' CHECK (origem IN ('modelo', 'pedido'));
ALTER TABLE requisitos ADD COLUMN IF NOT EXISTS pedido_por UUID REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE requisitos ADD COLUMN IF NOT EXISTS pedido_em TIMESTAMPTZ;
ALTER TABLE requisitos ADD COLUMN IF NOT EXISTS prazo DATE;
ALTER TABLE requisitos ADD COLUMN IF NOT EXISTS detalhe TEXT CHECK (length(detalhe) <= 2000);

-- E-mail pessoal de quem acessa o portal (além do e-mail de login): é para onde vão os avisos.
-- Fica na organização do escritório: é cadastro interno, o cliente não lê nem altera por aqui.
CREATE TABLE IF NOT EXISTS contatos_cliente (
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  usuario_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  email_pessoal  TEXT CHECK (email_pessoal ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email_pessoal) <= 200),
  telefone       TEXT CHECK (length(telefone) <= 40),
  avisar_por_email BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (projeto_id, usuario_id)
);

-- Fila de e-mails de saída. Nada se perde: sem provedor configurado o e-mail fica "aguardando envio"
-- (a tela diz isso) e a rotina envia quando o envio pela conta Microsoft do escritório for configurado.
CREATE TABLE IF NOT EXISTS emails_saida (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID REFERENCES projetos(id) ON DELETE SET NULL,
  para           TEXT NOT NULL CHECK (length(para) <= 400),
  assunto        TEXT NOT NULL CHECK (length(assunto) <= 300),
  corpo_html     TEXT NOT NULL CHECK (length(corpo_html) <= 60000),
  motivo         TEXT CHECK (length(motivo) <= 80),
  situacao       TEXT NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'enviado', 'falhou', 'cancelado')),
  tentativas     INTEGER NOT NULL DEFAULT 0,
  erro           TEXT,
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_em     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_emails_saida_pendentes ON emails_saida(criado_em) WHERE situacao = 'pendente';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['contatos_cliente', 'emails_saida'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t || '_isolamento', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- Para a rotina de envio (sem sessão): pega pendentes e marca o resultado.
CREATE OR REPLACE FUNCTION emails_pendentes(p_limite INTEGER) RETURNS TABLE(id UUID, para TEXT, assunto TEXT, corpo_html TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.para, e.assunto, e.corpo_html FROM emails_saida e WHERE e.situacao = 'pendente' AND e.tentativas < 6 ORDER BY e.criado_em LIMIT greatest(1, least(p_limite, 50))
$$;
CREATE OR REPLACE FUNCTION email_resultado(p_id UUID, p_ok BOOLEAN, p_erro TEXT) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE emails_saida SET tentativas = tentativas + 1, situacao = CASE WHEN p_ok THEN 'enviado' WHEN tentativas + 1 >= 6 THEN 'falhou' ELSE 'pendente' END,
         enviado_em = CASE WHEN p_ok THEN now() ELSE enviado_em END, erro = CASE WHEN p_ok THEN NULL ELSE left(p_erro, 500) END WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION emails_pendentes(INTEGER) FROM PUBLIC; GRANT EXECUTE ON FUNCTION emails_pendentes(INTEGER) TO nga_app;
REVOKE ALL ON FUNCTION email_resultado(UUID, BOOLEAN, TEXT) FROM PUBLIC; GRANT EXECUTE ON FUNCTION email_resultado(UUID, BOOLEAN, TEXT) TO nga_app;

-- Rotina de e-mails a cada 5 minutos (mesmo comando da rotina de análise, trocando o nome).
DO $$
DECLARE cmd TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  EXECUTE $q$SELECT command FROM cron.job WHERE command LIKE '%/interno/rotina/analise%' ORDER BY jobid LIMIT 1$q$ INTO cmd;
  IF cmd IS NULL THEN RETURN; END IF;
  EXECUTE $q$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nga-rotina-emails'$q$;
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)', 'nga-rotina-emails', '*/5 * * * *', replace(cmd, '/interno/rotina/analise', '/interno/rotina/emails'));
END $$;

-- Boas-vindas do portal: leitura obrigatória dos manuais no primeiro acesso, registrada por pessoa.
CREATE TABLE IF NOT EXISTS portal_leituras (
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  chave      TEXT NOT NULL CHECK (chave ~ '^[a-z0-9_-]{2,40}$'),
  versao     INTEGER NOT NULL DEFAULT 1,
  lido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, chave)
);
ALTER TABLE portal_leituras ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_leituras FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_leituras_propria ON portal_leituras USING (usuario_id = app_usuario_id()) WITH CHECK (usuario_id = app_usuario_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_leituras TO nga_app;

-- Contatos oficiais do escritório mostrados ao cliente (boas-vindas e aba Manuais). Editável em Ajustes.
CREATE TABLE IF NOT EXISTS portal_config (
  organizacao_id UUID PRIMARY KEY REFERENCES organizacoes(id) ON DELETE RESTRICT,
  contatos       JSONB NOT NULL DEFAULT '[]',
  video_url      TEXT CHECK (video_url IS NULL OR video_url ~ '^(https://|/)'),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE portal_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_config FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_config_escrita ON portal_config USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
GRANT SELECT, INSERT, UPDATE ON portal_config TO nga_app;
-- O cliente lê só os contatos (função com dono, sem expor o resto do escritório).
CREATE OR REPLACE FUNCTION portal_contatos_oficiais() RETURNS TABLE(contatos JSONB, video_url TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.contatos, c.video_url FROM portal_config c JOIN organizacoes o ON o.id = c.organizacao_id AND o.tipo = 'escritorio' ORDER BY o.criado_em LIMIT 1
$$;
REVOKE ALL ON FUNCTION portal_contatos_oficiais() FROM PUBLIC; GRANT EXECUTE ON FUNCTION portal_contatos_oficiais() TO nga_app;

-- ======================================================== 6. pré-diagnóstico ===
-- Levantamento a partir do CNPJ (antes mesmo de existir projeto: é o começo do onboarding).
CREATE TABLE IF NOT EXISTS prediagnosticos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID REFERENCES projetos(id) ON DELETE SET NULL,
  cnpj           TEXT NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  razao_social   TEXT,
  dados          JSONB NOT NULL DEFAULT '{}',
  etapa          TEXT NOT NULL DEFAULT 'cadastro' CHECK (etapa IN ('cadastro', 'processos', 'datajud', 'pronto')),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prediagnosticos_cnpj ON prediagnosticos(organizacao_id, cnpj, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_prediagnosticos_projeto ON prediagnosticos(projeto_id) WHERE projeto_id IS NOT NULL;
-- Toda empresa consultada fica na base própria: é com ela que o LAB descobre "outras empresas do mesmo sócio"
-- (a busca reversa por sócio não existe em fonte pública gratuita).
CREATE TABLE IF NOT EXISTS cnpj_cache (
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  cnpj           TEXT NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  razao_social   TEXT,
  dados          JSONB NOT NULL,
  socios_chaves  TEXT[] NOT NULL DEFAULT '{}',
  consultado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, cnpj)
);
CREATE INDEX IF NOT EXISTS idx_cnpj_cache_socios ON cnpj_cache USING gin (socios_chaves);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['prediagnosticos', 'cnpj_cache'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t || '_isolamento', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- ================================================= 7. onboarding comercial ===
-- CNPJ → pré-diagnóstico → reunião inicial → contrato fechado → onboarding (tarefas disparadas).
CREATE TABLE IF NOT EXISTS novos_clientes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id    UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  cnpj              TEXT CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
  nome              TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 2 AND 300),
  prediagnostico_id UUID REFERENCES prediagnosticos(id) ON DELETE SET NULL,
  etapa             TEXT NOT NULL DEFAULT 'prediagnostico' CHECK (etapa IN ('prediagnostico', 'reuniao', 'proposta', 'contrato', 'onboarding', 'concluido', 'perdido')),
  contato_nome      TEXT CHECK (length(contato_nome) <= 200),
  contato_email     TEXT CHECK (length(contato_email) <= 200),
  contato_telefone  TEXT CHECK (length(contato_telefone) <= 40),
  origem            TEXT CHECK (length(origem) <= 200),
  reuniao_em        TIMESTAMPTZ,
  reuniao_realizada BOOLEAN NOT NULL DEFAULT FALSE,
  reuniao_notas     TEXT CHECK (length(reuniao_notas) <= 8000),
  area              TEXT CHECK (length(area) <= 60),
  tipo_projeto      TEXT,
  honorarios        TEXT CHECK (length(honorarios) <= 300),
  contrato_em       DATE,
  responsavel_id    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  projeto_id        UUID REFERENCES projetos(id) ON DELETE SET NULL,
  motivo_perda      TEXT CHECK (length(motivo_perda) <= 500),
  criado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_novos_clientes_etapa ON novos_clientes(organizacao_id, etapa);
-- Aviso para todo o escritório quando um contrato fecha ("novo cliente na área X").
CREATE TABLE IF NOT EXISTS celebracoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID REFERENCES projetos(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL CHECK (length(titulo) <= 300),
  area           TEXT CHECK (length(area) <= 60),
  responsavel    TEXT CHECK (length(responsavel) <= 200),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['novos_clientes', 'celebracoes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t || '_isolamento', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- ================================================== 8. parceiros externos ===
-- Escritório parceiro que toca outra área do mesmo cliente (trabalhista, tributário, criminal...). Entra com o
-- papel `parceiro_externo` na organização do escritório, mas a trava da 048 passa a valer para ele: só enxerga
-- os projetos em que foi incluído. As permissões dele são curtas (RBAC) e a área limita o que aparece.
CREATE OR REPLACE FUNCTION app_equipe_restrita() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM vinculos v WHERE v.usuario_id = app_usuario_id() AND v.revogado_em IS NULL
                   AND v.papel IN ('advogado','estagiario','administrativo','financeiro','parceiro_externo'))
     AND NOT EXISTS (SELECT 1 FROM vinculos v WHERE v.usuario_id = app_usuario_id() AND v.revogado_em IS NULL
                   AND v.papel IN ('socio_administrador','socio','coordenacao','controladoria','integracao'))
$$;

CREATE TABLE IF NOT EXISTS projeto_parceiros (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  usuario_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  area           TEXT NOT NULL CHECK (area IN ('trabalhista', 'tributario', 'criminal', 'civel', 'empresarial', 'outra')),
  escritorio     TEXT CHECK (length(escritorio) <= 200),
  ver_documentos BOOLEAN NOT NULL DEFAULT TRUE,
  ver_processos  BOOLEAN NOT NULL DEFAULT TRUE,
  desde          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ate            TIMESTAMPTZ,
  convidado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  UNIQUE (projeto_id, usuario_id)
);
ALTER TABLE projeto_parceiros ENABLE ROW LEVEL SECURITY;
ALTER TABLE projeto_parceiros FORCE ROW LEVEL SECURITY;
CREATE POLICY projeto_parceiros_isolamento ON projeto_parceiros USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()));
CREATE POLICY projeto_parceiros_equipe ON projeto_parceiros AS RESTRICTIVE USING (NOT app_equipe_restrita() OR projeto_id IN (SELECT app_projetos_da_pessoa()));
GRANT SELECT, INSERT, UPDATE, DELETE ON projeto_parceiros TO nga_app;

-- Convite do parceiro: cria o usuário (ou reaproveita, se já for parceiro em outro projeto), o vínculo de
-- parceiro externo no escritório, a entrada na equipe do projeto (papel "apoio") e a área dele.
CREATE OR REPLACE FUNCTION convidar_parceiro(p_projeto UUID, p_email TEXT, p_nome TEXT, p_senha_hash TEXT, p_area TEXT, p_escritorio TEXT)
RETURNS TABLE(usuario_id UUID, novo BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_org UUID; v_usuario UUID; v_novo BOOLEAN := FALSE;
BEGIN
  SELECT organizacao_id INTO v_org FROM projetos WHERE id = p_projeto;
  IF v_org IS NULL OR v_org NOT IN (SELECT app_organizacoes_visiveis()) OR app_equipe_restrita() THEN
    RAISE EXCEPTION 'só a coordenação/sócios do projeto convidam parceiros';
  END IF;
  SELECT id INTO v_usuario FROM usuarios WHERE email = lower(p_email);
  IF v_usuario IS NULL THEN
    INSERT INTO usuarios (email, nome, senha_hash) VALUES (lower(p_email), p_nome, p_senha_hash) RETURNING id INTO v_usuario; v_novo := TRUE;
  ELSIF EXISTS (SELECT 1 FROM vinculos WHERE usuario_id = v_usuario AND revogado_em IS NULL AND papel <> 'parceiro_externo') THEN
    RAISE EXCEPTION 'este e-mail já pertence a alguém da equipe ou a um cliente';
  END IF;
  INSERT INTO vinculos (usuario_id, organizacao_id, papel) SELECT v_usuario, v_org, 'parceiro_externo'
   WHERE NOT EXISTS (SELECT 1 FROM vinculos WHERE usuario_id = v_usuario AND organizacao_id = v_org AND papel = 'parceiro_externo' AND revogado_em IS NULL);
  INSERT INTO projeto_equipe (projeto_id, organizacao_id, usuario_id, papel)
    SELECT p_projeto, v_org, v_usuario, 'apoio' WHERE NOT EXISTS (SELECT 1 FROM projeto_equipe WHERE projeto_id = p_projeto AND usuario_id = v_usuario AND ate IS NULL);
  INSERT INTO projeto_parceiros (organizacao_id, projeto_id, usuario_id, area, escritorio, convidado_por) VALUES (v_org, p_projeto, v_usuario, p_area, p_escritorio, app_usuario_id())
    ON CONFLICT (projeto_id, usuario_id) DO UPDATE SET area = EXCLUDED.area, escritorio = EXCLUDED.escritorio, ate = NULL;
  RETURN QUERY SELECT v_usuario, v_novo;
END $$;
REVOKE ALL ON FUNCTION convidar_parceiro(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convidar_parceiro(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO nga_app;

-- Toda tabela nova desta rodada que pende de projeto recebe a trava de equipe da 048 (se ainda não tiver).
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'projeto_id' AND NOT a.attisdropped
     WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relrowsecurity AND c.relname NOT IN ('projetos', 'projeto_equipe')
       AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname LIKE '%equipe%')
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE USING (projeto_id IS NULL OR NOT app_equipe_restrita() OR projeto_id IN (SELECT app_projetos_da_pessoa()))', t || '_equipe_restrita', t);
  END LOOP;
END $$;
