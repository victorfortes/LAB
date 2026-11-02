"""Garantia de cobertura: registro de quais dias de publicação foram lidos, por cliente e por consulta.
Um dia só é 'coberto' se TODAS as consultas atuais do cliente leram o dia inteiro, sem truncamento, depois de ele terminar.
O que não está provado como lido aparece como lacuna e é refeito automaticamente."""
import json
import sqlite3
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from . import clientes as _clientes
from .motor import consultas_do_cliente

ORDEM = ["lacuna", "incompleto", "em_curso", "provisorio", "coberto", "sem_historico"]  # do pior para o melhor


def _status_chave(con, cid: int, chave: str, hoje: date, dias: int) -> Dict[str, str]:
    rows = con.execute("SELECT janela_inicio ji,janela_fim jf,status,date(concluida_em) lido FROM consultas "
                       "WHERE cliente_id=? AND chave=? AND status IN ('ok','truncada')", (cid, chave)).fetchall()
    out: Dict[str, str] = {}
    inicio = min((r["ji"] for r in rows), default=None)
    for i in range(dias - 1, -1, -1):
        d = hoje - timedelta(days=i)
        di = d.isoformat()
        if inicio is None or di < inicio:
            out[di] = "sem_historico"
            continue
        cobre = [r for r in rows if r["ji"] <= di <= r["jf"]]
        oks = [r for r in cobre if r["status"] == "ok"]
        if not oks:
            out[di] = "incompleto" if cobre else ("em_curso" if d == hoje else "lacuna")
        elif d == hoje or not any(r["lido"] and r["lido"] > di for r in oks):
            out[di] = "provisorio"
        else:
            out[di] = "coberto"
    return out


def matriz(con: sqlite3.Connection, hoje: Optional[date] = None, dias: int = 30) -> Dict:
    hoje = hoje or date.today()
    clientes = []
    for c in _clientes.ativos(con):
        chaves = [q["chave"] for q in consultas_do_cliente(c)]
        por_chave = {k: _status_chave(con, c["id"], k, hoje, dias) for k in chaves}
        dias_out = []
        for i in range(dias - 1, -1, -1):
            di = (hoje - timedelta(days=i)).isoformat()
            sts = [por_chave[k][di] for k in chaves] or ["sem_historico"]
            com_hist = [x for x in sts if x != "sem_historico"] or ["sem_historico"]
            pior = min(com_hist, key=ORDEM.index)
            dias_out.append({"dia": di, "status": pior, "consultas": len(chaves)})
        cont = {k: sum(1 for x in dias_out if x["status"] == k) for k in ORDEM}
        fechados = cont["coberto"] + cont["lacuna"] + cont["incompleto"] + cont["provisorio"]
        clientes.append({"cliente_id": c["id"], "cliente": c["razao_social"], "dias": dias_out, "contagem": cont,
                         "consultas": chaves, "pct_coberto": round(100.0 * cont["coberto"] / fechados, 1) if fechados else None})
    total = {k: sum(c["contagem"][k] for c in clientes) for k in ORDEM}
    return {"gerado_em": datetime.now().isoformat(timespec="seconds"), "hoje": hoje.isoformat(), "dias": dias,
            "clientes": clientes, "total": total,
            "integra": total["lacuna"] == 0 and total["incompleto"] == 0}


def lacunas(con: sqlite3.Connection, hoje: Optional[date] = None, dias: int = 95) -> List[Dict]:
    """Intervalos contínuos de dias fechados (antes de hoje) não lidos, por cliente e consulta."""
    hoje = hoje or date.today()
    out = []
    for c in _clientes.ativos(con):
        for q in consultas_do_cliente(c):
            st = _status_chave(con, c["id"], q["chave"], hoje, dias)
            ini = fim = None
            for di in sorted(st):
                ruim = st[di] in ("lacuna", "incompleto") and di < hoje.isoformat()
                if ruim and st[di] == "incompleto":  # já tentado hoje e continua truncado: não insiste
                    ruim = not con.execute("SELECT 1 FROM consultas WHERE cliente_id=? AND chave=? AND status='truncada' "
                                           "AND janela_inicio<=? AND janela_fim>=? AND date(concluida_em)=?",
                                           (c["id"], q["chave"], di, di, hoje.isoformat())).fetchone()
                if ruim:
                    ini = ini or di
                    fim = di
                elif ini:
                    out.append({"cliente_id": c["id"], "chave": q["chave"], "ini": ini, "fim": fim})
                    ini = fim = None
            if ini:
                out.append({"cliente_id": c["id"], "chave": q["chave"], "ini": ini, "fim": fim})
    return out


