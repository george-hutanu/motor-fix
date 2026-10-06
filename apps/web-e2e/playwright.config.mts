import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// BASE_URL points the suite at a deployed environment; without it, the api, the
// worker and the web dev server are started locally.
const deployed = process.env['BASE_URL'];
// A cold build on a CI runner takes longer than Playwright's 60-second default.
const SERVER_START = 180_000;
// The api and the worker send e-mail and WhatsApp to the test mailbox (mailbox.mjs,
// web-e2e:mailbox), which the tests read. Nx starts every webServer below as a
// continuous task before Playwright runs, so a webServer `env` never reaches
// them, and a command that is not `nx run` breaks that inference: the sending
// settings (EMAIL_SENDING=on, BREVO_API_URL=<mailbox>/v3, EMAIL_ALLOWLIST=
// @example.test, EMAIL_FROM, BREVO_API_KEY, and for the sign-in codes
// PHONE_SENDING=on, PHONE_ALLOWLIST=+4070000*, WHATSAPP_SENDER and
// WHATSAPP_TEMPLATES) come from the environment, set by CI's E2E job and by
// .env locally.
const MAILBOX = 'http://127.0.0.1:3025';
// The api reads the stand-in OpenID issuer (openid.mjs, web-e2e:openid) as
// Google when GOOGLE_ISSUER points at it, with any GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET: CI's E2E job and .env locally set them.
const OPENID = 'http://127.0.0.1:3026';

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  // Flows tagged @seeded sign in with the seeded accounts; a deployed address
  // runs them only when it is given their password. Flows tagged @mailbox read
  // the local test mailbox, and flows tagged @openid the local stand-in
  // issuer, which a deployed address does not have.
  grepInvert: deployed
    ? process.env['E2E_PASSWORD']
      ? /@mailbox|@openid/
      : /@seeded|@mailbox|@openid/
    : undefined,
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
          command: 'npx nx run web-e2e:mailbox',
          reuseExistingServer: true,
          url: `${MAILBOX}/v3/account`,
        },
        {
          command: 'npx nx run web-e2e:openid',
          reuseExistingServer: true,
          url: `${OPENID}/jwks`,
        },
        {
          command: 'npx nx run api:serve',
          reuseExistingServer: true,
          timeout: SERVER_START,
          url: 'http://localhost:3000/health/live',
        },
        // The worker relays the outbox's events to the live streams.
        {
          command: 'npx nx run worker:serve',
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
