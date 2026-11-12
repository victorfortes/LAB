/**
 * Confronto da Controladoria com a base do Astrea (planilha "Processos").
 *
 * O que faz, nesta ordem, e é idempotente (rodar de novo não duplica nada):
 *   1. lê a planilha e agrupa os registros por etiqueta de cliente (`Cliente: X`);
 *   2. cria o projeto de cada etiqueta que ainda não tem (e registra a etiqueta nele);
 *   3. cadastra os processos com número CNJ válido e VINCULA ao projeto os que já existiam soltos;
 *   4. guarda todos os registros como vieram (inclusive os sem número CNJ);
 *   5. vincula as publicações do DJEN ao processo pelo número, e daí ao projeto.
 *
 * Sem `aplicar`, só conta o que faria. O que a planilha não resolve (processo sem etiqueta de cliente,
 * sem número CNJ válido) é devolvido em números, nunca chutado.
 */
import type { PoolClient } from 'pg';
import { lerXlsx } from '../domain/analise/planilha.ts';
import { interpretarLinha, type RegistroAstrea } from '../domain/processo/astrea.ts';
import { criar as criarProjeto, EsquemaProjeto } from './projetos.ts';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { PedidoInvalido } from './erros.ts';

const lote = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

export interface RelatorioDoConfronto {
  aplicado: boolean;
  planilha: { linhas: number; registros: number; clientes: number; processosComCnj: number; semCnj: number; semEtiqueta: number };
  projetosCriados: number; projetosJaExistentes: number;
  processosNovos: number; processosVinculadosAProjeto: number; registrosNovos: number;
  /** Registros sem etiqueta ligados ao projeto do MESMO cliente já etiquetado (nome igual, um só projeto). */
  vinculadosPeloNomeDoCliente: { registros: number; processos: number };
  publicacoes: { vinculadasAoProcesso: number; semProcesso: number; semProjeto: number };
}

