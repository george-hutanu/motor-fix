// @traces 522-FR-001 522-FR-002 522-FR-003 778-FR-001
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { Brevo } from './brevo/brevo';
import { BrevoMock } from './brevo/brevo-mock.testing';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import {
  databaseUrl,
  failWritesAfter,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhone,
  testPhoneConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { timersArmedBy, until } from '../waits.testing';

const redisUrl = redisUrlFor(2);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

let service: NotificationsService;
let processor: NotificationsProcessor;
const pushConfig = {
  privateKey: 'private',
  publicKey: 'public',
  subject: 'mailto:ops@example.test',
};
const pushFallbacks = () =>
  prisma.notification.count({
    where: { channel: 'push', fallbackOf: { not: null } },
  });

const at = (iso: string) => () => new Date(iso);
const DAY = '2026-10-05T11:00:00Z';
const NIGHT = '2026-10-04T20:10:00Z';
const MORNING = '2026-10-05T05:00:00Z';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function build(phone: Record<string, string> = {}) {
  const config = testConfig(mock.url);
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
    testPhoneConfig({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '', ...phone }),
  );
  processor.now = at(DAY);
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

const sendJob = (id: string, attemptsMade = 0) =>
  processor.handle({ attemptsMade, data: { id }, name: 'send' });

const many = (id: string, count: number, attemptsMade = 0) =>
  Promise.allSettled(
    Array.from({ length: count }, () => sendJob(id, attemptsMade)),
  );

const row = (id: string) =>
  prisma.notification.findUniqueOrThrow({ where: { id } });

const emailRows = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, channel: 'email' },
  });

async function queuedEmail(name = 'andrei', eventId = 'evt-1') {
  const owner = await account(name);
  await service.notify({
    eventId,
    kind: 'QUOTE_RECEIVED',
    recipients: [owner],
  });
  return { owner, row: (await emailRows(owner))[0] };
}

const claim = (id: string, claimedAt: Date | null) =>
  prisma.notification.update({ data: { claimedAt }, where: { id } });

