import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { dropProfiles } from './public-garages.cache';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import { GaragesModule } from '../garages.module';

// @traces 310-FR-001 310-FR-002 310-FR-003 310-FR-013

const redisUrl = redisUrlFor(2);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const store = new S3TestStore();
const other = new Redis(redisUrl);
let app: NestExpressApplication;
let storage: StorageService;

beforeAll(async () => {
  await store.start();
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
      StorageModule.register(store.env()),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  await app.init();
  storage = app.get(StorageService);
});

afterAll(async () => {
  await app.close();
  await store.stop();
  other.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  store.objects.clear();
  jest.restoreAllMocks();
});

const read = (slug: string) =>
  request(app.getHttpServer()).get(`/garages/${slug}`);

const approved = () =>
  prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
    },
  });

const keyOf = (garageId: string) => `garage_photo/${garageId}/${randomUUID()}`;

// A processed photo: its row carries the size and both copies are stored.
async function photo(
  garageId: string,
  position: number,
  size: { height: number | null; width: number | null } = {
    height: 900,
    width: 1200,
  },
  copies = true,
) {
  const fileKey = keyOf(garageId);
  if (copies) {
    store.put(`${fileKey}.thumb`, Buffer.from('thumb'), 'image/jpeg', {
      height: '600',
      width: '800',
    });
    store.put(`${fileKey}.display`, Buffer.from('display'), 'image/jpeg');
  }
  return prisma.garagePhoto.create({
    data: { fileKey, garageId, position, ...size },
  });
}

interface Photo {
  displayUrl: string;
  height?: number;
  id: string;
  thumbnailUrl: string;
  width?: number;
}

const photosOf = async (slug: string, query = '') =>
  ((await read(slug + query)).body.photos ?? []) as Photo[];

describe('the photos of a public garage profile under hostile conditions', () => {
  it('lists all twenty photos in position order', async () => {
    const garage = await approved();
    const ids: string[] = [];
    for (let position = 0; position < 20; position++) {
      ids.push((await photo(garage.id, position)).id);
    }

    expect((await photosOf(garage.slug)).map(({ id }) => id)).toEqual(ids);
  });

  it('answers the same order twice in a row', async () => {
    const garage = await approved();
    await photo(garage.id, 1);
    await photo(garage.id, 0);

    const first = (await photosOf(garage.slug)).map(({ id }) => id);
    await dropProfiles(other, [`public:garage:${garage.id}`]);
    const second = (await photosOf(garage.slug)).map(({ id }) => id);

    expect(second).toEqual(first);
  });

  it('answers the same photos whatever brand the profile is read for', async () => {
    const garage = await approved();
    await photo(garage.id, 0);
    await photo(garage.id, 1);

    const plain = (await photosOf(garage.slug)).map(({ id }) => id);
    const branded = (await photosOf(garage.slug, '?brand=dacia')).map(
      ({ id }) => id,
    );

    expect(branded).toEqual(plain);
    expect(branded).toHaveLength(2);
  });

  it('never lists the photos of another garage', async () => {
    const mine = await approved();
    const theirs = await approved();
    const own = await photo(mine.id, 0);
    await photo(theirs.id, 0);
    await photo(theirs.id, 1);

    expect((await photosOf(mine.slug)).map(({ id }) => id)).toEqual([own.id]);
  });

  it('answers no photos for a garage that is not approved', async () => {
    const garage = await prisma.garage.create({
      data: {
        name: 'Pending',
        slug: `pending-${randomUUID()}`,
        status: 'draft',
      },
    });
    await photo(garage.id, 0);

    const res = await read(garage.slug);

    expect([404, 410]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain('thumbnailUrl');
  });

  it('keeps an unsized photo whose thumbnail carries no size, without a null size', async () => {
    const garage = await approved();
    const fileKey = keyOf(garage.id);
    store.put(`${fileKey}.thumb`, Buffer.from('thumb'), 'image/jpeg');
    store.put(`${fileKey}.display`, Buffer.from('display'), 'image/jpeg');
    const row = await prisma.garagePhoto.create({
      data: {
        fileKey,
        garageId: garage.id,
        height: null,
        position: 0,
        width: null,
      },
    });

    const [answered] = await photosOf(garage.slug);

    expect(answered.id).toBe(row.id);
    expect(answered.width ?? undefined).toBeUndefined();
    expect(answered.height ?? undefined).toBeUndefined();
    expect('width' in answered ? answered.width : undefined).not.toBeNull();
  });

  it('leaves out an unsized photo when storage cannot be asked, and still answers the profile', async () => {
    const garage = await approved();
    const ready = await photo(garage.id, 0);
    await photo(garage.id, 1, { height: null, width: null });
    jest
      .spyOn(storage, 'metadataOf')
      .mockRejectedValue(new Error('storage down'));

    const res = await read(garage.slug);

    expect(res.status).toBe(200);
    expect((res.body.photos as Photo[]).map(({ id }) => id)).toEqual([
      ready.id,
    ]);
  });

  it('serves nothing but the thumbnail and display copies, never the bare key', async () => {
    const garage = await approved();
    const row = await photo(garage.id, 0);

    const [answered] = await photosOf(garage.slug);

    for (const url of [answered.thumbnailUrl, answered.displayUrl]) {
      const path = decodeURIComponent(new URL(url).pathname);
      expect(path).toMatch(/\.(thumb|display)$/);
      expect(path.endsWith(row.fileKey)).toBe(false);
    }
    expect(answered.thumbnailUrl).not.toBe(answered.displayUrl);
  });

  it('shows no photos array that is null or missing for a garage with only unprocessed photos', async () => {
    const garage = await approved();
    await photo(garage.id, 0, { height: null, width: null }, false);
    await photo(garage.id, 1, { height: null, width: null }, false);

    const res = await read(garage.slug);

    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual([]);
  });

  it('does not answer a stale older cached shape without photos', async () => {
    const garage = await approved();
    await photo(garage.id, 0);
    await other.set(
      `garage-profile-slug:v2:${garage.slug}`,
      JSON.stringify({ id: garage.id, name: 'stale', slug: garage.slug }),
    );
    await other.set(
      `garage-profile:v2:${garage.id}`,
      JSON.stringify({ id: garage.id, name: 'stale', slug: garage.slug }),
    );

    const res = await read(garage.slug);

    expect(res.body.name).toBe('Atelier Dinamo');
    expect(Array.isArray(res.body.photos)).toBe(true);
    expect(res.body.photos).toHaveLength(1);
  });
});
