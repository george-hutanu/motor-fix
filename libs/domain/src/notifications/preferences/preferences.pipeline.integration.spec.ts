import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { MockInstance } from 'vitest';

import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { PrismaClient } from '../../generated/prisma/client';
import * as counters from '../../metrics/product-counters';
import { NOTIFICATION_TYPES } from '../catalogue';
import { NotificationsService } from '../notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhone,
} from '../notifications.testing';

const redisUrl = redisUrlFor(10);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

// 14:00 in Bucharest, outside quiet hours.
const DAY = new Date('2026-10-05T11:00:00Z');

const serviceOn = (client: PrismaClient) => {
  const service = new NotificationsService(
    client,
    queue,
    publisher,
    testConfig('http://127.0.0.1:9'),
    { privateKey: 'private', publicKey: 'public', subject: 'mailto:o@x.test' },
    new AuditService(),
  );
  service.now = () => DAY;
  return service;
};

let service: NotificationsService;

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  service = serviceOn(prisma);
});

const channelsOf = async (accountId: string, kind: string) =>
  (
    await prisma.notification.findMany({
      orderBy: { channel: 'asc' },
      where: { accountId, kind },
    })
  ).map((r) => r.channel);

const prefer = (
  accountId: string,
  type: string,
  channel: 'email' | 'push' | 'sms' | 'whatsapp',
  enabled: boolean,
  garageId: string | null = null,
) =>
  prisma.notificationPreference.create({
    data: { accountId, channel, enabled, garageId, type },
  });

const hand = (
  kind: string,
  accountId: string,
  garageId?: string,
  eventId = `${kind}-1`,
) => service.notify({ eventId, garageId, kind, recipients: [accountId] });

describe('a message whose kind the person switched off', () => {
  it('reaches only the bell when due dates are off', async () => {
    const driver = await account('andrei');
    for (const type of [
      'DUE_ITP',
      'DUE_RCA',
      'DUE_ROVINIETA',
      'SERVICE_DUE',
      'TYRES_SEASON',
    ]) {
      await prefer(driver, type, 'email', false);
    }
    expect(await hand('DUE_ITP', driver)).toBe(0);
    expect(await channelsOf(driver, 'DUE_ITP')).toEqual(['in_app']);
  });

  it('still goes by e-mail when it is always sent', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'BOOKING_REMINDER', 'email', false);
    await hand('BOOKING_CONFIRMED', driver);
    await hand('JOB_READY', driver);
    expect(await channelsOf(driver, 'BOOKING_CONFIRMED')).toEqual([
      'in_app',
      'email',
    ]);
    expect(await channelsOf(driver, 'JOB_READY')).toEqual(['in_app', 'email']);
  });

  it('still goes by e-mail when it is always sent on another chosen channel', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'JOB_READY', 'whatsapp', true);
    await hand('JOB_READY', driver);
    expect(await channelsOf(driver, 'JOB_READY')).toEqual(['in_app', 'email']);
  });
});

// @traces 223-FR-009
describe('a driver who switched off the group Ofertă nouă', () => {
  it('gets a new quote in the bell only, on no outside channel', async () => {
    const driver = await account('andrei');
    await prisma.pushSubscription.create({
      data: {
        accountId: driver,
        auth: 'a',
        endpoint: `https://push.example.test/${driver}`,
        p256dh: 'p',
      },
    });
    for (const type of Object.keys(NOTIFICATION_TYPES).filter(
      (name) => NOTIFICATION_TYPES[name].group === 'offers',
    )) {
      await prefer(driver, type, 'email', false);
    }
    expect(await hand('QUOTE_RECEIVED', driver)).toBe(0);
    expect(await channelsOf(driver, 'QUOTE_RECEIVED')).toEqual(['in_app']);
  });
});

