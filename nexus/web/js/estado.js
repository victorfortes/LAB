/** Estado compartilhado da sessão. Pequeno de propósito: o servidor é a fonte da verdade. */
export const estado = {
  eu: null,            // /api/eu
  modulos: null,       // /api/modulos
  projetos: [],        // cache da lista, para a sidebar e a busca
  tarefas: [],         // idem
  painel: null,        // pendências de quem está logado
  portal: [],          // projetos do cliente
  projetoDoCliente: null,
};

export const ehCliente = () => estado.eu?.ehCliente === true;
export const pode = (permissao) => estado.eu?.permissoes?.includes(permissao) === true;

export const ROTULO_DO_PAPEL = {
  socio_administrador: 'Administrador', socio: 'Sócio', coordenacao: 'Coordenação', advogado: 'Advogado(a)',
  controladoria: 'Controladoria', financeiro: 'Financeiro', administrativo: 'Administrativo',
  estagiario: 'Estagiário(a)', cliente_administrador: 'Cliente · administrador',
  cliente_usuario: 'Cliente', parceiro_externo: 'Parceiro externo', integracao: 'Integração',
};
