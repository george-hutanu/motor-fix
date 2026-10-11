import { randomUUID } from 'node:crypto';

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

const redisUrl = redisUrlFor(3);
const { account, prisma, reset } = fixtures();

// The edit writes its event with the car, so the car already holds the dates
// the event carries when the worker reads it.
type Dates = Record<'itpUntil' | 'rcaUntil' | 'rovinietaUntil', string | null>;
const saveDates = (carId: string, dates: Dates) =>
  prisma.car.update({
    data: {
      itpUntil: dates.itpUntil && new Date(`${dates.itpUntil}T00:00:00Z`),
      rcaUntil: dates.rcaUntil && new Date(`${dates.rcaUntil}T00:00:00Z`),
      rovinietaUntil:
        dates.rovinietaUntil && new Date(`${dates.rovinietaUntil}T00:00:00Z`),
    },
    where: { id: carId },
  });

// A reminder's car must exist (the foreign key); any car of the account will do.
const car = async (ownerId: string) => {
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
      model: 'Logan',
      odometerKm: 90000,
      ownerId,
      year: 2018,
    },
  });
  return id;
};
serialDatabase(databaseUrl);

const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

let notifications: NotificationsService;
let reminders: RemindersService;

// 11:00 in Bucharest, the time a 09:00 run is at work; 23:15 for a late catch-up.
const MORNING = (day: string) => () => new Date(`${day}T09:00:00Z`);
const NIGHT = (day: string) => () => new Date(`${day}T21:15:00Z`);

const rows = (kind: string, channel = 'in_app') =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { channel: channel as 'in_app', kind },
  });

const reminder = (
  carId: string,
  kind: 'itp' | 'rca' | 'rovinieta' | 'tyres_winter' = 'itp',
) =>
  prisma.reminder.findUniqueOrThrow({
    where: { carId_kind: { carId, kind } },
  });

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
});

async function runOn(day: string, clock = MORNING) {
  notifications.now = clock(day);
  return reminders.run(day);
}

