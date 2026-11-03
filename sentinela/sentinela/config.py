"""Configurações em banco (não secretas). Segredos (SMTP, webhook Slack, chave de IA) vêm só de variáveis de ambiente."""
import json
import sqlite3

PADRAO = {
    "agendamento": {"ativo": True, "hora": "06:00", "reprocessar_a_cada_min": 30},
    "notificacoes": {"interno": True, "email": False, "slack": False, "emails": [], "email_remetente": "sentinela@localhost",
                     "smtp_host": "", "smtp_porta": 587},
    "prioridade": {"palavras_alta": ["tutela de urgência", "tutela provisória", "liminar", "bloqueio", "penhora", "sisbajud",
                                     "arresto", "falência", "pedido de falência", "execução", "busca e apreensão"],
                   "classes_alta": ["falência", "execução", "tutela", "cautelar", "busca e apreensão"],
                   "valor_alto": 1000000.0, "valor_medio": 100000.0},
    "motor": {"dias_nova_distribuicao": 15, "limite_enriquecimento": 2000, "dias_busca_inicial": 90},
    "retencao": {"comunicacoes_dias": 730},
}


def obter(con: sqlite3.Connection, chave: str) -> dict:
    r = con.execute("SELECT valor FROM configuracoes WHERE chave=?", (chave,)).fetchone()
    base = dict(PADRAO[chave])
    if r:
        base.update(json.loads(r[0]))
    return base


def salvar(con: sqlite3.Connection, chave: str, valor: dict) -> None:
    if chave not in PADRAO:
        raise KeyError(chave)
    con.execute("INSERT INTO configuracoes(chave,valor,atualizado_em) VALUES (?,?,datetime('now')) ON CONFLICT(chave) DO UPDATE "
                "SET valor=excluded.valor, atualizado_em=excluded.atualizado_em", (chave, json.dumps(valor, ensure_ascii=False)))
    con.commit()


def todas(con: sqlite3.Connection) -> dict:
    return {k: obter(con, k) for k in PADRAO}
