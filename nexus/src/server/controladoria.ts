/**
 * Controladoria: as publicações do DJEN para as OABs dos sócios.
 *
 * Fonte: a API pública de comunicações do CNJ (comunicaapi.pje.jus.br), sem credencial. O que ela devolve é
 * DADO DE TERCEIROS (o texto da publicação), então é guardado e exibido como texto, nunca interpretado como
 * instrução, e fica restrito a quem tem `controladoria.ler` — uma publicação pode citar outros clientes.
 *
 * O que a coleta NÃO faz: calcular prazo sozinha. O prazo nasce de uma pessoa clicando em "Calcular prazo" com
 * a publicação à vista, porque a contagem exige conferência (feriado local, intimação pessoal, dobra).
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar, type Banco } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { textoPublicacao } from './publicacao_analise.ts';

const URL_DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

export interface ItemDjen {
  id: number; data_disponibilizacao: string; siglaTribunal?: string; tipoComunicacao?: string; nomeOrgao?: string;
  texto: string; numero_processo?: string; link?: string; nomeClasse?: string;
  destinatarios?: Array<{ nome: string; polo?: string }>;
  destinatarioadvogados?: Array<{ advogado?: { numero_oab?: string; uf_oab?: string } }>;
}
export interface PedidoDjen { numeroOab: string; ufOab: string; inicio: string; fim: string; pagina: number; itensPorPagina: number }
export type Buscador = (p: PedidoDjen) => Promise<{ count: number; items: ItemDjen[] }>;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Busca no DJEN com tentativas: a API responde "muito ocupado" com frequência, e isso não é motivo para desistir. */
export const buscarNoDjen: Buscador = async (p) => {
  const q = new URLSearchParams({
    numeroOab: p.numeroOab, ufOab: p.ufOab, dataDisponibilizacaoInicio: p.inicio, dataDisponibilizacaoFim: p.fim,
    pagina: String(p.pagina), itensPorPagina: String(p.itensPorPagina),
  });
  let ultimo = 'sem resposta';
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      const r = await fetch(`${URL_DJEN}?${q}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
      const j = await r.json() as { status?: string; message?: string; count?: number; items?: ItemDjen[] };
      if (r.ok && j.status === 'success') return { count: j.count ?? 0, items: j.items ?? [] };
      ultimo = j.message ?? `HTTP ${r.status}`;
    } catch (e) { ultimo = (e as Error).message; }
    await dormir(1500 * (tentativa + 1));
  }
  throw new Error(`DJEN indisponível: ${ultimo}`);
};

export const EsquemaOab = z.object({
  nome: z.string().trim().min(2).max(200),
  numeroOab: z.string().trim().regex(/^\d{1,8}$/, 'só os dígitos do número da OAB'),
  ufOab: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'sigla da UF com duas letras'),
});

export async function listarOabs(db: PoolClient) {
  const { rows } = await db.query(
    `SELECT o.id, o.nome, o.numero_oab, o.uf_oab, o.ativo, o.ultima_sincronizacao, o.ultimo_erro,
            (SELECT count(*)::int FROM publicacoes p WHERE o.nome = ANY(p.oabs)) AS publicacoes
       FROM oabs_monitoradas o ORDER BY o.ativo DESC, o.nome`);
  return rows;
}

export async function cadastrarOab(db: PoolClient, d: z.infer<typeof EsquemaOab>, identidade: Identidade) {
  const org = identidade.organizacoes.find((o) => o.tipo === 'escritorio')?.id;
  if (!org) throw new PedidoInvalido('usuário não pertence ao escritório');
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO oabs_monitoradas (organizacao_id, nome, numero_oab, uf_oab, criado_por) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (organizacao_id, numero_oab, uf_oab) DO UPDATE SET nome = EXCLUDED.nome, ativo = TRUE RETURNING id`,
    [org, d.nome, d.numeroOab, d.ufOab, identidade.usuarioId]);
  await auditar(db, { organizacaoId: org, usuarioId: identidade.usuarioId, acao: 'controladoria.oab_cadastrada', entidade: 'oab', entidadeId: rows[0]!.id, depois: { nome: d.nome, oab: `${d.numeroOab}/${d.ufOab}` } });
  return { id: rows[0]!.id };
}

