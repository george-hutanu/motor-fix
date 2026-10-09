// @traces 196-FR-007 196-FR-008 196-FR-009 196-FR-010 196-FR-011 196-FR-012 196-FR-013 196-FR-014 196-FR-018 196-FR-019 196-FR-020 522-FR-001 778-FR-002
import { createECDH, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { OutsideChannel } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { generateVAPIDKeys } from 'web-push';

import { PushSender } from './push';
import { plainAgent } from './push.testing';
import { AuditService } from '../../audit/audit.service';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import { Brevo } from '../brevo/brevo';
import { BrevoMock } from '../brevo/brevo-mock.testing';
import { NotificationsProcessor } from '../notifications.processor';
import { NotificationsService, RETRY_MINUTES } from '../notifications.service';
import {
  databaseUrl,
  failWritesAfter,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(1);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const vapid = generateVAPIDKeys();
const pushConfig = {
  privateKey: vapid.privateKey,
  publicKey: vapid.publicKey,
  subject: 'mailto:ops@example.test',
};

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

interface Hit {
  path: string;
  req: IncomingMessage;
  at: number;
}
const hits: Hit[] = [];
const answers = new Map<string, number>();
let pushServer: Server;
let base = '';

let service: NotificationsService;
let processor: NotificationsProcessor;

// 1 November 2026, 09:00 in Bucharest.
const NOVEMBER = '2026-11-01T07:00:00Z';

function build(push: typeof pushConfig | null = pushConfig, now = NOVEMBER) {
  const config = testConfig(mock.url);
  service = new NotificationsService(
    prisma,
    queue,
    publisher,
    config,
    push,
    new AuditService(),
  );
  processor = new NotificationsProcessor(
    prisma,
    service,
    new Brevo({ apiKey: config.apiKey ?? '', apiUrl: config.apiUrl }),
    config,
    testPhoneConfig(),
    push ? new PushSender(push, 2000, plainAgent()) : null,
  );
  service.now = () => new Date(now);
  processor.now = () => new Date(now);
}

beforeAll(async () => {
  await mock.start();
  pushServer = createServer((req, res) => {
    hits.push({ at: Date.now(), path: req.url ?? '', req });
    req.resume();
    res.statusCode = answers.get(req.url ?? '') ?? 201;
    res.end();
  });
  await new Promise<void>((done) => pushServer.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(pushServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await mock.stop();
  pushServer.closeAllConnections();
  pushServer.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  mock.reset();
  hits.length = 0;
  answers.clear();
  build();
});

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();

function device(accountId: string, name: string) {
  return prisma.pushSubscription.create({
    data: {
      accountId,
      auth: randomBytes(16).toString('base64url'),
      endpoint: `${base}/${name}`,
      label: name,
      p256dh: ecdh.getPublicKey().toString('base64url'),
    },
  });
}

async function person(
  name: string,
  options: { roles?: Role[]; devices?: string[] } = {},
) {
  const id = await account(name, options.roles ?? ['driver']);
  for (const d of options.devices ?? []) await device(id, d);
  return id;
}

const choose = (accountId: string, type: string, channel: OutsideChannel) =>
  prisma.notificationPreference.create({
    data: { accountId, channel, enabled: true, garageId: null, type },
  });

const rows = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: [{ createdAt: 'asc' }, { channel: 'asc' }],
    where: { accountId, channel: { not: 'in_app' } },
  });

const summary = async (accountId: string) =>
  (await rows(accountId))
    .map((r) => [r.channel, r.status, r.failure])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

const sendJob = (id: string, attemptsMade = 0) =>
  processor.handle({ attemptsMade, data: { id }, name: 'send' });

async function drain(accountId: string) {
  for (let lap = 0; lap < 10; lap++) {
    const queued = await prisma.notification.findMany({
      orderBy: { createdAt: 'asc' },
      where: { accountId, status: 'queued' },
    });
    if (queued.length === 0) return;
    for (const row of queued) await sendJob(row.id);
  }
  throw new Error('rows still queued after ten laps');
}

const test = (accountId: string, eventId = 'e1') =>
  service.notify({
    eventId,
    kind: 'TEST_MESSAGE',
    recipients: [accountId],
    subjectId: accountId,
  });

const reader = countedMetrics();
const counted = async () => ({
  emails: await counterTotal(reader, 'motorfix_emails_sent_total', {
    template: 'TEST_MESSAGE',
  }),
  pushes: await counterTotal(reader, 'motorfix_notifications_sent_total', {
    channel: 'push',
  }),
});

// @traces 879-FR-009
describe('counting what the processor sends', () => {
  it('counts one e-mail by its template and one push per row a device took, none for a refused one', async () => {
    const ana = await person('ana', { devices: ['laptop', 'phone'] });
    const ion = await person('ion', { devices: ['old'] });
    answers.set('/old', 410);
    const before = await counted();

    await test(ana);
    await drain(ana);
    await test(ion);
    await drain(ion);

    expect(await counted()).toEqual({
      emails: before.emails + 2,
      pushes: before.pushes + 1,
    });
  });
});

describe('routing to push', () => {
  it('writes one push row for a person with two devices and sends to both', async () => {
    const ana = await person('ana', { devices: ['laptop', 'phone'] });
    expect(await test(ana)).toBe(2);
    expect((await rows(ana)).map((r) => r.channel)).toEqual(['email', 'push']);
    await drain(ana);
    expect(hits.map((h) => h.path).sort()).toEqual(['/laptop', '/phone']);
    expect(await summary(ana)).toEqual([
      ['email', 'sent', null],
      ['push', 'sent', null],
    ]);
  });

  it('reaches the push service within a minute of the hand-over', async () => {
    const ana = await person('ana', { devices: ['laptop'] });
    const start = Date.now();
    await test(ana);
    await drain(ana);
    expect(hits).toHaveLength(1);
    expect(hits[0].at - start).toBeLessThan(60_000);
  });

  it('sends with a day of time to live and normal urgency for a type that is not always sent', async () => {
    const ana = await person('ana', { devices: ['laptop'] });
    await test(ana);
    await drain(ana);
    expect(hits[0].req.headers['ttl']).toBe('86400');
    expect(hits[0].req.headers['urgency']).toBe('normal');
    expect(hits[0].req.headers['authorization']).toMatch(/^vapid /);
  });

  it('stamps the device that took the message', async () => {
    const ana = await person('ana', { devices: ['laptop'] });
    await test(ana);
    await drain(ana);
    const [saved] = await prisma.pushSubscription.findMany();
    expect(saved.lastSuccessAt?.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    const push = (await rows(ana)).find((r) => r.channel === 'push');
    expect(push?.sentAt?.toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });

  it('is off for staff that muted push, and writes no row', async () => {
    const owner = await person('ion', {
      devices: ['laptop'],
      roles: ['garage'],
    });
    await prisma.notificationPreference.create({
      data: {
        accountId: owner,
        channel: 'push',
        enabled: false,
        garageId: null,
        type: 'TEST_MESSAGE',
      },
    });
    await test(owner);
    expect((await rows(owner)).map((r) => r.channel)).toEqual(['email']);
  });

  it('holds a push of a type that is not urgent in quiet hours until 08:00', async () => {
    build(pushConfig, '2026-11-01T21:30:00Z');
    const ana = await person('ana', { devices: ['laptop'] });
    await choose(ana, 'DUE_ITP', 'push');
    await service.notify({ eventId: 'i1', kind: 'DUE_ITP', recipients: [ana] });
    const push = (await rows(ana)).find((r) => r.channel === 'push');
    expect(push).toMatchObject({ status: 'held' });
    expect(push?.sendAfter?.toISOString()).toBe('2026-11-02T06:00:00.000Z');
  });
});

describe('a driver who chose push', () => {
  it('gets the message by e-mail when there is no device', async () => {
    const ana = await person('ana');
    await choose(ana, 'QUOTE_RECEIVED', 'push');
    expect(
      await service.notify({
        eventId: 'q1',
        kind: 'QUOTE_RECEIVED',
        recipients: [ana],
      }),
    ).toBe(1);
    expect((await rows(ana)).map((r) => r.channel)).toEqual(['email']);
  });

  it('gets no push when the server has no keys, and e-mail instead', async () => {
    build(null);
    const ana = await person('ana', { devices: ['laptop'] });
    await choose(ana, 'QUOTE_RECEIVED', 'push');
    await service.notify({
      eventId: 'q1',
      kind: 'QUOTE_RECEIVED',
      recipients: [ana],
    });
    expect((await rows(ana)).map((r) => r.channel)).toEqual(['email']);
  });

  it('falls back to e-mail when the type has no push text', async () => {
    const ana = await person('ana', { devices: ['laptop'] });
    await choose(ana, 'QUOTE_RECEIVED', 'push');
    await service.notify({
      eventId: 'q1',
      kind: 'QUOTE_RECEIVED',
      recipients: [ana],
    });
    await drain(ana);
    expect(hits).toHaveLength(0);
    expect(await summary(ana)).toEqual([
      ['email', 'sent', null],
      ['push', 'failed', 'template_failed'],
    ]);
    expect(mock.emails()).toHaveLength(1);
  });
});

describe('a device the push service no longer knows', () => {
  it.each([404, 410])(
    'is deleted on %s and the e-mail takes over',
    async (code) => {
      const ana = await person('ana', { devices: ['gone'] });
      answers.set('/gone', code);
      await test(ana);
      await drain(ana);
      expect(await prisma.pushSubscription.count()).toBe(0);
      const push = (await rows(ana)).find((r) => r.channel === 'push');
      expect(push).toMatchObject({ failure: 'no_device', status: 'failed' });
      expect(
        (await rows(ana)).filter((r) => r.channel === 'email'),
      ).toHaveLength(1);
    },
  );

  it('is deleted while the other device takes the message: sent, no fallback', async () => {
    const ana = await person('ana', { devices: ['gone', 'fine'] });
    answers.set('/gone', 410);
    await test(ana);
    await drain(ana);
    expect(
      (await prisma.pushSubscription.findMany()).map((d) => d.label),
    ).toEqual(['fine']);
    expect(await summary(ana)).toEqual([
      ['email', 'sent', null],
      ['push', 'sent', null],
    ]);
    expect(
      await prisma.notification.count({ where: { fallbackOf: { not: null } } }),
    ).toBe(0);
  });

  it('writes no row for a person whose only device was deleted', async () => {
    const ana = await person('ana', { devices: ['gone'] });
    await prisma.pushSubscription.deleteMany();
    await test(ana);
    expect((await rows(ana)).map((r) => r.channel)).toEqual(['email']);
  });
});

describe('a database error after the push service took a message', () => {
  it('records the push on a later write and does not send it again', async () => {
    const ana = await person('ana', { devices: ['laptop'] });
    await test(ana);
    const push = (await rows(ana)).find((r) => r.channel === 'push');
    const undo = failWritesAfter(prisma, () => hits.length > 0, 1);
    try {
      await expect(sendJob(push?.id ?? '')).resolves.toBeUndefined();
    } finally {
      undo();
    }
    expect(hits).toHaveLength(1);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: push?.id } }))
        .status,
    ).toBe('sent');
  });
});

