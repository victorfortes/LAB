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
/** Parceiro externo (outro escritório na área dele): vê só os projetos em que foi incluído, com menu curto. */
export const ehParceiro = () => (estado.eu?.papeis ?? []).length > 0 && estado.eu.papeis.every((p) => p === 'parceiro_externo');
export const pode = (permissao) => estado.eu?.permissoes?.includes(permissao) === true;

export const ROTULO_DO_PAPEL = {
  socio_administrador: 'Administrador', socio: 'Sócio', coordenacao: 'Coordenação', advogado: 'Advogado(a)',
  controladoria: 'Controladoria', financeiro: 'Financeiro', administrativo: 'Administrativo',
  estagiario: 'Estagiário(a)', cliente_administrador: 'Cliente · administrador',
  cliente_usuario: 'Cliente', parceiro_externo: 'Parceiro externo', integracao: 'Integração',
};
