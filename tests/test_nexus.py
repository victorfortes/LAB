"""Entrega ao NGA Nexus, com transporte HTTP falso.

NÃO é evidência de que o Nexus aceita o lote: isso só o Nexus responde. O que
estes testes provam é o que sai daqui — o filtro de validação humana, o
formato do contrato e a idempotência do registro local.
"""
import json
import os
import tempfile
import unittest

from sentinela import db, nexus
from sentinela.http import ErroFonte, FonteHTTP

NUM = "08105237720268190210"


def resp(obj, status=201):
    return status, {}, json.dumps(obj).encode()


class Transporte:
    """Transporte falso que guarda o que foi enviado."""

    def __init__(self, resposta=None, status=201):
        self.chamadas = []
        self.resposta = resposta if resposta is not None else {
            "criados": 1, "atualizados": 0, "movimentacoesCriadas": 2,
            "repetidos": 0, "recusados": [],
        }
        self.status = status

    def __call__(self, metodo, url, headers, corpo, timeout):
        self.chamadas.append({
            "metodo": metodo, "url": url, "headers": headers,
            "corpo": json.loads(corpo) if corpo else None,
        })
        return resp(self.resposta, self.status)


def fonte(transporte):
    return FonteHTTP("nexus", min_intervalo=0.0, tentativas=1, transporte=transporte,
                     dormir=lambda s: None, status_ok=(200, 201))


