import { test, expect } from '@playwright/test';
import { entrar, geradorPronto, GANCHOS, analisarPdf } from './helpers.mjs';

const estado = {
  cliente: 'Cliente período QA', periodoISO: '2026-09',
  processos: [{ numero_processo: '0001' }, { numero_processo: '0002' }],
  atividadesBrutas: [
    { numero_processo: '0001', tipo: 'Histórico manual', data: '31/08/2026', descricao: 'No dia 31/08/2026, ANTIGO_AGOSTO.' },
    { numero_processo: '0001', tipo: 'Histórico manual', data: '01/09/2026', descricao: 'No dia 15/08/2026, REGISTRO_SETEMBRO_INICIO.' },
    { numero_processo: '0001', tipo: 'Histórico manual', data: '30/09/2026', descricao: 'No dia 30/09/2026, REGISTRO_SETEMBRO_FIM.' },
    { numero_processo: '0001', tipo: 'Histórico manual', data: '01/10/2026', descricao: 'No dia 29/09/2026, FUTURO_OUTUBRO.' },
    { numero_processo: '0001', tipo: 'Histórico manual', data: '31/09/2026', descricao: 'No dia 30/09/2026, DATA_INVALIDA.' },
    { numero_processo: '0002', tipo: 'Histórico manual', data: '12/08/2026', descricao: 'No dia 12/08/2026, OUTRO_ANTIGO.' },
    { numero_processo: '0001', tipo: 'Histórico manual', data: '', descricao: 'No dia 15/09/2026, SEM_DATA_REGISTRO.' },
  ],
};

test('andamentos: mês de registro filtra antes do limite e vale para prévia e PDF', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  await fr.evaluate(GANCHOS);
  await fr.evaluate(e => { window.NGA_CTX.irPara('novo'); window.NGA_ANDAMENTOS.abrir(e); }, estado);
  await expect(fr.locator('#an-cliente')).toContainText('09/2026');
  await expect(fr.locator('#an-tabela tbody tr')).toHaveCount(1);
  await expect(fr.locator('#an-tabela')).toContainText('REGISTRO_SETEMBRO_FIM');
  await fr.locator('#an-quantos').selectOption('5');
  await expect(fr.locator('#an-tabela tbody tr')).toHaveCount(2);
  await expect(fr.locator('#an-tabela')).toContainText('REGISTRO_SETEMBRO_INICIO');
  for (const ausente of ['ANTIGO_AGOSTO', 'FUTURO_OUTUBRO', 'OUTRO_ANTIGO', 'SEM_DATA_REGISTRO', 'DATA_INVALIDA']) await expect(fr.locator('#an-tabela')).not.toContainText(ausente);
  await fr.locator('#an-gerar').click();
  await fr.waitForFunction(() => window.__pdfs.length > 0);
  const pdf = await fr.evaluate(() => window.__pdfs[0]);
  const paginas = await analisarPdf(fr, pdf.bytes);
  const texto = paginas.map(p => p.texto).join(' ');
  expect(texto).toContain('REGISTRO_SETEMBRO_FIM'); expect(texto).toContain('REGISTRO_SETEMBRO_INICIO');
  for (const ausente of ['ANTIGO_AGOSTO', 'FUTURO_OUTUBRO', 'OUTRO_ANTIGO', 'SEM_DATA_REGISTRO', 'DATA_INVALIDA']) expect(texto).not.toContain(ausente);
  await fr.evaluate(e => window.NGA_ANDAMENTOS.abrir({ ...e, periodoISO: '2026-07' }), estado);
  await expect(fr.locator('#an-gerar')).toBeDisabled();
  await expect(fr.locator('#an-tabela tbody tr')).toHaveCount(0);
  await fr.evaluate(e => window.NGA_ANDAMENTOS.abrir({ ...e, periodoISO: '' }), estado);
  await expect(fr.locator('#an-alert')).toContainText('Configure o mês');
});

for (const [email, admin] of [['admin@teste.local', true], ['adv@teste.local', false], ['vis@teste.local', false]]) {
  test(`Revisional beta: visibilidade para ${email}`, async ({ page }) => {
    await entrar(page, email); const fr = await geradorPronto(page);
    await fr.evaluate(() => window.NGA_CTX.irPara('novo'));
    if (admin) await expect(fr.locator('[data-mode="revisional"]')).toContainText('Beta');
    else {
      await expect(fr.locator('[data-mode="revisional"]')).toHaveCount(0);
      await fr.evaluate(() => {
        sessionStorage.setItem('nga_auth_session_v1', JSON.stringify({ role: 'admin' }));
        window.NGA_REVISIONAL.integrar();
      });
      await expect(fr.locator('[data-mode="revisional"]')).toHaveCount(0);
      await expect(fr.locator('#panel-revisional')).toBeHidden();
    }
  });
}