describe('an ITP reminder due on 10 December 2026', () => {
  let driver: string;
  let carId: string;

  beforeEach(async () => {
    driver = await account('ana');
    carId = await car(driver);
    await reminders.setCarDue({
      accountId: driver,
      carId,
      dueOn: '2026-12-10',
      kind: 'itp',
      today: '2026-10-01',
    });
  });

  it('goes once on 10 November, and a second run that day sends nothing', async () => {
    expect(await runOn('2026-11-10')).toBe(1);
    expect(await runOn('2026-11-10')).toBe(0);

    const bell = await rows('DUE_ITP');
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({ accountId: driver, subjectId: carId });
    expect(await reminder(carId)).toMatchObject({ sent7: false, sent30: true });
  });

  it('goes once more on 3 December, setting sent_7', async () => {
    await runOn('2026-11-10');
    expect(await runOn('2026-12-03')).toBe(1);
    expect(await runOn('2026-12-03')).toBe(0);

    expect(await rows('DUE_ITP')).toHaveLength(2);
    expect(await reminder(carId)).toMatchObject({ sent7: true, sent30: true });
  });

  it('sends nothing on the days between', async () => {
    await runOn('2026-11-10');
    for (const day of ['2026-11-11', '2026-11-20', '2026-12-02']) {
      expect(await runOn(day)).toBe(0);
    }
    expect(await rows('DUE_ITP')).toHaveLength(1);
  });

  // @traces 032-FR-007
  it('names the car and its date, so the bell can say which ITP is due', async () => {
    await runOn('2026-11-10');

    const [bell] = await rows('DUE_ITP');
    expect(bell.params).toEqual({ car: 'Dacia Logan', dueOn: '2026-12-10' });
  });

  it('goes through the pipeline, which writes the e-mail too', async () => {
    await runOn('2026-11-10');
    const [email] = await rows('DUE_ITP', 'email');
    expect(email).toMatchObject({ accountId: driver, status: 'queued' });
  });

  it('writes one message per stage when two runs race', async () => {
    const [a, b] = await Promise.all([
      reminders.run('2026-11-10'),
      reminders.run('2026-11-10'),
    ]);
    expect(a + b).toBeGreaterThanOrEqual(1);
    expect(await rows('DUE_ITP')).toHaveLength(1);
    expect(await rows('DUE_ITP', 'email')).toHaveLength(1);
  });

  it('resets both flags when the date changes, and the new date applies', async () => {
    await runOn('2026-11-10');
    await runOn('2026-12-03');
    await reminders.setCarDue({
      accountId: driver,
      carId,
      dueOn: '2027-01-20',
      kind: 'itp',
      today: '2026-12-03',
    });
    expect(await reminder(carId)).toMatchObject({
      sent7: false,
      sent30: false,
    });

    expect(await runOn('2026-12-21')).toBe(1);
    expect(await rows('DUE_ITP')).toHaveLength(3);
  });

  it('keeps the flags when the same date is set again', async () => {
    await runOn('2026-11-10');
    await reminders.setCarDue({
      accountId: driver,
      carId,
      dueOn: '2026-12-10',
      kind: 'itp',
      today: '2026-11-10',
    });
    expect(await reminder(carId)).toMatchObject({ sent30: true });
    expect(await runOn('2026-11-11')).toBe(0);
  });

  it('is deleted with a removed car, and nothing is sent', async () => {
    await reminders.removeCar(carId);
    expect(await runOn('2026-11-10')).toBe(0);
    expect(await prisma.reminder.count()).toBe(0);
    expect(await rows('DUE_ITP')).toHaveLength(0);
  });

  it('keeps one row per car and kind', async () => {
    await reminders.setCarDue({
      accountId: driver,
      carId,
      dueOn: '2026-12-11',
      kind: 'itp',
      today: '2026-10-01',
    });
    expect(await prisma.reminder.count({ where: { carId } })).toBe(1);
  });

  it('writes the bell at once at 23:15 and holds the e-mail until 08:00', async () => {
    expect(await runOn('2026-11-10', NIGHT)).toBe(1);

    expect(await rows('DUE_ITP')).toHaveLength(1);
    const [email] = await rows('DUE_ITP', 'email');
    expect(email.status).toBe('held');
    // 08:00 on 11 November in Bucharest.
    expect(email.sendAfter).toEqual(new Date('2026-11-11T06:00:00Z'));
  });

  it('is flagged for a deleted driver, so it is not tried every day', async () => {
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: driver },
    });
    await runOn('2026-11-10');
    expect(await rows('DUE_ITP')).toHaveLength(0);
    expect(await reminder(carId)).toMatchObject({ sent30: true });
  });
});

describe('a run that fails part-way', () => {
  it('fails, keeps what it sent, and a retry sends the rest once', async () => {
    const driver = await account('george');
    for (const _ of [1, 2, 3]) {
      await reminders.setCarDue({
        accountId: driver,
        carId: await car(driver),
        dueOn: '2026-12-10',
        kind: 'itp',
        today: '2026-10-01',
      });
    }
    notifications.now = MORNING('2026-11-10');
    const notify = notifications.notify.bind(notifications);
    let calls = 0;
    const spy = jest
      .spyOn(notifications, 'notify')
      .mockImplementation(async (input) => {
        calls += 1;
        if (calls === 2) throw new Error('database down');
        return notify(input);
      });

    await expect(reminders.run('2026-11-10')).rejects.toThrow('database down');
    expect(await rows('DUE_ITP')).toHaveLength(1);
    expect(await prisma.reminder.count({ where: { sent30: true } })).toBe(1);

    expect(await reminders.run('2026-11-10')).toBe(2);
    expect(await rows('DUE_ITP')).toHaveLength(3);
    spy.mockRestore();
  });
});

describe('every 30 and 7 day kind', () => {
  it('sends its own type', async () => {
    const driver = await account('bogdan');
    const carId = await car(driver);
    for (const kind of ['rca', 'rovinieta', 'service'] as const) {
      await reminders.setCarDue({
        accountId: driver,
        carId,
        dueOn: '2026-12-10',
        kind,
        today: '2026-10-01',
      });
    }
    expect(await runOn('2026-11-10')).toBe(3);
    for (const type of ['DUE_RCA', 'DUE_ROVINIETA', 'SERVICE_DUE']) {
      expect(await rows(type)).toHaveLength(1);
    }
  });
});

