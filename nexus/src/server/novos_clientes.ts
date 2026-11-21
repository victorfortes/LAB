/**
 * Onboarding de novos clientes, do primeiro contato ao projeto rodando, num caminho só:
 *   1. CNPJ → pré-diagnóstico automático;
 *   2. reunião inicial (data e anotações);
 *   3. contrato fechado → o sistema cria o projeto (empresa, área/equipe, tipo, responsável), liga o
 *      pré-diagnóstico, gera o checklist de documentos do modelo, dispara as tarefas do onboarding e
 *      avisa o escritório inteiro ("novo cliente na área X");
 *   4. onboarding: acompanha as tarefas até concluir.
 * Pensado para quem cuida do comercial: uma ação por etapa, sem campo que não seja necessário.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import * as prediag from './prediagnostico.ts';
import * as projetos from './projetos.ts';
import { aplicarModelo } from './portal.ts';
const { TIPOS } = projetos;

const somarDias = (n: number) => new Date(Date.now() - 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

export const EsquemaNovo = z.object({ cnpj: z.string().trim().min(14).max(20).optional(), nome: z.string().trim().min(2).max(300).optional(), origem: z.string().trim().max(200).optional() })
  .refine((d) => d.cnpj || d.nome, 'informe o CNPJ (ou o nome, se for pessoa física)');
export const EsquemaEdicao = z.object({
  contatoNome: z.string().trim().max(200).nullable().optional(), contatoEmail: z.string().trim().max(200).nullable().optional(), contatoTelefone: z.string().trim().max(40).nullable().optional(),
  origem: z.string().trim().max(200).nullable().optional(), reuniaoEm: z.string().datetime({ offset: true }).nullable().optional(), reuniaoRealizada: z.boolean().optional(),
  reuniaoNotas: z.string().trim().max(8000).nullable().optional(), etapa: z.enum(['prediagnostico', 'reuniao', 'proposta', 'contrato', 'onboarding', 'concluido', 'perdido']).optional(),
  motivoPerda: z.string().trim().max(500).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a alterar');
export const EsquemaContrato = z.object({
  area: z.string().trim().min(2).max(60), tipoProjeto: z.enum(TIPOS), responsavelId: z.string().uuid(),
  honorarios: z.string().trim().max(300).nullable().optional(), contratoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nomeProjeto: z.string().trim().min(2).max(200).optional(),
});

/** As tarefas que todo cliente novo dispara (D+n a partir da assinatura). */
export const TAREFAS_ONBOARDING: { titulo: string; dias: number; quem: 'responsavel' | 'criador'; detalhe: string }[] = [
  { titulo: 'Boas-vindas: ligar para o cliente e apresentar a equipe', dias: 1, quem: 'responsavel', detalhe: 'Apresente o responsável, explique os próximos passos e combine o canal do dia a dia.' },
  { titulo: 'Criar o acesso do cliente ao portal', dias: 1, quem: 'criador', detalhe: 'Projeto → Portal do cliente → Criar portal e convidar. Cadastre também o e-mail pessoal.' },
  { titulo: 'Criar o grupo de WhatsApp do caso e salvar o link no portal', dias: 1, quem: 'criador', detalhe: 'O link fica no portal (botão "Entrar no grupo").' },
  { titulo: 'Conferir o checklist de documentos e pedir o que faltar', dias: 2, quem: 'responsavel', detalhe: 'O checklist do modelo já foi gerado. Use "Pedir documento" para o que for específico do caso.' },
  { titulo: 'Enviar o contrato assinado ao financeiro e emitir a primeira fatura', dias: 2, quem: 'criador', detalhe: 'Honorários combinados no fechamento constam na descrição do projeto.' },
  { titulo: 'Cadastrar os processos encontrados no pré-diagnóstico', dias: 3, quem: 'responsavel', detalhe: 'Veja a aba Pré-diagnóstico: confira quais processos o escritório vai assumir ou acompanhar.' },
  { titulo: 'Reunião de kick-off com o cliente', dias: 5, quem: 'responsavel', detalhe: 'Alinhar estratégia, cronograma e responsabilidades. Registre a ata em Reuniões e atas.' },
];

async function org(i: Identidade) { const o = i.organizacoes.find((x) => x.tipo === 'escritorio')?.id; if (!o) throw new PedidoInvalido('só o escritório'); return o; }
async function carregar(db: PoolClient, id: string) {
  const { rows } = await db.query<Record<string, any>>('SELECT * FROM novos_clientes WHERE id = $1', [id]);
  if (!rows[0]) throw new NaoEncontrado('cliente em prospecção não encontrado'); return rows[0];
}