export async function confrontar(db: PoolClient, bytes: Uint8Array, identidade: Identidade, aplicar: boolean): Promise<RelatorioDoConfronto> {
  const org = identidade.organizacoes.find((o) => o.tipo === 'escritorio')?.id;
  if (!org) throw new PedidoInvalido('usuário não pertence ao escritório');
  const abas = (() => { try { return lerXlsx(bytes); } catch { throw new PedidoInvalido('não consegui ler a planilha: envie o .xlsx exportado do Astrea'); } })();
  const aba = abas.find((a) => a.nome === 'Processos');
  if (!aba) throw new PedidoInvalido('a planilha precisa ter a aba "Processos"');
  const [cab, ...linhas] = aba.linhas;
  if (!cab || !cab.includes('Número') || !cab.includes('Etiquetas')) throw new PedidoInvalido('colunas inesperadas: confira se é a exportação "Processos" do Astrea');

  const unicos = new Map<string, RegistroAstrea>();
  for (const l of linhas) { if (!l.some((x) => x.trim())) continue; const r = interpretarLinha(cab, l); unicos.set(r.chave, r); }
  const regs = [...unicos.values()];
  const etiquetas = [...new Set(regs.map((r) => r.clienteEtiqueta).filter(Boolean))] as string[];
  const porNumero = new Map<string, RegistroAstrea>();
  for (const r of regs) if (r.numeroCnj) { const a = porNumero.get(r.numeroCnj); if (!a || (!a.clienteEtiqueta && r.clienteEtiqueta)) porNumero.set(r.numeroCnj, r); }

  const rel: RelatorioDoConfronto = {
    aplicado: aplicar,
    planilha: { linhas: linhas.length, registros: regs.length, clientes: etiquetas.length, processosComCnj: porNumero.size, semCnj: regs.filter((r) => !r.numeroCnj).length, semEtiqueta: regs.filter((r) => !r.clienteEtiqueta).length },
    projetosCriados: 0, projetosJaExistentes: 0, processosNovos: 0, processosVinculadosAProjeto: 0, registrosNovos: 0,
    vinculadosPeloNomeDoCliente: { registros: 0, processos: 0 },
    publicacoes: { vinculadasAoProcesso: 0, semProcesso: 0, semProjeto: 0 },
  };

  const existentes = new Map<string, string>(
    (await db.query<{ id: string; etiqueta_astrea: string }>('SELECT id, etiqueta_astrea FROM projetos WHERE organizacao_id = $1 AND etiqueta_astrea IS NOT NULL', [org])).rows.map((r) => [r.etiqueta_astrea, r.id]));
  rel.projetosJaExistentes = etiquetas.filter((e) => existentes.has(e)).length;

  // Nome do cliente → etiqueta, só quando o nome aponta para UMA etiqueta (nome ambíguo nunca é chutado).
  const nomeParaEtiqueta = new Map<string, Set<string>>();
  const chaveNome = (n: string) => n.trim().toLowerCase();
  for (const r of regs) if (r.clienteEtiqueta && r.clienteNome) { const k = chaveNome(r.clienteNome); (nomeParaEtiqueta.get(k) ?? nomeParaEtiqueta.set(k, new Set()).get(k)!).add(r.clienteEtiqueta); }
  const porNome = regs.filter((r) => !r.clienteEtiqueta && r.clienteNome && nomeParaEtiqueta.get(chaveNome(r.clienteNome))?.size === 1);

  if (!aplicar) {
    rel.vinculadosPeloNomeDoCliente = { registros: porNome.length, processos: new Set(porNome.map((r) => r.numeroCnj).filter(Boolean)).size };
    rel.projetosCriados = etiquetas.length - rel.projetosJaExistentes;
    const { rows } = await db.query<{ novos: string; soltos: string }>(
      `SELECT count(*) FILTER (WHERE pr.id IS NULL) AS novos, count(*) FILTER (WHERE pr.id IS NOT NULL AND pr.projeto_id IS NULL) AS soltos
         FROM unnest($2::text[]) AS n(numero) LEFT JOIN processos pr ON pr.organizacao_id = $1 AND pr.numero = n.numero`, [org, [...porNumero.keys()]]);
    rel.processosNovos = Number(rows[0]!.novos); rel.processosVinculadosAProjeto = Number(rows[0]!.soltos);
    return rel;
  }

  // Projetos por etiqueta.
  for (const et of etiquetas) {
    if (existentes.has(et)) continue;
    const reest = regs.some((r) => r.clienteEtiqueta === et && r.reestruturacao);
    const nome = et === 'Pessoa Física' ? 'Pessoa Física (carteira)' : et;
    const d = EsquemaProjeto.parse({ nome, tipo: reest ? 'reestruturacao' : 'contencioso_estrategico', resumo: 'Cliente importado da etiqueta do Astrea.', cliente: { razaoSocial: nome } });
    const p = await criarProjeto(db, d, identidade);
    await db.query('UPDATE projetos SET etiqueta_astrea = $2 WHERE id = $1', [p.id, et]);
    existentes.set(et, p.id); rel.projetosCriados++;
  }

  // Processos: novos entram já com projeto; os que existiam soltos são vinculados.
  for (const b of lote([...porNumero.values()], 300)) {
    const dados = JSON.stringify(b.map((r) => ({ p: r.clienteEtiqueta ? existentes.get(r.clienteEtiqueta) : null, n: r.numeroCnj, c: r.acao.slice(0, 200) || null, a: r.objeto.slice(0, 300) || null, o: r.vara.slice(0, 200) || null, co: r.comarca?.slice(0, 120) ?? null, u: r.uf, v: r.valorCausa, d: r.distribuidoEm, s: r.situacao })));
    rel.processosNovos += (await db.query(
      `INSERT INTO processos (organizacao_id,projeto_id,numero,classe,assunto,orgao_julgador,comarca,uf,valor_causa,distribuido_em,situacao,suspenso_motivo,fonte,criado_por)
       SELECT $1,x.p,x.n,x.c,x.a,x.o,x.co,x.u,x.v,x.d,x.s,CASE WHEN x.s='suspenso' THEN 'Fase Suspenso no Astrea' END,'astrea',$2
         FROM jsonb_to_recordset($3::jsonb) AS x(p uuid,n text,c text,a text,o text,co text,u text,v bigint,d date,s text) ON CONFLICT (organizacao_id,numero) DO NOTHING`,
      [org, identidade.usuarioId, dados])).rowCount ?? 0;
    rel.processosVinculadosAProjeto += (await db.query(
      `UPDATE processos pr SET projeto_id = x.p FROM jsonb_to_recordset($2::jsonb) AS x(p uuid,n text)
        WHERE pr.organizacao_id = $1 AND pr.numero = x.n AND pr.projeto_id IS NULL AND x.p IS NOT NULL`, [org, dados])).rowCount ?? 0;
  }

  // Registros como vieram.
  for (const b of lote(regs, 300)) {
    rel.registrosNovos += (await db.query(
      `INSERT INTO astrea_registros (organizacao_id,projeto_id,processo_id,chave,tipo,titulo,cliente_nome,cliente_etiqueta,papel_cliente,outros_envolvidos,numero_original,acao,pasta,equipe,fase,responsavel,etiquetas,vara,foro,valor_causa,distribuido_em,ultimo_historico,url_processo)
       SELECT $1,x.p,(SELECT id FROM processos pr WHERE pr.organizacao_id=$1 AND pr.numero=x.cnj),x.chave,x.tipo,x.titulo,x.cn,x.ce,x.pc,x.oe,x.no,x.acao,x.pasta,x.eq,x.fase,x.resp,ARRAY(SELECT jsonb_array_elements_text(x.et)),x.vara,x.foro,x.v,x.d,x.uh,x.url
         FROM jsonb_to_recordset($2::jsonb) AS x(p uuid,cnj text,chave text,tipo text,titulo text,cn text,ce text,pc text,oe text,no text,acao text,pasta text,eq text,fase text,resp text,et jsonb,vara text,foro text,v bigint,d date,uh text,url text) ON CONFLICT (organizacao_id,chave) DO NOTHING`,
      [org, JSON.stringify(b.map((r) => ({ p: r.clienteEtiqueta ? existentes.get(r.clienteEtiqueta) : null, cnj: r.numeroCnj, chave: r.chave, tipo: r.tipo, titulo: r.titulo, cn: r.clienteNome, ce: r.clienteEtiqueta, pc: r.papelCliente, oe: r.outrosEnvolvidos, no: r.numeroOriginal, acao: r.acao, pasta: r.pasta, eq: r.equipe, fase: r.fase, resp: r.responsavel, et: r.etiquetas, vara: r.vara, foro: r.foro, v: r.valorCausa, d: r.distribuidoEm, uh: r.ultimoHistorico, url: r.urlProcesso })))])).rowCount ?? 0;
  }

  // Registros sem etiqueta cujo nome de cliente já está etiquetado em UM projeto: herdam esse projeto, e seus processos também.
  const heranca = await db.query(
    `WITH mapa AS (SELECT lower(btrim(cliente_nome)) AS nome, (array_agg(DISTINCT projeto_id))[1] AS projeto
                     FROM astrea_registros WHERE organizacao_id = $1 AND projeto_id IS NOT NULL AND cliente_etiqueta IS NOT NULL AND btrim(coalesce(cliente_nome,'')) <> ''
                    GROUP BY 1 HAVING count(DISTINCT projeto_id) = 1)
     UPDATE astrea_registros r SET projeto_id = m.projeto FROM mapa m
      WHERE r.organizacao_id = $1 AND r.projeto_id IS NULL AND lower(btrim(r.cliente_nome)) = m.nome`, [org]);
  const herdados = await db.query(
    `UPDATE processos pr SET projeto_id = r.projeto_id FROM astrea_registros r
      WHERE r.organizacao_id = $1 AND r.processo_id = pr.id AND pr.projeto_id IS NULL AND r.projeto_id IS NOT NULL`, [org]);
  rel.vinculadosPeloNomeDoCliente = { registros: heranca.rowCount ?? 0, processos: herdados.rowCount ?? 0 };

  const pub = await vincularPublicacoes(db, org);
  rel.publicacoes = pub;
  await auditar(db, { organizacaoId: org, usuarioId: identidade.usuarioId, acao: 'controladoria.confronto_astrea', entidade: 'organizacao', entidadeId: org, depois: { ...rel.planilha, projetosCriados: rel.projetosCriados, processosNovos: rel.processosNovos, vinculados: rel.processosVinculadosAProjeto, pelaNome: rel.vinculadosPeloNomeDoCliente, publicacoes: pub } });
  return rel;
}

