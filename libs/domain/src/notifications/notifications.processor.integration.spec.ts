// @traces 195-FR-002 195-FR-005 195-FR-010 195-FR-011 539-FR-001 539-FR-002

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { Brevo } from './brevo/brevo';
import { BrevoMock } from './brevo/brevo-mock.testing';
import { NotificationsProcessor, retryDelay } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import {
  claimAgo,
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';

// What main's REQUEST_REMINDER template words (ST-1257).
const REMINDER = {
  car: 'Dacia Logan',
  driver: 'Andrei M.',
  link: 'https://motorfix.example/app/garage/requests',
};

const redisUrl = redisUrlFor(12);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);
const pushConfig = {
  privateKey: 'private',
  publicKey: 'public',
  subject: 'mailto:ops@example.test',
};
const pushFallbacks = () =>
  prisma.notification.count({
    where: { channel: 'push', fallbackOf: { not: null } },
  });
// A device, with e-mail kept as the quote's channel: a device alone now makes
// push the default, and these tests send e-mail first.
const withDevice = async (accountId: string) => {
  await prisma.pushSubscription.create({
    data: {
      accountId,
      auth: 'a',
      endpoint: `https://push.example.test/${accountId}`,
      p256dh: 'p',
    },
  });
  await prisma.notificationPreference.create({
    data: {
      accountId,
      channel: 'email',
      enabled: true,
      type: 'QUOTE_RECEIVED',
    },
  });
};

let service: NotificationsService;
let processor: NotificationsProcessor;

const at = (iso: string) => () => new Date(iso);
const DAY = '2026-10-05T11:00:00Z';

function build(overrides: Record<string, string> = {}) {
  const config = testConfig(mock.url, overrides);
  service = new NotificationsService(
    prisma,
    queue,
    publisher,
    config,
    pushConfig,
    new AuditService(),
  );
  service.now = at(DAY);
  processor = new NotificationsProcessor(
    prisma,
    service,
    new Brevo({ apiKey: config.apiKey ?? '', apiUrl: config.apiUrl }),
    config,
    testPhoneConfig({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '' }),
  );
}

beforeAll(() => mock.start());

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  mock.reset();
  build();
});

const emailRows = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, channel: 'email' },
  });

const sendJob = (id: string, attemptsMade = 0) =>
  processor.handle({ attemptsMade, data: { id }, name: 'send' });

// What the quote fan-out puts in a QUOTE_RECEIVED.
const QUOTE = {
  garage: 'Atelier Dinamo',
  link: 'https://motorfix.test/app/driver/requests/r-1',
  range: '450–600',
};

async function quote(recipient: string, eventId: string) {
  await service.notify({
    eventId,
    kind: 'QUOTE_RECEIVED',
    params: QUOTE,
    recipients: [recipient],
  });
  return (await emailRows(recipient)).at(-1)!;
}

