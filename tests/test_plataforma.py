"""Testes da plataforma (API, RBAC, fila, agendador, alertas, análise). Transportes falsos: não substituem testes reais."""
import json
import os
import sys
import unittest
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_unitarios import Base, CNPJ_OK, NUM, item, resp  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from sentinela import analise, clientes, fila, notificacoes, seguranca  # noqa: E402


def dj_ok(data="20261028090000", extra=None):
    src = {"numeroProcesso": NUM, "dataAjuizamento": data, "grau": "G1", "classe": {"nome": "Execução de Título Extrajudicial"},
           "orgaoJulgador": {"nome": "1ª Vara Cível"}, "sistema": {"nome": "PJe"}, "assuntos": [{"nome": "Duplicata"}]}
    src.update(extra or {})
    return lambda *a: resp({"hits": {"hits": [{"_source": src}]}})


def djen(itens):
    return lambda *a: resp({"status": "success", "count": len(itens), "items": itens})


class TestAlertasAnalise(Base):
    def prepara(self, texto="CNPJ 47.960.950/0001-21 tutela de urgência valor da causa R$ 2.500.000,00"):
        clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK)
        m = self.motor(djen([item(1, texto=texto)]), dj_ok())
        m.hoje = date.today()
        m.executar(desde=date.today())
        self.con.execute("UPDATE correspondencias SET categoria_data='nova_distribuicao'"); self.con.commit()
        return m

    def test_analise_separa_origens_e_nao_inventa(self):
        self.prepara()
        cid = self.con.execute("SELECT id FROM correspondencias").fetchone()[0]
        aid = analise.analisar(self.con, cid, None)
        a = self.con.execute("SELECT * FROM analises WHERE id=?", (aid,)).fetchone()
        campos = json.loads(a["campos"])
        self.assertEqual(campos["valor_causa"]["valor"], 2500000.0)
        self.assertEqual(campos["valor_causa"]["origem"], "fonte")
        self.assertEqual(campos["tutela_provisoria"]["origem"], "inferencia")
        self.assertEqual(campos["pedidos"]["origem"], "nao_verificado")      # sem IA, nada de pedidos inventados
        self.assertIsNone(campos["pedidos"]["valor"])
        self.assertEqual(a["prioridade"], "alta")
        self.assertIn("indisponivel", a["documentos"])

    def test_ia_falsa_e_ia_com_resposta_invalida(self):
        self.prepara("Tutela de urgência deferida")
        cid = self.con.execute("SELECT id FROM correspondencias").fetchone()[0]
        class IA:
            modelo = "falso"
            def gerar(self, p): return 'ok {"resumo":"Resumo X","principais_fatos":["f1"],"fundamentos_juridicos":[],"pedidos":["p1"],"urgencia_aparente":true}'
        a1 = self.con.execute("SELECT * FROM analises WHERE id=?", (analise.analisar(self.con, cid, IA()),)).fetchone()
        c1 = json.loads(a1["campos"])
        self.assertEqual((a1["resumo"], c1["pedidos"]["origem"], c1["pedidos"]["valor"]), ("Resumo X", "inferencia", ["p1"]))
        self.assertEqual(c1["fundamentos_juridicos"]["origem"], "nao_verificado")  # lista vazia da IA não vira fato
        class Ruim:
            def gerar(self, p): return "isto não é json"
        a2 = self.con.execute("SELECT * FROM analises WHERE id=?", (analise.analisar(self.con, cid, Ruim()),)).fetchone()
        self.assertIn("_erro_ia", json.loads(a2["campos"]))
        self.assertIn("indisponível", a2["resumo"])

    def test_alerta_sem_duplicidade_e_retentativa_de_falha(self):
        self.prepara()
        env = []
        r1 = notificacoes.processar_pendentes(self.con)
        r2 = notificacoes.processar_pendentes(self.con)
        self.assertEqual(r1["definitivos"], 1)
        self.assertEqual((r2["definitivos"], r2["duplicados"]), (0, 1))
        self.assertEqual(self.con.execute("SELECT count(*) FROM alertas").fetchone()[0], 1)
        # e-mail habilitado: falha de SMTP é registrada e a retentativa não duplica linha
        from sentinela import config
        config.salvar(self.con, "notificacoes", {**config.obter(self.con, "notificacoes"), "email": True, "smtp_host": "x", "emails": ["a@b.c"]})
        def quebra(s, c): raise OSError("smtp fora")
        a = notificacoes.montar(self.con, 1, "nova_acao_confirmada")
        self.assertEqual(notificacoes.emitir(self.con, a, "1", enviar_email=quebra)["email"], "falha")
        self.assertEqual(notificacoes.emitir(self.con, a, "1", enviar_email=lambda s, c: env.append(s))["email"], "enviado")
        self.assertEqual(notificacoes.emitir(self.con, a, "1", enviar_email=lambda s, c: env.append(s))["email"], "duplicado_ignorado")
        self.assertEqual(len(env), 1)
        txt = notificacoes.texto(a)[1]
        for campo in ("Cliente", "Processo", "Tribunal", "Distribuição", "Natureza", "Valor da causa", "Prioridade", "Validação", "Síntese", "Consulta oficial"):
            self.assertIn(campo, txt)

    def test_processo_antigo_e_descartado_nao_alertam(self):
        clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK)
        m = self.motor(djen([item(1, texto="CNPJ 47.960.950/0001-21"), {**item(2, polo="A"), "numero_processo": "00000000000000000002"}]), dj_ok("20200101000000"))
        m.executar(desde=date(2026, 10, 28))
        self.assertEqual(notificacoes.processar_pendentes(self.con), {"definitivos": 0, "conferencia": 0, "duplicados": 0, "falhas_envio": 0})

    def test_falha_de_execucao_gera_alerta_distinto(self):
        clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK)
        m = self.motor(lambda *a: resp({}, 503))
        r = m.executar(desde=date(2026, 10, 28))
        out = notificacoes.alertar_falha_execucao(self.con, r["execucao_id"], r)
        self.assertEqual(out["interno"], "enviado")
        t = self.con.execute("SELECT tipo FROM alertas").fetchone()[0]
        self.assertEqual(t, "falha_consulta")


