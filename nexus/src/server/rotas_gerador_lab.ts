/**
 * Rotas do Gerador de Relatórios dentro do LAB. Ficam fora do `app.ts` (que outras frentes editam); ele só chama
 * `rotasGeradorLab`. Nada aqui é visível ao portal do cliente: publicar continua sendo o ato explícito do acervo.
 */
import { exigir } from '../security/rbac.ts';
import type { Banco } from '../store/conexao.ts';
import { PedidoInvalido } from './erros.ts';
import type { ContextoRota } from './rotas_frente_b.ts';
import * as g from './gerador_lab.ts';

const UUID = '([0-9a-f-]{36})';
const LIMITE_ASTREA = 40 * 1024 * 1024;

/** Pedido por JSON (fonte LAB) ou multipart (fonte Astrea, com o PDF de fichas no campo `arquivo`). */
async function lerPedido(req: Request): Promise<{ pedido: g.Pedido; astrea?: Uint8Array }> {
  const tipo = req.headers.get('content-type') ?? '';
  if (tipo.startsWith('multipart/form-data')) {
    const f = await req.formData().catch(() => null);
    if (!f) throw new PedidoInvalido('formulário inválido');
    const arquivo = f.get('arquivo');
    const d = g.EsquemaPedido.safeParse({ periodicidade: f.get('periodicidade') ?? undefined, inicio: f.get('inicio'), fonte: f.get('fonte') ?? 'astrea' });
    if (!d.success) throw new PedidoInvalido(d.error.issues[0]?.message ?? 'dados inválidos');
    if (d.data.fonte !== 'astrea') return { pedido: d.data };
    if (!(arquivo instanceof File)) throw new PedidoInvalido('envie o PDF de fichas exportado do Astrea');
    if (arquivo.size > LIMITE_ASTREA) throw new PedidoInvalido('o PDF do Astrea passa de 40 MB');
    return { pedido: d.data, astrea: new Uint8Array(await arquivo.arrayBuffer()) };
  }
  const d = g.EsquemaPedido.safeParse(await req.json().catch(() => null));
  if (!d.success) throw new PedidoInvalido(d.error.issues[0]?.message ?? 'dados inválidos');
  if (d.data.fonte === 'astrea') throw new PedidoInvalido('para a fonte Astrea, envie o PDF como formulário (campo "arquivo")');
  return { pedido: d.data };
}

export async function rotasGeradorLab(c: ContextoRota & { banco: Banco }): Promise<Response | null> {
  const { rota, metodo, req, identidade: i, como, json } = c;
  if (!rota.startsWith('/api/projetos/') && !rota.startsWith('/api/relatorios/')) return null;
  const p = (sufixo: string) => new RegExp(`^/api/projetos/${UUID}/${sufixo}$`).exec(rota);

  let m = p('gerador-lab/previa');
  if (m && metodo === 'POST') {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'relatorio.gerar');
    const pid = m[1]!; const { pedido, astrea } = await lerPedido(req);
    const r = await como((db) => g.montar(db, pid, pedido, astrea));
    // O PDF vem inteiro (é o próprio relatório); os números e avisos seguem nos cabeçalhos para a tela.
    return new Response(r.pdf as unknown as BodyInit, { headers: {
      'content-type': 'application/pdf', 'content-disposition': `inline; filename="${r.nome}"`,
      'x-nga-resumo': encodeURIComponent(JSON.stringify({ ...r.resumo, periodo: r.calc.periodo, avisos: r.calc.avisos, cliente: r.cliente })),
    } });
  }
  m = p('gerador-lab/emissoes');
  if (m) {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'relatorio.gerar');
    const pid = m[1]!;
    if (metodo === 'GET') return json(await como((db) => g.emissoes(db, pid)));
    if (metodo === 'POST') { const { pedido, astrea } = await lerPedido(req); return json(await como((db) => g.emitir(db, pid, pedido, i, c.deposito, { astrea })), 201); }
  }
  m = p('gerador-lab/agendamento');
  if (m) {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'relatorio.gerar');
    const pid = m[1]!;
    if (metodo === 'PUT') {
      const d = g.EsquemaAgendamento.safeParse(await req.json().catch(() => null));
      if (!d.success) return c.erro(d.error.issues[0]?.message ?? 'dados inválidos', 400, d.error.issues);
      return json(await como((db) => g.salvarAgendamento(db, pid, d.data, i)));
    }
    if (metodo === 'DELETE') return json(await como((db) => g.removerAgendamento(db, pid, i)));
  }
  if (rota === '/api/relatorios/agendamentos' && metodo === 'GET') {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'relatorio.gerar');
    return json(await como(g.agendamentos));
  }
  // Mesmo trabalho da rotina das :07, à mão (útil no primeiro dia e sem pg_cron). Só quem gere integrações.
  if (rota === '/api/relatorios/agendamentos/rodar' && metodo === 'POST') {
    if (c.ehCliente) return c.erro('acesso negado', 403);
    exigir(i.papeis, 'integracao.gerir');
    return json(await g.rotinaRelatorios(c.banco, c.deposito));
  }
  return null;
}
