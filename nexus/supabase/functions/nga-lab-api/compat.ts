import { createHash } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
/** Compatibility for the existing, tested domain/API code; no filesystem emulation. */
export function instalarCompatibilidade() {
 const g=globalThis as unknown as Record<string,unknown>;
 if(g.Bun)return;
 g.Bun={password:{
  hash:async(password:string)=>argon2id({password,salt:crypto.getRandomValues(new Uint8Array(16)),parallelism:1,iterations:2,memorySize:65536,hashLength:32,outputType:'encoded'}),
  verify:async(password:string,hash:string)=>argon2Verify({password,hash}),
 },CryptoHasher:class {h:ReturnType<typeof createHash>;constructor(a:string){this.h=createHash(a)}update(v:string|Uint8Array){this.h.update(v);return this}digest(e:'hex'){return this.h.digest(e)}}};
}
