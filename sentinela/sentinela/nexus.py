"""Entrega ao NGA Nexus o que o Sentinela encontrou.

O Sentinela segue sendo aplicação própria. O que atravessa para a plataforma
do escritório é ARTEFATO — processo e movimentação —, não código: nada aqui
sabe como o Nexus guarda nada, e nada lá sabe como este monitoramento é feito.

O QUE SAI DAQUI, E O QUE NÃO SAI

Por padrão, só correspondência CONFIRMADA POR PESSOA. A cobertura automática
deste monitoramento nunca foi validada tribunal a tribunal (ver os próprios
documentos do projeto), e empurrar palpite de robô para dentro do sistema de
casos do escritório transformaria incerteza de fonte em fato no processo do
cliente. Quem quiser enviar o que ainda está só automático precisa pedir, com
--incluir-automaticas, e o relato diz quantas foram.

A ENTREGA É IDEMPOTENTE DOS DOIS LADOS. O Nexus deduplica por `externoId` de
cada movimentação; aqui fica o registro local do que já foi entregue, para o
comando não refazer tráfego a cada execução. Os dois juntos significam que
rodar de novo — por reinício, por retentativa, por cron duplicado — não
duplica nada em lugar nenhum.
"""
import json
import sqlite3
from datetime import datetime, timezone
from typing import Dict, List, Optional

from .http import ErroFonte, FonteHTTP

ROTA_PROCESSOS = "/api/integracao/processos"

#: Classificações que o Nexus aceita receber, da mais firme para a menos.
CONFIRMADA = "confirmada"
PROVAVEL = "provavel"

#: O Nexus limita o lote; manter abaixo evita rejeição por tamanho.
LIMITE_DE_PROCESSOS = 50
LIMITE_DE_MOVIMENTACOES = 200


def _data(valor: Optional[str]) -> Optional[str]:
    """Normaliza para AAAA-MM-DD, que é o que o contrato aceita."""
    if not valor:
        return None
    texto = str(valor)[:10]
    try:
        datetime.strptime(texto, "%Y-%m-%d")
    except ValueError:
        return None
    return texto


def _assunto(bruto: Optional[str]) -> Optional[str]:
    """`processos.assuntos` guarda JSON; o contrato quer uma linha de texto."""
    if not bruto:
        return None
    try:
        dados = json.loads(bruto)
    except (ValueError, TypeError):
        return str(bruto)[:300] or None
    if isinstance(dados, list):
        nomes = [str(x.get("nome") if isinstance(x, dict) else x) for x in dados if x]
        return ", ".join(nomes)[:300] or None
    if isinstance(dados, dict):
        return str(dados.get("nome") or "")[:300] or None
    return str(dados)[:300] or None


def _movimentacoes(con: sqlite3.Connection, numero: str) -> List[Dict]:
    """As publicações do DJEN viram movimentação, com o id da fonte como chave.

    `comunicacoes.id` é o identificador da própria fonte, não um sequencial
    local: é por isso que ele serve de `externoId` e sobrevive a reprocessamento.
    """
    linhas = con.execute(
        "SELECT id, tipo, texto, data_disponibilizacao, classe, orgao, link "
        "FROM comunicacoes WHERE numero_processo=? ORDER BY data_disponibilizacao, id "
        "LIMIT ?", (numero, LIMITE_DE_MOVIMENTACOES)).fetchall()

    saida = []
    for c in linhas:
        data = _data(c["data_disponibilizacao"])
        if not data:
            continue  # sem data não há movimentação: o contrato exige AAAA-MM-DD
        corpo = (c["texto"] or "").strip()
        if c["link"]:
            corpo = (corpo + "\n\n" + c["link"]).strip()
        saida.append({
            "data": data,
            "titulo": (c["tipo"] or "Comunicação")[:300],
            "conteudo": corpo[:20000] or None,
            "externoId": "djen-%s" % c["id"],
        })
    return [{k: v for k, v in m.items() if v is not None} for m in saida]


