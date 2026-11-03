/**
 * Recepção do que as aplicações do NGA Lab produzem.
 *
 * A decisão foi mantê-las separadas e integrar por ARTEFATO. Este arquivo é o
 * lado receptor desse contrato: o Sentinela entrega processo e movimentação,
 * o NGA Prazos entrega prazo lido do Astrea, o Íntegra entrega as partes do
 * PDF dos autos. Nenhum deles precisa saber como o Nexus guarda nada.
 *
 * DUAS REGRAS QUE ATRAVESSAM AS TRÊS ENTRADAS
 *
 * IDEMPOTÊNCIA. Robô roda de novo — por reinício, por retentativa, porque
 * alguém clicou duas vezes. Toda entrega traz identificador de origem, e
 * reentregar o mesmo item não duplica: devolve "repetido". Sem isso, a
 * primeira falha de rede vira quadro de movimentações em dobro.
 *
 * NADA CHEGA AO CLIENTE POR AQUI. Movimentação entregue por robô nasce
 * invisível, como qualquer outra (migração 013), e o papel `integracao` não
 * tem `portal.publicar`. Publicar continua sendo ato de pessoa, com resumo
 * escrito por pessoa (§6.3) — um robô não decide o que o cliente lê.
 *
 * O QUE NÃO FOI EXERCITADO: nenhuma das três aplicações chama estas rotas
 * ainda. O contrato está construído e testado do lado de cá; ligar cada uma
 * delas é trabalho dentro de cada repositório, e enquanto não acontecer a
 * integração não pode ser declarada funcionando (§22).
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { hashDoToken } from '../security/sessao.ts';
import {
  type Escopo, type Integracao, ESCOPOS, tokenDeIntegracao,
} from '../security/integracao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { formatarProcesso, validarProcessoCnj } from '../domain/analise/identificadores.ts';
import { contarPrazo } from '../domain/processo/prazos.ts';
import { prazoUsual } from '../domain/processo/prazos.ts';

// ----------------------------------------------------------- administração ---

export const EsquemaNovaIntegracao = z.object({
  nome: z.string().min(3).max(80),
  aplicacao: z.enum(['sentinela', 'integra', 'prazos', 'outra']),
  escopos: z.array(z.enum(['processos', 'prazos', 'documentos'])).min(1),
});

/**
 * Cria a credencial e o usuário de serviço sob o qual ela roda.
 *
 * O usuário de serviço existe para que a ingestão passe pelo RLS como
 * qualquer requisição humana. Ele tem senha, mas uma que ninguém conhece:
 * um segredo aleatório que é descartado aqui mesmo. Entrar por `/api/sessao`
 * com essa conta é impossível, e não por regra de aplicação — por não haver
 * senha a digitar.
 */
export async function criar(
  db: PoolClient, dados: z.infer<typeof EsquemaNovaIntegracao>, identidade: Identidade,
) {
  const organizacaoId = identidade.organizacoes.find((o) => o.tipo === 'escritorio')?.id;
  if (!organizacaoId) throw new PedidoInvalido('usuário não pertence ao escritório');

  const apelido = dados.nome.toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const email = `integracao+${apelido}-${crypto.randomUUID().slice(0, 8)}@nga.local`;

  const segredoDescartado = crypto.randomUUID() + crypto.randomUUID();
  const senhaHash = await Bun.password.hash(segredoDescartado, { algorithm: 'argon2id' });

  // `usuarios` não aceita INSERT por papel comum, e está certo: a criação
  // passa pela função de superfície mínima da migração 016, que só sabe criar
  // conta de serviço com papel `integracao` e e-mail no domínio reservado.
  const { rows: usuarios } = await db.query<{ criar_usuario_de_servico: string }>(
    'SELECT criar_usuario_de_servico($1,$2,$3,$4)',
    [email, `${dados.nome} (integração)`, senhaHash, organizacaoId]);
  const usuarioId = usuarios[0]!.criar_usuario_de_servico;

  const token = tokenDeIntegracao();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO integracoes (organizacao_id, usuario_id, nome, aplicacao, escopos,
       token_hash, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [organizacaoId, usuarioId, dados.nome, dados.aplicacao, dados.escopos,
     hashDoToken(token), identidade.usuarioId]);

  await auditar(db, {
    organizacaoId, usuarioId: identidade.usuarioId, acao: 'integracao.criada',
    entidade: 'integracao', entidadeId: rows[0]!.id,
    depois: { nome: dados.nome, aplicacao: dados.aplicacao, escopos: dados.escopos },
  });

  return {
    id: rows[0]!.id,
    nome: dados.nome,
    aplicacao: dados.aplicacao,
    escopos: dados.escopos,
    // Aparece uma vez. Não há como lê-lo depois, porque só o hash fica.
    token,
    aviso:
      'Guarde este token agora: ele não é exibido outra vez. Perdido, revogue ' +
      'esta credencial e crie outra.',
  };
}