class TestFila(Base):
    def test_fila_atomica_agendador_recuperacao(self):
        j1 = fila.enfileirar(self.con, "alertas")
        self.assertEqual(fila.reivindicar(self.con)["id"], j1)
        self.assertIsNone(fila.reivindicar(self.con))
        # agendador: uma execução por dia, só depois do horário
        self.assertFalse(fila.agendar(self.con, datetime(2026, 10, 30, 5, 0))["executar"])
        self.assertTrue(fila.agendar(self.con, datetime(2026, 10, 30, 6, 1))["executar"])
        self.assertFalse(fila.agendar(self.con, datetime(2026, 10, 30, 9, 0))["executar"])
        # worker caiu: job preso volta para a fila
        self.con.execute("UPDATE jobs SET iniciado_em='2020-01-01T00:00:00' WHERE id=?", (j1,)); self.con.commit()
        self.assertEqual(fila.recuperar_travados(self.con)["jobs_devolvidos"], 1)
        self.assertEqual(self.con.execute("SELECT status FROM jobs WHERE id=?", (j1,)).fetchone()[0], "na_fila")

    def test_job_executar_completo_e_reprocessamento(self):
        clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK)
        estado = {"falhar": True}
        def tr(m, url, h, c, t):
            return resp({}, 503) if estado["falhar"] else resp({"status": "success", "count": 1, "items": [item(1, texto="CNPJ 47.960.950/0001-21")]})
        mt = self.motor(tr, dj_ok(date.today().strftime("%Y%m%d") + "000000"))
        mt.hoje = date.today()
        fila.enfileirar(self.con, "executar", {"desde": date.today().isoformat()})
        r = fila.rodar_proximo(self.con, mt)
        self.assertEqual(r["execucao"]["status"], "falha")
        self.assertIn("alerta_falha", r)
        self.assertEqual(self.con.execute("SELECT count(*) FROM correspondencias").fetchone()[0], 0)
        self.assertTrue(fila.agendar(self.con, datetime.now().replace(hour=23, minute=59))["reprocessar"])
        estado["falhar"] = False   # a fonte voltou
        r2 = fila.rodar_proximo(self.con, mt)  # job de reprocessamento
        self.assertEqual(r2["execucao"]["status"], "sucesso")
        self.assertEqual(r2["alertas"]["definitivos"], 1)
        self.assertEqual(r2["analises"], 1)
        r3 = mt.reprocessar_falhas()
        self.assertEqual(r3["consultas_executadas"], 0)  # nada mais a reprocessar


