import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { RemindersService } from './reminders.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { addDays } from '../../bucharest';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';

const redisUrl = redisUrlFor(3);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

let notifications: NotificationsService;
let reminders: RemindersService;
let driver: string;

const car = async (ownerId: string, model = 'Logan') => {
  const brand = await prisma.brand.upsert({
    create: { key: 'test-dacia', name: 'Dacia', slug: 'test-dacia' },
    update: {},
    where: { name: 'Dacia' },
  });
  const { id } = await prisma.car.create({
    data: {
      brandId: brand.id,
      fuel: 'petrol',
      idempotencyKey: randomUUID(),
      model,
      odometerKm: 90000,
      ownerId,
      year: 2018,
    },
  });
  return id;
};

type Kind = 'itp' | 'rca' | 'rovinieta';
const reminder = (carId: string, kind: Kind = 'itp') =>
  prisma.reminder.findUnique({ where: { carId_kind: { carId, kind } } });

const set = (carId: string, kind: Kind, dueOn: string, today: string) =>
  reminders.setCarDue({ accountId: driver, carId, dueOn, kind, today });

const bell = () =>
  prisma.notification.findMany({
    where: { channel: 'in_app', kind: { startsWith: 'DUE_' } },
  });

async function runOn(day: string) {
  notifications.now = () => new Date(`${day}T09:00:00Z`);
  return reminders.run(day);
}

let sequence = 0;
const updated = async (
  carId: string,
  changed: string[],
  dates: Partial<
    Record<'itpUntil' | 'rcaUntil' | 'rovinietaUntil', string | null>
  >,
) => {
  sequence += 1;
  const after = {
    itpUntil: null,
    rcaUntil: null,
    rovinietaUntil: null,
    ...dates,
  };
  // The edit writes its event with the car, so the car already holds these.
  const at = (d: string | null) => d && new Date(`${d}T00:00:00Z`);
  await prisma.car.update({
    data: {
      itpUntil: at(after.itpUntil),
      rcaUntil: at(after.rcaUntil),
      rovinietaUntil: at(after.rovinietaUntil),
    },
    where: { id: carId },
  });
  return {
    id: `adv-${sequence}`,
    kind: 'car.updated' as const,
    payload: { carId, changed, ownerId: driver },
    subjectId: carId,
  };
};
const removed = (carId: string) => {
  sequence += 1;
  return {
    id: `adv-${sequence}`,
    kind: 'car.removed' as const,
    payload: { carId, ownerId: driver },
    subjectId: carId,
  };
};

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
  reminders = new RemindersService(prisma, notifications);
  driver = await account('ana');
});

// @traces 092-FR-008
describe('the stage days of a date set on 8 October 2026', () => {
  const today = '2026-10-08';

  it.each([
    ['38 days ahead', 38, false, false],
    ['31 days ahead', 31, false, false],
    ['30 days ahead, whose 30-day stage is today', 30, false, false],
    ['29 days ahead, whose 30-day stage was yesterday', 29, true, false],
    ['8 days ahead', 8, true, false],
    ['7 days ahead, whose 7-day stage is today', 7, true, false],
    ['6 days ahead, whose 7-day stage was yesterday', 6, true, true],
    ['today', 0, true, true],
    ['yesterday', -1, true, true],
  ])(
    'marks the stages already behind for a date %s',
    async (_, ahead, sent30, sent7) => {
      const carId = await car(driver);

      await set(carId, 'itp', addDays(today, ahead), today);

      expect(await reminder(carId)).toMatchObject({ sent7, sent30 });
    },
  );

  it('sends nothing for a date already past, on the day it is set or later', async () => {
    const carId = await car(driver);
    await set(carId, 'itp', '2026-10-01', today);

    expect(await runOn(today)).toBe(0);
    expect(await runOn('2026-10-09')).toBe(0);
    expect(await bell()).toHaveLength(0);
  });

  it('sends the 7-day stage on the day it is set when the date is 7 days off', async () => {
    const carId = await car(driver);
    await set(carId, 'itp', '2026-10-15', today);

    expect(await runOn(today)).toBe(1);
    expect(await runOn(today)).toBe(0);
    expect((await bell()).map((n) => n.subjectId)).toEqual([carId]);
  });

  it('keeps the three kinds of one car apart', async () => {
    const carId = await car(driver);
    await set(carId, 'itp', '2026-12-01', today);
    await set(carId, 'rca', '2026-10-20', today);
    await set(carId, 'rovinieta', '2027-06-01', today);

    expect(await reminder(carId, 'itp')).toMatchObject({
      sent7: false,
      sent30: false,
    });
    expect(await reminder(carId, 'rca')).toMatchObject({
      sent7: false,
      sent30: true,
    });
    expect(await reminder(carId, 'rovinieta')).toMatchObject({
      sent7: false,
      sent30: false,
    });
  });
});

