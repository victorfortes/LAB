/**
 * Playbook: as tarefas que cada tipo de projeto gera sozinho.
 *
 * Duas regras de desenho. (1) As tarefas são ORGANIZAÇÃO DE TRABALHO — "reunir", "conferir", "cadastrar",
 * "calcular" —, nunca afirmação jurídica: o que é exigido por lei vem dos checklists oficiais e do catálogo
 * de prazos, que têm fundamento. (2) Cada passo pertence a uma fase: entra quando o projeto abre
 * (`abertura`) ou quando ele ENTRA naquela fase, então a lista de quem trabalha só cresce na medida em que o
 * caso anda, em vez de despejar sessenta tarefas no primeiro dia.
 *
 * ESTE É UM MODELO-BASE para a NGA revisar: o conteúdo dos playbooks do Nexus antigo não estava ao nosso
 * alcance (68 tabelas, sem acesso). Trocar o texto aqui é trocar o playbook.
 */
import type { TipoDeProjeto } from './fases.ts';

export type Prioridade = 'baixa' | 'media' | 'alta' | 'urgente';

export interface PassoDePlaybook {
  /** Estável: é a chave de idempotência. Nunca renomeie um passo já usado. */
  readonly id: string;
  /** 'abertura' (quando o projeto nasce) ou o id de uma fase do procedimento. */
  readonly fase: string;
  readonly titulo: string;
  readonly descricao?: string;
  /** Prazo em dias úteis a partir de quando o passo entra. */
  readonly diasUteis: number;
  readonly prioridade: Prioridade;
}

const ABERTURA: readonly PassoDePlaybook[] = [
  { id: 'abertura.equipe', fase: 'abertura', titulo: 'Definir líder e equipe do projeto', diasUteis: 1, prioridade: 'alta',
    descricao: 'Aba Equipe: quem lidera e quem apoia. Projeto sem líder é projeto sem dono.' },
  { id: 'abertura.kickoff', fase: 'abertura', titulo: 'Reunião de kickoff com o cliente', diasUteis: 3, prioridade: 'alta',
    descricao: 'Alinhar escopo, quem fala com quem e o que o cliente precisa entregar primeiro.' },
  { id: 'abertura.contrato', fase: 'abertura', titulo: 'Formalizar contrato e procuração', diasUteis: 5, prioridade: 'alta' },
  { id: 'abertura.cadastro', fase: 'abertura', titulo: 'Cadastrar empresas do grupo e sócios', diasUteis: 5, prioridade: 'media',
    descricao: 'CNPJ conferido pelo dígito verificador; grupo econômico quando houver.' },
  { id: 'abertura.portal', fase: 'abertura', titulo: 'Gerar o checklist de documentos e convidar o cliente ao portal', diasUteis: 2, prioridade: 'urgente',
    descricao: 'Aba Portal do cliente: "Gerar do modelo" e criar o acesso. O cliente passa a ver o que precisa enviar.' },
  { id: 'abertura.conferir', fase: 'abertura', titulo: 'Conferir os documentos que chegarem e responder ao cliente', diasUteis: 10, prioridade: 'media',
    descricao: 'Aba Diagnóstico: ler o que o sistema reconheceu, aprovar ou pedir complementação.' },
];

const RJ: readonly PassoDePlaybook[] = [
  { id: 'rj.preparacao.credores', fase: 'preparacao', titulo: 'Consolidar a relação nominal de credores com o cliente', diasUteis: 10, prioridade: 'alta' },
  { id: 'rj.preparacao.caixa', fase: 'preparacao', titulo: 'Obter fluxo de caixa realizado e projetado', diasUteis: 10, prioridade: 'alta' },
  { id: 'rj.preparacao.inicial', fase: 'preparacao', titulo: 'Montar a petição inicial com a documentação do checklist', diasUteis: 20, prioridade: 'alta' },
  { id: 'rj.distribuido.processo', fase: 'distribuido', titulo: 'Cadastrar o processo (número CNJ) e as partes', diasUteis: 2, prioridade: 'alta' },
  { id: 'rj.distribuido.acompanhar', fase: 'distribuido', titulo: 'Acompanhar a decisão sobre o processamento', diasUteis: 5, prioridade: 'media' },
  { id: 'rj.processamento.adm', fase: 'processamento_deferido', titulo: 'Registrar o administrador judicial e abrir o canal com ele', diasUteis: 3, prioridade: 'alta' },
  { id: 'rj.processamento.prazos', fase: 'processamento_deferido', titulo: 'Calcular e registrar os prazos que correm a partir da decisão', diasUteis: 2, prioridade: 'urgente',
    descricao: 'Aba Processos e prazos → "Calcular prazo". Conferir feriado local: o sistema avisa o que não sabe.' },
  { id: 'rj.credores.validar', fase: 'relacao_credores', titulo: 'Conferir a relação de credores e validar o enquadramento dos créditos', diasUteis: 10, prioridade: 'alta',
    descricao: 'Aba Créditos: a classe sugerida pelo sistema não é definitiva até alguém validar.' },
  { id: 'rj.credores.habilitacoes', fase: 'relacao_credores', titulo: 'Avaliar habilitações e divergências de crédito', diasUteis: 10, prioridade: 'alta' },
  { id: 'rj.plano.negociar', fase: 'plano_apresentado', titulo: 'Abrir as frentes de negociação com os credores relevantes', diasUteis: 5, prioridade: 'alta',
    descricao: 'Aba Negociações: uma frente por credor ou grupo, com o resumo que o cliente poderá ver.' },
  { id: 'rj.plano.objecoes', fase: 'plano_apresentado', titulo: 'Acompanhar objeções ao plano e registrar os prazos', diasUteis: 5, prioridade: 'media' },
  { id: 'rj.assembleia.preparar', fase: 'assembleia', titulo: 'Preparar a assembleia: quóruns e apuração por classe', diasUteis: 10, prioridade: 'alta' },
  { id: 'rj.concedida.relatorio', fase: 'concedida', titulo: 'Montar a rotina de relatório mensal ao cliente', diasUteis: 10, prioridade: 'media' },
];