export async function listar(db: PoolClient) {
  const { rows } = await db.query(`SELECT n.id, n.cnpj, n.nome, n.etapa, n.area, n.tipo_projeto "tipoProjeto", n.reuniao_em "reuniaoEm", n.reuniao_realizada "reuniaoRealizada", n.contrato_em "contratoEm",
      n.contato_nome "contatoNome", n.projeto_id "projetoId", n.prediagnostico_id "prediagnosticoId", n.criado_em "criadoEm", n.atualizado_em "atualizadoEm", u.nome responsavel,
      (SELECT count(*)::int FROM tarefas t WHERE t.projeto_id = n.projeto_id AND t.chave_playbook LIKE 'onboarding:%') tarefas,
      (SELECT count(*)::int FROM tarefas t WHERE t.projeto_id = n.projeto_id AND t.chave_playbook LIKE 'onboarding:%' AND t.status = 'concluida') feitas
     FROM novos_clientes n LEFT JOIN usuarios u ON u.id = n.responsavel_id
    WHERE n.etapa <> 'perdido' OR n.atualizado_em > now() - interval '60 days' ORDER BY n.atualizado_em DESC LIMIT 200`);
  return rows;
}

export async function criar(db: PoolClient, d: z.infer<typeof EsquemaNovo>, i: Identidade) {
  const organizacao = await org(i);
  let pre: Awaited<ReturnType<typeof prediag.obter>> | null = null; let nome = d.nome ?? '';
  if (d.cnpj) { pre = await prediag.criar(db, { cnpj: d.cnpj }, i); nome = pre.empresa.fantasia || pre.empresa.razao; }
  const { rows: [r] } = await db.query<{ id: string }>(`INSERT INTO novos_clientes (organizacao_id, cnpj, nome, prediagnostico_id, origem, etapa, criado_por) VALUES ($1,$2,$3,$4,$5,'prediagnostico',$6) RETURNING id`,
    [organizacao, pre?.cnpj ?? null, nome, pre?.id ?? null, d.origem ?? null, i.usuarioId]);
  await auditar(db, { organizacaoId: organizacao, usuarioId: i.usuarioId, acao: 'novo_cliente.criado', entidade: 'novo_cliente', entidadeId: r!.id, depois: { nome, cnpj: pre?.cnpj ?? null } });
  return obter(db, r!.id);
}

export async function obter(db: PoolClient, id: string) {
  const n = await carregar(db, id);
  const { rows: tarefas } = n.projeto_id ? await db.query(`SELECT t.id, t.titulo, t.status, t.prazo, u.nome responsavel FROM tarefas t LEFT JOIN usuarios u ON u.id = t.responsavel_id
     WHERE t.projeto_id = $1 AND t.chave_playbook LIKE 'onboarding:%' ORDER BY t.prazo, t.criado_em`, [n.projeto_id]) : { rows: [] };
  return { id: n.id, cnpj: n.cnpj, nome: n.nome, etapa: n.etapa, prediagnosticoId: n.prediagnostico_id, contatoNome: n.contato_nome, contatoEmail: n.contato_email, contatoTelefone: n.contato_telefone,
    origem: n.origem, reuniaoEm: n.reuniao_em, reuniaoRealizada: n.reuniao_realizada, reuniaoNotas: n.reuniao_notas, area: n.area, tipoProjeto: n.tipo_projeto, honorarios: n.honorarios,
    contratoEm: n.contrato_em, responsavelId: n.responsavel_id, projetoId: n.projeto_id, motivoPerda: n.motivo_perda, criadoEm: n.criado_em, tarefas };
}

export async function editar(db: PoolClient, id: string, d: z.infer<typeof EsquemaEdicao>, i: Identidade) {
  const n = await carregar(db, id);
  const mapa: Record<string, string> = { contatoNome: 'contato_nome', contatoEmail: 'contato_email', contatoTelefone: 'contato_telefone', origem: 'origem', reuniaoEm: 'reuniao_em', reuniaoRealizada: 'reuniao_realizada', reuniaoNotas: 'reuniao_notas', etapa: 'etapa', motivoPerda: 'motivo_perda' };
  const sets = ['atualizado_em = now()']; const args: unknown[] = [id];
  for (const [k, v] of Object.entries(d)) { if (v === undefined) continue; args.push(v); sets.push(`${mapa[k]} = $${args.length}`); }
  // Marcar a reunião leva para a etapa de reunião; dizer que aconteceu leva para a proposta.
  if (d.reuniaoEm && n.etapa === 'prediagnostico' && !d.etapa) sets.push(`etapa = 'reuniao'`);
  if (d.reuniaoRealizada && ['prediagnostico', 'reuniao'].includes(n.etapa) && !d.etapa) sets.push(`etapa = 'proposta'`);
  await db.query(`UPDATE novos_clientes SET ${sets.join(', ')} WHERE id = $1`, args);
  await auditar(db, { organizacaoId: n.organizacao_id, usuarioId: i.usuarioId, acao: 'novo_cliente.editado', entidade: 'novo_cliente', entidadeId: id, depois: d });
  return obter(db, id);
}

