"""DataJud (CNJ) API pública: metadados e data de ajuizamento. NÃO traz partes (glossário oficial)."""
from typing import Optional

from ..http import ErroFonte, FonteHTTP

BASE = "https://api-publica.datajud.cnj.jus.br/api_publica_%s/_search"
# Chave pública divulgada pelo CNJ em datajud-wiki.cnj.jus.br/api-publica/acesso; pode mudar a qualquer momento.
CHAVE_PADRAO = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=="


def data_iso(s: str) -> Optional[str]:
    """DataJud: 'yyyyMMddHHmmss' ou ISO. Devolve 'YYYY-MM-DD' ou None."""
    if not s:
        return None
    d = s.strip()
    if len(d) >= 8 and d[:8].isdigit():
        return "%s-%s-%s" % (d[:4], d[4:6], d[6:8])
    if len(d) >= 10 and d[4] == "-":
        return d[:10]
    return None


class ConectorDataJud:
    nome = "datajud"

    def __init__(self, http: FonteHTTP, chave: str = CHAVE_PADRAO):
        self.http, self.chave = http, chave

    URL_CHAVE = "https://datajud-wiki.cnj.jus.br/api-publica/acesso/"

    def _renovar_chave(self) -> bool:
        """O CNJ avisa que a chave pública pode mudar a qualquer momento e a publica na wiki: lê a vigente."""
        import re
        import urllib.request
        try:
            req = urllib.request.Request(self.URL_CHAVE, headers={"User-Agent": "NGA-Sentinela/0.3"})
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode("utf-8", "ignore")
        except OSError:
            return False
        m = re.search(r"APIKey\s+([A-Za-z0-9+/=]{24,})", re.sub(r"<[^>]+>", " ", txt))
        if m and m.group(1) != self.chave:
            self.chave = m.group(1)
            return True
        return False

    def _post(self, alias, corpo):
        try:
            return self.http.requisitar("POST", BASE % alias, {"Authorization": "APIKey " + self.chave}, corpo)
        except ErroFonte as e:
            if e.status in (401, 403) and self._renovar_chave():
                return self.http.requisitar("POST", BASE % alias, {"Authorization": "APIKey " + self.chave}, corpo)
            raise

    @staticmethod
    def _resumir(hits):
        hits = sorted(hits, key=lambda s: (s.get("dataAjuizamento") or "99999999"))
        s = hits[0]
        return {"data_ajuizamento": data_iso(s.get("dataAjuizamento")), "grau": s.get("grau"),
                "classe": (s.get("classe") or {}).get("nome"), "orgao": (s.get("orgaoJulgador") or {}).get("nome"),
                "sistema": (s.get("sistema") or {}).get("nome"),
                "assuntos": [a.get("nome") for a in (s.get("assuntos") or []) if isinstance(a, dict)],
                "graus_encontrados": sorted({h.get("grau") for h in hits if h.get("grau")})}

    def obter_lote(self, numeros, sigla_tribunal: str):
        """Consulta vários números do mesmo tribunal em uma requisição. Devolve {numero: dict|None}."""
        alias = (sigla_tribunal or "").strip().lower()
        if not alias.isalnum():
            raise ErroFonte("sigla de tribunal inválida: %r" % sigla_tribunal)
        numeros = list(numeros)
        d = self._post(alias, {"size": min(10000, len(numeros) * 3), "_source": ["numeroProcesso", "dataAjuizamento", "grau", "classe", "orgaoJulgador", "sistema", "assuntos"],
                               "query": {"terms": {"numeroProcesso": numeros}}})
        por: dict = {n: [] for n in numeros}
        for h in d.get("hits", {}).get("hits", []):
            src = h["_source"]
            if src.get("numeroProcesso") in por:
                por[src["numeroProcesso"]].append(src)
        return {n: (self._resumir(v) if v else None) for n, v in por.items()}

    def obter(self, numero_processo: str, sigla_tribunal: str):
        """Devolve dict com metadados, ou None se o DataJud não tem o processo. Erros de rede levantam ErroFonte."""
        alias = (sigla_tribunal or "").strip().lower()
        if not alias.isalnum():
            raise ErroFonte("sigla de tribunal inválida: %r" % sigla_tribunal)
        d = self._post(alias, {"size": 5, "query": {"match": {"numeroProcesso": numero_processo}}})
        hits = [h["_source"] for h in d.get("hits", {}).get("hits", [])]
        if not hits:
            return None
        # mesmo número pode existir em G1 e G2: a distribuição original é a mais antiga
        hits.sort(key=lambda s: (s.get("dataAjuizamento") or "99999999"))
        s = hits[0]
        return {"data_ajuizamento": data_iso(s.get("dataAjuizamento")), "grau": s.get("grau"),
                "classe": (s.get("classe") or {}).get("nome"), "orgao": (s.get("orgaoJulgador") or {}).get("nome"),
                "sistema": (s.get("sistema") or {}).get("nome"),
                "assuntos": [a.get("nome") for a in (s.get("assuntos") or []) if isinstance(a, dict)],
                "graus_encontrados": sorted({h.get("grau") for h in hits if h.get("grau")})}