describe('a driver’s chosen channel', () => {
  it('writes a push row and no e-mail row for a type that goes by push to a device', async () => {
    const driver = await account('andrei');
    await prisma.pushSubscription.create({
      data: {
        accountId: driver,
        auth: 'a',
        endpoint: 'https://push.example.test/1',
        p256dh: 'p',
      },
    });
    await prefer(driver, 'QUOTE_RECEIVED', 'push', true);
    expect(await hand('QUOTE_RECEIVED', driver)).toBe(1);
    expect(await channelsOf(driver, 'QUOTE_RECEIVED')).toEqual([
      'in_app',
      'push',
    ]);
  });

  it('sends by e-mail a type set to push when there is no device', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'QUOTE_RECEIVED', 'push', true);
    expect(await hand('QUOTE_RECEIVED', driver)).toBe(1);
    expect(await channelsOf(driver, 'QUOTE_RECEIVED')).toEqual([
      'in_app',
      'email',
    ]);
  });

  it('sends by e-mail a type set to WhatsApp when the phone is not verified', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'QUOTE_RECEIVED', 'whatsapp', true);
    expect(await hand('QUOTE_RECEIVED', driver)).toBe(1);
    expect(await channelsOf(driver, 'QUOTE_RECEIVED')).toEqual([
      'in_app',
      'email',
    ]);
  });

  it('sends by e-mail when nothing is saved', async () => {
    const driver = await account('andrei');
    expect(await hand('QUOTE_RECEIVED', driver)).toBe(1);
    expect(await channelsOf(driver, 'QUOTE_RECEIVED')).toEqual([
      'in_app',
      'email',
    ]);
  });

  it('keeps news off while nothing is saved', async () => {
    const driver = await account('andrei');
    await hand('NEWS', driver);
    expect(await channelsOf(driver, 'NEWS')).toEqual(['in_app']);
  });
});

describe('garage staff choices', () => {
  const garage = async () => {
    const created = await prisma.garage.create({
      data: { name: 'Dinamo', slug: 'dinamo' },
    });
    const owner = await prisma.account.findFirstOrThrow({
      where: { name: 'ion' },
    });
    await prisma.garageMember.create({
      data: { accountId: owner.id, garageId: created.id, role: 'owner' },
    });
    return created;
  };

  it('mute push only, so e-mail still goes for that garage', async () => {
    const owner = await account('ion', ['garage']);
    const { id } = await garage();
    await prefer(owner, 'REQUEST_RECEIVED', 'push', false, id);
    expect(await hand('REQUEST_RECEIVED', owner, id)).toBe(1);
    expect(await channelsOf(owner, 'REQUEST_RECEIVED')).toEqual([
      'in_app',
      'email',
    ]);
  });

  it('mute e-mail for one garage and not for a message of no garage', async () => {
    const owner = await account('ion', ['garage']);
    const { id } = await garage();
    await prefer(owner, 'REQUEST_RECEIVED', 'email', false, id);
    expect(await hand('REQUEST_RECEIVED', owner, id, 'at-garage')).toBe(0);
    expect(await hand('REQUEST_RECEIVED', owner, undefined, 'no-garage')).toBe(
      1,
    );
  });
});