/** Contrato fechado: cria o projeto e dispara o onboarding. */
export async function fecharContrato(db: PoolClient, id: string, d: z.infer<typeof EsquemaContrato>, i: Identidade) {
  const n = await carregar(db, id);
  if (n.projeto_id) throw new PedidoInvalido('o contrato deste cliente já foi fechado');
  const pj = await projetos.criar(db, { nome: d.nomeProjeto ?? n.nome, tipo: d.tipoProjeto, prioridade: 3, resumo: d.honorarios ? `Honorários combinados: ${d.honorarios}` : undefined,
    cliente: n.cnpj ? { razaoSocial: n.nome, cnpj: n.cnpj } : { razaoSocial: n.nome } }, i);
  // Responsável escolhido passa a liderar (quem criou fica como apoio).
  await db.query(`UPDATE projetos SET responsavel_id = $2, equipes = ARRAY[$3]::text[] WHERE id = $1`, [pj.id, d.responsavelId, d.area]);
  if (d.responsavelId !== i.usuarioId) {
    await db.query(`UPDATE projeto_equipe SET papel = 'apoio' WHERE projeto_id = $1 AND usuario_id = $2`, [pj.id, i.usuarioId]);
    await db.query(`INSERT INTO projeto_equipe (projeto_id, organizacao_id, usuario_id, papel) SELECT $1, organizacao_id, $2, 'lider' FROM projetos WHERE id = $1 ON CONFLICT DO NOTHING`, [pj.id, d.responsavelId]).catch(() => undefined);
  }
  if (n.prediagnostico_id) await db.query('UPDATE prediagnosticos SET projeto_id = $2 WHERE id = $1', [n.prediagnostico_id, pj.id]);
  const checklist = await aplicarModelo(db, pj.id, i).catch(() => ({ criados: 0 }));
  const { rows: [p] } = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [pj.id]);
  for (const [k, t] of TAREFAS_ONBOARDING.entries()) {
    await db.query(`INSERT INTO tarefas (organizacao_id, projeto_id, titulo, descricao, prioridade, responsavel_id, prazo, origem, chave_playbook, criado_por, tipo, fase)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'automacao',$8,$9,'tarefa','Onboarding') ON CONFLICT DO NOTHING`,
      [p!.organizacao_id, pj.id, t.titulo, t.detalhe, k < 3 ? 'alta' : 'media', t.quem === 'responsavel' ? d.responsavelId : i.usuarioId, somarDias(t.dias), `onboarding:${k}`, i.usuarioId]);
  }
  const { rows: [resp] } = await db.query<{ nome: string }>('SELECT nome FROM usuarios WHERE id = $1', [d.responsavelId]);
  await db.query(`UPDATE novos_clientes SET etapa = 'onboarding', area = $2, tipo_projeto = $3, honorarios = $4, contrato_em = $5, responsavel_id = $6, projeto_id = $7, atualizado_em = now() WHERE id = $1`,
    [id, d.area, d.tipoProjeto, d.honorarios ?? null, d.contratoEm ?? somarDias(0), d.responsavelId, pj.id]);
  await db.query(`INSERT INTO celebracoes (organizacao_id, projeto_id, titulo, area, responsavel, criado_por) VALUES ($1,$2,$3,$4,$5,$6)`,
    [p!.organizacao_id, pj.id, n.nome, d.area, resp?.nome ?? null, i.usuarioId]);
  await auditar(db, { organizacaoId: p!.organizacao_id, usuarioId: i.usuarioId, acao: 'novo_cliente.contrato_fechado', entidade: 'projeto', entidadeId: pj.id, depois: { area: d.area, tipo: d.tipoProjeto } });
  return { ...(await obter(db, id)), checklist: checklist.criados ?? 0 };
}

/** Comemorações dos últimos dias (a tela mostra cada uma uma vez por pessoa). */
export async function celebracoes(db: PoolClient) {
  return (await db.query(`SELECT c.id, c.titulo, c.area, c.responsavel, c.projeto_id "projetoId", c.criado_em "criadoEm", u.nome "fechadoPor"
     FROM celebracoes c LEFT JOIN usuarios u ON u.id = c.criado_por WHERE c.criado_em > now() - interval '3 days' ORDER BY c.criado_em DESC LIMIT 5`)).rows;
}
