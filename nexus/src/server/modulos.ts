/**
 * Catálogo de módulos da plataforma.
 *
 * O §18 do briefing proíbe "cards meramente decorativos" e "links quebrados".
 * Então cada módulo declara seu estado REAL, e a interface mostra esse estado
 * em vez de fingir que tudo está pronto. `operacional` só para o que tem
 * fluxo, persistência e teste; `em_obra` para o que começou; `nao_construido`
 * para o que ainda é só nome.
 *
 * Esta lista é a matriz de validação do §23, e é a interface que a lê.
 */
export type EstadoDoModulo = 'operacional' | 'em_obra' | 'nao_construido' | 'externo';

export interface Modulo {
  readonly id: string;
  readonly ambiente: 'office' | 'intelligence' | 'client';
  readonly nome: string;
  readonly descricao: string;
  readonly estado: EstadoDoModulo;
  readonly rota?: string;
  /** O que falta para o módulo virar `operacional`. Honestidade explícita. */
  readonly pendencia?: string;
  /** Projeto existente em disco que será incorporado. */
  readonly origem?: string;
}

export const MODULOS: readonly Modulo[] = Object.freeze([
  // --- NGA OFFICE ---
  { id: 'projetos', ambiente: 'office', nome: 'Projetos', estado: 'operacional', rota: '/projetos',
    descricao: 'O hub de cada caso: fase processual com os marcos da LREF, equipe com um líder garantido por índice, e tudo o que se pendura no projeto num lugar só.' },
  { id: 'painel', ambiente: 'office', nome: 'Painel de trabalho', estado: 'operacional', rota: '/',
    descricao: 'O que está na mesa: prazos por vencer, documentos aguardando análise, créditos sem classe validada, achados críticos e cliente sem resposta.' },
  { id: 'credores', ambiente: 'office', nome: 'Credores e Créditos', estado: 'operacional', rota: '/creditos',
    descricao: 'Quadro de credores com classificação da LREF e desdobramento do art. 41, § 2º.' },
  { id: 'planos', ambiente: 'office', nome: 'Planos e Obrigações', estado: 'operacional', rota: '/planos',
    descricao: 'Cronograma de pagamento por classe, com deságio, carência e juros.' },
  { id: 'agc', ambiente: 'office', nome: 'Assembleias', estado: 'operacional', rota: '/agc',
    descricao: 'Apuração de quórum pelos arts. 45 e 58, § 1º, com registro imutável.' },
  { id: 'integracoes', ambiente: 'office', nome: 'Integrações do NGA Lab', estado: 'em_obra', rota: '/integracoes',
    descricao: 'Credencial com escopo para as aplicações do Lab entregarem processo, prazo e documento.',
    pendencia: 'O lado receptor está pronto e testado: credencial, escopo, idempotência e RLS. O NGA Sentinela já entrega, exercitado de ponta a ponta. Falta ligar o NGA Prazos e o NGA Íntegra, que é trabalho dentro do repositório de cada um.' },
  { id: 'auditoria', ambiente: 'office', nome: 'Auditoria', estado: 'operacional', rota: '/auditoria',
    descricao: 'Trilha append-only de toda operação sobre dados do escritório.' },
  { id: 'clientes', ambiente: 'office', nome: 'Clientes', estado: 'em_obra',
    descricao: 'Cadastro único reaproveitado por todos os módulos.',
    pendencia: 'Schema pronto (empresas, grupos_economicos). Falta a interface e a migração dos dados do Nexus.' },
  { id: 'prazos', ambiente: 'office', nome: 'Controladoria e Prazos', estado: 'externo',
    descricao: 'Agendamento e auditoria de prazos, integrado ao Astrea.',
    origem: 'Agendamento de Prazos/nga-prazos',
    pendencia: 'A contagem de prazo e a agenda da controladoria passaram a rodar aqui, no módulo Processos. O Nexus já recebe prazo em POST /api/integracao/prazos e recalcula o vencimento pelo CPC; falta o nga-prazos passar a enviá-lo. A escrita no Astrea segue não liberada.' },
  { id: 'processos', ambiente: 'office', nome: 'Processos', estado: 'operacional', rota: '/processos',
    descricao: 'Cadastro com número conferido pelo dígito do CNJ, partes, linha do tempo e prazos contados pelos arts. 219, 220 e 224 do CPC.',
    pendencia: 'Operacional. Feriado estadual e municipal e suspensão do tribunal não são conhecidos automaticamente: entram informados, e toda data sai com ressalva.' },
  { id: 'tarefas', ambiente: 'office', nome: 'Tarefas', estado: 'operacional', rota: '/tarefas',
    descricao: 'Quadro de tarefas por projeto, com responsável, prioridade e prazo contado em dias úteis forenses.',
    pendencia: 'Operacional. Sem dependência entre tarefas: cada uma é independente.' },
  { id: 'crm', ambiente: 'office', nome: 'CRM', estado: 'nao_construido',
    descricao: 'Pipeline comercial, leads e propostas.',
    pendencia: 'Não iniciado. O Nexus atual tem 12 tabelas de CRM a migrar.' },
  { id: 'relatorios', ambiente: 'office', nome: 'Relatórios em PDF', estado: 'operacional', rota: '/relatorios',
    descricao: 'Acompanhamento mensal e quadro de credores em PDF, montados a partir do que está lançado.',
    pendencia: 'Operacional. O PDF usa Helvetica e Courier (fontes padrão), porque Barlow e JetBrains Mono exigiriam os arquivos de fonte, que não estão no repositório.' },
  { id: 'financeiro', ambiente: 'office', nome: 'Financeiro do escritório', estado: 'nao_construido',
    descricao: 'Honorários, receitas, despesas e fluxo de caixa.',
    pendencia: 'Parcialmente iniciado: o cálculo de honorários (fixo, mensal, êxito) e o teto do administrador judicial do art. 24 da LREF estão prontos e testados em src/domain/financeiro/honorarios.ts. Falta tudo o resto — schema, faturamento, apontamento de horas, API e tela. O Nexus atual tem costs/project_pricing/time_entries a migrar.' },

  // --- NGA INTELLIGENCE ---
  { id: 'integra', ambiente: 'intelligence', nome: 'NGA Íntegra', estado: 'externo',
    descricao: 'Captura a íntegra dos autos, divide em partes e dispara a triagem.',
    origem: 'NGA Íntegra',
    pendencia: 'Divisão de PDF testada em autos reais. Captura em tribunal não exercitada; análise Claude só com API simulada. O Nexus já recebe as partes em POST /api/integracao/documentos; falta o Íntegra passar a enviá-las.' },
  { id: 'sentinela', ambiente: 'intelligence', nome: 'NGA Sentinela', estado: 'externo',
    descricao: 'Monitora novas ações contra clientes via DJEN e DataJud.',
    origem: 'NGA Sentinela',
    pendencia: 'Pipeline real executado. Cobertura validada por tribunal: 0 %. DataJud não identifica partes. A entrega ao Nexus está ligada (`sentinela nexus-enviar`) e exercitada de ponta a ponta, mas só envia correspondência confirmada por pessoa — justamente porque a cobertura automática não foi validada.' },
  { id: 'analise_documental', ambiente: 'intelligence', nome: 'Análise documental', estado: 'em_obra', rota: '/analise',
    descricao: 'Classificação por sinais, identificadores conferidos por dígito verificador, citações verificadas contra corpus e achados ancorados no texto.',
    pendencia: 'Operacional e testado sem IA: classificação, CNPJ/CPF/processo com dígito verificador, conferência de citações e defesa contra injeção de prompt. A leitura por modelo está construída com o SDK oficial, mas NÃO foi exercitada contra a API real — falta chave Anthropic. Texto é extraído de arquivo .txt e .csv; de PDF e imagem, não: extrator e OCR não existem.' },
  { id: 'radar', ambiente: 'intelligence', nome: 'NGA Radar Concursal', estado: 'nao_construido',
    descricao: 'Monitoramento de novas recuperações e falências.',
    pendencia: 'Não existe código. Consta na apresentação do NGA Lab como "Radar de RJs e Falências", ainda em conceito.' },
  { id: 'atlas', ambiente: 'intelligence', nome: 'NGA Atlas', estado: 'nao_construido',
    descricao: 'Investigação patrimonial e societária.',
    pendencia: 'Não existe código nem consta da apresentação do NGA Lab. É construção nova, não integração.' },
  { id: 'orbit', ambiente: 'intelligence', nome: 'NGA Orbit', estado: 'nao_construido',
    descricao: 'Assistente executivo sobre os dados autorizados da plataforma.',
    pendencia: 'Não existe código nem consta da apresentação do NGA Lab. É construção nova, não integração.' },

  // --- NGA CLIENT ---
  { id: 'portal', ambiente: 'client', nome: 'Portal do cliente', estado: 'operacional', rota: '/portal',
    descricao: 'Acesso do cliente, com isolamento rigoroso e publicação controlada de documentos.' },
  { id: 'acervo', ambiente: 'office', nome: 'Acervo de documentos', estado: 'operacional', rota: '/analise',
    descricao: 'Guarda endereçada por conteúdo, com integridade conferida na leitura e download por URL assinada e temporária.',
    pendencia: 'Operacional em disco local. Adaptador para S3/GCS/Azure não existe (sem credencial de objeto), e nenhum antivírus está integrado ao recebimento.' },
  { id: 'onboarding', ambiente: 'client', nome: 'Onboarding documental', estado: 'operacional', rota: '/checklist',
    descricao: 'Checklist por procedimento, com envio, análise e progresso real.' },
  { id: 'financeiro_cliente', ambiente: 'client', nome: 'Gestão financeira da recuperanda', estado: 'operacional', rota: '/financeiro',
    descricao: 'Fluxo de caixa previsto e realizado, contas e indicadores.' },
  { id: 'relatorios_cliente', ambiente: 'client', nome: 'Relatórios ao cliente', estado: 'operacional', rota: '/portal',
    descricao: 'Relatórios em PDF publicados ao cliente, baixados por URL assinada e temporária.',
    pendencia: 'Operacional. O relatório nasce interno: chega ao cliente só por publicação explícita, e quem publica vê antes a lista do que o relatório não afirma.' },
  { id: 'acompanhamento_processual', ambiente: 'client', nome: 'Acompanhamento processual', estado: 'operacional', rota: '/portal',
    descricao: 'Andamento publicado ao cliente com resumo escrito pela equipe, nunca o movimento cru.',
    pendencia: 'Operacional. A publicação é ato humano por desenho: não há tradução automática de andamento, e processo em segredo de justiça fica fora do portal.' },
]);

export const AMBIENTES = Object.freeze({
  office: { nome: 'NGA OFFICE', descricao: 'Gestão interna do escritório' },
  intelligence: { nome: 'NGA INTELLIGENCE', descricao: 'Inteligência artificial e investigação' },
  client: { nome: 'NGA CLIENT', descricao: 'Portal externo de clientes' },
});

/** Resumo para a matriz de validação do §23. */
export function resumoDeEstado(): Record<EstadoDoModulo, number> {
  const resumo: Record<EstadoDoModulo, number> = {
    operacional: 0, em_obra: 0, nao_construido: 0, externo: 0,
  };
  for (const m of MODULOS) resumo[m.estado]++;
  return resumo;
}
