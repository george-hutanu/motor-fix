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

const OPEN = [['08:00', '19:00']];
const WEEK = {
  fri: OPEN,
  mon: OPEN,
  sat: [['09:00', '14:00']],
  sun: [],
  thu: OPEN,
  tue: OPEN,
  wed: OPEN,
};

const approved = (data: Record<string, unknown> = {}) =>
  prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
      ...data,
    },
  });

// @traces 308-FR-001
describe('the opening hours a profile carries, under hostile stored values', () => {
  it.each([
    ['an eighth key beside the week', { ...WEEK, holiday: OPEN }],
    [
      'three intervals in a day',
      {
        ...WEEK,
        mon: [
          ['06:00', '08:00'],
          ['09:00', '12:00'],
          ['13:00', '19:00'],
        ],
      },
    ],
    [
      'a time off the quarter-hour grid',
      { ...WEEK, mon: [['08:07', '19:00']] },
    ],
    ['the time 24:00', { ...WEEK, mon: [['08:00', '24:00']] }],
    [
      'an interval of three times',
      { ...WEEK, mon: [['08:00', '12:00', '13:00']] },
    ],
    ['a day set to null', { ...WEEK, mon: null }],
    ['a day set to a string', { ...WEEK, mon: '08:00-19:00' }],
    ['an interval with equal ends', { ...WEEK, mon: [['08:00', '08:00']] }],
    ['numbers in place of times', { ...WEEK, mon: [[800, 1900]] }],
  ])('carries an empty table for stored hours with %s', async (_, hours) => {
    const garage = await approved({ hours });

    const res = await read(garage.slug);

    expect(res.status).toBe(200);
    expect(res.body.hours).toEqual({});
  });

  it('carries an empty table for a stored JSON null as for no value', async () => {
    const garage = await approved();
    await prisma.$executeRaw`UPDATE garage SET hours = 'null'::jsonb WHERE id = ${garage.id}::uuid`;

    const res = await read(garage.slug);

    expect(res.status).toBe(200);
    expect(res.body.hours).toEqual({});
  });

  it('carries a week of seven closed days as seven empty lists, not as no hours', async () => {
    const closed = {
      fri: [],
      mon: [],
      sat: [],
      sun: [],
      thu: [],
      tue: [],
      wed: [],
    };
    const garage = await approved({ hours: closed });

    const res = await read(garage.slug);

    expect(res.body.hours).toEqual(closed);
  });
});

// @traces 308-FR-002
// @traces 308-FR-013
describe('what a profile says of the address and hours of a garage it will not show', () => {
  it('serves a workshop address as written, markup characters and accents kept', async () => {
    const address = 'Str. Școlii nr. 3 <bl. A> & "ap. 5",  Cluj-Napoca ț';
    const garage = await approved({ address, businessKind: 'company' });

    const res = await read(garage.slug);

    expect(res.body.address).toBe(address);
  });

  it('answers a suspended garage with 410 and neither its hours nor its address', async () => {
    const garage = await approved({
      address: 'Strada Secretă 1',
      hours: WEEK,
      status: 'suspended',
    });

    const res = await read(garage.slug);

    expect(res.status).toBe(410);
    expect(JSON.stringify(res.body)).not.toMatch(/Secretă|08:00|hours/);
  });

  it('answers a draft garage as an unknown slug, its hours unseen', async () => {
    const garage = await approved({ hours: WEEK, status: 'draft' });

    const res = await read(garage.slug);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/08:00|hours/);
  });

  it('gives a mobile mechanic with hours no address key at all', async () => {
    const mobile = await approved({
      businessKind: 'mobile',
      hours: WEEK,
      mobileLegalForm: 'pfa',
      seatAddress: 'Sediu 7, Otopeni',
    });

    const res = await read(mobile.slug);

    expect(res.body.hours).toEqual(WEEK);
    expect(Object.keys(res.body)).not.toContain('address');
    expect(Object.keys(res.body)).not.toContain('seatAddress');
  });
});
