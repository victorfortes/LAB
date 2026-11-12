-- 066 — Agenda da rotina de andamentos (DataJud), a cada 5 minutos, na nuvem.
--
-- Só existe onde há pg_cron (Supabase). Reaproveita o comando da rotina de análise, que já carrega o
-- endereço da função e a chave interna, trocando só o nome da rotina: nenhum segredo fica neste arquivo.
DO $$
DECLARE cmd TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  EXECUTE $q$SELECT command FROM cron.job WHERE command LIKE '%/interno/rotina/analise%' ORDER BY jobid LIMIT 1$q$ INTO cmd;
  IF cmd IS NULL THEN RAISE NOTICE 'rotina de análise não agendada: agende a de andamentos à mão'; RETURN; END IF;
  EXECUTE $q$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nga-rotina-datajud'$q$;
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)', 'nga-rotina-datajud', '*/5 * * * *', replace(cmd, '/interno/rotina/analise', '/interno/rotina/datajud'));
END $$;