describe('sending one e-mail', () => {
  it('sends it through Brevo and records the message id and sent time', async () => {
    const andrei = await account('andrei', ['driver'], { language: 'en' });
    const row = await quote(andrei, 'evt-1');
    processor.now = at('2026-10-05T11:00:20Z');
    await sendJob(row.id);
    expect(mock.emails()).toHaveLength(1);
    expect(mock.emails()[0].body).toMatchObject({
      sender: { email: 'noreply@example.test', name: 'MotorFix' },
      to: [{ email: 'andrei@example.test', name: 'andrei' }],
    });
    const [sent] = await emailRows(andrei);
    expect(sent).toMatchObject({
      providerMessageId: '<mock-1@smtp-relay.mailin.fr>',
      status: 'sent',
    });
    expect(sent.sentAt?.toISOString()).toBe('2026-10-05T11:00:20.000Z');
  });

  // @traces 279-FR-004
  it('answers to the support address of the sending domain', async () => {
    build({ EMAIL_DOMAIN: 'example.test' });
    const andrei = await account('andrei', ['driver'], { language: 'en' });
    const row = await quote(andrei, 'evt-reply');
    await sendJob(row.id);
    expect(mock.emails()[0].body).toMatchObject({
      replyTo: { email: 'support@example.test', name: 'MotorFix' },
      sender: { email: 'noreply@example.test', name: 'MotorFix' },
    });
  });

  it('writes the test message in the recipient language', async () => {
    const en = await account('en', ['admin'], { language: 'en' });
    const ro = await account('ro', ['driver'], { language: 'ro' });
    await service.notify({
      eventId: 't',
      kind: 'TEST_MESSAGE',
      recipients: [en, ro],
    });
    for (const id of [en, ro]) await sendJob((await emailRows(id))[0].id);
    const [toEn, toRo] = mock.emails().map(
      (c) =>
        c.body as {
          subject: string;
          textContent: string;
          htmlContent: string;
        },
    );
    expect(toEn.subject).toBe('MotorFix test message');
    expect(toEn.textContent).toContain('This is a test message from MotorFix.');
    expect(toEn.htmlContent).toContain('This is a test message from MotorFix.');
    expect(toEn.htmlContent).toContain('href="https://motorfix.test"');
    expect(toRo.subject).toBe('Mesaj de test MotorFix');
    expect(toRo.textContent).toContain('Primești');
    expect(toRo.htmlContent).toContain('Primești');
  });

  it('fails the row and calls nobody when its template cannot render', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const ana = await account('ana');
    await service.notify({
      eventId: 'no-link',
      kind: 'ACCOUNT_EMAIL',
      params: { purpose: 'email_check' },
      recipients: [ana],
    });
    await sendJob((await emailRows(ana))[0].id);
    expect(mock.emails()).toHaveLength(0);
    expect(await pushFallbacks()).toBe(0);
    const [row] = await emailRows(ana);
    expect([row.status, row.failure]).toEqual(['failed', 'template_failed']);
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/ACCOUNT_EMAIL.*email.*missing value link/),
    );
    error.mockRestore();
  });

  it('fails the test message when the web app address is not configured', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    build({ PUBLIC_WEB_URL: '' });
    const ana = await account('ana');
    await service.notify({
      eventId: 't',
      kind: 'TEST_MESSAGE',
      recipients: [ana],
    });
    await sendJob((await emailRows(ana))[0].id);
    expect(mock.emails()).toHaveLength(0);
    const [row] = await emailRows(ana);
    expect(row.failure).toBe('template_failed');
    error.mockRestore();
  });

  it('keeps the configured web address when a row carries its own app value', async () => {
    const ana = await account('ana', ['admin'], { language: 'en' });
    await service.notify({
      eventId: 't-app',
      kind: 'TEST_MESSAGE',
      params: { app: 'https://elsewhere.example' },
      recipients: [ana],
    });
    await sendJob((await emailRows(ana))[0].id);
    const html = (mock.emails()[0].body as { htmlContent: string }).htmlContent;
    expect(html).toContain('href="https://motorfix.test"');
    expect(html).not.toContain('elsewhere.example');
  });

  it('puts the account e-mail link into the e-mail', async () => {
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/reset?t=xyz',
      purpose: 'password_reset',
    });
    await sendJob((await emailRows(ana))[0].id);
    expect(
      (mock.emails()[0].body as { textContent: string }).textContent,
    ).toContain('https://motorfix.test/reset?t=xyz');
  });

  it('does not call Brevo again for a row already sent', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    await sendJob(row.id);
    await sendJob(row.id);
    expect(mock.emails()).toHaveLength(1);
  });

  it('fails the row without sending when the account was deleted meanwhile', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: andrei },
    });
    await sendJob(row.id);
    expect(mock.emails()).toEqual([]);
    expect((await emailRows(andrei))[0]).toMatchObject({
      failure: 'account_deleted',
      status: 'failed',
    });
  });
});

describe('the link an account e-mail carries', () => {
  const LINK = 'https://motorfix.test/ro/reset-password/secret-token';

  async function issue(accountId: string) {
    await service.sendAccountEmail({
      accountId,
      link: LINK,
      purpose: 'password_reset',
    });
  }

  const storedLinks = async (accountId: string) =>
    (
      await prisma.notification.findMany({
        orderBy: { createdAt: 'asc' },
        where: { accountId },
      })
    ).map((row) => [row.channel, row.status, 'link' in Object(row.params)]);

  it('is never stored on the bell row', async () => {
    const ana = await account('ana');
    await issue(ana);
    const bell = await prisma.notification.findFirstOrThrow({
      where: { accountId: ana, channel: 'in_app' },
    });
    expect(bell.params).toEqual({ purpose: 'password_reset' });
  });

  it('reaches the e-mail and is gone from its row once it is sent', async () => {
    const ana = await account('ana');
    await issue(ana);
    await sendJob((await emailRows(ana))[0].id);
    expect(
      (mock.emails()[0].body as { textContent: string }).textContent,
    ).toContain(LINK);
    expect(await storedLinks(ana)).toEqual([
      ['in_app', 'sent', false],
      ['email', 'sent', false],
    ]);
    expect((await emailRows(ana))[0].params).toEqual({
      purpose: 'password_reset',
    });
  });

  it('stays on the row while Brevo asks for a retry', async () => {
    const ana = await account('ana');
    await issue(ana);
    mock.answer({ status: 503 });
    await expect(
      sendJob((await emailRows(ana))[0].id, 0),
    ).rejects.toBeDefined();
    expect(await storedLinks(ana)).toEqual([
      ['in_app', 'sent', false],
      ['email', 'queued', true],
    ]);
  });

  it('is gone from the row Brevo refuses for good', async () => {
    const ana = await account('ana');
    await issue(ana);
    mock.answer({ status: 400 });
    await sendJob((await emailRows(ana))[0].id, 0);
    expect(await storedLinks(ana)).toEqual([
      ['in_app', 'sent', false],
      ['email', 'failed', false],
    ]);
  });

  it('is gone from the row failed because sending was switched off', async () => {
    const ana = await account('ana');
    await issue(ana);
    const [row] = await emailRows(ana);
    build({ EMAIL_SENDING: 'off' });
    await sendJob(row.id);
    expect(await storedLinks(ana)).toEqual([
      ['in_app', 'sent', false],
      ['email', 'failed', false],
    ]);
  });

  it('is gone from the row failed because the account was deleted', async () => {
    const ana = await account('ana');
    await issue(ana);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: ana },
    });
    await sendJob((await emailRows(ana))[0].id);
    expect(await storedLinks(ana)).toEqual([
      ['in_app', 'sent', false],
      ['email', 'failed', false],
    ]);
  });

  it('is never stored on a row written failed while sending is off', async () => {
    build({ EMAIL_SENDING: 'off' });
    const ana = await account('ana');
    await issue(ana);
    expect(await storedLinks(ana)).toEqual([
      ['in_app', 'sent', false],
      ['email', 'failed', false],
    ]);
  });

  it('is never stored on a row written failed for an address not allowlisted', async () => {
    build({ EMAIL_ALLOWLIST: 'someone@else.test' });
    const ana = await account('ana');
    await issue(ana);
    const [row] = await emailRows(ana);
    expect([row.failure, 'link' in Object(row.params)]).toEqual([
      'not_allowed',
      false,
    ]);
  });
});