/** Liga as publicações soltas ao processo (pelo número) e conta o que continua sem processo ou sem projeto. */
export async function vincularPublicacoes(db: PoolClient, org: string) {
  const { rows: v } = await db.query<{ n: number }>('SELECT controladoria_vincular_publicacoes($1) AS n', [org]);
  const { rows } = await db.query<{ sem_processo: string; sem_projeto: string }>(
    `SELECT count(*) FILTER (WHERE p.processo_id IS NULL) AS sem_processo,
            count(*) FILTER (WHERE p.processo_id IS NOT NULL AND pr.projeto_id IS NULL) AS sem_projeto
       FROM publicacoes p LEFT JOIN processos pr ON pr.id = p.processo_id
      WHERE p.organizacao_id = $1 AND p.situacao IN ('nova','lida')`, [org]);
  return { vinculadasAoProcesso: Number(v[0]?.n ?? 0), semProcesso: Number(rows[0]!.sem_processo), semProjeto: Number(rows[0]!.sem_projeto) };
}

/**
 * Vincula ao projeto certo os processos que ainda estão soltos, sem precisar da planilha:
 *   1. registro do Astrea sem etiqueta, mas com o MESMO nome de cliente de um projeto (um só) → herda o projeto;
 *   2. processo cujo registro do Astrea já tem projeto → o processo vai junto;
 *   3. processo cuja parte "cliente" tem o CNPJ de uma empresa de um único projeto → esse projeto;
 *   4. publicações do DJEN seguem o processo.
 * Sem `aplicar`, roda tudo dentro de um ponto de salvamento e desfaz: devolve só a contagem.
 */