// @traces 198-FR-009
describe('a garage’s own staff choices', () => {
  const staffOf = async () => {
    const garage = await prisma.garage.create({
      data: { name: 'Dinamo', slug: 'dinamo' },
    });
    const owner = await account('ion', ['garage']);
    const receptionist = await account('ana', ['receptionist']);
    await prisma.garageMember.createMany({
      data: [
        { accountId: owner, garageId: garage.id, role: 'owner' },
        { accountId: receptionist, garageId: garage.id, role: 'receptionist' },
      ],
    });
    return { garageId: garage.id, owner, receptionist };
  };

  // @traces 223-FR-008
  it('leave only the bell for a request and its reminders the owner muted', async () => {
    const { garageId, owner } = await staffOf();
    await prefer(owner, 'REQUEST_RECEIVED', 'email', false, garageId);
    await prefer(owner, 'REQUEST_RECEIVED', 'push', false, garageId);
    await hand('REQUEST_RECEIVED', owner, garageId);
    await hand('REQUEST_REMINDER', owner, garageId, 'reminder-1');
    await hand('REQUEST_REMINDER', owner, garageId, 'reminder-2');
    expect(await channelsOf(owner, 'REQUEST_RECEIVED')).toEqual(['in_app']);
    expect(await channelsOf(owner, 'REQUEST_REMINDER')).toEqual([
      'in_app',
      'in_app',
    ]);
  });

  it('keep e-mail when only push and WhatsApp are off', async () => {
    const { garageId, owner } = await staffOf();
    await prefer(owner, 'REQUEST_RECEIVED', 'push', false, garageId);
    await prefer(owner, 'REQUEST_RECEIVED', 'whatsapp', false, garageId);
    await hand('REQUEST_RECEIVED', owner, garageId);
    await hand('REQUEST_REMINDER', owner, garageId, 'reminder-1');
    expect(await channelsOf(owner, 'REQUEST_RECEIVED')).toEqual([
      'in_app',
      'email',
    ]);
    expect(await channelsOf(owner, 'REQUEST_REMINDER')).toEqual([
      'in_app',
      'email',
    ]);
  });

  it('change only the receptionist’s own channels', async () => {
    const { garageId, owner, receptionist } = await staffOf();
    await prefer(receptionist, 'REQUEST_RECEIVED', 'email', false, garageId);
    await service.notify({
      eventId: 'both',
      garageId,
      kind: 'REQUEST_RECEIVED',
      recipients: [owner, receptionist],
    });
    expect(await channelsOf(owner, 'REQUEST_RECEIVED')).toEqual([
      'in_app',
      'email',
    ]);
    expect(await channelsOf(receptionist, 'REQUEST_RECEIVED')).toEqual([
      'in_app',
    ]);
  });

  it('go by a driver’s own choice for a message about a garage they are not staff of', async () => {
    const { garageId } = await staffOf();
    const driver = await account('andrei');
    await prefer(driver, 'MESSAGE_RECEIVED', 'email', false, garageId);
    await hand('MESSAGE_RECEIVED', driver, garageId);
    expect(await channelsOf(driver, 'MESSAGE_RECEIVED')).toEqual([
      'in_app',
      'email',
    ]);
  });

  it('read a garage row of a type that is also a driver’s, apart from the driver choice', async () => {
    const { garageId, owner } = await staffOf();
    await prefer(owner, 'MESSAGE_RECEIVED', 'email', false, garageId);
    await hand('MESSAGE_RECEIVED', owner, garageId, 'about-garage');
    expect(await channelsOf(owner, 'MESSAGE_RECEIVED')).toEqual(['in_app']);
    await hand('MESSAGE_RECEIVED', owner, undefined, 'as-driver');
    expect(await channelsOf(owner, 'MESSAGE_RECEIVED')).toEqual([
      'in_app',
      'in_app',
      'email',
    ]);
  });

  // @traces 068-FR-004
  it('send a document reminder by e-mail whatever the owner muted', async () => {
    const { garageId, owner } = await staffOf();
    for (const kind of ['DOCUMENT_DUE', 'DOCUMENT_OVERDUE']) {
      await prefer(owner, kind, 'email', false, garageId);
      await prefer(owner, kind, 'push', false, garageId);
      await hand(kind, owner, garageId);
      expect(await channelsOf(owner, kind)).toEqual(['in_app', 'email']);
    }
  });

  it('goes by the garage’s rows when the garage staff cannot be read', async () => {
    const { garageId, owner } = await staffOf();
    await prefer(owner, 'STAFF_JOINED', 'email', false, garageId);
    const failing = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === 'garageMember') {
          return { count: () => Promise.reject(new Error('store down')) };
        }
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    service = serviceOn(failing);
    expect(await hand('STAFF_JOINED', owner, garageId)).toBe(0);
    expect(await channelsOf(owner, 'STAFF_JOINED')).toEqual(['in_app']);
  });
});

describe('when the preferences cannot be read', () => {
  it('sends on the default channel instead of dropping the message', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'QUOTE_RECEIVED', 'email', false);
    const failing = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === 'notificationPreference') {
          return { findMany: () => Promise.reject(new Error('store down')) };
        }
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    service = serviceOn(failing);
    expect(await hand('QUOTE_RECEIVED', driver)).toBe(1);
    expect(await channelsOf(driver, 'QUOTE_RECEIVED')).toEqual([
      'in_app',
      'email',
    ]);
  });
});

