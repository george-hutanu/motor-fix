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

// @traces 1192-FR-006

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
  vi.restoreAllMocks();
});

const IMMUTABLE = 'public, max-age=31536000, immutable';
const get = (path: string) =>
  request(app.getHttpServer()).get(`/images/${path}`);

async function held(
  status: 'approved' | 'draft' | 'suspended' = 'approved',
  files: string[] = ['640.avif'],
) {
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
  for (const file of files) {
    store.put(
      `${variantPath}/${file}`,
      Buffer.from(`bytes of ${file}`),
      file.endsWith('avif') ? 'image/avif' : 'image/webp',
      {},
      IMMUTABLE,
    );
  }
  return { digest, garage, owner, variantPath };
}

const refusedAsMissing = (res: request.Response) => {
  expect([res.status, res.body.code, res.headers['cache-control']]).toEqual([
    404,
    'not_found',
    'no-store',
  ]);
};

describe('serving a photo variant, hostile requests', () => {
  it('answers a WebP variant with the WebP type', async () => {
    const { variantPath } = await held('approved', ['320.webp']);

    const res = await get(`${variantPath}/320.webp`).buffer(true);

    expect([res.status, res.headers['content-type']]).toEqual([
      200,
      'image/webp',
    ]);
  });

  it.each(['avif', 'webp'])('answers all four widths of %s', async (format) => {
    const files = [320, 640, 960, 1600].map((w) => `${w}.${format}`);
    const { variantPath } = await held('approved', files);

    for (const file of files) {
      const res = await get(`${variantPath}/${file}`).buffer(true);
      expect([file, res.status, res.headers['cache-control']]).toEqual([
        file,
        200,
        IMMUTABLE,
      ]);
    }
  });

  it.each([
    ['a digest of 63 characters', (d: string) => d.slice(0, 63)],
    ['a digest of 65 characters', (d: string) => `${d}0`],
    ['an upper-case digest', (d: string) => d.toUpperCase()],
    ['a digest with a non-hex letter', (d: string) => `g${d.slice(1)}`],
    ['an empty digest', () => ''],
  ])('refuses %s without reading the store', async (_, change) => {
    const { digest, owner } = await held();
    const reads = vi.spyOn(store.objects, 'get');

    refusedAsMissing(await get(`g/${owner}/${change(digest)}/640.avif`));
    expect(reads).not.toHaveBeenCalled();
  });

  it.each([
    '0640.avif',
    '640.AVIF',
    '640.avif%00',
    '640.avif%20',
    '%36%34%30.avif.',
    '640',
    '.avif',
    '1.avif',
    '2000.webp',
    '-640.avif',
    '640.avifx',
    '640.jpg',
    '..%2F640.avif',
    '640%2eavif%2e',
  ])('refuses the file name %p', async (file) => {
    const { variantPath } = await held();
    const reads = vi.spyOn(store.objects, 'get');

    refusedAsMissing(await get(`${variantPath}/${file}`));
    expect(reads).not.toHaveBeenCalled();
  });

  it.each([
    ['a path climbing out of the variant path', '../{owner}/{digest}/640.avif'],
    ['an encoded dot-dot segment', 'g/{owner}/%2e%2e/{digest}/640.avif'],
    ['an extra segment after the file', 'g/{owner}/{digest}/640.avif/extra'],
    ['a doubled slash', 'g/{owner}//{digest}/640.avif'],
    ['a different top segment', 'x/{owner}/{digest}/640.avif'],
    ['an upper-case top segment', 'G/{owner}/{digest}/640.avif'],
    ['no file at all', 'g/{owner}/{digest}'],
    ['an owner with a trailing space', 'g/{owner}%20/{digest}/640.avif'],
  ])('refuses %s', async (_, shape) => {
    const { digest, owner } = await held();

    refusedAsMissing(
      await get(shape.replace('{owner}', owner).replace('{digest}', digest)),
    );
  });

  it('refuses the original photo key as an address', async () => {
    const { owner } = await held();

    refusedAsMissing(await get(`garage_photo/${owner}/${randomUUID()}`));
  });

  it('refuses a variant path whose garage is approved but swaps owner and digest', async () => {
    const { digest, owner } = await held();

    refusedAsMissing(await get(`g/${digest}/${owner}/640.avif`));
  });

  it('refuses the same digest under another owner', async () => {
    const { digest } = await held();

    refusedAsMissing(await get(`g/${randomUUID()}/${digest}/640.avif`));
  });

  it('answers a query string like the plain address', async () => {
    const { variantPath } = await held();

    const res = await get(`${variantPath}/640.avif?x=1&x=2`).buffer(true);

    expect([res.status, res.headers['cache-control']]).toEqual([
      200,
      IMMUTABLE,
    ]);
  });

  it('answers a trailing slash as missing, as only the eight names exist', async () => {
    const { variantPath } = await held();

    refusedAsMissing(await get(`${variantPath}/640.avif/`));
  });

  it('serves without a session even when given a garbage bearer token and cookie', async () => {
    const { variantPath } = await held();

    const res = await get(`${variantPath}/640.avif`)
      .set('Authorization', 'Bearer not-a-token')
      .set('Cookie', 'session=garbage')
      .buffer(true);

    expect(res.status).toBe(200);
  });

  it('stops answering a variant when its garage is suspended afterwards', async () => {
    const { garage, variantPath } = await held();
    expect((await get(`${variantPath}/640.avif`)).status).toBe(200);

    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garage.id },
    });

    refusedAsMissing(await get(`${variantPath}/640.avif`));
  });

  it('stops answering a variant when its photo row is deleted', async () => {
    const { variantPath } = await held();
    await prisma.garagePhoto.deleteMany();

    refusedAsMissing(await get(`${variantPath}/640.avif`));
  });

  it('never marks a refusal or a store failure as cacheable and carries no CDN tag', async () => {
    const { variantPath } = await held('draft');

    const res = await get(`${variantPath}/640.avif`);

    expect([res.headers['cache-control'], res.headers['cdn-tag']]).toEqual([
      'no-store',
      undefined,
    ]);
  });

  it('answers storage_unavailable without a CDN tag when the store rejects with a non-error', async () => {
    const { variantPath } = await held();
    vi.spyOn(store.objects, 'get').mockImplementation(() => {
      throw 'boom';
    });

    const res = await get(`${variantPath}/640.avif`);

    expect([res.status, res.body.code, res.headers['cdn-tag']]).toEqual([
      503,
      'storage_unavailable',
      undefined,
    ]);
  });

  it('answers fifty parallel reads of one variant all with 200', async () => {
    const { variantPath } = await held();

    const answers = await Promise.all(
      Array.from({ length: 50 }, () =>
        get(`${variantPath}/640.avif`).buffer(true),
      ),
    );

    expect(new Set(answers.map((r) => r.status))).toEqual(new Set([200]));
  });

  it('reads the store once for one request', async () => {
    const { variantPath } = await held();
    const reads = vi.spyOn(store.objects, 'get');

    await get(`${variantPath}/640.avif`);

    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('answers a missing variant of a held path as missing, not as a store failure', async () => {
    const { variantPath } = await held('approved', []);

    refusedAsMissing(await get(`${variantPath}/960.webp`));
  });
});
