/** Configure without printing secrets or accepting them as CLI arguments. */
import {Vault} from '../src/security/vault.ts';
import {labUrl} from '../src/server/lab-sync.ts';
const url=process.env.NGA_LAB_URL;const token=process.env.NGA_LAB_TOKEN;
if(!url||!token||token.length<32)throw new Error('Informe NGA_LAB_URL e NGA_LAB_TOKEN no ambiente.');
await new Vault(process.env.NGA_VAULT_FILE??'.nga-vault.json').save('lab',{email:labUrl(url),password:token});
console.log('Credencial LAB guardada no cofre; token não exibido.');