describe('switching sending off after a message was queued', () => {
  it('fails the queued row without calling Brevo', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    build({ EMAIL_SENDING: 'off' });
    await sendJob(row.id);
    expect(mock.emails()).toEqual([]);
    expect((await emailRows(andrei))[0]).toMatchObject({
      failure: 'sending_off',
      status: 'failed',
    });
    expect(await pushFallbacks()).toBe(0);
  });

  it('fails a queued row whose account no longer has an address', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    await prisma.account.update({
      data: { email: null },
      where: { id: andrei },
    });
    await sendJob(row.id);
    expect(mock.emails()).toEqual([]);
    expect((await emailRows(andrei))[0]).toMatchObject({
      failure: 'no_address',
      status: 'failed',
    });
  });

  it('fails a queued row whose address left the allow-list', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    build({ EMAIL_ALLOWLIST: 'someone@else.test' });
    await sendJob(row.id);
    expect(mock.emails()).toEqual([]);
    expect((await emailRows(andrei))[0]).toMatchObject({
      failure: 'not_allowed',
      status: 'failed',
    });
  });
});

describe('a job the worker does not know', () => {
  it('is refused', () => {
    expect(() =>
      processor.handle({ attemptsMade: 0, data: {}, name: 'other' }),
    ).toThrow(/unknown notifications job/);
  });
});

describe('the sweep job', () => {
  it('re-queues the stranded rows', async () => {
    const sweep = jest.spyOn(service, 'requeueStranded').mockResolvedValue(2);
    await expect(
      processor.handle({ attemptsMade: 0, data: {}, name: 'requeue' }),
    ).resolves.toBeUndefined();
    expect(sweep).toHaveBeenCalledTimes(1);
    sweep.mockRestore();
  });
});

// @traces 523-FR-011 523-FR-012 523-FR-013
describe('the sweep of held rows whose job was lost', () => {
  const NIGHT = '2026-10-04T20:10:00Z';
  const sweep = () =>
    processor.handle({ attemptsMade: 0, data: {}, name: 'requeue' });
  // Runs every job the sweep left waiting, twice, as a duplicate would.
  const runWaiting = async () => {
    const jobs = await queue.getJobs(['waiting']);
    for (const job of [...jobs, ...jobs])
      await processor.handle({
        attemptsMade: 0,
        data: job.data,
        name: job.name,
      });
    return jobs;
  };
  const clocks = (iso: string) => {
    service.now = at(iso);
    processor.now = at(iso);
  };

  async function heldOvernight() {
    const ion = await account('ion', ['garage']);
    service.now = at(NIGHT);
    await service.notify({
      eventId: 'r',
      kind: 'REQUEST_REMINDER',
      // The values its template words (ST-1257).
      params: REMINDER,
      recipients: [ion],
    });
    await queue.obliterate({ force: true });
    return { ion, row: (await emailRows(ion))[0] };
  }

  it('sends a held row once when its release job was lost and its send time passed five minutes ago', async () => {
    const { ion, row } = await heldOvernight();
    expect(row.status).toBe('held');
    clocks(
      new Date(row.sendAfter!.getTime() + 5 * 60_000 + 1000).toISOString(),
    );
    await sweep();
    const jobs = await runWaiting();
    expect(jobs.map((j) => j.name)).toEqual(['send']);
    expect(mock.emails()).toHaveLength(1);
    expect((await emailRows(ion))[0]).toMatchObject({
      claimedAt: null,
      status: 'sent',
    });
  });

  it('leaves a held row until five minutes past its send time', async () => {
    const { ion, row } = await heldOvernight();
    clocks(new Date(row.sendAfter!.getTime() + 4 * 60_000).toISOString());
    await sweep();
    expect(await queue.getJobs(['waiting', 'delayed'])).toEqual([]);
    expect((await emailRows(ion))[0].status).toBe('held');
  });

  it('leaves a held row that carries a send claim', async () => {
    const { row } = await heldOvernight();
    await claimAgo(prisma, row.id, 0);
    clocks(new Date(row.sendAfter!.getTime() + 10 * 60_000).toISOString());
    await sweep();
    expect(await queue.getJobs(['waiting', 'delayed'])).toEqual([]);
  });

  it('sends the grouped e-mail once when a window lost its flush job', async () => {
    const andrei = await account('andrei');
    const leader = await quote(andrei, 'evt-a');
    await sendJob(leader.id);
    service.now = at('2026-10-05T11:01:00Z');
    await quote(andrei, 'evt-b');
    await quote(andrei, 'evt-c');
    await queue.obliterate({ force: true });
    clocks('2026-10-05T11:10:01Z');
    await sweep();
    const jobs = await runWaiting();
    expect(jobs.map((j) => [j.name, j.data])).toEqual([
      ['flush', { leaderId: leader.id }],
    ]);
    expect(mock.emails()).toHaveLength(2);
    expect((mock.emails()[1].body as { subject: string }).subject).toBe(
      '2 oferte noi',
    );
    expect((await emailRows(andrei)).map((r) => r.status)).toEqual([
      'sent',
      'sent',
      'sent',
    ]);
  });

  it('still re-queues the stranded queued rows when the held sweep fails', async () => {
    const { row } = await heldOvernight();
    clocks(new Date(row.sendAfter!.getTime() + 10 * 60_000).toISOString());
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const stranded = jest
      .spyOn(service, 'requeueStranded')
      .mockResolvedValue(1);
    const read = jest
      .spyOn(prisma.notification, 'findMany')
      .mockRejectedValue(new Error('connection lost'));
    try {
      await expect(sweep()).resolves.toBeUndefined();
      expect(stranded).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('connection lost'),
      );
    } finally {
      read.mockRestore();
      stranded.mockRestore();
      warn.mockRestore();
    }
  });
});

