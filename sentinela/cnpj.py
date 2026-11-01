"""Normalização e validação de CNPJ (dígitos verificadores)."""
import re


def somente_digitos(valor: str) -> str:
    return re.sub(r"\D", "", valor or "")


def _dv(base: str) -> str:
    pesos = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    saida = ""
    for _ in range(2):
        p = pesos if len(base) == 12 else [6] + pesos
        soma = sum(int(d) * w for d, w in zip(base, p))
        r = soma % 11
        d = "0" if r < 2 else str(11 - r)
        base += d
        saida += d
    return saida


def valido(valor: str) -> bool:
    d = somente_digitos(valor)
    if len(d) != 14 or d == d[0] * 14:
        return False
    return _dv(d[:12]) == d[12:]


def normalizar(valor: str) -> str:
    """Devolve 14 dígitos ou levanta ValueError."""
    d = somente_digitos(valor)
    if not valido(d):
        raise ValueError("CNPJ inválido: %r" % valor)
    return d


def formatar(valor: str) -> str:
    d = normalizar(valor)
    return "%s.%s.%s/%s-%s" % (d[:2], d[2:5], d[5:8], d[8:12], d[12:])


def mesma_raiz(a: str, b: str) -> bool:
    return normalizar(a)[:8] == normalizar(b)[:8]
