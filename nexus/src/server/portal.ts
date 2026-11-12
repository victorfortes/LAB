/**
 * API do portal do cliente (§6).
 *
 * Tudo aqui roda sob o RLS do usuário autenticado. As políticas da migração
 * 009 é que garantem o isolamento; estas funções não reimplementam o filtro —
 * se reimplementassem, haveria duas verdades e uma delas ficaria para trás.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import type { Identidade } from '../security/sessao.ts';
import { formatarReais } from '../domain/shared/dinheiro.ts';
import {
  type Autor, type ItemDeChecklist, ROTULO_DA_SITUACAO, type SituacaoRequisito,
  calcularProgresso, modeloDe, transicionar,
} from '../domain/portal/checklist.ts';
import {
  type Granularidade, type Lancamento, calcularIndicadores, montarFluxo,
} from '../domain/portal/fluxo.ts';

export const EsquemaEnvio = z.object({
  requisitoId: z.string().uuid(),
  titulo: z.string().min(1).max(300),
  caminho: z.string().min(1).max(1000),
  tipoMime: z.string().max(200).optional(),
  tamanhoBytes: z.number().int().nonnegative().optional(),
  hashSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

export const EsquemaAnalise = z.object({
  situacao: z.enum(['em_analise', 'aprovado', 'rejeitado', 'complementacao', 'nao_aplicavel', 'pendente']),
  observacao: z.string().max(2000).optional(),
});

export const EsquemaLancamento = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.enum(['receita', 'despesa']),
  situacao: z.enum(['previsto', 'realizado']),
  valor: z.string().regex(/^\d+$/, 'valor em centavos, só dígitos'),
  categoria: z.string().min(1).max(120),
  contraparte: z.string().max(300).optional(),
  contaId: z.string().uuid().optional(),
});

export const EsquemaMensagem = z.object({
  texto: z.string().min(1).max(10000),
  requisitoId: z.string().uuid().optional(),
});

/** Projetos que o usuário alcança pelo portal, com o que cada um expõe. */
export async function meusPortais(db: PoolClient) {
  const { rows } = await db.query(
    `SELECT po.projeto_id, po.mostra_documentos, po.mostra_obrigacoes, po.mostra_financeiro, po.mostra_faturas,
            pr.nome, pr.tipo, pr.situacao, pr.iniciado_em, pr.whatsapp_grupo_url, pr.resumo,
            (SELECT o.nome FROM organizacoes o WHERE o.id = po.organizacao_cliente_id) AS organizacao
       FROM portais po JOIN projetos pr ON pr.id = po.projeto_id
      WHERE po.ativo AND po.projeto_id IN (SELECT app_projetos_do_portal())
      ORDER BY pr.nome`);
  return rows;
}

/** Checklist do onboarding com progresso real (aprovado ≠ enviado). */
export async function checklist(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<{
    id: string; categoria: string; titulo: string; fundamento: string | null;
    obrigatorio: boolean; situacao: SituacaoRequisito; observacao: string | null;
    documento_id: string | null; analisado_em: Date | null; atribuicao: string | null;
  }>(
    `SELECT id, categoria, titulo, fundamento, obrigatorio, situacao, observacao,
            documento_id, analisado_em, atribuicao
       FROM requisitos WHERE projeto_id = $1 ORDER BY ordem, titulo`,
    [projetoId]);

  const itens: ItemDeChecklist[] = rows.map((r) => ({
    id: r.id, categoria: r.categoria, titulo: r.titulo,
    situacao: r.situacao, obrigatorio: r.obrigatorio,
  }));

  return {
    progresso: calcularProgresso(itens),
    itens: rows.map((r) => ({
      ...r,
      rotuloDaSituacao: ROTULO_DA_SITUACAO[r.situacao],
      // O cliente precisa saber de quem é a vez.
      aguardaVoce: ['pendente', 'rejeitado', 'complementacao'].includes(r.situacao),
    })),
  };
}

