import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS } from './accounts.js';
import { MAILBOX, test } from './fixtures.js';

// The decision e-mail as the worker sent it, read from the test mailbox the
// local run starts (mailbox.mjs); a deployed address has none, so the config
// leaves out flows tagged @mailbox there.
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
  let fileId: string | undefined;

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

  test.afterEach(async () => {
    if (!fileId) return;
    await db.query('DELETE FROM verification_file WHERE id = $1', [fileId]);
    fileId = undefined;
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
    // The seed gives the owner's garage no verification file, so the test
    // adds the decided one the event names, and removes it afterwards.
    const { rows } = await db.query<{ file: string; garage: string }>(
      `INSERT INTO verification_file (id, garage_id, status, opened_at, decided_at)
       SELECT gen_random_uuid(), g.id, 'approved', now(), now() FROM garage g
       WHERE g.slug = $1
       RETURNING id::text AS file, garage_id::text AS garage`,
      [SLUG],
    );
    expect(rows[0], 'the seeded garage is missing').toBeDefined();
    const { file, garage } = rows[0] ?? { file: '', garage: '' };
    fileId = file;
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
