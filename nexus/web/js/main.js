/**
 * Boot do NGA LAB: tenta a sessão do cookie; sem sessão, mostra o login.
 */
import { api } from './api.js';
import { estado } from './estado.js';
import { montarCasca } from './shell.js';

/** Primeiro acesso: a senha temporária só serve para escolher a definitiva. */
async function trocarSenhaObrigatoria() {
  const { formulario } = await import('./ui.js');
  await formulario({
    titulo: 'Crie a sua senha', subtitulo: 'A senha recebida é temporária. Escolha uma senha só sua para continuar.', rotulo: 'Salvar senha',
    campos: [{ nome: 'atual', rotulo: 'Senha temporária', tipo: 'password', obrigatorio: true },
      { nome: 'nova', rotulo: 'Nova senha', tipo: 'password', obrigatorio: true, dica: 'Mínimo de 12 caracteres.' },
      { nome: 'repetir', rotulo: 'Repita a nova senha', tipo: 'password', obrigatorio: true }],
    async enviar(v) {
      if (v.nova !== v.repetir) throw new Error('As senhas não são iguais.');
      await api.post('/api/senha', { atual: v.atual, nova: v.nova });
    },
  });
}

/** Sócio, administração e coordenação: o acesso só segue com o aplicativo autenticador ativo. */
async function ativarMfaObrigatorio() {
  const { formulario } = await import('./ui.js');
  const { chave } = await api.post('/api/mfa/preparar');
  const ok = await formulario({
    titulo: 'Ative o segundo fator',
    subtitulo: `Seu acesso vê a carteira inteira do escritório, então a senha sozinha não basta. No celular, abra o Google Authenticator ou o Microsoft Authenticator, toque em "+" e em "Inserir chave de configuração" (tipo: baseada em tempo) e digite a chave: ${chave}. Depois informe o código de 6 dígitos que aparecer.`,
    rotulo: 'Ativar',
    campos: [{ nome: 'codigo', rotulo: 'Código de 6 dígitos', obrigatorio: true, dica: 'Guarde o celular com cuidado: se perdê-lo, peça à administração um novo link de senha.' }],
    async enviar(v) {
      const codigo = String(v.codigo ?? '').replace(/\s/g, '');
      if (!/^\d{6}$/.test(codigo)) throw new Error('Digite os 6 dígitos que aparecem no aplicativo.');
      await api.post('/api/mfa/ativar', { codigo });
    },
  });
  // Cancelar sai da conta: sem o segundo fator, não há o que fazer lá dentro.
  if (!ok) { await api.del('/api/sessao').catch(() => {}); throw new Error('segundo fator não ativado'); }
}

async function iniciar() {
  try {
    estado.eu = await api.get('/api/eu');
    if (estado.eu.deveTrocarSenha) { await trocarSenhaObrigatoria(); return iniciar(); }
    if (estado.eu.deveAtivarMfa) { await ativarMfaObrigatorio(); return iniciar(); }
    estado.modulos = await api.get('/api/modulos');
    montarCasca();
  } catch {
    const { mostrarLogin } = await import('./views/login.js');
    mostrarLogin(iniciar);
  }
}
iniciar();
