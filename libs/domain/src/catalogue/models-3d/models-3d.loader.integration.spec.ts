import { CAR_MODELS, CAR_SYSTEM } from './models-3d';
import { Models3dLoader } from './models-3d.loader';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { CarModelFileError } from '../car-models';

const { prisma } = fixtures();
const loader = new Models3dLoader(prisma, new AuditService());
serialDatabase(databaseUrl);

const BRAND_KEYS = [...new Set(CAR_MODELS.map((model) => model.brand))];

// The history is append-only: each test reads the entries written since it began.
let since: Date;

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE car_model_3d, car_system, brand, garage CASCADE',
  );
  await prisma.brand.createMany({
    data: BRAND_KEYS.map((key) => ({ key, name: key, slug: key })),
  });
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const history = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: {
      at: { gte: since },
      subjectType: { in: ['car_system', 'car_model_3d'] },
    },
  });

const systems = () =>
  prisma.carSystem.findMany({
    orderBy: { position: 'asc' },
    select: {
      code: true,
      fuelTypes: true,
      nameEn: true,
      nameRo: true,
      position: true,
    },
  });

const models = () =>
  prisma.carModel3d.findMany({
    orderBy: { key: 'asc' },
    select: {
      bodyStyle: true,
      brand: { select: { key: true } },
      fileKey: true,
      fuel: true,
      key: true,
      licenceRef: true,
      model: true,
      popularity: true,
    },
  });

describe('Models3dLoader', () => {
  // @traces 1241-FR-002
  // @traces 1241-FR-004
  it('stores the eleven car systems and the twenty licensed models, each under its brand', async () => {
    const result = await loader.load(CAR_MODELS);

    expect(result.changed).toBe(31);
    expect(
      (await systems()).map((s) => ({
        ...s,
        fuelTypes: [...s.fuelTypes].sort(),
      })),
    ).toEqual(
      CAR_SYSTEM.map((s) => ({
        code: s.code,
        fuelTypes: [...s.fuelTypes].sort(),
        nameEn: s.nameEn,
        nameRo: s.nameRo,
        position: s.position,
      })),
    );
    expect(await models()).toEqual(
      [...CAR_MODELS]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((m) => ({
          bodyStyle: m.bodyStyle,
          brand: { key: m.brand },
          fileKey: m.file,
          fuel: m.fuel,
          key: m.key,
          licenceRef: null,
          model: m.model,
          popularity: m.rank,
        })),
    );
  });

  // @traces 1241-FR-002
  it('records each created row in the history as the system', async () => {
    await loader.load(CAR_MODELS);

    const entries = await history();
    expect(entries).toHaveLength(31);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        action: 'create',
        actorId: null,
        actorRole: 'system',
      });
    }
  });

  // @traces 1241-FR-002
  it('changes nothing and records nothing when the same file runs again', async () => {
    await loader.load(CAR_MODELS);
    const before = await prisma.carModel3d.findMany({
      orderBy: { key: 'asc' },
    });
    const entries = (await history()).length;

    const result = await loader.load(CAR_MODELS);

    expect(result.changed).toBe(0);
    expect(
      await prisma.carModel3d.findMany({ orderBy: { key: 'asc' } }),
    ).toEqual(before);
    expect(await history()).toHaveLength(entries);
  });

  // @traces 1241-FR-004
  it('points a model at its new file when the file key changes, recording the change', async () => {
    await loader.load(CAR_MODELS);
    const logan = await prisma.carModel3d.findUniqueOrThrow({
      where: { key: 'dacia-logan' },
    });
    const file = 'dacia-logan.0123456789abcdef.glb';

    const result = await loader.load(
      CAR_MODELS.map((m) => (m.key === 'dacia-logan' ? { ...m, file } : m)),
    );

    expect(result.changed).toBe(1);
    expect(
      (await history()).filter((entry) => entry.action === 'update'),
    ).toEqual([
      expect.objectContaining({
        field: 'fileKey',
        newValue: file,
        oldValue: logan.fileKey,
        subjectId: logan.id,
      }),
    ]);
  });

  // @traces 1241-FR-002
  it('deletes a model gone from the file and records what it held', async () => {
    await loader.load(CAR_MODELS);
    const clio = await prisma.carModel3d.findUniqueOrThrow({
      where: { key: 'renault-clio' },
    });

    const result = await loader.load(
      CAR_MODELS.filter((m) => m.key !== 'renault-clio'),
    );

    expect(result.changed).toBe(1);
    expect(
      await prisma.carModel3d.findUnique({ where: { key: 'renault-clio' } }),
    ).toBeNull();
    expect(
      (await history()).filter((entry) => entry.action === 'delete'),
    ).toEqual([
      expect.objectContaining({
        actorRole: 'system',
        oldValue: expect.objectContaining({ key: 'renault-clio' }),
        subjectId: clio.id,
        subjectType: 'car_model_3d',
      }),
    ]);
  });

  // @traces 1241-FR-009
  it('refuses a model whose brand is not stored, and stores nothing', async () => {
    await prisma.brand.delete({ where: { key: 'opel' } });

    await expect(loader.load(CAR_MODELS)).rejects.toThrow(CarModelFileError);
    expect(await prisma.carModel3d.count()).toBe(0);
    expect(await prisma.carSystem.count()).toBe(0);
    expect(await history()).toEqual([]);
  });

  // @traces 1241-FR-002
  it('brings a stored system back to the file, deletes one the file no longer holds, and lets two swap places', async () => {
    await loader.load(CAR_MODELS);
    const [engine, brakes] = await prisma.carSystem.findMany({
      orderBy: { position: 'asc' },
      take: 2,
    });
    await prisma.carSystem.update({
      data: { nameEn: 'Motor', position: 2 },
      where: { id: engine.id },
    });
    await prisma.carSystem.update({
      data: { fuelTypes: ['petrol'], position: 1 },
      where: { id: brakes.id },
    });
    const extra = await prisma.carSystem.create({
      data: {
        code: 'wipers',
        fuelTypes: ['petrol'],
        nameEn: 'Wipers',
        nameRo: 'Ștergătoare',
        position: 12,
      },
    });

    const result = await loader.load(CAR_MODELS);

    expect(result.changed).toBe(3);
    expect(
      (await systems()).map((s) => [s.position, s.code, s.nameEn]).slice(0, 2),
    ).toEqual([
      [1, 'engine', 'Engine'],
      [2, 'brakes', 'Brakes'],
    ]);
    expect(
      await prisma.carSystem.findUnique({ where: { id: extra.id } }),
    ).toBeNull();
    const entries = await history();
    expect(entries).toContainEqual(
      expect.objectContaining({
        action: 'delete',
        subjectId: extra.id,
        subjectType: 'car_system',
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        action: 'update',
        field: 'nameEn',
        newValue: 'Engine',
        oldValue: 'Motor',
        subjectId: engine.id,
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        action: 'update',
        field: 'fuelTypes',
        subjectId: brakes.id,
      }),
    );
  });

  it('stores each row once when two starts load together', async () => {
    await Promise.all([loader.load(CAR_MODELS), loader.load(CAR_MODELS)]);

    expect(await prisma.carSystem.count()).toBe(11);
    expect(await prisma.carModel3d.count()).toBe(20);
    expect(await history()).toHaveLength(31);
  });
});
