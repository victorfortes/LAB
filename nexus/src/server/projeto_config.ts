/** Configurações e notas internas, sempre ancoradas em um projeto alcançável. */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Identidade } from '../security/sessao.ts';
import { auditar } from '../store/conexao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

export const EsquemaNota = z.object({ chave: z.string().trim().min(1).max(120), resumo: z.string().max(12000).default(''), pontosAtencao: z.string().max(12000).default('') });
const campos = {
 nome: z.string().trim().min(1).max(200),
 gatilho: z.enum(['projeto_criado', 'documento_cliente_enviado']),
 tituloTarefa: z.string().trim().min(1).max(300),
 diasUteis: z.number().int().min(0).max(365).default(1),
 prioridade: z.enum(['baixa','media','alta','urgente']).default('media'),
 ativo: z.boolean().default(true),
 escopo: z.enum(['projeto','escritorio']).default('projeto'),
};
export const EsquemaAutomacao = z.object(campos);
// Defaults belong to creation only. Zod applies defaults inside optional() too,
// so partial() over the creation schema would silently reset a rule on PATCH.
export const EsquemaAtualizarAutomacao = z.object({
 nome: campos.nome.optional(), gatilho: campos.gatilho.optional(), tituloTarefa: campos.tituloTarefa.optional(),
 diasUteis: z.number().int().min(0).max(365).optional(),
 prioridade: z.enum(['baixa','media','alta','urgente']).optional(),
 ativo: z.boolean().optional(), escopo: z.enum(['projeto','escritorio']).optional(),
}).refine(x => Object.keys(x).length > 0, 'nada a atualizar');
async function projeto(db: PoolClient, id: string) {
 const r = await db.query<{ organizacao_id: string }>('SELECT organizacao_id FROM projetos WHERE id = $1', [id]);
 if (!r.rows[0]) throw new NaoEncontrado('projeto não encontrado');
 return r.rows[0];
}
export async function notas(db: PoolClient, projetoId: string) {
 await projeto(db, projetoId);
 return (await db.query('SELECT chave, resumo, pontos_atencao AS "pontosAtencao", atualizado_em AS "atualizadoEm" FROM projeto_playbook_notas WHERE projeto_id=$1 ORDER BY chave', [projetoId])).rows;
}
export async function salvarNota(db: PoolClient, projetoId: string, dados: z.infer<typeof EsquemaNota>, identidade: Identidade) {
 const p = await projeto(db, projetoId);
 const r = await db.query(`INSERT INTO projeto_playbook_notas(projeto_id,organizacao_id,chave,resumo,pontos_atencao,atualizado_por)
 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(projeto_id,chave) DO UPDATE SET resumo=EXCLUDED.resumo,pontos_atencao=EXCLUDED.pontos_atencao,atualizado_por=EXCLUDED.atualizado_por,atualizado_em=now()
 RETURNING chave,resumo,pontos_atencao AS "pontosAtencao",atualizado_em AS "atualizadoEm"`, [projetoId,p.organizacao_id,dados.chave,dados.resumo,dados.pontosAtencao,identidade.usuarioId]);
 await auditar(db,{organizacaoId:p.organizacao_id,usuarioId:identidade.usuarioId,acao:'playbook.nota_salva',entidade:'projeto',entidadeId:projetoId,depois:{chave:dados.chave}});
 return r.rows[0];
}
const selecionar = `id,nome,gatilho,titulo_tarefa AS "tituloTarefa",dias_uteis AS "diasUteis",prioridade,ativo,CASE WHEN projeto_id IS NULL THEN 'escritorio' ELSE 'projeto' END AS escopo`;
export async function automacoes(db: PoolClient, projetoId: string) {
 const p=await projeto(db,projetoId);
 return (await db.query(`SELECT ${selecionar} FROM automacoes WHERE organizacao_id=$2 AND (projeto_id=$1 OR projeto_id IS NULL) ORDER BY criado_em`,[projetoId,p.organizacao_id])).rows;
}
export async function criarAutomacao(db: PoolClient, projetoId: string, dados: z.infer<typeof EsquemaAutomacao>, identidade: Identidade) {
 const p=await projeto(db,projetoId);
 if(dados.gatilho==='projeto_criado' && dados.escopo==='projeto') throw new PedidoInvalido('para novos projetos, configure a regra para todo o escritório');
 const r=await db.query(`INSERT INTO automacoes(organizacao_id,projeto_id,nome,gatilho,titulo_tarefa,dias_uteis,prioridade,ativo,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[p.organizacao_id,dados.escopo==='escritorio'?null:projetoId,dados.nome,dados.gatilho,dados.tituloTarefa,dados.diasUteis,dados.prioridade,dados.ativo,identidade.usuarioId]);
 await auditar(db,{organizacaoId:p.organizacao_id,usuarioId:identidade.usuarioId,acao:'automacao.criada',entidade:'projeto',entidadeId:projetoId,depois:dados});
 return r.rows[0];
}
export async function atualizarAutomacao(db: PoolClient,id:string,dados:z.infer<typeof EsquemaAtualizarAutomacao>,identidade:Identidade) {
 const r=await db.query<{organizacao_id:string;projeto_id:string|null}>('SELECT organizacao_id,projeto_id FROM automacoes WHERE id=$1',[id]);
 if(!r.rows[0]) throw new NaoEncontrado('automação não encontrada');
 // Mudar o escopo exige criar regra explícita, evitando ampliar por engano uma regra local.
 if(dados.escopo) throw new PedidoInvalido('crie uma nova regra para alterar o escopo');
 const cols:Record<string,string>={nome:'nome',gatilho:'gatilho',tituloTarefa:'titulo_tarefa',diasUteis:'dias_uteis',prioridade:'prioridade',ativo:'ativo'};
 if(dados.gatilho==='projeto_criado' && r.rows[0].projeto_id) throw new PedidoInvalido('regra de novos projetos exige escopo de escritório');
 const args:unknown[]=[id]; const sets:string[]=[];
 for(const [k,v] of Object.entries(dados)) { args.push(v);sets.push(`${cols[k]}=$${args.length}`); }
 await db.query(`UPDATE automacoes SET ${sets.join(',')} WHERE id=$1`,args);
 await auditar(db,{organizacaoId:r.rows[0].organizacao_id,usuarioId:identidade.usuarioId,acao:'automacao.atualizada',entidade:'automacao',entidadeId:id,depois:dados});
 return {id};
}
export async function excluirAutomacao(db:PoolClient,id:string,identidade:Identidade) {
 const r=await db.query<{organizacao_id:string}>('DELETE FROM automacoes WHERE id=$1 RETURNING organizacao_id',[id]);
 if(!r.rows[0]) throw new NaoEncontrado('automação não encontrada');
 await auditar(db,{organizacaoId:r.rows[0].organizacao_id,usuarioId:identidade.usuarioId,acao:'automacao.excluida',entidade:'automacao',entidadeId:id});
 return {id,excluida:true};
}
/** Pesquisa nas evidências já cadastradas; não envia dados do cliente a buscadores públicos. */
export async function pesquisar(db:PoolClient,projetoId:string,consulta:string) {
 await projeto(db,projetoId);
 const q=consulta.trim(); if(q.length<2 || q.length>200) throw new PedidoInvalido('pesquisa deve ter entre 2 e 200 caracteres');
 const padrao='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
 const docs=await db.query(`SELECT d.id,d.titulo,d.origem,substring(t.texto FROM greatest(1,position(lower($3) in lower(t.texto))-100) FOR 450) AS trecho
 FROM documentos d LEFT JOIN documento_textos t ON t.documento_id=d.id
 WHERE d.projeto_id=$1 AND (d.titulo ILIKE $2 OR t.texto ILIKE $2) ORDER BY d.criado_em DESC LIMIT 30`,[projetoId,padrao,q]);
 const achados=await db.query(`SELECT a.id,a.titulo,a.descricao,a.natureza,d.titulo AS documento FROM achados a JOIN analises n ON n.id=a.analise_id JOIN documentos d ON d.id=n.documento_id WHERE n.projeto_id=$1 AND d.projeto_id=$1 AND (a.titulo ILIKE $2 OR a.descricao ILIKE $2) ORDER BY a.criado_em DESC LIMIT 30`,[projetoId,padrao]);
 return {projetoId,consulta:q,documentos:docs.rows,achados:achados.rows,escopo:'evidencias_do_projeto'};
}