// @traces 094-FR-012
describe('when Brevo fails', () => {
  it('retries after 1, 5, 15, 60 and 240 minutes', () => {
    expect([0, 1, 2, 3, 4].map(retryDelay)).toEqual(
      [1, 5, 15, 60, 240].map((m) => m * 60_000),
    );
  });

  it('leaves the row queued and asks for a retry on a server error', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    mock.answer({ status: 503 });
    await expect(sendJob(row.id, 0)).rejects.toThrow();
    expect((await emailRows(andrei))[0].status).toBe('queued');
    expect(await pushFallbacks()).toBe(0);
  });

  it('fails the row and falls back to push after the last retry', async () => {
    const andrei = await account('andrei');
    await withDevice(andrei);
    const row = await quote(andrei, 'evt-1');
    mock.answer({ status: 503 });
    await sendJob(row.id, 5);
    const [failed] = await emailRows(andrei);
    expect(failed).toMatchObject({ failure: 'provider_503', status: 'failed' });
    expect(await pushFallbacks()).toBe(1);
    const bell = await prisma.notification.findFirst({
      where: { accountId: andrei, channel: 'in_app' },
    });
    expect(bell?.status).toBe('sent');
  });

  it('fails the row at once on a refusal that a retry cannot fix', async () => {
    const andrei = await account('andrei');
    await withDevice(andrei);
    const row = await quote(andrei, 'evt-1');
    mock.answer({ status: 400 });
    await expect(sendJob(row.id, 0)).resolves.toBeUndefined();
    expect((await emailRows(andrei))[0]).toMatchObject({
      failure: 'provider_400',
      status: 'failed',
    });
    expect(await pushFallbacks()).toBe(1);
  });

  it('names the type and channel when it logs a retry', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    mock.answer({ status: 503 });
    await expect(sendJob(row.id)).rejects.toThrow();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(`${row.id} QUOTE_RECEIVED email`);
    warn.mockRestore();
  });

  it('logs the failure without the address or the message', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/reset?t=secret-token',
      purpose: 'password_reset',
    });
    mock.answer({ status: 400 });
    await sendJob((await emailRows(ana))[0].id);
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(logged).toContain('provider_400');
    expect(logged).not.toContain('ana@example.test');
    expect(logged).not.toContain('secret-token');
    warn.mockRestore();
    error.mockRestore();
  });
});

// @traces 879-FR-009 879-FR-011
describe('counting the e-mails Brevo accepted', () => {
  const reader = countedMetrics();
  const emailsSent = () => counterTotal(reader, 'motorfix_emails_sent_total');

  it('counts an accepted e-mail once and a refused one not at all', async () => {
    const andrei = await account('andrei');
    const maria = await account('maria');
    const before = await emailsSent();

    mock.answer({ status: 400 });
    await sendJob((await quote(andrei, 'evt-refused')).id);
    expect(await emailsSent()).toBe(before);

    await sendJob((await quote(maria, 'evt-accepted')).id);
    expect(mock.emails()).toHaveLength(2);
    expect(await emailsSent()).toBe(before + 1);
  });

  it('counts nothing while Brevo asks for a retry', async () => {
    const andrei = await account('andrei');
    const before = await emailsSent();
    mock.answer({ status: 503 });
    await sendJob((await quote(andrei, 'evt-retry')).id).catch(() => undefined);
    expect(await emailsSent()).toBe(before);
  });
});

