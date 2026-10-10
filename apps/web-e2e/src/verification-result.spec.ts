import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS } from './accounts.js';
import { test } from './fixtures.js';

// The decision e-mail as the worker sent it, read from the test mailbox the
// local run starts (mailbox.mjs); a deployed address has none, so the config
// leaves out flows tagged @mailbox there.
const MAILBOX = 'http://127.0.0.1:3025';
const SUBJECT = 'Service-ul tău e aprobat și pe hartă';
const SLUG = 'atelier-test';

interface Mail {
  subject: string;
  textContent: string;
}

async function decisionMails(page: Page, email: string): Promise<Mail[]> {
  const res = await page.request.get(
    `${MAILBOX}/messages?to=${encodeURIComponent(email)}`,
  );
  const sent: Mail[] = await res.json();
  return sent.filter((m) => m.subject === SUBJECT);
}

// No endpoint submits or decides a verification file today, so the test
// records the decision's event as the verification service would; the relay
// and the worker do the rest. Every run that has the mailbox has the
// database too, so the flow needs DATABASE_URL and fails without it.
test.describe('the verification result e-mail @seeded @mailbox', () => {
  let db: Client;
  let eventId: string | undefined;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterEach(async () => {
    if (!eventId) return;
    await db.query('DELETE FROM notification WHERE event_id = $1', [eventId]);
    await db.query('DELETE FROM outbox_event WHERE id = $1', [eventId]);
    eventId = undefined;
  });

  test.afterAll(async () => {
    await db.end();
  });

  // @traces 209-FR-015
  test('an approval reaches the owner once, in Romanian, and none of the other staff', async ({
    page,
  }) => {
    const before = {
      mechanic: (await decisionMails(page, ACCOUNTS.mechanic)).length,
      owner: (await decisionMails(page, ACCOUNTS.garage)).length,
      receptionist: (await decisionMails(page, ACCOUNTS.receptionist)).length,
    };
    const { rows } = await db.query<{ file: string; garage: string }>(
      `SELECT f.id AS file, g.id AS garage FROM verification_file f
         JOIN garage g ON g.id = f.garage_id
       WHERE g.slug = $1 ORDER BY f.created_at DESC LIMIT 1`,
      [SLUG],
    );
    expect(rows[0], 'the seeded garage has no verification file').toBeDefined();
    const { file, garage } = rows[0] ?? { file: '', garage: '' };
    const recorded = await db.query<{ id: string }>(
      `INSERT INTO outbox_event (audience, kind, payload, subject_id)
       VALUES ($1, 'verification.decided', $2, $3) RETURNING id::text`,
      [
        [`garage:${garage}`],
        JSON.stringify({
          decision: 'approved',
          fileId: file,
          garageId: garage,
        }),
        file,
      ],
    );
    eventId = recorded.rows[0]?.id;

    await expect
      .poll(async () => (await decisionMails(page, ACCOUNTS.garage)).length, {
        message: 'no decision e-mail sent to the owner',
        timeout: 30_000,
      })
      .toBe(before.owner + 1);

    const [mail] = (await decisionMails(page, ACCOUNTS.garage)).slice(-1);
    expect(mail?.textContent).toContain(`/ro/garages/${SLUG}`);
    expect(mail?.textContent).toContain('/app/garage');
    expect((await decisionMails(page, ACCOUNTS.receptionist)).length).toBe(
      before.receptionist,
    );
    expect((await decisionMails(page, ACCOUNTS.mechanic)).length).toBe(
      before.mechanic,
    );
  });
});