const RE: readonly PassoDePlaybook[] = [
  { id: 're.negociacao.mapa', fase: 'negociacao', titulo: 'Mapear os credores a abranger e abrir as negociações', diasUteis: 5, prioridade: 'alta' },
  { id: 're.adesoes.colher', fase: 'adesoes', titulo: 'Colher e conferir as adesões ao plano', diasUteis: 15, prioridade: 'alta' },
  { id: 're.homologacao.pedido', fase: 'homologacao_requerida', titulo: 'Acompanhar o pedido de homologação e os prazos', diasUteis: 5, prioridade: 'alta' },
];

const GENERICO: readonly PassoDePlaybook[] = [
  { id: 'g.diagnostico.levantar', fase: 'diagnostico', titulo: 'Levantar o caso: documentos, partes e riscos', diasUteis: 10, prioridade: 'alta' },
  { id: 'g.diagnostico.escopo', fase: 'diagnostico', titulo: 'Registrar o escopo combinado e os entregáveis', diasUteis: 5, prioridade: 'media' },
  { id: 'g.execucao.plano', fase: 'execucao', titulo: 'Montar o plano de trabalho com responsáveis e datas', diasUteis: 5, prioridade: 'alta' },
  { id: 'g.execucao.status', fase: 'execucao', titulo: 'Atualizar o cliente sobre o andamento', diasUteis: 15, prioridade: 'media' },
  { id: 'g.entrega.produto', fase: 'entrega', titulo: 'Entregar o produto ao cliente e registrar o aceite', diasUteis: 5, prioridade: 'alta' },
];

const PASSIVOS: readonly PassoDePlaybook[] = [
  { id: 'p.diagnostico.endividamento', fase: 'diagnostico', titulo: 'Montar o mapa de endividamento por credor', diasUteis: 10, prioridade: 'alta',
    descricao: 'Base: relação de credores financeiros, contratos e garantias do checklist.' },
  { id: 'p.diagnostico.negociar', fase: 'diagnostico', titulo: 'Definir a ordem das negociações e abrir as frentes', diasUteis: 12, prioridade: 'alta',
    descricao: 'Aba Negociações.' },
];

const PROTECAO: readonly PassoDePlaybook[] = [
  { id: 'pp.diagnostico.bens', fase: 'diagnostico', titulo: 'Mapear bens e participações de empresa e sócios', diasUteis: 15, prioridade: 'alta' },
  { id: 'pp.diagnostico.riscos', fase: 'diagnostico', titulo: 'Levantar passivos, garantias prestadas e contingências', diasUteis: 15, prioridade: 'alta' },
  { id: 'pp.diagnostico.sucessao', fase: 'diagnostico', titulo: 'Levantar estrutura familiar e instrumentos sucessórios', diasUteis: 15, prioridade: 'media' },
  { id: 'pp.execucao.estrutura', fase: 'execucao', titulo: 'Propor a estrutura de proteção e validar com o cliente', diasUteis: 15, prioridade: 'alta' },
];

export const PLAYBOOKS: Readonly<Record<TipoDeProjeto, readonly PassoDePlaybook[]>> = Object.freeze({
  recuperacao_judicial: [...ABERTURA, ...RJ],
  recuperacao_extrajudicial: [...ABERTURA, ...RE],
  falencia: [...ABERTURA],
  reestruturacao: [...ABERTURA, ...GENERICO, ...PASSIVOS],
  negociacao_credores: [...ABERTURA, ...GENERICO, ...PASSIVOS],
  investigacao_patrimonial: [...ABERTURA, ...GENERICO],
  contencioso_estrategico: [...ABERTURA, ...GENERICO],
  consultivo: [...ABERTURA, ...GENERICO],
  protecao_patrimonial: [...ABERTURA, ...GENERICO, ...PROTECAO],
});

/** Passos que entram numa fase. Na abertura, também entram os de 'abertura'. */
export function passosDa(tipo: TipoDeProjeto, fase: string, naAbertura = false): readonly PassoDePlaybook[] {
  return (PLAYBOOKS[tipo] ?? []).filter((p) => p.fase === fase || (naAbertura && p.fase === 'abertura'));
}
