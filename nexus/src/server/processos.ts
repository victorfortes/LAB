/**
 * Serviços de processos, movimentações e prazos.
 *
 * Duas coisas que esta camada faz e que não dá para empurrar para o banco:
 *
 *   - CONFERE O DÍGITO VERIFICADOR do número único antes de gravar. O CHECK da
 *     migração garante a FORMA; o dígito é cálculo, e processo com número
 *     errado é consulta que nunca acha nada e prazo que ninguém vê.
 *   - GUARDA O CÁLCULO INTEIRO DO PRAZO, não só a data. Meses depois, quando
 *     alguém perguntar de onde veio o vencimento, a resposta tem de estar
 *     gravada: os fundamentos, os dias pulados e o motivo de cada um.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import {
  SEGMENTOS, formatarProcesso, partesDoProcesso, validarProcessoCnj,
} from '../domain/analise/identificadores.ts';
import { formatarReais } from '../domain/shared/dinheiro.ts';
import { contarPrazo, diasUteisAte, prazoUsual, type PedidoDePrazo } from '../domain/processo/prazos.ts';
import type { Calendario } from '../domain/processo/feriados.ts';

const NUMERO_CNJ = z.string().min(20).max(25);

export const EsquemaProcesso = z.object({
  numero: NUMERO_CNJ,
  projetoId: z.string().uuid().optional(),
  classe: z.string().max(200).optional(),
  assunto: z.string().max(300).optional(),
  tribunal: z.string().max(60).optional(),
  orgaoJulgador: z.string().max(200).optional(),
  comarca: z.string().max(120).optional(),
  uf: z.string().length(2).optional(),
  juizo: z.string().max(200).optional(),
  valorCausa: z.string().regex(/^\d+$/, 'valor em centavos, só dígitos').optional(),
  distribuidoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  segredoJustica: z.boolean().default(false),
});

export const EsquemaSituacao = z.object({
  situacao: z.enum(['ativo', 'suspenso', 'baixado', 'arquivado', 'extinto']),
  motivo: z.string().max(500).optional(),
  suspensoAte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const EsquemaParte = z.object({
  nome: z.string().min(1).max(300),
  documento: z.string().max(20).optional(),
  tipoDocumento: z.enum(['cnpj', 'cpf']).optional(),
  polo: z.enum(['ativo', 'passivo', 'terceiro']),
  papel: z.string().max(120).optional(),
  ehCliente: z.boolean().default(false),
});

export const EsquemaMovimentacao = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  titulo: z.string().min(1).max(300),
  conteudo: z.string().max(20000).optional(),
  codigoCnj: z.number().int().positive().optional(),
  externoId: z.string().max(200).optional(),
});

export const EsquemaPublicacao = z.object({
  /** O texto que o cliente lê. Escrito por gente (§6.3). */
  resumo: z.string().min(10).max(2000),
});

export const EsquemaPrazo = z.object({
  titulo: z.string().min(1).max(200).optional(),
  /** Id do catálogo (`habilitacao`, `embargos`…), que preenche dias e regime. */
  tipo: z.string().max(40).optional(),
  evento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origem: z.enum(['disponibilizacao_dje', 'publicacao', 'intimacao_pessoal',
    'juntada_ar', 'citacao', 'audiencia', 'manual']).optional(),
  dias: z.number().int().positive().max(3650).optional(),
  regime: z.enum(['uteis', 'corridos']).optional(),
  emDobro: z.boolean().default(false),
  motivoDoDobro: z.string().max(200).optional(),
  movimentacaoId: z.string().uuid().optional(),
  responsavelId: z.string().uuid().optional(),
  feriadosLocais: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).optional(),
  suspensoes: z.array(z.object({
    de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    motivo: z.string().min(1).max(200),
  })).max(20).optional(),
});

export const EsquemaFechamento = z.object({
  situacao: z.enum(['cumprido', 'perdido', 'cancelado']),
  observacao: z.string().max(1000).optional(),
});

// ------------------------------------------------------------- processos ---

