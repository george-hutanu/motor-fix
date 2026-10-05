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
    async () => undefined,
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
  it('writes no e-mail row for a type that goes by push', async () => {
    const driver = await account('andrei');
    await prefer(driver, 'QUOTE_RECEIVED', 'push', true);
    expect(await hand('QUOTE_RECEIVED', driver)).toBe(0);
    expect(await channelsOf(driver, 'QUOTE_RECEIVED')).toEqual(['in_app']);
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
  const garage = () =>
    prisma.garage.create({ data: { name: 'Dinamo', slug: 'dinamo' } });

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
