// @traces 392-FR-001 392-FR-002 392-FR-003 392-FR-004 392-FR-005 392-FR-006 392-FR-007 392-FR-008 392-FR-010 522-FR-001 561-FR-001 561-FR-002 561-FR-003 561-FR-004
import type { OutsideChannel } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { Brevo } from './brevo/brevo';
import { BrevoMock } from './brevo/brevo-mock.testing';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService, RETRY_MINUTES } from './notifications.service';
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
import type { Role } from '../auth/capabilities';
import { serialDatabase } from '../auth/serial-db.testing';
import { until } from '../waits.testing';

const redisUrl = redisUrlFor(9);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

let service: NotificationsService;
let processor: NotificationsProcessor;

// 1 November 2026, 09:00 in Bucharest.
const NOVEMBER = '2026-11-01T07:00:00Z';

function build(phone: Record<string, string> = {}, now = NOVEMBER) {
  const config = testConfig(mock.url);
  service = new NotificationsService(
    prisma,
    queue,
    publisher,
    config,
    null,
    new AuditService(),
  );
  processor = new NotificationsProcessor(
    prisma,
    service,
    new Brevo({ apiKey: config.apiKey ?? '', apiUrl: config.apiUrl }),
    config,
    testPhoneConfig(phone),
  );
  setNow(now);
}

function setNow(iso: string) {
  service.now = () => new Date(iso);
  processor.now = () => new Date(iso);
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

async function person(
  name: string,
  n: number,
  options: { roles?: Role[]; verified?: boolean } = {},
) {
  const id = await account(name, options.roles ?? ['driver']);
  await prisma.account.update({
    data: {
      phone: testPhone(n),
      phoneVerifiedAt:
        options.verified === false ? null : new Date('2026-09-01T00:00:00Z'),
    },
    where: { id },
  });
  return id;
}

const choose = (
  accountId: string,
  type: string,
  channel: OutsideChannel,
  garageId: string | null = null,
) =>
  prisma.notificationPreference.create({
    data: { accountId, channel, enabled: true, garageId, type },
  });

const remind = (accountId: string, eventId: string, kind = 'DUE_ITP') =>
  service.notify({ eventId, kind, recipients: [accountId] });

const rows = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, channel: { not: 'in_app' } },
  });

const sendJob = (id: string, attemptsMade = 0) =>
  processor.handle({ attemptsMade, data: { id }, name: 'send' });

// Sends every queued row, fallbacks included, as the worker would.
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

const counter = (accountId: string, month: string) =>
  prisma.smsCounter.findUnique({
    where: { accountId_month: { accountId, month } },
  });

