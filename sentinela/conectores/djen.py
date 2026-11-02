"""DJEN / Comunica PJe (CNJ): comunicações com partes e polo. API pública sem autenticação.
Parâmetros validados em 30/10/2026: nomeParte (nome; NÃO aceita CNPJ) e texto (busca textual, aceita CNPJ formatado)."""
from urllib.parse import urlencode

from ..http import FonteHTTP

URL = "https://comunicaapi.pje.jus.br/api/v1/comunicacao"
POR_PAGINA = 100
TETO_FONTE = 10000  # a API limita count a 10.000: acima disso a consulta é incompleta


class ConectorDJEN:
    nome = "djen"

    def __init__(self, http: FonteHTTP):
        self.http = http

    def consultar(self, parametro: str, valor: str, ini: str, fim: str):
        """parametro: 'nomeParte' ou 'texto'. Datas ISO. Devolve (itens, total_informado, truncado)."""
        itens, pagina, total = [], 1, None
        while pagina <= TETO_FONTE // POR_PAGINA:
            par = {parametro: valor, "itensPorPagina": POR_PAGINA, "pagina": pagina}
            if ini and fim:   # sem datas = histórico inteiro do processo (usado em consulta por numeroProcesso)
                par.update(dataDisponibilizacaoInicio=ini, dataDisponibilizacaoFim=fim)
            qs = urlencode(par)
            d = self.http.requisitar("GET", "%s?%s" % (URL, qs))
            if not isinstance(d, dict) or d.get("status") != "success":
                raise ValueError("resposta inesperada do DJEN")
            total = d.get("count", 0)
            lote = d.get("items") or []
            itens.extend(lote)
            if not lote or len(itens) >= total:
                break
            pagina += 1
        truncado = total is not None and (total >= TETO_FONTE or len(itens) < total)
        return itens, total, truncado
