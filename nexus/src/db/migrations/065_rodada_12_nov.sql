-- 065 — Rodada de 12/11/2026: diagnóstico (segmento e patrimônio dos sócios), BI de Prazos no Nexus,
-- andamentos pelo DataJud, publicações do Astrea para conferência e cofre de credenciais.
--
-- Tudo aqui é interno ao escritório: nenhuma política de portal.

-- ------------------------------------------------------------ diagnóstico ---
-- Segmento do cliente: decide blocos que só fazem sentido para alguns (frota só para transportadora).
ALTER TABLE projetos ADD COLUMN IF NOT EXISTS segmento TEXT
  CHECK (segmento IN ('transportadora','industria','comercio','servicos','agronegocio','construcao','saude','outro'));

-- Patrimônio dos sócios: cada bem com dono, natureza, valor e ônus, sempre com a fonte.
CREATE TABLE socios_patrimonio (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  socio          TEXT NOT NULL CHECK (length(btrim(socio)) BETWEEN 2 AND 200),
  documento      TEXT CHECK (documento IS NULL OR documento ~ '^[0-9]{11}$|^[0-9]{14}$'),
  qualificacao   TEXT CHECK (length(qualificacao) <= 200),
  natureza       TEXT NOT NULL CHECK (natureza IN ('imovel','veiculo','participacao','aplicacao','rural','outro','sem_bens')),
  descricao      TEXT NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 500),
  valor          BIGINT CHECK (valor >= 0),
  onus           TEXT CHECK (length(onus) <= 300),
  -- O sócio deu aval ou fiança em dívida da empresa: muda tudo na estratégia.
  garantidor     BOOLEAN NOT NULL DEFAULT FALSE,
  fonte          TEXT NOT NULL DEFAULT 'manual' CHECK (fonte IN ('manual','qsa','documento')),
  referencia     TEXT CHECK (length(referencia) <= 300),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_socios_patrimonio_projeto ON socios_patrimonio(projeto_id, socio);

-- ------------------------------------------------------------ BI de prazos ---
-- A mesma base do painel publicado (prazos, eventos e audiências do Astrea), entregue pela automação.
CREATE TABLE bi_agenda_linhas (
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  ordem          INTEGER NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('Prazo','Evento','Audiência')),
  data           TEXT NOT NULL CHECK (data ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'),
  hora           TEXT CHECK (hora IS NULL OR hora = '' OR hora ~ '^[0-9]{2}:[0-9]{2}$'),
  caso           TEXT NOT NULL DEFAULT '',
  conclusao      TEXT NOT NULL DEFAULT '',
  juizo          TEXT NOT NULL DEFAULT '',
  numero         TEXT NOT NULL DEFAULT '',
  resp           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT '',
  titulo         TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (organizacao_id, ordem)
);
CREATE TABLE bi_agenda_cargas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  atualizado_em  TIMESTAMPTZ NOT NULL,
  recebido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  total          INTEGER NOT NULL CHECK (total >= 0),
  prazos         INTEGER NOT NULL DEFAULT 0,
  eventos        INTEGER NOT NULL DEFAULT 0,
  origem         TEXT NOT NULL CHECK (origem IN ('automacao','manual')),
  enviado_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX idx_bi_agenda_cargas ON bi_agenda_cargas(organizacao_id, recebido_em DESC);
-- Credencial de exibição para a TV: só lê o BI. Guardamos o hash; vale até revogar ou expirar.
CREATE TABLE bi_tv_acessos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  token_hash     TEXT NOT NULL UNIQUE,
  nome           TEXT NOT NULL DEFAULT 'TV do escritório',
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em      TIMESTAMPTZ NOT NULL,
  ultimo_uso     TIMESTAMPTZ,
  revogado_em    TIMESTAMPTZ
);

