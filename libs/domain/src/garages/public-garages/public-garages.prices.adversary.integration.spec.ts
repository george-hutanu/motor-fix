import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { purgeAudience } from '../../cache/purge';
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
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
const other = new Redis(redisUrl);

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
  other.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  sharedOwner = undefined;
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE job_type CASCADE');
});

const get = (slug: string, brand?: string) =>
  request(app.getHttpServer()).get(
    `/garages/${slug}${brand === undefined ? '' : `?brand=${brand}`}`,
  );

const brand = (name: string) => {
  const slug = `${name.toLowerCase()}-${randomUUID()}`;
  return prisma.brand.create({
    data: { active: true, key: slug, name, popularity: null, slug },
  });
};

const jobType = (nameRo: string, status: 'approved' | 'pending' = 'approved') =>
  prisma.jobType.create({
    data: {
      key: `job-${randomUUID()}`,
      nameEn: `${nameRo} en`,
      nameRo,
      status,
    },
  });

let sharedOwner: string | undefined;

async function setup(garage: Record<string, unknown> = {}) {
  const created = await prisma.garage.create({
    data: {
      name: 'Service Auto Militari',
      slug: `militari-${randomUUID()}`,
      status: 'approved',
      ...garage,
    },
  });
  sharedOwner ??= await account('owner', ['garage']);
  const owner = sharedOwner;
  const price = (
    jobTypeId: string,
    position: number,
    extra: Record<string, unknown> = {},
    garageId = created.id,
  ) =>
    prisma.garagePrice.create({
      data: {
        fromBani: 15_000,
        garageId,
        jobTypeId,
        position,
        toBani: 22_000,
        updatedBy: owner,
        ...extra,
      },
    });
  return { garage: created, price };
}

const stance = (
  garageId: string,
  brandId: string,
  value: 'works_on' | 'does_not_take',
) =>
  prisma.garageBrand.create({
    data: {
      brandId,
      diesel: value === 'works_on',
      electric: value === 'works_on',
      garageId,
      hybrid: value === 'works_on',
      petrol: value === 'works_on',
      stance: value,
    },
  });

const tick = async (garageId: string, brandId: string, jobTypeId: string) => {
  const known = await prisma.garageBrand.findFirst({
    where: { brandId, garageId },
  });
  if (!known) await stance(garageId, brandId, 'works_on');
  await prisma.garageBrandJob.create({
    data: { brandId, garageId, jobTypeId },
  });
};

const ids = (body: { prices: { jobTypeId: string }[] }) =>
  body.prices.map((p) => p.jobTypeId);

// @traces 355-FR-001
describe('the price list on the wire', () => {
  it('carries only the contract fields of each row, never the stored price row', async () => {
    const { garage, price } = await setup({
      labourFromBani: 100,
      labourToBani: 200,
    });
    const job = await jobType('Diagnoză');
    await price(job.id, 3, { durationMinutes: 30 });

    const res = await get(garage.slug);

    expect(Object.keys(res.body.prices[0]).sort()).toEqual([
      'durationMinutes',
      'fromBani',
      'jobTypeId',
      'nameEn',
      'nameRo',
      'toBani',
    ]);
    expect(Object.keys(res.body.labour).sort()).toEqual(['fromBani', 'toBani']);
  });

  it('carries no price list on a suspended or unknown garage', async () => {
    const { garage } = await setup({ status: 'suspended' });

    const res = await get(garage.slug);

    expect(res.status).toBe(410);
    expect(res.body).not.toHaveProperty('prices');
    expect((await get('nu-exista')).body).not.toHaveProperty('prices');
  });

  it('does not list a job whose catalogue entry is pending, brand range or not', async () => {
    const bmw = await brand('BMW');
    const { garage, price } = await setup();
    const pending = await jobType('În așteptare', 'pending');
    await price(pending.id, 0);
    await price(pending.id, 0, { brandId: bmw.id, fromBani: 1, toBani: 2 });

    expect(ids((await get(garage.slug, bmw.slug)).body)).toEqual([]);
    expect(ids((await get(garage.slug)).body)).toEqual([]);
  });

  it('does not list a job the garage hid, even with a complete visible brand range', async () => {
    const bmw = await brand('BMW');
    const { garage, price } = await setup();
    const job = await jobType('Ascuns');
    await price(job.id, 0, { visible: false });
    await price(job.id, 0, { brandId: bmw.id, fromBani: 1, toBani: 2 });

    expect(ids((await get(garage.slug, bmw.slug)).body)).toEqual([]);
  });

  it('shows a reversed default range as stored', async () => {
    const { garage, price } = await setup();
    const job = await jobType('Invers');
    await price(job.id, 0, { fromBani: 22_000, toBani: 15_000 });

    const [row] = (await get(garage.slug)).body.prices;

    expect([row.fromBani, row.toBani]).toEqual([22_000, 15_000]);
  });
});

