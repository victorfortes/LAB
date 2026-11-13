-- 069 — Libera espaço: o histórico completo do DataJud encheu o banco do plano gratuito (500 MB) e o deixou
-- só-leitura (gerador de relatórios, BI, vínculos e Sentinela pararam de gravar). Fica só o essencial:
-- os 40 movimentos mais recentes de cada processo nos últimos 3 anos, com complemento curto.
-- Movimentos manuais e de outras fontes não são tocados. Depois desta migração, rodar VACUUM FULL movimentacoes
-- (fora de transação) para devolver o espaço ao disco.
DELETE FROM movimentacoes m
 USING (SELECT id, row_number() OVER (PARTITION BY processo_id ORDER BY data DESC, criado_em DESC) AS n, data
          FROM movimentacoes WHERE fonte = 'datajud') x
 WHERE m.id = x.id AND (x.n > 40 OR x.data < (now() - interval '3 years')::date)
   AND NOT m.visivel_ao_cliente
   AND NOT EXISTS (SELECT 1 FROM prazos z WHERE z.movimentacao_id = m.id);
UPDATE movimentacoes SET conteudo = left(conteudo, 240), titulo = left(titulo, 200)
 WHERE fonte = 'datajud' AND (length(conteudo) > 240 OR length(titulo) > 200);
UPDATE datajud_monitor d SET movimentos = (SELECT count(*) FROM movimentacoes m WHERE m.processo_id = d.processo_id AND m.fonte = 'datajud');
