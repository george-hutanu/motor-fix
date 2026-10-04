import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// BASE_URL points the suite at a deployed environment; without it, the api and
// the web dev server are started locally.
const deployed = process.env['BASE_URL'];

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    baseURL: deployed ?? 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  webServer: deployed
    ? undefined
    : [
        {
          command: 'npx nx run api:serve',
          reuseExistingServer: true,
          url: 'http://localhost:3000/health/live',
        },
        {
          command: 'npx nx run web:serve',
          reuseExistingServer: true,
          url: 'http://localhost:4200',
        },
      ],
});
