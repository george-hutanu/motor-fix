import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { NotificationsService } from './notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import type { PrismaClient } from '../generated/prisma/client';

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

  // @traces 198-FR-010
  it('send a document reminder by the channels left on, skipping a muted e-mail', async () => {
    const { garageId, owner } = await staffOf();
    await prefer(owner, 'DOCUMENT_DUE', 'email', false, garageId);
    await hand('DOCUMENT_DUE', owner, garageId);
    expect(await channelsOf(owner, 'DOCUMENT_DUE')).toEqual(['in_app']);
    await hand('DOCUMENT_OVERDUE', owner, garageId);
    expect(await channelsOf(owner, 'DOCUMENT_OVERDUE')).toEqual([
      'in_app',
      'email',
    ]);
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
