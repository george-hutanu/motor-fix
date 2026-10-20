import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { RecheckDueTask } from './recheck-due';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { NotificationsModule } from '../../../notifications/notifications.module';
import { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../../notifications/notifications.testing';

const redisUrl = redisUrlFor(14);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

// Noon in Bucharest on 9 October.
const NOW = new Date('2026-10-09T09:00:00Z');
const DAY = '2026-10-09';
const WEB = 'https://motorfix.test';
const KIND = 'ADMIN_RECHECK_DUE';

let app: TestingModule;
let task: RecheckDueTask;

beforeAll(async () => {
  app = await Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        redisUrl,
      }),
    ],
  }).compile();
  const notifications = app.get(NotificationsService);
  notifications.now = () => NOW;
  task = new RecheckDueTask(prisma, notifications, WEB);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  await reset();
});

afterEach(() => jest.restoreAllMocks());

const garage = (
  lastCheckedOn: string | null,
  status: 'approved' | 'suspended' = 'approved',
) =>
  prisma.garage.create({
    data: {
      approvedAt: new Date(),
      lastCheckedOn: lastCheckedOn === null ? null : new Date(lastCheckedOn),
      name: 'Atelier',
      slug: `due-${randomUUID()}`,
      status,
    },
  });

const sent = (accountId?: string) =>
  prisma.notification.findMany({
    orderBy: { channel: 'asc' },
    where: { kind: KIND, ...(accountId && { accountId }) },
  });
const bell = async (accountId: string) =>
  (await sent(accountId)).filter((n) => n.channel === 'in_app');

// @traces 1351-FR-008 1351-FR-015
describe('the daily re-check reminder', () => {
  it('tells each admin the count once, keyed by the day, with a link to the list', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    const dan = await account('Dan Ene', ['admin']);
    await garage('2026-09-11');
    await garage(null);
    await garage('2026-09-20');
    await garage('2026-08-01', 'suspended');

    await task.run(NOW);

    for (const admin of [ana, dan]) {
      const rows = await bell(admin);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        eventId: `recheck-due-${DAY}`,
        params: {
          dashboard: `${WEB}/app/admin/garages`,
          garages: '2 service-uri',
        },
      });
    }
  });

  it('adds nothing on a second run the same day', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    await garage('2026-09-01');
    await task.run(NOW);
    const first = await sent(ana);

    await task.run(new Date('2026-10-09T15:00:00Z'));

    expect(await sent(ana)).toHaveLength(first.length);
  });

  it('sends nothing when no garage is due', async () => {
    await account('Ana Popescu', ['admin']);
    await garage('2026-09-20');

    await task.run(NOW);

    expect(await sent()).toEqual([]);
  });

  it('sends nothing to anyone who is not an admin', async () => {
    const driver = await account('Radu Ionescu', ['driver']);
    await account('Ana Popescu', ['admin']);
    await garage(null);

    await task.run(NOW);

    expect(await sent(driver)).toEqual([]);
  });

  it('keeps it off the e-mail and the push of an admin who muted the type', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    await prisma.notificationPreference.createMany({
      data: [
        { accountId: ana, channel: 'email', enabled: false, type: KIND },
        { accountId: ana, channel: 'push', enabled: false, type: KIND },
      ],
    });
    await garage(null);

    await task.run(NOW);

    expect((await sent(ana)).filter((n) => n.channel !== 'in_app')).toEqual([]);
  });

  it.each([
    [1, 'ro', '1 service'],
    [1, 'en', '1 garage'],
    [2, 'en', '2 garages'],
    [20, 'ro', '20 de service-uri'],
  ])(
    'counts %i in the admin’s language, %s',
    async (count, language, garages) => {
      const admin = await account('Ioana Marin', ['admin'], {
        language: language as 'ro' | 'en',
      });
      for (let i = 0; i < count; i++) await garage(null);

      await task.run(NOW);

      expect((await bell(admin))[0]?.params).toMatchObject({ garages });
    },
  );

  it('groups admins by language in one run', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    const ioana = await account('Ioana Marin', ['admin'], { language: 'en' });
    await garage(null);
    await garage(null);

    await task.run(NOW);

    expect((await bell(ana))[0]?.params).toMatchObject({
      garages: '2 service-uri',
    });
    expect((await bell(ioana))[0]?.params).toMatchObject({
      garages: '2 garages',
    });
  });

  it('asks no outside register', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    await garage(null);
    const outside = jest.spyOn(globalThis, 'fetch');

    await task.run(NOW);

    expect(await bell(ana)).toHaveLength(1);
    expect(outside).not.toHaveBeenCalled();
  });
});
