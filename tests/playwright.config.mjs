import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.mjs/,
  timeout: 90_000,
  workers: 1,                       // o banco de teste é compartilhado entre os testes
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.mjs',
  globalTeardown: './e2e/global-teardown.mjs',
  use: { baseURL: 'http://127.0.0.1:8788', viewport: { width: 1280, height: 800 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
