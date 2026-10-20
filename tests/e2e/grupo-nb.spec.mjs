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
    const ativs = ATIVS.map(a => Object.assign({}, a, window.NUCLEO.classificar(a.descricao, a.tipo, Object.assign([], { destaquesComite: true }), 'insolvencia')));
    const nat = ativs.map(a => a.natureza);
    const b = window.Inteligencia.montarBriefing({ atividades: ativs, tarefasFuturas: [], indicadores: {}, config: { destaquesComite: true } });
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

test('texto completo: sem a opção o cartão corta em 3 linhas; com a opção sai por inteiro, mesmo muito longo', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const longo = Array.from({ length: 140 }, (_, i) => `palavra${i}`).join(' ') + ' FIMDOTEXTO.';
  const r = await fr.evaluate(async ({ longo }) => {
    const gerar = (completo) => {
      const g = new GeradorRelatorioPDF();
      const doc = g.gerarExecutivo({ cliente: 'CLIENTE TESTE', periodoISO: '2026-10', indicadores: {}, atividades: [],
        briefing: { marcos: [], proximosPassos: [], acontecimentos: [{ data: '15/10/2026', numero_processo: '0001', descricao: longo, completo }], entregas: [{ data: '16/10/2026', descricao: longo, completo }] },
        config: { exibirEsforco: false, exibirLinhaTempo: false }, ondeEstamos: {} });
      return Array.from(new Uint8Array(doc.output('arraybuffer')));
    };
    const ler = async (bytes) => { const d = await window.NGA_ABRIR_PDF(new Uint8Array(bytes)); let t = ''; for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map(x => x.str).join(' ') + ' '; return { t, paginas: d.numPages }; };
    return { curto: await ler(gerar(false)), completo: await ler(gerar(true)) };
  }, { longo });
  expect(r.curto.t).toContain('palavra0'); expect(r.curto.t).not.toContain('FIMDOTEXTO');
  expect(r.completo.t).toContain('palavra0'); expect(r.completo.t).toContain('palavra139'); expect(r.completo.t).toContain('FIMDOTEXTO');
  expect(r.completo.t).toContain('(continuação)');                          // texto muito longo vira mais de um bloco, sem estourar a página
});

test('resumo de e-mail: "E-mail encaminhado a ..., com anexo: ..." só com o que o texto diz, sem cortar no meio', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const E20 = 'Prezados(as) Senhores(as) Membros do Comitê de Credores, Em complemento ao e-mail anteriormente encaminhado, contendo a ata da reunião, encaminhamos, em anexo, Nota Técnica elaborada a respeito da proposta de acordo submetida à análise. O documento é encaminhado com o objetivo de fornecer elementos para avaliação. Permanecemos à disposição para quaisquer esclarecimentos adicionais. At.te';
  const E15 = 'Prezados(as) Senhores(as) Membros do Comitê de Credores, Agradecemos, novamente, a participação de todos na 2ª Reunião do Comitê de Credores. Em anexo, Termo de Acordo entre a NBB Crédito e JMF Comércio e Minuta de Termo de Acordo da CONDUSPAR. Em anexo, também, a ata da Reunião do Comitê de Credores. Por fim, fica agendada a reunião abaixo • Data e horário: 02 de dezembro de 2026, às 14h00. • Formato: híbrida. Seguimos à disposição, At.te';
  const mk = (d, data) => ({ descricao: d, tipo: 'Histórico manual', data, numero_processo: '1', funcao: 'ENTREGA', esforco: 3 });
  const out = await fr.evaluate(([a, b]) => window.Inteligencia.selecionarAcontecimentos([a, b, { descricao: 'Prezado João, Segue a minuta para sua análise.', tipo: 'Histórico manual', data: '10/10/2026', numero_processo: '1', funcao: 'ENTREGA', esforco: 3 }], null, { destaquesComite: true }).map(x => x.descricao), [mk(E20, '20/10/2026'), mk(E15, '15/10/2026')]);
  expect(out).toContain('E-mail encaminhado aos Membros do Comitê de Credores, em complemento ao e-mail anterior, com anexo: Nota Técnica elaborada a respeito da proposta de acordo submetida à análise.');
  expect(out).toContain('E-mail encaminhado aos Membros do Comitê de Credores, após a 2ª Reunião do Comitê de Credores, com anexos: Termo de Acordo entre a NBB Crédito e JMF Comércio e Minuta de Termo de Acordo da CONDUSPAR; ata da Reunião do Comitê de Credores. Reunião agendada para 02/12/2026, às 14h00.');
  expect(out).toContain('E-mail encaminhado a João: Segue a minuta para sua análise.');
});

test('sem a opção "Destaques do comitê" o comportamento dos outros clientes não muda', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const r = await fr.evaluate(({ EMAIL_15, ATIVS }) => {
    const ativs = ATIVS.map(a => Object.assign({}, a, window.NUCLEO.classificar(a.descricao, a.tipo, [], 'insolvencia')));
    const b = window.Inteligencia.montarBriefing({ atividades: ativs, tarefasFuturas: [], indicadores: {}, config: {} });
    return { nat: ativs.map(a => a.natureza), acont: b.acontecimentos.map(a => a.descricao), passos: b.proximosPassos, max: b.acontecimentos.map(a => a.linhasMax) };
  }, { EMAIL_15, ATIVS });
  expect(r.nat).not.toContain('Reunião do comitê de credores');
  expect(r.nat).not.toContain('Comunicação ao comitê / credores');
  expect(r.acont.some(d => d.startsWith('Prezados(as) Senhores(as)'))).toBe(true);   // texto original, sem resumo
  expect(r.acont.some(d => d.startsWith('E-mail encaminhado'))).toBe(false);
  expect(r.passos).toEqual([]);                                                      // sem sugestão de reunião agendada
  expect(new Set(r.max)).toEqual(new Set([3]));                                      // corte original de 3 linhas
  // a opção existe no cadastro do cliente, desligada por padrão
  await fr.evaluate(() => window.NGA_CTX.irPara('clientes'));
  expect(await fr.evaluate(() => { const c = document.getElementById('cf-comite'); return !!c && !c.checked; })).toBe(true);
});
