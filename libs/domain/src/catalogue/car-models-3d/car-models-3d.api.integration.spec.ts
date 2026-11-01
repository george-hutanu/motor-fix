import { randomUUID } from 'node:crypto';

import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CarModels3dModule } from './car-models-3d.module';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { PUBLIC_POLICY } from '../../cache/http-cache/http-cache.interceptor';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import {
  CAR_MODELS,
  CAR_SYSTEM,
  GENERIC_FILES,
  MODEL_3D_FILES,
} from '../models-3d/models-3d';
import { Models3dStore } from '../models-3d/models-3d.store';

// @traces 035-FR-001 035-FR-002 035-FR-003 035-FR-004 035-FR-005
// @traces 035-FR-006 035-FR-007 035-FR-011

const redisUrl = redisUrlFor(3);
const { account, prisma } = fixtures();
serialDatabase(databaseUrl);

const store = new S3TestStore();
const IMMUTABLE = 'public, max-age=31536000, immutable';
const BASE = '/api/v1/car-models-3d/files';
let app: NestExpressApplication;

beforeAll(async () => {
  await store.start();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      StorageModule.register(store.env()),
      CarModels3dModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
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
  await app.close();
  await store.stop();
  await prisma.$disconnect();
});

const brandId: Record<string, string> = {};

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE account, car_model_3d, car_system, job_type, brand, garage CASCADE',
  );
  store.objects.clear();
  store.beforeGet = undefined;
  for (const [key, name, bodyStyle, active] of [
    ['dacia', 'Dacia', 'saloon', true],
    ['tesla', 'Tesla', 'fastback', true],
    ['lada', 'Lada', 'saloon', false],
  ] as const) {
    const brand = await prisma.brand.create({
      data: { active, bodyStyle, key, name, slug: key },
    });
    brandId[key] = brand.id;
  }
  await prisma.carModel3d.createMany({
    data: CAR_MODELS.filter((m) => m.brand === 'dacia').map((m) => ({
      bodyStyle: m.bodyStyle,
      brandId: brandId['dacia'],
      fileKey: m.file,
      fuel: m.fuel,
      key: m.key,
      model: m.model,
      popularity: m.rank,
    })),
  });
  await prisma.carSystem.createMany({
    data: CAR_SYSTEM.map((s) => ({ ...s, fuelTypes: [...s.fuelTypes] })),
  });
});

afterEach(() => jest.restoreAllMocks());

const read = (query: Record<string, string>, bearer?: string) => {
  const req = request(app.getHttpServer()).get('/car-models-3d').query(query);
  return bearer ? req.set('Authorization', bearer) : req;
};

const file = (key: string) =>
  request(app.getHttpServer())
    .get(`/car-models-3d/files/${key}`)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const json = /json/.test(String(res.headers['content-type']));
        done(null, json ? JSON.parse(body.toString()) : body);
      });
    });

