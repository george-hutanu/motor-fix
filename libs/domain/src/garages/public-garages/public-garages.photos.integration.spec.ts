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

describe('the photos of a public garage profile', () => {
  it('lists the photos in the owner order, each with its size', async () => {
    const garage = await approved();
    const third = await photo(garage.id, 2);
    const first = await photo(garage.id, 0, { height: 1200, width: 800 });
    const second = await photo(garage.id, 1);

    const res = await read(garage.slug);

    expect(res.status).toBe(200);
    expect(
      (res.body.photos as Photo[]).map(({ height, id, width }) => ({
        height,
        id,
        width,
      })),
    ).toEqual([
      { height: 1200, id: first.id, width: 800 },
      { height: 900, id: second.id, width: 1200 },
      { height: 900, id: third.id, width: 1200 },
    ]);
  });

  it('answers the thumbnail and display copies as addresses signed for an hour', async () => {
    const garage = await approved();
    await photo(garage.id, 0);

    const [answered] = (await read(garage.slug)).body.photos as Photo[];

    const thumb = new URL(answered.thumbnailUrl);
    const display = new URL(answered.displayUrl);
    expect(thumb.pathname).toMatch(/\.thumb$/);
    expect(display.pathname).toMatch(/\.display$/);
    expect(thumb.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(display.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(thumb.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect((await fetch(answered.thumbnailUrl)).status).toBe(200);
    expect(await (await fetch(answered.displayUrl)).text()).toBe('display');
  });

  it('never answers the storage key, the bucket or the original upload', async () => {
    const garage = await approved();
    const row = await photo(garage.id, 0);

    const res = await read(garage.slug);

    const [answered] = res.body.photos as Photo[];
    expect(Object.keys(answered).sort()).toEqual([
      'displayUrl',
      'height',
      'id',
      'thumbnailUrl',
      'width',
    ]);
    const outsideUrls = JSON.stringify({
      ...res.body,
      photos: (res.body.photos as Photo[]).map(({ id, height, width }) => ({
        height,
        id,
        width,
      })),
    });
    expect(outsideUrls).not.toContain('garage_photo/');
    expect(outsideUrls).not.toContain(store.bucket);
    expect(JSON.stringify(res.body)).not.toContain('fileKey');
    for (const url of [answered.thumbnailUrl, answered.displayUrl]) {
      expect(new URL(url).pathname).not.toMatch(new RegExp(`${row.fileKey}$`));
    }
  });

  it('answers an empty list for a garage with no photos', async () => {
    const garage = await approved();

    const res = await read(garage.slug);

    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual([]);
  });

  it('asks storage nothing about a photo whose size is known', async () => {
    const garage = await approved();
    await photo(garage.id, 0);
    const head = jest.spyOn(storage, 'metadataOf');

    await read(garage.slug);

    expect(head).not.toHaveBeenCalled();
  });

  it('takes an unsized photo size from its thumbnail and writes nothing back', async () => {
    const garage = await approved();
    const row = await photo(garage.id, 0, { height: null, width: null });

    const [answered] = (await read(garage.slug)).body.photos as Photo[];

    expect(answered).toMatchObject({ height: 600, id: row.id, width: 800 });
    expect(
      await prisma.garagePhoto.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({ height: null, width: null });
  });

  it('leaves out a photo whose copies are not stored yet', async () => {
    const garage = await approved();
    const ready = await photo(garage.id, 0);
    await photo(garage.id, 1, { height: null, width: null }, false);

    const res = await read(garage.slug);

    expect((res.body.photos as Photo[]).map(({ id }) => id)).toEqual([
      ready.id,
    ]);
  });

  it('keeps the photos with the cached answer and shows a new order once it is dropped', async () => {
    const garage = await approved();
    const a = await photo(garage.id, 0);
    const b = await photo(garage.id, 1);
    const first = (await read(garage.slug)).body.photos as Photo[];

    await prisma.garagePhoto.update({
      data: { position: 2 },
      where: { id: a.id },
    });
    const cached = (await read(garage.slug)).body.photos as Photo[];
    await dropProfiles(other, [`public:garage:${garage.id}`]);
    const fresh = (await read(garage.slug)).body.photos as Photo[];

    expect(cached).toEqual(first);
    expect(fresh.map(({ id }) => id)).toEqual([b.id, a.id]);
  });
});
