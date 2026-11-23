import {contextoBanco} from '../../../src/store/conexao.ts';
import {chaveDoHash,hashDoConteudo,ArquivoAusente,ArquivoCorrompido,type Armazenamento} from '../../../src/store/arquivos.ts';

/**
 * Acervo na nuvem: conteúdo no Supabase Storage (bucket privado "acervo", chave = hash do conteúdo).
 *
 * Antes o conteúdo ia para dentro do banco (documento_conteudos): com cliente que manda 400 MB de
 * documentos, isso travava o envio e enchia o banco. Agora:
 *  - o navegador envia direto ao Storage por endereço assinado de uso único (`urlDeEnvio`);
 *  - a função lê do Storage e confere o hash em toda leitura;
 *  - documento antigo (só no banco) continua sendo lido de lá.
 */
const BUCKET='acervo';
const LIMITE_BUCKET=50*1024*1024;
export class AcervoNaNuvem implements Armazenamento {
 readonly nome='supabase-storage';
 readonly guardaNoBanco=false;
 private bucketPronto?:Promise<void>;
 constructor(private readonly url=Deno.env.get('SUPABASE_URL')??'',private readonly chave=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??''){}
 private cab(extra:Record<string,string>={}){return{authorization:`Bearer ${this.chave}`,apikey:this.chave,...extra}}
 private garantirBucket(){
  this.bucketPronto??=(async()=>{
   const r=await fetch(`${this.url}/storage/v1/bucket`,{method:'POST',headers:this.cab({'content-type':'application/json'}),body:JSON.stringify({id:BUCKET,name:BUCKET,public:false,file_size_limit:LIMITE_BUCKET})});
   if(!r.ok&&r.status!==409&&!/already exists|Duplicate/i.test(await r.text()))throw Error(`Storage: não criou o bucket (${r.status})`);
  })().catch((e)=>{this.bucketPronto=undefined;throw e});
  return this.bucketPronto;
 }
 async guardar(dados:Uint8Array){
  const hash=hashDoConteudo(dados);const chave=chaveDoHash(hash);
  try{
   await this.garantirBucket();
   if(await this.existe(chave))return{hash,chave,tamanho:dados.length,jaExistia:true};
   const r=await fetch(`${this.url}/storage/v1/object/${BUCKET}/${chave}`,{method:'POST',headers:this.cab({'content-type':'application/octet-stream','x-upsert':'false'}),body:dados});
   if(!r.ok){const t=await r.text();if(!(r.status===409||/Duplicate|already exists/i.test(t)))throw Error(`Storage ${r.status} ${t.slice(0,120)}`);return{hash,chave,tamanho:dados.length,jaExistia:true}}
   return{hash,chave,tamanho:dados.length,jaExistia:false};
  }catch(e){
   // Storage fora do ar ou mal configurado: o documento não se perde, vai para o banco como antes.
   console.error('acervo: Storage indisponível, guardando no banco',(e as Error).message);
   return{hash,chave,tamanho:dados.length,jaExistia:false,guardarNoBanco:true};
  }
 }
 async ler(chave:string,hashEsperado?:string){
  const hash=hashEsperado??chave.split('/').at(-1)!;chaveDoHash(hash);
  let dados:Uint8Array|null=null;
  try{
   const r=await fetch(`${this.url}/storage/v1/object/authenticated/${BUCKET}/${chaveDoHash(hash)}`,{headers:this.cab()});
   if(r.ok){dados=new Uint8Array(await r.arrayBuffer());if(hashDoConteudo(dados)===hash)return dados;dados=null}
   else await r.body?.cancel();
  }catch(e){console.error('acervo: leitura do Storage falhou',(e as Error).message)}
  {
   // Documento de antes do Storage: o conteúdo está no banco.
   const db=contextoBanco.getStore();if(!db)throw new ArquivoAusente(chave);
   const {rows}=await db.query('SELECT c.conteudo FROM documento_conteudos c JOIN documentos d ON d.id=c.documento_id WHERE d.hash_sha256=$1 LIMIT 1',[hash]);
   if(!rows[0])throw new ArquivoAusente(chave);dados=new Uint8Array(rows[0].conteudo);
  }
  const atual=hashDoConteudo(dados);if(atual!==hash)throw new ArquivoCorrompido(chave,hash,atual);return dados;
 }
 async existe(chave:string){
  try{const r=await fetch(`${this.url}/storage/v1/object/${BUCKET}/${chave}`,{method:'HEAD',headers:this.cab()});await r.body?.cancel();return r.ok}catch{return false}
 }
 async remover(){throw Error('Conteúdo remoto só pode ser removido junto ao documento autorizado')}
 async urlDeEnvio(chave:string){
  await this.garantirBucket();
  const r=await fetch(`${this.url}/storage/v1/object/upload/sign/${BUCKET}/${chave}`,{method:'POST',headers:this.cab({'content-type':'application/json'}),body:'{}'});
  if(!r.ok)throw Error(`Storage: não gerou o endereço de envio (${r.status} ${(await r.text()).slice(0,120)})`);
  const j=await r.json() as {url:string};
  return `${this.url}/storage/v1${j.url}`;
 }
}
