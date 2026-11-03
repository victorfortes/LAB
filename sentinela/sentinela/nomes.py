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


_RUIDO_INICIAIS = re.compile(r"\b(EM RECUPERACAO JUDICIAL|EM FALENCIA|EM LIQUIDACAO|RECUPERACAO JUDICIAL)\b")
_LIGACAO = {"DE", "DA", "DO", "DAS", "DOS", "E"}


def iniciais(nome: str) -> str:
    """Forma abreviada que alguns tribunais (ex.: TJSP) publicam no DJEN: 'TRANSPORTADORA TRANS MOSA LTDA' -> 'T. T. M. L.'.
    Devolve '' se tiver menos de 4 iniciais (abreviação curta demais para ser pesquisável)."""
    s = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode().upper()
    s = re.sub(r"\bS\s*[/.]\s*A\b\.?", " S A ", s)
    s = _RUIDO_INICIAIS.sub(" ", re.sub(r"[^A-Z0-9 ]", " ", s))
    letras = []
    for t in s.split():
        if t in _LIGACAO:
            continue
        letras.extend(["S", "A"] if t == "SA" else [t[0]])
    return " ".join(l + "." for l in letras) if len(letras) >= 4 else ""


def e_abreviacao(nome: str) -> bool:
    toks = re.findall(r"[A-Z0-9]+", (nome or "").upper())
    return len(toks) >= 4 and all(len(t) == 1 for t in toks)


def normalizar_iniciais(nome: str) -> str:
    return "".join(re.findall(r"[A-Z]", (nome or "").upper()))