// @traces 092-FR-008
describe('a date changed after a stage went out', () => {
  it('keeps the stage sent when the same date is set again, so a redelivery sends nothing', async () => {
    const carId = await car(driver);
    await set(carId, 'itp', '2026-12-10', '2026-10-01');
    expect(await runOn('2026-11-10')).toBe(1);

    await set(carId, 'itp', '2026-12-10', '2026-11-10');

    expect(await runOn('2026-11-10')).toBe(0);
    expect(await reminder(carId)).toMatchObject({ sent30: true });
  });

  it('marks the 7-day stage sent when moved to a date 5 days off and sends nothing late', async () => {
    const carId = await car(driver);
    await set(carId, 'itp', '2026-12-10', '2026-10-01');
    await runOn('2026-11-10');

    await set(carId, 'itp', '2026-11-15', '2026-11-10');

    expect(await reminder(carId)).toMatchObject({ sent7: true, sent30: true });
    expect(await runOn('2026-11-10')).toBe(0);
    expect(await runOn('2026-11-12')).toBe(0);
  });

  it('sends the 30-day stage again for a date moved away and back with enough time left', async () => {
    const carId = await car(driver);
    await set(carId, 'itp', '2026-12-10', '2026-10-01');
    expect(await runOn('2026-11-10')).toBe(1);
    await set(carId, 'itp', '2027-01-10', '2026-11-10');
    await set(carId, 'itp', '2026-12-10', '2026-11-10');

    expect(await runOn('2026-11-10')).toBe(1);
    expect(await bell()).toHaveLength(2);
  });
});

// @traces 092-FR-006
describe('a removal beside other cars', () => {
  it('cancels every reminder of the car and none of another car of the same driver', async () => {
    const gone = await car(driver, 'Logan');
    const kept = await car(driver, 'Duster');
    for (const id of [gone, kept]) {
      await set(id, 'itp', '2026-12-10', '2026-10-01');
      await set(id, 'rca', '2026-12-11', '2026-10-01');
      await set(id, 'rovinieta', '2026-12-12', '2026-10-01');
      await reminders.setTyres({ accountId: driver, carId: id });
    }

    await reminders.onCarEvent(removed(gone));

    expect(await prisma.reminder.count({ where: { carId: gone } })).toBe(0);
    expect(await prisma.reminder.count({ where: { carId: kept } })).toBe(5);
  });

  it('deletes the service and tyre reminders as well as the dated ones', async () => {
    const carId = await car(driver);
    await reminders.setTyres({ accountId: driver, carId });
    await prisma.reminder.create({
      data: {
        accountId: driver,
        carId,
        dueOn: new Date('2026-12-01T00:00:00Z'),
        kind: 'service',
      },
    });

    await reminders.onCarEvent(removed(carId));

    expect(await prisma.reminder.findMany({ where: { carId } })).toEqual([]);
  });

  it('sends none of the three kinds for a removed car whose rows are still there', async () => {
    const carId = await car(driver);
    for (const kind of ['itp', 'rca', 'rovinieta'] as const) {
      await set(carId, kind, '2026-12-10', '2026-10-01');
    }
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: carId },
    });

    expect(await runOn('2026-11-10')).toBe(0);
    expect(await bell()).toHaveLength(0);
  });

  it('still sends for the driver’s other car when one is removed', async () => {
    const gone = await car(driver, 'Logan');
    const kept = await car(driver, 'Duster');
    await set(gone, 'itp', '2026-12-10', '2026-10-01');
    await set(kept, 'itp', '2026-12-10', '2026-10-01');
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: gone },
    });

    expect(await runOn('2026-11-10')).toBe(1);
    expect((await bell()).map((n) => n.subjectId)).toEqual([kept]);
  });
});

