/**
 * Rotas da Frente B (QGC automático e validado). Ficam fora do `app.ts` para
 * as duas frentes não disputarem o mesmo arquivo; o `app.ts` só chama `rotasFrenteB`.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { exigir, type Papel } from '../security/rbac.ts';
import { PedidoInvalido } from './erros.ts';
import type { Deposito } from './arquivos.ts';
import type { Identidade } from '../security/sessao.ts';
import * as qgc from './qgc.ts';
import * as fechamentos from './fechamentos.ts';

export interface ContextoRota {
  rota: string; metodo: string; req: Request; identidade: Identidade & { papeis: readonly Papel[] }; ehCliente: boolean;
  como: <T>(f: (db: PoolClient) => Promise<T>) => Promise<T>; deposito: Deposito;
  json: (d: unknown, status?: number) => Response; erro: (m: string, s: number, d?: unknown) => Response;
}

const UUID = '([0-9a-f-]{36})';
const corpo = async <T>(req: Request, esq: z.ZodType<T>): Promise<T> => {
  const d = esq.safeParse(await req.json().catch(() => null));
  if (!d.success) throw new PedidoInvalido(d.error.issues[0]?.message ?? 'dados inválidos');
  return d.data;
};

export async function rotasFrenteB(c: ContextoRota): Promise<Response | null> {
  const { rota, metodo, req, identidade: i, como, json } = c;
  if (!rota.startsWith('/api/projetos/') && !rota.startsWith('/api/qgc/') && !rota.startsWith('/api/creditos/')) return null;
  const p = (sufixo: string) => new RegExp(`^/api/projetos/${UUID}/${sufixo}$`).exec(rota);

  let m = p('qgc/preliminar');
  if (m) {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    const pid = m[1]!;
    if (metodo === 'GET') { exigir(i.papeis, 'credito.ler'); return json(await como((db) => qgc.listar(db, pid))); }
    if (metodo === 'POST') {
      exigir(i.papeis, 'credito.escrever');
      const d = await corpo(req, z.object({ documentoId: z.string().uuid() }));
      return json(await como((db) => qgc.gerar(db, pid, d.documentoId, c.deposito, i)), 201);
    }
  }
  if ((m = p('qgc/preliminar/linhas')) && metodo === 'POST') {
    exigir(i.papeis, 'credito.escrever'); const pid = m[1]!;
    const d = await corpo(req, qgc.EsquemaLinha); return json(await como((db) => qgc.incluirLinha(db, pid, d, i)), 201);
  }
  if ((m = p('qgc/preliminar/validar-todas')) && metodo === 'POST') {
    exigir(i.papeis, 'credito.escrever'); const pid = m[1]!; return json(await como((db) => qgc.validarTodas(db, pid, i)));
  }
  if ((m = p('qgc/credito')) && metodo === 'POST') {
    exigir(i.papeis, 'credito.escrever'); const pid = m[1]!;
    const d = await corpo(req, qgc.EsquemaCreditoRapido); return json(await como((db) => qgc.creditoRapido(db, pid, d, i)), 201);
  }
  if ((m = p('qgc/relacao-final')) && metodo === 'POST') {
    exigir(i.papeis, 'credito.escrever'); const pid = m[1]!;
    const d = await corpo(req, z.object({ documentoId: z.string().uuid() }));
    return json(await como((db) => qgc.importarRelacaoFinal(db, pid, d.documentoId, c.deposito, i)), 201);
  }

  // Fechamento financeiro mensal: o cliente informa, a NGA lê e confere.
  if ((m = p('fechamentos'))) {
    const pid = m[1]!;
    if (metodo === 'GET') { exigir(i.papeis, 'financeiro_cliente.ler'); return json(await como((db) => fechamentos.listar(db, pid))); }
    if (metodo === 'PUT') { exigir(i.papeis, 'financeiro_cliente.escrever'); const d = await corpo(req, fechamentos.EsquemaFechamento); return json(await como((db) => fechamentos.salvar(db, pid, d, i))); }
  }
  if ((m = new RegExp(`^/api/projetos/${UUID}/fechamentos/(\\d{4}-\\d{2})/conferir$`).exec(rota)) && metodo === 'POST') {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'financeiro_cliente.ler'); exigir(i.papeis, 'projeto.escrever');
    const pid = m[1]!; const mes = m[2]!; return json(await como((db) => fechamentos.conferir(db, pid, mes, i)));
  }

  m = new RegExp(`^/api/qgc/preliminar/${UUID}(/validar)?$`).exec(rota);
  if (m) {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'credito.escrever'); const id = m[1]!;
    if (m[2] && metodo === 'POST') return json(await como((db) => qgc.validarLinha(db, id, i)));
    if (!m[2] && metodo === 'PATCH') { const d = await corpo(req, qgc.EsquemaLinha.partial()); return json(await como((db) => qgc.editarLinha(db, id, d, i))); }
    if (!m[2] && metodo === 'DELETE') return json(await como((db) => qgc.descartarLinha(db, id, i)));
  }

  m = new RegExp(`^/api/creditos/${UUID}$`).exec(rota);
  if (m) {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'credito.escrever'); const id = m[1]!;
    if (metodo === 'PATCH') { const d = await corpo(req, qgc.EsquemaEdicaoCredito); return json(await como((db) => qgc.editarCredito(db, id, d, i))); }
    if (metodo === 'DELETE') return json(await como((db) => qgc.excluirCredito(db, id, i)));
  }
  return null;
}