describe('a grouping window', () => {
  it('sends the held rows as one e-mail naming their count when the window closes', async () => {
    const andrei = await account('andrei');
    const leader = await quote(andrei, 'evt-a');
    service.now = at('2026-10-05T11:01:00Z');
    await quote(andrei, 'evt-b');
    service.now = at('2026-10-05T11:03:00Z');
    await quote(andrei, 'evt-c');
    await sendJob(leader.id);
    await processor.handle({
      attemptsMade: 0,
      data: { leaderId: leader.id },
      name: 'flush',
    });
    expect(mock.emails()).toHaveLength(2);
    expect((mock.emails()[1].body as { subject: string }).subject).toBe(
      '2 oferte noi',
    );
    const rows = await emailRows(andrei);
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
    expect(rows[1].providerMessageId).toBe(rows[2].providerMessageId);
  });

  it('fails every held row without calling Brevo when sending was switched off', async () => {
    const andrei = await account('andrei');
    const leader = await quote(andrei, 'evt-a');
    service.now = at('2026-10-05T11:01:00Z');
    await quote(andrei, 'evt-b');
    await quote(andrei, 'evt-c');
    await sendJob(leader.id);
    build({ EMAIL_SENDING: 'off' });
    await processor.handle({
      attemptsMade: 0,
      data: { leaderId: leader.id },
      name: 'flush',
    });
    expect(mock.emails()).toHaveLength(1);
    const [, ...held] = await emailRows(andrei);
    expect(held.map((r) => [r.status, r.failure])).toEqual([
      ['failed', 'sending_off'],
      ['failed', 'sending_off'],
    ]);
  });

  it('sends a single held row as an ordinary e-mail', async () => {
    const andrei = await account('andrei');
    const leader = await quote(andrei, 'evt-a');
    service.now = at('2026-10-05T11:01:00Z');
    await quote(andrei, 'evt-b');
    await processor.handle({
      attemptsMade: 0,
      data: { leaderId: leader.id },
      name: 'flush',
    });
    expect(mock.emails()).toHaveLength(1);
    expect((mock.emails()[0].body as { subject: string }).subject).toBe(
      'Ofertă nouă de la Atelier Dinamo: 450–600 lei',
    );
  });

  it('fails every held row and falls back to push for each when the grouped e-mail fails for good', async () => {
    const andrei = await account('andrei');
    await withDevice(andrei);
    const leader = await quote(andrei, 'evt-a');
    service.now = at('2026-10-05T11:01:00Z');
    await quote(andrei, 'evt-b');
    await quote(andrei, 'evt-c');
    mock.answer({ status: 400 });
    await processor.handle({
      attemptsMade: 0,
      data: { leaderId: leader.id },
      name: 'flush',
    });
    const rows = await emailRows(andrei);
    expect(rows.slice(1).map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(await pushFallbacks()).toBe(2);
  });
});

// @traces 094-FR-011
describe('releasing a held message at 08:00', () => {
  const NIGHT = '2026-10-04T20:10:00Z';
  const MORNING = '2026-10-05T05:00:00Z';

  it('sends a held reminder when it is released', async () => {
    const ion = await account('ion', ['garage']);
    service.now = at(NIGHT);
    await service.notify({
      eventId: 'r',
      kind: 'REQUEST_REMINDER',
      // The values its template words (ST-1257).
      params: REMINDER,
      recipients: [ion],
    });
    service.now = at(MORNING);
    processor.now = at(MORNING);
    await sendJob((await emailRows(ion))[0].id);
    expect(mock.emails()).toHaveLength(1);
    expect((await emailRows(ion))[0].status).toBe('sent');
  });

  it('fails a held row whose account was deleted overnight', async () => {
    const ion = await account('ion', ['garage']);
    service.now = at(NIGHT);
    await service.notify({
      eventId: 'r',
      kind: 'REQUEST_REMINDER',
      // The values its template words (ST-1257).
      params: REMINDER,
      recipients: [ion],
    });
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: ion },
    });
    service.now = at(MORNING);
    processor.now = at(MORNING);
    await sendJob((await emailRows(ion))[0].id);
    expect(mock.emails()).toEqual([]);
    expect((await emailRows(ion))[0]).toMatchObject({ status: 'failed' });
  });

  it('groups held rows of one type released together', async () => {
    const ana = await account('ana');
    service.now = at('2026-10-04T20:10:00Z');
    await service.notify({ eventId: 'd1', kind: 'DUE_ITP', recipients: [ana] });
    service.now = at('2026-10-04T20:10:01Z');
    await service.notify({ eventId: 'd2', kind: 'DUE_RCA', recipients: [ana] });
    service.now = at('2026-10-04T20:10:02Z');
    await service.notify({ eventId: 'd3', kind: 'DUE_ITP', recipients: [ana] });
    service.now = at(MORNING);
    processor.now = at(MORNING);
    for (const row of await emailRows(ana)) await sendJob(row.id);
    const rows = await emailRows(ana);
    expect(mock.emails()).toHaveLength(2);
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent', 'held']);
    expect(rows[2].groupLeaderId).toBe(rows[0].id);
  });
});

describe('through the queue', () => {
  it('delivers an urgent message within a minute of handing it over', async () => {
    const worker = new Worker('notifications', (job) => processor.handle(job), {
      connection: { maxRetriesPerRequest: null, url: redisUrl },
    });
    try {
      const andrei = await account('andrei');
      service.now = () => new Date();
      const started = Date.now();
      await service.notify({
        eventId: 'evt-q',
        kind: 'JOB_READY',
        recipients: [andrei],
      });
      let row = (await emailRows(andrei))[0];
      while (row.status !== 'sent' && Date.now() - started < 60_000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        row = (await emailRows(andrei))[0];
      }
      expect(row.status).toBe('sent');
      expect(Date.now() - started).toBeLessThan(60_000);
      expect(mock.emails()).toHaveLength(1);
    } finally {
      await worker.close();
    }
  }, 70_000);
});