describe('many send jobs for one row', () => {
  it('calls Brevo once when ten run at once on a queued e-mail', async () => {
    const { row: queued } = await queuedEmail();
    const results = await many(queued.id, 10);
    expect(mock.emails()).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'fulfilled').length,
    ).toBeGreaterThan(0);
    expect(await row(queued.id)).toMatchObject({
      claimedAt: null,
      status: 'sent',
    });
  });

  it('calls Brevo once when ten run at once on a held row', async () => {
    const ion = await account('ion', ['garage']);
    service.now = at(NIGHT);
    await service.notify({
      eventId: 'r',
      kind: 'REQUEST_REMINDER',
      recipients: [ion],
    });
    processor.now = at(MORNING);
    const [held] = await emailRows(ion);
    expect(held.status).toBe('held');
    await many(held.id, 10);
    expect(mock.emails()).toHaveLength(1);
    expect(await row(held.id)).toMatchObject({
      claimedAt: null,
      status: 'sent',
    });
  });

  it('keeps the account e-mail link in the single e-mail sent', async () => {
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/reset?t=once',
      purpose: 'password_reset',
    });
    const [queued] = await emailRows(ana);
    await many(queued.id, 6);
    expect(mock.emails()).toHaveLength(1);
    expect(
      (mock.emails()[0].body as { textContent: string }).textContent,
    ).toContain('https://motorfix.test/reset?t=once');
  });

  it('calls Brevo once and leaves the row queued and unclaimed when the one call is refused for a retry', async () => {
    const { row: queued } = await queuedEmail();
    mock.answer({ status: 503 });
    const results = await many(queued.id, 8);
    expect(mock.emails()).toHaveLength(1);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(await row(queued.id)).toMatchObject({
      claimedAt: null,
      status: 'queued',
    });
    await sendJob(queued.id, 1);
    expect(mock.emails()).toHaveLength(2);
    expect((await row(queued.id)).status).toBe('sent');
  });

  it('fails the row once and calls the fallback once when ten jobs run on the last attempt', async () => {
    const { owner, row: queued } = await queuedEmail();
    await prisma.pushSubscription.create({
      data: {
        accountId: owner,
        auth: 'a',
        endpoint: 'https://push.example.test/one',
        p256dh: 'p',
      },
    });
    mock.answer({ status: 503 });
    await many(queued.id, 10, 5);
    expect(mock.emails()).toHaveLength(1);
    expect(await pushFallbacks()).toBe(1);
    expect(await row(queued.id)).toMatchObject({
      claimedAt: null,
      status: 'failed',
    });
  });

  it('sends nothing and leaves no claim when the account is deleted while jobs run', async () => {
    const { owner, row: queued } = await queuedEmail();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: owner },
    });
    await many(queued.id, 6);
    expect(mock.emails()).toEqual([]);
    expect(await row(queued.id)).toMatchObject({
      claimedAt: null,
      failure: 'account_deleted',
      status: 'failed',
    });
  });

  it('sends one SMS and counts it once when jobs run at once', async () => {
    build({ PHONE_SENDING: 'on', WHATSAPP_SENDER: '+40700000099' });
    const ana = await account('ana');
    await prisma.account.update({
      data: {
        phone: testPhone(1),
        phoneVerifiedAt: new Date('2026-09-01T00:00:00Z'),
      },
      where: { id: ana },
    });
    await prisma.notificationPreference.create({
      data: {
        accountId: ana,
        channel: 'sms',
        enabled: true,
        garageId: null,
        type: 'DUE_ITP',
      },
    });
    service.now = at('2026-11-01T07:00:00Z');
    processor.now = at('2026-11-01T07:00:00Z');
    await service.notify({
      eventId: 'itp',
      kind: 'DUE_ITP',
      recipients: [ana],
    });
    const sms = await prisma.notification.findFirstOrThrow({
      where: { accountId: ana, channel: 'sms' },
    });
    await many(sms.id, 8);
    expect(mock.sms()).toHaveLength(1);
    expect(
      (
        await prisma.smsCounter.findUnique({
          where: { accountId_month: { accountId: ana, month: '2026-11' } },
        })
      )?.sentCount,
    ).toBe(1);
    expect(await row(sms.id)).toMatchObject({
      claimedAt: null,
      status: 'sent',
    });
  });

  it('sends one WhatsApp message when jobs race on an SMS row past the monthly cap', async () => {
    build({ PHONE_SENDING: 'on', WHATSAPP_SENDER: '+40700000099' });
    const ana = await account('ana');
    await prisma.account.update({
      data: {
        phone: testPhone(1),
        phoneVerifiedAt: new Date('2026-09-01T00:00:00Z'),
      },
      where: { id: ana },
    });
    await prisma.notificationPreference.create({
      data: {
        accountId: ana,
        channel: 'sms',
        enabled: true,
        garageId: null,
        type: 'DUE_ITP',
      },
    });
    await prisma.smsCounter.create({
      data: { accountId: ana, month: '2026-11', sentCount: 5 },
    });
    service.now = at('2026-11-01T07:00:00Z');
    processor.now = at('2026-11-01T07:00:00Z');
    await service.notify({
      eventId: 'itp',
      kind: 'DUE_ITP',
      recipients: [ana],
    });
    const sms = await prisma.notification.findFirstOrThrow({
      where: { accountId: ana, channel: 'sms' },
    });
    await many(sms.id, 8);
    expect(mock.sms()).toHaveLength(0);
    const fallbacks = await prisma.notification.findMany({
      where: { accountId: ana, channel: 'whatsapp' },
    });
    expect(fallbacks).toHaveLength(1);
    await many(fallbacks[0].id, 5);
    expect(mock.whatsapp()).toHaveLength(1);
    expect((await row(fallbacks[0].id)).status).toBe('sent');
    expect((await row(sms.id)).claimedAt).toBeNull();
  });
});

