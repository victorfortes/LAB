"""Cliente HTTP resiliente: limite de taxa por fonte, retentativas com espera progressiva e relato de saúde."""
import json
import threading
import time
import urllib.error
import urllib.request
from typing import Callable, Dict, Optional, Tuple


class ErroFonte(Exception):
    def __init__(self, mensagem: str, status: int = 0):
        super().__init__(mensagem)
        self.status = status


def transporte_urllib(metodo, url, headers, corpo, timeout) -> Tuple[int, Dict[str, str], bytes]:
    req = urllib.request.Request(url, data=corpo, headers=headers, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


class FonteHTTP:
    def __init__(self, nome: str, min_intervalo: float = 1.0, tentativas: int = 4, espera_base: float = 2.0,
                 timeout: float = 60.0, transporte: Callable = transporte_urllib, dormir: Callable = time.sleep,
                 ao_resultado: Optional[Callable[[str, bool, str], None]] = None,
                 status_ok: Tuple[int, ...] = (200,)):
        self.nome, self.min_intervalo, self.tentativas = nome, min_intervalo, tentativas
        self.espera_base, self.timeout = espera_base, timeout
        self.status_ok = status_ok  # as fontes respondem 200; o Nexus responde 201 na ingestão
        self._transporte, self._dormir, self._cb = transporte, dormir, ao_resultado
        self._lock = threading.Lock()
        self._ultimo = 0.0

    def _esperar_vez(self):
        with self._lock:
            falta = self._ultimo + self.min_intervalo - time.monotonic()
            if falta > 0:
                self._dormir(falta)
            self._ultimo = time.monotonic()

    def requisitar(self, metodo: str, url: str, headers: Optional[Dict[str, str]] = None, json_corpo=None):
        h = {"User-Agent": "NGA-Sentinela/0.2", "Accept": "application/json", **(headers or {})}
        corpo = None
        if json_corpo is not None:
            corpo = json.dumps(json_corpo).encode()
            h["Content-Type"] = "application/json"
        ultimo_erro, status = "", 0
        for t in range(self.tentativas):
            self._esperar_vez()
            try:
                status, hdr, raw = self._transporte(metodo, url, h, corpo, self.timeout)
                if status in self.status_ok:
                    dados = json.loads(raw)
                    restante = hdr.get("x-ratelimit-remaining")
                    if restante is not None and restante.isdigit() and int(restante) <= 2:
                        self._dormir(15)  # perto do teto de requisições da fonte
                    self._relatar(True, "")
                    return dados
                ultimo_erro = "HTTP %d" % status
                if status not in (429, 500, 502, 503, 504):
                    break  # erro definitivo: não adianta repetir
            except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
                ultimo_erro = "%s: %s" % (type(e).__name__, e)
            if t < self.tentativas - 1:
                self._dormir(self.espera_base * (2 ** t))
        self._relatar(False, ultimo_erro)
        raise ErroFonte("%s: %s" % (self.nome, ultimo_erro), status)

    def _relatar(self, ok, erro):
        if self._cb:
            self._cb(self.nome, ok, erro)
