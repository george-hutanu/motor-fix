import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { BrevoMock } from './brevo/brevo-mock.testing';
import { NotificationsService } from './notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/policy';
import { serialDatabase } from '../auth/serial-db.testing';
import { until } from '../waits.testing';

const redisUrl = redisUrlFor(11);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);
const subscriber = new Redis(redisUrl);
const pushConfig = {
  privateKey: 'private',
  publicKey: 'public',
  subject: 'mailto:ops@example.test',
};
const pushFallbacks = () =>
  prisma.notification.count({
    where: { channel: 'push', fallbackOf: { not: null } },
  });
const withDevice = (accountId: string) =>
  prisma.pushSubscription.create({
    data: {
      accountId,
      auth: 'a',
      endpoint: `https://push.example.test/${accountId}`,
      p256dh: 'p',
    },
  });
const published: string[] = [];
const admin = (accountId: string): Actor => ({
  accountId,
  garageId: null,
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'admin',
  roles: ['admin'],
});

let config: ReturnType<typeof testConfig>;
let service: NotificationsService;

const at = (iso: string) => () => new Date(iso);
// 14:00 in Bucharest, outside quiet hours.
const DAY = '2026-10-05T11:00:00Z';

beforeAll(async () => {
  await mock.start();
  config = testConfig(mock.url);
  await subscriber.subscribe('live:events');
  subscriber.on('message', (_channel, message) => published.push(message));
});

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  subscriber.disconnect();
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  published.length = 0;
  service = new NotificationsService(
    prisma,
    queue,
    publisher,
    config,
    pushConfig,
    new AuditService(),
  );
  service.now = at(DAY);
});

const rows = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: [{ createdAt: 'asc' }, { channel: 'asc' }],
    where: { accountId },
  });

const jobs = async () =>
  (await queue.getJobs(['waiting', 'delayed', 'prioritized'])).sort(
    (a, b) => a.timestamp - b.timestamp,
  );

const quote = (recipient: string, eventId: string) =>
  service.notify({
    eventId,
    kind: 'QUOTE_RECEIVED',
    params: {},
    recipients: [recipient],
    subjectId: '6d1f6a9c-1b7e-4a52-9a5b-1c1a2e3f4a5b',
  });

const reader = countedMetrics();
const counted = async () => ({
  inApp: await counterTotal(reader, 'motorfix_notifications_sent_total', {
    channel: 'in-app',
  }),
  quotes: await counterTotal(reader, 'motorfix_quotes_total'),
});

// @traces 879-FR-009
describe('counting what the notifications service writes', () => {
  it('counts one bell row and one quote per recipient, and nothing for a repeat', async () => {
    const andrei = await account('andrei');
    const maria = await account('maria');
    const before = await counted();

    await service.notify({
      eventId: 'evt-count',
      kind: 'QUOTE_RECEIVED',
      recipients: [andrei, maria],
    });
    await quote(andrei, 'evt-count');

    expect(await counted()).toEqual({
      inApp: before.inApp + 2,
      quotes: before.quotes + 2,
    });
  });

  it('counts a bell row of another type without counting a quote', async () => {
    const andrei = await account('andrei');
    const before = await counted();

    await service.notify({
      eventId: 'evt-other',
      kind: 'SIGN_IN_CODE',
      recipients: [andrei],
    });

    expect(await counted()).toEqual({
      inApp: before.inApp + 1,
      quotes: before.quotes,
    });
  });
});