describe('a booking reminder', () => {
  let driver: string;
  let bookingId: string;

  beforeEach(async () => {
    driver = await account('carmen');
    bookingId = randomUUID();
    // Tomorrow at 08:00 in Bucharest.
    await reminders.setBooking({
      accountId: driver,
      bookingId,
      startsAt: new Date('2026-11-11T06:00:00Z'),
    });
  });

  it('goes to the driver once the day before', async () => {
    expect(await runOn('2026-11-09')).toBe(0);
    expect(await runOn('2026-11-10')).toBe(1);
    expect(await runOn('2026-11-10')).toBe(0);

    const bell = await rows('BOOKING_REMINDER');
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({ accountId: driver, subjectId: bookingId });
    // @traces 032-FR-007
    expect(bell[0].params).toEqual({ dueOn: '2026-11-11' });
  });

  it('is not sent for a cancelled booking', async () => {
    await reminders.cancelBooking(bookingId);
    expect(await runOn('2026-11-10')).toBe(0);
    expect(await rows('BOOKING_REMINDER')).toHaveLength(0);
  });

  it('goes only the day before the new day after a move', async () => {
    await reminders.setBooking({
      accountId: driver,
      bookingId,
      startsAt: new Date('2026-11-14T08:00:00Z'),
    });
    expect(await runOn('2026-11-10')).toBe(0);
    expect(await runOn('2026-11-13')).toBe(1);
    expect(await rows('BOOKING_REMINDER')).toHaveLength(1);
  });

  it('goes again for a booking moved after its reminder was sent', async () => {
    await runOn('2026-11-10');
    await reminders.setBooking({
      accountId: driver,
      bookingId,
      startsAt: new Date('2026-11-14T08:00:00Z'),
    });
    expect(await runOn('2026-11-13')).toBe(1);
    expect(await rows('BOOKING_REMINDER')).toHaveLength(2);
  });
});

describe('the tyre reminders', () => {
  it('send TYRES_SEASON once per car per season', async () => {
    const driver = await account('dan');
    const carId = await car(driver);
    await reminders.setTyres({ accountId: driver, carId });

    expect(await runOn('2026-10-31')).toBe(0);
    expect(await runOn('2026-11-01')).toBe(1);
    expect(await runOn('2026-11-02')).toBe(0);
    expect(await reminder(carId, 'tyres_winter')).toMatchObject({
      seasonYear: 2026,
    });

    expect(await runOn('2027-04-01')).toBe(1);
    expect(await runOn('2027-11-01')).toBe(1);
    expect(await rows('TYRES_SEASON')).toHaveLength(3);
  });

  it('keeps the season sent when the tyres are set again', async () => {
    const driver = await account('elena');
    const carId = await car(driver);
    await reminders.setTyres({ accountId: driver, carId });
    await runOn('2026-11-01');
    await reminders.setTyres({ accountId: driver, carId });
    expect(await runOn('2026-11-02')).toBe(0);
  });
});

