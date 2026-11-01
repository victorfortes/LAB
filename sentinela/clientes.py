"""Cadastro de clientes: individual e importação em lote por CSV."""
import csv
import json
import sqlite3
from typing import Dict, List, Optional

from . import cnpj as _cnpj
from . import nomes as _nomes


def _add_nome(con, cid, nome, tipo):
    n = _nomes.normalizar(nome)
    if n:
        con.execute("INSERT OR IGNORE INTO cliente_nomes(cliente_id,nome,nome_norm,tipo) VALUES (?,?,?,?)",
                    (cid, nome.strip(), n, tipo))


def cadastrar(con: sqlite3.Connection, razao_social: str, cnpj_matriz: str, nome_fantasia: str = "",
              filiais: Optional[List[str]] = None, anteriores: Optional[List[str]] = None,
              alternativos: Optional[List[str]] = None, **extra) -> int:
    matriz = _cnpj.normalizar(cnpj_matriz)
    filiais = [_cnpj.normalizar(f) for f in (filiais or [])]
    cur = con.execute(
        "INSERT INTO clientes(razao_social,nome_fantasia,cnpj_matriz,grupo_economico,advogado_responsavel,equipe,"
        "status_monitoramento,tribunais_prioritarios,frequencia_horas) VALUES (?,?,?,?,?,?,?,?,?)",
        (razao_social.strip(), nome_fantasia.strip() or None, matriz, extra.get("grupo_economico"),
         extra.get("advogado_responsavel"), extra.get("equipe"), extra.get("status_monitoramento", "ativo"),
         json.dumps(extra.get("tribunais_prioritarios", [])), int(extra.get("frequencia_horas", 24))))
    cid = cur.lastrowid
    con.execute("INSERT INTO cliente_cnpjs VALUES (?,?,'matriz')", (cid, matriz))
    for f in filiais:
        con.execute("INSERT OR IGNORE INTO cliente_cnpjs VALUES (?,?,'filial')", (cid, f))
    _add_nome(con, cid, razao_social, "razao_social")
    if nome_fantasia:
        _add_nome(con, cid, nome_fantasia, "fantasia")
    for n in anteriores or []:
        _add_nome(con, cid, n, "anterior")
    for n in alternativos or []:
        _add_nome(con, cid, n, "alternativo")
    con.commit()
    return cid


def _lista(v: str) -> List[str]:
    return [x.strip() for x in (v or "").split(";") if x.strip()]


def importar_csv(con: sqlite3.Connection, caminho: str) -> Dict[str, object]:
    """Colunas: razao_social, cnpj_matriz, nome_fantasia, filiais, anteriores, alternativos,
    grupo_economico, advogado_responsavel, equipe. Listas separadas por ';'.
    Linhas inválidas não interrompem a importação; são devolvidas em 'erros'."""
    ok, erros, ids = 0, [], []
    with open(caminho, newline="", encoding="utf-8-sig") as f:
        amostra = f.read(2048)
        f.seek(0)
        delim = ";" if amostra.count(";") > amostra.count(",") else ","
        for i, row in enumerate(csv.DictReader(f, delimiter=delim), start=2):
            try:
                ids.append(cadastrar(con, row["razao_social"], row["cnpj_matriz"], row.get("nome_fantasia", ""),
                          filiais=_lista(row.get("filiais", "")), anteriores=_lista(row.get("anteriores", "")),
                          alternativos=_lista(row.get("alternativos", "")),
                          grupo_economico=row.get("grupo_economico") or None,
                          advogado_responsavel=row.get("advogado_responsavel") or None,
                          equipe=row.get("equipe") or None))
                ok += 1
            except (ValueError, KeyError, sqlite3.IntegrityError) as e:
                erros.append({"linha": i, "erro": str(e)})
    return {"importados": ok, "erros": erros, "ids": ids}


def carregar(con: sqlite3.Connection, cid: int) -> Dict[str, object]:
    c = dict(con.execute("SELECT * FROM clientes WHERE id=?", (cid,)).fetchone())
    c["cnpjs"] = [dict(r) for r in con.execute("SELECT cnpj,tipo FROM cliente_cnpjs WHERE cliente_id=?", (cid,))]
    c["nomes"] = [dict(r) for r in con.execute("SELECT nome,nome_norm,tipo FROM cliente_nomes WHERE cliente_id=?", (cid,))]
    return c


def ativos(con: sqlite3.Connection) -> List[Dict[str, object]]:
    ids = [r[0] for r in con.execute("SELECT id FROM clientes WHERE status_monitoramento='ativo' ORDER BY id")]
    return [carregar(con, i) for i in ids]