// @traces 092-FR-006
describe('car.updated events out of the shape the relay sends them in', () => {
  it('sets the three dates of one event and cancels the cleared one in the same delivery', async () => {
    const carId = await car(driver);
    await set(carId, 'rca', '2026-12-01', '2026-10-01');

    await reminders.onCarEvent(
      await updated(carId, ['itpUntil', 'rcaUntil', 'rovinietaUntil'], {
        itpUntil: '2027-01-10',
        rcaUntil: null,
        rovinietaUntil: '2027-02-10',
      }),
    );

    expect(await reminder(carId, 'rca')).toBeNull();
    expect((await reminder(carId, 'itp'))?.dueOn).toEqual(
      new Date('2027-01-10T00:00:00Z'),
    );
    expect((await reminder(carId, 'rovinieta'))?.dueOn).toEqual(
      new Date('2027-02-10T00:00:00Z'),
    );
  });

  it('cancels nothing when a cleared date has no reminder yet, twice over', async () => {
    const carId = await car(driver);
    const event = await updated(carId, ['itpUntil'], { itpUntil: null });

    await reminders.onCarEvent(event);
    await reminders.onCarEvent(event);

    expect(await prisma.reminder.count({ where: { carId } })).toBe(0);
  });

  it('leaves a date alone that the event carries but does not list as changed', async () => {
    const carId = await car(driver);
    await set(carId, 'itp', '2026-12-10', '2026-10-01');

    await reminders.onCarEvent(
      await updated(carId, ['odometerKm'], { itpUntil: '2030-01-01' }),
    );

    expect((await reminder(carId))?.dueOn).toEqual(
      new Date('2026-12-10T00:00:00Z'),
    );
  });

  it('does not recreate a reminder when a late event follows the removal', async () => {
    const carId = await car(driver);
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: carId },
    });
    await reminders.onCarEvent(removed(carId));

    await reminders.onCarEvent(
      await updated(carId, ['itpUntil'], { itpUntil: '2027-01-10' }),
    );

    expect(await prisma.reminder.count({ where: { carId } })).toBe(0);
  });

  it('keeps the newer date when an older edit is delivered again after it', async () => {
    const carId = await car(driver);
    const older = await updated(carId, ['itpUntil'], {
      itpUntil: '2026-11-01',
    });
    const newer = await updated(carId, ['itpUntil'], {
      itpUntil: '2027-11-01',
    });

    await reminders.onCarEvent(older);
    await reminders.onCarEvent(newer);
    await reminders.onCarEvent(older);

    expect((await reminder(carId))?.dueOn).toEqual(
      new Date('2027-11-01T00:00:00Z'),
    );
  });

  it('does not recreate a reminder the owner cleared when an older edit is retried', async () => {
    const carId = await car(driver);
    const older = await updated(carId, ['rcaUntil'], {
      rcaUntil: '2026-12-01',
    });
    const cleared = await updated(carId, ['rcaUntil'], { rcaUntil: null });

    await reminders.onCarEvent(older);
    await reminders.onCarEvent(cleared);
    await reminders.onCarEvent(older);

    expect(await reminder(carId, 'rca')).toBeNull();
  });
});
