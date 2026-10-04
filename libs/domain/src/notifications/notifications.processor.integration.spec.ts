import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { Brevo } from './brevo';
import { BrevoMock } from './brevo-mock.testing';
import { NotificationsProcessor, retryDelay } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';

const redisUrl = redisUrlFor(12);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);
const fallback = jest.fn(async () => undefined);

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
    fallback,
    new AuditService(),
  );
  service.now = at(DAY);
  processor = new NotificationsProcessor(
    prisma,
    service,
    new Brevo({ apiKey: config.apiKey ?? '', apiUrl: config.apiUrl }),
    config,
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
  fallback.mockClear();
  build();
});

const emailRows = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, channel: 'email' },
  });

const sendJob = (id: string, attemptsMade = 0) =>
  processor.handle({ attemptsMade, data: { id }, name: 'send' });

async function quote(recipient: string, eventId: string) {
  await service.notify({
    eventId,
    kind: 'QUOTE_RECEIVED',
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

  it('writes the test message in the recipient language', async () => {
    const en = await account('en', ['admin'], { language: 'en' });
    const ro = await account('ro', ['driver'], { language: 'ro' });
    await service.notify({
      eventId: 't',
      kind: 'TEST_MESSAGE',
      recipients: [en, ro],
    });
    for (const id of [en, ro]) await sendJob((await emailRows(id))[0].id);
    const [toEn, toRo] = mock
      .emails()
      .map((c) => c.body as { subject: string });
    expect(toEn.subject).not.toBe(toRo.subject);
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
    expect(fallback).not.toHaveBeenCalled();
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
    expect(fallback).not.toHaveBeenCalled();
  });

  it('fails the row and calls the fallback after the last retry', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    mock.answer({ status: 503 });
    await sendJob(row.id, 5);
    const [failed] = await emailRows(andrei);
    expect(failed).toMatchObject({ failure: 'provider_503', status: 'failed' });
    expect(fallback).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id }),
    );
    const bell = await prisma.notification.findFirst({
      where: { accountId: andrei, channel: 'in_app' },
    });
    expect(bell?.status).toBe('sent');
  });

  it('fails the row at once on a refusal that a retry cannot fix', async () => {
    const andrei = await account('andrei');
    const row = await quote(andrei, 'evt-1');
    mock.answer({ status: 400 });
    await expect(sendJob(row.id, 0)).resolves.toBeUndefined();
    expect((await emailRows(andrei))[0]).toMatchObject({
      failure: 'provider_400',
      status: 'failed',
    });
    expect(fallback).toHaveBeenCalledTimes(1);
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
    expect((mock.emails()[1].body as { subject: string }).subject).toContain(
      '2',
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
    expect((mock.emails()[0].body as { subject: string }).subject).not.toMatch(
      /\d/,
    );
  });

  it('fails every held row and calls the fallback for each when the grouped e-mail fails for good', async () => {
    const andrei = await account('andrei');
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
    expect(fallback).toHaveBeenCalledTimes(2);
  });
});

describe('releasing a held message at 08:00', () => {
  const NIGHT = '2026-10-04T20:10:00Z';
  const MORNING = '2026-10-05T05:00:00Z';

  it('sends a held reminder when it is released', async () => {
    const ion = await account('ion', ['garage']);
    service.now = at(NIGHT);
    await service.notify({
      eventId: 'r',
      kind: 'REQUEST_REMINDER',
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

describe('starting the worker', () => {
  it('starts when sending is off without asking Brevo', async () => {
    build({ EMAIL_SENDING: 'off' });
    await expect(processor.ready()).resolves.toBe(true);
    expect(mock.calls).toEqual([]);
  });

  it('starts when Brevo accepts the key', async () => {
    await expect(processor.ready()).resolves.toBe(true);
  });

  it('refuses to send with a key Brevo refuses, and logs it', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    mock.answer({ status: 401 });
    await expect(processor.ready()).resolves.toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
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