// @traces 092-FR-008
describe('a date set by an edit', () => {
  let driver: string;
  let carId: string;

  beforeEach(async () => {
    driver = await account('irina');
    carId = await car(driver);
  });

  it("marks as sent the stage whose day has passed, and sends today's stage", async () => {
    // RCA until 20 October, set on 8 October: the 30-day stage (20 September)
    // has passed, the 7-day one (13 October) has not.
    await reminders.setCarDue({
      accountId: driver,
      carId,
      dueOn: '2026-10-20',
      kind: 'rca',
      today: '2026-10-08',
    });
    expect(await reminder(carId, 'rca')).toMatchObject({
      sent7: false,
      sent30: true,
    });
    expect(await runOn('2026-10-08')).toBe(0);
    expect(await runOn('2026-10-13')).toBe(1);
    expect(await rows('DUE_RCA')).toHaveLength(1);
  });

  it('leaves unsent a stage whose day is today', async () => {
    await reminders.setCarDue({
      accountId: driver,
      carId,
      dueOn: '2026-11-07',
      kind: 'rca',
      today: '2026-10-08',
    });
    expect(await reminder(carId, 'rca')).toMatchObject({
      sent7: false,
      sent30: false,
    });
    expect(await runOn('2026-10-08')).toBe(1);
  });

  it('marks both stages sent for a date whose 7-day stage has passed', async () => {
    await reminders.setCarDue({
      accountId: driver,
      carId,
      dueOn: '2026-10-12',
      kind: 'itp',
      today: '2026-10-08',
    });
    expect(await reminder(carId)).toMatchObject({ sent7: true, sent30: true });
    expect(await runOn('2026-10-08')).toBe(0);
  });

  it('sends the 30-day stage once on 14 October 2027 and the 7-day once on 6 November for ITP until 13 November 2027', async () => {
    await reminders.setCarDue({
      accountId: driver,
      carId,
      dueOn: '2027-11-13',
      kind: 'itp',
      today: '2026-10-08',
    });
    expect(await reminder(carId)).toMatchObject({
      sent7: false,
      sent30: false,
    });
    expect(await runOn('2027-10-14')).toBe(1);
    expect(await runOn('2027-10-14')).toBe(0);
    expect(await runOn('2027-11-06')).toBe(1);
    expect(await runOn('2027-11-06')).toBe(0);
    expect(await rows('DUE_ITP')).toHaveLength(2);
  });

  it('resets the flags again when the date is changed and changed back', async () => {
    await reminders.setCarDue({
      accountId: driver,
      carId,
      dueOn: '2026-11-20',
      kind: 'itp',
      today: '2026-10-08',
    });
    await runOn('2026-10-21');
    expect(await reminder(carId)).toMatchObject({ sent30: true });
    for (const dueOn of ['2026-12-20', '2026-11-20']) {
      await reminders.setCarDue({
        accountId: driver,
        carId,
        dueOn,
        kind: 'itp',
        today: '2026-10-21',
      });
    }
    expect(await reminder(carId)).toMatchObject({
      sent7: false,
      sent30: false,
    });
    expect(await runOn('2026-10-21')).toBe(1);
  });
});

