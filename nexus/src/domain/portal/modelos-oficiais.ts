/**
 * Checklists oficiais de documentos do cliente, transcritos das planilhas da NGA Turnaround Management
 * (abertura 25/04/2026): "Checklist RJ e RE", "Checklist Gestão de Passivos" e "Checklist Proteção Patrimonial".
 *
 * Títulos, categorias, atribuição e requisito legal são os da planilha, sem edição. Dois critérios são
 * NOSSOS e estão aqui à vista: item cujo texto diz "(se houver)" entra como NÃO obrigatório (não trava a
 * conclusão do onboarding); e a coluna "N/A" da planilha virou a situação "não se aplica".
 */
import type { ModeloDeRequisito } from './checklist.ts';

export const CHECKLIST_RJ_E_RE: readonly ModeloDeRequisito[] = Object.freeze([
  { categoria: "Contábil / Financeiro", titulo: "Balanço Patrimonial — 3 últimos exercícios sociais", atribuicao: "CONTABILIDADE", obrigatorio: true, fundamento: "Art. 51, II — Lei 11.101/2005" },
  { categoria: "Contábil / Financeiro", titulo: "DRE — 3 últimos exercícios sociais", atribuicao: "CONTABILIDADE", obrigatorio: true, fundamento: "Art. 51, II" },
  { categoria: "Contábil / Financeiro", titulo: "Balanço Especial e DRE para fins de ajuizamento da RJ", atribuicao: "CONTABILIDADE", obrigatorio: true, fundamento: "Art. 51, II" },
  { categoria: "Contábil / Financeiro", titulo: "Demonstração de Resultados Acumulados — 3 últimos exercícios", atribuicao: "CONTABILIDADE", obrigatorio: true, fundamento: "Art. 51, II" },
  { categoria: "Contábil / Financeiro", titulo: "Fluxo de Caixa Gerencial realizado e projetado", atribuicao: "CONTABILIDADE", obrigatorio: true, fundamento: "Art. 51, II" },
  { categoria: "Contábil / Financeiro", titulo: "Extratos bancários atualizados de todas as contas e aplicações", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, VII" },
  { categoria: "Contábil / Financeiro", titulo: "Relação de Bens e Direitos — Ativo Não Circulante", atribuicao: "CLIENTE / CONTABILIDADE", obrigatorio: true, fundamento: "Art. 51, XI" },
  { categoria: "Contábil / Financeiro", titulo: "Contratos de Alienação Fiduciária (se houver)", atribuicao: "CLIENTE", obrigatorio: false, fundamento: "Art. 51, XI" },
  { categoria: "Contábil / Financeiro", titulo: "Contratos de Leasing / Arrendamento Mercantil (se houver)", atribuicao: "CLIENTE", obrigatorio: false, fundamento: "Art. 51, XI" },
  { categoria: "Contábil / Financeiro", titulo: "Relatório detalhado do Passivo Fiscal", atribuicao: "CLIENTE / CONTABILIDADE", obrigatorio: true, fundamento: "Art. 51, X" },
  { categoria: "Jurídico / Societário", titulo: "Contratos Sociais e todas as alterações — incl. grupo econômico", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, V" },
  { categoria: "Jurídico / Societário", titulo: "Atas de nomeação dos administradores atuais", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, V" },
  { categoria: "Jurídico / Societário", titulo: "Contratos de financiamento e empréstimos (todos)", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Jurídico / Societário", titulo: "IRPF dos sócios controladores — 2 últimos exercícios", atribuicao: "SÓCIOS", obrigatorio: true, fundamento: "Art. 51, VI" },
  { categoria: "Jurídico / Societário", titulo: "Relação de bens particulares dos sócios controladores e administradores", atribuicao: "SÓCIOS", obrigatorio: true, fundamento: "Art. 51, VI" },
  { categoria: "Credores", titulo: "Lista completa de credores (trabalhistas, fornecedores, fiscal, etc.)", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, III" },
  { categoria: "Credores", titulo: "Origem do crédito de cada credor", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, III" },
  { categoria: "Credores", titulo: "CNPJ/CPF, endereço, e-mail e telefone de cada credor", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, III" },
  { categoria: "Credores", titulo: "Valor atualizado e regime de vencimentos de cada crédito", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, III" },
  { categoria: "Empregados (CLT)", titulo: "Lista completa de empregados — função, salário e demais parcelas", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, IV" },
  { categoria: "Empregados (CLT)", titulo: "Indenizações devidas e valores pendentes de pagamento", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, IV" },
  { categoria: "Contencioso", titulo: "Lista de demandas cíveis em trâmite (autos, juízo, estimativa)", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, IX" },
  { categoria: "Contencioso", titulo: "Lista de demandas trabalhistas em trâmite (com estimativa)", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, IX" },
  { categoria: "Contencioso", titulo: "Lista de procedimentos arbitrais em trâmite", atribuicao: "CLIENTE", obrigatorio: true, fundamento: "Art. 51, IX" },
  { categoria: "Grupo Econômico", titulo: "Descrição das sociedades do grupo econômico (de fato ou de direito)", atribuicao: "CLIENTE / CONTABILIDADE", obrigatorio: true, fundamento: "Art. 51, II" },
  { categoria: "Grupo Econômico", titulo: "Contratos Sociais das demais empresas do grupo", atribuicao: "CLIENTE", obrigatorio: true },
]);

export const CHECKLIST_GESTAO_DE_PASSIVOS: readonly ModeloDeRequisito[] = Object.freeze([
  { categoria: "Passivo Financeiro", titulo: "Relação de credores financeiros (bancos, fundos, FIDCs) — saldos, taxas e vencimentos", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Passivo Financeiro", titulo: "Contratos de crédito: CCB, CCI, mútuo, debêntures", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Passivo Financeiro", titulo: "Garantias reais constituídas (alienação fiduciária, hipoteca, penhor)", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Passivo Financeiro", titulo: "Contratos de aval e fiança dos sócios", atribuicao: "SÓCIOS", obrigatorio: true },
  { categoria: "Passivo Fiscal", titulo: "Relatório do passivo fiscal (federal, estadual, municipal)", atribuicao: "CLIENTE / CONTABILIDADE", obrigatorio: true },
  { categoria: "Passivo Fiscal", titulo: "Parcelamentos vigentes (PERT, Refis, outros)", atribuicao: "CLIENTE / CONTABILIDADE", obrigatorio: true },
  { categoria: "Passivo Trabalhista", titulo: "Relação de demandas trabalhistas com estimativa de valores", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Contábil / Financeiro", titulo: "Balanço Patrimonial — 2 últimos exercícios", atribuicao: "CONTABILIDADE", obrigatorio: true },
  { categoria: "Contábil / Financeiro", titulo: "DRE — 2 últimos exercícios", atribuicao: "CONTABILIDADE", obrigatorio: true },
  { categoria: "Contábil / Financeiro", titulo: "Fluxo de Caixa realizado e projetado (12 meses)", atribuicao: "CONTABILIDADE / CLIENTE", obrigatorio: true },
  { categoria: "Contábil / Financeiro", titulo: "Relatório de endividamento consolidado", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Contábil / Financeiro", titulo: "Extratos bancários — últimos 3 meses (todas as contas)", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Jurídico", titulo: "Contratos Sociais e alterações", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Jurídico", titulo: "Procurações vigentes relevantes", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Jurídico", titulo: "IRPF dos sócios garantidores — 2 últimos exercícios", atribuicao: "SÓCIOS", obrigatorio: true },
]);

export const CHECKLIST_PROTECAO_PATRIMONIAL: readonly ModeloDeRequisito[] = Object.freeze([
  { categoria: "Contábil / Financeiro", titulo: "Balanço Patrimonial — 2 últimos exercícios (todas as empresas)", atribuicao: "CONTABILIDADE", obrigatorio: true },
  { categoria: "Contábil / Financeiro", titulo: "DRE — 2 últimos exercícios (todas as empresas)", atribuicao: "CONTABILIDADE", obrigatorio: true },
  { categoria: "Contábil / Financeiro", titulo: "Contratos Sociais de todas as empresas (todas as alterações)", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Contábil / Financeiro", titulo: "Fluxo de Caixa realizado (se disponível)", atribuicao: "CONTABILIDADE", obrigatorio: true },
  { categoria: "Bens e Direitos — Sócios", titulo: "IRPF — exercícios 2022, 2023 e 2024 (todos os sócios)", atribuicao: "SÓCIOS", obrigatorio: true },
  { categoria: "Bens e Direitos — Sócios", titulo: "Relação de bens imóveis particulares (matrículas, localização, valor estimado)", atribuicao: "SÓCIOS", obrigatorio: true },
  { categoria: "Bens e Direitos — Sócios", titulo: "Relação de participações societárias (% em cada empresa)", atribuicao: "SÓCIOS", obrigatorio: true },
  { categoria: "Bens e Direitos — Sócios", titulo: "Bens móveis de alto valor (veículos, aeronaves, embarcações)", atribuicao: "SÓCIOS", obrigatorio: true },
  { categoria: "Bens e Direitos — Sócios", titulo: "Investimentos financeiros (CDB, fundos, ações, criptoativos)", atribuicao: "SÓCIOS", obrigatorio: true },
  { categoria: "Bens e Direitos — Sócios", titulo: "Informações sobre bens no exterior (se houver)", atribuicao: "SÓCIOS", obrigatorio: false },
  { categoria: "Passivo e Contingências", titulo: "Relação de todas as ações judiciais (cíveis, trabalhistas, fiscais) com estimativa", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Passivo e Contingências", titulo: "Relatório detalhado do Passivo Fiscal (todas as empresas)", atribuicao: "CLIENTE / CONTABILIDADE", obrigatorio: true },
  { categoria: "Passivo e Contingências", titulo: "Contratos de Alienação Fiduciária e garantias reais constituídas", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Passivo e Contingências", titulo: "Contratos de Leasing / Arrendamento Mercantil", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Passivo e Contingências", titulo: "Avais, fianças e garantias prestadas pelos sócios", atribuicao: "SÓCIOS", obrigatorio: true },
  { categoria: "Jurídico / Societário", titulo: "Contratos Sociais e alterações de todas as empresas do grupo", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Jurídico / Societário", titulo: "Acordos de sócios / Shareholders Agreements vigentes", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Jurídico / Societário", titulo: "Regimes de bens dos sócios (certidão de casamento/união estável)", atribuicao: "SÓCIOS", obrigatorio: true },
  { categoria: "Jurídico / Societário", titulo: "Testamentos ou instrumentos sucessórios existentes (se houver)", atribuicao: "SÓCIOS", obrigatorio: false },
  { categoria: "Imóveis", titulo: "Matrículas atualizadas de todos os imóveis (empresa e sócios)", atribuicao: "CLIENTE / SÓCIOS", obrigatorio: true },
  { categoria: "Imóveis", titulo: "Guias de IPTU dos imóveis", atribuicao: "CLIENTE / SÓCIOS", obrigatorio: true },
  { categoria: "Imóveis", titulo: "Contratos de locação vigentes (ativo e passivo)", atribuicao: "CLIENTE", obrigatorio: true },
  { categoria: "Imóveis", titulo: "Laudos de avaliação dos imóveis (se houver)", atribuicao: "CLIENTE", obrigatorio: false },
  { categoria: "Estrutura Familiar", titulo: "Árvore genealógica / composição familiar (herdeiros necessários)", atribuicao: "SÓCIOS", obrigatorio: true },
  { categoria: "Estrutura Familiar", titulo: "Documentos pessoais dos herdeiros (RG, CPF)", atribuicao: "SÓCIOS", obrigatorio: true },
  { categoria: "Estrutura Familiar", titulo: "Informações sobre menores ou incapazes (se houver)", atribuicao: "SÓCIOS", obrigatorio: false },
  { categoria: "Estrutura Familiar", titulo: "Testamentos ou planejamento sucessório existente (se houver)", atribuicao: "SÓCIOS", obrigatorio: false },
]);
