// @traces 400-FR-007
import { randomUUID } from 'node:crypto';

import { todayInBucharest } from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';
import { type INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from './access-token';
import { AuthModule } from './auth.module';
import { serialDatabase } from './serial-db.testing';
import { addDays, atLocal } from '../bucharest';
import { GaragesModule } from '../garages/garages.module';
import { GarageFiguresModule } from '../insights/garage-figures/garage-figures.module';
import { BrevoMock } from '../notifications/brevo/brevo-mock.testing';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  databaseUrl,
  redisUrlFor,
  testConfig,
} from '../notifications/notifications.testing';
import { QuotesModule } from '../quotes/quotes.module';
import { quotesWorld } from '../quotes/quotes.testing';
import { ReviewsModule } from '../reviews/reviews.module';
import { UNUSED_STORAGE } from '../storage/s3-test-store';
import { StorageModule } from '../storage/storage.module';
import { WorkshopModule } from '../workshop/workshop.module';

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: INestApplication;

beforeAll(async () => {
  await brevo.start();
  const email = testConfig(brevo.url);
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    {
      databaseUrl,
      email,
      push: {
        privateKey: 'private',
        publicKey: 'public',
        subject: 'mailto:ops@example.test',
      },
      redisUrl,
    },
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
      GarageFiguresModule,
      QuotesModule,
      ReviewsModule,
      WorkshopModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await world.reset();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

const call = (method: Method, path: string, auth: string, body?: object) => {
  const req = request(app.getHttpServer())
    [method](path)
    .set('Authorization', auth)
    .set('Idempotency-Key', randomUUID());
  return body ? req.send(body) : req;
};

// A working day a week ahead, so every block and booking is in the future.
const DAY = addDays(todayInBucharest(), 7);
const at = (hour: number) => atLocal(DAY, hour).toISOString();

// One garage's ids the table's calls name.
async function garageOf(name: string) {
  const garage = await world.garage(name);
  await prisma.garage.update({
    data: { liftCount: 2 },
    where: { id: garage.id },
  });
  const owner = await world.account(`${name} Owner`, ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const fixer = await world.account(`${name} Fixer`, ['mechanic']);
  const card = await prisma.mechanic.create({
    data: { accountId: fixer, garageId: garage.id, name: 'Fixer' },
  });
  const desk = await world.account(`${name} Desk`, ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: desk, garageId: garage.id, role: 'receptionist' },
  });
  const booking = await world.booked(garage.id, at(9), 'confirmed', {
    mechanicId: card.id,
  });
  const job = await world.job(booking.id, 'to_do', { mechanicId: card.id });
  const asked = await world.booked(garage.id, at(14), 'awaiting_confirmation');
  const review = await prisma.review.create({
    data: {
      driverId: booking.driverId,
      garageId: garage.id,
      jobId: job.id,
      rating: 4,
      text: 'Bine',
    },
  });
  const driver = await world.account(`${name} Driver`);
  const req = await world.request(driver);
  await world.recipient(req.id, garage.id);
  const jobType = await world.jobType(`${name} ulei`, `${name} oil`);
  return { asked, card, desk, fixer, garage, job, jobType, owner, req, review };
}

type Garage = Awaited<ReturnType<typeof garageOf>>;
type Row = { name: string; method: Method; path: string; body?: object };

// The calls she may make on garage `g`. "Bookings" is the week's schedule,
// "a day sheet" the schedule of one mechanic's day: the API's reads of both.
const allowed = (g: Garage): Row[] => [
  { method: 'get', name: 'requests inbox', path: '/garage/requests' },
  {
    method: 'get',
    name: 'schedule',
    path: `/garages/${g.garage.id}/schedule`,
  },
  {
    method: 'get',
    name: 'bookings',
    path: `/garages/${g.garage.id}/schedule?from=${DAY}&to=${addDays(DAY, 6)}`,
  },
  { method: 'get', name: 'jobs list', path: '/garage/jobs' },
  {
    method: 'get',
    name: 'reviews read',
    path: `/garages/${g.garage.id}/reviews`,
  },
  {
    method: 'get',
    name: 'profile read',
    path: `/garages/${g.garage.id}/profile`,
  },
  {
    method: 'get',
    name: 'audit history',
    path: `/audit-history?garageId=${g.garage.id}`,
  },
  {
    method: 'get',
    name: 'garage figures',
    path: `/garages/${g.garage.id}/figures/weekly`,
  },
  {
    method: 'get',
    name: 'day sheet',
    path: `/garages/${g.garage.id}/schedule?from=${DAY}&to=${DAY}&mechanicId=${g.card.id}`,
  },
  {
    method: 'get',
    name: 'confirm options',
    path: `/bookings/${g.asked.id}/confirm-options`,
  },
  {
    body: { endsAt: at(12), lift: 1, startsAt: at(11) },
    method: 'post',
    name: 'time block on a lift',
    path: `/garages/${g.garage.id}/time-blocks`,
  },
];

// The calls outside her scope on garage `g`.
const forbidden = (g: Garage): Row[] => [
  {
    body: { jobTypeId: g.jobType.id },
    method: 'post',
    name: 'price list write',
    path: `/garages/${g.garage.id}/prices`,
  },
  {
    body: { description: 'Service de familie' },
    method: 'patch',
    name: 'profile write',
    path: `/garages/${g.garage.id}/profile`,
  },
  {
    method: 'post',
    name: 'job stage move to in progress',
    path: `/garage/jobs/${g.job.id}/start`,
  },
  {
    body: { text: 'Schimb filtru' },
    method: 'post',
    name: 'job step',
    path: `/garage/jobs/${g.job.id}/steps`,
  },
  {
    body: { text: 'Mulțumim!' },
    method: 'post',
    name: 'review reply',
    path: `/reviews/${g.review.id}/reply`,
  },
  {
    body: { reason: 'insults' },
    method: 'post',
    name: 'review report',
    path: `/reviews/${g.review.id}/reports`,
  },
  {
    method: 'get',
    name: 'members read',
    path: `/garages/${g.garage.id}/members`,
  },
  {
    method: 'delete',
    name: 'members removal',
    path: `/garages/${g.garage.id}/members/${g.desk}`,
  },
  {
    method: 'get',
    name: 'mechanics list',
    path: `/garages/${g.garage.id}/mechanics`,
  },
  {
    body: {
      email: 'nou@example.test',
      kind: 'mechanic',
      name: 'Ion Nou',
    },
    method: 'post',
    name: 'staff invite send',
    path: `/garages/${g.garage.id}/invites`,
  },
  {
    body: { enabled: false },
    method: 'put',
    name: 'feature switch',
    path: `/garages/${g.garage.id}/features/team_mechanics`,
  },
  {
    body: { paymentMethods: { card: true, cash: true, transfer: false } },
    method: 'patch',
    name: 'settings write',
    path: `/garages/${g.garage.id}`,
  },
];

// Her own garage's session-scoped reads, named by the other garage's ids.
const foreignReads = (g: Garage): Row[] => [
  {
    method: 'get',
    name: 'requests inbox',
    path: `/garage/requests/${g.req.id}`,
  },
  { method: 'get', name: 'jobs list', path: `/garage/jobs/${g.job.id}` },
];

// Each row's answer as one line, so a failure names every row that moved.
// A 403 carries its code; a 404's body is the API problem filter's to word
// (a bare NotFoundException becomes `not_found` there).
const answers = async (rows: Row[], auth: string) => {
  const lines: string[] = [];
  for (const row of rows) {
    const res = await call(row.method, row.path, auth, row.body);
    const ok = res.status >= 200 && res.status < 300;
    lines.push(
      `${row.name}: ${ok ? '2xx' : res.status}${res.status === 403 ? ` ${res.body.code}` : ''}`,
    );
  }
  return lines;
};
const each = (rows: Row[], outcome: string) =>
  rows.map((row) => `${row.name}: ${outcome}`);

describe("a receptionist's scope on her own garage", () => {
  it('answers each of the 11 allowed calls 2xx', async () => {
    const a = await garageOf('Atelier Alfa');
    const desk = bearer(a.desk, 'receptionist');

    expect(await answers(allowed(a), desk)).toEqual(each(allowed(a), '2xx'));
  });

  it('answers each of the 12 calls outside her scope 403 forbidden, and writes nothing', async () => {
    const a = await garageOf('Atelier Alfa');
    const desk = bearer(a.desk, 'receptionist');

    expect(await answers(forbidden(a), desk)).toEqual(
      each(forbidden(a), '403 forbidden'),
    );
    expect(
      await prisma.garageMember.count({ where: { accountId: a.desk } }),
    ).toBe(1);
    expect(
      await prisma.job.findUniqueOrThrow({ where: { id: a.job.id } }),
    ).toMatchObject({ status: 'to_do' });
  });
});

describe("a receptionist's scope on another garage", () => {
  it('answers every allowed and forbidden call on its ids 404, never 403', async () => {
    const a = await garageOf('Atelier Alfa');
    const b = await garageOf('Atelier Beta');
    const desk = bearer(a.desk, 'receptionist');
    // Her own session-scoped lists have no other garage to name: the
    // other garage's request and job by id stand for them.
    const rows = [
      ...allowed(b).filter(
        (row) => !['/garage/requests', '/garage/jobs'].includes(row.path),
      ),
      ...foreignReads(b),
      ...forbidden(b),
    ];

    expect(await answers(rows, desk)).toEqual(each(rows, '404'));
  });
});

// @traces 400-FR-003
describe('a receptionist after the owner removed her', () => {
  it('answers each of the 11 allowed calls 404, never 403', async () => {
    const a = await garageOf('Atelier Alfa');
    const desk = bearer(a.desk, 'receptionist');
    const removed = await call(
      'delete',
      `/garages/${a.garage.id}/members/${a.desk}`,
      bearer(a.owner, 'garage'),
    );
    expect(removed.status).toBe(204);

    expect(await answers(allowed(a), desk)).toEqual(each(allowed(a), '404'));
  });

  it('leaves the other receptionist of a garage her scope', async () => {
    const a = await garageOf('Atelier Alfa');
    const other = await world.account('Alfa Second Desk', ['receptionist']);
    await prisma.garageMember.create({
      data: { accountId: other, garageId: a.garage.id, role: 'receptionist' },
    });
    await call(
      'delete',
      `/garages/${a.garage.id}/members/${a.desk}`,
      bearer(a.owner, 'garage'),
    );

    const res = await call(
      'get',
      '/garage/requests',
      bearer(other, 'receptionist'),
    );

    expect(res.status).toBe(200);
  });
});