describe('a claim held by another job', () => {
  it('rejects without calling Brevo when the claim is one millisecond short of the lease', async () => {
    const { row: queued } = await queuedEmail();
    const claimedAt = new Date('2026-10-05T11:00:00.000Z');
    await claim(queued.id, claimedAt);
    processor.now = at('2026-10-05T11:00:59.999Z');
    await expect(sendJob(queued.id)).rejects.toBeDefined();
    expect(mock.emails()).toEqual([]);
    expect(await row(queued.id)).toMatchObject({ claimedAt, status: 'queued' });
  });

  it('takes the claim over one millisecond past the lease and sends once', async () => {
    const { row: queued } = await queuedEmail();
    await claim(queued.id, new Date('2026-10-05T11:00:00.000Z'));
    processor.now = at('2026-10-05T11:01:00.001Z');
    await sendJob(queued.id);
    expect(mock.emails()).toHaveLength(1);
    expect(await row(queued.id)).toMatchObject({
      claimedAt: null,
      status: 'sent',
    });
  });

  it('still counts a claim exactly the lease old as live', async () => {
    const { row: queued } = await queuedEmail();
    await claim(queued.id, new Date('2026-10-05T11:00:00.000Z'));
    processor.now = at('2026-10-05T11:01:00.000Z');
    await expect(sendJob(queued.id)).rejects.toThrow(
      'is being sent by another job',
    );
    expect(mock.emails()).toEqual([]);
    expect((await row(queued.id)).status).toBe('queued');
  });

  it('treats a claim stamped in the future as live', async () => {
    const { row: queued } = await queuedEmail();
    await claim(queued.id, new Date('2026-10-05T11:30:00.000Z'));
    await expect(sendJob(queued.id)).rejects.toBeDefined();
    expect(mock.emails()).toEqual([]);
  });

  it('rejects on a held row with a live claim and leaves it held', async () => {
    const ion = await account('ion', ['garage']);
    service.now = at(NIGHT);
    await service.notify({
      eventId: 'r',
      kind: 'REQUEST_REMINDER',
      recipients: [ion],
    });
    const [held] = await emailRows(ion);
    const claimedAt = new Date('2026-10-05T04:59:50.000Z');
    await claim(held.id, claimedAt);
    processor.now = at(MORNING);
    await expect(sendJob(held.id)).rejects.toBeDefined();
    expect(mock.emails()).toEqual([]);
    expect(await row(held.id)).toMatchObject({ claimedAt, status: 'held' });
  });

  it('takes over a stale claim on a held row and sends it once', async () => {
    const ion = await account('ion', ['garage']);
    service.now = at(NIGHT);
    await service.notify({
      eventId: 'r',
      kind: 'REQUEST_REMINDER',
      recipients: [ion],
    });
    const [held] = await emailRows(ion);
    await claim(held.id, new Date('2026-10-05T04:00:00.000Z'));
    processor.now = at(MORNING);
    await many(held.id, 4);
    expect(mock.emails()).toHaveLength(1);
    expect(await row(held.id)).toMatchObject({
      claimedAt: null,
      status: 'sent',
    });
  });

  it('does not block a send job for another row', async () => {
    const first = await queuedEmail('andrei', 'evt-1');
    const second = await queuedEmail('maria', 'evt-2');
    const claimedAt = new Date('2026-10-05T11:00:00.000Z');
    await claim(first.row.id, claimedAt);
    processor.now = at('2026-10-05T11:00:10.000Z');
    await sendJob(second.row.id);
    expect(mock.emails()).toHaveLength(1);
    expect((await row(first.row.id)).claimedAt).toEqual(claimedAt);
    expect((await row(second.row.id)).status).toBe('sent');
  });

  it('succeeds without sending on a retry after the winner sent, and takes no claim', async () => {
    const { row: queued } = await queuedEmail();
    await claim(queued.id, new Date('2026-10-05T11:00:00.000Z'));
    processor.now = at('2026-10-05T11:00:20.000Z');
    await expect(sendJob(queued.id, 0)).rejects.toBeDefined();
    await prisma.notification.update({
      data: { claimedAt: null, sentAt: new Date(), status: 'sent' },
      where: { id: queued.id },
    });
    processor.now = at('2026-10-05T11:01:20.000Z');
    await expect(sendJob(queued.id, 1)).resolves.toBeUndefined();
    expect(mock.emails()).toEqual([]);
    expect((await row(queued.id)).claimedAt).toBeNull();
  });

  it('leaves a stale claim on a sent row untouched and sends nothing', async () => {
    const { row: queued } = await queuedEmail();
    await sendJob(queued.id);
    const claimedAt = new Date('2026-10-05T09:00:00.000Z');
    await claim(queued.id, claimedAt);
    processor.now = at('2026-10-05T12:00:00.000Z');
    await expect(sendJob(queued.id)).resolves.toBeUndefined();
    expect(mock.emails()).toHaveLength(1);
    expect((await row(queued.id)).claimedAt).toEqual(claimedAt);
  });

  it('does not take a claim on a failed row', async () => {
    const { owner, row: queued } = await queuedEmail();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: owner },
    });
    await sendJob(queued.id);
    await expect(sendJob(queued.id)).resolves.toBeUndefined();
    expect(mock.emails()).toEqual([]);
    expect((await row(queued.id)).claimedAt).toBeNull();
  });

  it('succeeds and sends nothing for a row that does not exist', async () => {
    await expect(
      sendJob('00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeUndefined();
    expect(mock.calls).toEqual([]);
  });
});

