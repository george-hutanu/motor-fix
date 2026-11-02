import { expect, type Page } from '@playwright/test';

import { MAILBOX } from './fixtures.js';

// The last sign-in code the api sent a number on WhatsApp, read from the test
// mailbox the local run starts (mailbox.mjs); a deployed address has none.
export async function lastCode(page: Page, phone: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILBOX}/whatsapp?to=${encodeURIComponent(phone.slice(1))}`,
        );
        const sent: { params: string[] }[] = await res.json();
        code = sent.at(-1)?.params[0];
        return code;
      },
      { message: 'no WhatsApp message sent', timeout: 20_000 },
    )
    .toMatch(/^\d{6}$/);
  return String(code);
}
