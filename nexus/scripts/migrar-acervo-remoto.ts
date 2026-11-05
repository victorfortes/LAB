/** Copia acervo legado para o PostgreSQL em transação por documento, sem apagar a origem.
 * Executar como administrador do schema com NGA_SUPABASE_URL e NGA_ACERVO configurados.
 */
import {Client} from 'pg';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {hashDoConteudo,chaveDoHash} from '../src/store/arquivos.ts';
const url=process.env.NGA_SUPABASE_URL, acervo=process.env.NGA_ACERVO;
if(!url||!acervo||!process.env.NGA_PG_CA)throw Error('Defina NGA_SUPABASE_URL, NGA_ACERVO e NGA_PG_CA sem colocar credenciais no código.');
const db=new Client({connectionString:url,ssl:{ca:readFileSync(process.env.NGA_PG_CA,'utf8'),rejectUnauthorized:true}});
await db.connect();
try {
 const {rows}=await db.query<{id:string;hash_sha256:string;tamanho_bytes:string}>('SELECT id,hash_sha256,tamanho_bytes FROM nga_lab.documentos WHERE tem_arquivo AND NOT EXISTS(SELECT 1 FROM nga_lab.documento_conteudos c WHERE c.documento_id=documentos.id)');
 for(const d of rows){
  const bytes=readFileSync(join(acervo,chaveDoHash(d.hash_sha256)));
  if(bytes.length!==Number(d.tamanho_bytes)||hashDoConteudo(bytes)!==d.hash_sha256)throw Error(`Integridade do documento ${d.id} não confere.`);
  await db.query('INSERT INTO nga_lab.documento_conteudos(documento_id,conteudo,hash_sha256) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[d.id,bytes,d.hash_sha256]);
  console.log('Copiado e conferido:',d.id,bytes.length);
 }
}finally{await db.end()}
