/**
 * Boot do NGA LAB: tenta a sessão do cookie; sem sessão, mostra o login.
 */
import { api } from './api.js';
import { estado } from './estado.js';
import { montarCasca } from './shell.js';

async function iniciar() {
  try {
    estado.eu = await api.get('/api/eu');
    estado.modulos = await api.get('/api/modulos');
    montarCasca();
  } catch {
    const { mostrarLogin } = await import('./views/login.js');
    mostrarLogin(iniciar);
  }
}
iniciar();
