"""Teste REAL contra DJEN e DataJud (rede necessária). Gera relatório em docs/evidencias/.
ATENÇÃO: usa uma companhia aberta (dados públicos) apenas para validar o motor; NÃO são clientes da NGA.
Substituir por CNPJs autorizados da NGA assim que fornecidos. Uso: python3 tests/teste_real_fontes.py [AAAA-MM-DD]"""
import json
import os
import sys
import tempfile
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sentinela import clientes, db
from sentinela.cli import montar_motor

dia = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date(2026, 10, 29)
con = db.conectar(os.path.join(tempfile.mkdtemp(), "real.db"))
cid = clientes.cadastrar(con, "Magazine Luiza S.A.", "47.960.950/0001-21", nome_fantasia="Magalu")
m = montar_motor(con, limite_enriquecimento=3)
r1 = m.executar("teste_real", desde=dia, ate=dia)
cls = {x[0]: x[1] for x in con.execute("SELECT classificacao,count(*) FROM correspondencias GROUP BY 1")}
amostra = [dict(x) for x in con.execute(
    "SELECT p.numero_processo,p.tribunal,p.data_ajuizamento,p.sistema,p.datajud_status,c.classificacao,c.nivel,c.polo,"
    "c.categoria_data,c.fonte FROM correspondencias c JOIN processos p ON p.id=c.processo_id "
    "ORDER BY (c.classificacao='confirmada') DESC, p.datajud_status='ok' DESC LIMIT 10")]
r2 = m.executar("teste_real_repeticao", desde=dia, ate=dia)  # mesma janela já encerrada: deve pular
tot = {t: con.execute("SELECT count(*) FROM %s" % t).fetchone()[0] for t in ("comunicacoes", "processos", "correspondencias", "consultas")}
dup = con.execute("SELECT count(*) FROM (SELECT cliente_id,processo_id FROM correspondencias GROUP BY 1,2 HAVING count(*)>1)").fetchone()[0]
rel = {"data_teste": str(dia), "execucao_1": r1, "classificacao": cls, "execucao_2_mesma_janela": r2, "totais_tabelas": tot,
       "duplicidades_correspondencia": dup, "saude": [dict(x) for x in con.execute("SELECT * FROM saude_conectores")],
       "amostra_sem_nomes_de_partes": amostra}
os.makedirs("docs/evidencias", exist_ok=True)
json.dump(rel, open("docs/evidencias/teste_real_fase2.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(rel, ensure_ascii=False, indent=1))
