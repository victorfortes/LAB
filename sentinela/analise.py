"""Análise jurídica automatizada. Separa três tipos de informação em cada campo:
  fonte        - dado extraído diretamente de DJEN/DataJud;
  inferencia   - dedução por regra ou pela IA a partir do texto disponível;
  nao_verificado - informação ausente nas fontes públicas (ex.: valor da causa, pedidos).
A petição inicial NÃO é obtida: DJEN e DataJud não a disponibilizam. A IA só vê o texto das comunicações coletadas."""
import json
import os
import re
import sqlite3
import urllib.request
from datetime import datetime
from typing import Callable, Dict, List, Optional

from . import config as _config

NAO_DISP = {"valor": None, "origem": "nao_verificado", "nota": "não disponível nas fontes públicas consultadas"}


def _campo(valor, origem, nota=None):
    d = {"valor": valor, "origem": origem}
    if nota:
        d["nota"] = nota
    return d


def contexto(con: sqlite3.Connection, correspondencia_id: int) -> Dict:
    c = con.execute("SELECT c.*,p.numero_processo,p.tribunal,p.classe,p.orgao,p.data_ajuizamento,p.sistema,p.assuntos,p.grau,"
                    "p.datajud_status,cl.razao_social FROM correspondencias c JOIN processos p ON p.id=c.processo_id "
                    "JOIN clientes cl ON cl.id=c.cliente_id WHERE c.id=?", (correspondencia_id,)).fetchone()
    if c is None:
        raise KeyError(correspondencia_id)
    coms = [dict(r) for r in con.execute("SELECT * FROM comunicacoes WHERE numero_processo=? ORDER BY data_disponibilizacao",
                                         (c["numero_processo"],))]
    for x in coms:
        x["destinatarios"] = json.loads(x["destinatarios"])
    return {"corr": dict(c), "comunicacoes": coms}


_RE_VALOR = re.compile(r"valor\s+da\s+causa[^R\d]{0,40}R\$\s*([\d.]+,\d{2})", re.I)


def _valor_causa(texto: str) -> Optional[float]:
    m = _RE_VALOR.search(texto)
    return float(m.group(1).replace(".", "").replace(",", ".")) if m else None


def extrair_fatos(ctx: Dict) -> Dict[str, Dict]:
    c, coms = ctx["corr"], ctx["comunicacoes"]
    texto = " ".join(x["texto"] or "" for x in coms)
    ativos = sorted({d["nome"] for x in coms for d in x["destinatarios"] if d["polo"] == "A"})
    passivos = sorted({d["nome"] for x in coms for d in x["destinatarios"] if d["polo"] == "P"})
    valor = _valor_causa(texto)
    tutela = bool(re.search(r"tutela\s+(de\s+urg[eê]ncia|provis[oó]ria|antecipada)|liminar", texto, re.I))
    assuntos = json.loads(c["assuntos"]) if c.get("assuntos") else []
    return {
        "numero_processo": _campo(c["numero_processo"], "fonte"),
        "tribunal": _campo(c["tribunal"], "fonte"),
        "comarca_vara": _campo(c["orgao"], "fonte") if c["orgao"] else dict(NAO_DISP),
        "data_distribuicao": _campo(c["data_ajuizamento"], "fonte", "DataJud") if c["data_ajuizamento"] else dict(NAO_DISP),
        "classe": _campo(c["classe"], "fonte") if c["classe"] else dict(NAO_DISP),
        "assunto": _campo(assuntos, "fonte", "DataJud") if assuntos else dict(NAO_DISP),
        "autor": _campo(ativos, "fonte", "polo ativo nas comunicações do DJEN") if ativos else dict(NAO_DISP),
        "reu": _campo(passivos, "fonte", "polo passivo nas comunicações do DJEN") if passivos else dict(NAO_DISP),
        "valor_causa": _campo(valor, "fonte", "extraído do texto da comunicação") if valor else dict(NAO_DISP),
        "tutela_provisoria": _campo(tutela, "inferencia", "regra por palavras-chave no texto das comunicações"),
        "principais_fatos": dict(NAO_DISP), "fundamentos_juridicos": dict(NAO_DISP), "pedidos": dict(NAO_DISP),
    }


class IAAnthropic:
    """Chama a API da Anthropic (requer ANTHROPIC_API_KEY). Não testada ao vivo neste ambiente sem chave."""
    modelo = os.environ.get("SENTINELA_MODELO_IA", "claude-sonnet-5-5")

    def __init__(self, chave: str):
        self.chave = chave

    def gerar(self, prompt: str) -> str:
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", method="POST", data=json.dumps({
            "model": self.modelo, "max_tokens": 1200, "messages": [{"role": "user", "content": prompt}]}).encode(),
            headers={"x-api-key": self.chave, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read())["content"][0]["text"]


def ia_do_ambiente() -> Optional[IAAnthropic]:
    k = os.environ.get("ANTHROPIC_API_KEY")
    return IAAnthropic(k) if k else None


