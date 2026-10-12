import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',
  use: { baseURL: 'http://localhost:3000', headless: true, screenshot: 'only-on-failure', trace: 'off', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] } },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000/api/health', reuseExistingServer: true, timeout: 180000 }
});