class TesteEntregaAoNexus(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.con = db.conectar(os.path.join(self.dir, "t.db"))
        self.con.execute(
            "INSERT INTO clientes(id,razao_social,cnpj_matriz) VALUES (1,'ACME INDUSTRIA LTDA','47960950000121')")
        self.con.execute(
            "INSERT INTO processos(id,numero_processo,tribunal,classe,assuntos,data_ajuizamento,"
            "primeira_identificacao,ultima_verificacao) "
            "VALUES (1,?,'TJRJ','Execução de Título Extrajudicial',"
            "'[{\"nome\":\"Cobrança\"}]','2026-09-30T00:00:00','2026-10-01','2026-10-01')", (NUM,))
        self.con.execute(
            "INSERT INTO comunicacoes(id,fonte,numero_processo,tribunal,tipo,data_disponibilizacao,"
            "texto,link,destinatarios,coletado_em) VALUES "
            "(9001,'djen',?,'TJRJ','Intimação','2026-10-02','Fica intimada a executada.',"
            "'https://exemplo/9001','[]','2026-10-02'),"
            "(9002,'djen',?,'TJRJ','Despacho','2026-10-05','Cite-se.',NULL,'[]','2026-10-05')",
            (NUM, NUM))
        self.con.commit()

    def _correspondencia(self, classificacao="confirmada", validacao="humana"):
        self.con.execute(
            "INSERT INTO correspondencias(cliente_id,processo_id,nivel,classificacao,evidencia,"
            "fonte,estado_validacao,identificada_em,ultima_verificacao) "
            "VALUES (1,1,1,?, '{}','djen',?, '2026-10-02','2026-10-02')",
            (classificacao, validacao))
        self.con.commit()

    # ------------------------------------------------------------ filtro ---

    def test_so_sai_o_que_pessoa_confirmou(self):
        """Palpite de robô não vira caso no sistema do escritório."""
        self._correspondencia(classificacao="confirmada", validacao="automatico")
        self.assertEqual(nexus.pendentes(self.con), [])
        self.assertEqual(len(nexus.pendentes(self.con, incluir_automaticas=True)), 1)

    def test_provavel_fica_de_fora_por_padrao(self):
        self._correspondencia(classificacao="provavel", validacao="humana")
        self.assertEqual(nexus.pendentes(self.con), [])
        self.assertEqual(len(nexus.pendentes(self.con, incluir_provaveis=True)), 1)

    def test_descartada_nunca_sai(self):
        self._correspondencia(classificacao="descartada", validacao="humana")
        self.assertEqual(nexus.pendentes(self.con, True, True), [])

    # ----------------------------------------------------------- formato ---

    def test_o_lote_sai_no_formato_do_contrato(self):
        self._correspondencia()
        item = nexus.pendentes(self.con)[0]
        p = item["processo"]
        self.assertEqual(p["numero"], NUM)
        self.assertEqual(p["tribunal"], "TJRJ")
        self.assertEqual(p["classe"], "Execução de Título Extrajudicial")
        self.assertEqual(p["assunto"], "Cobrança")
        # A data vem do DataJud com hora; o contrato quer só o dia.
        self.assertEqual(p["distribuidoEm"], "2026-09-30")
        self.assertEqual([m["externoId"] for m in p["movimentacoes"]], ["djen-9001", "djen-9002"])
        self.assertEqual(p["movimentacoes"][0]["data"], "2026-10-02")
        self.assertIn("https://exemplo/9001", p["movimentacoes"][0]["conteudo"])

    def test_comunicacao_sem_data_nao_vira_movimentacao(self):
        self.con.execute(
            "INSERT INTO comunicacoes(id,fonte,numero_processo,tipo,data_disponibilizacao,"
            "destinatarios,coletado_em) VALUES (9003,'djen',?,'Sem data',NULL,'[]','2026-10-06')",
            (NUM,))
        self.con.commit()
        self._correspondencia()
        ids = [m["externoId"] for m in nexus.pendentes(self.con)[0]["processo"]["movimentacoes"]]
        self.assertNotIn("djen-9003", ids)

    # ------------------------------------------------------------ envio ---

    def test_envia_com_bearer_e_registra(self):
        self._correspondencia()
        t = Transporte()
        r = nexus.enviar(self.con, "http://nexus.local/", "nga_int_abc", fonte=fonte(t))

        self.assertEqual(r["enviados"], 1)
        self.assertEqual(r["movimentacoes"], 2)
        chamada = t.chamadas[0]
        self.assertEqual(chamada["url"], "http://nexus.local/api/integracao/processos")
        self.assertEqual(chamada["headers"]["Authorization"], "Bearer nga_int_abc")
        self.assertEqual(len(chamada["corpo"]["processos"]), 1)

        linha = self.con.execute("SELECT * FROM entregas_nexus").fetchone()
        self.assertEqual(linha["numero_processo"], NUM)
        self.assertEqual(linha["movimentacoes"], 2)

    def test_segunda_execucao_nao_reenvia(self):
        """Cron roda todo dia; o que já foi entregue não volta para a rede."""
        self._correspondencia()
        t = Transporte()
        nexus.enviar(self.con, "http://nexus.local", "t", fonte=fonte(t))
        r = nexus.enviar(self.con, "http://nexus.local", "t", fonte=fonte(t))
        self.assertEqual(r["pendentes"], 0)
        self.assertEqual(r["enviados"], 0)

    def test_recusado_pelo_nexus_nao_entra_no_registro(self):
        """O que foi recusado tem de ser tentado de novo depois do conserto."""
        self._correspondencia()
        t = Transporte({"criados": 0, "atualizados": 0, "movimentacoesCriadas": 0, "repetidos": 0,
                        "recusados": [{"item": NUM, "motivo": "dígito verificador não confere"}]})
        r = nexus.enviar(self.con, "http://nexus.local", "t", fonte=fonte(t))
        self.assertEqual(r["enviados"], 0)
        self.assertEqual(len(r["recusados"]), 1)
        self.assertEqual(self.con.execute("SELECT count(*) FROM entregas_nexus").fetchone()[0], 0)
        # Continua pendente para a próxima execução.
        self.assertEqual(len(nexus.pendentes(self.con)), 1)

    def test_201_e_sucesso(self):
        """A ingestão do Nexus responde 201; as fontes respondem 200."""
        self._correspondencia()
        t = Transporte(status=201)
        self.assertEqual(nexus.enviar(self.con, "http://n", "t", fonte=fonte(t))["enviados"], 1)

    def test_erro_do_nexus_nao_registra_entrega(self):
        self._correspondencia()
        t = Transporte(status=500)
        with self.assertRaises(ErroFonte):
            nexus.enviar(self.con, "http://n", "t", fonte=fonte(t))
        self.assertEqual(self.con.execute("SELECT count(*) FROM entregas_nexus").fetchone()[0], 0)

    def test_sem_token_falha_antes_de_tocar_a_rede(self):
        self._correspondencia()
        t = Transporte()
        with self.assertRaises(ErroFonte):
            nexus.enviar(self.con, "http://n", "", fonte=fonte(t))
        self.assertEqual(t.chamadas, [])

    def test_simular_nao_toca_rede_nem_registro(self):
        self._correspondencia()
        t = Transporte()
        r = nexus.enviar(self.con, "http://n", "", simular=True, fonte=fonte(t))
        self.assertTrue(r["simulado"])
        self.assertEqual(len(r["resposta"]["processos"]), 1)
        self.assertEqual(t.chamadas, [])
        self.assertEqual(self.con.execute("SELECT count(*) FROM entregas_nexus").fetchone()[0], 0)

    def test_relato_conta_o_que_foi_afrouxado(self):
        self._correspondencia(classificacao="provavel", validacao="automatico")
        t = Transporte()
        r = nexus.enviar(self.con, "http://n", "t", incluir_automaticas=True,
                         incluir_provaveis=True, fonte=fonte(t))
        self.assertEqual(r["automaticas_incluidas"], 1)
        self.assertEqual(r["provaveis_incluidas"], 1)


if __name__ == "__main__":
    unittest.main()