PROMPT = """Você é advogado associado de um escritório empresarial especializado em insolvência. Com base EXCLUSIVAMENTE nos
trechos abaixo (comunicações públicas do DJEN), responda em JSON com as chaves: resumo (até 4 frases objetivas),
principais_fatos (lista), fundamentos_juridicos (lista), pedidos (lista), urgencia_aparente (true/false), justificativa_urgencia.
Regras: não invente fatos, valores ou pedidos; use [] quando o texto não permitir afirmar; se o texto for apenas ato de
mero expediente, diga isso no resumo. Dados do processo: {dados}.
TRECHOS:
{trechos}
"""


def _classificar(fatos: Dict, texto: str, urg_ia: bool, cfg: Dict) -> (str, bool, List[str]):
    motivos, pontos = [], 0
    low = texto.lower()
    for k in cfg["palavras_alta"]:
        if k.lower() in low:
            pontos += 2; motivos.append("termo '%s' no texto" % k); break
    classe = (fatos["classe"]["valor"] or "").lower()
    if any(k.lower() in classe for k in cfg["classes_alta"]):
        pontos += 2; motivos.append("classe processual sensível")
    v = fatos["valor_causa"]["valor"]
    if v is not None and v >= cfg["valor_alto"]:
        pontos += 3; motivos.append("valor da causa elevado")
    elif v is not None and v >= cfg["valor_medio"]:
        pontos += 1; motivos.append("valor da causa médio")
    if fatos["tutela_provisoria"]["valor"]:
        pontos += 2; motivos.append("indício de tutela provisória")
    if fatos["data_distribuicao"]["valor"] == datetime.now().date().isoformat():
        pontos += 3; motivos.append("ajuizado hoje")
    if urg_ia:
        pontos += 1; motivos.append("urgência apontada pela IA")
    nivel = "alta" if pontos >= 3 else ("media" if pontos >= 1 else "baixa")
    return nivel, pontos >= 3, motivos


def analisar(con: sqlite3.Connection, correspondencia_id: int, ia=None) -> int:
    """Gera e grava uma análise. `ia` é objeto com .gerar(prompt)->str, ou None (somente regras)."""
    ctx = contexto(con, correspondencia_id)
    fatos = extrair_fatos(ctx)
    texto = "\n---\n".join("[%s | %s | %s] %s" % (x["data_disponibilizacao"], x["tribunal"], x["tipo"], (x["texto"] or "")[:3500])
                           for x in ctx["comunicacoes"])
    resumo, urg_ia, modelo = None, False, "regras"
    if ia is not None and texto.strip():
        dados = {k: fatos[k]["valor"] for k in ("numero_processo", "tribunal", "classe", "autor", "reu")}
        try:
            bruto = ia.gerar(PROMPT.format(dados=json.dumps(dados, ensure_ascii=False), trechos=texto[:12000]))
            j = json.loads(re.search(r"\{.*\}", bruto, re.S).group(0))
            resumo = j.get("resumo")
            for chave, destino in (("principais_fatos", "principais_fatos"), ("fundamentos_juridicos", "fundamentos_juridicos"),
                                   ("pedidos", "pedidos")):
                if j.get(chave):
                    fatos[destino] = _campo(j[chave], "inferencia", "gerado pela IA a partir de comunicações, não da petição inicial")
            urg_ia = bool(j.get("urgencia_aparente"))
            modelo = getattr(ia, "modelo", "ia")
        except Exception as e:  # análise por regras segue valendo; a falha fica registrada
            fatos["_erro_ia"] = _campo(str(e)[:300], "nao_verificado")
    if resumo is None:
        ult = ctx["comunicacoes"][-1] if ctx["comunicacoes"] else None
        resumo = ("Processo %s (%s), classe %s. Posição do cliente: %s. Análise de conteúdo indisponível: a petição inicial não é "
                  "acessível pelas fontes públicas e não houve resumo por IA." %
                  (ctx["corr"]["numero_processo"], ctx["corr"]["tribunal"], fatos["classe"]["valor"] or "não informada",
                   "polo passivo" if ctx["corr"]["polo"] == "P" else "indeterminada"))
        if ult:
            resumo += " Última comunicação: %s (%s)." % (ult["tipo"], ult["data_disponibilizacao"])
    nivel, imediata, motivos = _classificar(fatos, texto, urg_ia, _config.obter(con, "prioridade"))
    fatos["_motivos_prioridade"] = _campo(motivos, "inferencia")
    docs = {"peticao_inicial": "indisponivel_nas_fontes_publicas", "comunicacoes_djen": len(ctx["comunicacoes"])}
    aid = con.execute("INSERT INTO analises(processo_id,gerada_em,modelo,campos,resumo,prioridade,urgencia_aparente,"
                      "requer_analise_imediata,documentos) VALUES (?,?,?,?,?,?,?,?,?)",
                      (ctx["corr"]["processo_id"], datetime.now().isoformat(timespec="seconds"), modelo,
                       json.dumps(fatos, ensure_ascii=False), resumo, nivel, int(urg_ia or fatos["tutela_provisoria"]["valor"]),
                       int(imediata), json.dumps(docs))).lastrowid
    con.execute("UPDATE correspondencias SET prioridade=? WHERE processo_id=?", (nivel, ctx["corr"]["processo_id"]))
    con.commit()
    return aid
