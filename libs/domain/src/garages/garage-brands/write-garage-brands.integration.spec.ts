import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { type GarageJobRef, writeGarageBrands } from './write-garage-brands';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
const audit = new AuditService();
serialDatabase(databaseUrl);

let garageId: string;
let dacia: string;
let bmw: string;
let tesla: string;
let actorId: string;

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
  actorId = await account('mihai', ['garage']);
});
afterAll(() => prisma.$disconnect());

const write = (section: Record<string, unknown>, jobs: GarageJobRef[] = []) =>
  prisma.$transaction((tx) =>
    writeGarageBrands(tx, garageId, section, { actorId, audit, jobs }),
  );

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

describe("writing a garage's job ticks from step 2", () => {
  async function jobType(key: string, status: 'approved' | 'pending') {
    return (
      await prisma.jobType.create({
        data: {
          key: `${key}-${randomUUID()}`,
          nameEn: key,
          nameRo: key,
          status,
        },
      })
    ).id;
  }

  // Oil change and front brakes from the catalogue, and the proposed
  // "Reglaj faruri" that the price step sent as a name.
  async function jobs() {
    const oil = await jobType('oil', 'approved');
    const brakes = await jobType('brakes', 'approved');
    const lights = await jobType('Reglaj faruri', 'pending');
    const given: GarageJobRef[] = [
      { jobTypeId: oil },
      { jobTypeId: brakes },
      { jobTypeId: lights, name: 'Reglaj faruri' },
    ];
    return { brakes, given, lights, oil };
  }

  const ticks = async () =>
    (
      await prisma.garageBrandJob.findMany({
        select: { brandId: true, jobTypeId: true },
        where: { garageId },
      })
    )
      .map((r) => `${r.brandId} ${r.jobTypeId}`)
      .sort();

  const entries = () =>
    prisma.activityLog.findMany({
      where: { garageId, subjectType: 'garage_brand_job' },
    });

  // @traces 412-FR-005
  it('writes a row for every job of each taken brand but the unticked ones', async () => {
    const { brakes, given, lights, oil } = await jobs();

    await write(
      {
        brands: [
          {
            brandId: dacia,
            name: 'Dacia',
            stance: 'works_on',
            unticked: [oil.toUpperCase()],
          },
          { brandId: bmw, name: 'BMW', stance: 'works_on' },
          { brandId: tesla, name: 'Tesla', stance: 'does_not_take' },
        ],
      },
      given,
    );

    expect(await ticks()).toEqual(
      [
        `${dacia} ${brakes}`,
        `${dacia} ${lights}`,
        `${bmw} ${oil}`,
        `${bmw} ${brakes}`,
        `${bmw} ${lights}`,
      ].sort(),
    );
  });

  // @traces 412-FR-005
  it('matches an unticked proposed job by its name', async () => {
    const { brakes, given, oil } = await jobs();

    await write(
      {
        brands: [
          {
            brandId: dacia,
            name: 'Dacia',
            stance: 'works_on',
            unticked: ['Reglaj faruri'],
          },
        ],
      },
      given,
    );

    expect(await ticks()).toEqual(
      [`${dacia} ${oil}`, `${dacia} ${brakes}`].sort(),
    );
  });

  // @traces 412-FR-006
  it('records one create entry per row, by the sending account as the garage', async () => {
    const { brakes, given, oil } = await jobs();

    await write(
      {
        brands: [
          {
            brandId: dacia,
            name: 'Dacia',
            stance: 'works_on',
            unticked: ['Reglaj faruri'],
          },
        ],
      },
      given,
    );

    const written = await entries();
    expect(written.map((e) => e.subjectId).sort()).toEqual(
      [oil, brakes].sort(),
    );
    for (const entry of written) {
      expect(entry).toMatchObject({
        action: 'create',
        actorId,
        actorRole: 'owner',
        newValue: { brandId: dacia },
      });
    }
  });

  // @traces 412-FR-005
  it('refuses an unticked job that matches none of the jobs whole, writing nothing', async () => {
    const { given } = await jobs();

    const refused = await refusalOf(
      write(
        {
          brands: [
            { brandId: bmw, name: 'BMW', stance: 'works_on' },
            {
              brandId: dacia,
              name: 'Dacia',
              stance: 'works_on',
              unticked: ['Schimb ambreiaj'],
            },
          ],
        },
        given,
      ),
    );

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'unknown_job', field: 'brands[1].unticked' }],
    });
    expect((await stored()).brands).toEqual({});
    expect(await ticks()).toEqual([]);
    expect(await entries()).toEqual([]);
  });

  // @traces 412-FR-005
  it('refuses unticked jobs on a refused brand, writing nothing', async () => {
    const { given, oil } = await jobs();

    const refused = await refusalOf(
      write(
        {
          brands: [
            {
              brandId: tesla,
              name: 'Tesla',
              stance: 'does_not_take',
              unticked: [oil],
            },
          ],
        },
        given,
      ),
    );

    expect(refused.status).toBe(400);
    expect((await stored()).brands).toEqual({});
    expect(await entries()).toEqual([]);
  });

  // @traces 412-FR-005
  it('writes no row and no entry with no price list, and leaves the garage status alone', async () => {
    await write({
      brands: [{ brandId: dacia, name: 'Dacia', stance: 'works_on' }],
    });

    expect(await ticks()).toEqual([]);
    expect(await entries()).toEqual([]);
    expect(
      (
        await prisma.garage.findUniqueOrThrow({
          select: { status: true },
          where: { id: garageId },
        })
      ).status,
    ).toBe('draft');
  });

  // The prices step refuses a brand range for a brand not yet taken, so a
  // listing with brand ranges writes its brands, then its prices, then the
  // brands again with the jobs the prices returned.
  // @traces 412-FR-005
  it('writes the brands again after a brand range was priced, keeping the price', async () => {
    const { brakes, given, lights, oil } = await jobs();
    const section = {
      brands: [
        {
          brandId: dacia,
          name: 'Dacia',
          stance: 'works_on',
          unticked: [brakes],
        },
      ],
    };
    await write(section);
    await prisma.garagePrice.create({
      data: {
        brandId: dacia,
        fromBani: 30_000,
        garageId,
        jobTypeId: oil,
        position: 0,
        updatedBy: actorId,
      },
    });

    await write(section, given);

    expect(await ticks()).toEqual(
      [`${dacia} ${oil}`, `${dacia} ${lights}`].sort(),
    );
    expect(await prisma.garagePrice.count({ where: { garageId } })).toBe(1);
  });
});
