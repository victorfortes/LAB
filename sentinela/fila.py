"""Fila de jobs em banco, agendador diário e worker independente do frontend."""
import json
import os
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta
from typing import Callable, Dict, Optional

from . import analise, config as _config, notificacoes
from .motor import Motor
from . import __version__ as _VERSAO

MAX_TENTATIVAS = 3
JOB_TRAVADO_MIN = 120


def agora_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def enfileirar(con: sqlite3.Connection, tipo: str, params: Optional[Dict] = None, origem: str = "manual",
               quando: Optional[datetime] = None) -> int:
    jid = con.execute("INSERT INTO jobs(tipo,params,origem,criado_em) VALUES (?,?,?,?)",
                      (tipo, json.dumps(params or {}), origem, (quando or datetime.now()).isoformat(timespec="seconds"))).lastrowid
    con.commit()
    return jid


def reivindicar(con: sqlite3.Connection) -> Optional[sqlite3.Row]:
    """Pega o job mais antigo na fila de forma atômica (vários workers não pegam o mesmo)."""
    for _ in range(3):
        j = con.execute("SELECT id FROM jobs WHERE status='na_fila' ORDER BY id LIMIT 1").fetchone()
        if not j:
            return None
        cur = con.execute("UPDATE jobs SET status='executando',iniciado_em=?,tentativas=tentativas+1 WHERE id=? AND status='na_fila'",
                          (agora_iso(), j["id"]))
        con.commit()
        if cur.rowcount == 1:
            return con.execute("SELECT * FROM jobs WHERE id=?", (j["id"],)).fetchone()
    return None


def recuperar_travados(con: sqlite3.Connection) -> Dict[str, int]:
    """Após queda do worker: devolve jobs 'executando' à fila (até MAX_TENTATIVAS) e encerra execuções órfãs."""
    limite = (datetime.now() - timedelta(minutes=JOB_TRAVADO_MIN)).isoformat(timespec="seconds")
    rec = con.execute("UPDATE jobs SET status='na_fila' WHERE status='executando' AND iniciado_em<? AND tentativas<?",
                      (limite, MAX_TENTATIVAS)).rowcount
    morto = con.execute("UPDATE jobs SET status='falhou',concluido_em=?,resultado='worker interrompido; tentativas esgotadas' "
                        "WHERE status='executando' AND iniciado_em<? AND tentativas>=?", (agora_iso(), limite, MAX_TENTATIVAS)).rowcount
    orf = con.execute("UPDATE execucoes SET status='interrompida',fim=? WHERE status='em_andamento' AND inicio<?",
                      (agora_iso(), limite)).rowcount
    con.commit()
    return {"jobs_devolvidos": rec, "jobs_esgotados": morto, "execucoes_interrompidas": orf}


def _pipeline_pos_execucao(con, resumo, ia, **kw) -> Dict:
    """Depois de buscar: analisa o que é novo, alerta sem duplicar e avisa se houve falha de consulta."""
    analisadas = 0
    if resumo.get("execucao_id"):
        con.execute("UPDATE execucoes SET progresso=? WHERE id=?", (json.dumps(
            {"pct": 96, "fase": "analise", "texto": "Analisando processos novos e gerando alertas…", "atualizado_em": agora_iso()},
            ensure_ascii=False), resumo["execucao_id"]))
        con.commit()
    for r in con.execute("SELECT c.id,c.processo_id FROM correspondencias c WHERE c.classificacao!='descartada' "
                         "AND c.categoria_data!='processo_antigo' AND NOT EXISTS (SELECT 1 FROM analises a WHERE a.processo_id=c.processo_id)").fetchall():
        analise.analisar(con, r["id"], ia)
        analisadas += 1
    out = {"analises": analisadas, "alertas": notificacoes.processar_pendentes(con, **kw)}
    if resumo.get("consultas_com_falha"):
        out["alerta_falha"] = notificacoes.alertar_falha_execucao(con, resumo["execucao_id"], resumo, **kw)
    return out


def executar_job(con: sqlite3.Connection, motor: Motor, job: sqlite3.Row, ia=None, **kw) -> Dict:
    p = json.loads(job["params"])
    if job["tipo"] == "executar":
        r = motor.executar("agendado" if job["origem"] == "agendador" else "manual", p.get("cliente_ids"),
                           date.fromisoformat(p["desde"]) if p.get("desde") else None,
                           date.fromisoformat(p["ate"]) if p.get("ate") else None, bool(p.get("forcar")))
        return {"execucao": r, **_pipeline_pos_execucao(con, r, ia, **kw)}
    if job["tipo"] == "reprocessar_falhas":
        r = motor.reprocessar_falhas()
        return {"execucao": r, **_pipeline_pos_execucao(con, r, ia, **kw)}
    if job["tipo"] == "alertas":
        return {"alertas": notificacoes.processar_pendentes(con, **kw)}
    if job["tipo"] == "analisar":
        return {"analise_id": analise.analisar(con, p["correspondencia_id"], ia)}
    raise ValueError("tipo de job desconhecido: %s" % job["tipo"])