describe('handing an event to the notifications service', () => {
  it('writes a bell row and an e-mail row, and queues one send', async () => {
    const andrei = await account('andrei');
    await quote(andrei, 'evt-1');
    const written = await rows(andrei);
    expect(written).toHaveLength(2);
    expect(written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'email',
          kind: 'QUOTE_RECEIVED',
          status: 'queued',
        }),
        expect.objectContaining({
          channel: 'in_app',
          kind: 'QUOTE_RECEIVED',
          status: 'sent',
        }),
      ]),
    );
    const email = written.find((r) => r.channel === 'email');
    const queued = await jobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ data: { id: email?.id }, name: 'send' });
    expect(queued[0].opts.delay ?? 0).toBe(0);
  });

  it('writes nothing more when the same event is handed over twice', async () => {
    const andrei = await account('andrei');
    await quote(andrei, 'evt-1');
    await quote(andrei, 'evt-1');
    expect(await rows(andrei)).toHaveLength(2);
    expect(await jobs()).toHaveLength(1);
  });

  it('skips a deleted account and writes only the bell row without an address', async () => {
    const gone = await account('gone', ['driver'], { status: 'deleted' });
    const nomail = await account('nomail', ['driver'], { email: null });
    await service.notify({
      eventId: 'evt-2',
      kind: 'QUOTE_RECEIVED',
      recipients: [gone, nomail],
    });
    expect(await rows(gone)).toEqual([]);
    expect(await rows(nomail)).toEqual([
      expect.objectContaining({ channel: 'in_app', status: 'sent' }),
    ]);
    expect(await jobs()).toEqual([]);
  });

  it('still sends to a suspended account', async () => {
    const owner = await account('owner', ['garage'], { status: 'suspended' });
    await service.notify({
      eventId: 'evt-3',
      kind: 'GARAGE_SUSPENDED',
      recipients: [owner],
    });
    expect((await rows(owner)).map((r) => r.channel).sort()).toEqual([
      'email',
      'in_app',
    ]);
  });

  it('writes only the bell row for a type that is not sent by e-mail', async () => {
    const andrei = await account('andrei');
    await service.notify({
      eventId: 'evt-4',
      kind: 'SIGN_IN_CODE',
      recipients: [andrei],
    });
    expect(await rows(andrei)).toEqual([
      expect.objectContaining({ channel: 'in_app' }),
    ]);
  });

  it('refuses an unknown type and writes nothing', async () => {
    const andrei = await account('andrei');
    await expect(
      service.notify({
        eventId: 'evt-5',
        kind: 'NOT_A_TYPE',
        recipients: [andrei],
      }),
    ).rejects.toThrow(/NOT_A_TYPE/);
    expect(await rows(andrei)).toEqual([]);
  });

  it('announces each bell row to the account on the live channel', async () => {
    const andrei = await account('andrei');
    await quote(andrei, 'evt-6');
    const bell = (await rows(andrei)).find((r) => r.channel === 'in_app');
    // Other suites publish on the same Redis channel at once (account.created
    // for their own accounts): only what reaches this account is ours.
    const toAndrei = () =>
      published
        .map((m) => JSON.parse(m))
        .filter((m) => m.audience?.includes(`account:${andrei}`));
    await until('the live announcement', () => toAndrei().length > 0);
    // Long enough for a second, wrong, announcement to arrive.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(toAndrei()).toEqual([
      {
        audience: [`account:${andrei}`],
        event: {
          at: bell?.createdAt.toISOString(),
          id: bell?.id,
          kind: 'notification.created',
        },
      },
    ]);
  });

  it('keeps the rows when the live publish fails', async () => {
    const andrei = await account('andrei');
    const broken = new NotificationsService(
      prisma,
      queue,
      { publish: async () => Promise.reject(new Error('redis down')) },
      config,
      pushConfig,
      new AuditService(),
    );
    broken.now = at(DAY);
    await broken.notify({
      eventId: 'evt-7',
      kind: 'JOB_READY',
      recipients: [andrei],
    });
    expect(await rows(andrei)).toHaveLength(2);
  });

  it('writes no audit history', async () => {
    const andrei = await account('andrei');
    const before = await prisma.activityLog.count();
    await quote(andrei, 'evt-8');
    expect(await prisma.activityLog.count()).toBe(before);
  });
});

