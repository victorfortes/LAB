/**
 * Projeto: a espinha, e o painel de quem trabalha nele.
 *
 * Tudo nesta plataforma se pendura em `projeto_id` — crédito, plano,
 * assembleia, portal, checklist, documento, análise, processo, relatório e
 * caixa da recuperanda. O que faltava era o lugar onde isso tudo aparece
 * junto, e a resposta para a pergunta que o advogado faz de manhã: o que está
 * na minha mesa hoje.
 *
 * As duas funções que importam aqui são `hub` e `painel`, e as duas seguem a
 * mesma regra: elas CONTAM o que existe, não interpretam. Quando um número
 * vem zerado é porque a consulta voltou vazia, não porque algum padrão foi
 * assumido — e o RLS é quem decide o que cada um enxerga, inclusive aqui.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import {
  type TipoDeProjeto, ROTULO_DO_TIPO, fase as faseDe, faseInicial, fasesDe,
  progresso, transicionarFase,
} from '../domain/projeto/fases.ts';
import { diasUteisAte } from '../domain/processo/prazos.ts';
import { limparCnpj, validarCnpj } from '../domain/analise/identificadores.ts';

const TIPOS = [
  'recuperacao_judicial', 'recuperacao_extrajudicial', 'falencia', 'reestruturacao',
  'negociacao_credores', 'investigacao_patrimonial', 'contencioso_estrategico', 'consultivo', 'protecao_patrimonial',
] as const;

export const EsquemaProjeto = z.object({
  nome: z.string().min(1).max(200),
  tipo: z.enum(TIPOS),
  resumo: z.string().max(1000).optional(),
  prioridade: z.number().int().min(1).max(5).default(3),
  /** Pular a geração automática de tarefas (útil ao cadastrar um caso que já está andando). */
  empresaId: z.string().uuid().optional(),
  /** Cria o cliente no cadastro do escritório junto com o projeto. */
  cliente: z.object({
    razaoSocial: z.string().trim().min(2).max(300),
    cnpj: z.string().max(20).optional(),
  }).optional(),
  previsaoFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  iniciadoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const EsquemaFase = z.object({
  fase: z.string().min(1).max(60),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const EsquemaEncerramento = z.object({
  motivo: z.string().min(5).max(500),
  em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const EsquemaEquipe = z.object({
  usuarioId: z.string().uuid(),
  papel: z.enum(['lider', 'advogado', 'apoio', 'revisor']),
});

const hojeISO = (): string => new Date().toISOString().slice(0, 10);
const dataISO = (d: Date | string | null): string | null =>
  (d === null ? null : new Date(d).toISOString().slice(0, 10));

/** O catálogo de fases que a interface usa para montar os seletores. */
export function catalogoDeFases() {
  return TIPOS.map((tipo) => ({
    tipo,
    rotulo: ROTULO_DO_TIPO[tipo],
    fases: fasesDe(tipo),
  }));
}

export async function criar(
  db: PoolClient, dados: z.infer<typeof EsquemaProjeto>, identidade: Identidade,
) {
  const organizacaoId = identidade.organizacoes.find((o) => o.tipo === 'escritorio')?.id;
  if (!organizacaoId) throw new PedidoInvalido('usuário não pertence ao escritório');

  const inicial = faseInicial(dados.tipo);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO projetos (organizacao_id, nome, tipo, resumo, prioridade,
       responsavel_id, iniciado_em, fase, fase_desde)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [organizacaoId, dados.nome, dados.tipo, dados.resumo ?? null, dados.prioridade,
     identidade.usuarioId, dados.iniciadoEm ?? hojeISO(), inicial.id, hojeISO()]);
  const id = rows[0]!.id;

  // Quem cria lidera, até que se diga o contrário. Projeto sem líder é como
  // um prazo passa.
  await db.query(
    `INSERT INTO projeto_equipe (projeto_id, organizacao_id, usuario_id, papel)
     VALUES ($1,$2,$3,'lider')`, [id, organizacaoId, identidade.usuarioId]);

  const papelDaEmpresa = dados.tipo === 'recuperacao_judicial' || dados.tipo === 'recuperacao_extrajudicial'
    ? 'recuperanda' : 'relacionada';
  let empresaId = dados.empresaId;
  if (!empresaId && dados.cliente) {
    // CNPJ informado tem de fechar pelo dígito verificador: cadastro com CNPJ
    // errado vira cliente que ninguém acha em consulta nenhuma.
    let cnpj: string | null = null;
    if (dados.cliente.cnpj) {
      if (!validarCnpj(dados.cliente.cnpj)) throw new PedidoInvalido('o dígito verificador do CNPJ não confere');
      cnpj = limparCnpj(dados.cliente.cnpj);
    }
    const { rows: emp } = await db.query<{ id: string }>(
      `INSERT INTO empresas (organizacao_id, cnpj, razao_social) VALUES ($1,$2,$3)
       ON CONFLICT (organizacao_id, cnpj) DO UPDATE SET razao_social = EXCLUDED.razao_social
       RETURNING id`, [organizacaoId, cnpj, dados.cliente.razaoSocial]);
    empresaId = emp[0]!.id;
  }
  if (empresaId) {
    const empresa = await db.query('SELECT id FROM empresas WHERE id = $1 AND organizacao_id = $2', [empresaId, organizacaoId]);
    if (!empresa.rows[0]) throw new PedidoInvalido('a empresa deve pertencer ao escritório deste projeto');
    await db.query(
      `INSERT INTO projetos_empresas (projeto_id, empresa_id, papel) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`, [id, empresaId, papelDaEmpresa]);
  }
  if (dados.previsaoFim) await db.query('UPDATE projetos SET previsao_fim = $2 WHERE id = $1', [id, dados.previsaoFim]);

  await auditar(db, {
    organizacaoId, usuarioId: identidade.usuarioId, acao: 'projeto.criado',
    entidade: 'projeto', entidadeId: id, depois: { ...dados, fase: inicial.id },
  });

  return { id, fase: inicial, progresso: progresso(dados.tipo, inicial.id) };
}

export async function listar(db: PoolClient) {
  const { rows } = await db.query(
    `SELECT p.id, p.nome, p.tipo, p.situacao, p.prioridade, p.fase, p.fase_desde,
            p.resumo, p.iniciado_em, p.previsao_fim, p.encerrado_em,
            p.whatsapp_grupo_url AS "whatsappGrupoUrl",
            u.nome AS responsavel,
            (SELECT e.nome FROM projeto_equipe pe
               JOIN usuarios e ON e.id = pe.usuario_id
              WHERE pe.projeto_id = p.id AND pe.papel = 'lider' AND pe.ate IS NULL
              LIMIT 1) AS lider,
            (SELECT coalesce(json_agg(json_build_object('nome', x.nome, 'papel', x.papel, 'usuarioId', x.usuario_id)
                      ORDER BY CASE x.papel WHEN 'lider' THEN 0 ELSE 1 END, x.nome), '[]'::json)
               FROM (SELECT e.id AS usuario_id, e.nome, pe.papel FROM projeto_equipe pe
                       JOIN usuarios e ON e.id = pe.usuario_id
                      WHERE pe.projeto_id = p.id AND pe.ate IS NULL) x) AS equipe,
            (SELECT coalesce(em.nome_fantasia, em.razao_social) FROM projetos_empresas pem
               JOIN empresas em ON em.id = pem.empresa_id
              WHERE pem.projeto_id = p.id ORDER BY pem.papel LIMIT 1) AS cliente,
            (SELECT count(*) FROM creditos c
              WHERE c.projeto_id = p.id AND c.classe_validada IS NULL) AS creditos_a_validar,
            (SELECT count(*) FROM requisitos r
              WHERE r.projeto_id = p.id AND r.situacao IN ('enviado','em_analise')) AS a_analisar,
            (SELECT count(*) FROM prazos z JOIN processos pr ON pr.id = z.processo_id
              WHERE pr.projeto_id = p.id AND z.situacao = 'aberto') AS prazos_abertos,
            (SELECT json_build_object('titulo', z.titulo, 'vencimento', z.vencimento)
               FROM prazos z JOIN processos pr ON pr.id = z.processo_id
              WHERE pr.projeto_id = p.id AND z.situacao = 'aberto'
              ORDER BY z.vencimento LIMIT 1) AS proximo_prazo,
            (SELECT count(*) FROM tarefas t WHERE t.projeto_id = p.id) AS tarefas_total,
            (SELECT count(*) FROM tarefas t
              WHERE t.projeto_id = p.id AND t.status = 'concluida') AS tarefas_concluidas
       FROM projetos p LEFT JOIN usuarios u ON u.id = p.responsavel_id
      ORDER BY p.situacao, p.prioridade, p.nome`);

  return rows.map((r) => {
    const l = r as { tipo: TipoDeProjeto; fase: string | null };
    return {
      ...r,
      rotuloDoTipo: ROTULO_DO_TIPO[l.tipo] ?? l.tipo,
      faseAtual: l.fase ? faseDe(l.tipo, l.fase) ?? null : null,
      progresso: l.fase ? progresso(l.tipo, l.fase) : null,
    };
  });
}

/**
 * Tudo sobre um projeto, num lugar só.
 *
 * Os contadores saem de consultas diretas, sob o RLS de quem pede: o cliente,
 * se alcançar esta rota, conta o que ele pode ver — e prazo, por exemplo, ele
 * não pode ver nenhum (migração 014).
 */
export async function hub(db: PoolClient, projetoId: string) {
  const { rows } = await db.query(
    `SELECT p.id, p.organizacao_id, p.grupo_id, p.nome, p.tipo, p.situacao, p.prioridade,
            p.fase, p.fase_desde, p.responsavel_id, p.iniciado_em, p.previsao_fim,
            p.encerrado_em, p.motivo_encerramento, p.criado_em, p.resumo,
            p.whatsapp_grupo_url AS "whatsappGrupoUrl", p.posicao_cliente AS "posicaoCliente", p.segmento,
            u.nome AS responsavel, g.nome AS grupo
       FROM projetos p
       LEFT JOIN usuarios u ON u.id = p.responsavel_id
       LEFT JOIN grupos_economicos g ON g.id = p.grupo_id
      WHERE p.id = $1`, [projetoId]);
  const projeto = rows[0];
  if (!projeto) throw new NaoEncontrado('projeto não encontrado');

  const tipo = (projeto as { tipo: TipoDeProjeto }).tipo;
  const faseAtual = (projeto as { fase: string | null }).fase;

  const { rows: equipe } = await db.query(
    `SELECT pe.id, pe.papel, pe.desde, u.nome, u.email
       FROM projeto_equipe pe JOIN usuarios u ON u.id = pe.usuario_id
      WHERE pe.projeto_id = $1 AND pe.ate IS NULL
      ORDER BY CASE pe.papel WHEN 'lider' THEN 0 WHEN 'advogado' THEN 1
                             WHEN 'revisor' THEN 2 ELSE 3 END, u.nome`, [projetoId]);

  const { rows: empresas } = await db.query(
    `SELECT e.id, e.razao_social, e.nome_fantasia, e.cnpj, pe.papel
       FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id
      WHERE pe.projeto_id = $1 ORDER BY pe.papel, e.razao_social`, [projetoId]);

  // Um round-trip para todos os contadores: o hub é a tela mais aberta do
  // sistema, e dez consultas separadas apareceriam na latência.
  const { rows: contagens } = await db.query<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM creditos WHERE projeto_id = $1) AS creditos,
       (SELECT count(*) FROM creditos WHERE projeto_id = $1 AND classe_validada IS NULL)
         AS creditos_a_validar,
       (SELECT count(*) FROM planos WHERE projeto_id = $1) AS planos,
       (SELECT count(*) FROM assembleias WHERE projeto_id = $1) AS assembleias,
       (SELECT count(*) FROM documentos WHERE projeto_id = $1) AS documentos,
       (SELECT count(*) FROM documentos WHERE projeto_id = $1 AND visibilidade = 'publicado')
         AS documentos_publicados,
       (SELECT count(*) FROM requisitos WHERE projeto_id = $1) AS requisitos,
       (SELECT count(*) FROM requisitos WHERE projeto_id = $1 AND obrigatorio
          AND situacao = 'aprovado') AS requisitos_aprovados,
       (SELECT count(*) FROM requisitos WHERE projeto_id = $1 AND obrigatorio) AS requisitos_obrigatorios,
       (SELECT count(*) FROM requisitos WHERE projeto_id = $1
          AND situacao IN ('enviado','em_analise')) AS requisitos_a_analisar,
       (SELECT count(*) FROM processos WHERE projeto_id = $1) AS processos,
       (SELECT count(*) FROM prazos z JOIN processos pr ON pr.id = z.processo_id
         WHERE pr.projeto_id = $1 AND z.situacao = 'aberto') AS prazos_abertos,
       (SELECT count(*) FROM analises WHERE projeto_id = $1) AS analises,
       (SELECT count(*) FROM achados a JOIN analises an ON an.id = a.analise_id
         WHERE an.projeto_id = $1 AND a.gravidade = 'critico' AND a.situacao = 'aberto')
         AS achados_criticos,
       (SELECT count(*) FROM portais WHERE projeto_id = $1 AND ativo) AS portais`,
    [projetoId]);
  const c = contagens[0]!;

  const { rows: proximos } = await db.query<{
    id: string; titulo: string; vencimento: Date; numero: string;
  }>(
    `SELECT z.id, z.titulo, z.vencimento, pr.numero
       FROM prazos z JOIN processos pr ON pr.id = z.processo_id
      WHERE pr.projeto_id = $1 AND z.situacao = 'aberto'
      ORDER BY z.vencimento LIMIT 5`, [projetoId]);

  const hoje = hojeISO();
  return {
    ...projeto,
    rotuloDoTipo: ROTULO_DO_TIPO[tipo] ?? tipo,
    faseAtual: faseAtual ? faseDe(tipo, faseAtual) ?? null : null,
    progresso: faseAtual ? progresso(tipo, faseAtual) : null,
    fasesDisponiveis: fasesDe(tipo),
    equipe,
    empresas,
    contagens: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)])),
    proximosPrazos: proximos.map((p) => ({
      ...p,
      vencimento: dataISO(p.vencimento),
      diasUteisRestantes: diasUteisAte(hoje, dataISO(p.vencimento)!),
    })),
  };
}

/** Link do grupo de WhatsApp do cliente. Só links do próprio WhatsApp: o cliente clica nele no portal. */
export const EsquemaDadosDoCliente = z.object({
  whatsappGrupoUrl: z.string().trim().max(300)
    .regex(/^https:\/\/(chat\.whatsapp\.com|wa\.me|api\.whatsapp\.com|whatsapp\.com)\/\S+$/i, 'use o link do grupo (https://chat.whatsapp.com/...)')
    .or(z.literal('')).nullable().optional(),
  resumo: z.string().trim().max(1000).nullable().optional(),
  /** Em que lado o NGA atua: muda o foco do diagnóstico inicial. */
  posicaoCliente: z.enum(['devedor', 'credor']).optional(),
  /** Segmento do cliente: decide blocos do diagnóstico (frota só para transportadora). */
  segmento: z.enum(['transportadora', 'industria', 'comercio', 'servicos', 'agronegocio', 'construcao', 'saude', 'outro']).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a alterar');

export async function atualizarDadosDoCliente(
  db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaDadosDoCliente>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string; nome: string }>('SELECT organizacao_id, nome FROM projetos WHERE id = $1', [projetoId]);
  if (!rows[0]) throw new NaoEncontrado('projeto não encontrado');
  const sets: string[] = []; const args: unknown[] = [projetoId];
  if (d.whatsappGrupoUrl !== undefined) { args.push(d.whatsappGrupoUrl || null); sets.push(`whatsapp_grupo_url = $${args.length}`); }
  if (d.resumo !== undefined) { args.push(d.resumo || null); sets.push(`resumo = $${args.length}`); }
  if (d.posicaoCliente !== undefined) { args.push(d.posicaoCliente); sets.push(`posicao_cliente = $${args.length}`); }
  if (d.segmento !== undefined) { args.push(d.segmento); sets.push(`segmento = $${args.length}`); }
  await db.query(`UPDATE projetos SET ${sets.join(', ')} WHERE id = $1`, args);
  await auditar(db, {
    organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'projeto.dados_do_cliente', entidade: 'projeto', entidadeId: projetoId,
    depois: { projeto: rows[0].nome, whatsapp: d.whatsappGrupoUrl === undefined ? undefined : d.whatsappGrupoUrl ? 'definido' : 'removido' },
  });
  return { ok: true, whatsappGrupoUrl: d.whatsappGrupoUrl || null };
}

export async function mudarFase(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaFase>, identidade: Identidade,
) {
  const { rows } = await db.query<{
    organizacao_id: string; tipo: TipoDeProjeto; fase: string | null; nome: string;
  }>('SELECT organizacao_id, tipo, fase, nome FROM projetos WHERE id = $1', [projetoId]);
  const projeto = rows[0];
  if (!projeto) throw new NaoEncontrado('projeto não encontrado');

  const de = projeto.fase ?? faseInicial(projeto.tipo).id;
  const destino = transicionarFase(projeto.tipo, de, dados.fase);
  const desde = dados.desde ?? hojeISO();

  await db.query('UPDATE projetos SET fase = $2, fase_desde = $3 WHERE id = $1',
    [projetoId, destino.id, desde]);

  await auditar(db, {
    organizacaoId: projeto.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'projeto.fase_alterada', entidade: 'projeto', entidadeId: projetoId,
    antes: { fase: de },
    depois: { fase: destino.id, nome: destino.nome, desde, projeto: projeto.nome },
  });

  return { id: projetoId, fase: destino, progresso: progresso(projeto.tipo, destino.id) };
}

export async function encerrar(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaEncerramento>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string; situacao: string; nome: string }>(
    'SELECT organizacao_id, situacao, nome FROM projetos WHERE id = $1', [projetoId]);
  const projeto = rows[0];
  if (!projeto) throw new NaoEncontrado('projeto não encontrado');
  if (projeto.situacao === 'encerrado') throw new PedidoInvalido('este projeto já está encerrado');

  const em = dados.em ?? hojeISO();
  await db.query(
    `UPDATE projetos SET situacao = 'encerrado', encerrado_em = $2, motivo_encerramento = $3
      WHERE id = $1`, [projetoId, em, dados.motivo]);

  await auditar(db, {
    organizacaoId: projeto.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'projeto.encerrado', entidade: 'projeto', entidadeId: projetoId,
    antes: { situacao: projeto.situacao },
    depois: { situacao: 'encerrado', em, motivo: dados.motivo, projeto: projeto.nome },
  });

  return { id: projetoId, situacao: 'encerrado', encerradoEm: em };
}

export async function entrarNaEquipe(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaEquipe>, identidade: Identidade,
) {
  const { rows } = await db.query<{ organizacao_id: string }>(
    'SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  const projeto = rows[0];
  if (!projeto) throw new NaoEncontrado('projeto não encontrado');

  const integrante = await db.query(
    `SELECT u.id FROM usuarios u JOIN vinculos v ON v.usuario_id = u.id
      WHERE u.id = $1 AND v.organizacao_id = $2 AND v.revogado_em IS NULL AND u.ativo
        AND v.papel NOT IN ('integracao','parceiro_externo','cliente_administrador','cliente_usuario') LIMIT 1`,
    [dados.usuarioId, projeto.organizacao_id]);
  if (!integrante.rows[0]) throw new PedidoInvalido('o integrante deve fazer parte da equipe ativa do escritório deste projeto');

  // Trocar de líder é substituir, não acumular: o índice parcial da migração
  // 015 recusaria dois líderes ativos, então o anterior sai primeiro.
  if (dados.papel === 'lider') {
    await db.query(
      `UPDATE projeto_equipe SET ate = CURRENT_DATE
        WHERE projeto_id = $1 AND papel = 'lider' AND ate IS NULL`, [projetoId]);
  }

  await db.query(
    `INSERT INTO projeto_equipe (projeto_id, organizacao_id, usuario_id, papel)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING`,
    [projetoId, projeto.organizacao_id, dados.usuarioId, dados.papel]);

  await auditar(db, {
    organizacaoId: projeto.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'projeto.equipe_alterada', entidade: 'projeto', entidadeId: projetoId,
    depois: { entrou: dados.usuarioId, papel: dados.papel },
  });

  return { ok: true };
}

export async function sairDaEquipe(
  db: PoolClient, equipeId: string, identidade: Identidade,
) {
  const { rows } = await db.query<{
    organizacao_id: string; projeto_id: string; usuario_id: string; papel: string;
  }>('SELECT organizacao_id, projeto_id, usuario_id, papel FROM projeto_equipe WHERE id = $1',
    [equipeId]);
  const linha = rows[0];
  if (!linha) throw new NaoEncontrado('vínculo de equipe não encontrado');

  // A linha não é apagada: quem trabalhou no caso em 2024 continua tendo
  // trabalhado nele, e a auditoria precisa disso.
  await db.query('UPDATE projeto_equipe SET ate = CURRENT_DATE WHERE id = $1 AND ate IS NULL',
    [equipeId]);

  await auditar(db, {
    organizacaoId: linha.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'projeto.equipe_alterada', entidade: 'projeto', entidadeId: linha.projeto_id,
    depois: { saiu: linha.usuario_id, papel: linha.papel },
  });

  return { ok: true };
}

// --------------------------------------------------------------- painel ---

/**
 * O que está na mesa de quem está olhando.
 *
 * Nada aqui é "sugestão inteligente": são as pendências que existem no banco,
 * ordenadas pelo que vence antes. O painel prioriza por DATA e por bloqueio,
 * não por palpite — e quando não há nada, diz que não há, em vez de inventar
 * um indicador para a tela não ficar vazia (§18).
 */
export async function painel(db: PoolClient, identidade: Identidade) {
  const hoje = hojeISO();

  const { rows: meusProjetos } = await db.query(
    `SELECT p.id, p.nome, p.tipo, p.fase, p.situacao, pe.papel
       FROM projeto_equipe pe JOIN projetos p ON p.id = pe.projeto_id
      WHERE pe.usuario_id = $1 AND pe.ate IS NULL AND p.situacao <> 'encerrado'
      ORDER BY p.prioridade, p.nome`, [identidade.usuarioId]);

  const { rows: prazos } = await db.query<{
    id: string; titulo: string; vencimento: Date; numero: string;
    projeto: string | null; responsavel: string | null; meu: boolean;
  }>(
    `SELECT z.id, z.titulo, z.vencimento, pr.numero, p.nome AS projeto,
            u.nome AS responsavel, (z.responsavel_id = $1) AS meu
       FROM prazos z
       JOIN processos pr ON pr.id = z.processo_id
       LEFT JOIN projetos p ON p.id = pr.projeto_id
       LEFT JOIN usuarios u ON u.id = z.responsavel_id
      WHERE z.situacao = 'aberto'
      ORDER BY z.vencimento LIMIT 12`, [identidade.usuarioId]);

  const { rows: aAnalisar } = await db.query(
    `SELECT r.id, r.titulo, r.categoria, r.atualizado_em, p.nome AS projeto, p.id AS projeto_id
       FROM requisitos r JOIN projetos p ON p.id = r.projeto_id
      WHERE r.situacao IN ('enviado','em_analise')
      ORDER BY r.atualizado_em LIMIT 10`);

  const { rows: aValidar } = await db.query<{ projeto_id: string; projeto: string; quantos: string }>(
    `SELECT p.id AS projeto_id, p.nome AS projeto, count(*) AS quantos
       FROM creditos c JOIN projetos p ON p.id = c.projeto_id
      WHERE c.classe_validada IS NULL
      GROUP BY p.id, p.nome ORDER BY count(*) DESC LIMIT 10`);

  const { rows: criticos } = await db.query(
    `SELECT a.id, a.titulo, a.categoria, an.id AS analise_id, d.titulo AS documento,
            p.nome AS projeto
       FROM achados a
       JOIN analises an ON an.id = a.analise_id
       JOIN documentos d ON d.id = an.documento_id
       LEFT JOIN projetos p ON p.id = an.projeto_id
      WHERE a.gravidade = 'critico' AND a.situacao = 'aberto'
      ORDER BY a.criado_em DESC LIMIT 10`);

  // Mensagem do cliente sem resposta da NGA depois dela. É a pendência que
  // some mais fácil e custa mais caro na relação com o cliente.
  const { rows: semResposta } = await db.query(
    `SELECT m.id, m.texto, m.criado_em, p.nome AS projeto, p.id AS projeto_id
       FROM mensagens m JOIN projetos p ON p.id = m.projeto_id
      WHERE m.lado = 'cliente'
        AND NOT EXISTS (
          SELECT 1 FROM mensagens r
           WHERE r.projeto_id = m.projeto_id AND r.lado = 'nga' AND r.criado_em > m.criado_em)
      ORDER BY m.criado_em LIMIT 10`);

  const prazosComContagem = prazos.map((z) => {
    const vencimento = dataISO(z.vencimento)!;
    const restantes = diasUteisAte(hoje, vencimento);
    return { ...z, vencimento, diasUteisRestantes: restantes, vencido: restantes < 0 };
  });

  return {
    hoje,
    usuario: identidade.nome,
    meusProjetos: meusProjetos.map((p) => {
      const l = p as { tipo: TipoDeProjeto; fase: string | null };
      return {
        ...p,
        rotuloDoTipo: ROTULO_DO_TIPO[l.tipo] ?? l.tipo,
        faseAtual: l.fase ? faseDe(l.tipo, l.fase) ?? null : null,
      };
    }),
    prazos: prazosComContagem,
    prazosVencidos: prazosComContagem.filter((z) => z.vencido).length,
    aAnalisar,
    aValidar: aValidar.map((r) => ({ ...r, quantos: Number(r.quantos) })),
    achadosCriticos: criticos,
    mensagensSemResposta: semResposta,
    // Soma do que efetivamente espera uma ação de alguém.
    pendencias: prazosComContagem.length + aAnalisar.length
      + aValidar.reduce((t, r) => t + Number(r.quantos), 0)
      + criticos.length,
    // O chat interno acabou (o cliente fala pelo grupo de WhatsApp): mensagem antiga sem resposta não conta mais como pendência.
  };
}