const bearerOf = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'driver' }, 'test')}`;

let ageMs = 0;
const nextCreatedAt = () => {
  ageMs += 60_000;
  return new Date(Date.UTC(2026, 0, 1) + ageMs);
};
const ownCar = (ownerId: string, model: string, extra: object = {}) =>
  prisma.car.create({
    data: {
      brandId: brandId['dacia'],
      createdAt: nextCreatedAt(),
      fuel: 'diesel',
      idempotencyKey: randomUUID(),
      model,
      odometerKm: 120_000,
      ownerId,
      plate: 'B123ABC',
      year: 2019,
      ...extra,
    },
  });

const fileOf = (key: string) =>
  CAR_MODELS.find((m) => m.key === key)?.file as string;

describe('GET /car-models-3d', () => {
  it('answers a visitor with the brand’s most popular licensed model and its systems', async () => {
    const res = await read({ brand: 'dacia' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      bodyStyle: 'saloon',
      brand: { key: 'dacia', name: 'Dacia' },
      fileUrl: `${BASE}/${fileOf('dacia-logan')}`,
      fuel: 'petrol',
      model: 'Logan',
      source: 'brand',
      systems: expect.any(Array),
    });
    expect(res.body.systems).toHaveLength(9);
    expect(res.body.systems[0]).toEqual({
      code: 'engine',
      jobTypeIds: [],
      nameEn: 'Engine',
      nameRo: 'Motor',
    });
  });

  it('answers the generic shape of a brand with no licensed model', async () => {
    const res = await read({ brand: 'tesla' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      bodyStyle: 'fastback',
      fileUrl: `${BASE}/${GENERIC_FILES.fastback}`,
      fuel: 'petrol',
      model: null,
      source: 'generic',
    });
    expect(res.body.systems).toHaveLength(9);
  });

  it('lists the approved jobs of each system, by Romanian name', async () => {
    const job = (
      key: string,
      nameRo: string,
      carSystem: string,
      status: 'approved' | 'pending' = 'approved',
    ) =>
      prisma.jobType.create({
        data: { carSystem, key, nameEn: nameRo, nameRo, status },
      });
    const pads = await job('brake-pads', 'Plăcuțe frână', 'brakes');
    const discs = await job('brake-discs', 'Discuri frână', 'brakes');
    await job('brake-fluid', 'Lichid frână', 'brakes', 'pending');
    const belt = await job('timing-belt', 'Distribuție', 'engine');

    const { body } = await read({ brand: 'dacia' });
    const byCode = Object.fromEntries(
      body.systems.map((s: { code: string; jobTypeIds: string[] }) => [
        s.code,
        s.jobTypeIds,
      ]),
    );

    expect(byCode['brakes']).toEqual([discs.id, pads.id]);
    expect(byCode['engine']).toEqual([belt.id]);
    expect(byCode['exhaust']).toEqual([belt.id]);
    expect(byCode['tyres']).toEqual([]);
  });

  it('lets a visitor’s answer be cached publicly, varying on the session', async () => {
    const res = await read({ brand: 'dacia' });

    expect(res.headers['cache-control']).toBe(PUBLIC_POLICY);
    expect(res.headers['vary']).toMatch(/\bAuthorization\b/i);
  });

  describe('for a signed-in driver', () => {
    let driver: string;
    beforeEach(async () => {
      driver = await account('ana');
    });

    it('answers the driver’s own licensed car before the brand’s rank, with the file’s fuel', async () => {
      await ownCar(driver, 'Duster');

      const res = await read({ brand: 'dacia' }, bearerOf(driver));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        fileUrl: `${BASE}/${fileOf('dacia-duster')}`,
        fuel: 'diesel',
        model: 'Duster',
        source: 'own_car',
      });
      expect(res.headers['cache-control']).toBe('private, no-cache');
    });

    it('answers the most recently added of two licensed cars', async () => {
      await ownCar(driver, 'Duster');
      await ownCar(driver, 'sandero', { fuel: 'petrol' });

      const { body } = await read({ brand: 'dacia' }, bearerOf(driver));

      expect([body.source, body.model]).toEqual(['own_car', 'Sandero']);
    });

    it('falls to the brand’s rank when the own car’s model is not licensed', async () => {
      await ownCar(driver, 'Spring', { fuel: 'electric' });

      const { body } = await read({ brand: 'dacia' }, bearerOf(driver));

      expect([body.source, body.model]).toEqual(['brand', 'Logan']);
    });

    it('never answers a removed car', async () => {
      await ownCar(driver, 'Duster', { removedAt: new Date() });

      const { body } = await read({ brand: 'dacia' }, bearerOf(driver));

      expect([body.source, body.model]).toEqual(['brand', 'Logan']);
    });

    it('answers the one car named by car=, never another own car', async () => {
      const sandero = await ownCar(driver, 'Sandero', { fuel: 'petrol' });
      await ownCar(driver, 'Duster');

      const named = await read(
        { brand: 'dacia', car: sandero.id },
        bearerOf(driver),
      );
      expect([named.body.source, named.body.model]).toEqual([
        'own_car',
        'Sandero',
      ]);

      const spring = await ownCar(driver, 'Spring', { fuel: 'electric' });
      const unlicensed = await read(
        { brand: 'dacia', car: spring.id },
        bearerOf(driver),
      );
      expect([unlicensed.body.source, unlicensed.body.model]).toEqual([
        'brand',
        'Logan',
      ]);
    });

    it('falls to the brand’s rank for car= of another brand', async () => {
      const model3 = await ownCar(driver, 'Model 3', {
        brandId: brandId['tesla'],
        fuel: 'electric',
      });

      const { status, body } = await read(
        { brand: 'dacia', car: model3.id },
        bearerOf(driver),
      );

      expect([status, body.source, body.model]).toEqual([
        200,
        'brand',
        'Logan',
      ]);
    });

    it('answers 404 for car= of another account and of a removed car', async () => {
      const other = await account('ion');
      const theirs = await ownCar(other, 'Duster');
      const removed = await ownCar(driver, 'Duster', { removedAt: new Date() });

      for (const car of [theirs.id, removed.id, randomUUID()]) {
        const res = await read({ brand: 'dacia', car }, bearerOf(driver));
        expect([res.status, res.body.code]).toEqual([404, 'not_found']);
      }
    });

    it('never carries the car’s plate, year, odometer or id', async () => {
      const car = await ownCar(driver, 'Duster');

      const res = await read({ brand: 'dacia', car: car.id }, bearerOf(driver));

      expect(Object.keys(res.body).sort()).toEqual([
        'bodyStyle',
        'brand',
        'fileUrl',
        'fuel',
        'model',
        'source',
        'systems',
      ]);
      const text = JSON.stringify(res.body);
      for (const leak of [car.id, 'B123ABC', '2019', '120000']) {
        expect(text).not.toContain(leak);
      }
    });
  });

  it('answers 404 for a visitor’s car=', async () => {
    const driver = await account('ana');
    const car = await ownCar(driver, 'Duster');

    const res = await read({ brand: 'dacia', car: car.id });

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    expect(String(res.headers['cache-control'] ?? '')).not.toContain('public');
  });

  it.each(['lada', 'unknown'])(
    'answers 404 for the brand %s',
    async (brand) => {
      const res = await read({ brand });

      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    },
  );

  it.each([
    ['no brand', ''],
    ['an upper-case brand', 'brand=Dacia'],
    ['a malformed car', 'brand=dacia&car=abc'],
    ['a repeated brand', 'brand=dacia&brand=dacia'],
    ['a repeated car', `brand=dacia&car=${randomUUID()}&car=${randomUUID()}`],
    ['an unknown parameter', 'brand=dacia&fuel=petrol'],
  ])('answers 400 for %s', async (_, query) => {
    const res = await request(app.getHttpServer()).get(
      `/car-models-3d?${query}`,
    );

    expect(res.status).toBe(400);
    expect(String(res.headers['cache-control'] ?? '')).not.toContain('public');
  });
});

describe('GET /car-models-3d/files/:key', () => {
  const logan = fileOf('dacia-logan');
  const GLB = Buffer.from('glTF bytes');

  it('streams a catalogue file as a GLB, cached for a year', async () => {
    store.put(`models-3d/${logan}`, GLB, 'model/gltf-binary', {}, IMMUTABLE);

    const res = await file(logan);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('model/gltf-binary');
    expect(res.headers['cache-control']).toBe(IMMUTABLE);
    expect(Buffer.compare(res.body as Buffer, GLB)).toBe(0);
  });

  it.each([
    ['an unknown key', 'dacia-spring.0123456789abcdef.glb'],
    ['a malformed key', 'dacia-logan.glb'],
    ['an upper-case hash', logan.toUpperCase()],
    ['a catalogue key the store lacks', logan],
    ['a trailing slash', `${logan}/`],
  ])('answers 404 not_found, never cached, for %s', async (_, key) => {
    const res = await file(key);

    expect([res.status, res.body.code, res.headers['cache-control']]).toEqual([
      404,
      'not_found',
      'no-store',
    ]);
  });

  it('answers 503 when the store fails', async () => {
    store.put(`models-3d/${logan}`, GLB, 'model/gltf-binary', {}, IMMUTABLE);
    store.beforeGet = () => {
      throw new Error('store down');
    };

    const res = await file(logan);

    expect([res.status, res.body.code, res.headers['cache-control']]).toEqual([
      503,
      'storage_unavailable',
      'no-store',
    ]);
  });
});

describe('filling the store at start', () => {
  it('writes every catalogue file once, then nothing', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const fill = () => app.get(Models3dStore).fill();

    expect(await fill()).toEqual({ written: MODEL_3D_FILES.length });
    expect([...store.objects.keys()].sort()).toEqual(
      MODEL_3D_FILES.map((f) => `models-3d/${f.file}`).sort(),
    );
    const stored = store.objects.get(`models-3d/${fileOf('dacia-logan')}`);
    expect([stored?.contentType, stored?.cacheControl]).toEqual([
      'model/gltf-binary',
      IMMUTABLE,
    ]);
    expect(await fill()).toEqual({ written: 0 });

    const res = await file(GENERIC_FILES.suv);
    expect([
      res.status,
      (res.body as Buffer).subarray(0, 4).toString(),
    ]).toEqual([200, 'glTF']);
  });
});