def gravar_relatorio(con: sqlite3.Connection) -> Dict:
    """Guarda a prova do dia (o que foi lido e o que faltou) para auditoria."""
    m = matriz(con, dias=30)
    resumo = {"gerado_em": m["gerado_em"], "integra": m["integra"], "total": m["total"],
              "clientes": [{"cliente": c["cliente"], "contagem": c["contagem"], "pct_coberto": c["pct_coberto"], "consultas": c["consultas"]}
                           for c in m["clientes"]], "lacunas": lacunas(con),
              "execucoes_do_dia": [dict(r) for r in con.execute(
                  "SELECT id,gatilho,inicio,fim,status FROM execucoes WHERE date(inicio)=date('now','localtime') ORDER BY id")]}
    con.execute("INSERT INTO relatorios_cobertura(dia,gerado_em,conteudo) VALUES (date('now','localtime'),?,?) "
                "ON CONFLICT(dia) DO UPDATE SET gerado_em=excluded.gerado_em,conteudo=excluded.conteudo",
                (resumo["gerado_em"], json.dumps(resumo, ensure_ascii=False)))
    con.commit()
    return resumo


# ---------- processos-controle: a única medida real de "estamos perdendo algo?" ----------
def adicionar_controle(con, cliente_id: int, numero: str, observacao: str = "", usuario: str = "") -> int:
    d = "".join(ch for ch in numero if ch.isdigit())
    if len(d) != 20:
        raise ValueError("número CNJ deve ter 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO)")
    return con.execute("INSERT INTO controle_processos(cliente_id,numero_processo,observacao,criado_por) VALUES (?,?,?,?)",
                       (cliente_id, d, observacao, usuario)).lastrowid


def verificar_controle(con: sqlite3.Connection, motor) -> Dict:
    """Para cada processo-controle: está na base? Se não, o DJEN o publicou? Se sim, é falha nossa e é reparada na hora."""
    from . import matcher
    from .motor import _normalizar_item, agora_iso
    res = {"capturado": 0, "recuperado": 0, "revisar": 0, "fora_da_fonte": 0, "erro": 0}
    for r in con.execute("SELECT * FROM controle_processos").fetchall():
        cli = _clientes.carregar(con, r["cliente_id"])
        na_base = con.execute("SELECT 1 FROM correspondencias c JOIN processos p ON p.id=c.processo_id WHERE p.numero_processo=? "
                              "AND c.cliente_id=? AND c.classificacao IN ('confirmada','provavel')", (r["numero_processo"], r["cliente_id"])).fetchone()
        if na_base:
            res_i, det = "capturado", "já está na base como ação contra o cliente"
        else:
            try:
                itens, total, _ = motor.djen.consultar("numeroProcesso", r["numero_processo"], None, None)
            except Exception as e:
                res_i, det = "erro", str(e)[:200]
            else:
                coms = [_normalizar_item(i) for i in itens if len(i.get("numero_processo") or "") == 20]
                achados = [(c, m) for c in coms for m in [matcher.avaliar(cli, c)] if m and m["classificacao"] in ("confirmada", "provavel")]
                if not coms:
                    res_i, det = "fora_da_fonte", "o DJEN não tem comunicações deste processo (limite da fonte, não da pesquisa)"
                elif achados:
                    ex = con.execute("INSERT INTO execucoes(gatilho,inicio) VALUES ('controle',?)", (agora_iso(),)).lastrowid
                    con.commit()
                    hoje = date.today().isoformat()
                    motor._persistir(ex, cli, [{"q": {"chave": "numeroProcesso:" + r["numero_processo"], "param": "numeroProcesso",
                                                      "valor": r["numero_processo"]}, "ini": hoje, "fim": hoje, "inicio": agora_iso(),
                                                "status": "ok", "total": total, "lidos": len(coms), "erro": None, "achados": achados}])
                    con.execute("UPDATE execucoes SET fim=?,status='sucesso' WHERE id=?", (agora_iso(), ex))
                    res_i, det = "recuperado", "o DJEN publicou e a pesquisa NÃO tinha pego; foi incluído agora (investigar a causa)"
                else:
                    res_i, det = "revisar", "o DJEN tem comunicações, mas as partes não casam com o cliente pelas regras: conferir nomes"
        con.execute("UPDATE controle_processos SET resultado=?,detalhe=?,verificado_em=? WHERE id=?",
                    (res_i, det, datetime.now().isoformat(timespec="seconds"), r["id"]))
        res[res_i] += 1
    con.commit()
    base = res["capturado"] + res["recuperado"] + res["revisar"]
    res["recall_pct"] = round(100.0 * res["capturado"] / base, 1) if base else None
    return res