def rodar_proximo(con, motor, ia=None, **kw) -> Optional[Dict]:
    job = reivindicar(con)
    if job is None:
        return None
    try:
        res = executar_job(con, motor, job, ia, **kw)
        con.execute("UPDATE jobs SET status='concluido',concluido_em=?,resultado=? WHERE id=?",
                    (agora_iso(), json.dumps(res, ensure_ascii=False, default=str), job["id"]))
    except Exception as e:
        novo = "na_fila" if job["tentativas"] < MAX_TENTATIVAS else "falhou"
        con.execute("UPDATE jobs SET status=?,concluido_em=?,resultado=? WHERE id=?",
                    (novo, agora_iso() if novo == "falhou" else None, "erro: %s" % str(e)[:500], job["id"]))
        res = {"erro": str(e)}
    con.commit()
    return {"job": job["id"], **res}


def agendar(con: sqlite3.Connection, agora: Optional[datetime] = None) -> Dict[str, bool]:
    """Decide o que enfileirar agora: execução diária (uma por dia, após o horário) e reprocessamento periódico."""
    agora = agora or datetime.now()
    cfg = _config.obter(con, "agendamento")
    feito = {"executar": False, "reprocessar": False}
    if not cfg["ativo"]:
        return feito
    hh, mm = (int(x) for x in cfg["hora"].split(":"))
    if (agora.hour, agora.minute) >= (hh, mm):
        ja = con.execute("SELECT 1 FROM jobs WHERE origem='agendador' AND tipo='executar' AND date(criado_em)=?",
                         (agora.date().isoformat(),)).fetchone()
        if not ja:
            enfileirar(con, "executar", {}, "agendador", agora)  # janela por consulta: continua do último sucesso; consulta nova recebe a busca inicial
            feito["executar"] = True
    pend = con.execute("SELECT 1 FROM consultas WHERE status='falha' AND concluida_em>=?",
                       ((agora - timedelta(hours=48)).isoformat(timespec="seconds"),)).fetchone()
    ult = con.execute("SELECT max(criado_em) FROM jobs WHERE tipo='reprocessar_falhas'").fetchone()[0]
    aberto = con.execute("SELECT 1 FROM jobs WHERE tipo='reprocessar_falhas' AND status IN ('na_fila','executando')").fetchone()
    if pend and not aberto and (not ult or datetime.fromisoformat(ult) <= agora - timedelta(minutes=cfg["reprocessar_a_cada_min"])):
        enfileirar(con, "reprocessar_falhas", {}, "agendador", agora)
        feito["reprocessar"] = True
    return feito


def proxima_execucao(con: sqlite3.Connection, agora: Optional[datetime] = None) -> Optional[str]:
    agora = agora or datetime.now()
    cfg = _config.obter(con, "agendamento")
    if not cfg["ativo"]:
        return None
    hh, mm = (int(x) for x in cfg["hora"].split(":"))
    hoje_h = agora.replace(hour=hh, minute=mm, second=0, microsecond=0)
    ja = con.execute("SELECT 1 FROM jobs WHERE origem='agendador' AND tipo='executar' AND date(criado_em)=?", (agora.date().isoformat(),)).fetchone()
    alvo = hoje_h if (agora < hoje_h or not ja) else hoje_h + timedelta(days=1)
    return alvo.isoformat(timespec="minutes")


def iniciar_batimento(caminho: str, parar: threading.Event, intervalo: float = 10.0) -> threading.Thread:
    """Thread que carimba 'estou vivo' mesmo durante jobs longos. O painel usa isso para provar que o worker está ativo."""
    inicio = agora_iso()

    def laco():
        c = sqlite3.connect(caminho, timeout=30)
        while not parar.is_set():
            try:
                c.execute("INSERT INTO worker_status(id,pid,iniciado_em,ultimo_batimento,versao) VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                          "pid=excluded.pid,iniciado_em=excluded.iniciado_em,ultimo_batimento=excluded.ultimo_batimento,versao=excluded.versao",
                          (os.getpid(), inicio, agora_iso(), _VERSAO))
                c.commit()
            except sqlite3.Error:
                pass
            parar.wait(intervalo)
        c.close()
    t = threading.Thread(target=laco, daemon=True, name="batimento")
    t.start()
    return t


def laco_worker(con, motor, ia=None, intervalo: float = 20.0, parar: Callable[[], bool] = lambda: False, **kw) -> None:
    print("worker iniciado:", recuperar_travados(con), flush=True)
    caminho = con.execute("PRAGMA database_list").fetchone()[2]
    fim = threading.Event()
    iniciar_batimento(caminho, fim)
    while not parar():
        agendar(con)
        while rodar_proximo(con, motor, ia, **kw) is not None:
            pass
        time.sleep(intervalo)