export async function criar(
  db: PoolClient, dados: z.infer<typeof EsquemaProcesso>, identidade: Identidade,
) {
  if (!validarProcessoCnj(dados.numero)) {
    const p = partesDoProcesso(dados.numero);
    throw new PedidoInvalido(
      p
        ? `o dígito verificador do número não confere (a forma está certa, o dígito não)`
        : 'número fora do padrão do CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO)');
  }
  const numero = formatarProcesso(dados.numero);

  const organizacaoId = identidade.organizacoes.find((o) => o.tipo === 'escritorio')?.id;
  if (!organizacaoId) throw new PedidoInvalido('usuário não pertence ao escritório');

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO processos (organizacao_id, projeto_id, numero, classe, assunto, tribunal,
       orgao_julgador, comarca, uf, juizo, valor_causa, distribuido_em, segredo_justica, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [organizacaoId, dados.projetoId ?? null, numero, dados.classe ?? null,
     dados.assunto ?? null, dados.tribunal ?? null, dados.orgaoJulgador ?? null,
     dados.comarca ?? null, dados.uf?.toUpperCase() ?? null, dados.juizo ?? null,
     dados.valorCausa ?? null, dados.distribuidoEm ?? null, dados.segredoJustica,
     identidade.usuarioId]);
  const id = rows[0]!.id;

  await auditar(db, {
    organizacaoId, usuarioId: identidade.usuarioId, acao: 'processo.criado',
    entidade: 'processo', entidadeId: id, depois: { ...dados, numero },
  });

  return { id, numero, segmento: segmentoDe(numero) };
}

function segmentoDe(numero: string): string | undefined {
  const p = partesDoProcesso(numero);
  return p ? SEGMENTOS[p.segmento] : undefined;
}

export async function listar(db: PoolClient, hoje: string, projetoId?: string) {
  const { rows } = await db.query(
    `SELECT p.id, p.numero, p.classe, p.assunto, p.tribunal, p.comarca, p.uf,
            p.situacao, p.suspenso_motivo, p.suspenso_ate, p.segredo_justica,
            p.valor_causa, p.distribuido_em, p.projeto_id, pr.nome AS projeto,
            (SELECT count(*) FROM movimentacoes m WHERE m.processo_id = p.id) AS movimentacoes,
            (SELECT count(*) FROM prazos z WHERE z.processo_id = p.id AND z.situacao = 'aberto')
              AS prazos_abertos,
            (SELECT min(z.vencimento) FROM prazos z
              WHERE z.processo_id = p.id AND z.situacao = 'aberto') AS proximo_vencimento
       FROM processos p LEFT JOIN projetos pr ON pr.id = p.projeto_id
      WHERE ($1::uuid IS NULL OR p.projeto_id = $1)
      ORDER BY p.situacao, p.numero`, [projetoId ?? null]);

  return rows.map((r) => {
    const linha = r as {
      valor_causa: string | null; proximo_vencimento: Date | null; numero: string;
    };
    return {
      ...r,
      segmento: segmentoDe(linha.numero),
      valorFormatado: linha.valor_causa ? formatarReais(BigInt(linha.valor_causa)) : null,
      diasUteisAteOProximo: linha.proximo_vencimento
        ? diasUteisAte(hoje, linha.proximo_vencimento.toISOString().slice(0, 10))
        : null,
    };
  });
}

export async function detalhe(db: PoolClient, processoId: string, hoje: string) {
  const { rows } = await db.query(
    `SELECT p.*, pr.nome AS projeto FROM processos p
       LEFT JOIN projetos pr ON pr.id = p.projeto_id WHERE p.id = $1`, [processoId]);
  const processo = rows[0];
  if (!processo) throw new NaoEncontrado('processo não encontrado');

  const { rows: partes } = await db.query(
    `SELECT id, nome, documento, tipo_documento, polo, papel, eh_cliente
       FROM partes_processo WHERE processo_id = $1 ORDER BY polo, nome`, [processoId]);

  const { rows: movimentacoes } = await db.query(
    `SELECT m.id, m.data, m.titulo, m.conteudo, m.codigo_cnj, m.fonte,
            m.visivel_ao_cliente, m.resumo_ao_cliente, m.publicado_em,
            u.nome AS publicado_por_nome
       FROM movimentacoes m LEFT JOIN usuarios u ON u.id = m.publicado_por
      WHERE m.processo_id = $1 ORDER BY m.data DESC, m.criado_em DESC`, [processoId]);

  // O cliente não alcança prazo (migração 014): para ele esta consulta volta
  // vazia, sem que a rota precise saber quem está pedindo.
  const { rows: prazos } = await db.query(
    `SELECT z.id, z.titulo, z.tipo, z.evento, z.origem, z.dias, z.regime, z.em_dobro,
            z.vencimento, z.situacao, z.calculo, z.observacao, u.nome AS responsavel
       FROM prazos z LEFT JOIN usuarios u ON u.id = z.responsavel_id
      WHERE z.processo_id = $1 ORDER BY z.vencimento`, [processoId]);

  const numero = (processo as { numero: string }).numero;
  const valor = (processo as { valor_causa: string | null }).valor_causa;

  return {
    ...processo,
    segmento: segmentoDe(numero),
    valorFormatado: valor ? formatarReais(BigInt(valor)) : null,
    partes,
    movimentacoes,
    prazos: prazos.map((z) => {
      const l = z as { vencimento: Date; situacao: string };
      return {
        ...z,
        diasUteisRestantes: l.situacao === 'aberto'
          ? diasUteisAte(hoje, l.vencimento.toISOString().slice(0, 10))
          : null,
      };
    }),
  };
}

