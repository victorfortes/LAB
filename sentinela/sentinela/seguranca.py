"""Senhas (PBKDF2), tokens assinados (HMAC) e permissões. Somente biblioteca padrão."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Optional

PAPEIS = {"admin": 3, "advogado": 2, "leitura": 1}


ITER = 600_000  # PBKDF2-HMAC-SHA256 (scrypt não existe no Python/LibreSSL do macOS)


def hash_senha(senha: str) -> str:
    sal = secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), sal, ITER)
    return "pbkdf2$%d$%s$%s" % (ITER, base64.b64encode(sal).decode(), base64.b64encode(h).decode())


def confere_senha(senha: str, armazenado: str) -> bool:
    try:
        _, it, sal, h = armazenado.split("$")
        novo = hashlib.pbkdf2_hmac("sha256", senha.encode(), base64.b64decode(sal), int(it))
        return hmac.compare_digest(novo, base64.b64decode(h))
    except Exception:
        return False


def segredo(caminho: str = "data/.segredo") -> bytes:
    env = os.environ.get("SENTINELA_SECRET")
    if env:
        return env.encode()
    if not os.path.exists(caminho):
        os.makedirs(os.path.dirname(caminho) or ".", exist_ok=True)
        fd = os.open(caminho, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
    with open(caminho) as f:
        return f.read().strip().encode()


def emitir_token(chave: bytes, uid: int, validade_s: int = 12 * 3600) -> str:
    corpo = base64.urlsafe_b64encode(json.dumps({"uid": uid, "exp": int(time.time()) + validade_s}).encode()).decode()
    return corpo + "." + hmac.new(chave, corpo.encode(), hashlib.sha256).hexdigest()


def validar_token(chave: bytes, token: str) -> Optional[int]:
    try:
        corpo, assin = token.split(".")
        if not hmac.compare_digest(assin, hmac.new(chave, corpo.encode(), hashlib.sha256).hexdigest()):
            return None
        d = json.loads(base64.urlsafe_b64decode(corpo))
        return d["uid"] if d["exp"] > time.time() else None
    except Exception:
        return None


def pode(papel: str, minimo: str) -> bool:
    return PAPEIS.get(papel, 0) >= PAPEIS[minimo]
