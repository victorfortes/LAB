/**
 * Montagem dos relatórios a partir do que está gravado (§15).
 *
 * A regra que organiza este arquivo: TODO número sai de uma consulta, e toda
 * seção sem dado diz que não tem. Não há valor padrão, não há zero de
 * enfeite, não há indicador preenchido para a página ficar bonita. Quando a
 * consulta volta vazia, o relatório escreve a frase correspondente e a falta
 * sobe para a lista "O que este relatório não afirma", impressa no fim.
 *
 * E há uma recusa que vale explicar: o quadro de credores usa SOMENTE crédito
 * com classe validada por pessoa. Classe sugerida por máquina não entra em
 * quadro de credores — é o §7.7 aplicado ao papel timbrado. Os pendentes
 * aparecem contados à parte, para ninguém somar errado por engano.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Construtor, type Relatorio, renderizar } from '../relatorio/modelo.ts';
import type { Coluna } from '../relatorio/folha.ts';
import { formatarReais } from '../domain/shared/dinheiro.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import type { Identidade } from '../security/sessao.ts';

export const TIPOS_DE_RELATORIO = ['acompanhamento', 'credores'] as const;
export type TipoDeRelatorio = (typeof TIPOS_DE_RELATORIO)[number];

export const EsquemaGeracao = z.object({
  tipo: z.enum(TIPOS_DE_RELATORIO),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const dataBR = (d: Date | string | null): string =>
  (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—');

const reais = (v: string | number | null): string =>
  (v === null ? '—' : formatarReais(BigInt(v)));

/** Mês fechado anterior, que é o período natural de um relatório mensal. */
export function periodoPadrao(hoje = new Date()): { de: string; ate: string } {
  const ano = hoje.getUTCFullYear();
  const mes = hoje.getUTCMonth();            // 0-11; o mês anterior é `mes - 1`
  const inicio = new Date(Date.UTC(ano, mes - 1, 1));
  const fim = new Date(Date.UTC(ano, mes, 0));
  return { de: inicio.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10) };
}

interface Projeto {
  id: string; nome: string; tipo: string; situacao: string;
  /** Organização dona do projeto — o escritório. */
  escritorio: string;
  /**
   * O cliente, tirado do cadastro de empresas do escritório.
   *
   * NÃO sai de `organizacoes`: aquela tabela é a dos inquilinos da
   * plataforma, e o RLS — corretamente — não deixa um inquilino ler a linha
   * do outro. O escritório conhece seu cliente por `empresas`, que é o
   * cadastro dele. Tirar o nome do dono do projeto faria todo relatório sair
   * com "Cliente: NGA", que é falso e passa despercebido.
   */
  cliente: string | null;
}

async function projetoDe(db: PoolClient, projetoId: string): Promise<Projeto> {
  const { rows } = await db.query<Projeto>(
    `SELECT p.id, p.nome, p.tipo, p.situacao,
            o.nome AS escritorio,
            (SELECT coalesce(e.nome_fantasia, e.razao_social)
               FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id
              WHERE pe.projeto_id = p.id
              ORDER BY CASE pe.papel WHEN 'recuperanda' THEN 0 WHEN 'devedora' THEN 1
                                     ELSE 2 END, e.razao_social
              LIMIT 1) AS cliente
       FROM projetos p JOIN organizacoes o ON o.id = p.organizacao_id
      WHERE p.id = $1`, [projetoId]);
  const projeto = rows[0];
  if (!projeto) throw new NaoEncontrado('projeto não encontrado');
  return projeto;
}

// ------------------------------------------------- acompanhamento mensal ---

const COLUNAS_ANDAMENTO: readonly Coluna[] = [
  { titulo: 'Data', largura: 70, tecnico: true },
  { titulo: 'O que aconteceu', largura: 425 },
];

const COLUNAS_OBRIGACOES: readonly Coluna[] = [
  { titulo: 'Vencimento', largura: 80, tecnico: true },
  { titulo: 'Parcela', largura: 60, alinhamento: 'direita', tecnico: true },
  { titulo: 'Credor', largura: 195 },
  { titulo: 'Valor (R$)', largura: 160, alinhamento: 'direita', tecnico: true },
];

const COLUNAS_CAIXA: readonly Coluna[] = [
  { titulo: 'Categoria', largura: 230 },
  { titulo: 'Receita (R$)', largura: 132, alinhamento: 'direita', tecnico: true },
  { titulo: 'Despesa (R$)', largura: 133, alinhamento: 'direita', tecnico: true },
];