describe('a push service that fails', () => {
  it('is retried on the e-mail schedule while it may still answer', async () => {
    const ana = await person('ana', { devices: ['down'] });
    answers.set('/down', 503);
    await test(ana);
    const push = (await rows(ana)).find((r) => r.channel === 'push');
    await expect(sendJob(push?.id ?? '', 0)).rejects.toThrow();
    expect(
      (await prisma.notification.findUnique({ where: { id: push?.id } }))
        ?.status,
    ).toBe('queued');
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it('fails and falls back to e-mail once the retries are used up', async () => {
    const ana = await person('ana', { devices: ['down'] });
    answers.set('/down', 500);
    await test(ana);
    const push = (await rows(ana)).find((r) => r.channel === 'push');
    await sendJob(push?.id ?? '', RETRY_MINUTES.length);
    expect(
      (await prisma.notification.findUnique({ where: { id: push?.id } }))
        ?.status,
    ).toBe('failed');
    await drain(ana);
    expect(mock.emails()).toHaveLength(1);
  });

  it('is not retried for a refusal that will not change', async () => {
    const ana = await person('ana', { devices: ['bad'] });
    answers.set('/bad', 403);
    await test(ana);
    const push = (await rows(ana)).find((r) => r.channel === 'push');
    await sendJob(push?.id ?? '', 0);
    expect(
      (await prisma.notification.findUnique({ where: { id: push?.id } }))
        ?.failure,
    ).toBe('push_refused');
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it('is sent when one device took it even if the other is down', async () => {
    const ana = await person('ana', { devices: ['down', 'fine'] });
    answers.set('/down', 503);
    await test(ana);
    const push = (await rows(ana)).find((r) => r.channel === 'push');
    await sendJob(push?.id ?? '', 0);
    expect(
      (await prisma.notification.findUnique({ where: { id: push?.id } }))
        ?.status,
    ).toBe('sent');
  });
});

describe('the fallback between e-mail and push', () => {
  it('sends by push an e-mail that fails for good, when the type lists push', async () => {
    const ana = await person('ana');
    await test(ana);
    await device(ana, 'laptop');
    mock.answer({ status: 400 });
    await drain(ana);
    expect(hits.map((h) => h.path)).toEqual(['/laptop']);
    const all = await rows(ana);
    const email = all.find((r) => r.channel === 'email');
    expect(email).toMatchObject({ failure: 'provider_400', status: 'failed' });
    expect(all.find((r) => r.channel === 'push')).toMatchObject({
      fallbackOf: email?.id,
      status: 'sent',
    });
  });

  it('writes no push fallback for a person with no device', async () => {
    const ana = await person('ana');
    await test(ana);
    mock.answer({ status: 400 });
    await drain(ana);
    expect((await rows(ana)).map((r) => r.channel)).toEqual(['email']);
  });

  it('never sends a fallback row to the other channel again', async () => {
    const ana = await person('ana', { devices: ['laptop'] });
    await choose(ana, 'QUOTE_RECEIVED', 'push');
    mock.answer({ status: 400 });
    await service.notify({
      eventId: 'q1',
      kind: 'QUOTE_RECEIVED',
      recipients: [ana],
    });
    await drain(ana);
    const all = await rows(ana);
    expect(all.map((r) => [r.channel, r.status])).toEqual([
      ['email', 'failed'],
      ['push', 'failed'],
    ]);
    expect(hits).toHaveLength(0);
  });
});

describe('the push-only test', () => {
  it('goes to the person’s devices and falls back to nothing', async () => {
    const ana = await person('ana', { devices: ['laptop'] });
    expect(await service.sendPushTest(ana)).toBe(1);
    await drain(ana);
    expect(hits).toHaveLength(1);
    expect(await summary(ana)).toEqual([['push', 'sent', null]]);
    expect(mock.emails()).toHaveLength(0);
  });

  it('queues nothing without a device', async () => {
    const ana = await person('ana');
    expect(await service.sendPushTest(ana)).toBe(0);
  });

  it('fails without e-mail when the device is gone', async () => {
    const ana = await person('ana', { devices: ['gone'] });
    answers.set('/gone', 410);
    await service.sendPushTest(ana);
    await drain(ana);
    expect(await summary(ana)).toEqual([['push', 'failed', 'no_device']]);
    expect(mock.emails()).toHaveLength(0);
  });
});
