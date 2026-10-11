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

def extrair_pagina(txt):
    """O Artifact vem embrulhado numa casca do Claude; a página real começa no 2º doctype."""
    ini = txt.index('<!doctype html>\n<html lang="pt-BR">')
    fim = txt.index("</html>", ini) + len("</html>")
    return txt[ini:fim]

PATCHES = [
  # (id, motivo, trecho original, substituto)
  ("P1-fontes-locais", "Fontes hospedadas no próprio site (sem chamar o Google a cada acesso). Mesmas famílias e pesos.",
   '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
   '<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">',
   '<link rel="stylesheet" href="fonts/fonts.css">'),
  ("P2-sem-conta-padrao", "SEGURANÇA: remove a conta de administrador padrão (admin@nga.adv.br) com senha fixa no código.",
   '''    if (!lista.some(function (u) { return String(u.email).toLowerCase() === "admin@nga.adv.br"; })) {
      lista.unshift({ email: "admin@nga.adv.br", hash: await sha256("nga2026"), role: "admin", criadoEm: new Date().toLocaleDateString("pt-BR") });
      salvarUsuarios(lista);
    }
''', '    // (conta padrão removida na migração: o acesso agora é por usuário individual no Supabase)\n'),
  ("P3-config-da-casca", "O módulo 'nuvem' do original lê a configuração do Supabase da página que o hospeda (a casca).",
   'var cfg = window.NGA_NUVEM_CFG || null;',
   'var cfg = window.NGA_NUVEM_CFG || (function () { try { return window.parent !== window ? window.parent.NGA_SHELL_CFG : null; } catch (e) { return null; } })();'),
  ("P4-sair-pela-casca", "Sair encerra a sessão do Supabase na casca (o original só recarregava a página).",
   '    logout: function() {\n',
   '    logout: function() {\n      if (window.parent !== window) { window.parent.postMessage({ nga: "logout" }, location.origin); return; }\n'),
  ("P5-usuarios-pela-casca", "O botão Usuários abre a administração real (Supabase) na casca, não a lista local do navegador.",
   'ligar("topbar-btn-gerenciar", "click", function () { window.NGA_AUTH.abrirGerenciador(); });',
   'ligar("topbar-btn-gerenciar", "click", function () { if (window.parent !== window) window.parent.postMessage({ nga: "admin" }, location.origin); else window.NGA_AUTH.abrirGerenciador(); });'),
  ("P6-so-dentro-da-casca", "SEGURANÇA: o gerador só funciona dentro da casca autenticada; aberto direto, volta para a entrada.",
   '<title>Relatórios Jurídicos, NGA</title>',
   '<title>Relatórios Jurídicos, NGA</title>\n<script>if (window.parent === window) { location.replace("../"); }</script>'),
]

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

    if DIST.exists(): shutil.rmtree(DIST)
    (DIST / "app").mkdir(parents=True)
    (DIST / "app" / "gerador.html").write_text(pagina, encoding="utf-8")
    shutil.copytree(RAIZ / "web" / "app" / "fonts", DIST / "app" / "fonts")
    for f in (RAIZ / "web" / "shell").iterdir():
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
    (DIST / "config.js").write_text("window.NGA_SHELL_CONFIG = " + json.dumps({"url": url, "key": chave, "inatividadeMin": 30}) + ";\n")
    shutil.copy(RAIZ / "web" / "_headers", DIST / "_headers")

    (DIST / "BUILD.json").write_text(json.dumps({
        "original_sha256": sha(original), "pagina_gerador_sha256": sha(pagina.encode()), "patches": rel}, indent=1, ensure_ascii=False))
    print(f"OK dist/ pronto · gerador {len(pagina)//1024} KiB · {len(rel)} patches · Supabase {'configurado' if url and chave else 'NÃO configurado (modo de teste)'}")

if __name__ == "__main__":
    main()
