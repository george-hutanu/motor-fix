import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { GaragesModule } from './garages.module';
import { AuthModule } from '../auth/auth.module';
import { serialDatabase } from '../auth/serial-db.testing';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(2);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const SEAT = 'Strada Sediului Secret 77, Ploiești';
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

beforeEach(() => reset());

const read = (slug: string) =>
  request(app.getHttpServer()).get(`/garages/${slug}`);

const slug = () => `g-${randomUUID()}`;

describe('the public garage read and the registered seat', () => {
  it('never prints the seat for a mobile mechanic, in any spelling of the body', async () => {
    const created = await prisma.garage.create({
      data: {
        businessKind: 'mobile',
        latitude: 44.9365,
        longitude: 26.0129,
        mobileLegalForm: 'pfa',
        name: 'Mecanic la domiciliu',
        seatAddress: SEAT,
        serviceRadiusKm: 100,
        slug: slug(),
        status: 'approved',
      },
    });

    const res = await read(created.slug);

    const raw = res.text.toLowerCase();
    expect(res.body.serviceRadiusKm).toBe(100);
    expect(raw).not.toContain('sediului');
    expect(raw).not.toContain('seat');
    expect(raw).not.toContain('44.9365');
    expect(raw).not.toContain('26.0129');
    expect(raw).not.toContain('latitude');
  });

  it('keeps the seat out when a former mobile mechanic became a workshop with the old seat still on the row', async () => {
    const created = await prisma.garage.create({
      data: {
        businessKind: 'company',
        latitude: 44.9365,
        longitude: 26.0129,
        name: 'Fost mobil',
        seatAddress: SEAT,
        serviceRadiusKm: 35,
        slug: slug(),
        status: 'approved',
      },
    });

    const res = await read(created.slug);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Sediului');
    expect(res.body).not.toHaveProperty('seatAddress');
    expect(res.body).not.toHaveProperty('serviceRadiusKm');
  });

  it('keeps the position out when a former workshop became a mobile mechanic with the old address on the row', async () => {
    const created = await prisma.garage.create({
      data: {
        address: 'Strada Veche 1, București',
        businessKind: 'mobile',
        latitude: 44.4268,
        longitude: 26.1025,
        mobileLegalForm: 'pfa',
        name: 'Fost atelier',
        serviceRadiusKm: 20,
        slug: slug(),
        status: 'approved',
      },
    });

    const res = await read(created.slug);

    expect(res.text).not.toContain('Veche');
    for (const key of ['address', 'latitude', 'longitude']) {
      expect(res.body).not.toHaveProperty(key);
    }
    expect(res.body.serviceRadiusKm).toBe(20);
  });

  it('shows a mobile mechanic with no place yet as no radius, address or position', async () => {
    const created = await prisma.garage.create({
      data: {
        businessKind: 'mobile',
        mobileLegalForm: 'pfa',
        name: 'Fără loc',
        slug: slug(),
        status: 'approved',
      },
    });

    const res = await read(created.slug);

    for (const key of ['address', 'latitude', 'longitude']) {
      expect(res.body[key] ?? null).toBeNull();
    }
    expect(res.body.serviceRadiusKm ?? null).toBeNull();
  });

  it.each([
    ['draft', 404],
    ['suspended', 410],
  ] as const)(
    'refuses a %s garage that has a place and names none of it',
    async (status, code) => {
      const created = await prisma.garage.create({
        data: {
          address: 'Strada Ascunsă 5, București',
          businessKind: 'company',
          latitude: 44.4,
          longitude: 26.1,
          name: 'Ascuns',
          slug: slug(),
          status,
        },
      });

      const res = await read(created.slug);

      expect(res.status).toBe(code);
      expect(res.text).not.toContain('Ascunsă');
    },
  );

  it('shows a workshop address and position together or not at all', async () => {
    const created = await prisma.garage.create({
      data: {
        address: 'Strada Ștefan cel Mare 12, București',
        businessKind: 'company',
        latitude: 43.5,
        longitude: 29.8,
        name: 'La marginea hărții',
        slug: slug(),
        status: 'approved',
      },
    });

    const res = await read(created.slug);

    expect(res.body).toMatchObject({
      address: 'Strada Ștefan cel Mare 12, București',
      latitude: 43.5,
      longitude: 29.8,
    });
  });

  it('answers the same twice', async () => {
    const created = await prisma.garage.create({
      data: {
        address: 'Strada Exemplu 1, București',
        businessKind: 'company',
        latitude: 44.4268,
        longitude: 26.1025,
        name: 'Stabil',
        slug: slug(),
        status: 'approved',
      },
    });

    expect((await read(created.slug)).body).toEqual(
      (await read(created.slug)).body,
    );
  });

  it('is held by the database against a row with both a public address and a seat', async () => {
    await expect(
      prisma.garage.create({
        data: {
          address: 'A 1',
          businessKind: 'mobile',
          mobileLegalForm: 'pfa',
          name: 'Dublu',
          seatAddress: 'B 2',
          slug: slug(),
          status: 'approved',
        },
      }),
    ).rejects.toThrow();
  });

  it.each([
    ['an empty address', { address: '' }],
    ['an address over 200 characters', { address: 'x'.repeat(201) }],
    ['a radius of 0', { serviceRadiusKm: 0 }],
    ['a radius of 101', { serviceRadiusKm: 101 }],
    ['a latitude of 91', { latitude: 91, longitude: 26 }],
    ['a longitude of 181', { latitude: 44, longitude: 181 }],
    ['a latitude with no longitude', { latitude: 44.4 }],
  ])('is held by the database against %s', async (_, data) => {
    await expect(
      prisma.garage.create({
        data: {
          businessKind: 'company',
          name: 'Invalid',
          slug: slug(),
          status: 'draft',
          ...data,
        },
      }),
    ).rejects.toThrow();
  });
});