export async function alternarOab(db: PoolClient, id: string, ativo: boolean, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; nome: string }>('UPDATE oabs_monitoradas SET ativo = $2 WHERE id = $1 RETURNING organizacao_id, nome', [id, ativo]);
  if (!rows[0]) throw new NaoEncontrado('OAB não encontrada');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: ativo ? 'controladoria.oab_ativada' : 'controladoria.oab_pausada', entidade: 'oab', entidadeId: id, depois: { nome: rows[0].nome } });
  return { ok: true };
}

const soDigitos = (s: string | undefined) => (s ?? '').replace(/\D/g, '');
const somarDiasISO = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export interface ResultadoDaSincronizacao { oab: string; consultadas: number; novas: number; erro: string | null }

/** Sincroniza UMA OAB. Janela: desde 2 dias antes da última sincronização (ou 7 dias na primeira vez) até hoje. */
export async function sincronizarOab(
  db: PoolClient, oab: { id: string; organizacao_id: string; nome: string; numero_oab: string; uf_oab: string; ultima_sincronizacao: Date | null },
  buscar: Buscador, hoje: string, pausa = 700,
): Promise<ResultadoDaSincronizacao> {
  const inicio = oab.ultima_sincronizacao ? somarDiasISO(new Date(oab.ultima_sincronizacao).toISOString().slice(0, 10), -2) : somarDiasISO(hoje, -7);
  let novas = 0; let consultadas = 0; const vistos = new Set<number>();
  try {
    for (let pagina = 1; pagina <= 30; pagina++) {
      const r = await buscar({ numeroOab: oab.numero_oab, ufOab: oab.uf_oab, inicio, fim: hoje, pagina, itensPorPagina: 100 });
      for (const it of r.items) {
        if (!publicacaoNoPeriodo(it, inicio, hoje) || vistos.has(it.id)) continue;
        // If the source identifies lawyers, verify the requested OAB instead of trusting a broad search.
        const advogados = it.destinatarioadvogados?.map(a=>a.advogado).filter(Boolean);
        if (advogados?.length && !advogados.some(a=>soDigitos(a?.numero_oab)===soDigitos(oab.numero_oab) && a?.uf_oab?.toUpperCase()===oab.uf_oab.toUpperCase())) continue;
        vistos.add(it.id); consultadas++;
        const numero = soDigitos(it.numero_processo);
        const { rows } = await db.query<{ nova: boolean }>(
          `INSERT INTO publicacoes (organizacao_id, comunicacao_id, oabs, data_disponibilizacao, tribunal, tipo, orgao, numero_processo, classe, texto, link, destinatarios, processo_id)
           VALUES ($1,$2,ARRAY[$3],$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,
                   (SELECT id FROM processos WHERE organizacao_id=$1 AND $8 <> '' AND regexp_replace(numero,'\\D','','g') = $8 LIMIT 1))
           ON CONFLICT (organizacao_id, comunicacao_id) DO UPDATE
             SET oabs = (SELECT array_agg(DISTINCT x) FROM unnest(publicacoes.oabs || EXCLUDED.oabs) x)
           RETURNING id,(xmax = 0) AS nova`,
          [oab.organizacao_id, it.id, oab.nome, it.data_disponibilizacao, it.siglaTribunal ?? null, it.tipoComunicacao ?? null, it.nomeOrgao ?? null,
           numero, it.nomeClasse ?? null, it.texto ?? '', it.link ?? null, JSON.stringify(it.destinatarios ?? [])]);
        if (rows[0]?.nova) novas++;
        if (rows[0]) await assegurarTarefaDeAnalise(db,(rows[0] as {id?:string}).id);
      }
      if (r.items.length < 100 || pagina * 100 >= r.count) break;
      if (pagina === 30) throw new Error('DJEN: coleta incompleta (mais de 3.000 publicações no período); a sincronização não foi marcada como concluída.');
      await dormir(pausa);
    }
    await db.query('UPDATE oabs_monitoradas SET ultima_sincronizacao = now(), ultimo_erro = NULL WHERE id = $1', [oab.id]);
    return { oab: `${oab.numero_oab}/${oab.uf_oab}`, consultadas, novas, erro: null };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await db.query('UPDATE oabs_monitoradas SET ultimo_erro = $2 WHERE id = $1', [oab.id, msg]);
    return { oab: `${oab.numero_oab}/${oab.uf_oab}`, consultadas, novas, erro: msg };
  }
}