export async function acompanhamento(
  db: PoolClient, projetoId: string, periodo: { de: string; ate: string }, geradoPor: string,
): Promise<Relatorio> {
  const projeto = await projetoDe(db, projetoId);
  const c = new Construtor();

  c.secao('Identificação');
  c.campo('Cliente', projeto.cliente);
  c.campo('Projeto', projeto.nome);
  c.campo('Escritório', projeto.escritorio);
  if (projeto.cliente === null) {
    c.lacuna(
      'Nenhuma empresa está vinculada a este projeto no cadastro, então o relatório ' +
      'não identifica o cliente pela razão social.');
  }
  c.campo('Procedimento', ROTULO_DO_PROCEDIMENTO[projeto.tipo] ?? projeto.tipo);
  c.campo('Período', `${dataBR(periodo.de)} a ${dataBR(periodo.ate)}`);

  // --- processo ---
  const { rows: processos } = await db.query<{
    numero: string; classe: string | null; situacao: string;
    suspenso_motivo: string | null; suspenso_ate: Date | null;
    comarca: string | null; uf: string | null;
  }>(
    `SELECT numero, classe, situacao, suspenso_motivo, suspenso_ate, comarca, uf
       FROM processos WHERE projeto_id = $1 ORDER BY distribuido_em NULLS LAST`, [projetoId]);

  c.secao('Processo');
  if (processos.length === 0) {
    c.tabela({
      colunas: [{ titulo: 'Processo', largura: 495 }], linhas: [],
      seVazio: 'Nenhum processo vinculado a este projeto na plataforma.',
    });
  } else {
    c.fonte('tabela processos');
    for (const p of processos) {
      c.campo('Número', p.numero);
      c.campo('Classe', p.classe);
      c.campo('Comarca', p.comarca ? `${p.comarca}${p.uf ? `/${p.uf}` : ''}` : null);
      c.campo('Situação', p.situacao);
      if (p.suspenso_motivo) {
        c.campo('Suspensão', `${p.suspenso_motivo}${
          p.suspenso_ate ? ` — até ${dataBR(p.suspenso_ate)}` : ''}`);
      }
    }
  }

  // --- andamento publicado ---
  const { rows: movimentacoes } = await db.query<{ data: Date; resumo_ao_cliente: string }>(
    `SELECT m.data, m.resumo_ao_cliente
       FROM movimentacoes m JOIN processos p ON p.id = m.processo_id
      WHERE p.projeto_id = $1 AND m.visivel_ao_cliente
        AND m.data BETWEEN $2 AND $3
      ORDER BY m.data`, [projetoId, periodo.de, periodo.ate]);

  c.secao('Andamento no período');
  c.tabela({
    colunas: COLUNAS_ANDAMENTO,
    linhas: movimentacoes.map((m) => [dataBR(m.data), m.resumo_ao_cliente]),
    seVazio: 'Nenhuma movimentação foi publicada para acompanhamento neste período.',
    fonte: 'tabela movimentacoes, somente as publicadas ao cliente',
  });

  // --- onboarding documental ---
  const { rows: checklist } = await db.query<{
    total: string; aprovados: string; enviados: string; pendentes: string;
  }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE situacao = 'aprovado') AS aprovados,
            count(*) FILTER (WHERE situacao IN ('enviado','em_analise')) AS enviados,
            count(*) FILTER (WHERE situacao IN ('pendente','rejeitado','complementacao')) AS pendentes
       FROM requisitos WHERE projeto_id = $1 AND obrigatorio`, [projetoId]);
  const q = checklist[0]!;

  c.secao('Documentos obrigatórios');
  if (Number(q.total) === 0) {
    c.tabela({
      colunas: [{ titulo: 'Item', largura: 495 }], linhas: [],
      seVazio: 'Nenhum checklist documental foi aberto para este projeto.',
    });
  } else {
    c.fonte('tabela requisitos, apenas itens obrigatórios');
    c.campo('Aprovados pela NGA', `${q.aprovados} de ${q.total}`);
    c.campo('Enviados, em análise', q.enviados);
    c.campo('Aguardando você', q.pendentes);
    c.nota(
      'Enviar um documento não o aprova: a NGA confere cada item antes de validar. ' +
      'Só o número de aprovados fecha o onboarding.');
  }

  // --- plano de pagamento ---
  const { rows: obrigacoes } = await db.query<{
    vencimento: Date; numero: number; credor: string; valor: string;
  }>(
    `SELECT o.vencimento, o.numero, cr.nome AS credor, o.valor
       FROM obrigacoes o
       JOIN planos pl ON pl.id = o.plano_id
       JOIN creditos cd ON cd.id = o.credito_id
       JOIN credores cr ON cr.id = cd.credor_id
      WHERE pl.projeto_id = $1 AND o.vencimento BETWEEN $2 AND $3
      ORDER BY o.vencimento, cr.nome`, [projetoId, periodo.de, periodo.ate]);

  c.secao('Parcelas do plano no período');
  c.tabela({
    colunas: COLUNAS_OBRIGACOES,
    linhas: obrigacoes.map((o) => [
      dataBR(o.vencimento), String(o.numero), o.credor, reais(o.valor)]),
    seVazio: 'Nenhuma parcela do plano vence neste período, ou o cronograma ainda não foi gerado.',
    fonte: 'tabela obrigacoes, geradas a partir de créditos com classe validada',
  });

  // --- caixa ---
  const { rows: caixa } = await db.query<{
    categoria: string; receita: string; despesa: string;
  }>(
    `SELECT categoria,
            coalesce(sum(valor) FILTER (WHERE tipo = 'receita'), 0) AS receita,
            coalesce(sum(valor) FILTER (WHERE tipo = 'despesa'), 0) AS despesa
       FROM lancamentos
      WHERE projeto_id = $1 AND situacao = 'realizado' AND data BETWEEN $2 AND $3
      GROUP BY categoria ORDER BY categoria`, [projetoId, periodo.de, periodo.ate]);

  c.secao('Caixa realizado no período');
  c.tabela({
    colunas: COLUNAS_CAIXA,
    linhas: caixa.map((l) => [l.categoria, reais(l.receita), reais(l.despesa)]),
    seVazio: 'Nenhum lançamento realizado foi registrado neste período.',
    fonte: 'tabela lancamentos, somente situação realizada',
  });
  if (caixa.length > 0) {
    const receita = caixa.reduce((t, l) => t + BigInt(l.receita), 0n);
    const despesa = caixa.reduce((t, l) => t + BigInt(l.despesa), 0n);
    c.campo('Total de receitas', `R$ ${formatarReais(receita)}`);
    c.campo('Total de despesas', `R$ ${formatarReais(despesa)}`);
    c.campo('Resultado do período', `R$ ${formatarReais(receita - despesa)}`);
    c.lacuna(
      'O caixa mostra apenas lançamentos marcados como realizados; valores previstos ' +
      'e lançamentos ainda não registrados ficam de fora.');
  }

  return c.montar({
    titulo: 'Relatório mensal de acompanhamento',
    subtitulo: `${projeto.cliente ?? projeto.nome} · ${dataBR(periodo.de)} a ${dataBR(periodo.ate)}`,
    geradoPor,
  });
}

// ------------------------------------------------- quadro de credores ---

const COLUNAS_CLASSES: readonly Coluna[] = [
  { titulo: 'Classe', largura: 55, tecnico: true },
  { titulo: 'Descrição', largura: 230 },
  { titulo: 'Credores', largura: 70, alinhamento: 'direita', tecnico: true },
  { titulo: 'Valor (R$)', largura: 140, alinhamento: 'direita', tecnico: true },
];

const COLUNAS_CREDORES: readonly Coluna[] = [
  { titulo: 'Credor', largura: 235 },
  { titulo: 'Classe', largura: 50, tecnico: true },
  { titulo: 'Natureza', largura: 115 },
  { titulo: 'Valor (R$)', largura: 95, alinhamento: 'direita', tecnico: true },
];

/**
 * Rótulo do procedimento.
 *
 * A coluna guarda o identificador (`recuperacao_judicial`); trocar o
 * sublinhado por espaço imprimiria "recuperacao judicial", sem cedilha e sem
 * til, num documento que vai ao cliente.
 */
const ROTULO_DO_PROCEDIMENTO: Readonly<Record<string, string>> = Object.freeze({
  recuperacao_judicial: 'Recuperação judicial',
  recuperacao_extrajudicial: 'Recuperação extrajudicial',
  falencia: 'Falência',
  investigacao_patrimonial: 'Investigação patrimonial',
  reestruturacao: 'Reestruturação',
  consultivo: 'Consultivo',
  contencioso: 'Contencioso',
});

const DESCRICAO_DA_CLASSE: Readonly<Record<string, string>> = Object.freeze({
  I: 'Trabalhista e acidente de trabalho',
  II: 'Garantia real, até o limite do bem gravado',
  III: 'Quirografário, privilégio e subordinado',
  IV: 'Microempresa e empresa de pequeno porte',
});

export async function quadroDeCredores(
  db: PoolClient, projetoId: string, geradoPor: string,
): Promise<Relatorio> {
  const projeto = await projetoDe(db, projetoId);
  const c = new Construtor();

  c.secao('Identificação');
  c.campo('Cliente', projeto.cliente);
  c.campo('Projeto', projeto.nome);

  const { rows: classes } = await db.query<{
    classe: string; credores: string; total: string;
  }>(
    // Somente classe VALIDADA por pessoa: sugestão de máquina não entra em
    // quadro de credores (§7.7).
    `SELECT classe_validada AS classe,
            count(DISTINCT credor_id) AS credores,
            sum(valor) AS total
       FROM creditos
      WHERE projeto_id = $1 AND classe_validada IS NOT NULL AND sujeito_validado
      GROUP BY classe_validada ORDER BY classe_validada`, [projetoId]);

  const { rows: pendentes } = await db.query<{ quantos: string; total: string }>(
    `SELECT count(*) AS quantos, coalesce(sum(valor), 0) AS total
       FROM creditos WHERE projeto_id = $1 AND classe_validada IS NULL`, [projetoId]);
  const pendente = pendentes[0]!;

  c.secao('Consolidado por classe');
  c.tabela({
    colunas: COLUNAS_CLASSES,
    linhas: classes.map((l) => [
      l.classe, DESCRICAO_DA_CLASSE[l.classe] ?? '—', l.credores, reais(l.total)]),
    seVazio:
      'Nenhum crédito com classe validada por pessoa. O quadro só considera crédito ' +
      'validado; enquanto a validação não ocorre, não há consolidado a apresentar.',
    fonte: 'tabela creditos, somente classe_validada e sujeito_validado',
  });

  if (classes.length > 0) {
    const total = classes.reduce((t, l) => t + BigInt(l.total), 0n);
    c.campo('Total sujeito validado', `R$ ${formatarReais(total)}`);
  }

  // A pendência é o dado mais importante deste relatório quando existe.
  c.secao('Créditos ainda não validados');
  if (Number(pendente.quantos) === 0) {
    c.paragrafo('Todos os créditos deste projeto têm classe validada por pessoa.');
  } else {
    c.paragrafo(
      `${pendente.quantos} crédito(s), somando R$ ${reais(pendente.total)}, estão com ` +
      'classe apenas sugerida pela plataforma e ainda não validada. Não entram em ' +
      'nenhum total acima.');
    c.lacuna(
      `${pendente.quantos} crédito(s) sem validação humana ficaram fora do consolidado: ` +
      'o quadro não é definitivo enquanto houver pendência.');
    c.nota(
      'A classificação sugerida pela plataforma é ponto de partida com fundamento legal ' +
      'registrado, não é decisão. Enquadramento de crédito é ato de quem responde pelo caso.');
  }

  const { rows: creditos } = await db.query<{
    credor: string; classe: string; natureza: string; valor: string;
  }>(
    `SELECT cr.nome AS credor, c.classe_validada AS classe, c.natureza, c.valor
       FROM creditos c JOIN credores cr ON cr.id = c.credor_id
      WHERE c.projeto_id = $1 AND c.classe_validada IS NOT NULL AND c.sujeito_validado
      ORDER BY c.valor DESC`, [projetoId]);

  c.secao('Relação de credores validados');
  c.tabela({
    colunas: COLUNAS_CREDORES,
    linhas: creditos.map((l) => [
      l.credor, l.classe, l.natureza.replace(/_/g, ' '), reais(l.valor)]),
    seVazio: 'Nenhum credor com crédito validado e sujeito à recuperação.',
  });

  c.lacuna(
    'Créditos não sujeitos à recuperação (art. 49, §§ 3º e 4º, da LREF) não constam ' +
    'deste quadro, ainda que existam contra a devedora.');

  return c.montar({
    titulo: 'Quadro de credores — consolidado',
    subtitulo: `${projeto.cliente ?? projeto.escritorio} · ${projeto.nome}`,
    geradoPor,
  });
}

// ------------------------------------------------------------- fachada ---

export interface RelatorioGerado {
  readonly relatorio: Relatorio;
  readonly pdf: Uint8Array;
  readonly nome: string;
}

export async function gerar(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaGeracao>, identidade: Identidade,
): Promise<RelatorioGerado> {
  const periodo = dados.de && dados.ate
    ? { de: dados.de, ate: dados.ate }
    : periodoPadrao();
  if (periodo.de > periodo.ate) {
    throw new PedidoInvalido('a data inicial do período é posterior à final');
  }

  const relatorio = dados.tipo === 'acompanhamento'
    ? await acompanhamento(db, projetoId, periodo, identidade.nome)
    : await quadroDeCredores(db, projetoId, identidade.nome);

  const sufixo = dados.tipo === 'acompanhamento' ? `-${periodo.de}-a-${periodo.ate}` : '';
  return {
    relatorio,
    pdf: await renderizar(relatorio),
    nome: `relatorio-${dados.tipo}${sufixo}.pdf`,
  };
}