export async function listar(db: PoolClient) {
  const { rows } = await db.query(
    `SELECT i.id, i.nome, i.aplicacao, i.escopos, i.criado_em, i.ultimo_uso_em,
            i.usos, i.revogada_em, u.nome AS criado_por
       FROM integracoes i LEFT JOIN usuarios u ON u.id = i.criado_por
      ORDER BY i.revogada_em NULLS FIRST, i.nome`);
  return rows.map((r) => {
    const l = r as { revogada_em: Date | null; ultimo_uso_em: Date | null; usos: number };
    return {
      ...r,
      ativa: l.revogada_em === null,
      // Credencial que nunca entregou nada é credencial a revogar.
      nuncaUsada: l.ultimo_uso_em === null,
    };
  });
}

export async function revogar(db: PoolClient, id: string, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; nome: string; revogada_em: Date | null }>(
    'SELECT organizacao_id, nome, revogada_em FROM integracoes WHERE id = $1', [id]);
  const i = rows[0];
  if (!i) throw new NaoEncontrado('integração não encontrada');
  if (i.revogada_em) throw new PedidoInvalido('esta credencial já está revogada');

  await db.query(
    'UPDATE integracoes SET revogada_em = now(), revogada_por = $2 WHERE id = $1',
    [id, identidade.usuarioId]);

  await auditar(db, {
    organizacaoId: i.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'integracao.revogada', entidade: 'integracao', entidadeId: id,
    depois: { nome: i.nome },
  });

  return { id, revogada: true };
}

export function contrato() {
  return {
    escopos: ESCOPOS,
    entradas: [
      {
        escopo: 'processos',
        rota: 'POST /api/integracao/processos',
        aplicacao: 'NGA Sentinela',
        descricao:
          'Entrega processo e movimentação. A movimentação nasce invisível ao ' +
          'cliente; publicar continua sendo ato de pessoa, com resumo escrito. ' +
          'Do lado do Sentinela, só sai correspondência confirmada por pessoa.',
        idempotencia: 'por `externoId` de cada movimentação, e pelo número do processo.',
      },
      {
        escopo: 'prazos',
        rota: 'POST /api/integracao/prazos',
        aplicacao: 'NGA Prazos (Astrea)',
        descricao:
          'Entrega prazo de processo já cadastrado. O vencimento é recalculado ' +
          'aqui pelas regras do CPC, com as mesmas ressalvas de calendário.',
        idempotencia: 'prazo aberto com mesmo processo, título e evento não duplica.',
      },
      {
        escopo: 'documentos',
        rota: 'POST /api/integracao/documentos',
        aplicacao: 'NGA Íntegra',
        descricao:
          'Entrega arquivo (multipart) vinculado a um processo já cadastrado. ' +
          'Vai para o acervo endereçado por conteúdo, como qualquer documento.',
        idempotencia: 'conteúdo idêntico é deduplicado pelo hash no acervo.',
      },
    ],
    estado: {
      sentinela:
        'Ligado. O comando `sentinela nexus-enviar` entrega o que foi confirmado por ' +
        'pessoa, e a entrega foi exercitada de ponta a ponta contra este servidor.',
      prazos: 'Não ligado: o nga-prazos ainda não chama a rota de prazos.',
      integra: 'Não ligado: o Íntegra ainda não chama a rota de documentos.',
    },
    naoExercitado:
      'Duas das três aplicações ainda não chamam estas rotas. O Sentinela já chama; ' +
      'ligar o NGA Prazos e o Íntegra é trabalho dentro do repositório de cada um.',
  };
}

// ------------------------------------------------- recepção de processos ---

const EsquemaMovimentacaoRecebida = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  titulo: z.string().min(1).max(300),
  conteudo: z.string().max(20000).optional(),
  codigoCnj: z.number().int().positive().optional(),
  /** Identificador na origem. É o que impede duplicata na reentrega. */
  externoId: z.string().min(1).max(200),
});