let phones = 0;
const confirmPhone = (id: string) =>
  prisma.account.update({
    data: { phone: testPhone(++phones), phoneVerifiedAt: new Date() },
    where: { id },
  });

const addDevice = (accountId: string) =>
  prisma.pushSubscription.create({
    data: {
      accountId,
      auth: 'auth',
      endpoint: `https://push.example.test/${accountId}`,
      p256dh: 'key',
    },
  });

// @traces 142-FR-002 142-FR-010
describe('the next message of a type whose channel was picked', () => {
  it('goes by the SMS a driver picked for ITP', async () => {
    const driver = await account('andrei');
    await confirmPhone(driver);
    await prefer(driver, 'DUE_ITP', 'sms', true);
    await hand('DUE_ITP', driver);
    expect(await channelsOf(driver, 'DUE_ITP')).toEqual(['in_app', 'sms']);
  });

  it('goes by the WhatsApp a driver picked for a new offer', async () => {
    const driver = await account('andrei');
    await confirmPhone(driver);
    await prefer(driver, 'QUOTE_RECEIVED', 'whatsapp', true);
    await hand('QUOTE_RECEIVED', driver);
    expect(await channelsOf(driver, 'QUOTE_RECEIVED')).toEqual([
      'in_app',
      'whatsapp',
    ]);
  });
});

// @traces 142-FR-005
describe('a driver type with nothing saved', () => {
  it('goes by push when the account has a device', async () => {
    const driver = await account('andrei');
    await addDevice(driver);
    await hand('DUE_ITP', driver);
    expect(await channelsOf(driver, 'DUE_ITP')).toEqual(['in_app', 'push']);
  });

  it('goes by e-mail without a device', async () => {
    const driver = await account('andrei');
    await hand('DUE_ITP', driver);
    expect(await channelsOf(driver, 'DUE_ITP')).toEqual(['in_app', 'email']);
  });

  it('stays on e-mail for an always-sent type, device or not', async () => {
    const driver = await account('andrei');
    await addDevice(driver);
    await hand('JOB_READY', driver);
    expect(await channelsOf(driver, 'JOB_READY')).toEqual(['in_app', 'email']);
  });
});

