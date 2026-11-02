import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { NO_BRAND } from './public-garages';
import { AuditService } from '../../audit/audit.service';
import { AuthModule } from '../../auth/auth.module';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { cacheKey } from '../../cache/cache.service';
import { purgeAudience } from '../../cache/purge';
import { outbox } from '../../events/event.port';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import type { RateLimits } from '../../rate-limit/rate-limit.service';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import { GaragesModule } from '../garages.module';
import type { ListingPhotosService } from '../photos/listing-photos/listing-photos.service';
import { OwnerPhotosSave } from '../photos/owner-photos/owner-photos.save';
import { OwnerPhotosService } from '../photos/owner-photos/owner-photos.service';

// @traces 1249-FR-011

const redisUrl = redisUrlFor(2);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let redis: Redis;
let save: OwnerPhotosSave;

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
  redis = new Redis(redisUrl);
  // A reorder and a caption touch no file: the uploads are not needed here.
  const storage = app.get(StorageService);
  const listing = {} as ListingPhotosService;
  const limits = {} as RateLimits;
  save = new OwnerPhotosSave(
    prisma,
    new AuditService(),
    outbox,
    storage,
    listing,
    new OwnerPhotosService(prisma, storage, listing, limits),
  );
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.flushdb();
});

const read = (slug: string) =>
  request(app.getHttpServer()).get(`/garages/${slug}`).expect(200);

describe("the public profile after the owner's save", () => {
  it('drops the cached profile on garage.updated and answers the new order with captions', async () => {
    const garage = await prisma.garage.create({
      data: {
        name: 'Service Auto Nord',
        slug: `nord-${randomUUID()}`,
        status: 'approved',
      },
    });
    const owner = await account('mihai', ['garage']);
    const [a, b] = await prisma.garagePhoto.createManyAndReturn({
      data: [0, 1].map((position) => ({
        fileKey: `garage_photo/${randomUUID()}/${randomUUID()}`,
        garageId: garage.id,
        height: 600,
        position,
        width: 800,
      })),
    });
    const before = await read(garage.slug);
    expect(before.body.photos.map((p: { id: string }) => p.id)).toEqual([
      a?.id,
      b?.id,
    ]);
    const key = cacheKey('profile', garage.slug, NO_BRAND);
    expect(await redis.get(key)).not.toBeNull();

    await save.save(
      {
        accountId: owner,
        garageId: garage.id,
        permissions: {},
        role: 'garage',
        roles: ['garage'],
      } as Actor,
      garage.id,
      {
        photos: [{ caption: 'Hala de reparații', id: b?.id }, { id: a?.id }],
        version: String(garage.profileVersion),
      },
    );
    const [event] = await prisma.outboxEvent.findMany({
      where: { kind: 'garage.updated', subjectId: garage.id },
    });
    await purgeAudience(redis, event?.audience ?? []);

    expect(await redis.get(key)).toBeNull();
    const after = await read(garage.slug);
    expect(after.body.photos).toEqual([
      expect.objectContaining({ caption: 'Hala de reparații', id: b?.id }),
      expect.objectContaining({ id: a?.id }),
    ]);
    expect(after.body.photos[1]).not.toHaveProperty('caption');
  });
});