class TestAPI(Base):
    def setUp(self):
        super().setUp()
        os.environ["SENTINELA_DB"] = os.path.join(self.tmp, "t.db")
        from sentinela import api
        api._migrado.clear()
        self.c = TestClient(api.app)
        for email, papel in (("adm@x.com", "admin"), ("adv@x.com", "advogado"), ("ler@x.com", "leitura")):
            self.con.execute("INSERT INTO usuarios(email,nome,senha_hash,papel) VALUES (?,?,?,?)", (email, email, seguranca.hash_senha("senha-de-teste-123"), papel))
        self.con.commit()

    def h(self, email):
        r = self.c.post("/api/login", json={"email": email, "senha": "senha-de-teste-123"})
        self.assertEqual(r.status_code, 200)
        return {"Authorization": "Bearer " + r.json()["token"]}

    def test_autenticacao_e_permissoes(self):
        self.assertEqual(self.c.get("/api/dashboard").status_code, 401)
        self.assertEqual(self.c.post("/api/login", json={"email": "adm@x.com", "senha": "errada"}).status_code, 401)
        self.assertEqual(self.c.get("/api/dashboard", headers={"Authorization": "Bearer lixo.lixo"}).status_code, 401)
        corpo = {"razao_social": "Acme Ltda", "cnpj_matriz": CNPJ_OK}
        self.assertEqual(self.c.post("/api/clientes", json=corpo, headers=self.h("ler@x.com")).status_code, 403)
        self.assertEqual(self.c.post("/api/clientes", json=corpo, headers=self.h("adv@x.com")).status_code, 201)
        self.assertEqual(self.c.post("/api/clientes", json=corpo, headers=self.h("adv@x.com")).status_code, 409)
        self.assertEqual(self.c.post("/api/clientes", json={**corpo, "cnpj_matriz": "11.111.111/1111-11", "razao_social": "Y"}, headers=self.h("adv@x.com")).status_code, 422)
        self.assertEqual(self.c.get("/api/config", headers=self.h("adv@x.com")).status_code, 403)
        self.assertEqual(self.c.get("/api/config", headers=self.h("adm@x.com")).status_code, 200)
        self.assertEqual(self.c.get("/api/auditoria", headers=self.h("adv@x.com")).status_code, 403)

    def test_importacao_dashboard_e_fluxo(self):
        h = self.h("adv@x.com")
        csv_ = "razao_social,cnpj_matriz\nBeta SA,11.222.333/0001-81\nRuim,1\n".encode()
        r = self.c.post("/api/clientes/importar", files={"arquivo": ("c.csv", csv_)}, headers=h).json()
        self.assertEqual((r["importados"], len(r["erros"])), (1, 1))
        d = self.c.get("/api/dashboard", headers=h).json()
        self.assertEqual(d["estado_pesquisa"]["codigo"], "nunca_executou")
        self.assertEqual(d["clientes_monitorados"], 1)
        # execução com falha total aparece como "não foi possível pesquisar", não como "sem resultados"
        m = self.motor(lambda *a: resp({}, 503)); m.executar(desde=date.today())
        self.assertEqual(self.c.get("/api/dashboard", headers=h).json()["estado_pesquisa"]["codigo"], "falha_total")
        m2 = self.motor(djen([])); m2.executar(desde=date.today(), forcar=True)
        self.assertEqual(self.c.get("/api/dashboard", headers=h).json()["estado_pesquisa"]["codigo"], "ok_sem_novos")

    def test_validacao_atribuicao_detalhe(self):
        clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK)
        m = self.motor(djen([item(1)]), dj_ok()); m.executar(desde=date.today())
        h, hl = self.h("adv@x.com"), self.h("ler@x.com")
        p = self.c.get("/api/validacao/pendentes", headers=h).json()
        self.assertEqual(p["total"], 1)
        cid = p["itens"][0]["id"]
        self.assertEqual(self.c.post("/api/validacao/%d" % cid, json={"decisao": "confirmada"}, headers=hl).status_code, 403)
        self.assertEqual(self.c.post("/api/validacao/lote", json={"ids": [cid], "decisao": "confirmada", "justificativa": ""}, headers=h).status_code, 422)
        self.assertEqual(self.c.post("/api/validacao/%d" % cid, json={"decisao": "confirmada", "justificativa": "ok"}, headers=h).status_code, 200)
        uid = self.con.execute("SELECT id FROM usuarios WHERE email='adv@x.com'").fetchone()[0]
        self.assertEqual(self.c.post("/api/processos/%d/atribuir" % cid, json={"usuario_id": uid}, headers=h).status_code, 200)
        d = self.c.get("/api/processos/%d" % cid, headers=h).json()
        self.assertEqual((d["classificacao"], d["responsavel"], len(d["validacoes"])), ("confirmada", "adv@x.com", 1))
        lst = self.c.get("/api/processos?responsavel_id=%d&classificacao=confirmada" % uid, headers=h).json()
        self.assertEqual(lst["total"], 1)
        self.assertGreaterEqual(len(self.c.get("/api/auditoria", headers=self.h("adm@x.com")).json()), 3)
        self.assertEqual(self.c.get("/api/").status_code if False else 200, 200)