describe('a hard bounce', () => {
  it('fails the e-mail row, marks the address and falls back to push', async () => {
    const andrei = await account('andrei');
    await withDevice(andrei);
    await quote(andrei, 'evt-b');
    const email = (await rows(andrei)).find((r) => r.channel === 'email');
    await prisma.notification.update({
      data: { providerMessageId: '<b@relay>', status: 'sent' },
      where: { id: email?.id },
    });
    await service.recordBounce('<b@relay>');
    expect(
      await prisma.notification.findUnique({ where: { id: email?.id } }),
    ).toMatchObject({
      failure: 'bounced',
      status: 'failed',
    });
    expect(
      (await prisma.account.findUnique({ where: { id: andrei } }))
        ?.emailBouncedAt,
    ).toEqual(new Date(DAY));
    expect(
      await prisma.activityLog.findMany({
        select: { actorRole: true, field: true, subjectType: true },
        where: { field: 'emailBouncedAt', subjectId: andrei },
      }),
    ).toEqual([
      { actorRole: 'system', field: 'emailBouncedAt', subjectType: 'account' },
    ]);
    expect(
      await prisma.notification.findMany({
        select: { fallbackOf: true },
        where: { accountId: andrei, channel: 'push' },
      }),
    ).toEqual([{ fallbackOf: email?.id }]);
  });

  it('records a bounce Brevo reports twice only once', async () => {
    const andrei = await account('andrei');
    await withDevice(andrei);
    await quote(andrei, 'evt-b');
    const email = (await rows(andrei)).find((r) => r.channel === 'email');
    await prisma.notification.update({
      data: { providerMessageId: '<b@relay>', status: 'sent' },
      where: { id: email?.id },
    });
    await service.recordBounce('<b@relay>');
    await service.recordBounce('<b@relay>');
    expect(
      await prisma.activityLog.count({
        where: { field: 'emailBouncedAt', subjectId: andrei },
      }),
    ).toBe(1);
    expect(await pushFallbacks()).toBe(1);
  });

  it('fails every row of a grouped e-mail that bounced', async () => {
    const andrei = await account('andrei');
    await withDevice(andrei);
    await quote(andrei, 'evt-1');
    await quote(andrei, 'evt-2');
    await prisma.notification.updateMany({
      data: { providerMessageId: '<g@relay>', status: 'sent' },
      where: { accountId: andrei, channel: 'email' },
    });
    await service.recordBounce('<g@relay>');
    const emails = (await rows(andrei)).filter((r) => r.channel === 'email');
    expect(emails).toHaveLength(2);
    expect(emails.every((r) => r.status === 'failed')).toBe(true);
    expect(await pushFallbacks()).toBe(2);
  });
});

describe('guarding who gets e-mail', () => {
  it('fails the e-mail row and queues nothing while sending is off', async () => {
    const andrei = await account('andrei');
    service = new NotificationsService(
      prisma,
      queue,
      publisher,
      testConfig(mock.url, { EMAIL_SENDING: 'off' }),
      pushConfig,
      new AuditService(),
    );
    service.now = at(DAY);
    await quote(andrei, 'evt-9');
    expect(
      (await rows(andrei)).find((r) => r.channel === 'email'),
    ).toMatchObject({
      failure: 'sending_off',
      status: 'failed',
    });
    expect(await jobs()).toEqual([]);
    expect(await pushFallbacks()).toBe(0);
  });

  it('fails the e-mail row of an address off the allow-list', async () => {
    const real = await account('real', ['driver'], {
      email: 'someone@gmail.com',
    });
    await quote(real, 'evt-10');
    expect((await rows(real)).find((r) => r.channel === 'email')).toMatchObject(
      {
        failure: 'not_allowed',
        status: 'failed',
      },
    );
    expect(await jobs()).toEqual([]);
    expect(await pushFallbacks()).toBe(0);
  });
});

describe('the admin test message', () => {
  it('counts only the e-mails it queued', async () => {
    const allowed = await account('allowed');
    const outside = await account('outside', ['driver'], {
      email: 'someone@gmail.com',
    });
    expect(
      await service.sendTestMessage(admin(allowed), [allowed, outside]),
    ).toBe(1);
  });

  it('records who sent it and to whom', async () => {
    const ana = await account('ana', ['admin']);
    const andrei = await account('andrei');

    await service.sendTestMessage(admin(ana), [andrei, ana]);

    expect(
      await prisma.activityLog.findMany({
        where: { actorId: ana, kind: 'notification.test' },
      }),
    ).toEqual([
      expect.objectContaining({
        action: 'create',
        actorRole: 'admin',
        kind: 'notification.test',
        newValue: { accountIds: [andrei, ana] },
        oldValue: null,
        subjectId: ana,
        subjectType: 'account',
      }),
    ]);
  });

  it('keeps the entry, written before any message, when the send fails', async () => {
    const ana = await account('ana', ['admin']);
    const seen: number[] = [];
    service.notify = async () => {
      seen.push(
        await prisma.activityLog.count({
          where: { actorId: ana, kind: 'notification.test' },
        }),
      );
      throw new Error('queue down');
    };

    await expect(service.sendTestMessage(admin(ana), [ana])).rejects.toThrow(
      'queue down',
    );

    expect(seen).toEqual([1]);
    expect(
      await prisma.activityLog.count({
        where: { actorId: ana, kind: 'notification.test' },
      }),
    ).toBe(1);
  });

  it('sends nothing when the entry cannot be written', async () => {
    const ana = await account('ana', ['admin']);
    const audit = new AuditService();
    audit.record = () => Promise.reject(new Error('audit down'));
    service = new NotificationsService(
      prisma,
      queue,
      publisher,
      config,
      pushConfig,
      audit,
    );

    await expect(service.sendTestMessage(admin(ana), [ana])).rejects.toThrow(
      'audit down',
    );

    expect(await prisma.notification.count()).toBe(0);
    expect(await jobs()).toHaveLength(0);
  });

  it('records nothing for a recipient that is no account', async () => {
    const ana = await account('ana', ['admin']);

    await expect(
      service.sendTestMessage(admin(ana), [ana, randomUUID()]),
    ).rejects.toThrow();

    expect(
      await prisma.activityLog.count({
        where: { actorId: ana, kind: 'notification.test' },
      }),
    ).toBe(0);
  });
});