export async function mudarSituacao(
  db: PoolClient, processoId: string,
  dados: z.infer<typeof EsquemaSituacao>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string; situacao: string; numero: string }>(
    'SELECT organizacao_id, situacao, numero FROM processos WHERE id = $1', [processoId]);
  const atual = rows[0];
  if (!atual) throw new NaoEncontrado('processo não encontrado');
  if (dados.situacao === 'suspenso' && !dados.motivo) {
    throw new PedidoInvalido(
      'processo suspenso precisa de motivo: sem ele, a lista de suspensos vira ' +
      'um conjunto de casos que ninguém sabe por que parou');
  }

  await db.query(
    `UPDATE processos SET situacao = $2, suspenso_motivo = $3, suspenso_ate = $4,
            atualizado_em = now() WHERE id = $1`,
    [processoId, dados.situacao,
     dados.situacao === 'suspenso' ? dados.motivo! : null,
     dados.situacao === 'suspenso' ? dados.suspensoAte ?? null : null]);

  await auditar(db, {
    organizacaoId: atual.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'processo.situacao_alterada', entidade: 'processo', entidadeId: processoId,
    antes: { situacao: atual.situacao },
    depois: { situacao: dados.situacao, motivo: dados.motivo, ate: dados.suspensoAte },
  });

  return { id: processoId, situacao: dados.situacao };
}

// ---------------------------------------------------------------- partes ---

export async function adicionarParte(
  db: PoolClient, processoId: string,
  dados: z.infer<typeof EsquemaParte>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string }>(
    'SELECT organizacao_id FROM processos WHERE id = $1', [processoId]);
  const processo = rows[0];
  if (!processo) throw new NaoEncontrado('processo não encontrado');

  const { rows: criadas } = await db.query<{ id: string }>(
    `INSERT INTO partes_processo (processo_id, organizacao_id, nome, documento,
       tipo_documento, polo, papel, eh_cliente)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [processoId, processo.organizacao_id, dados.nome, dados.documento ?? null,
     dados.tipoDocumento ?? null, dados.polo, dados.papel ?? null, dados.ehCliente]);

  await auditar(db, {
    organizacaoId: processo.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'processo.parte_adicionada', entidade: 'processo', entidadeId: processoId,
    depois: dados,
  });

  return { id: criadas[0]!.id };
}

// --------------------------------------------------------- movimentações ---

export async function registrarMovimentacao(
  db: PoolClient, processoId: string,
  dados: z.infer<typeof EsquemaMovimentacao>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string }>(
    'SELECT organizacao_id FROM processos WHERE id = $1', [processoId]);
  const processo = rows[0];
  if (!processo) throw new NaoEncontrado('processo não encontrado');

  const { rows: criadas } = await db.query<{ id: string }>(
    `INSERT INTO movimentacoes (processo_id, organizacao_id, data, titulo, conteudo,
       codigo_cnj, externo_id, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [processoId, processo.organizacao_id, dados.data, dados.titulo,
     dados.conteudo ?? null, dados.codigoCnj ?? null, dados.externoId ?? null,
     identidade.usuarioId]);

  await auditar(db, {
    organizacaoId: processo.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'processo.movimentacao_registrada', entidade: 'movimentacao',
    entidadeId: criadas[0]!.id, depois: { processoId, ...dados },
  });

  // Nasce invisível ao cliente — ver a migração 013.
  return { id: criadas[0]!.id, visivelAoCliente: false };
}

