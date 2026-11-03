"""Cadastro público de CNPJ (BrasilAPI, dados da Receita Federal): razão social oficial. Só o CNPJ (dado público) é enviado."""
from typing import Dict, Optional

from ..http import ErroFonte, FonteHTTP

URL = "https://brasilapi.com.br/api/cnpj/v1/%s"


class ConectorRegistroCNPJ:
    nome = "cnpj_registro"

    def __init__(self, http: FonteHTTP):
        self.http = http

    def consultar(self, cnpj: str) -> Optional[Dict[str, str]]:
        """Devolve {'razao_social','nome_fantasia','situacao'} ou None se o CNPJ não consta (404)."""
        try:
            d = self.http.requisitar("GET", URL % cnpj)
        except ErroFonte as e:
            if getattr(e, "status", None) == 404:
                return None
            raise
        if not isinstance(d, dict) or not d.get("razao_social"):
            return None
        return {"razao_social": d["razao_social"].strip(), "nome_fantasia": (d.get("nome_fantasia") or "").strip(),
                "situacao": d.get("descricao_situacao_cadastral") or ""}
