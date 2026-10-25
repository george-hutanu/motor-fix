import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(2);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({
    databaseUrl,
    redisUrl,
    tokenSecret: 'test-secret',
  });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      StorageModule.register(UNUSED_STORAGE),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
});

const read = (slug: string) =>
  request(app.getHttpServer()).get(`/garages/${slug}`);

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bucharest',
}).format(new Date());
const plus = (days: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
const date = (day: string) => new Date(`${day}T00:00:00Z`);

const approved = () =>
  prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
    },
  });

const closedDay = (garageId: string, day: string, note?: string) =>
  prisma.garageClosedDay.create({ data: { day: date(day), garageId, note } });

// The calendar's own rows stay; only the days a test adds go again.
const added: string[] = [];
const holidayOn = async (day: string) => {
  const existing = await prisma.publicHoliday.findUnique({
    where: { day: date(day) },
  });
  if (existing) return;
  await prisma.publicHoliday.create({
    data: { day: date(day), nameEn: 'Test day', nameRo: 'Zi de test' },
  });
  added.push(day);
};

afterEach(async () => {
  await prisma.publicHoliday.deleteMany({
    where: { day: { in: added.splice(0).map(date) } },
  });
});

const realHolidays = async () =>
  (
    await prisma.publicHoliday.findMany({
      where: { day: { gte: date(today), lte: date(plus(14)) } },
    })
  ).map((row) => row.day.toISOString().slice(0, 10));

// @traces 309-FR-006 309-FR-007
describe('the closed days a profile carries', () => {
  it('lists the holidays and the closed days of the next fourteen days, in date order', async () => {
    const garage = await approved();
    await closedDay(garage.id, plus(3), 'Inventar');
    await closedDay(garage.id, plus(1));
    await holidayOn(plus(5));

    const res = await read(garage.slug);

    expect(res.status).toBe(200);
    const days = res.body.closedDays as { day: string; reason: string }[];
    expect(days).toEqual([...days].sort((a, b) => a.day.localeCompare(b.day)));
    expect(days).toEqual(
      expect.arrayContaining([
        { day: plus(1), reason: 'closed' },
        { day: plus(3), reason: 'closed' },
        { day: plus(5), reason: 'holiday' },
      ]),
    );
    expect(JSON.stringify(res.body.closedDays)).not.toContain('Inventar');
  });

  it('leaves out a closed day past the fourteenth and one before today', async () => {
    const garage = await approved();
    await closedDay(garage.id, plus(14));
    await closedDay(garage.id, plus(15));
    await closedDay(garage.id, plus(-1));

    const res = await read(garage.slug);

    const days = (res.body.closedDays as { day: string }[]).map((d) => d.day);
    expect(days).toContain(plus(14));
    expect(days).not.toContain(plus(15));
    expect(days).not.toContain(plus(-1));
  });

  it('gives a holiday that is also a closed day once, as the holiday', async () => {
    const garage = await approved();
    await holidayOn(plus(2));
    await closedDay(garage.id, plus(2));

    const res = await read(garage.slug);

    expect(
      (res.body.closedDays as { day: string }[]).filter(
        (d) => d.day === plus(2),
      ),
    ).toEqual([{ day: plus(2), reason: 'holiday' }]);
  });

  it('carries only the calendar holidays for a garage with no closed day', async () => {
    const garage = await approved();
    const holidays = await realHolidays();

    const res = await read(garage.slug);

    expect(res.body.closedDays).toEqual(
      holidays.sort().map((day) => ({ day, reason: 'holiday' })),
    );
  });

  it('answers the same list from the cache on a second read', async () => {
    const garage = await approved();
    await closedDay(garage.id, plus(4));

    const first = await read(garage.slug);
    const second = await read(garage.slug);

    expect(second.body.closedDays).toEqual(first.body.closedDays);
    expect(first.body.closedDays).toContainEqual({
      day: plus(4),
      reason: 'closed',
    });
  });
});