/**
 * Publica a movimentação no portal, com o resumo escrito por quem publica.
 *
 * É a única porta de saída de andamento processual para o cliente, e usa a
 * mesma permissão que publicar documento. O resumo é obrigatório: despejar o
 * andamento cru no portal não é traduzir nada (§6.3).
 */
export async function publicarMovimentacao(
  db: PoolClient, movimentacaoId: string,
  dados: z.infer<typeof EsquemaPublicacao>, identidade: Identidade,
) {
  const { rows } = await db.query<{
    organizacao_id: string; titulo: string; visivel_ao_cliente: boolean;
  }>('SELECT organizacao_id, titulo, visivel_ao_cliente FROM movimentacoes WHERE id = $1',
    [movimentacaoId]);
  const mov = rows[0];
  if (!mov) throw new NaoEncontrado('movimentação não encontrada');

  await db.query(
    `UPDATE movimentacoes SET visivel_ao_cliente = TRUE, resumo_ao_cliente = $2,
            publicado_por = $3, publicado_em = now() WHERE id = $1`,
    [movimentacaoId, dados.resumo, identidade.usuarioId]);

  await auditar(db, {
    organizacaoId: mov.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'processo.movimentacao_publicada', entidade: 'movimentacao',
    entidadeId: movimentacaoId,
    antes: { visivel: mov.visivel_ao_cliente },
    depois: { visivel: true, resumo: dados.resumo, titulo: mov.titulo },
  });

  return { id: movimentacaoId, visivelAoCliente: true };
}

export async function despublicarMovimentacao(
  db: PoolClient, movimentacaoId: string, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string; titulo: string }>(
    'SELECT organizacao_id, titulo FROM movimentacoes WHERE id = $1', [movimentacaoId]);
  const mov = rows[0];
  if (!mov) throw new NaoEncontrado('movimentação não encontrada');

  await db.query(
    `UPDATE movimentacoes SET visivel_ao_cliente = FALSE, resumo_ao_cliente = NULL,
            publicado_por = NULL, publicado_em = NULL WHERE id = $1`, [movimentacaoId]);

  await auditar(db, {
    organizacaoId: mov.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'processo.movimentacao_despublicada', entidade: 'movimentacao',
    entidadeId: movimentacaoId, depois: { visivel: false, titulo: mov.titulo },
  });

  return { id: movimentacaoId, visivelAoCliente: false };
}

// ---------------------------------------------------------------- prazos ---