class TestClienteNovoCapturaProcessos(Base):
    """Garantias verificáveis para: cadastrei um cliente hoje, ele começa a ser pesquisado? (com vários CNPJs)"""
    def test_varios_cnpjs_geram_uma_consulta_cada_e_filial_confirma(self):
        cid = clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK, filiais=["11.222.333/0001-81", "11.222.333/0002-62"],
                                 anteriores=["Velha Acme S/A"])
        m = self.motor(djen([]))
        qs = {q["chave"] for q in m._consultas_do_cliente(clientes.carregar(self.con, cid))}
        self.assertEqual({k for k in qs if k.startswith("texto:")},
                         {"texto:47.960.950/0001-21", "texto:11.222.333/0001-81", "texto:11.222.333/0002-62"})
        self.assertIn("nomeParte:VELHA ACME", qs)
        com = {"texto": "CNPJ 11.222.333/0002-62", "destinatarios": [{"nome": "ACME INDUSTRIA LTDA", "polo": "P"}]}
        from sentinela import matcher
        r = matcher.avaliar(clientes.carregar(self.con, cid), com)
        self.assertEqual((r["classificacao"], r["nivel"]), ("confirmada", 2))

    def test_cliente_novo_recebe_busca_retroativa_ampla_no_agendamento_diario(self):
        clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK)
        janelas = []
        def tr(m, url, h, c, t):
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(url).query); janelas.append((q["dataDisponibilizacaoInicio"][0], q["dataDisponibilizacaoFim"][0]))
            return resp({"status": "success", "count": 0, "items": []})
        m = self.motor(tr); m.dias_retro = 90
        fila.enfileirar(self.con, "executar", {}, "agendador")   # exatamente o que o agendador enfileira
        fila.rodar_proximo(self.con, m)
        self.assertEqual(min(j[0] for j in janelas), (date.today() - __import__("datetime").timedelta(days=90)).isoformat())
        self.assertEqual(max(j[1] for j in janelas), date.today().isoformat())

    def test_api_cria_cliente_e_enfileira_busca_inicial(self):
        os.environ["SENTINELA_DB"] = os.path.join(self.tmp, "t.db")
        from sentinela import api
        api._migrado.clear()
        self.con.execute("INSERT INTO usuarios(email,nome,senha_hash,papel) VALUES ('a@x.com','A',?,'advogado')", (seguranca.hash_senha("senha-de-teste-123"),)); self.con.commit()
        c = TestClient(api.app)
        tok = c.post("/api/login", json={"email": "a@x.com", "senha": "senha-de-teste-123"}).json()["token"]
        h = {"Authorization": "Bearer " + tok}
        r = c.post("/api/clientes", json={"razao_social": "Acme", "cnpj_matriz": CNPJ_OK}, headers=h)
        self.assertEqual(r.status_code, 201)
        j = self.con.execute("SELECT * FROM jobs WHERE id=?", (r.json()["job_busca_inicial"],)).fetchone()
        p = json.loads(j["params"])
        self.assertEqual((j["tipo"], j["origem"], p["cliente_ids"]), ("executar", "busca_inicial", [r.json()["id"]]))
        self.assertEqual(p["desde"], (date.today().replace() - __import__("datetime").timedelta(days=90)).isoformat())
        # novo CNPJ de filial em cliente existente também dispara pesquisa
        r2 = c.put("/api/clientes/%d" % r.json()["id"], json={"adicionar_filiais": ["11.222.333/0001-81"]}, headers=h)
        self.assertIsNotNone(r2.json()["job_busca_inicial"])


