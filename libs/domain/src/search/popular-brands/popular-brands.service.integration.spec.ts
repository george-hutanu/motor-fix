import { PopularBrandsService } from './popular-brands.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma } = fixtures();
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
      slug: 'bmw',
    });
  });
});
