import { PopularBrandsService } from './popular-brands.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { account, prisma } = fixtures();
const popular = new PopularBrandsService(prisma);
serialDatabase(databaseUrl);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  await prisma.brand.createMany({
    data: (
      [
        ['Volvo', null, true],
        ['Audi', null, true],
        ['Dacia', 2, true],
        ['Bmw', 1, true],
        ['Lada', 1, false],
        ['Skoda', 3, true],
      ] as const
    ).map(([name, popularity, active]) => ({
      active,
      key: name.toLowerCase(),
      name,
      popularity,
      slug: name.toLowerCase(),
    })),
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const names = async (limit: number) =>
  (await popular.tiles(limit)).map((brand) => brand.name);

describe('PopularBrandsService.tiles', () => {
  it('ranks active brands by popularity, then the unranked by name', async () => {
    expect(await names(8)).toEqual(['Bmw', 'Dacia', 'Skoda', 'Audi', 'Volvo']);
  });

  it('stops at the limit', async () => {
    expect(await names(2)).toEqual(['Bmw', 'Dacia']);
  });

  it('answers only what a tile shows', async () => {
    const [bmw] = await popular.tiles(1);

    expect(bmw).toEqual({
      id: expect.any(String),
      name: 'Bmw',
      popularity: 1,
      roPossessive: null,
      slug: 'bmw',
    });
  });
});

describe('PopularBrandsService.tiles for a driver', () => {
  let driver: string;
  const brandId = async (name: string) =>
    (await prisma.brand.findFirstOrThrow({ where: { name } })).id;
  const car = async (
    name: string,
    minute: number,
    removedAt: Date | null = null,
  ) =>
    prisma.car.create({
      data: {
        brandId: await brandId(name),
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
        fuel: 'petrol',
        idempotencyKey: `${name}-${minute}`,
        model: 'Model',
        odometerKm: 1000,
        ownerId: driver,
        removedAt,
        year: 2020,
      },
    });
  const mine = async (limit: number) =>
    (await popular.tiles(limit, driver)).map((brand) => brand.name);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE account CASCADE');
    driver = await account('ana');
  });

  // @traces 007-FR-014
  it('puts the brands of the driver’s cars first, oldest car first, then the popular ones', async () => {
    await car('Dacia', 1);
    await car('Volvo', 2);

    expect(await mine(8)).toEqual(['Dacia', 'Volvo', 'Bmw', 'Skoda', 'Audi']);
    expect(await mine(3)).toEqual(['Dacia', 'Volvo', 'Bmw']);
  });

  // @traces 007-FR-014
  it('names a brand once for two cars of it', async () => {
    await car('Audi', 1);
    await car('Dacia', 2);
    await car('Audi', 3);

    expect(await mine(8)).toEqual(['Audi', 'Dacia', 'Bmw', 'Skoda', 'Volvo']);
  });

  // @traces 007-FR-015
  it('leaves out a removed car and a retired brand', async () => {
    await car('Volvo', 1, new Date());
    await car('Lada', 2);

    expect(await mine(8)).toEqual(['Bmw', 'Dacia', 'Skoda', 'Audi', 'Volvo']);
  });

  // @traces 007-FR-014
  it('answers only the driver’s brands when they fill the limit', async () => {
    await car('Volvo', 1);
    await car('Audi', 2);
    await car('Skoda', 3);

    expect(await mine(2)).toEqual(['Volvo', 'Audi']);
  });

  // @traces 007-FR-014
  it('answers the popular list to a driver without a car, and to another driver', async () => {
    const other = await account('ion');
    await car('Volvo', 1);

    expect((await popular.tiles(8, other)).map((brand) => brand.name)).toEqual([
      'Bmw',
      'Dacia',
      'Skoda',
      'Audi',
      'Volvo',
    ]);
  });
});