/** Sincroniza todas as OABs ativas (a da organização do usuário). */
export async function sincronizar(db: PoolClient, identidade: Identidade, buscar: Buscador = buscarNoDjen, pausa = 700) {
  const { rows } = await db.query(
    `SELECT id, organizacao_id, nome, numero_oab, uf_oab, ultima_sincronizacao FROM oabs_monitoradas WHERE ativo ORDER BY nome`);
  const hoje = hojeSaoPaulo();
  const resultados: ResultadoDaSincronizacao[] = [];
  for (const oab of rows) resultados.push(await sincronizarOab(db, oab, buscar, hoje, pausa));
  const novas = resultados.reduce((t, r) => t + r.novas, 0);
  if (rows[0]) await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'controladoria.sincronizada', entidade: 'oab', entidadeId: null, depois: { oabs: rows.length, novas } });
  return { resultados, novas };
}

// ------------------------------------------------------------- consulta ---

export const SITUACOES_PUB = ['nova', 'lida', 'tratada', 'descartada'] as const;
export const hojeSaoPaulo = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function publicacaoNoPeriodo(item: ItemDjen, inicio: string, fim: string) {
  const date=item.data_disponibilizacao?.slice(0,10);
  return Number.isSafeInteger(item.id) && item.id > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date??'') && date>=inicio && date<=fim;
}
export interface FiltroPublicacoes { situacao?: string; oab?: string; q?: string; pagina?: number; inicio?: string; fim?: string; periodo?: string }