export const EsquemaProcessosRecebidos = z.object({
  processos: z.array(z.object({
    numero: z.string().min(20).max(25),
    classe: z.string().max(200).optional(),
    assunto: z.string().max(300).optional(),
    tribunal: z.string().max(60).optional(),
    comarca: z.string().max(120).optional(),
    uf: z.string().length(2).optional(),
    distribuidoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    projetoId: z.string().uuid().optional(),
    movimentacoes: z.array(EsquemaMovimentacaoRecebida).max(500).default([]),
  })).min(1).max(100),
});

export interface ResultadoDaEntrega {
  readonly criados: number;
  readonly atualizados: number;
  readonly repetidos: number;
  readonly recusados: ReadonlyArray<{ item: string; motivo: string }>;
}

export async function receberProcessos(
  db: PoolClient, integracao: Integracao,
  dados: z.infer<typeof EsquemaProcessosRecebidos>,
) {
  let criados = 0, atualizados = 0, movimentacoesCriadas = 0, repetidos = 0;
  const recusados: Array<{ item: string; motivo: string }> = [];

  for (const p of dados.processos) {
    if (!validarProcessoCnj(p.numero)) {
      // Número com dígito errado não entra: processo que ninguém acha é pior
      // do que processo que falta.
      recusados.push({ item: p.numero, motivo: 'dígito verificador do número não confere' });
      continue;
    }
    const numero = formatarProcesso(p.numero);

    const { rows: existentes } = await db.query<{ id: string }>(
      'SELECT id FROM processos WHERE organizacao_id = $1 AND numero = $2',
      [integracao.organizacaoId, numero]);

    let processoId = existentes[0]?.id;
    if (processoId) {
      // Reentrega atualiza o que a fonte conhece e não apaga o que foi
      // preenchido à mão: COALESCE mantém o valor existente.
      await db.query(
        `UPDATE processos SET classe = coalesce($2, classe), assunto = coalesce($3, assunto),
                tribunal = coalesce($4, tribunal), comarca = coalesce($5, comarca),
                uf = coalesce($6, uf), distribuido_em = coalesce($7, distribuido_em),
                atualizado_em = now()
          WHERE id = $1`,
        [processoId, p.classe ?? null, p.assunto ?? null, p.tribunal ?? null,
         p.comarca ?? null, p.uf?.toUpperCase() ?? null, p.distribuidoEm ?? null]);
      atualizados++;
    } else {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO processos (organizacao_id, projeto_id, numero, classe, assunto,
           tribunal, comarca, uf, distribuido_em, fonte, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [integracao.organizacaoId, p.projetoId ?? null, numero, p.classe ?? null,
         p.assunto ?? null, p.tribunal ?? null, p.comarca ?? null,
         p.uf?.toUpperCase() ?? null, p.distribuidoEm ?? null,
         integracao.aplicacao === 'sentinela' ? 'djen' : 'astrea', integracao.usuarioId]);
      processoId = rows[0]!.id;
      criados++;
    }

    for (const m of p.movimentacoes) {
      // `ON CONFLICT DO NOTHING` sobre o índice único (processo, fonte,
      // externo_id): a reentrega não duplica, e o retorno diz quantas vieram
      // repetidas em vez de fingir que gravou.
      const { rowCount } = await db.query(
        `INSERT INTO movimentacoes (processo_id, organizacao_id, data, titulo, conteudo,
           codigo_cnj, fonte, externo_id, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (processo_id, fonte, externo_id) DO NOTHING`,
        [processoId, integracao.organizacaoId, m.data, m.titulo, m.conteudo ?? null,
         m.codigoCnj ?? null, integracao.aplicacao === 'sentinela' ? 'djen' : 'astrea',
         m.externoId, integracao.usuarioId]);
      if (rowCount === 0) repetidos++; else movimentacoesCriadas++;
    }
  }

  await auditar(db, {
    organizacaoId: integracao.organizacaoId, usuarioId: integracao.usuarioId,
    acao: 'integracao.processos_recebidos', entidade: 'integracao', entidadeId: integracao.id,
    depois: { integracao: integracao.nome, criados, atualizados, movimentacoesCriadas, repetidos, recusados },
    origem: 'integracao',
  });

  return { criados, atualizados, movimentacoesCriadas, repetidos, recusados };
}

// ---------------------------------------------------- recepção de prazos ---