-- A TV não tem sessão: a leitura passa por esta função, que confere o hash e devolve só as linhas.
CREATE FUNCTION bi_agenda_pela_tv(p_hash TEXT) RETURNS TABLE(organizacao_id UUID, atualizado_em TIMESTAMPTZ, linhas JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org UUID;
BEGIN
  UPDATE bi_tv_acessos SET ultimo_uso = now()
   WHERE token_hash = p_hash AND revogado_em IS NULL AND expira_em > now()
   RETURNING bi_tv_acessos.organizacao_id INTO v_org;
  IF v_org IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT v_org,
    (SELECT c.atualizado_em FROM bi_agenda_cargas c WHERE c.organizacao_id = v_org ORDER BY c.recebido_em DESC LIMIT 1),
    coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('tipo', l.tipo, 'data', l.data, 'hora', nullif(l.hora, ''), 'caso', l.caso,
        'conclusao', l.conclusao, 'juizo', l.juizo, 'numero', l.numero, 'resp', l.resp, 'status', l.status, 'titulo', l.titulo)) ORDER BY l.ordem)
       FROM bi_agenda_linhas l WHERE l.organizacao_id = v_org), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION bi_agenda_pela_tv(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bi_agenda_pela_tv(TEXT) TO nga_app;

-- ------------------------------------------------- andamentos pelo DataJud ---
-- Um registro por processo acompanhado: quando consultou, se deu certo e quando volta.
CREATE TABLE datajud_monitor (
  processo_id     UUID PRIMARY KEY REFERENCES processos(id) ON DELETE CASCADE,
  organizacao_id  UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  indice          TEXT,
  ultima_consulta TIMESTAMPTZ,
  ultimo_sucesso  TIMESTAMPTZ,
  ultimo_erro     TEXT,
  falhas          INTEGER NOT NULL DEFAULT 0,
  encontrado      BOOLEAN,
  movimentos      INTEGER NOT NULL DEFAULT 0,
  ultimo_movimento DATE,
  proxima         TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_datajud_monitor_fila ON datajud_monitor(proxima) WHERE ativo;

-- A rotina roda sem sessão: estas funções entregam a fila e gravam o resultado, sem abrir o resto do banco.
CREATE FUNCTION datajud_fila(p_limite INTEGER) RETURNS TABLE(processo_id UUID, organizacao_id UUID, numero TEXT, indice TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.processo_id, m.organizacao_id, p.numero, m.indice FROM datajud_monitor m JOIN processos p ON p.id = m.processo_id
   WHERE m.ativo AND m.proxima <= now() ORDER BY m.proxima, m.ultima_consulta NULLS FIRST LIMIT greatest(1, least(p_limite, 50))
$$;
REVOKE ALL ON FUNCTION datajud_fila(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION datajud_fila(INTEGER) TO nga_app;

CREATE FUNCTION datajud_registrar(p_processo UUID, p_indice TEXT, p_ok BOOLEAN, p_encontrado BOOLEAN, p_erro TEXT, p_movimentos JSONB, p_dados JSONB)
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
    -- O DataJud também traz a capa: preenche só o que está vazio, nunca sobrescreve o que alguém digitou.
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
         encontrado = CASE WHEN p_ok THEN p_encontrado ELSE encontrado END,
         movimentos = (SELECT count(*) FROM movimentacoes WHERE processo_id = p_processo AND fonte = 'datajud'),
         ultimo_movimento = (SELECT max(data) FROM movimentacoes WHERE processo_id = p_processo),
         -- Deu certo: volta amanhã. Falhou: espera mais a cada falha (1 h, 2 h, 4 h… até 1 dia).
         proxima = CASE WHEN p_ok THEN now() + interval '20 hours' ELSE now() + least(interval '24 hours', interval '1 hour' * power(2, least(falhas, 5))) END
   WHERE processo_id = p_processo;
  RETURN v_novos;
END $$;
REVOKE ALL ON FUNCTION datajud_registrar(UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION datajud_registrar(UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, JSONB, JSONB) TO nga_app;

-- Todo processo com número CNJ entra no acompanhamento; os novos entram sozinhos.
CREATE FUNCTION datajud_acompanhar_novo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO datajud_monitor (processo_id, organizacao_id) VALUES (NEW.id, NEW.organizacao_id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER processos_datajud AFTER INSERT ON processos FOR EACH ROW EXECUTE FUNCTION datajud_acompanhar_novo();
INSERT INTO datajud_monitor (processo_id, organizacao_id) SELECT id, organizacao_id FROM processos ON CONFLICT DO NOTHING;

-- Histórico manual do projeto que não pertence a um processo (reunião, negociação, diligência).
-- Andamento de processo continua em `movimentacoes` (fonte manual ou datajud).
CREATE TABLE projeto_historicos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  projeto_id     UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  data           DATE NOT NULL,
  titulo         TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 2 AND 300),
  texto          TEXT CHECK (length(texto) <= 8000),
  criado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projeto_historicos ON projeto_historicos(projeto_id, data DESC);

-- ------------------------------------------ publicações vindas do Astrea ---
-- O que o Astrea recebeu, para conferir com o que o Nexus recebeu do DJEN.
CREATE TABLE astrea_publicacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  data           DATE NOT NULL,
  numero         TEXT NOT NULL DEFAULT '',
  tribunal       TEXT,
  orgao          TEXT,
  resumo         TEXT CHECK (length(resumo) <= 4000),
  prazo          DATE,
  chave          TEXT NOT NULL,
  recebido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, chave)
);
CREATE INDEX idx_astrea_publicacoes_data ON astrea_publicacoes(organizacao_id, data DESC);
CREATE TABLE conferencias_publicacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  dia            DATE NOT NULL,
  astrea         INTEGER NOT NULL,
  nexus          INTEGER NOT NULL,
  em_ambos       INTEGER NOT NULL,
  so_astrea      INTEGER NOT NULL,
  so_nexus       INTEGER NOT NULL,
  detalhe        JSONB NOT NULL DEFAULT '{}',
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, dia)
);

-- ----------------------------------------------------- cofre de credenciais ---
-- Senha de sistema externo, cifrada no servidor (AES-256-GCM). O banco guarda só o texto cifrado.
CREATE TABLE cofre_credenciais (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id UUID NOT NULL REFERENCES organizacoes(id) ON DELETE RESTRICT,
  servico        TEXT NOT NULL CHECK (servico IN ('astrea')),
  usuario        TEXT NOT NULL CHECK (length(usuario) BETWEEN 3 AND 200),
  segredo        TEXT NOT NULL CHECK (segredo ~ '^v1:'),
  atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, servico)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['socios_patrimonio','projeto_historicos','bi_agenda_linhas','bi_agenda_cargas','bi_tv_acessos','datajud_monitor','astrea_publicacoes','conferencias_publicacoes','cofre_credenciais'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %1$I_iso ON %1$I USING (organizacao_id IN (SELECT app_organizacoes_visiveis())) WITH CHECK (organizacao_id IN (SELECT app_organizacoes_visiveis()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nga_app', t);
  END LOOP;
END $$;

-- Patrimônio dos sócios segue a visibilidade por equipe do projeto.
CREATE POLICY socios_patrimonio_equipe ON socios_patrimonio AS RESTRICTIVE
  USING (NOT app_equipe_restrita() OR projeto_id IN (SELECT app_projetos_da_pessoa()));
CREATE POLICY projeto_historicos_equipe ON projeto_historicos AS RESTRICTIVE
  USING (NOT app_equipe_restrita() OR projeto_id IN (SELECT app_projetos_da_pessoa()));