def pendentes(con: sqlite3.Connection, incluir_automaticas: bool = False,
              incluir_provaveis: bool = False, limite: int = LIMITE_DE_PROCESSOS) -> List[Dict]:
    """Correspondências ainda não entregues, no formato do contrato.

    O filtro padrão é duplo: classificação `confirmada` E validação humana
    registrada. Afrouxar qualquer um dos dois é escolha explícita de quem
    chama, e o relato final diz o que foi afrouxado.
    """
    classificacoes = [CONFIRMADA] + ([PROVAVEL] if incluir_provaveis else [])
    condicao_validacao = "" if incluir_automaticas else " AND c.estado_validacao <> 'automatico'"

    linhas = con.execute(
        "SELECT c.id AS correspondencia_id, c.classificacao, c.estado_validacao, c.polo, "
        "       p.numero_processo, p.tribunal, p.classe, p.assuntos, p.data_ajuizamento, "
        "       cl.razao_social "
        "  FROM correspondencias c "
        "  JOIN processos p ON p.id = c.processo_id "
        "  JOIN clientes cl ON cl.id = c.cliente_id "
        "  LEFT JOIN entregas_nexus e ON e.correspondencia_id = c.id "
        " WHERE e.correspondencia_id IS NULL "
        "   AND c.classificacao IN (%s)%s "
        " ORDER BY c.identificada_em "
        " LIMIT ?" % (",".join("?" * len(classificacoes)), condicao_validacao),
        (*classificacoes, limite)).fetchall()

    lote = []
    for l in linhas:
        processo = {
            "numero": l["numero_processo"],
            "classe": l["classe"] or None,
            "assunto": _assunto(l["assuntos"]),
            "tribunal": l["tribunal"] or None,
            "distribuidoEm": _data(l["data_ajuizamento"]),
            "movimentacoes": _movimentacoes(con, l["numero_processo"]),
        }
        lote.append({
            "correspondencia_id": l["correspondencia_id"],
            "cliente": l["razao_social"],
            "classificacao": l["classificacao"],
            "validacao": l["estado_validacao"],
            "processo": {k: v for k, v in processo.items() if v is not None},
        })
    return lote


def registrar_entrega(con: sqlite3.Connection, correspondencia_id: int, numero: str,
                      movimentacoes: int, resposta: Dict) -> None:
    con.execute(
        "INSERT INTO entregas_nexus(correspondencia_id, numero_processo, enviada_em, "
        "movimentacoes, resposta) VALUES (?,?,?,?,?) "
        "ON CONFLICT(correspondencia_id) DO UPDATE SET enviada_em=excluded.enviada_em, "
        "movimentacoes=excluded.movimentacoes, resposta=excluded.resposta",
        (correspondencia_id, numero, datetime.now(timezone.utc).isoformat(timespec="seconds"),
         movimentacoes, json.dumps(resposta, ensure_ascii=False)))
    con.commit()


def enviar(con: sqlite3.Connection, base_url: str, token: str,
           incluir_automaticas: bool = False, incluir_provaveis: bool = False,
           limite: int = LIMITE_DE_PROCESSOS, simular: bool = False,
           fonte: Optional[FonteHTTP] = None) -> Dict:
    """Monta o lote, entrega e registra. Devolve o relato do que aconteceu."""
    lote = pendentes(con, incluir_automaticas, incluir_provaveis, limite)
    relato = {
        "pendentes": len(lote),
        "enviados": 0,
        "movimentacoes": 0,
        "automaticas_incluidas": sum(1 for x in lote if x["validacao"] == "automatico"),
        "provaveis_incluidas": sum(1 for x in lote if x["classificacao"] == PROVAVEL),
        "simulado": simular,
    }
    if not lote:
        relato["resposta"] = None
        return relato

    corpo = {"processos": [x["processo"] for x in lote]}
    if simular:
        # Não toca na rede nem no registro local: serve para conferir o que
        # sairia antes de mandar processo para dentro do sistema de casos.
        relato["resposta"] = corpo
        return relato

    if not token:
        raise ErroFonte("credencial do Nexus ausente: defina NEXUS_TOKEN")

    http = fonte or FonteHTTP("nexus", min_intervalo=0.0, tentativas=3, status_ok=(200, 201))
    resposta = http.requisitar(
        "POST", base_url.rstrip("/") + ROTA_PROCESSOS,
        headers={"Authorization": "Bearer %s" % token}, json_corpo=corpo)

    # O Nexus devolve o que recusou e por quê; quem foi recusado NÃO entra no
    # registro local, para que a próxima execução tente de novo depois do
    # conserto.
    recusados = {r.get("item") for r in (resposta.get("recusados") or [])}
    for item in lote:
        numero = item["processo"]["numero"]
        if numero in recusados:
            continue
        registrar_entrega(con, item["correspondencia_id"], numero,
                          len(item["processo"].get("movimentacoes", [])), resposta)
        relato["enviados"] += 1
        relato["movimentacoes"] += len(item["processo"].get("movimentacoes", []))

    relato["resposta"] = resposta
    relato["recusados"] = resposta.get("recusados") or []
    return relato
