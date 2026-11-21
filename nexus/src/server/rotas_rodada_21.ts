/**
 * Rotas da rodada de 21/11/2026 (tarefas/limpeza, pauta por equipe, QGC com lastro, portal, pré-diagnóstico,
 * onboarding comercial e parceiros). Ficam fora do `app.ts`, que só chama `rotasRodada21`.
 */
import { z } from 'zod';
import { exigir } from '../security/rbac.ts';
import { PedidoInvalido } from './erros.ts';
import type { ContextoRota } from './rotas_frente_b.ts';
import * as tarefas from './tarefas.ts';
import * as pautasEquipe from './pautas_equipe.ts';
import * as qgcLastros from './qgc_lastros.ts';
import * as pedidos from './portal_pedidos.ts';
import * as boasVindas from './portal_boas_vindas.ts';
import * as prediag from './prediagnostico.ts';
import * as novos from './novos_clientes.ts';
import * as parceiros from './parceiros.ts';

const UUID = '([0-9a-f-]{36})';
export const corpoDe = async <T>(req: Request, esq: z.ZodType<T>): Promise<T> => {
  const d = esq.safeParse(await req.json().catch(() => null));
  if (!d.success) throw new PedidoInvalido(d.error.issues[0]?.message ?? 'dados inválidos');
  return d.data;
};
const Ids = z.object({ ids: z.array(z.string().uuid()).min(1).max(5000), motivo: z.string().trim().max(200).optional() });

