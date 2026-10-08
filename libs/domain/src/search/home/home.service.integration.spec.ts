import { HttpException } from '@nestjs/common';

import { HomeService } from './home.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

type Stance = 'works_on' | 'does_not_take';

const { prisma } = fixtures();
const home = new HomeService(prisma);
serialDatabase(databaseUrl);

let dacia: string;
let tesla: string;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', popularity: 7, slug: 'dacia' },
    })
  ).id;
  tesla = (
    await prisma.brand.create({
      data: { key: 'tesla', name: 'Tesla', slug: 'tesla' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const refused = (stance: Stance) =>
  stance === 'does_not_take' && {
    diesel: false,
    electric: false,
    hybrid: false,
    petrol: false,
  };

async function garage(
  slug: string,
  answers: [string, Stance][] = [],
  status: 'approved' | 'draft' | 'suspended' = 'approved',
) {
  const { id } = await prisma.garage.create({
    data: { name: slug, slug, status },
  });
  for (const [brandId, stance] of answers) {
    await prisma.garageBrand.create({
      data: { brandId, garageId: id, stance, ...refused(stance) },
    });
  }
}

describe('HomeService.forBrand', () => {
  it('counts every listed garage and those that work on the brand', async () => {
    await garage('takes', [[dacia, 'works_on']]);
    await garage('takes-both', [
      [dacia, 'works_on'],
      [tesla, 'works_on'],
    ]);
    await garage('refuses', [[dacia, 'does_not_take']]);
    await garage('other-brand-only', [[tesla, 'works_on']]);
    await garage('silent');

    expect(await home.forBrand('dacia')).toEqual({
      brand: { id: dacia, name: 'Dacia', popularity: 7, slug: 'dacia' },
      takers: 2,
      total: 5,
    });
  });

  it('leaves draft and suspended garages out of both counts', async () => {
    await garage('listed', [[dacia, 'works_on']]);
    await garage('draft', [[dacia, 'works_on']], 'draft');
    await garage('suspended', [[dacia, 'works_on']], 'suspended');

    expect(await home.forBrand('dacia')).toMatchObject({
      takers: 1,
      total: 1,
    });
  });

  it('answers zero of zero before any garage is listed', async () => {
    expect(await home.forBrand('tesla')).toMatchObject({
      brand: { popularity: null, slug: 'tesla' },
      takers: 0,
      total: 0,
    });
  });

  it.each([
    ['a retired brand', 'dacia'],
    ['an unknown slug', 'lada'],
  ])('refuses %s with not_found', async (_, slug) => {
    await prisma.brand.update({
      data: { active: false },
      where: { id: dacia },
    });

    const error = await home.forBrand(slug).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'not_found',
    });
  });
});
