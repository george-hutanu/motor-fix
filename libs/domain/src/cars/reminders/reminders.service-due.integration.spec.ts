// @traces 091-FR-010 091-FR-011 091-FR-012 091-FR-017
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { RemindersService } from './reminders.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { planSave } from '../../notifications/preferences/preferences';

const redisUrl = redisUrlFor(3);
const { account, car, prisma, reset } = fixtures();
const WEB = 'https://motorfix.test';
const CARS = `${WEB}/app/driver/cars`;

serialDatabase(databaseUrl);

const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

let notifications: NotificationsService;
let reminders: RemindersService;
let driver: string;
let carId: string;
let sequence = 0;

const MORNING = (day: string) => () => new Date(`${day}T09:00:00Z`);
// 23:15 in Bucharest, summer time.
const NIGHT = (day: string) => () => new Date(`${day}T20:15:00Z`);

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  notifications = new NotificationsService(
    prisma,
    queue,
    publisher,
    testConfig('http://127.0.0.1:9'),
    null,
    new AuditService(),
  );
  reminders = new RemindersService(prisma, notifications, WEB);
  driver = await account('ioana');
  carId = await car(driver);
  // The car's first reading, 90,000 km on 8 October 2026: on the 1,000 km a
  // month default, 1,314 km left is 40 days, 17 November.
  await reading('2026-10-08', 90_000);
  notifications.now = MORNING('2026-10-08');
});

const day = (d: string) => new Date(`${d}T00:00:00Z`);

async function reading(readOn: string, km: number) {
  await prisma.odometerReading.create({
    data: { carId, km, readOn: day(readOn), source: 'driver' },
  });
  await prisma.car.update({ data: { odometerKm: km }, where: { id: carId } });
}

const setNextService = (nextServiceKm: number | null) =>
  prisma.car.update({ data: { nextServiceKm }, where: { id: carId } });

const event = (kind: string, changed?: string[]) => {
  sequence += 1;
  return {
    id: String(sequence),
    kind,
    payload: { carId, ownerId: driver, ...(changed ? { changed } : {}) },
    subjectId: carId,
  };
};

const added = () => reminders.onCarEvent(event('car.added'));
const updated = (...changed: string[]) =>
  reminders.onCarEvent(event('car.updated', changed));

const service = () =>
  prisma.reminder.findUnique({
    where: { carId_kind: { carId, kind: 'service' } },
  });

async function runOn(d: string, clock = MORNING) {
  notifications.now = clock(d);
  return reminders.run(d);
}

const bell = () =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { channel: 'in_app', kind: 'SERVICE_DUE' },
  });

describe('the service reminder a car event sets', () => {
  it('is created for a car added with a next service, due on its estimated day', async () => {
    await setNextService(91_314);

    await added();

    expect(await service()).toMatchObject({
      accountId: driver,
      dueKm: 91_314,
      dueOn: day('2026-11-17'),
      sent7: false,
      sent30: false,
    });
  });

  it('is not created for a car added without one', async () => {
    await added();

    expect(await service()).toBeNull();
  });

  it('marks the stages already behind a value entered late, sending only the next', async () => {
    // 600 km left is 18 days: the 30-day stage is behind, the 7-day one is not.
    await setNextService(90_600);

    await updated('nextServiceKm');

    expect(await service()).toMatchObject({
      dueOn: day('2026-10-26'),
      sent7: false,
      sent30: true,
    });
  });

  it('takes a new id and resets its flags for a new value', async () => {
    await setNextService(91_314);
    await added();
    await runOn('2026-10-18');
    const first = await service();
    expect(first?.sent30).toBe(true);

    await setNextService(91_500);
    await updated('nextServiceKm');

    const second = await service();
    expect(second?.id).not.toBe(first?.id);
    expect(second).toMatchObject({
      dueKm: 91_500,
      dueOn: day('2026-11-23'),
      sent7: false,
      sent30: false,
    });
  });

  it('moves its day and keeps its id and flags when only the odometer changes', async () => {
    await setNextService(91_314);
    await added();
    await runOn('2026-10-18');
    const first = await service();

    notifications.now = MORNING('2026-10-20');
    await reading('2026-10-20', 90_500);
    await updated('odometerKm');

    // 814 km left from 20 October on the default is 25 days.
    expect(await service()).toMatchObject({
      dueKm: 91_314,
      dueOn: day('2026-11-14'),
      id: first?.id,
      sent7: false,
      sent30: true,
    });
    expect(await runOn('2026-10-20')).toBe(0);
  });

  it('marks a stage sent, not caught up, when the odometer moves its day behind today', async () => {
    await setNextService(91_314);
    await added();

    notifications.now = MORNING('2026-10-20');
    await reading('2026-10-20', 91_200);
    await updated('odometerKm');

    // 114 km left is 3 days: both stages are behind or on today's 7-day window.
    expect(await service()).toMatchObject({
      dueOn: day('2026-10-23'),
      sent7: true,
      sent30: true,
    });
    expect(await runOn('2026-10-20')).toBe(0);
  });

  it('is created again by an odometer change after it was cancelled', async () => {
    await setNextService(91_314);
    await added();
    await prisma.reminder.deleteMany({ where: { carId, kind: 'service' } });

    await reading('2026-10-08', 90_100);
    await updated('odometerKm');

    expect(await service()).toMatchObject({
      dueKm: 91_314,
      sent7: false,
      sent30: false,
    });
  });

  it('is cancelled when the value is cleared', async () => {
    await setNextService(91_314);
    await added();

    await setNextService(null);
    await updated('nextServiceKm');

    expect(await service()).toBeNull();
  });

  it('is cancelled once the odometer reaches the value', async () => {
    await setNextService(91_314);
    await added();

    await reading('2026-10-08', 91_314);
    await updated('odometerKm');

    expect(await service()).toBeNull();
  });

  it('is left alone by an edit of other fields', async () => {
    await setNextService(91_314);
    await added();
    const before = await service();

    await setNextService(91_500);
    await updated('model');

    expect(await service()).toEqual(before);
  });

  it('reaches the same row from a retried or out-of-order event', async () => {
    await setNextService(91_314);
    await added();
    const retried = event('car.updated', ['nextServiceKm']);
    await reminders.onCarEvent(retried);
    const once = await service();

    await reminders.onCarEvent(retried);
    await added();

    expect(await service()).toEqual(once);
  });

  it('is not set for a removed car', async () => {
    await setNextService(91_314);
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: carId },
    });

    await added();

    expect(await service()).toBeNull();
  });
});