export async function rotasRodada21(c: ContextoRota): Promise<Response | null> {
  const { rota, metodo, req, identidade: i, como, json } = c;

  // ------------------------------------------ portal: boas-vindas/manuais ---
  if (rota === '/api/portal/boas-vindas' && metodo === 'GET') return json(await como((db) => boasVindas.estado(db, i)));
  if (rota === '/api/portal/boas-vindas/leitura' && metodo === 'POST') { const d = await corpoDe(req, boasVindas.EsquemaLeitura); return json(await como((db) => boasVindas.registrarLeitura(db, d, i))); }
  if (rota === '/api/portal/contatos-oficiais' && metodo === 'PUT') {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'admin.gerir'); const d = await corpoDe(req, boasVindas.EsquemaConfig); return json(await como((db) => boasVindas.salvarConfig(db, d, i)));
  }

  // ------------------------------------------------- novos clientes ---
  if (rota === '/api/celebracoes' && metodo === 'GET') { if (c.ehCliente) return json([]); return json(await como(novos.celebracoes)); }
  if (rota.startsWith('/api/novos-clientes')) {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'projeto.ler');
    if (rota === '/api/novos-clientes' && metodo === 'GET') return json(await como(novos.listar));
    exigir(i.papeis, 'projeto.escrever');
    if (rota === '/api/novos-clientes' && metodo === 'POST') { const d = await corpoDe(req, novos.EsquemaNovo); return json(await como((db) => novos.criar(db, d, i)), 201); }
    const m = new RegExp(`^/api/novos-clientes/${UUID}(?:/(contrato))?$`).exec(rota);
    if (m && !m[2] && metodo === 'GET') return json(await como((db) => novos.obter(db, m[1]!)));
    if (m && !m[2] && metodo === 'PATCH') { const d = await corpoDe(req, novos.EsquemaEdicao); return json(await como((db) => novos.editar(db, m[1]!, d, i))); }
    if (m && m[2] === 'contrato' && metodo === 'POST') { const d = await corpoDe(req, novos.EsquemaContrato); return json(await como((db) => novos.fecharContrato(db, m[1]!, d, i)), 201); }
  }

  // --------------------------------------------------- pré-diagnóstico ---
  if (rota.startsWith('/api/prediagnosticos')) {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'projeto.ler');
    if (rota === '/api/prediagnosticos' && metodo === 'GET') { const pid = new URL(req.url).searchParams.get('projeto'); return json(await como((db) => prediag.listar(db, pid && /^[0-9a-f-]{36}$/.test(pid) ? pid : null))); }
    if (rota === '/api/prediagnosticos' && metodo === 'POST') { exigir(i.papeis, 'projeto.escrever'); const d = await corpoDe(req, prediag.EsquemaNovo); return json(await como((db) => prediag.criar(db, d, i)), 201); }
    const m = new RegExp(`^/api/prediagnosticos/${UUID}(?:/(processos|datajud|ligar|numeros|projeto))?$`).exec(rota);
    if (m) {
      const id = m[1]!; const acao = m[2];
      if (!acao && metodo === 'GET') return json(await como((db) => prediag.obter(db, id)));
      exigir(i.papeis, 'projeto.escrever');
      if (acao === 'processos' && metodo === 'POST') return json(await como((db) => prediag.buscarProcessos(db, id)));
      if (acao === 'datajud' && metodo === 'POST') return json(await como((db) => prediag.enriquecer(db, id)));
      if (acao === 'ligar' && metodo === 'POST') { const d = await corpoDe(req, prediag.EsquemaLigar); return json(await como((db) => prediag.ligarEmpresa(db, id, d, i))); }
      if (acao === 'numeros' && metodo === 'POST') { const d = await corpoDe(req, prediag.EsquemaNumeros); return json(await como((db) => prediag.incluirNumeros(db, id, d))); }
      if (acao === 'projeto' && metodo === 'PUT') { const d = await corpoDe(req, z.object({ projetoId: z.string().uuid() })); return json(await como((db) => prediag.vincularProjeto(db, id, d.projetoId, i))); }
    }
  }

  // ------------------------------------------------------------ tarefas ---
  if (rota.startsWith('/api/tarefas/')) {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    if (rota === '/api/tarefas/limpeza' && metodo === 'POST') {
      const d = await corpoDe(req, tarefas.EsquemaLimpeza);
      if (!d.previa && !i.papeis.some((p) => ['socio_administrador', 'socio', 'coordenacao', 'controladoria'].includes(p))) exigir(i.papeis, 'controladoria.gerir');
      exigir(i.papeis, 'tarefa.escrever');
      return json(await como((db) => tarefas.limpeza(db, d, i)));
    }
    if (rota === '/api/tarefas/desarquivar' && metodo === 'POST') {
      exigir(i.papeis, 'tarefa.escrever'); const d = await corpoDe(req, Ids);
      return json(await como((db) => tarefas.desarquivar(db, d.ids, i)));
    }
    if (rota === '/api/tarefas/arquivar' && metodo === 'POST') {
      exigir(i.papeis, 'tarefa.escrever'); const d = await corpoDe(req, Ids);
      return json(await como((db) => tarefas.arquivar(db, d.ids, d.motivo ?? null, i)));
    }
  }
  // --------------------------------------------------- pauta por equipe ---
  if (rota.startsWith('/api/pautas/')) {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'modulo.pautas');
    if (rota === '/api/pautas/equipes' && metodo === 'GET') return json(await como(pautasEquipe.equipes));
    if (rota === '/api/pautas/reunioes' && metodo === 'GET') return json(await como(pautasEquipe.reunioesParaAgenda));
    let m = /^\/api\/pautas\/equipes\/([^/]+)$/.exec(rota);
    if (m && metodo === 'GET') { const eq = decodeURIComponent(m[1]!); return json(await como((db) => pautasEquipe.daEquipe(db, eq))); }
    if ((m = /^\/api\/pautas\/equipes\/([^/]+)\/cadencia$/.exec(rota)) && metodo === 'PUT') {
      const eq = decodeURIComponent(m[1]!); const d = await corpoDe(req, pautasEquipe.EsquemaConfigEquipe);
      return json(await como((db) => pautasEquipe.configurarEquipe(db, eq, d, i)));
    }
    if ((m = /^\/api\/pautas\/equipes\/([^/]+)\/reunioes$/.exec(rota)) && metodo === 'POST') {
      const eq = decodeURIComponent(m[1]!); const d = await corpoDe(req, pautasEquipe.EsquemaReuniaoEquipe);
      return json(await como((db) => pautasEquipe.agendarReuniaoEquipe(db, eq, d, i)), 201);
    }
  }
  // ------------------------------------------------- QGC vivo: lastros ---
  const p = (suf: string) => new RegExp(`^/api/projetos/${UUID}/${suf}$`).exec(rota);
  let mq: RegExpExecArray | null;
  if ((mq = p('qgc/lastros')) && metodo === 'GET') {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'credito.ler'); const pid = mq[1]!;
    return json(await como(async (db) => {
      const pre = await qgcLastros.painel(db, pid);
      // Documento novo do cliente desde a última correlação: correlaciona de novo antes de mostrar (QGC vivo).
      if (pre.documentosNovos.length && i.papeis.some((x) => x !== 'estagiario')) { const r = await qgcLastros.correlacionar(db, pid, i.usuarioId); if (r.novos) return { ...(await qgcLastros.painel(db, pid)), correlacaoAutomatica: r }; }
      return pre;
    }));
  }
  if ((mq = p('qgc/lastros/correlacionar')) && metodo === 'POST') {
    exigir(i.papeis, 'credito.escrever'); const pid = mq[1]!;
    return json(await como((db) => qgcLastros.correlacionar(db, pid, i.usuarioId)));
  }
  if ((mq = p('qgc/acessos')) && metodo === 'POST') {
    exigir(i.papeis, 'credito.escrever'); const pid = mq[1]!; const d = await corpoDe(req, qgcLastros.EsquemaAcessoAj);
    return json(await como((db) => qgcLastros.criarAcesso(db, pid, d, i)), 201);
  }
  if ((mq = new RegExp(`^/api/qgc/acessos/${UUID}$`).exec(rota)) && metodo === 'DELETE') {
    exigir(i.papeis, 'credito.escrever'); const id = mq[1]!; return json(await como((db) => qgcLastros.revogarAcesso(db, id, i)));
  }
  if ((mq = new RegExp(`^/api/creditos/${UUID}/lastros$`).exec(rota)) && metodo === 'POST') {
    exigir(i.papeis, 'credito.escrever'); const id = mq[1]!; const d = await corpoDe(req, qgcLastros.EsquemaLastro);
    return json(await como((db) => qgcLastros.vincular(db, id, d, i)), 201);
  }
  if ((mq = new RegExp(`^/api/creditos/${UUID}/sujeito$`).exec(rota)) && metodo === 'PUT') {
    exigir(i.papeis, 'credito.escrever'); const id = mq[1]!; const d = await corpoDe(req, qgcLastros.EsquemaSujeito);
    return json(await como((db) => qgcLastros.definirSujeito(db, id, d, i)));
  }
  if ((mq = new RegExp(`^/api/lastros/${UUID}$`).exec(rota)) && metodo === 'PATCH') {
    exigir(i.papeis, 'credito.escrever'); const id = mq[1]!; const d = await corpoDe(req, qgcLastros.EsquemaSituacaoLastro);
    return json(await como((db) => qgcLastros.situacaoDoLastro(db, id, d, i)));
  }

  // ------------------------------------------- portal: pedidos e contatos ---
  if ((mq = p('checklist/pedido')) && metodo === 'POST') {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'projeto.escrever'); const pid = mq[1]!; const d = await corpoDe(req, pedidos.EsquemaPedido);
    return json(await como((db) => pedidos.pedirDocumento(db, pid, d, i)), 201);
  }
  if ((mq = p('portal/contatos')) && metodo === 'GET') {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'projeto.ler'); const pid = mq[1]!; return json(await como((db) => pedidos.destinatarios(db, pid)));
  }
  if ((mq = new RegExp(`^/api/projetos/${UUID}/portal/contatos/${UUID}$`).exec(rota)) && metodo === 'PUT') {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'portal.acessos'); const pid = mq[1]!; const uid = mq[2]!; const d = await corpoDe(req, pedidos.EsquemaContato);
    return json(await como((db) => pedidos.salvarContato(db, pid, uid, d, i)));
  }

  // ------------------------------------------------- parceiros externos ---
  if ((mq = p('parceiros'))) {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    const pid = mq[1]!;
    if (metodo === 'GET') { exigir(i.papeis, 'projeto.ler'); return json(await como((db) => parceiros.listar(db, pid))); }
    if (metodo === 'POST') { exigir(i.papeis, 'projeto.escrever'); const d = await corpoDe(req, parceiros.EsquemaConvite); return json(await como((db) => parceiros.convidar(db, pid, d, i)), 201); }
  }
  if ((mq = new RegExp(`^/api/parceiros/${UUID}$`).exec(rota)) && metodo === 'DELETE') {
    exigir(i.papeis, 'projeto.escrever'); const id = mq[1]!; return json(await como((db) => parceiros.encerrar(db, id, i)));
  }
  if (rota === '/api/parceiros/minhas-areas' && metodo === 'GET') return json(await como((db) => parceiros.minhasAreas(db, i)));

  const mEq = new RegExp(`^/api/projetos/${UUID}/equipes$`).exec(rota);
  if (mEq && metodo === 'PUT') {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'projeto.escrever'); const d = await corpoDe(req, pautasEquipe.EsquemaEquipesDoProjeto);
    return json(await como((db) => pautasEquipe.equipesDoProjeto(db, mEq[1]!, d, i)));
  }
  return null;
}