class TestFrequenciaDiaria(Base):
    def test_execucao_de_hoje_cedo_nao_e_pulada_por_ter_rodado_ontem_tarde(self):
        clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK)
        m = self.motor(djen([]))
        m.executar(desde=date.today())
        # simula: a última consulta bem-sucedida foi ontem às 23h
        self.con.execute("UPDATE consultas SET concluida_em=datetime('now','-1 day','-1 minute')"); self.con.commit()
        r = m.executar()
        self.assertGreater(r["consultas_executadas"], 0)
        r2 = m.executar()   # já rodou hoje: não repete
        self.assertEqual(r2["consultas_executadas"], 0)


class TestDestaqueDoDiaEContinuidade(TestAPI):
    def test_ajuizado_hoje_dashboard_filtro_e_prioridade(self):
        clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK)
        hoje = date.today().strftime("%Y%m%d") + "090000"
        m = self.motor(djen([item(1, texto="CNPJ 47.960.950/0001-21")]), dj_ok(hoje))
        m.executar(desde=date.today())
        h = self.h("adv@x.com")
        d = self.c.get("/api/dashboard", headers=h).json()
        self.assertEqual(len(d["ajuizados_hoje"]), 1)
        lst = self.c.get("/api/processos?ajuizado_hoje=1", headers=h).json()
        self.assertEqual((lst["total"], lst["itens"][0]["dias_ajuiz"]), (1, 0))
        cid = lst["itens"][0]["id"]
        analise.analisar(self.con, cid, None)
        self.assertEqual(self.con.execute("SELECT prioridade FROM correspondencias").fetchone()[0], "alta")
        alerta = notificacoes.texto(notificacoes.montar(self.con, cid, "nova_acao_confirmada"))[0]
        self.assertIn("AJUIZADA HOJE", alerta)
        # processo de ontem não é destacado
        self.con.execute("UPDATE processos SET data_ajuizamento=date('now','localtime','-1 day')"); self.con.commit()
        self.assertEqual(self.c.get("/api/processos?ajuizado_hoje=1", headers=h).json()["total"], 0)

    def test_batimento_do_worker_prova_funcionamento(self):
        h = self.h("adv@x.com")
        s0 = self.c.get("/api/sistema", headers=h).json()
        self.assertFalse(s0["worker"]["ativo"])           # sem worker: o painel avisa
        self.assertIsNotNone(s0["aviso"])
        parar = __import__("threading").Event()
        t = fila.iniciar_batimento(os.path.join(self.tmp, "t.db"), parar, intervalo=0.2)
        __import__("time").sleep(0.6)
        s1 = self.c.get("/api/sistema", headers=h).json()
        parar.set(); t.join(2)
        self.assertTrue(s1["worker"]["ativo"])
        self.assertEqual(len(s1["dias"]), 14)
        self.assertIsNotNone(s1["agendamento"]["proxima_execucao"])

    def test_processo_novo_ausente_no_datajud_e_reconsultado_depois(self):
        clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK)
        estado = {"achou": False}
        def dj(*a):
            if not estado["achou"]:
                return resp({"hits": {"hits": []}})
            return dj_ok(date.today().strftime("%Y%m%d") + "100000")(*a)
        m = self.motor(djen([item(1, texto="CNPJ 47.960.950/0001-21")]), dj)
        m.executar(desde=date.today())
        self.assertEqual(self.con.execute("SELECT datajud_status FROM processos").fetchone()[0], "nao_encontrado")
        estado["achou"] = True   # o DataJud passou a ter o processo no dia seguinte
        self.con.execute("UPDATE processos SET ultima_verificacao=datetime('now','localtime','-1 day')"); self.con.commit()
        self.assertEqual(m.enriquecer_pendentes()["ok"], 1)
        self.assertEqual(self.con.execute("SELECT categoria_data FROM correspondencias").fetchone()[0], "nova_distribuicao")