describe('releasing a claim', () => {
  it('releases the claim when the fallback itself throws after the last attempt', async () => {
    const { row: queued } = await queuedEmail();
    jest
      .spyOn(
        service as unknown as { fallBack: () => Promise<void> },
        'fallBack',
      )
      .mockRejectedValue(new Error('fallback down'));
    mock.answer({ status: 503 });
    await Promise.allSettled([sendJob(queued.id, 5)]);
    expect((await row(queued.id)).claimedAt).toBeNull();
  });

  it('releases the claim when sending is switched off and the row fails', async () => {
    const { row: queued } = await queuedEmail();
    const config = testConfig(mock.url, { EMAIL_SENDING: 'off' });
    processor = new NotificationsProcessor(
      prisma,
      service,
      new Brevo({ apiKey: config.apiKey ?? '', apiUrl: config.apiUrl }),
      config,
      testPhoneConfig({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '' }),
    );
    processor.now = at(DAY);
    await many(queued.id, 4);
    expect(await row(queued.id)).toMatchObject({
      claimedAt: null,
      failure: 'sending_off',
      status: 'failed',
    });
  });

  it('releases only its own claim when another job took the row over meanwhile', async () => {
    const { row: queued } = await queuedEmail();
    mock.answer({ hang: true, status: 200 }, { hang: true, status: 200 });
    const slow = sendJob(queued.id).then(
      () => 'resolved',
      () => 'rejected',
    );
    await until(
      'the slow send to claim the row',
      async () =>
        (await row(queued.id)).claimedAt?.getTime() === new Date(DAY).getTime(),
    );
    expect((await row(queued.id)).claimedAt).toEqual(new Date(DAY));
    const takeoverAt = new Date('2026-10-05T11:02:00.000Z');
    const other = new NotificationsProcessor(
      prisma,
      service,
      new Brevo({
        apiKey: testConfig(mock.url).apiKey ?? '',
        apiUrl: testConfig(mock.url).apiUrl,
      }),
      testConfig(mock.url),
      testPhoneConfig({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '' }),
    );
    other.now = () => takeoverAt;
    // Not a wait for work: the slow send stays hung on Brevo meanwhile.
    await wait(1200);
    const takeover = other
      .handle({ attemptsMade: 1, data: { id: queued.id }, name: 'send' })
      .then(
        () => 'resolved',
        () => 'rejected',
      );
    await until(
      'the takeover to claim the row',
      async () =>
        (await row(queued.id)).claimedAt?.getTime() === takeoverAt.getTime(),
    );
    expect((await row(queued.id)).claimedAt).toEqual(takeoverAt);
    expect(await slow).toBe('rejected');
    expect(await row(queued.id)).toMatchObject({
      claimedAt: takeoverAt,
      status: 'queued',
    });
    await takeover;
    expect((await row(queued.id)).claimedAt).toBeNull();
  }, 40_000);
});

