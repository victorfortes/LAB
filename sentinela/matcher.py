"""Identificação hierárquica do cliente nas partes de uma comunicação.
Níveis: 1 CNPJ matriz | 2 CNPJ filial | 3 razão social/fantasia normalizada | 4 denominação anterior/alternativa |
5 nome aproximado. O DJEN não informa o documento da parte: a evidência de CNPJ vem do texto da comunicação."""
import re
from typing import Dict, List, Optional

from . import cnpj as _cnpj
from . import nomes as _nomes

LIMIAR_APROX = 0.88
_RE_CNPJ = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")


def cnpjs_no_texto(texto: str) -> set:
    achados = set()
    for m in _RE_CNPJ.findall(texto or ""):
        d = _cnpj.somente_digitos(m)
        if _cnpj.valido(d):
            achados.add(d)
    return achados


_PASSIVO = {"reu", "re", "reus", "requerido", "requerida", "requeridos", "executado", "executada", "executados", "reclamado",
            "reclamada", "demandado", "demandada", "impetrado", "impetrada", "promovido", "promovida"}
_ATIVO = {"autor", "autora", "autores", "requerente", "requerentes", "exequente", "exequentes", "reclamante", "impetrante",
          "demandante", "promovente"}
_NAO_PAPEL = {"cnpj", "cpf", "rg", "mail", "email", "cep", "ssp", "oab", "endereco", "telefone"}
_RE_ROTULO = re.compile(r"([A-Za-zÀ-ÿ]+)(?:\(a\))?(?:\(s\))?\s*:")


def _sem_acento(t: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn").lower()


def papel_do_cnpj_no_texto(texto: str, cnpj_digitos: str) -> Optional[str]:
    """Papel declarado no próprio texto da comunicação para a parte que traz este CNPJ ('Réu(s): NOME (CPF/CNPJ: ...)').
    Só devolve P/A para rótulos de polo originário; papéis recursais (embargante, agravante...) e terceiros ficam indefinidos."""
    for m in _RE_CNPJ.finditer(texto or ""):
        if _cnpj.somente_digitos(m.group(0)) != cnpj_digitos:
            continue
        antes = texto[max(0, m.start() - 260):m.start()]
        rot = [x for x in (_sem_acento(r.group(1)) for r in _RE_ROTULO.finditer(antes)) if x not in _NAO_PAPEL]
        if rot:
            if rot[-1] in _PASSIVO:
                return "P"
            if rot[-1] in _ATIVO:
                return "A"
    return None


def _melhor_nome(parte: str, nomes: List[Dict[str, str]]):
    """(tipo_nome, similaridade, nome_cliente) do nome do cliente mais parecido com a parte."""
    np_ = _nomes.normalizar(parte)
    melhor = (None, 0.0, None)
    for n in nomes:
        s = 1.0 if np_ and np_ == n["nome_norm"] else _nomes.similaridade(parte, n["nome"])
        if s > melhor[1]:
            melhor = (n["tipo"], s, n["nome"])
    return melhor


def avaliar(cliente: Dict, comunicacao: Dict) -> Optional[Dict]:
    """Devolve None (sem relação) ou dict com nivel, classificacao, polo, nome_na_fonte, evidencia."""
    partes = comunicacao.get("destinatarios") or []
    cnpjs_cli = {c["cnpj"]: c["tipo"] for c in cliente["cnpjs"]}
    no_texto = cnpjs_no_texto(comunicacao.get("texto", "")) & set(cnpjs_cli)
    cnpj_hit = sorted(no_texto, key=lambda c: cnpjs_cli[c] != "matriz")[0] if no_texto else None
    nivel_cnpj = (1 if cnpjs_cli[cnpj_hit] == "matriz" else 2) if cnpj_hit else None

    cand = []  # (parte, tipo_nome, sim)
    for p in partes:
        tipo, sim, nome_cli = _melhor_nome(p.get("nome", ""), cliente["nomes"])
        if sim >= LIMIAR_APROX:
            cand.append((p, tipo, sim, nome_cli))
    passivo = [c for c in cand if c[0].get("polo") == "P"]
    ativo = [c for c in cand if c[0].get("polo") == "A"]

    def ev(parte, tipo, sim, nome_cli, extra):
        return {"nome_na_fonte": parte.get("nome"), "polo": parte.get("polo"), "nome_cliente": nome_cli,
                "tipo_nome": tipo, "similaridade": round(sim, 3), "cnpj_no_texto": cnpj_hit, **extra}

    if passivo:
        p, tipo, sim, nome_cli = max(passivo, key=lambda c: c[2])
        if cnpj_hit:
            return {"nivel": nivel_cnpj, "classificacao": "confirmada", "polo": "P", "nome_na_fonte": p["nome"],
                    "evidencia": ev(p, tipo, sim, nome_cli, {"regra": "CNPJ no texto + parte no polo passivo com nome compatível"})}
        if sim == 1.0 and tipo in ("razao_social", "fantasia"):
            conf = bool(cliente.get("confirmar_por_nome_exato"))  # decisão explícita do escritório para nomes distintivos
            return {"nivel": 3, "classificacao": "confirmada" if conf else "provavel", "polo": "P", "nome_na_fonte": p["nome"],
                    "evidencia": ev(p, tipo, sim, nome_cli, {"regra": ("nome idêntico no polo passivo; confirmação por nome habilitada para este cliente" if conf else "nome idêntico no polo passivo, sem CNPJ na fonte")})}
        if sim == 1.0:
            return {"nivel": 4, "classificacao": "provavel", "polo": "P", "nome_na_fonte": p["nome"],
                    "evidencia": ev(p, tipo, sim, nome_cli, {"regra": "denominação anterior/alternativa idêntica no polo passivo"})}
        return {"nivel": 5, "classificacao": "inconclusiva", "polo": "P", "nome_na_fonte": p["nome"],
                "evidencia": ev(p, tipo, sim, nome_cli, {"regra": "nome aproximado no polo passivo: requer conferência"})}
    papel = papel_do_cnpj_no_texto(comunicacao.get("texto", ""), cnpj_hit) if cnpj_hit else None
    if papel == "P" and not ativo:
        return {"nivel": nivel_cnpj, "classificacao": "confirmada", "polo": "P", "nome_na_fonte": None,
                "evidencia": {"cnpj_no_texto": cnpj_hit, "regra": "CNPJ do cliente consta no texto como parte no polo passivo (rótulo Réu/Requerido/Executado…)"}}
    if papel == "A" and not passivo:
        return {"nivel": nivel_cnpj, "classificacao": "descartada", "polo": "A", "nome_na_fonte": None,
                "evidencia": {"cnpj_no_texto": cnpj_hit, "regra": "CNPJ do cliente consta no texto como autor/polo ativo"}}
    if ativo:
        p, tipo, sim, nome_cli = max(ativo, key=lambda c: c[2])
        return {"nivel": 5, "classificacao": "descartada", "polo": "A", "nome_na_fonte": p["nome"],
                "evidencia": ev(p, tipo, sim, nome_cli, {"regra": "cliente aparece como autor/polo ativo"})}
    if cnpj_hit:
        return {"nivel": nivel_cnpj, "classificacao": "inconclusiva", "polo": None, "nome_na_fonte": None,
                "evidencia": {"cnpj_no_texto": cnpj_hit, "regra": "CNPJ citado no texto, mas cliente não consta entre as partes: posição desconhecida"}}
    return None
