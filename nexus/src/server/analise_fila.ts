/** The local worker reads durable portal uploads, including uploads through the hosted API. */
import type {Banco} from '../store/conexao.ts';
import type {Provedor} from '../ai/provedor.ts';
import type {Deposito} from './arquivos.ts';
import {processar} from './analise_auto.ts';
export async function processarFilaAnalise(banco:Banco,dep:Deposito,provedor:Provedor){
 const docs=await banco.semContexto(async db=>(await db.query<{documento_id:string}>('SELECT * FROM documentos_de_analise_pendentes(1)')).rows);
 for(const d of docs)await processar(banco,dep,provedor,d.documento_id);
 return docs.length;
}