export async function criarPrazo(
  db: PoolClient, processoId: string,
  dados: z.infer<typeof EsquemaPrazo>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string; numero: string }>(
    'SELECT organizacao_id, numero FROM processos WHERE id = $1', [processoId]);
  const processo = rows[0];
  if (!processo) throw new NaoEncontrado('processo não encontrado');

  // O catálogo preenche o que não veio; digitar "15" onde a lei diz 10 é o
  // erro que ele existe para evitar.
  const usual = dados.tipo ? prazoUsual(dados.tipo) : undefined;
  if (dados.tipo && !usual) {
    throw new PedidoInvalido(`tipo de prazo desconhecido: ${dados.tipo}`);
  }

  const dias = dados.dias ?? usual?.dias;
  if (!dias) throw new PedidoInvalido('informe os dias ou um tipo do catálogo');

  const calendario: Calendario = {
    ...(dados.feriadosLocais ? { feriadosLocais: dados.feriadosLocais } : {}),
    ...(dados.suspensoes ? { suspensoes: dados.suspensoes } : {}),
  };
  const pedido: PedidoDePrazo = {
    evento: dados.evento,
    origem: dados.origem ?? usual?.origemUsual ?? 'publicacao',
    dias,
    regime: dados.regime ?? usual?.regime ?? 'uteis',
    emDobro: dados.emDobro,
    ...(dados.motivoDoDobro ? { motivoDoDobro: dados.motivoDoDobro } : {}),
    calendario,
  };
  const calculo = contarPrazo(pedido);
  const titulo = dados.titulo ?? usual?.nome ?? 'Prazo';

  const { rows: criados } = await db.query<{ id: string }>(
    `INSERT INTO prazos (processo_id, organizacao_id, movimentacao_id, titulo, tipo,
       evento, origem, dias, regime, em_dobro, vencimento, calculo, responsavel_id, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [processoId, processo.organizacao_id, dados.movimentacaoId ?? null, titulo,
     dados.tipo ?? null, pedido.evento, pedido.origem, calculo.dias, pedido.regime,
     dados.emDobro, calculo.vencimento,
     JSON.stringify({ ...calculo, fundamentoLegal: usual?.fundamento ?? null }),
     dados.responsavelId ?? identidade.usuarioId, identidade.usuarioId]);

  await auditar(db, {
    organizacaoId: processo.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'prazo.criado', entidade: 'prazo', entidadeId: criados[0]!.id,
    depois: {
      processo: processo.numero, titulo, vencimento: calculo.vencimento,
      evento: pedido.evento, origem: pedido.origem, dias: calculo.dias,
    },
  });

  return {
    id: criados[0]!.id, titulo, ...calculo,
    fundamentoLegal: usual?.fundamento ?? null,
    observacaoDoCatalogo: usual?.observacao ?? null,
  };
}

export async function fecharPrazo(
  db: PoolClient, prazoId: string,
  dados: z.infer<typeof EsquemaFechamento>, identidade: Identidade,
) {
  const { rows } = await db.query<{
    organizacao_id: string; titulo: string; situacao: string; vencimento: Date;
  }>('SELECT organizacao_id, titulo, situacao, vencimento FROM prazos WHERE id = $1', [prazoId]);
  const prazo = rows[0];
  if (!prazo) throw new NaoEncontrado('prazo não encontrado');
  if (prazo.situacao !== 'aberto') {
    throw new PedidoInvalido(`este prazo já está "${prazo.situacao}"`);
  }

  await db.query(
    `UPDATE prazos SET situacao = $2, cumprido_em = now(), observacao = $3 WHERE id = $1`,
    [prazoId, dados.situacao, dados.observacao ?? null]);

  await auditar(db, {
    organizacaoId: prazo.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'prazo.fechado', entidade: 'prazo', entidadeId: prazoId,
    antes: { situacao: 'aberto' },
    depois: {
      situacao: dados.situacao, titulo: prazo.titulo,
      vencimento: prazo.vencimento.toISOString().slice(0, 10),
      observacao: dados.observacao,
    },
  });

  return { id: prazoId, situacao: dados.situacao };
}

/**
 * Agenda da controladoria: prazos abertos, do mais urgente ao menos.
 *
 * Vencidos vêm primeiro e marcados — um prazo aberto com vencimento no
 * passado é o achado mais importante que esta tela pode mostrar.
 */
export async function agenda(db: PoolClient, hoje: string, ate: string) {
  const { rows } = await db.query(
    `SELECT z.id, z.titulo, z.tipo, z.vencimento, z.regime, z.dias, z.em_dobro,
            p.id AS processo_id, p.projeto_id, p.numero, p.classe, p.comarca, p.uf,
            pr.nome AS projeto, u.nome AS responsavel
       FROM prazos z
       JOIN processos p ON p.id = z.processo_id
       LEFT JOIN projetos pr ON pr.id = p.projeto_id
       LEFT JOIN usuarios u ON u.id = z.responsavel_id
      WHERE z.situacao = 'aberto' AND z.vencimento <= $1
      ORDER BY z.vencimento`, [ate]);

  const itens = rows.map((r) => {
    const l = r as { vencimento: Date };
    const vencimento = l.vencimento.toISOString().slice(0, 10);
    const restantes = diasUteisAte(hoje, vencimento);
    return { ...r, vencimento, diasUteisRestantes: restantes, vencido: restantes < 0 };
  });

  return {
    hoje,
    ate,
    itens,
    vencidos: itens.filter((i) => i.vencido).length,
    venceHoje: itens.filter((i) => i.diasUteisRestantes === 0).length,
    // A contagem vale o que vale o calendário: ver as ressalvas do cálculo.
    ressalva:
      'Os vencimentos não consideram feriado estadual ou municipal nem suspensão ' +
      'do tribunal. Confira o calendário da comarca antes de confiar na data.',
  };
}