export async function listarPublicacoes(db: PoolClient, f: FiltroPublicacoes = {}) {
  const cond: string[] = []; const args: unknown[] = [];
  const hoje=hojeSaoPaulo();
  const inicio=f.inicio??(f.periodo==='todas'?null:hoje); const fim=f.fim??(f.periodo==='todas'?null:hoje);
  if(inicio && !/^\d{4}-\d{2}-\d{2}$/.test(inicio) || fim && !/^\d{4}-\d{2}-\d{2}$/.test(fim) || inicio && fim && inicio>fim) throw new PedidoInvalido('Período inválido.');
  if(inicio){args.push(inicio);cond.push(`p.data_disponibilizacao >= $${args.length}::date`);}
  if(fim){args.push(fim);cond.push(`p.data_disponibilizacao <= $${args.length}::date`);}
  if (f.oab) { args.push(f.oab); cond.push(`$${args.length} = ANY(p.oabs)`); }
  if (f.q) { args.push(`%${f.q.replace(/[%_]/g, '')}%`); cond.push(`(p.texto ILIKE $${args.length} OR p.numero_processo ILIKE $${args.length} OR p.orgao ILIKE $${args.length})`); }
  const resumoOnde=cond.length ? `WHERE ${cond.join(' AND ')}` : '';const resumoArgs=[...args];
  if (f.situacao && f.situacao !== 'todas') { args.push(f.situacao); cond.push(`p.situacao = $${args.length}`); }
  else if (!f.situacao) cond.push(`p.situacao <> 'descartada'`);
  const onde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT p.id, p.comunicacao_id, p.oabs, p.data_disponibilizacao, p.tribunal, p.tipo, p.orgao, p.numero_processo, p.classe, p.texto, p.link,
            p.destinatarios, p.processo_id, p.prazo_id, p.situacao, p.observacao, p.tratada_em, p.criado_em,
            pr.numero AS processo_numero, pr.projeto_id, pj.nome AS projeto, u.nome AS tratada_por_nome
       FROM publicacoes p LEFT JOIN processos pr ON pr.id = p.processo_id LEFT JOIN projetos pj ON pj.id = pr.projeto_id LEFT JOIN usuarios u ON u.id = p.tratada_por
       ${onde} ORDER BY p.data_disponibilizacao DESC, p.comunicacao_id DESC LIMIT 200 OFFSET ${Math.max(0, ((f.pagina ?? 1) - 1) * 200)}`, args);
  if(rows.length)await assegurarTarefaDeAnalise(db,rows.map(p=>p.id));
  const { rows: cont } = await db.query<{ situacao: string; n: number }>(`SELECT p.situacao, count(*)::int n FROM publicacoes p ${resumoOnde} GROUP BY p.situacao`,resumoArgs);
  const {rows:totais}=await db.query('SELECT count(*)::int AS historico,count(*) FILTER(WHERE data_disponibilizacao=$1::date)::int AS hoje FROM publicacoes',[hoje]);
  const por = Object.fromEntries(cont.map((c) => [c.situacao, c.n]));
  return { publicacoes: rows.map(p=>({...p,texto_legivel:textoPublicacao(String(p.texto??''))})), periodo:{inicio,fim}, totais:totais[0], resumo: { novas: por['nova'] ?? 0, lidas: por['lida'] ?? 0, tratadas: por['tratada'] ?? 0, descartadas: por['descartada'] ?? 0 } };
}

export const EsquemaPublicacaoAtualizacao = z.object({
  situacao: z.enum(SITUACOES_PUB).optional(),
  observacao: z.string().max(2000).nullable().optional(),
  processoId: z.string().uuid().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a atualizar');

export async function atualizarPublicacao(db: PoolClient, id: string, d: z.infer<typeof EsquemaPublicacaoAtualizacao>, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; situacao: string }>('SELECT organizacao_id, situacao FROM publicacoes WHERE id = $1', [id]);
  if (!rows[0]) throw new NaoEncontrado('publicação não encontrada');
  const sets: string[] = []; const args: unknown[] = [id];
  const campo = (c: string, v: unknown) => { args.push(v); sets.push(`${c} = $${args.length}`); };
  if (d.observacao !== undefined) campo('observacao', d.observacao);
  if (d.processoId !== undefined) campo('processo_id', d.processoId);
  if (d.situacao !== undefined) {
    campo('situacao', d.situacao);
    if (d.situacao === 'tratada') { campo('tratada_por', identidade.usuarioId); sets.push('tratada_em = now()'); }
    else { sets.push('tratada_por = NULL'); sets.push('tratada_em = NULL'); }
  }
  await db.query(`UPDATE publicacoes SET ${sets.join(', ')} WHERE id = $1`, args);
  if(d.processoId)await assegurarTarefaDeAnalise(db,id);
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'controladoria.publicacao_atualizada', entidade: 'publicacao', entidadeId: id, antes: { situacao: rows[0].situacao }, depois: { situacao: d.situacao } });
  return { ok: true };
}

/** Analysis is an internal task; the procedural deadline is a separate record. */
export async function assegurarTarefaDeAnalise(db:PoolClient,publicacaoId?:string|string[]) {
  if(!publicacaoId)return;
  await db.query(`INSERT INTO tarefas(organizacao_id,projeto_id,titulo,descricao,responsavel_id,prazo,origem,origem_id,chave_playbook,criado_por)
    SELECT p.organizacao_id,pr.projeto_id,'Analisar intimação · '||coalesce(pr.numero,p.numero_processo),
           'Conferir íntegra da publicação DJEN, identificar providências e validar o prazo processual antes de agendar.',
           pj.responsavel_id,CURRENT_DATE,'manual',p.id,'djen-analise:'||p.id::text,app_usuario_id()
      FROM publicacoes p JOIN processos pr ON pr.id=p.processo_id AND pr.organizacao_id=p.organizacao_id
      JOIN projetos pj ON pj.id=pr.projeto_id AND pj.organizacao_id=p.organizacao_id
     WHERE p.id=ANY($1::uuid[]) AND p.situacao<>'descartada' AND p.prazo_id IS NULL
    ON CONFLICT(projeto_id,chave_playbook) WHERE chave_playbook IS NOT NULL DO NOTHING`,[Array.isArray(publicacaoId)?publicacaoId:[publicacaoId]]);
}
export async function detalharPublicacao(db:PoolClient,id:string){
 const {rows}=await db.query(`SELECT p.*,pr.numero AS processo_numero,pr.projeto_id,pj.nome AS projeto,u.nome AS responsavel
   FROM publicacoes p LEFT JOIN processos pr ON pr.id=p.processo_id AND pr.organizacao_id=p.organizacao_id
   LEFT JOIN projetos pj ON pj.id=pr.projeto_id LEFT JOIN usuarios u ON u.id=pj.responsavel_id WHERE p.id=$1`,[id]);
 const p=rows[0];if(!p)throw new NaoEncontrado('Publicação não encontrada.');
 await assegurarTarefaDeAnalise(db,id);
 return {...p,texto_legivel:textoPublicacao(String(p.texto??''))};
}

// ------------------------------------------------------- rotina agendada ---

let hashDeServico: string | null = null;

/** Roda a sincronização de todas as organizações com OAB ativa, sem ninguém logado. Nunca lança. */
export async function sincronizarAgendado(banco: Banco, buscar: Buscador = buscarNoDjen): Promise<ResultadoDaSincronizacao[]> {
  const todos: ResultadoDaSincronizacao[] = [];
  try {
    const orgs = await banco.semContexto(async (db) => (await db.query<{ organizacoes_com_oab_ativa: string }>('SELECT organizacoes_com_oab_ativa()')).rows.map((r) => r.organizacoes_com_oab_ativa));
    hashDeServico ??= await Bun.password.hash(crypto.randomUUID() + crypto.randomUUID(), { algorithm: 'argon2id' });
    for (const org of orgs) {
      const usuarioId = await banco.semContexto(async (db) => (await db.query<{ u: string }>('SELECT usuario_de_servico_da_organizacao($1,$2,$3) AS u', [org, 'controladoria', hashDeServico])).rows[0]!.u);
      const identidade: Identidade = { usuarioId, nome: 'Rotina: controladoria', email: 'controladoria@nga.local', papeis: ['integracao'], organizacoes: [{ id: org, nome: '', tipo: 'escritorio', papel: 'integracao' }] };
      const r = await banco.comoUsuario(usuarioId, (db) => sincronizar(db, identidade, buscar));
      todos.push(...r.resultados);
    }
  } catch (e) { console.error('controladoria: rotina agendada falhou:', (e as Error).message); }
  return todos;
}

/** One confirmed publication produces one deadline and its linked work item. */
export const EsquemaAgendamento = z.object({
  titulo:z.string().trim().min(1).max(200), dias:z.number().int().positive().max(3650),
  regime:z.enum(['uteis','corridos']).default('uteis'), responsavelId:z.string().uuid().optional(),
  feriadosLocais:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).default([]),
});
export async function agendarPublicacao(db:PoolClient,id:string,d:z.infer<typeof EsquemaAgendamento>,i:Identidade) {
  const {rows}=await db.query(`SELECT p.*,pr.projeto_id FROM publicacoes p LEFT JOIN processos pr ON pr.id=p.processo_id AND pr.organizacao_id=p.organizacao_id WHERE p.id=$1 FOR UPDATE OF p`,[id]);const p=rows[0];
  if(!p)throw new NaoEncontrado('Publicação não encontrada.');
  if(p.prazo_id)return {prazoId:p.prazo_id,repetido:true};
  if(!p.processo_id||!p.projeto_id)throw new PedidoInvalido('Vincule a publicação a um processo e projeto antes de agendar.');
  await assegurarTarefaDeAnalise(db,id);
  const {criarPrazo}=await import('./processos.ts');
  const data = p.data_disponibilizacao instanceof Date ? p.data_disponibilizacao.toISOString().slice(0,10) : String(p.data_disponibilizacao).slice(0,10);
  const prazo=await criarPrazo(db,p.processo_id,{titulo:d.titulo,evento:data,origem:'disponibilizacao_dje',dias:d.dias,regime:d.regime,emDobro:false,feriadosLocais:d.feriadosLocais,...(d.responsavelId?{responsavelId:d.responsavelId}:{})},i);
  await db.query(`INSERT INTO tarefas(organizacao_id,projeto_id,titulo,descricao,responsavel_id,prazo,origem,origem_id,criado_por) VALUES($1,$2,$3,$4,$5,$6,'prazo',$7,$8)`,[p.organizacao_id,p.projeto_id,d.titulo,'Publicação DJEN '+p.comunicacao_id+' — contagem confirmada pela controladoria',d.responsavelId??i.usuarioId,prazo.vencimento,prazo.id,i.usuarioId]);
  await db.query("UPDATE publicacoes SET prazo_id=$2,situacao='tratada',tratada_por=$3,tratada_em=now() WHERE id=$1",[id,prazo.id,i.usuarioId]);
  await db.query("UPDATE tarefas SET status='concluida',concluida_em=now(),concluida_por=$2,atualizado_em=now() WHERE projeto_id=$3 AND chave_playbook=$1 AND status<>'concluida'",['djen-analise:'+id,i.usuarioId,p.projeto_id]);
  return {prazoId:prazo.id,...prazo,repetido:false};
}

export const EsquemaVinculoPublicacao=z.object({projetoId:z.string().uuid()});
/** An explicit project selection fixes orphan publications; no client-name guessing. */
export async function vincularProjetoDaPublicacao(db:PoolClient,id:string,projetoId:string,identidade:Identidade){
 const pub=(await db.query('SELECT * FROM publicacoes WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!pub)throw new NaoEncontrado('Publicação não encontrada.');
 const project=(await db.query('SELECT id,organizacao_id FROM projetos WHERE id=$1 AND organizacao_id=$2',[projetoId,pub.organizacao_id])).rows[0];if(!project)throw new NaoEncontrado('Projeto não encontrado no escritório desta publicação.');
 const number=soDigitos(pub.numero_processo);if(!number)throw new PedidoInvalido('A publicação não contém número do processo. Cadastre e confira o processo antes de vincular.');
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[pub.organizacao_id+':processo:'+number]);
 const existing=(await db.query('SELECT id,projeto_id FROM processos WHERE organizacao_id=$1 AND regexp_replace(numero,\'\\D\',\'\',\'g\')=$2',[pub.organizacao_id,number])).rows[0];
 let processoId:string;
 if(existing){
  if(existing.projeto_id&&existing.projeto_id!==projetoId)throw new PedidoInvalido('Este processo já está vinculado a outro projeto. Confira o cadastro para evitar misturar clientes.');
  processoId=existing.id;await db.query('UPDATE processos SET projeto_id=$2 WHERE id=$1',[processoId,projetoId]);
 }else{
  const {criar}=await import('./processos.ts');const r=await criar(db,{numero:number,projetoId,tribunal:pub.tribunal??undefined,classe:pub.classe??undefined,segredoJustica:false},identidade);processoId=r.id;
 }
 await atualizarPublicacao(db,id,{processoId},identidade);
 return detalharPublicacao(db,id);
}