// By channel: a fallback is written in the same instant as the row it replaces.
const summary = async (accountId: string) =>
  (await rows(accountId))
    .map((r) => [r.channel, r.status, r.failure])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe('a reminder a driver chose to get by SMS', () => {
  it('goes by SMS through Brevo and counts in its month', async () => {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    await remind(ana, 'itp-1');
    await drain(ana);
    expect(mock.sms()).toHaveLength(1);
    expect(mock.sms()[0].body).toEqual({
      content:
        'MotorFix: ITP-ul mașinii tale expiră curând. Detalii în aplicație.',
      recipient: '40710000001',
      sender: 'MotorFix',
      type: 'transactional',
    });
    expect(mock.emails()).toHaveLength(0);
    const [sms] = await rows(ana);
    expect(sms).toMatchObject({
      channel: 'sms',
      providerMessageId: '1001',
      status: 'sent',
    });
    expect(sms.sentAt?.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(1);
  });

  it('goes by WhatsApp once the month’s five SMS are used', async () => {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    for (let i = 1; i <= 6; i++) {
      await remind(ana, `itp-${i}`);
      await drain(ana);
    }
    expect(mock.sms()).toHaveLength(5);
    expect(mock.whatsapp()).toHaveLength(1);
    expect(mock.whatsapp()[0].body).toEqual({
      contactNumbers: ['40710000001'],
      senderNumber: '40700000099',
      templateId: 12,
    });
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(5);
    const all = await rows(ana);
    const capped = all.find((r) => r.failure === 'sms_cap_reached');
    expect(capped).toMatchObject({ channel: 'sms', status: 'failed' });
    expect(all.find((r) => r.channel === 'whatsapp')).toMatchObject({
      eventId: capped?.eventId,
      fallbackOf: capped?.id,
      status: 'sent',
    });
  });

  it('goes by SMS again in the next month', async () => {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    await prisma.smsCounter.create({
      data: { accountId: ana, month: '2026-11', sentCount: 5 },
    });
    // 1 December, 08:30 in Bucharest.
    setNow('2026-12-01T06:30:00Z');
    await remind(ana, 'itp-dec');
    await drain(ana);
    expect(mock.sms()).toHaveLength(1);
    expect(mock.whatsapp()).toHaveLength(0);
    expect((await counter(ana, '2026-12'))?.sentCount).toBe(1);
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(5);
  });

  it('lets only one of two reminders at the same second take the last SMS', async () => {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    await prisma.smsCounter.create({
      data: { accountId: ana, month: '2026-11', sentCount: 4 },
    });
    await remind(ana, 'itp-a');
    await remind(ana, 'itp-b');
    const [a, b] = await rows(ana);
    await Promise.all([sendJob(a.id), sendJob(b.id)]);
    await drain(ana);
    expect(mock.sms()).toHaveLength(1);
    expect(mock.whatsapp()).toHaveLength(1);
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(5);
  });

  it('waits until 08:00 at night and counts in the month it is sent', async () => {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    // 31 October, 23:40 in Bucharest.
    setNow('2026-10-31T21:40:00Z');
    await remind(ana, 'itp-late');
    const [held] = await rows(ana);
    expect(held).toMatchObject({ channel: 'sms', status: 'held' });
    expect(held.sendAfter?.toISOString()).toBe('2026-11-01T06:00:00.000Z');
    setNow('2026-11-01T06:00:05Z');
    await sendJob(held.id);
    expect(mock.sms()).toHaveLength(1);
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(1);
    expect(await counter(ana, '2026-10')).toBeNull();
  });

  it('holds its WhatsApp fallback until 08:00 when the SMS fails at night', async () => {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    // 1 November, 20:00 in Bucharest; the retries run out at 23:21.
    setNow('2026-11-01T18:00:00Z');
    await remind(ana, 'itp-night');
    const [sms] = await rows(ana);
    setNow('2026-11-01T21:21:00Z');
    mock.answer({ status: 503 });
    await sendJob(sms.id, RETRY_MINUTES.length);
    const whatsapp = (await rows(ana)).find((r) => r.channel === 'whatsapp');
    expect(whatsapp).toMatchObject({ status: 'held' });
    expect(whatsapp?.sendAfter?.toISOString()).toBe('2026-11-02T06:00:00.000Z');
    expect(mock.whatsapp()).toHaveLength(0);
    setNow('2026-11-02T06:00:05Z');
    mock.reset();
    await sendJob(whatsapp?.id ?? '');
    expect(mock.whatsapp()).toHaveLength(1);
  });

  it('goes by e-mail for a driver whose phone is not verified', async () => {
    const ana = await person('ana', 1, { verified: false });
    await choose(ana, 'DUE_ITP', 'sms');
    await remind(ana, 'itp-1');
    expect(await summary(ana)).toEqual([['email', 'queued', null]]);
  });
});

describe('an SMS that does not go', () => {
  it('is retried while Brevo is down, and gives its count back each time', async () => {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    await remind(ana, 'itp-1');
    const [sms] = await rows(ana);
    mock.answer({ status: 503 });
    await expect(sendJob(sms.id)).rejects.toMatchObject({
      reason: 'provider_503',
    });
    expect(await summary(ana)).toEqual([['sms', 'queued', null]]);
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(0);
  });

  it('goes by WhatsApp when the retries are used up, without counting', async () => {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    await remind(ana, 'itp-1');
    const [sms] = await rows(ana);
    mock.answer({ status: 503 });
    await sendJob(sms.id, RETRY_MINUTES.length);
    await drain(ana);
    expect(await summary(ana)).toEqual([
      ['sms', 'failed', 'provider_503'],
      ['whatsapp', 'sent', null],
    ]);
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(0);
  });

  it('goes by WhatsApp at once when Brevo refuses it', async () => {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    await remind(ana, 'itp-1');
    mock.answer({ status: 400 });
    await drain(ana);
    expect(await summary(ana)).toEqual([
      ['sms', 'failed', 'provider_400'],
      ['whatsapp', 'sent', null],
    ]);
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(0);
  });

  it('goes by WhatsApp, then e-mail, for a type with neither text', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_RCA', 'sms');
    await remind(ana, 'rca-1', 'DUE_RCA');
    await drain(ana);
    expect(await summary(ana)).toEqual([
      ['email', 'sent', null],
      ['sms', 'failed', 'template_failed'],
      ['whatsapp', 'failed', 'template_failed'],
    ]);
    expect(mock.sms()).toHaveLength(0);
    expect(await counter(ana, '2026-11')).toBeNull();
    error.mockRestore();
  });

  it('goes by e-mail, skipping WhatsApp, while phone sending is off', async () => {
    build({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '' });
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    await remind(ana, 'itp-1');
    await drain(ana);
    expect(await summary(ana)).toEqual([
      ['email', 'sent', null],
      ['sms', 'failed', 'sending_off'],
    ]);
    expect(mock.sms()).toHaveLength(0);
  });

  it('goes by e-mail outside production for a number not allowlisted', async () => {
    build({ PHONE_ALLOWLIST: testPhone(2) });
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    await remind(ana, 'itp-1');
    await drain(ana);
    expect(await summary(ana)).toEqual([
      ['email', 'sent', null],
      ['sms', 'failed', 'not_allowed'],
    ]);
  });
});

