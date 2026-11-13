-- 069 — A busca de andamentos no DataJud a cada 5 minutos disputava a API pública com o Sentinela
-- (o DataJud devolvia 429 e o Sentinela desistia). Passa a rodar a cada 15 minutos.
-- O teto de 40 movimentos por processo fica no código (andamentos.ts), sem apagar nada que já foi gravado.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  EXECUTE $q$SELECT cron.alter_job(jobid, schedule := '*/15 * * * *') FROM cron.job WHERE jobname = 'nga-rotina-datajud'$q$;
END $$;