/**
 * Cria o checklist de um projeto a partir do modelo do procedimento.
 * Idempotente: não duplica requisito já existente com o mesmo título.
 */
export async function aplicarModelo(
  db: PoolClient, projetoId: string, identidade: Identidade,
) {
  const { rows: proj } = await db.query<{ organizacao_id: string; tipo: string }>(
    'SELECT organizacao_id, tipo FROM projetos WHERE id = $1', [projetoId]);
  const projeto = proj[0];
  if (!projeto) throw new NaoEncontrado('projeto não encontrado');

  const modelo = modeloDe(projeto.tipo);
  if (modelo.length === 0) {
    return { criados: 0, aviso: `não há modelo de checklist para "${projeto.tipo}"` };
  }

  const { rows: existentes } = await db.query<{ titulo: string }>(
    'SELECT titulo FROM requisitos WHERE projeto_id = $1', [projetoId]);
  const jaTem = new Set(existentes.map((r) => r.titulo));

  let criados = 0;
  for (const [i, r] of modelo.entries()) {
    if (jaTem.has(r.titulo)) continue;
    await db.query(
      `INSERT INTO requisitos (organizacao_id, projeto_id, categoria, titulo, fundamento, obrigatorio, ordem, atribuicao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [projeto.organizacao_id, projetoId, r.categoria, r.titulo, r.fundamento ?? null, r.obrigatorio, i, r.atribuicao ?? null]);
    criados++;
  }

  await auditar(db, {
    organizacaoId: projeto.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'checklist.modelo_aplicado', entidade: 'projeto', entidadeId: projetoId,
    depois: { tipo: projeto.tipo, criados },
  });

  return { criados, total: modelo.length };
}

/**
 * O cliente envia um documento para um requisito.
 *
 * O id do documento é gerado AQUI, não por RETURNING: a política de SELECT do
 * portal não deixa o cliente ler documento interno, e com RETURNING o INSERT
 * inteiro seria recusado. Ver migração 009.
 */
export async function enviarDocumento(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaEnvio>, identidade: Identidade,
  lado: Autor = 'cliente',
) {
  const { rows: req } = await db.query<{ situacao: SituacaoRequisito; organizacao_id: string }>(
    'SELECT situacao, organizacao_id FROM requisitos WHERE id = $1 AND projeto_id = $2',
    [dados.requisitoId, projetoId]);
  const requisito = req[0];
  if (!requisito) throw new NaoEncontrado('requisito não encontrado neste projeto');

  const documentoId = crypto.randomUUID();
  await db.query(
    `INSERT INTO documentos (id, organizacao_id, projeto_id, titulo, caminho, tipo_mime,
       tamanho_bytes, hash_sha256, origem, visibilidade, enviado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'interno',$10)`,
    [documentoId, requisito.organizacao_id, projetoId, dados.titulo, dados.caminho,
     dados.tipoMime ?? null, dados.tamanhoBytes ?? null, dados.hashSha256 ?? null,
     lado === 'cliente' ? 'portal_cliente' : 'interno', identidade.usuarioId]);

  return vincularAoRequisito(db, dados.requisitoId, documentoId, identidade, lado);
}

/**
 * Liga o documento ao item do checklist e move a situação.
 *
 * Separado do INSERT porque agora existem duas formas de o documento nascer —
 * com arquivo de verdade (`arquivos.receber`) ou como registro de referência —
 * e a transição de situação é a mesma nas duas. Duplicá-la seria deixar uma
 * delas para trás na próxima mudança de regra.
 */
export async function vincularAoRequisito(
  db: PoolClient, requisitoId: string, documentoId: string,
  identidade: Identidade, lado: Autor,
) {
  const { rows } = await db.query<{ situacao: SituacaoRequisito; organizacao_id: string }>(
    'SELECT situacao, organizacao_id FROM requisitos WHERE id = $1', [requisitoId]);
  const requisito = rows[0];
  if (!requisito) throw new NaoEncontrado('requisito não encontrado');

  // A máquina de situações é quem decide se o envio cabe agora — e quem pode
  // marcar o quê. Enviar é ato do cliente; aprovar, nunca.
  const nova = transicionar(requisito.situacao, 'enviado', lado);

  await db.query(
    `UPDATE requisitos SET situacao=$2, documento_id=$3, observacao=NULL, atualizado_em=now()
      WHERE id=$1`, [requisitoId, nova, documentoId]);

  await auditar(db, {
    organizacaoId: requisito.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'portal.documento_enviado', entidade: 'requisito', entidadeId: requisitoId,
    antes: { situacao: requisito.situacao }, depois: { situacao: nova, documentoId },
    origem: lado === 'cliente' ? 'portal' : 'api',
  });

  return { documentoId, situacao: nova, rotulo: ROTULO_DA_SITUACAO[nova] };
}

/** A NGA analisa: aprova, rejeita ou pede complementação. */
export async function analisarRequisito(
  db: PoolClient, requisitoId: string,
  dados: z.infer<typeof EsquemaAnalise>, identidade: Identidade,
) {
  const { rows } = await db.query<{ situacao: SituacaoRequisito; organizacao_id: string }>(
    'SELECT situacao, organizacao_id FROM requisitos WHERE id = $1', [requisitoId]);
  const requisito = rows[0];
  if (!requisito) throw new NaoEncontrado('requisito não encontrado');

  const nova = transicionar(requisito.situacao, dados.situacao, 'nga');

  await db.query(
    `UPDATE requisitos SET situacao=$2, observacao=$3, analisado_por=$4,
            analisado_em=now(), atualizado_em=now() WHERE id=$1`,
    [requisitoId, nova, dados.observacao ?? null, identidade.usuarioId]);

  await auditar(db, {
    organizacaoId: requisito.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'portal.requisito_analisado', entidade: 'requisito', entidadeId: requisitoId,
    antes: { situacao: requisito.situacao },
    depois: { situacao: nova, observacao: dados.observacao },
  });

  return { situacao: nova, rotulo: ROTULO_DA_SITUACAO[nova] };
}

/**
 * Publica um documento para o portal do cliente.
 *
 * É o único caminho para um documento sair do ambiente interno (§13). Exige
 * permissão `portal.publicar`, verificada pelo chamador, e fica na auditoria.
 */
export async function publicarDocumento(
  db: PoolClient, documentoId: string, identidade: Identidade,
) {
  const { rows } = await db.query<{ visibilidade: string; titulo: string; organizacao_id: string }>(
    'SELECT visibilidade, titulo, organizacao_id FROM documentos WHERE id = $1', [documentoId]);
  const doc = rows[0];
  if (!doc) throw new NaoEncontrado('documento não encontrado');
  if (doc.visibilidade === 'publicado') return { ok: true, jaEstava: true };

  await db.query(
    `UPDATE documentos SET visibilidade='publicado', publicado_por=$2, publicado_em=now()
      WHERE id=$1`, [documentoId, identidade.usuarioId]);

  await auditar(db, {
    organizacaoId: doc.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'documento.publicado_para_cliente', entidade: 'documento', entidadeId: documentoId,
    antes: { visibilidade: 'interno' },
    depois: { visibilidade: 'publicado', titulo: doc.titulo },
  });

  return { ok: true, jaEstava: false };
}

/** Retira um documento do portal. */
export async function despublicarDocumento(
  db: PoolClient, documentoId: string, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string; titulo: string }>(
    'SELECT organizacao_id, titulo FROM documentos WHERE id = $1', [documentoId]);
  const doc = rows[0];
  if (!doc) throw new NaoEncontrado('documento não encontrado');

  await db.query(
    `UPDATE documentos SET visibilidade='interno', publicado_por=NULL, publicado_em=NULL
      WHERE id=$1`, [documentoId]);

  await auditar(db, {
    organizacaoId: doc.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'documento.retirado_do_portal', entidade: 'documento', entidadeId: documentoId,
    depois: { titulo: doc.titulo },
  });

  return { ok: true };
}

/** Documentos visíveis — o RLS já filtra por publicação e portal. */
export async function documentos(db: PoolClient, projetoId: string) {
  const { rows } = await db.query(
    `SELECT id, titulo, categoria, tipo_mime, tamanho_bytes, versao, visibilidade,
            publicado_em, criado_em, tem_arquivo, nome_original
       FROM documentos WHERE projeto_id = $1 ORDER BY criado_em DESC`, [projetoId]);
  return rows;
}

/** Calendário de obrigações do plano, do ponto de vista do cliente. */
export async function obrigacoes(db: PoolClient, projetoId: string, hoje: string) {
  const { rows } = await db.query<{
    numero: number; vencimento: Date; valor: string; juros: string;
    amortizacao: string; saldo_final: string; pago_em: Date | null; credor: string;
  }>(
    `SELECT o.numero, o.vencimento, o.valor, o.juros, o.amortizacao, o.saldo_final,
            o.pago_em, cr.nome AS credor
       FROM obrigacoes o
       JOIN planos pl ON pl.id = o.plano_id
       JOIN creditos c ON c.id = o.credito_id
       JOIN credores cr ON cr.id = c.credor_id
      WHERE pl.projeto_id = $1
      ORDER BY o.vencimento, cr.nome`, [projetoId]);

  const comData = rows.map((r) => ({
    ...r,
    vencimento: r.vencimento.toISOString().slice(0, 10),
    valorFormatado: formatarReais(BigInt(r.valor)),
    pago: r.pago_em !== null,
  }));

  const vencidas = comData.filter((o) => !o.pago && o.vencimento < hoje);
  const total = (lista: typeof comData) =>
    formatarReais(lista.reduce((a, o) => a + BigInt(o.valor), 0n));

  return {
    obrigacoes: comData,
    resumo: {
      total: comData.length,
      pagas: comData.filter((o) => o.pago).length,
      vencidas: vencidas.length,
      valorVencido: total(vencidas),
      valorTotal: total(comData),
    },
  };
}

/** Fluxo de caixa e indicadores da recuperanda (§6.6). */
export async function financeiro(
  db: PoolClient, projetoId: string,
  de: string, ate: string, granularidade: Granularidade,
) {
  const { rows: contas } = await db.query<{ saldo_inicial: string; nome: string; id: string }>(
    'SELECT id, nome, saldo_inicial FROM contas_financeiras WHERE projeto_id = $1', [projetoId]);
  const saldoInicial = contas.reduce((a, c) => a + BigInt(c.saldo_inicial), 0n);

  const { rows } = await db.query<{
    id: string; data: Date; tipo: string; situacao: string; valor: string;
    categoria: string; contraparte: string | null; obrigacao_id: string | null;
  }>(
    `SELECT id, data, tipo, situacao, valor, categoria, contraparte, obrigacao_id
       FROM lancamentos WHERE projeto_id = $1 ORDER BY data`, [projetoId]);

  const lancamentos: Lancamento[] = rows.map((r) => ({
    id: r.id, data: r.data.toISOString().slice(0, 10),
    tipo: r.tipo as Lancamento['tipo'], situacao: r.situacao as Lancamento['situacao'],
    valor: BigInt(r.valor), categoria: r.categoria,
    contraparte: r.contraparte ?? undefined,
    obrigacaoId: r.obrigacao_id ?? undefined,
  }));

  const fluxo = montarFluxo(saldoInicial, lancamentos, de, ate, granularidade);

  // Saldo "atual": inicial mais tudo o que de fato aconteceu até hoje.
  const hoje = new Date().toISOString().slice(0, 10);
  const realizadoAteHoje = lancamentos
    .filter((l) => l.situacao === 'realizado' && l.data <= hoje)
    .reduce((a, l) => a + (l.tipo === 'receita' ? l.valor : -l.valor), 0n);
  const saldoAtual = saldoInicial + realizadoAteHoje;

  const meses = Math.max(1, Math.round(
    (Date.parse(ate) - Date.parse(de)) / (1000 * 60 * 60 * 24 * 30)));

  return {
    contas,
    fluxo: {
      ...fluxo,
      periodos: fluxo.periodos.map((p) => ({
        ...p,
        saldoProjetadoFormatado: formatarReais(p.saldoProjetado),
        saldoRealizadoFormatado: formatarReais(p.saldoRealizado),
      })),
      saldoInicialFormatado: formatarReais(fluxo.saldoInicial),
      saldoFinalProjetadoFormatado: formatarReais(fluxo.saldoFinalProjetado),
      saldoFinalRealizadoFormatado: formatarReais(fluxo.saldoFinalRealizado),
    },
    indicadores: {
      ...calcularIndicadores(saldoAtual, lancamentos, hoje, meses),
      saldoAtualFormatado: formatarReais(saldoAtual),
    },
    totalDeLancamentos: lancamentos.length,
  };
}

/** O cliente lança no próprio caixa. */
export async function lancar(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaLancamento>, identidade: Identidade,
) {
  const idsCliente = identidade.organizacoes.filter((o) => o.tipo === 'cliente').map((o) => o.id);
  const { rows } = await db.query<{ organizacao_cliente_id: string }>(
    `SELECT organizacao_cliente_id FROM portais
      WHERE projeto_id = $1 AND ativo AND mostra_financeiro AND organizacao_cliente_id = ANY($2::uuid[])`,
    [projetoId, idsCliente]);
  if (rows.length !== 1) throw new NaoEncontrado('financeiro não disponível para este vínculo com o projeto');
  const organizacaoCliente = rows[0]!.organizacao_cliente_id;
  if (dados.contaId) {
    const conta = await db.query(
      'SELECT id FROM contas_financeiras WHERE id=$1 AND projeto_id=$2 AND organizacao_id=$3',
      [dados.contaId, projetoId, organizacaoCliente]);
    if (!conta.rowCount) throw new NaoEncontrado('conta não encontrada neste projeto');
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO lancamentos (id, organizacao_id, projeto_id, conta_id, data, tipo,
       situacao, valor, categoria, contraparte, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, organizacaoCliente, projetoId, dados.contaId ?? null, dados.data, dados.tipo,
     dados.situacao, dados.valor, dados.categoria, dados.contraparte ?? null,
     identidade.usuarioId]);

  return { id };
}

/** Mensagens do projeto (§6.5). */
export async function mensagens(db: PoolClient, projetoId: string) {
  const { rows } = await db.query(
    `SELECT m.id, m.lado, m.texto, m.criado_em, m.lida_em, m.requisito_id, u.nome AS autor
       FROM mensagens m LEFT JOIN usuarios u ON u.id = m.autor_id
      WHERE m.projeto_id = $1 ORDER BY m.criado_em DESC LIMIT 200`, [projetoId]);
  return rows;
}

export async function enviarMensagem(
  db: PoolClient, projetoId: string, lado: 'nga' | 'cliente',
  dados: z.infer<typeof EsquemaMensagem>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string }>(
    'SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  const organizacaoId = rows[0]?.organizacao_id;
  if (!organizacaoId) throw new NaoEncontrado('projeto não encontrado');

  if (dados.requisitoId) {
    const req = await db.query('SELECT id FROM requisitos WHERE id = $1 AND projeto_id = $2', [dados.requisitoId, projetoId]);
    if (!req.rows[0]) throw new PedidoInvalido('o item do checklist não pertence a este projeto');
  }
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO mensagens (id, organizacao_id, projeto_id, requisito_id, autor_id, lado, texto)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, organizacaoId, projetoId, dados.requisitoId ?? null, identidade.usuarioId, lado, dados.texto]);

  return { id };
}
