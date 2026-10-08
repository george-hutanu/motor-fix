import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { writeGarageBrands } from './write-garage-brands';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let garageId: string;
let dacia: string;
let bmw: string;
let tesla: string;

async function brand(name: string) {
  const key = `${name.toLowerCase()}-${randomUUID()}`;
  return (await prisma.brand.create({ data: { key, name, slug: key } })).id;
}

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
  dacia = await brand('Dacia');
  bmw = await brand('BMW');
  tesla = await brand('Tesla');
});
afterAll(() => prisma.$disconnect());

const write = (section: Record<string, unknown>) =>
  prisma.$transaction((tx) => writeGarageBrands(tx, garageId, section));

const stored = async () => {
  const rows = await prisma.garageBrand.findMany({
    select: {
      brandId: true,
      diesel: true,
      electric: true,
      hybrid: true,
      petrol: true,
      stance: true,
    },
    where: { garageId },
  });
  const texts = await prisma.garage.findUniqueOrThrow({
    select: { brandNote: true, refusalPhrase: true },
    where: { id: garageId },
  });
  return {
    brands: Object.fromEntries(
      rows.map(({ brandId, ...rest }) => [brandId, rest]),
    ),
    ...texts,
  };
};

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
};

const every = { diesel: true, electric: true, hybrid: true, petrol: true };
const none = { diesel: false, electric: false, hybrid: false, petrol: false };

describe("writing a garage's brands from step 2", () => {
  it('sets each stance with its fuels: all four when left out, only the ticked ones, none for a refused brand', async () => {
    await write({
      brands: [
        { brandId: dacia, name: 'Dacia', stance: 'works_on' },
        {
          brandId: bmw,
          fuels: ['petrol', 'hybrid'],
          name: 'BMW',
          stance: 'works_on',
        },
        { brandId: tesla, name: 'Tesla', stance: 'does_not_take' },
      ],
    });

    expect((await stored()).brands).toEqual({
      [bmw]: {
        diesel: false,
        electric: false,
        hybrid: true,
        petrol: true,
        stance: 'works_on',
      },
      [dacia]: { ...every, stance: 'works_on' },
      [tesla]: { ...none, stance: 'does_not_take' },
    });
  });

  it('keeps a taken brand with every fuel unticked', async () => {
    await write({
      brands: [
        { brandId: dacia, fuels: [], name: 'Dacia', stance: 'works_on' },
      ],
    });

    expect((await stored()).brands).toEqual({
      [dacia]: { ...none, stance: 'works_on' },
    });
  });

  it('writes the brand note and the refusal phrase', async () => {
    await write({
      brandNote: 'Fără mașini 100% electrice',
      brands: [],
      refusalPhrase: 'orice nu e BMW',
    });

    expect(await stored()).toMatchObject({
      brandNote: 'Fără mașini 100% electrice',
      refusalPhrase: 'orice nu e BMW',
    });
  });

  it('writes no text when the section holds none', async () => {
    await write({
      brands: [{ brandId: dacia, name: 'Dacia', stance: 'works_on' }],
    });

    expect(await stored()).toMatchObject({
      brandNote: null,
      refusalPhrase: null,
    });
  });

  it.each([
    [
      'an unknown fuel',
      (): Record<string, unknown> => ({
        brands: [
          { brandId: dacia, fuels: ['lpg'], name: 'Dacia', stance: 'works_on' },
        ],
      }),
    ],
    [
      'a fuel twice',
      (): Record<string, unknown> => ({
        brands: [
          {
            brandId: dacia,
            fuels: ['diesel', 'diesel'],
            name: 'Dacia',
            stance: 'works_on',
          },
        ],
      }),
    ],
    [
      'fuels on a brand the garage does not take',
      (): Record<string, unknown> => ({
        brands: [
          {
            brandId: tesla,
            fuels: ['electric'],
            name: 'Tesla',
            stance: 'does_not_take',
          },
        ],
      }),
    ],
    [
      'the same brand twice',
      (): Record<string, unknown> => ({
        brands: [
          { brandId: dacia, name: 'Dacia', stance: 'works_on' },
          { brandId: dacia, name: 'Dacia', stance: 'does_not_take' },
        ],
      }),
    ],
    [
      'a stance that is neither taken nor refused',
      (): Record<string, unknown> => ({
        brands: [{ brandId: dacia, name: 'Dacia', stance: 'unstated' }],
      }),
    ],
    [
      'a brand id that is not a uuid',
      (): Record<string, unknown> => ({
        brands: [{ brandId: 'dacia', name: 'Dacia', stance: 'works_on' }],
      }),
    ],
    [
      'a brand that is not in the catalogue',
      (): Record<string, unknown> => ({
        brands: [{ brandId: randomUUID(), name: 'Nimeni', stance: 'works_on' }],
      }),
    ],
    [
      'a note of 141 characters',
      (): Record<string, unknown> => ({
        brandNote: 'a'.repeat(141),
        brands: [],
      }),
    ],
    [
      'a phrase of 61 characters',
      (): Record<string, unknown> => ({
        brands: [],
        refusalPhrase: 'a'.repeat(61),
      }),
    ],
    [
      'a section without brands',
      (): Record<string, unknown> => ({ brandNote: 'Doar BMW' }),
    ],
  ])('refuses %s whole and writes nothing', async (_, section) => {
    const refused = await refusalOf(write(section()));

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    expect(await stored()).toEqual({
      brandNote: null,
      brands: {},
      refusalPhrase: null,
    });
  });

  it('writes nothing to the history or the outbox', async () => {
    const entries = await prisma.activityLog.count();
    const saved = await prisma.outboxEvent.count();

    await write({
      brandNote: 'Doar benzină',
      brands: [
        {
          brandId: dacia,
          fuels: ['petrol'],
          name: 'Dacia',
          stance: 'works_on',
        },
        { brandId: tesla, name: 'Tesla', stance: 'does_not_take' },
      ],
    });

    expect(await prisma.activityLog.count()).toBe(entries);
    expect(await prisma.outboxEvent.count()).toBe(saved);
  });
});