// @traces 523-FR-001 523-FR-002 523-FR-003 523-FR-004 523-FR-005 523-FR-006 523-FR-007
describe('a window whose flush job is already running', () => {
  const flushJob = (leaderId: string) =>
    processor.handle({ attemptsMade: 0, data: { leaderId }, name: 'flush' });
  const flushes = () =>
    mock.emails().map((e) => (e.body as { subject: string }).subject);

  // Runs `during` once, inside the first e-mail handed to Brevo, then lets
  // that e-mail go.
  function duringFirstSend(during: () => Promise<unknown>) {
    const send = Brevo.prototype.send;
    let ran = false;
    return jest
      .spyOn(Brevo.prototype, 'send')
      .mockImplementation(async function (this: Brevo, mail) {
        if (!ran) {
          ran = true;
          await during();
        }
        return send.call(this, mail);
      });
  }

  // A leader sent at 11:00 and two followers held behind it until 11:05.
  async function window() {
    const andrei = await account('andrei');
    const leader = await quote(andrei, 'evt-a');
    await sendJob(leader.id);
    mock.reset();
    service.now = at('2026-10-05T11:01:00Z');
    await quote(andrei, 'evt-b');
    await quote(andrei, 'evt-c');
    await queue.obliterate({ force: true });
    return { andrei, leader };
  }

  it('sends a follower that joined while the flush job ran', async () => {
    const { andrei, leader } = await window();
    const spy = duringFirstSend(async () => {
      service.now = at('2026-10-05T11:04:59Z');
      await quote(andrei, 'evt-late');
    });
    const connection = { maxRetriesPerRequest: null, url: redisUrl };
    const events = new QueueEvents('notifications', { connection });
    const worker = new Worker('notifications', (job) => processor.handle(job), {
      connection,
    });
    try {
      await events.waitUntilReady();
      const job = await queue.add(
        'flush',
        { leaderId: leader.id },
        { jobId: `flush-${leader.id}` },
      );
      await job.waitUntilFinished(events, 30_000);
    } finally {
      await worker.close();
      await events.close();
      spy.mockRestore();
    }
    const rows = await emailRows(andrei);
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent', 'sent', 'sent']);
    expect(flushes()).toEqual([
      '2 oferte noi',
      'Ofertă nouă de la Atelier Dinamo: 450–600 lei',
    ]);
  }, 40_000);

  it('sends one grouped e-mail when two flush jobs for one leader run at once', async () => {
    const { andrei, leader } = await window();
    let second: Promise<void> | undefined;
    const spy = duringFirstSend(async () => {
      second = flushJob(leader.id);
      await second.catch(() => undefined);
    });
    try {
      await flushJob(leader.id);
    } finally {
      spy.mockRestore();
    }
    await expect(second).rejects.toThrow('is being sent by another job');
    expect(flushes()).toEqual(['2 oferte noi']);
    expect(
      (await emailRows(andrei)).map((r) => [r.status, r.claimedAt]),
    ).toEqual([
      ['sent', null],
      ['sent', null],
      ['sent', null],
    ]);
  });

  it('leaves the rows of a flush another job holds, and fails so the queue retries', async () => {
    const { andrei, leader } = await window();
    const [, ...held] = await emailRows(andrei);
    for (const row of held) await claimAgo(prisma, row.id, 10_000);
    await expect(flushJob(leader.id)).rejects.toThrow(
      'is being sent by another job',
    );
    expect(mock.emails()).toEqual([]);
    expect((await emailRows(andrei)).slice(1).map((r) => r.status)).toEqual([
      'held',
      'held',
    ]);
  });

  it('takes over a flush whose worker died holding its rows, and sends once', async () => {
    const { andrei, leader } = await window();
    const [, ...held] = await emailRows(andrei);
    for (const row of held) await claimAgo(prisma, row.id, 120_000);
    await flushJob(leader.id);
    await flushJob(leader.id);
    expect(flushes()).toEqual(['2 oferte noi']);
    expect(
      (await emailRows(andrei)).map((r) => [r.status, r.claimedAt]),
    ).toEqual([
      ['sent', null],
      ['sent', null],
      ['sent', null],
    ]);
  });

  it('gives the rows back when Brevo asks for a retry, so the next attempt sends them', async () => {
    const { andrei, leader } = await window();
    mock.answer({ status: 503 });
    await expect(flushJob(leader.id)).rejects.toThrow();
    expect(
      (await emailRows(andrei)).slice(1).map((r) => [r.status, r.claimedAt]),
    ).toEqual([
      ['held', null],
      ['held', null],
    ]);
    await processor.handle({
      attemptsMade: 1,
      data: { leaderId: leader.id },
      name: 'flush',
    });
    expect((await emailRows(andrei)).map((r) => r.status)).toEqual([
      'sent',
      'sent',
      'sent',
    ]);
  });
});

