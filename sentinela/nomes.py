"""Normalização e comparação de nomes de partes."""
import re
import unicodedata
from difflib import SequenceMatcher

_SUFIXOS = {"LTDA", "SA", "SIA", "EIRELI", "ME", "EPP", "SLU", "LTD", "CIA", "COMPANHIA"}
_RUIDO = [r"\bEM RECUPERACAO JUDICIAL\b", r"\bEM RECUPERACAO EXTRAJUDICIAL\b", r"\bEM FALENCIA\b",
          r"\bMASSA FALIDA( DE)?\b", r"\bEM LIQUIDACAO( JUDICIAL| EXTRAJUDICIAL)?\b"]


def normalizar(nome: str) -> str:
    s = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode().upper()
    s = s.replace("&", " E ")
    s = re.sub(r"\bS\s*[/.]\s*A\b\.?", " SA ", s)
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    for r in _RUIDO:
        s = re.sub(r, " ", s)
    toks = [t for t in s.split() if t]
    while toks and toks[-1] in _SUFIXOS:
        toks.pop()
    return " ".join(toks)


def similaridade(a: str, b: str) -> float:
    na, nb = normalizar(a), normalizar(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()