export const EsquemaPrazosRecebidos = z.object({
  prazos: z.array(z.object({
    numeroProcesso: z.string().min(20).max(25),
    titulo: z.string().min(1).max(200),
    tipo: z.string().max(40).optional(),
    evento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    origem: z.enum(['disponibilizacao_dje', 'publicacao', 'intimacao_pessoal',
      'juntada_ar', 'citacao', 'audiencia', 'manual']).default('disponibilizacao_dje'),
    dias: z.number().int().positive().max(3650).optional(),
    regime: z.enum(['uteis', 'corridos']).optional(),
    externoId: z.string().max(200).optional(),
  })).min(1).max(200),
});

export async function receberPrazos(
  db: PoolClient, integracao: Integracao,
  dados: z.infer<typeof EsquemaPrazosRecebidos>,
) {
  let criados = 0, repetidos = 0;
  const recusados: Array<{ item: string; motivo: string }> = [];

  for (const z of dados.prazos) {
    if (!validarProcessoCnj(z.numeroProcesso)) {
      recusados.push({ item: z.numeroProcesso, motivo: 'dígito verificador do número não confere' });
      continue;
    }
    const numero = formatarProcesso(z.numeroProcesso);

    const { rows: processos } = await db.query<{ id: string }>(
      'SELECT id FROM processos WHERE organizacao_id = $1 AND numero = $2',
      [integracao.organizacaoId, numero]);
    const processoId = processos[0]?.id;
    if (!processoId) {
      // Não se cria processo a partir de um prazo: o vínculo errado espalha
      // prazo em caso que não é o do cliente. A falta volta nomeada.
      recusados.push({ item: numero, motivo: 'processo não cadastrado nesta organização' });
      continue;
    }

    const usual = z.tipo ? prazoUsual(z.tipo) : undefined;
    const dias = z.dias ?? usual?.dias;
    if (!dias) {
      recusados.push({ item: `${numero} · ${z.titulo}`, motivo: 'sem dias e sem tipo conhecido' });
      continue;
    }

    // O vencimento é recalculado AQUI, pelas regras do CPC, e não aceito como
    // veio: a fonte não conhece o recesso nem a prorrogação do art. 224, § 1º.
    const calculo = contarPrazo({
      evento: z.evento, origem: z.origem, dias,
      regime: z.regime ?? usual?.regime ?? 'uteis',
    });

    const { rows: jaExiste } = await db.query<{ id: string }>(
      `SELECT id FROM prazos
        WHERE processo_id = $1 AND titulo = $2 AND evento = $3 AND situacao = 'aberto'`,
      [processoId, z.titulo, z.evento]);
    if (jaExiste[0]) { repetidos++; continue; }

    await db.query(
      `INSERT INTO prazos (processo_id, organizacao_id, titulo, tipo, evento, origem,
         dias, regime, vencimento, calculo, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [processoId, integracao.organizacaoId, z.titulo, z.tipo ?? null, z.evento, z.origem,
       calculo.dias, calculo.regime, calculo.vencimento,
       JSON.stringify({
         ...calculo,
         fundamentoLegal: usual?.fundamento ?? null,
         recebidoDe: integracao.nome,
         externoId: z.externoId ?? null,
       }),
       integracao.usuarioId]);
    criados++;
  }

  await auditar(db, {
    organizacaoId: integracao.organizacaoId, usuarioId: integracao.usuarioId,
    acao: 'integracao.prazos_recebidos', entidade: 'integracao', entidadeId: integracao.id,
    depois: { integracao: integracao.nome, criados, repetidos, recusados },
    origem: 'integracao',
  });

  return { criados, repetidos, recusados };
}

/** Resolve o projeto a partir do número do processo, para o Íntegra. */
export async function projetoDoProcesso(
  db: PoolClient, organizacaoId: string, numeroProcesso: string,
): Promise<{ projetoId: string; processoId: string }> {
  if (!validarProcessoCnj(numeroProcesso)) {
    throw new PedidoInvalido('dígito verificador do número do processo não confere');
  }
  const { rows } = await db.query<{ id: string; projeto_id: string | null }>(
    'SELECT id, projeto_id FROM processos WHERE organizacao_id = $1 AND numero = $2',
    [organizacaoId, formatarProcesso(numeroProcesso)]);
  const processo = rows[0];
  if (!processo) throw new NaoEncontrado('processo não cadastrado nesta organização');
  if (!processo.projeto_id) {
    throw new PedidoInvalido(
      'o processo existe mas não está vinculado a projeto algum: sem projeto não há ' +
      'onde guardar o documento');
  }
  return { projetoId: processo.projeto_id, processoId: processo.id };
}

export { type Escopo };