describe('an SMS that may have gone', () => {
  // A Brevo that gives up on a hanging call within the test's time.
  function impatient() {
    const config = testConfig(mock.url);
    const quick = new NotificationsProcessor(
      prisma,
      service,
      new Brevo({
        apiKey: config.apiKey ?? '',
        apiUrl: config.apiUrl,
        timeoutMs: 300,
      }),
      config,
      testPhoneConfig(),
    );
    quick.now = processor.now;
    return quick;
  }

  async function queuedSms() {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'sms');
    await remind(ana, 'itp-1');
    const [sms] = await rows(ana);
    return { ana, sms };
  }

  const sendingAt = async (id: string) =>
    (await prisma.notification.findUniqueOrThrow({ where: { id } })).sendingAt;

  it('is marked as being sent before Brevo answers', async () => {
    const { sms } = await queuedSms();
    mock.answer({ hang: true, status: 200 });
    const job = impatient().handle({
      attemptsMade: 0,
      data: { id: sms.id },
      name: 'send',
    });
    await until('the text message', () => mock.sms().length > 0);
    expect(mock.sms()).toHaveLength(1);
    expect(await sendingAt(sms.id)).toEqual(new Date(NOVEMBER));
    await job;
  });

  it('is not sent or counted again after a worker died with it in flight', async () => {
    const { ana, sms } = await queuedSms();
    await prisma.notification.update({
      data: { sendingAt: new Date(NOVEMBER) },
      where: { id: sms.id },
    });
    await drain(ana);
    expect(mock.sms()).toHaveLength(0);
    expect(await counter(ana, '2026-11')).toBeNull();
    expect(await summary(ana)).toEqual([
      ['sms', 'failed', 'sms_unconfirmed'],
      ['whatsapp', 'sent', null],
    ]);
  });

  it('keeps its count and is not retried when Brevo gives no answer', async () => {
    const { ana, sms } = await queuedSms();
    mock.answer({ hang: true, status: 200 });
    await expect(
      impatient().handle({
        attemptsMade: 0,
        data: { id: sms.id },
        name: 'send',
      }),
    ).resolves.toBeUndefined();
    await drain(ana);
    expect(mock.sms()).toHaveLength(1);
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(1);
    expect(await summary(ana)).toEqual([
      ['sms', 'failed', 'sms_unconfirmed'],
      ['whatsapp', 'sent', null],
    ]);
  });

  it('is sent on its retry after Brevo refused it', async () => {
    const { ana, sms } = await queuedSms();
    mock.answer({ status: 503 });
    await expect(sendJob(sms.id)).rejects.toMatchObject({
      reason: 'provider_503',
    });
    expect(await sendingAt(sms.id)).toBeNull();
    await sendJob(sms.id, 1);
    expect(mock.sms()).toHaveLength(2);
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(1);
    expect(await summary(ana)).toEqual([['sms', 'sent', null]]);
  });

  it('is neither sent nor counted when its mark cannot be written', async () => {
    const { ana, sms } = await queuedSms();
    const update = jest
      .spyOn(prisma.notification, 'update')
      .mockRejectedValueOnce(new Error('connection lost'));
    try {
      await expect(sendJob(sms.id)).rejects.toThrow('connection lost');
    } finally {
      update.mockRestore();
    }
    expect(mock.sms()).toHaveLength(0);
    expect(await counter(ana, '2026-11')).toBeNull();
    expect(await sendingAt(sms.id)).toBeNull();
  });

  it('is sent on its retry when its count could not be taken', async () => {
    const { ana, sms } = await queuedSms();
    const count = jest
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('connection lost'));
    try {
      await expect(sendJob(sms.id)).rejects.toThrow('connection lost');
    } finally {
      count.mockRestore();
    }
    expect(mock.sms()).toHaveLength(0);
    expect(await counter(ana, '2026-11')).toBeNull();
    expect(await sendingAt(sms.id)).toBeNull();
    await sendJob(sms.id, 1);
    expect(mock.sms()).toHaveLength(1);
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(1);
    expect(await summary(ana)).toEqual([['sms', 'sent', null]]);
  });

  it('fails with the count’s error, and is not sent, when the mark cannot be cleared either', async () => {
    const { ana, sms } = await queuedSms();
    const count = jest
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('count lost'));
    const real = prisma.notification.update.bind(prisma.notification);
    let calls = 0;
    const update = jest
      .spyOn(prisma.notification, 'update')
      .mockImplementation(((args: never) =>
        ++calls === 2
          ? Promise.reject(new Error('clear lost'))
          : real(args)) as never);
    try {
      await expect(sendJob(sms.id)).rejects.toThrow('count lost');
    } finally {
      count.mockRestore();
      update.mockRestore();
    }
    expect(calls).toBe(2);
    await drain(ana);
    expect(mock.sms()).toHaveLength(0);
    expect(await counter(ana, '2026-11')).toBeNull();
    expect(await summary(ana)).toEqual([
      ['sms', 'failed', 'sms_unconfirmed'],
      ['whatsapp', 'sent', null],
    ]);
  });

  it('gives its count back and is not sent again when a refusal’s mark cannot be cleared', async () => {
    const { ana, sms } = await queuedSms();
    mock.answer({ status: 503 });
    const real = prisma.notification.update.bind(prisma.notification);
    let calls = 0;
    const update = jest
      .spyOn(prisma.notification, 'update')
      .mockImplementation(((args: never) =>
        ++calls === 2
          ? Promise.reject(new Error('connection lost'))
          : real(args)) as never);
    try {
      await expect(sendJob(sms.id)).rejects.toThrow('connection lost');
    } finally {
      update.mockRestore();
    }
    expect((await counter(ana, '2026-11'))?.sentCount).toBe(0);
    await drain(ana);
    expect(mock.sms()).toHaveLength(1);
    expect(await summary(ana)).toEqual([
      ['sms', 'failed', 'sms_unconfirmed'],
      ['whatsapp', 'sent', null],
    ]);
  });
});

