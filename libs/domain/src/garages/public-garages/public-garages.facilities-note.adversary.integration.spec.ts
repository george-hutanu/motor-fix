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

beforeEach(() => reset());

const read = (slug: string) =>
  request(app.getHttpServer()).get(`/garages/${slug}`);

const garage = (status: 'approved' | 'suspended') =>
  prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}`, status },
  });

const setNote = (id: string, value: string) =>
  prisma.$executeRaw`UPDATE garage SET facilities_note = ${value} WHERE id = ${id}::uuid`;

// @traces 330-FR-005
describe('the facilities note and list on the public profile', () => {
  it('serves a note of 200 astral characters exactly', async () => {
    const approved = await garage('approved');
    await setNote(approved.id, '\u{1F697}'.repeat(200));

    const res = await read(approved.slug);

    expect(res.body.facilitiesNote).toBe('\u{1F697}'.repeat(200));
  });

  it('serves markup in the note as the plain text it is', async () => {
    const approved = await garage('approved');
    await setNote(approved.id, '<b>Doar</b> & "la" programare');

    const res = await read(approved.slug);

    expect(res.body.facilitiesNote).toBe('<b>Doar</b> & "la" programare');
  });

  it('serves the note of a garage that lists no facility', async () => {
    const approved = await garage('approved');
    await setNote(approved.id, 'Doar la programare');

    const res = await read(approved.slug);

    expect(res.body).toMatchObject({
      facilities: [],
      facilitiesNote: 'Doar la programare',
    });
  });

  it('leaves out courtesy car terms the garage holds while the courtesy car is not listed', async () => {
    const approved = await garage('approved');
    await prisma.garageFacility.create({
      data: { facility: 'waiting_area', garageId: approved.id },
    });
    await prisma.$executeRaw`UPDATE garage SET courtesy_car_paid = true, courtesy_car_price_per_day_bani = 10000 WHERE id = ${approved.id}::uuid`;

    const res = await read(approved.slug);

    expect(res.body.facilities).toEqual(['waiting_area']);
    expect(res.body).not.toHaveProperty('courtesyCar');
  });
});

// @traces 330-FR-006
describe('a suspended garage on the public profile', () => {
  it('answers 410 with none of its facilities or note', async () => {
    const suspended = await garage('suspended');
    await prisma.garageFacility.create({
      data: { facility: 'pickup_dropoff', garageId: suspended.id },
    });
    await setNote(suspended.id, 'Preluare de la domiciliu');

    const res = await read(suspended.slug);

    expect(res.status).toBe(410);
    expect(JSON.stringify(res.body)).not.toMatch(/pickup_dropoff|domiciliu/);
  });
});
