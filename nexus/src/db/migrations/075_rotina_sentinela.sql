-- A rodagem da Sentinela (varredura DJEN + enriquecimento DataJud dos clientes monitorados) tinha
-- endpoint na função Edge (/interno/rotina/sentinela) mas NENHUM pg_cron a disparava: por isso ela
-- não rodava sozinha. Aqui agendamos a rotina, copiando o comando da rotina de análise (que já leva o
-- segredo x-nga-rotina) e trocando só o caminho — o mesmo padrão de datajud/slack/relatorios.
-- A rotina se autolimita no tempo e o planejar() respeita a frequência de cada cliente, então rodar a
-- cada 15 min só processa o que está vencido, sem martelar as fontes.
DO $$
DECLARE cmd TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  EXECUTE $q$SELECT command FROM cron.job WHERE command LIKE '%/interno/rotina/analise%' ORDER BY jobid LIMIT 1$q$ INTO cmd;
  IF cmd IS NULL THEN RETURN; END IF;
  EXECUTE $q$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nga-rotina-sentinela'$q$;
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)', 'nga-rotina-sentinela', '*/15 * * * *', replace(cmd, '/interno/rotina/analise', '/interno/rotina/sentinela'));
END $$;