describe('a WhatsApp message that does not go', () => {
  it('goes by e-mail when Brevo refuses the number', async () => {
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'whatsapp');
    await remind(ana, 'itp-1');
    mock.answer({ body: { code: 'invalid_parameter' }, status: 400 });
    await drain(ana);
    const all = await rows(ana);
    const whatsapp = all.find((r) => r.channel === 'whatsapp');
    const email = all.find((r) => r.channel === 'email');
    expect(whatsapp).toMatchObject({
      failure: 'provider_400',
      status: 'failed',
    });
    expect(email).toMatchObject({
      channel: 'email',
      fallbackOf: whatsapp?.id,
      status: 'sent',
    });
    expect(mock.emails()).toHaveLength(1);
  });

  it('goes by e-mail, with an error logged, while its template is not approved', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    build({ WHATSAPP_TEMPLATES: 'motorfix_due_itp_en=13' });
    const ana = await person('ana', 1);
    await choose(ana, 'DUE_ITP', 'whatsapp');
    await remind(ana, 'itp-1');
    await drain(ana);
    expect(await summary(ana)).toEqual([
      ['email', 'sent', null],
      ['whatsapp', 'failed', 'template_not_approved'],
    ]);
    expect(mock.whatsapp()).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('motorfix_due_itp_ro'),
    );
    error.mockRestore();
  });
});