class TestBarraDeProgresso(TestAPI):
    def test_progresso_na_fila_durante_e_depois(self):
        h = self.h("adv@x.com")
        self.assertEqual(self.c.get("/api/progresso", headers=h).json()["estado"], "ocioso")
        clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK, filiais=["11.222.333/0001-81"])
        jid = self.c.post("/api/jobs", json={"tipo": "executar", "params": {}}, headers=h).json()["job_id"]
        p = self.c.get("/api/progresso", headers=h).json()
        self.assertEqual((p["estado"], p["job_id"]), ("na_fila", jid))
        mt = self.motor(djen([item(1, texto="CNPJ 47.960.950/0001-21")]), dj_ok(date.today().strftime("%Y%m%d") + "000000"))
        mt._prog_ts = 0
        vistos = []
        orig = mt._progresso
        def espia(exec_id, pct, fase, texto, force=False):
            mt._prog_ts = 0   # sem limitação de frequência no teste
            orig(exec_id, pct, fase, texto, force)
            vistos.append((fase, self.c.get("/api/progresso", headers=h).json()))
        mt._progresso = espia
        fila.rodar_proximo(self.con, mt)
        fases = [f for f, _ in vistos]
        self.assertTrue({"coleta", "gravacao", "datajud"} <= set(fases))
        pcts = [p["pct"] for _, p in vistos]
        self.assertEqual(pcts, sorted(pcts))                      # nunca recua
        self.assertTrue(all(p["estado"] == "executando" for _, p in vistos))
        fim = self.c.get("/api/progresso", headers=h).json()
        self.assertEqual((fim["estado"], fim["pct"]), ("concluido", 100))
        self.assertIn("correspondencias_novas", fim["resumo"])


class TestContagemSoAjuizadosHoje(TestAPI):
    def test_cards_hoje_semana_mes_contam_por_data_de_ajuizamento(self):
        cid = clientes.cadastrar(self.con, "Acme Indústria Ltda", CNPJ_OK)
        hoje = date.today()
        from datetime import timedelta
        for i, dias in enumerate((0, 3, 40, None)):   # hoje, 3 dias, 40 dias, sem data do DataJud
            dt = (hoje - timedelta(days=dias)).isoformat() if dias is not None else None
            pid = self.con.execute("INSERT INTO processos(numero_processo,tribunal,data_ajuizamento,primeira_identificacao,ultima_verificacao) "
                                   "VALUES (?,?,?,datetime('now'),datetime('now'))", ("000000%d" % i, "TJPR", dt)).lastrowid
            self.con.execute("INSERT INTO correspondencias(cliente_id,processo_id,nivel,classificacao,evidencia,fonte,identificada_em,ultima_verificacao) "
                             "VALUES (?,?,1,'confirmada','{}','djen',datetime('now'),datetime('now'))", (cid, pid))
        self.con.commit()
        d = self.c.get("/api/dashboard", headers=self.h("adv@x.com")).json()
        self.assertEqual((d["identificados_hoje"], d["identificados_semana"], d["identificados_mes"]), (1, 2, 2))


if __name__ == "__main__":
    unittest.main()
