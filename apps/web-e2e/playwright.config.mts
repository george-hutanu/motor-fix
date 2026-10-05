import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// BASE_URL points the suite at a deployed environment; without it, the api, the
// worker and the web dev server are started locally.
const deployed = process.env['BASE_URL'];
// A cold build on a CI runner takes longer than Playwright's 60-second default.
const SERVER_START = 180_000;
// The api and the worker send e-mail to the test mailbox (mailbox.mjs), which
// the tests read; only @example.test addresses get one.
const MAILBOX = 'http://127.0.0.1:3025';
const sending = {
  BREVO_API_KEY: 'e2e-mailbox-key',
  BREVO_API_URL: `${MAILBOX}/v3`,
  EMAIL_ALLOWLIST: '@example.test',
  EMAIL_FROM: 'MotorFix <noreply@example.test>',
  EMAIL_SENDING: 'on',
};

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  // Flows tagged @seeded sign in with the seeded accounts; a deployed address
  // runs them only when it is given their password.
  grepInvert: deployed && !process.env['E2E_PASSWORD'] ? /@seeded/ : undefined,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    baseURL: deployed ?? 'http://localhost:4200',
    // A service worker's requests bypass page.route stubs; pwa.spec allows it.
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  webServer: deployed
    ? undefined
    : [
        {
          command: 'node mailbox.mjs',
          reuseExistingServer: true,
          url: `${MAILBOX}/v3/account`,
        },
        {
          command: 'npx nx run api:serve',
          env: sending,
          reuseExistingServer: true,
          timeout: SERVER_START,
          url: 'http://localhost:3000/health/live',
        },
        // The worker relays the outbox's events to the live streams.
        {
          command: 'npx nx run worker:serve',
          env: sending,
          reuseExistingServer: true,
          timeout: SERVER_START,
          url: 'http://localhost:3001/health/live',
        },
        {
          command: 'npx nx run web:serve',
          reuseExistingServer: true,
          timeout: SERVER_START,
          url: 'http://localhost:4200',
        },
      ],
});