// @traces 142-FR-008
describe('a message that goes by another channel than the one picked', () => {
  let fallbacks: MockInstance;
  beforeEach(() => {
    fallbacks = vi.spyOn(counters, 'countChannelFallback');
  });
  afterEach(() => fallbacks.mockRestore());

  it('is counted once when push has no device', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'DUE_ITP', 'push', true);
    await hand('DUE_ITP', driver);
    expect(await channelsOf(driver, 'DUE_ITP')).toEqual(['in_app', 'email']);
    expect(fallbacks.mock.calls).toEqual([['push', 'email', 'no_device']]);
  });

  it('is counted once when SMS or WhatsApp has no confirmed phone', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'DUE_ITP', 'sms', true);
    await prefer(driver, 'QUOTE_RECEIVED', 'whatsapp', true);
    await hand('DUE_ITP', driver);
    await hand('QUOTE_RECEIVED', driver);
    expect(fallbacks.mock.calls).toEqual([
      ['sms', 'email', 'phone_not_verified'],
      ['whatsapp', 'email', 'phone_not_verified'],
    ]);
  });

  it('is not counted when the picked channel is used', async () => {
    const driver = await account('andrei');
    await confirmPhone(driver);
    await prefer(driver, 'DUE_ITP', 'sms', true);
    await hand('DUE_ITP', driver);
    expect(fallbacks).not.toHaveBeenCalled();
  });

  const sentRow = async (
    driver: string,
    kind: string,
    channel: 'email' | 'push' | 'sms' | 'whatsapp',
  ) =>
    prisma.notification.findFirstOrThrow({
      where: { accountId: driver, channel, kind },
    });

  it('counts the 6th SMS of the month going by WhatsApp', async () => {
    const driver = await account('andrei');
    await confirmPhone(driver);
    await prefer(driver, 'DUE_ITP', 'sms', true);
    await hand('DUE_ITP', driver);
    await service.fail(
      [await sentRow(driver, 'DUE_ITP', 'sms')],
      'sms_cap_reached',
      true,
    );
    expect(await channelsOf(driver, 'DUE_ITP')).toEqual([
      'in_app',
      'sms',
      'whatsapp',
    ]);
    expect(fallbacks.mock.calls).toEqual([
      ['sms', 'whatsapp', 'sms_cap_reached'],
    ]);
  });

  it.each([
    ['phone_not_verified', 'email', 'phone_not_verified'],
    ['no_phone', 'email', 'phone_not_verified'],
    ['not_allowed', 'email', 'phone_not_verified'],
    ['sending_off', 'email', 'send_failed'],
    ['template_not_approved', true, 'send_failed'],
  ] as const)(
    'counts a WhatsApp failed with %s as going by e-mail, %s',
    async (failure, fallback, reason) => {
      const driver = await account('andrei');
      await confirmPhone(driver);
      await prefer(driver, 'QUOTE_RECEIVED', 'whatsapp', true);
      await hand('QUOTE_RECEIVED', driver);
      await service.fail(
        [await sentRow(driver, 'QUOTE_RECEIVED', 'whatsapp')],
        failure,
        fallback,
      );
      expect(fallbacks.mock.calls).toEqual([['whatsapp', 'email', reason]]);
    },
  );

  it('counts a push without a device at send time as no_device', async () => {
    const driver = await account('andrei');
    const device = await addDevice(driver);
    await prefer(driver, 'DUE_ITP', 'push', true);
    await hand('DUE_ITP', driver);
    await prisma.pushSubscription.delete({ where: { id: device.id } });
    await service.fail(
      [await sentRow(driver, 'DUE_ITP', 'push')],
      'no_device',
      true,
    );
    expect(fallbacks.mock.calls).toEqual([['push', 'email', 'no_device']]);
  });

  it('is not counted when no row is written on another channel', async () => {
    const driver = await account('andrei', ['driver'], { email: null });
    const device = await addDevice(driver);
    await prefer(driver, 'DUE_ITP', 'push', true);
    await hand('DUE_ITP', driver);
    await prisma.pushSubscription.delete({ where: { id: device.id } });
    await service.fail(
      [await sentRow(driver, 'DUE_ITP', 'push')],
      'no_device',
      true,
    );
    expect(fallbacks).not.toHaveBeenCalled();
  });
});

