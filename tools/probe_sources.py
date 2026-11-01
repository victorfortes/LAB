"""Sonda reproduzível das fontes públicas (Fase 1). Só leitura; usa apenas stdlib.
Uso: python3 tools/probe_sources.py > docs/evidencias/probe_ultimo.json
Não grava nomes de partes: guarda apenas contagens, status HTTP e campos presentes."""
import json, sys, time, urllib.request, urllib.error
DJ = "https://api-publica.datajud.cnj.jus.br/api_publica_{}/_search"
DJEN = "https://comunicaapi.pje.jus.br/api/v1/comunicacao"
# Chave pública publicada pelo CNJ em https://datajud-wiki.cnj.jus.br/api-publica/acesso (pode mudar)
KEY = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=="

def req(url, body=None, headers=None):
    h = {"User-Agent": "NGA-Sentinela/0.1 (sonda)", **(headers or {})}
    data = None
    if body is not None:
        data = json.dumps(body).encode(); h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, headers=h)
    t = time.time()
    try:
        with urllib.request.urlopen(r, timeout=40) as f:
            return f.status, json.loads(f.read()), round(time.time() - t, 2)
    except urllib.error.HTTPError as e:
        return e.code, None, round(time.time() - t, 2)
    except Exception as e:
        return 0, str(e), round(time.time() - t, 2)

out = {"executado_em": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "datajud": {}, "djen": {}}
for t in ["tjsp", "tjmg", "tjrj", "trf1", "trf3", "trt2", "trt15"]:
    s, d, dt = req(DJ.format(t), {"size": 1, "sort": [{"dataAjuizamento": {"order": "desc"}}]},
                   {"Authorization": "APIKey " + KEY})
    ok = s == 200 and d and d["hits"]["hits"]
    src = d["hits"]["hits"][0]["_source"] if ok else {}
    out["datajud"][t] = {"http": s, "seg": dt, "campos": sorted(src), "tem_campo_partes": any("part" in k.lower() or "polo" in k.lower() for k in src)}
for q in [{"nomeParte": "MAGAZINE LUIZA"}, {"nomeParte": "47960950000121"}, {"texto": "47.960.950/0001-21"}]:
    qs = "&".join(f"{k}={urllib.request.quote(v)}" for k, v in q.items())
    s, d, dt = req(f"{DJEN}?{qs}&dataDisponibilizacaoInicio=2026-10-27&dataDisponibilizacaoFim=2026-10-29&itensPorPagina=5&pagina=1")
    it = (d or {}).get("items", []) if isinstance(d, dict) else []
    out["djen"][json.dumps(q)] = {"http": s, "seg": dt, "count": (d or {}).get("count") if isinstance(d, dict) else None,
        "campos_item": sorted(it[0]) if it else [], "polos_vistos": sorted({x.get("polo") for i in it for x in i.get("destinatarios", [])})}
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