describe('grouping', () => {
  it('sends the first at once and holds the next ones of the window for one e-mail', async () => {
    const andrei = await account('andrei');
    await quote(andrei, 'evt-a');
    service.now = at('2026-10-05T11:01:00Z');
    await quote(andrei, 'evt-b');
    service.now = at('2026-10-05T11:03:00Z');
    await quote(andrei, 'evt-c');
    const emails = (await rows(andrei)).filter((r) => r.channel === 'email');
    const [leader, ...followers] = emails;
    expect(leader).toMatchObject({ groupLeaderId: null, status: 'queued' });
    for (const row of followers) {
      expect(row).toMatchObject({ groupLeaderId: leader.id, status: 'held' });
      expect(row.sendAfter?.toISOString()).toBe(
        new Date(leader.createdAt.getTime() + 5 * 60_000).toISOString(),
      );
    }
    expect(
      (await rows(andrei)).filter((r) => r.channel === 'in_app'),
    ).toHaveLength(3);
    const queued = await jobs();
    expect(queued.map((j) => j.name)).toEqual(['send', 'flush']);
    expect(queued[1].data).toEqual({ leaderId: leader.id });
  });

  it('opens a new window once the last one has closed', async () => {
    const andrei = await account('andrei');
    await quote(andrei, 'evt-a');
    service.now = at('2026-10-05T11:06:00Z');
    await quote(andrei, 'evt-b');
    const emails = (await rows(andrei)).filter((r) => r.channel === 'email');
    expect(emails.map((r) => [r.status, r.groupLeaderId])).toEqual([
      ['queued', null],
      ['queued', null],
    ]);
  });

  it('never groups an urgent always-sent message', async () => {
    const andrei = await account('andrei');
    await service.notify({
      eventId: 'evt-r1',
      kind: 'JOB_READY',
      recipients: [andrei],
    });
    service.now = at('2026-10-05T11:01:00Z');
    await service.notify({
      eventId: 'evt-r2',
      kind: 'JOB_READY',
      recipients: [andrei],
    });
    await quote(andrei, 'evt-q');
    const emails = (await rows(andrei)).filter((r) => r.channel === 'email');
    expect(emails.map((r) => r.status)).toEqual(['queued', 'queued', 'queued']);
    expect((await jobs()).map((j) => j.name)).toEqual(['send', 'send', 'send']);
  });
});

describe('quiet hours', () => {
  // 23:10 in Bucharest.
  const NIGHT = '2026-10-04T20:10:00Z';

  it('holds a reminder that is not urgent until 08:00 and writes its bell row at once', async () => {
    const ion = await account('ion', ['garage']);
    service.now = at(NIGHT);
    await service.notify({
      eventId: 'evt-n1',
      kind: 'REQUEST_REMINDER',
      recipients: [ion],
    });
    const written = await rows(ion);
    expect(written.find((r) => r.channel === 'in_app')).toMatchObject({
      status: 'sent',
    });
    const email = written.find((r) => r.channel === 'email');
    expect(email).toMatchObject({ status: 'held' });
    expect(email?.sendAfter?.toISOString()).toBe('2026-10-05T05:00:00.000Z');
    const [job] = await jobs();
    expect(job).toMatchObject({ data: { id: email?.id }, name: 'send' });
    expect(job.opts.delay).toBe(
      new Date('2026-10-05T05:00:00Z').getTime() - new Date(NIGHT).getTime(),
    );
  });

  it.each(['JOB_READY', 'BOOKING_CONFIRM_REMINDER'])(
    'sends %s at once at night',
    async (kind) => {
      const andrei = await account('andrei');
      service.now = at('2026-10-04T23:00:00Z');
      await service.notify({ eventId: 'evt-n2', kind, recipients: [andrei] });
      expect(
        (await rows(andrei)).find((r) => r.channel === 'email'),
      ).toMatchObject({
        sendAfter: null,
        status: 'queued',
      });
    },
  );
});

