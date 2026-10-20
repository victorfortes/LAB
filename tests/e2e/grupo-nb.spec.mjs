import { test, expect } from '@playwright/test';
import { entrar, geradorPronto } from './helpers.mjs';

// Caso do Grupo NB (recuperação extrajudicial), com texto SINTÉTICO: datas do cadastro valem, reunião do comitê aparece,
// reunião agendada vira próximo passo e anotação interna não vai para os destaques.
const EMAIL_15 = 'Prezados(as) Senhores(as) Membros do Comitê de Credores, Agradecemos a participação na 2ª Reunião do Comitê de Credores. Em anexo, a ata. Por fim, fica agendada a reunião abaixo: • Data e horário: 02 de dezembro de 2099, às 14h00. Seguimos à disposição, At.te';
const ATIVS = [
  { numero_processo: '0001', tipo: 'Histórico manual', data: '20/10/2026', descricao: 'Prezados(as) Senhores(as) Membros do Comitê de Credores, Em complemento ao e-mail anterior, encaminhamos Nota Técnica sobre a proposta de acordo. At.te' },
  { numero_processo: '0001', tipo: 'Histórico manual', data: '15/10/2026', descricao: EMAIL_15 },
  { numero_processo: '0001', tipo: 'Evento realizado', data: '15/10/2026', descricao: 'Comitê de Credores da NB - Realizado: ANOTAÇÃO INTERNA SIGILOSA - ACONTECEU' },
  { numero_processo: '0001', tipo: 'Prazo realizado', data: '07/10/2026', descricao: 'Enviar convocação com a pauta e link para a reunião com os credores - Realizado: Enviado' },
  { numero_processo: '0001', tipo: 'Prazo realizado', data: '02/10/2026', descricao: 'Enviar convocação com a pauta e link para a reunião com os credores - Realizado: ANOTAÇÃO INTERNA SOLTA.' },
];

test('Grupo NB: comitê reconhecido, destaque sem anotação interna, reunião agendada e datas do cadastro valendo', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const r = await fr.evaluate(({ ATIVS }) => {
    const ativs = ATIVS.map(a => Object.assign({}, a, window.NUCLEO.classificar(a.descricao, a.tipo, null, 'insolvencia')));
    const nat = ativs.map(a => a.natureza);
    const b = window.Inteligencia.montarBriefing({ atividades: ativs, tarefasFuturas: [], indicadores: {}, config: {} });
    const marcos = [
      { chave: 'NEGOCIACAO', rotulo: 'Negociação', data: '01/06/2025', status: 'concluido' },
      { chave: 'AJUIZAMENTO', rotulo: 'Ajuizamento', data: '14/04/2026', status: 'concluido' },
    ];
    const ctx = { processos: [{ numero_processo: '0001', acao: 'Recuperação Extrajudicial', juizo: '2ª Vara', titulo: 'Teste', distribuicao: '15/04/2026' }], atividades: [] };
    window.NGA_VERIFICAR.aplicar(marcos, { config: { templateTimeline: 're' } }, ctx);
    return { nat, acont: b.acontecimentos.map(a => a.descricao), entregas: b.entregas.map(e => e.descricao), passos: b.proximosPassos.map(p => ({ acao: p.acao, data: p.data })), marcos };
  }, { ATIVS });
  expect(r.nat[0]).toBe('Comunicação ao comitê / credores');
  expect(r.nat[1]).toBe('Comunicação ao comitê / credores');
  expect(r.nat[2]).toBe('Reunião do comitê de credores');
  expect(r.nat[3]).toBe('Comunicação ao comitê / credores');
  expect(r.acont[0]).toBe('Comitê de Credores da NB (realizado)');           // a reunião abre a lista de acontecimentos
  expect(JSON.stringify([r.acont, r.entregas])).not.toContain('SIGILOSA');   // anotação do evento fica de fora
  expect(JSON.stringify(r.entregas)).not.toContain('SOLTA');                 // prazo sem desfecho não é entrega
  expect(JSON.stringify(r.acont)).not.toContain('SOLTA');
  expect(JSON.stringify(r.acont)).not.toContain('Prezados');                 // saudação de e-mail removida
  expect(r.passos).toEqual([{ acao: expect.stringContaining('Reunião do Comitê de Credores agendada às 14h00'), data: '02/12/2099' }]);
  // datas do cadastro valem; a conferência com o Astrea é só aviso
  for (const m of r.marcos) { expect(m.data).toBeTruthy(); expect(m.data_a_confirmar).toBeFalsy(); }
  expect(r.marcos[1].data).toBe('14/04/2026');
  expect(r.marcos[1].verificacao.situacao).toBe('divergente');
  expect(r.marcos[1].verificacao.evidencias[0].data).toBe('15/04/2026');
  expect(r.marcos[0].verificacao.situacao).toBe('sem_confirmacao');
});