describe('the daily run of a service reminder', () => {
  beforeEach(async () => {
    await setNextService(91_314);
    await added();
  });

  it('sends SERVICE_DUE 30 and 7 days before its day, once each', async () => {
    expect(await runOn('2026-10-18')).toBe(1);
    expect(await runOn('2026-10-18')).toBe(0);
    expect(await runOn('2026-11-10')).toBe(1);
    expect(await runOn('2026-11-10')).toBe(0);

    expect((await bell()).map((n) => n.params)).toEqual([
      { car: 'Dacia Logan', cars: CARS, dueOn: '2026-11-17', left: 30 },
      { car: 'Dacia Logan', cars: CARS, dueOn: '2026-11-17', left: 7 },
    ]);
    expect(await service()).toMatchObject({ sent7: true, sent30: true });
  });

  it('catches up the 30-day stage after a missed run', async () => {
    expect(await runOn('2026-10-25')).toBe(1);

    expect((await bell())[0].params).toMatchObject({ left: 23 });
  });

  it('does not send the 30-day stage again after the odometer moves its day', async () => {
    await runOn('2026-10-18');
    notifications.now = MORNING('2026-10-19');
    // 914 km left from 19 October is 28 days: inside the 30-day window.
    await reading('2026-10-19', 90_400);
    await updated('odometerKm');

    expect((await service())?.dueOn).toEqual(day('2026-11-16'));
    expect(await runOn('2026-10-19')).toBe(0);
    expect(await bell()).toHaveLength(1);
  });

  it('sends again for a new value', async () => {
    await runOn('2026-10-18');
    notifications.now = MORNING('2026-10-19');
    // 1,347 km from the 8 October reading is 41 days: 18 November, 30 days on.
    await setNextService(91_347);
    await updated('nextServiceKm');

    expect(await runOn('2026-10-19')).toBe(1);
    expect(await bell()).toHaveLength(2);
  });

  it('sends nothing for a removed car', async () => {
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: carId },
    });

    expect(await runOn('2026-10-18')).toBe(0);
    expect(await bell()).toHaveLength(0);
  });

  it('sends nothing to a deleted account', async () => {
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: driver },
    });

    await runOn('2026-10-18');

    expect(await bell()).toHaveLength(0);
  });

  it('writes only the bell while the e-mail is switched off', async () => {
    await prisma.notificationPreference.create({
      data: {
        accountId: driver,
        channel: 'email',
        enabled: false,
        type: 'SERVICE_DUE',
      },
    });

    await runOn('2026-10-18');

    expect(await bell()).toHaveLength(1);
    expect(
      await prisma.notification.count({
        where: { channel: { not: 'in_app' }, kind: 'SERVICE_DUE' },
      }),
    ).toBe(0);
  });

  it('writes only the bell while the Scadențe group is muted', async () => {
    const { writes } = planSave([], [{ enabled: false, key: 'due_dates' }], []);
    expect(writes.map((w) => w.type)).toContain('SERVICE_DUE');
    await prisma.notificationPreference.createMany({
      data: writes.map((w) => ({ ...w, accountId: driver })),
    });

    expect(await runOn('2026-10-18')).toBe(1);

    expect(await bell()).toHaveLength(1);
    expect(
      await prisma.notification.count({
        where: { channel: { not: 'in_app' }, kind: 'SERVICE_DUE' },
      }),
    ).toBe(0);
  });

  it('writes the bell at once at 23:15 and holds the e-mail until 08:00', async () => {
    expect(await runOn('2026-10-18', NIGHT)).toBe(1);

    const [email] = await prisma.notification.findMany({
      where: { channel: 'email', kind: 'SERVICE_DUE' },
    });
    expect(email.status).toBe('held');
    expect(email.sendAfter).toEqual(new Date('2026-10-19T05:00:00Z'));
  });
});