describe('starting the worker for phone sending alone', () => {
  it('checks the Brevo key when only phone sending is on', async () => {
    const config = testConfig(mock.url, { EMAIL_SENDING: 'off' });
    const phoneOnly = new NotificationsProcessor(
      prisma,
      service,
      new Brevo({ apiKey: config.apiKey ?? '', apiUrl: config.apiUrl }),
      config,
      testPhoneConfig(),
    );
    await expect(phoneOnly.ready()).resolves.toBe(true);
    expect(mock.calls.map((c) => c.path)).toEqual(['/v3/account']);
  });

  it('refuses to start phone sending with no key', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const config = testConfig(mock.url, {
      BREVO_API_KEY: '',
      EMAIL_SENDING: 'off',
    });
    const phoneOnly = new NotificationsProcessor(
      prisma,
      service,
      new Brevo({ apiKey: '', apiUrl: config.apiUrl }),
      config,
      testPhoneConfig(),
    );
    await expect(phoneOnly.ready()).resolves.toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('the garage’s WhatsApp switch', () => {
  async function staff(feature: boolean | null) {
    const owner = await person('owner', 3, { roles: ['garage'] });
    const garage = await prisma.garage.create({
      data: { name: 'Service Ion', slug: 'service-ion' },
    });
    await prisma.garageMember.create({
      data: { accountId: owner, garageId: garage.id, role: 'owner' },
    });
    if (feature !== null) {
      await prisma.garageFeature.create({
        data: { enabled: feature, garageId: garage.id, key: 'whatsapp' },
      });
    }
    await choose(owner, 'REQUEST_RECEIVED', 'whatsapp', garage.id);
    return { garageId: garage.id, owner };
  }

  const request = (owner: string, garageId: string) =>
    service.notify({
      eventId: 'req-1',
      garageId,
      kind: 'REQUEST_RECEIVED',
      recipients: [owner],
    });

  it('sends staff WhatsApp beside e-mail while it is on', async () => {
    const { garageId, owner } = await staff(null);
    await request(owner, garageId);
    expect(await summary(owner)).toEqual([
      ['email', 'queued', null],
      ['whatsapp', 'queued', null],
    ]);
  });

  it('writes no second e-mail when the staff WhatsApp falls back', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { garageId, owner } = await staff(true);
    await request(owner, garageId);
    await drain(owner);
    expect(await summary(owner)).toEqual([
      ['email', 'sent', null],
      ['whatsapp', 'failed', 'template_failed'],
    ]);
    expect(mock.emails()).toHaveLength(1);
    error.mockRestore();
  });

  it('sends staff no WhatsApp once it is off', async () => {
    const { garageId, owner } = await staff(false);
    await prisma.notificationPreference.create({
      data: {
        accountId: owner,
        channel: 'email',
        enabled: false,
        garageId,
        type: 'REQUEST_RECEIVED',
      },
    });
    await request(owner, garageId);
    expect(await summary(owner)).toEqual([['email', 'queued', null]]);
  });

  it('still sends a driver’s WhatsApp about that garage', async () => {
    const { garageId } = await staff(false);
    const ana = await person('ana', 1);
    await choose(ana, 'QUOTE_RECEIVED', 'whatsapp');
    await service.notify({
      eventId: 'quote-1',
      garageId,
      kind: 'QUOTE_RECEIVED',
      recipients: [ana],
    });
    expect(await summary(ana)).toEqual([['whatsapp', 'queued', null]]);
  });
});

describe('a database error after Brevo accepted a phone message', () => {
  it.each([
    ['sms', () => mock.sms()],
    ['whatsapp', () => mock.whatsapp()],
  ] as const)(
    'records the %s on a later write and does not send it again',
    async (channel, calls) => {
      const ana = await person('ana', 1);
      await choose(ana, 'DUE_ITP', channel);
      await remind(ana, 'itp-1');
      const [sent] = (await rows(ana)).filter((r) => r.channel === channel);
      const undo = failWritesAfter(prisma, () => calls().length > 0, 1);
      try {
        await expect(sendJob(sent.id)).resolves.toBeUndefined();
      } finally {
        undo();
      }
      expect(calls()).toHaveLength(1);
      expect(
        (
          await prisma.notification.findUniqueOrThrow({
            where: { id: sent.id },
          })
        ).status,
      ).toBe('sent');
    },
  );
});