describe('account e-mails', () => {
  it('sends the e-mail check straight away, even at night, with the link', async () => {
    const ana = await account('ana');
    service.now = at('2026-10-04T20:10:00Z');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/confirm?t=1',
      purpose: 'email_check',
    });
    const email = (await rows(ana)).find((r) => r.channel === 'email');
    expect(email).toMatchObject({
      kind: 'ACCOUNT_EMAIL',
      params: {
        link: 'https://motorfix.test/confirm?t=1',
        purpose: 'email_check',
      },
      status: 'queued',
      subjectId: ana,
    });
    expect((await rows(ana)).map((r) => r.channel).sort()).toEqual([
      'email',
      'in_app',
    ]);
  });

  it('sends two password resets asked for a minute apart as two e-mails', async () => {
    const ana = await account('ana');
    const reset = {
      accountId: ana,
      link: 'https://motorfix.test/r',
      purpose: 'password_reset' as const,
    };
    await service.sendAccountEmail(reset);
    service.now = at('2026-10-05T11:01:00Z');
    await service.sendAccountEmail(reset);
    const emails = (await rows(ana)).filter((r) => r.channel === 'email');
    expect(emails.map((r) => r.status)).toEqual(['queued', 'queued']);
    expect(new Set(emails.map((r) => r.eventId)).size).toBe(2);
  });
});

describe('e-mails to a listing draft', () => {
  const draft = (email = 'owner@example.test') =>
    prisma.listingDraft
      .create({
        data: { email, language: 'en', step: 2, updatedAt: new Date(DAY) },
      })
      .then((d) => d.id);
  const draftRows = (listingDraftId: string) =>
    prisma.notification.findMany({ where: { listingDraftId } });
  const link = 'https://motorfix.test/en/list-your-garage?draft=secret';

  it('writes one e-mail row with no account, no params and a fresh event, and queues the link with it', async () => {
    const id = await draft();

    await service.sendToDraft('LISTING_CONTINUE_LINK', id, link);
    await service.sendToDraft('LISTING_CONTINUE_LINK', id, link);

    const written = await draftRows(id);
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({
      accountId: null,
      channel: 'email',
      kind: 'LISTING_CONTINUE_LINK',
      listingDraftId: id,
      params: {},
      status: 'queued',
      subjectId: id,
    });
    expect(new Set(written.map((r) => r.eventId)).size).toBe(2);
    const queued = await jobs();
    expect(queued.map((j) => j.data)).toEqual(
      written
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((r) => ({ id: r.id, link })),
    );
    expect(JSON.stringify(written)).not.toContain('secret');
  });

  it('holds a reminder until 08:00 at night but never the link asked for', async () => {
    const id = await draft();
    service.now = at('2026-10-04T20:10:00Z');

    await service.sendToDraft('LISTING_REMINDER', id, link);
    await service.sendToDraft('LISTING_CONTINUE_LINK', id, link);

    const written = await draftRows(id);
    expect(written.find((r) => r.kind === 'LISTING_REMINDER')).toMatchObject({
      sendAfter: new Date('2026-10-05T05:00:00Z'),
      status: 'held',
    });
    expect(
      written.find((r) => r.kind === 'LISTING_CONTINUE_LINK'),
    ).toMatchObject({ sendAfter: null, status: 'queued' });
  });

  it('writes the row failed and queues nothing for an address off the allow-list', async () => {
    const id = await draft('owner@elsewhere.test');

    await service.sendToDraft('LISTING_CONTINUE_LINK', id, link);

    expect(await draftRows(id)).toEqual([
      expect.objectContaining({ params: {}, status: 'failed' }),
    ]);
    expect(await jobs()).toEqual([]);
  });

  it('fails a bounced draft e-mail without touching any account', async () => {
    const id = await draft();
    await service.sendToDraft('LISTING_CONTINUE_LINK', id, link);
    const [row] = await draftRows(id);
    await prisma.notification.update({
      data: { providerMessageId: '<draft@mock>', status: 'sent' },
      where: { id: row.id },
    });

    await service.recordBounce('<draft@mock>');

    expect(await draftRows(id)).toEqual([
      expect.objectContaining({ failure: 'bounced', status: 'failed' }),
    ]);
  });

  it('refuses any other kind of message', async () => {
    const id = await draft();

    await expect(
      service.sendToDraft('QUOTE_RECEIVED' as never, id, link),
    ).rejects.toThrow(/QUOTE_RECEIVED/);
    expect(await draftRows(id)).toEqual([]);
  });
});
