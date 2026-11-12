/**
 * Boot do NGA NEXUS: tenta a sessão do cookie; sem sessão, mostra o login.
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

async function iniciar() {
  try {
    estado.eu = await api.get('/api/eu');
    if (estado.eu.deveTrocarSenha) { await trocarSenhaObrigatoria(); return iniciar(); }
    estado.modulos = await api.get('/api/modulos');
    montarCasca();
  } catch {
    const { mostrarLogin } = await import('./views/login.js');
    mostrarLogin(iniciar);
  }
}
iniciar();