describe('starting the worker', () => {
  it('starts when sending is off without asking Brevo', async () => {
    build({ EMAIL_SENDING: 'off' });
    await expect(processor.ready()).resolves.toBe(true);
    expect(mock.calls).toEqual([]);
  });

  it('starts when Brevo accepts the key', async () => {
    await expect(processor.ready()).resolves.toBe(true);
  });

  it.each([400, 401, 403])(
    'refuses to send with a key Brevo refuses (%s), logs it and asks once',
    async (status) => {
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mock.answer({ status });
      await expect(processor.ready()).resolves.toBe(false);
      expect(error).toHaveBeenCalledTimes(1);
      expect(mock.calls).toHaveLength(1);
      error.mockRestore();
    },
  );

  // @traces 520-FR-001 520-FR-002 520-FR-003
  it('waits out an unreachable Brevo and starts once it answers', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const delays: number[] = [];
    processor.sleep = async (ms) => {
      delays.push(ms);
    };
    mock.answer({ status: 503 }, { status: 429 }, { status: 500 });
    await expect(processor.ready()).resolves.toBe(true);
    expect(mock.calls).toHaveLength(4);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it.each([
    ['unset', ''],
    ['not a URL', 'not a url'],
  ])(
    'refuses to send e-mail with PUBLIC_WEB_URL %s, and logs it',
    async (_, value) => {
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      build({ PUBLIC_WEB_URL: value });
      await expect(processor.ready()).resolves.toBe(false);
      expect(mock.calls).toEqual([]);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('PUBLIC_WEB_URL'),
      );
      error.mockRestore();
    },
  );

  it('starts without PUBLIC_WEB_URL when e-mail sending is off', async () => {
    build({ EMAIL_SENDING: 'off', PUBLIC_WEB_URL: '' });
    await expect(processor.ready()).resolves.toBe(true);
  });

  it('refuses to send with no key', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    build({ BREVO_API_KEY: '' });
    await expect(processor.ready()).resolves.toBe(false);
    expect(mock.calls).toEqual([]);
    error.mockRestore();
  });
});

describe('two send jobs for one row', () => {
  const NIGHT = '2026-10-04T20:10:00Z';
  const MORNING = '2026-10-05T05:00:00Z';
  it('sends a queued account e-mail once when both run at once', async () => {
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/ro/reset/tok',
      purpose: 'password_reset',
    });
    const [row] = await emailRows(ana);
    await Promise.allSettled([sendJob(row.id), sendJob(row.id)]);
    expect(mock.emails()).toHaveLength(1);
    expect((await emailRows(ana))[0]).toMatchObject({
      claimedAt: null,
      status: 'sent',
    });
  });

  it('sends a held row once when both run at its send time', async () => {
    const ion = await account('ion', ['garage']);
    service.now = at(NIGHT);
    await service.notify({
      eventId: 'r',
      kind: 'REQUEST_REMINDER',
      // The values its template words (ST-1257).
      params: REMINDER,
      recipients: [ion],
    });
    service.now = at(MORNING);
    processor.now = at(MORNING);
    const [row] = await emailRows(ion);
    await Promise.allSettled([sendJob(row.id), sendJob(row.id)]);
    expect(mock.emails()).toHaveLength(1);
    expect((await emailRows(ion))[0].status).toBe('sent');
  });

  it('leaves a row another job is sending to it, and fails so the queue retries', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    const claimedAt = await claimAgo(prisma, row.id, 30_000);
    await expect(sendJob(row.id)).rejects.toThrow(
      'is being sent by another job',
    );
    expect(mock.emails()).toEqual([]);
    expect((await emailRows(andrei))[0]).toMatchObject({
      claimedAt,
      status: 'queued',
    });
  });

  it('takes over a row whose claim outlived its worker and sends it once', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    await claimAgo(prisma, row.id, 30_000);
    await expect(sendJob(row.id)).rejects.toThrow(
      'is being sent by another job',
    );
    await claimAgo(prisma, row.id, 61_000);
    await sendJob(row.id, 1);
    expect(mock.emails()).toHaveLength(1);
    expect((await emailRows(andrei))[0]).toMatchObject({
      claimedAt: null,
      status: 'sent',
    });
  });

  // @traces 523-FR-008 523-FR-009
  it('judges the lease on the database clock, not a worker clock running 61 s ahead', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    const claimedAt = await claimAgo(prisma, row.id, 10_000);
    processor.now = () => new Date(Date.now() + 61_000);
    await expect(sendJob(row.id)).rejects.toThrow(
      'is being sent by another job',
    );
    expect(mock.emails()).toEqual([]);
    expect((await emailRows(andrei))[0]).toMatchObject({
      claimedAt,
      status: 'queued',
    });
  });

  it('succeeds without sending when the row was sent meanwhile', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    await sendJob(row.id);
    await sendJob(row.id);
    expect(mock.emails()).toHaveLength(1);
  });

  it('gives the claim back when Brevo asks for a retry, so the next attempt sends at once', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    mock.answer({ status: 503 });
    await expect(sendJob(row.id, 0)).rejects.toThrow();
    expect((await emailRows(andrei))[0]).toMatchObject({
      claimedAt: null,
      status: 'queued',
    });
    await sendJob(row.id, 1);
    expect(mock.emails()).toHaveLength(2);
    expect((await emailRows(andrei))[0].status).toBe('sent');
  });

  it('leaves no claim on a held row grouped behind another', async () => {
    const ana = await account('ana');
    service.now = at('2026-10-04T20:10:00Z');
    await service.notify({ eventId: 'd1', kind: 'DUE_ITP', recipients: [ana] });
    service.now = at('2026-10-04T20:10:02Z');
    await service.notify({ eventId: 'd3', kind: 'DUE_ITP', recipients: [ana] });
    service.now = at(MORNING);
    processor.now = at(MORNING);
    for (const row of await emailRows(ana)) await sendJob(row.id);
    const rows = await emailRows(ana);
    expect(rows.map((r) => [r.status, r.claimedAt])).toEqual([
      ['sent', null],
      ['held', null],
    ]);
  });
});

