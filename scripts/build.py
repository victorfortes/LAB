#!/usr/bin/env python3
"""Monta dist/ a partir do Artifact original preservado + a casca (login/admin).

O gerador NÃO é reescrito: pega-se o HTML original byte a byte e aplicam-se poucos
patches rastreáveis (lista em PATCHES). Cada patch tem de casar exatamente uma vez,
senão o build falha: assim uma mudança inesperada no original nunca passa em silêncio.
"""
import hashlib, json, os, re, shutil, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ORIGINAL = RAIZ / "original" / "artifact-HksuUVxXv21ftK5iF5sFG7-v27.html"
DIST = RAIZ / "dist"

def sha(b): return hashlib.sha256(b).hexdigest()

def csp_meta(url_supabase):
    """CSP em <meta>: vale mesmo quando a hospedagem não envia cabeçalhos HTTP. (frame-ancestors só existe em cabeçalho.)"""
    origem = ""
    m = re.match(r"^(https://[^/]+)", url_supabase or "")
    if m: origem = m.group(1) + " " + m.group(1).replace("https://", "wss://")
    conecta = ("'self' " + origem + " https://api.bcb.gov.br https://dadosabertos.bcb.gov.br https://cdnjs.cloudflare.com blob: data:").replace("  ", " ")
    pol = ("default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; "
           "img-src 'self' data: blob:; font-src 'self' data:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'self'; connect-src " + conecta)
    return '<meta http-equiv="Content-Security-Policy" content="' + pol + '">'

def extrair_pagina(txt):
    """O Artifact vem embrulhado numa casca do Claude; a página real começa no 2º doctype."""
    ini = txt.index('<!doctype html>\n<html lang="pt-BR">')
    fim = txt.index("</html>", ini) + len("</html>")
    return txt[ini:fim]

PATCHES = [(p["id"], p["motivo"], p["de"], p["para"]) for p in json.loads((RAIZ / "scripts" / "patches.json").read_text(encoding="utf-8"))]

def aplicar(txt):
    relatorio = []
    for pid, motivo, a, b in PATCHES:
        n = txt.count(a)
        if n != 1:
            sys.exit(f"ERRO: patch {pid} casou {n} vez(es) (esperado 1). O original mudou?")
        txt = txt.replace(a, b, 1)
        relatorio.append({"patch": pid, "motivo": motivo})
    return txt, relatorio

def main():
    original = ORIGINAL.read_bytes()
    sums = (RAIZ / "original" / "SHA256SUMS").read_text().split()[0]
    if sha(original) != sums:
        sys.exit("ERRO: o arquivo original foi alterado (SHA-256 diferente).")
    pagina = extrair_pagina(original.decode("utf-8"))
    pagina, rel = aplicar(pagina)
    url0 = os.environ.get("SUPABASE_URL", "").strip()
    if not url0 and (RAIZ / ".env").exists():
        for ln in (RAIZ / ".env").read_text().splitlines():
            if ln.startswith("SUPABASE_URL="): url0 = ln.split("=", 1)[1].strip()
    meta = csp_meta(url0)
    assert pagina.count("<head>") == 1
    pagina = pagina.replace("<head>", "<head>\n" + meta, 1)
    rel.append({"patch": "P7-csp-meta", "motivo": "Política de segurança de conteúdo também por <meta> (hospedagem sem cabeçalhos HTTP)."})

    if DIST.exists(): shutil.rmtree(DIST)
    (DIST / "app").mkdir(parents=True)
    (DIST / "app" / "gerador.html").write_text(pagina, encoding="utf-8")
    shutil.copytree(RAIZ / "web" / "app" / "fonts", DIST / "app" / "fonts")
    for f in (RAIZ / "web" / "shell").iterdir():
        if f.name == "index.html":
            html = f.read_text(encoding="utf-8")
            html = html.replace("<head>", "<head>\n" + meta, 1)
            (DIST / "index.html").write_text(html, encoding="utf-8")
        else:
            shutil.copy(f, DIST / f.name)
    (DIST / "vendor").mkdir()
    shutil.copy(RAIZ / "node_modules/@supabase/supabase-js/dist/umd/supabase.js", DIST / "vendor" / "supabase.js")

    # configuração pública (a chave "anon" é feita para ficar no navegador; quem protege os dados é o RLS)
    url = os.environ.get("SUPABASE_URL", "").strip()
    chave = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    env = RAIZ / ".env"
    if env.exists() and not (url and chave):
        for ln in env.read_text().splitlines():
            if ln.startswith("SUPABASE_URL="): url = ln.split("=", 1)[1].strip()
            if ln.startswith("SUPABASE_ANON_KEY="): chave = ln.split("=", 1)[1].strip()
    if "service_role" in chave or chave.startswith("sb_secret_"):
        sys.exit("ERRO: SUPABASE_ANON_KEY parece ser a chave SECRETA. Use só a chave pública (anon).")
    (DIST / "config.js").write_text("window.NGA_SHELL_CONFIG = " + json.dumps({"url": url, "key": chave, "inatividadeMin": 30}, separators=(",", ":")) + ";\n")
    shutil.copy(RAIZ / "web" / "_headers", DIST / "_headers")

    (DIST / "BUILD.json").write_text(json.dumps({
        "original_sha256": sha(original), "pagina_gerador_sha256": sha(pagina.encode()), "patches": rel}, indent=1, ensure_ascii=False))
    print(f"OK dist/ pronto · gerador {len(pagina)//1024} KiB · {len(rel)} patches · Supabase {'configurado' if url and chave else 'NÃO configurado (modo de teste)'}")

if __name__ == "__main__":
    main()