// @traces 1374-FR-001
// @traces 1374-FR-002
// @traces 1374-FR-003
// @traces 1374-FR-007
describe('the last fallback kept per driver and type', () => {
  let fallbacks: MockInstance;
  beforeEach(() => {
    fallbacks = vi.spyOn(counters, 'countChannelFallback');
  });
  afterEach(() => fallbacks.mockRestore());

  const recorded = (accountId: string) =>
    prisma.notificationFallback.findMany({
      orderBy: { type: 'asc' },
      select: { at: true, from: true, reason: true, to: true, type: true },
      where: { accountId },
    });

  const rowOf = (
    driver: string,
    kind: string,
    channel: 'email' | 'push' | 'sms' | 'whatsapp',
  ) =>
    prisma.notification.findFirstOrThrow({
      where: { accountId: driver, channel, kind },
    });

  it('keeps a push with no device going by e-mail, at the build time', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'DUE_ITP', 'push', true);
    await hand('DUE_ITP', driver);
    expect(await recorded(driver)).toEqual([
      {
        at: DAY,
        from: 'push',
        reason: 'no_device',
        to: 'email',
        type: 'DUE_ITP',
      },
    ]);
    expect(fallbacks).toHaveBeenCalledTimes(1);
  });

  it('keeps an SMS or WhatsApp with no confirmed phone going by e-mail', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'DUE_ITP', 'sms', true);
    await prefer(driver, 'QUOTE_RECEIVED', 'whatsapp', true);
    await hand('DUE_ITP', driver);
    await hand('QUOTE_RECEIVED', driver);
    expect(await recorded(driver)).toEqual([
      {
        at: DAY,
        from: 'sms',
        reason: 'phone_not_verified',
        to: 'email',
        type: 'DUE_ITP',
      },
      {
        at: DAY,
        from: 'whatsapp',
        reason: 'phone_not_verified',
        to: 'email',
        type: 'QUOTE_RECEIVED',
      },
    ]);
  });

  it('keeps the SMS over the month’s allowance going by WhatsApp', async () => {
    const driver = await account('andrei');
    await confirmPhone(driver);
    await prefer(driver, 'DUE_ITP', 'sms', true);
    await hand('DUE_ITP', driver);
    await service.fail(
      [await rowOf(driver, 'DUE_ITP', 'sms')],
      'sms_cap_reached',
      true,
    );
    expect(await recorded(driver)).toEqual([
      {
        at: DAY,
        from: 'sms',
        reason: 'sms_cap_reached',
        to: 'whatsapp',
        type: 'DUE_ITP',
      },
    ]);
    expect(fallbacks).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed WhatsApp going by e-mail as send_failed', async () => {
    const driver = await account('andrei');
    await confirmPhone(driver);
    await prefer(driver, 'QUOTE_RECEIVED', 'whatsapp', true);
    await hand('QUOTE_RECEIVED', driver);
    await service.fail(
      [await rowOf(driver, 'QUOTE_RECEIVED', 'whatsapp')],
      'sending_off',
      'email',
    );
    expect(await recorded(driver)).toEqual([
      expect.objectContaining({
        from: 'whatsapp',
        reason: 'send_failed',
        to: 'email',
      }),
    ]);
  });

  it('keeps only the later fallback of a type', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'DUE_ITP', 'push', true);
    await hand('DUE_ITP', driver, undefined, 'itp-1');
    await prisma.notificationPreference.updateMany({
      data: { channel: 'sms' },
      where: { accountId: driver, type: 'DUE_ITP' },
    });
    const later = new Date(DAY.getTime() + 60_000);
    service.now = () => later;
    await hand('DUE_ITP', driver, undefined, 'itp-2');
    expect(await recorded(driver)).toEqual([
      {
        at: later,
        from: 'sms',
        reason: 'phone_not_verified',
        to: 'email',
        type: 'DUE_ITP',
      },
    ]);
  });

  it('keeps nothing when the chosen channel is used', async () => {
    const driver = await account('andrei');
    await confirmPhone(driver);
    await prefer(driver, 'DUE_ITP', 'sms', true);
    await hand('DUE_ITP', driver);
    expect(await recorded(driver)).toEqual([]);
  });

  it('keeps nothing for a staff type that goes by e-mail without a device', async () => {
    const owner = await account('ion', ['garage']);
    await hand('ASSISTANT_APPROVAL_NEEDED', owner);
    expect(fallbacks).toHaveBeenCalledWith('push', 'email', 'no_device');
    expect(await recorded(owner)).toEqual([]);
  });

  it('keeps the first fallback when the fallback itself fails', async () => {
    const driver = await account('andrei');
    await confirmPhone(driver);
    await prefer(driver, 'DUE_ITP', 'sms', true);
    await hand('DUE_ITP', driver);
    await service.fail(
      [await rowOf(driver, 'DUE_ITP', 'sms')],
      'sms_cap_reached',
      true,
    );
    await service.fail(
      [await rowOf(driver, 'DUE_ITP', 'whatsapp')],
      'sending_off',
      'email',
    );
    expect(fallbacks).toHaveBeenCalledTimes(2);
    expect(await recorded(driver)).toEqual([
      expect.objectContaining({ from: 'sms', reason: 'sms_cap_reached' }),
    ]);
  });

  it('keeps nothing when no row is written on another channel', async () => {
    const driver = await account('andrei', ['driver'], { email: null });
    const device = await addDevice(driver);
    await prefer(driver, 'DUE_ITP', 'push', true);
    await hand('DUE_ITP', driver);
    await prisma.pushSubscription.delete({ where: { id: device.id } });
    await service.fail(
      [await rowOf(driver, 'DUE_ITP', 'push')],
      'no_device',
      true,
    );
    expect(await recorded(driver)).toEqual([]);
  });
});