export async function vincularProcessosAosProjetos(db: PoolClient, org: string, aplicar: boolean, identidade: Identidade) {
  await db.query('SAVEPOINT vinculo_projetos');
  const heranca = await db.query(
    `WITH mapa AS (SELECT lower(btrim(cliente_nome)) AS nome, (array_agg(DISTINCT projeto_id))[1] AS projeto
                     FROM astrea_registros WHERE organizacao_id = $1 AND projeto_id IS NOT NULL AND btrim(coalesce(cliente_nome,'')) <> ''
                    GROUP BY 1 HAVING count(DISTINCT projeto_id) = 1)
     UPDATE astrea_registros r SET projeto_id = m.projeto FROM mapa m
      WHERE r.organizacao_id = $1 AND r.projeto_id IS NULL AND lower(btrim(r.cliente_nome)) = m.nome`, [org]);
  const peloAstrea = await db.query(
    `UPDATE processos pr SET projeto_id = r.projeto_id, atualizado_em = now() FROM astrea_registros r
      WHERE r.organizacao_id = $1 AND pr.projeto_id IS NULL AND r.projeto_id IS NOT NULL
        AND (r.processo_id = pr.id OR regexp_replace(coalesce(r.numero_original, ''), '\\D', '', 'g') = regexp_replace(pr.numero, '\\D', '', 'g'))`, [org]);
  const peloCnpj = await db.query(
    `WITH alvo AS (SELECT pp.processo_id, (array_agg(DISTINCT pe.projeto_id))[1] AS projeto
                     FROM partes_processo pp JOIN empresas e ON regexp_replace(coalesce(e.cnpj, ''), '\\D', '', 'g') = regexp_replace(pp.documento, '\\D', '', 'g')
                     JOIN projetos_empresas pe ON pe.empresa_id = e.id JOIN projetos p ON p.id = pe.projeto_id AND p.situacao <> 'encerrado'
                    WHERE pp.organizacao_id = $1 AND pp.eh_cliente AND pp.tipo_documento = 'cnpj' GROUP BY 1 HAVING count(DISTINCT pe.projeto_id) = 1)
     UPDATE processos pr SET projeto_id = a.projeto, atualizado_em = now() FROM alvo a WHERE pr.id = a.processo_id AND pr.projeto_id IS NULL`, [org]);
  const pub = await vincularPublicacoes(db, org);
  const { rows: [r] } = await db.query<{ soltos: number; total: number }>(`SELECT count(*) FILTER (WHERE projeto_id IS NULL)::int AS soltos, count(*)::int AS total FROM processos WHERE organizacao_id = $1`, [org]);
  const { rows: amostra } = await db.query(
    `SELECT pr.id, pr.numero, pr.classe, (SELECT r.cliente_nome FROM astrea_registros r WHERE r.processo_id = pr.id OR regexp_replace(coalesce(r.numero_original, ''), '\\D', '', 'g') = regexp_replace(pr.numero, '\\D', '', 'g') LIMIT 1) AS cliente,
            (SELECT r.titulo FROM astrea_registros r WHERE r.processo_id = pr.id LIMIT 1) AS titulo
       FROM processos pr WHERE pr.organizacao_id = $1 AND pr.projeto_id IS NULL ORDER BY pr.criado_em DESC LIMIT 200`, [org]);
  const rel = { aplicado: aplicar, registrosPeloNome: heranca.rowCount ?? 0, processosPeloAstrea: peloAstrea.rowCount ?? 0, processosPeloCnpj: peloCnpj.rowCount ?? 0, publicacoes: pub, processos: r!.total, semProjeto: r!.soltos, amostraSemProjeto: amostra };
  if (aplicar) {
    await db.query('RELEASE SAVEPOINT vinculo_projetos');
    await auditar(db, { organizacaoId: org, usuarioId: identidade.usuarioId, acao: 'controladoria.processos_vinculados', entidade: 'organizacao', entidadeId: org, depois: { pelaNome: rel.registrosPeloNome, peloAstrea: rel.processosPeloAstrea, peloCnpj: rel.processosPeloCnpj } });
  } else await db.query('ROLLBACK TO SAVEPOINT vinculo_projetos');
  return rel;
}

/** Vínculo à mão, para o que nenhuma regra resolveu. */
export async function vincularProcessoManual(db: PoolClient, processoId: string, projetoId: string | null, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; numero: string }>('UPDATE processos SET projeto_id = $2, atualizado_em = now() WHERE id = $1 RETURNING organizacao_id, numero', [processoId, projetoId]);
  if (!rows[0]) throw new PedidoInvalido('processo não encontrado');
  await db.query('UPDATE publicacoes SET processo_id = $1 WHERE processo_id IS NULL AND regexp_replace(coalesce(numero_processo, \'\'), \'\\D\', \'\', \'g\') = $2', [processoId, rows[0].numero.replace(/\D/g, '')]);
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'controladoria.processo_vinculado', entidade: 'processo', entidadeId: processoId, depois: { projetoId } });
  return { ok: true };
}