// @traces 355-FR-003
describe('the brand ticks on the price list', () => {
  it('lists the ticked jobs for a brand the garage does not take', async () => {
    const dacia = await brand('Dacia');
    const { garage, price } = await setup();
    const a = await jobType('A');
    const b = await jobType('B');
    await price(a.id, 0);
    await price(b.id, 1);
    await stance(garage.id, dacia.id, 'does_not_take');
    await tick(garage.id, dacia.id, b.id);

    expect(ids((await get(garage.slug, dacia.slug)).body)).toEqual([b.id]);
  });

  it('keeps the default ranges for a brand the garage does not take', async () => {
    const dacia = await brand('Dacia');
    const { garage, price } = await setup();
    const a = await jobType('A');
    await price(a.id, 0);
    await price(a.id, 0, {
      brandId: dacia.id,
      fromBani: 110_000,
      toBani: 170_000,
    });
    await stance(garage.id, dacia.id, 'does_not_take');

    const [row] = (await get(garage.slug, dacia.slug)).body.prices;
    expect([row?.fromBani, row?.toBani]).toEqual([15_000, 22_000]);
  });

  it('is not filtered by ticks the garage recorded for another brand', async () => {
    const bmw = await brand('BMW');
    const audi = await brand('Audi');
    const { garage, price } = await setup();
    const a = await jobType('A');
    const b = await jobType('B');
    await price(a.id, 0);
    await price(b.id, 1);
    await tick(garage.id, bmw.id, a.id);

    expect(ids((await get(garage.slug, audi.slug)).body)).toEqual([a.id, b.id]);
    expect(ids((await get(garage.slug, bmw.slug)).body)).toEqual([a.id]);
  });

  it('is not filtered by ticks another garage recorded for the brand', async () => {
    const bmw = await brand('BMW');
    const { garage, price } = await setup();
    const other = await setup();
    const a = await jobType('A');
    const b = await jobType('B');
    await price(a.id, 0);
    await price(b.id, 1);
    await other.price(a.id, 0);
    await tick(other.garage.id, bmw.id, a.id);

    expect(ids((await get(garage.slug, bmw.slug)).body)).toEqual([a.id, b.id]);
  });

  it('lists nothing for a brand whose only tick is a job the garage hides', async () => {
    const bmw = await brand('BMW');
    const { garage, price } = await setup();
    const shown = await jobType('Shown');
    const hidden = await jobType('Hidden');
    await price(shown.id, 0);
    await price(hidden.id, 1, { visible: false });
    await tick(garage.id, bmw.id, hidden.id);

    expect((await get(garage.slug, bmw.slug)).body.prices).toEqual([]);
  });
});

// @traces 355-FR-005
describe('the price list through the profile cache', () => {
  it('serves each brand its own range from a warm cache, in any order', async () => {
    const bmw = await brand('BMW');
    const audi = await brand('Audi');
    const { garage, price } = await setup();
    await stance(garage.id, bmw.id, 'works_on');
    const job = await jobType('Frâne');
    await price(job.id, 0, { fromBani: 89_000, toBani: 140_000 });
    await price(job.id, 0, {
      brandId: bmw.id,
      fromBani: 110_000,
      toBani: 170_000,
    });

    const seen: number[] = [];
    for (const q of [
      bmw.slug,
      audi.slug,
      undefined,
      bmw.slug,
      undefined,
      audi.slug,
    ]) {
      seen.push((await get(garage.slug, q)).body.prices[0].fromBani);
    }

    expect(seen).toEqual([110_000, 89_000, 89_000, 110_000, 89_000, 89_000]);
  });

  it('shows the new range once the profile is dropped, for every brand cached', async () => {
    const bmw = await brand('BMW');
    const { garage, price } = await setup();
    const job = await jobType('Frâne');
    const row = await price(job.id, 0, { fromBani: 89_000, toBani: 140_000 });
    await get(garage.slug);
    await get(garage.slug, bmw.slug);

    await prisma.garagePrice.update({
      data: { fromBani: 90_000 },
      where: { id: row.id },
    });
    await purgeAudience(other, [`public:garage:${garage.id}`]);

    expect((await get(garage.slug)).body.prices[0].fromBani).toBe(90_000);
    expect((await get(garage.slug, bmw.slug)).body.prices[0].fromBani).toBe(
      90_000,
    );
  });

  it('caches the list under the current shape version only', async () => {
    const { garage, price } = await setup();
    const job = await jobType('Diagnoză');
    await price(job.id, 0);

    await get(garage.slug);

    const stored = JSON.parse(
      (await other.get(`v1:profile:${garage.slug}:-`)) ?? 'null',
    );
    expect(stored.v.prices).toHaveLength(1);
  });
});
