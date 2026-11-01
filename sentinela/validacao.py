"""Central de validação: decisão humana sobre correspondências não confirmadas, com trilha de auditoria."""
import json
import sqlite3
from typing import Dict, List


def pendentes(con: sqlite3.Connection, cliente_id: int = None, limite: int = 100) -> List[Dict]:
    q = ("SELECT c.id,c.classificacao,c.nivel,c.polo,c.nome_na_fonte,c.categoria_data,c.evidencia,p.numero_processo,p.tribunal,"
         "p.data_ajuizamento,cl.razao_social FROM correspondencias c JOIN processos p ON p.id=c.processo_id "
         "JOIN clientes cl ON cl.id=c.cliente_id WHERE c.estado_validacao='pendente'")
    args: list = []
    if cliente_id:
        q += " AND c.cliente_id=?"; args.append(cliente_id)
    q += " ORDER BY (c.classificacao='provavel') DESC, c.identificada_em LIMIT ?"
    return [dict(r) for r in con.execute(q, args + [limite])]


def decidir(con: sqlite3.Connection, correspondencia_id: int, usuario: str, decisao: str, justificativa: str = "") -> None:
    if decisao not in ("confirmada", "descartada"):
        raise ValueError("decisão inválida")
    r = con.execute("SELECT classificacao FROM correspondencias WHERE id=?", (correspondencia_id,)).fetchone()
    if r is None:
        raise KeyError(correspondencia_id)
    con.execute("INSERT INTO validacoes(correspondencia_id,usuario,decisao,classificacao_anterior,justificativa) VALUES (?,?,?,?,?)",
                (correspondencia_id, usuario, decisao, r["classificacao"], justificativa))
    con.execute("UPDATE correspondencias SET classificacao=?,estado_validacao=? WHERE id=?",
                (decisao, "confirmado_manual" if decisao == "confirmada" else "descartado_manual", correspondencia_id))
    con.commit()


def decidir_em_lote(con: sqlite3.Connection, ids: List[int], usuario: str, decisao: str, justificativa: str) -> int:
    for i in ids:
        decidir(con, i, usuario, decisao, justificativa)
    return len(ids)
