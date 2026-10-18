import { randomUUID } from 'node:crypto';

import { GaragePhotosService } from './garage-photos.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const service = new GaragePhotosService(new AuditService());
let garageId: string;
let actorId: string;

beforeEach(async () => {
  await reset();
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
  actorId = await account('Mihai Pop', ['garage']);
});
afterAll(() => prisma.$disconnect());

const keyOf = () => `garage_photo/${randomUUID()}/${randomUUID()}`;

describe('the gallery rows of a sent listing', () => {
  it('writes one row per photo in the chosen order, the first being the cover', async () => {
    const [a, b, c] = [keyOf(), keyOf(), keyOf()];

    await prisma.$transaction((tx) =>
      service.saveRows(
        tx,
        garageId,
        [
          { height: 900, key: a, width: 1200 },
          { key: b },
          { height: 1200, key: c, width: 800 },
        ],
        actorId,
      ),
    );

    const rows = await prisma.garagePhoto.findMany({
      orderBy: { position: 'asc' },
      where: { garageId },
    });
    expect(
      rows.map(({ fileKey, height, position, width }) => ({
        fileKey,
        height,
        position,
        width,
      })),
    ).toEqual([
      { fileKey: a, height: 900, position: 0, width: 1200 },
      { fileKey: b, height: null, position: 1, width: null },
      { fileKey: c, height: 1200, position: 2, width: 800 },
    ]);
  });

  it('writes nothing when the sending transaction fails', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await service.saveRows(tx, garageId, [{ key: keyOf() }], actorId);
        throw new Error('sending failed');
      }),
    ).rejects.toThrow('sending failed');

    expect(await prisma.garagePhoto.count()).toBe(0);
  });

  it('refuses the same photo twice', async () => {
    const key = keyOf();

    await expect(
      prisma.$transaction((tx) =>
        service.saveRows(tx, garageId, [{ key }, { key }], actorId),
      ),
    ).rejects.toThrow();
    expect(await prisma.garagePhoto.count()).toBe(0);
  });

  it('removes the rows with their garage', async () => {
    await prisma.$transaction((tx) =>
      service.saveRows(tx, garageId, [{ key: keyOf() }], actorId),
    );

    await prisma.garage.delete({ where: { id: garageId } });

    expect(await prisma.garagePhoto.count()).toBe(0);
  });
});

describe('a gallery written again, and its history', () => {
  const save = (keys: string[]) =>
    prisma.$transaction((tx) =>
      service.saveRows(
        tx,
        garageId,
        keys.map((key) => ({ key })),
        actorId,
      ),
    );
  const gallery = async () =>
    (
      await prisma.garagePhoto.findMany({
        orderBy: { position: 'asc' },
        where: { garageId },
      })
    ).map((row) => row.fileKey);
  const entries = (seen: string[] = []) =>
    prisma.activityLog.findMany({
      orderBy: { action: 'asc' },
      where: { garageId, id: { notIn: seen }, subjectType: 'garage_photo' },
    });

  // @traces 304-FR-010
  it('records a create per photo of the first gallery, by the garage', async () => {
    const [a, b] = [keyOf(), keyOf()];

    await save([a, b]);

    const rows = await prisma.garagePhoto.findMany({ where: { garageId } });
    const written = await entries();
    expect(
      written.map((e) => [e.action, e.subjectId, e.oldValue, e.newValue]),
    ).toEqual(
      expect.arrayContaining(
        rows.map((row) => [
          'create',
          row.id,
          null,
          { fileKey: row.fileKey, position: row.position },
        ]),
      ),
    );
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({
      actorId,
      actorRole: 'owner',
      internal: false,
    });
  });

  // @traces 304-FR-010
  it('replaces the gallery, recording the photos removed and added', async () => {
    const [a, b, c] = [keyOf(), keyOf(), keyOf()];
    await save([a, b]);
    const before = await prisma.garagePhoto.findMany({ where: { garageId } });
    const seen = (await entries()).map((e) => e.id);

    await save([b, c]);

    expect(await gallery()).toEqual([b, c]);
    const removed = before.find((row) => row.fileKey === a);
    const added = await prisma.garagePhoto.findFirstOrThrow({
      where: { fileKey: c },
    });
    expect(
      (await entries(seen)).map((e) => [
        e.action,
        e.subjectId,
        e.field,
        e.oldValue,
        e.newValue,
      ]),
    ).toEqual([
      ['create', added.id, null, null, { fileKey: c, position: 1 }],
      ['delete', removed?.id, null, { fileKey: a, position: 0 }, null],
    ]);
  });

  // @traces 304-FR-010
  it('records nothing when the same photos are written again, in any order', async () => {
    const keys = [keyOf(), keyOf()];
    await save(keys);
    const seen = (await entries()).map((e) => e.id);

    await save(keys);

    expect(await gallery()).toEqual(keys);
    expect(await entries(seen)).toEqual([]);
  });

  // @traces 304-FR-010
  it('swaps two photos without breaking the one-photo-per-position rule', async () => {
    const [a, b] = [keyOf(), keyOf()];
    await save([a, b]);
    const seen = (await entries()).map((e) => e.id);

    await save([b, a]);

    expect(await gallery()).toEqual([b, a]);
    expect(await entries(seen)).toEqual([]);
  });
});