describe('an e-mail to a listing draft', () => {
  const link = 'https://motorfix.test/ro/list-your-garage?draft=secret';
  const draft = (language: 'ro' | 'en' = 'ro') =>
    prisma.listingDraft
      .create({
        data: {
          email: 'owner@example.test',
          language,
          step: 3,
          updatedAt: new Date(DAY),
        },
      })
      .then((d) => d.id);
  const draftRow = async (listingDraftId: string) =>
    (await prisma.notification.findMany({ where: { listingDraftId } }))[0];
  const draftJob = (id: string, attemptsMade = 0, withLink = link) =>
    processor.handle({
      attemptsMade,
      data: { id, link: withLink },
      name: 'send',
    } as never);

  it('goes to the address the draft holds at send time, in its language, with the link from the job', async () => {
    const id = await draft('en');
    await service.sendToDraft('LISTING_CONTINUE_LINK', id, link);
    await prisma.listingDraft.update({
      data: { email: 'later@example.test' },
      where: { id },
    });

    await draftJob((await draftRow(id)).id);

    const [mail] = mock.emails();
    const body = mail.body as {
      subject: string;
      textContent: string;
      to: { email: string }[];
    };
    expect(body.to[0].email).toBe('later@example.test');
    expect(body.subject).toBe('Continue listing your garage');
    expect(body.textContent).toContain(link);
    expect(await draftRow(id)).toMatchObject({ params: {}, status: 'sent' });
  });

  it('fails the row without calling Brevo when the job carries no link', async () => {
    const id = await draft();
    await service.sendToDraft('LISTING_CONTINUE_LINK', id, link);
    const row = await draftRow(id);

    await processor.handle({
      attemptsMade: 0,
      data: { id: row.id },
      name: 'send',
    });

    expect(mock.emails()).toEqual([]);
    expect(await draftRow(id)).toMatchObject({
      failure: 'template_failed',
      status: 'failed',
    });
  });

  it('asks for a retry while Brevo may still take it', async () => {
    const id = await draft();
    await service.sendToDraft('LISTING_CONTINUE_LINK', id, link);
    mock.answer({ status: 503 });

    await expect(draftJob((await draftRow(id)).id)).rejects.toThrow();

    expect((await draftRow(id)).status).toBe('queued');
  });

  it('sends a held reminder at 08:00', async () => {
    const id = await draft();
    service.now = at('2026-10-04T20:10:00Z');
    await service.sendToDraft('LISTING_REMINDER', id, link);
    service.now = at('2026-10-05T05:00:00Z');
    processor.now = at('2026-10-05T05:00:00Z');

    await draftJob((await draftRow(id)).id);

    expect((mock.emails()[0].body as { subject: string }).subject).toBe(
      'Ai început să-ți înscrii service-ul',
    );
    expect((await draftRow(id)).status).toBe('sent');
  });

  it('sends nothing once the draft is gone', async () => {
    const id = await draft();
    await service.sendToDraft('LISTING_CONTINUE_LINK', id, link);
    const row = await draftRow(id);
    await prisma.listingDraft.delete({ where: { id } });

    await draftJob(row.id);

    expect(mock.emails()).toEqual([]);
  });
});

// @traces 223-FR-014
describe('a garage message whose e-mail Brevo refuses for good', () => {
  it.each([
    ['QUOTE_LOST', {}],
    ['REQUEST_CANCELLED', { driver: 'Andrei M.', reason: 'cancelled' }],
    ['REQUEST_CANCELLED', { reason: 'account_closed' }],
  ])('fails the %s e-mail and keeps the bell row', async (kind, extra) => {
    const owner = await account('owner', ['garage']);
    await service.notify({
      eventId: `evt-${kind}`,
      kind,
      params: {
        car: 'Dacia Logan',
        link: 'https://motorfix.test/app/garage/requests',
        ...extra,
      },
      recipients: [owner],
    });
    mock.answer({ status: 400 });
    await sendJob((await emailRows(owner))[0].id, 0);
    const stored = await prisma.notification.findMany({
      select: { channel: true, status: true },
      where: { accountId: owner, kind },
    });
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(
      expect.arrayContaining([
        { channel: 'email', status: 'failed' },
        { channel: 'in_app', status: 'sent' },
      ]),
    );
  });
});
