import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../../auth/auth.module';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { NotificationsModule } from '../../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../../notifications/notifications.testing';
import { S3TestStore } from '../../../storage/s3-test-store';
import { StorageModule } from '../../../storage/storage.module';
import { GaragesModule } from '../../garages.module';

// @traces 1192-photo-variants-FR-006

const redisUrl = redisUrlFor(2);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const store = new S3TestStore();
let app: NestExpressApplication;

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
});

afterAll(async () => {
  await app.close();
  await store.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  store.objects.clear();
  jest.restoreAllMocks();
});

const AVIF = Buffer.from('avif bytes');
const IMMUTABLE = 'public, max-age=31536000, immutable';

const get = (path: string) =>
  request(app.getHttpServer()).get(`/images/${path}`);

// A garage with one photo whose variants sit under a content-fixed path.
async function held(status: 'approved' | 'draft' | 'suspended' = 'approved') {
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}`, status },
  });
  const owner = randomUUID();
  const digest = randomUUID().replaceAll('-', '').repeat(2);
  const variantPath = `g/${owner}/${digest}`;
  await prisma.garagePhoto.create({
    data: {
      fileKey: `garage_photo/${owner}/${randomUUID()}`,
      garageId: garage.id,
      position: 0,
      variantPath,
    },
  });
  store.put(`${variantPath}/640.avif`, AVIF, 'image/avif', {}, IMMUTABLE);
  return { digest, garage, owner, variantPath };
}

const refusedAsMissing = (res: request.Response) => {
  expect([res.status, res.body.code, res.headers['cache-control']]).toEqual([
    404,
    'not_found',
    'no-store',
  ]);
};

describe('serving a photo variant', () => {
  it('answers the variant of an approved garage to anyone, cached for a year', async () => {
    const { garage, variantPath } = await held();

    const res = await get(`${variantPath}/640.avif`).buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/avif');
    expect(res.headers['cache-control']).toBe(IMMUTABLE);
    expect(res.headers['cdn-tag']).toBe(`garage:${garage.id}`);
    expect(Buffer.compare(res.body as Buffer, AVIF)).toBe(0);
  });

  it.each([
    ['an owner that is not an id', 'g/not-an-id/{digest}/640.avif'],
    ['a digest of the wrong shape', 'g/{owner}/{DIGEST}/640.avif'],
    ['an unknown width', 'g/{owner}/{digest}/641.avif'],
    ['another format', 'g/{owner}/{digest}/640.jpeg'],
    ['a name with more after it', 'g/{owner}/{digest}/640.avif.thumb'],
  ])('refuses %s without reading the store', async (_, shape) => {
    const { digest, owner } = await held();
    const reads = jest.spyOn(store.objects, 'get');

    refusedAsMissing(
      await get(
        shape
          .replace('{owner}', owner)
          .replace('{digest}', digest)
          .replace('{DIGEST}', digest.toUpperCase()),
      ),
    );
    expect(reads).not.toHaveBeenCalled();
  });

  it('refuses a path no photo holds', async () => {
    await held();

    refusedAsMissing(await get(`g/${randomUUID()}/${'f'.repeat(64)}/640.avif`));
  });

  it.each(['draft', 'suspended'] as const)(
    'refuses the photo of a %s garage',
    async (status) => {
      const { variantPath } = await held(status);

      refusedAsMissing(await get(`${variantPath}/640.avif`));
    },
  );

  it('answers a held path whose variant is not stored as missing', async () => {
    const { variantPath } = await held();

    refusedAsMissing(await get(`${variantPath}/320.webp`));
  });

  it('answers storage_unavailable, never cached, when the store fails', async () => {
    const { variantPath } = await held();
    jest.spyOn(store.objects, 'get').mockImplementation(() => {
      throw new Error('disk gone');
    });

    const res = await get(`${variantPath}/640.avif`);

    expect([res.status, res.body.code, res.headers['cache-control']]).toEqual([
      503,
      'storage_unavailable',
      'no-store',
    ]);
  });
});
