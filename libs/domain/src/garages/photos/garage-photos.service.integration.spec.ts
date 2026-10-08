import { randomUUID } from 'node:crypto';

import { GaragePhotosService } from './garage-photos.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const service = new GaragePhotosService();
let garageId: string;

beforeEach(async () => {
  await reset();
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
});
afterAll(() => prisma.$disconnect());

const keyOf = () => `garage_photo/${randomUUID()}/${randomUUID()}`;

describe('the gallery rows of a sent listing', () => {
  it('writes one row per photo in the chosen order, the first being the cover', async () => {
    const [a, b, c] = [keyOf(), keyOf(), keyOf()];

    await prisma.$transaction((tx) =>
      service.saveRows(tx, garageId, [
        { height: 900, key: a, width: 1200 },
        { key: b },
        { height: 1200, key: c, width: 800 },
      ]),
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
        await service.saveRows(tx, garageId, [{ key: keyOf() }]);
        throw new Error('sending failed');
      }),
    ).rejects.toThrow('sending failed');

    expect(await prisma.garagePhoto.count()).toBe(0);
  });

  it('refuses the same photo twice', async () => {
    const key = keyOf();

    await expect(
      prisma.$transaction((tx) =>
        service.saveRows(tx, garageId, [{ key }, { key }]),
      ),
    ).rejects.toThrow();
    expect(await prisma.garagePhoto.count()).toBe(0);
  });

  it('removes the rows with their garage', async () => {
    await prisma.$transaction((tx) =>
      service.saveRows(tx, garageId, [{ key: keyOf() }]),
    );

    await prisma.garage.delete({ where: { id: garageId } });

    expect(await prisma.garagePhoto.count()).toBe(0);
  });
});