const failWritesAfterSend = (times: number) =>
  failWritesAfter(prisma, () => mock.emails().length > 0, times);

describe('a database error after Brevo accepted an e-mail', () => {
  it('records the send on a later write and does not send again', async () => {
    const { row: queued } = await queuedEmail();
    const failing = failWritesAfterSend(1);
    try {
      await expect(sendJob(queued.id)).resolves.toBeUndefined();
    } finally {
      failing();
    }
    expect(mock.emails()).toHaveLength(1);
    expect(await row(queued.id)).toMatchObject({
      claimedAt: null,
      status: 'sent',
    });
    expect((await row(queued.id)).providerMessageId).toBeTruthy();
  });

  it('finishes the job and logs the message id when no write succeeds', async () => {
    const { row: queued } = await queuedEmail();
    const failing = failWritesAfterSend(10);
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(sendJob(queued.id)).resolves.toBeUndefined();
    } finally {
      failing();
    }
    const lines = logged.mock.calls.map(([line]) => String(line));
    logged.mockRestore();
    expect(mock.emails()).toHaveLength(1);
    expect(lines).toContainEqual(expect.stringContaining(queued.id));
    expect(lines).toContainEqual(expect.stringContaining('@smtp-relay'));
  });

  it('keeps the claim when no write succeeds, so the sweep never sends it again', async () => {
    const { row: queued } = await queuedEmail();
    const failing = failWritesAfterSend(10);
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(sendJob(queued.id)).resolves.toBeUndefined();
    } finally {
      failing();
      logged.mockRestore();
    }
    expect(await row(queued.id)).toMatchObject({
      claimedAt: new Date(DAY),
      status: 'queued',
    });
    await queue.obliterate({ force: true });
    service.now = at('2026-10-05T12:00:00Z');
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(await queue.getJob(`send-${queued.id}`)).toBeUndefined();
    expect(mock.emails()).toHaveLength(1);
  });

  it('tries the write 3 times in all, back to back', async () => {
    const { row: queued } = await queuedEmail();
    const tries: number[] = [];
    const failing = failWritesAfter(
      prisma,
      () => mock.emails().length > 0 && tries.push(Date.now()) > 0,
      10,
    );
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    let waits: string[];
    try {
      ({ log: waits } = await timersArmedBy('notifications.processor', () =>
        sendJob(queued.id),
      ));
    } finally {
      failing();
      logged.mockRestore();
    }
    expect(tries).toHaveLength(3);
    // Back to back: no timer ran out between them (Brevo's own request
    // limit is armed, and never reached).
    expect(waits.some((entry) => entry.startsWith('armed'))).toBe(true);
    expect(waits.filter((entry) => entry.startsWith('fired'))).toEqual([]);
  });

  it('finishes the job when releasing the claim fails', async () => {
    const { row: queued } = await queuedEmail();
    const real = prisma.notification.updateMany.bind(prisma.notification);
    const failing = jest
      .spyOn(prisma.notification, 'updateMany')
      .mockImplementation(((args: { data: { claimedAt?: unknown } }) =>
        args.data.claimedAt === null
          ? Promise.reject(new Error('connection lost'))
          : real(args as never)) as never);
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(sendJob(queued.id)).resolves.toBeUndefined();
    } finally {
      failing.mockRestore();
      logged.mockRestore();
    }
    expect(mock.emails()).toHaveLength(1);
    expect((await row(queued.id)).status).toBe('sent');
  });
});
