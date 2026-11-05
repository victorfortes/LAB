import {contextoBanco} from '../../../src/store/conexao.ts';
import {chaveDoHash,hashDoConteudo,ArquivoAusente,ArquivoCorrompido,type Armazenamento} from '../../../src/store/arquivos.ts';
/** Cloud content is persisted with its document by guardar_conteudo_documento. */
export class AcervoNaNuvem implements Armazenamento {
 readonly nome='postgresql';
 async guardar(dados:Uint8Array){const hash=hashDoConteudo(dados);return{hash,chave:chaveDoHash(hash),tamanho:dados.length,jaExistia:false}}
 async ler(chave:string,hashEsperado?:string){
  const hash=hashEsperado??chave.split('/').at(-1)!;chaveDoHash(hash);
  const db=contextoBanco.getStore();if(!db)throw Error('Leitura do acervo exige contexto autenticado');
  const {rows}=await db.query('SELECT c.conteudo FROM documento_conteudos c JOIN documentos d ON d.id=c.documento_id WHERE d.hash_sha256=$1 LIMIT 1',[hash]);
  if(!rows[0])throw new ArquivoAusente(chave);const dados=new Uint8Array(rows[0].conteudo);const atual=hashDoConteudo(dados);
  if(atual!==hash)throw new ArquivoCorrompido(chave,hash,atual);return dados;
 }
 async existe(chave:string){try{await this.ler(chave);return true}catch{return false}}
 async remover(){throw Error('Conteúdo remoto só pode ser removido junto ao documento autorizado')}
}