// @traces 092-FR-006
describe('the car events', () => {
  let driver: string;
  let carId: string;
  let sequence = 0;

  const updated = async (
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
    await saveDates(carId, after);
    return {
      id: String(sequence),
      kind: 'car.updated',
      payload: { carId, changed, ownerId: driver, ...after },
      subjectId: carId,
    };
  };
  const removed = () => {
    sequence += 1;
    return {
      id: String(sequence),
      kind: 'car.removed',
      payload: { carId, ownerId: driver },
      subjectId: carId,
    };
  };

  beforeEach(async () => {
    driver = await account('mihai');
    carId = await car(driver);
    notifications.now = MORNING('2026-10-08');
  });

  it('sets a reminder for each changed date, and none for the rest', async () => {
    await reminders.onCarEvent(
      await updated(['itpUntil', 'rcaUntil', 'odometerKm'], {
        itpUntil: '2027-11-13',
        rcaUntil: '2026-10-20',
        rovinietaUntil: '2027-03-01',
      }),
    );
    expect(await reminder(carId)).toMatchObject({
      accountId: driver,
      dueOn: new Date('2027-11-13T00:00:00Z'),
      sent7: false,
      sent30: false,
    });
    expect(await reminder(carId, 'rca')).toMatchObject({
      sent7: false,
      sent30: true,
    });
    expect(await prisma.reminder.count({ where: { carId } })).toBe(2);
  });

  it('moves a reminder to the new date and resets what was sent', async () => {
    await reminders.onCarEvent(
      await updated(['itpUntil'], { itpUntil: '2026-11-01' }),
    );
    await runOn('2026-10-08');
    expect(await reminder(carId)).toMatchObject({ sent30: true });

    await reminders.onCarEvent(
      await updated(['itpUntil'], { itpUntil: '2027-11-13' }),
    );
    expect(await reminder(carId)).toMatchObject({
      dueOn: new Date('2027-11-13T00:00:00Z'),
      sent7: false,
      sent30: false,
    });
  });

  it('cancels the reminder of a date that was cleared', async () => {
    await reminders.onCarEvent(
      await updated(['itpUntil', 'rcaUntil'], {
        itpUntil: '2026-11-01',
        rcaUntil: '2026-11-07',
      }),
    );
    await reminders.onCarEvent(
      await updated(['itpUntil'], { rcaUntil: '2026-11-07' }),
    );
    expect(
      await prisma.reminder.findMany({
        select: { kind: true },
        where: { carId },
      }),
    ).toEqual([{ kind: 'rca' }]);
    expect(await runOn('2026-10-08')).toBe(1);
    expect(await rows('DUE_ITP')).toHaveLength(0);
  });

  it('changes nothing for an edit of other fields', async () => {
    await reminders.onCarEvent(
      await updated(['odometerKm', 'plate'], { itpUntil: '2026-11-01' }),
    );
    expect(await prisma.reminder.count()).toBe(0);
  });

  it('gives the same rows when an event is delivered twice', async () => {
    const event = await updated(['rovinietaUntil'], {
      rovinietaUntil: '2026-12-01',
    });
    await reminders.onCarEvent(event);
    await reminders.onCarEvent(event);
    expect(await prisma.reminder.count({ where: { carId } })).toBe(1);
    expect(await reminder(carId, 'rovinieta')).toMatchObject({
      sent30: false,
    });
  });

  // @traces 092-FR-007
  it('removes every reminder of a removed car, twice over', async () => {
    await reminders.onCarEvent(
      await updated(['itpUntil', 'rcaUntil'], {
        itpUntil: '2026-11-01',
        rcaUntil: '2026-11-02',
      }),
    );
    await reminders.setTyres({ accountId: driver, carId });
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: carId },
    });
    const event = removed();
    await reminders.onCarEvent(event);
    await reminders.onCarEvent(event);
    expect(await prisma.reminder.count({ where: { carId } })).toBe(0);
  });

  // @traces 092-FR-007
  it('changes nothing for an edit of a car removed since', async () => {
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: carId },
    });
    await reminders.onCarEvent(
      await updated(['itpUntil'], { itpUntil: '2026-11-01' }),
    );
    expect(await prisma.reminder.count()).toBe(0);
  });

  it('changes nothing for a car that is not there', async () => {
    const event = await updated(['itpUntil'], { itpUntil: '2026-11-01' });
    event.payload.carId = randomUUID();
    event.subjectId = event.payload.carId;
    await reminders.onCarEvent(event);
    expect(await prisma.reminder.count()).toBe(0);
  });
});

// @traces 092-FR-007
describe('the daily run and a removed car', () => {
  let driver: string;
  let carId: string;

  beforeEach(async () => {
    driver = await account('radu');
    carId = await car(driver);
    await reminders.setCarDue({
      accountId: driver,
      carId,
      dueOn: '2026-12-10',
      kind: 'itp',
      today: '2026-10-01',
    });
  });

  it('skips a reminder whose car is removed', async () => {
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: carId },
    });
    expect(await runOn('2026-11-10')).toBe(0);
    expect(await rows('DUE_ITP')).toHaveLength(0);
  });

  it('sends nothing for a car removed between the read and the send', async () => {
    // The run reads its candidates, then the car is removed before it sends.
    const racing = new Proxy(prisma, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (key !== 'reminder') {
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return new Proxy(value, {
          get(delegate, name) {
            const inner = Reflect.get(delegate, name);
            if (name !== 'findMany') {
              return typeof inner === 'function' ? inner.bind(delegate) : inner;
            }
            return async (args: unknown) => {
              const found = await inner.call(delegate, args);
              await target.car.update({
                data: { removedAt: new Date() },
                where: { id: carId },
              });
              return found;
            };
          },
        });
      },
    });
    reminders = new RemindersService(racing, notifications);
    expect(await runOn('2026-11-10')).toBe(0);
    expect(await rows('DUE_ITP')).toHaveLength(0);
  });
});
