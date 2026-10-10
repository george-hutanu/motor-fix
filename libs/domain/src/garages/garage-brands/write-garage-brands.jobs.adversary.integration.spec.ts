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
let actorId: string;
let oil: string;
let brakes: string;
let pending: string;

async function brand(name: string) {
  const key = `${name.toLowerCase()}-${randomUUID()}`;
  return (await prisma.brand.create({ data: { key, name, slug: key } })).id;
}

async function job(key: string, status: 'approved' | 'pending' = 'approved') {
  return (
    await prisma.jobType.create({
      data: { key: `${key}-${randomUUID()}`, nameEn: key, nameRo: key, status },
    })
  ).id;
}

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
  dacia = await brand('Dacia');
  bmw = await brand('BMW');
  actorId = await account('mihai', ['garage']);
  oil = await job('oil');
  brakes = await job('brakes');
  pending = await job('headlights', 'pending');
});
afterAll(() => prisma.$disconnect());

const priced = (): GarageJobRef[] => [
  { jobTypeId: oil },
  { jobTypeId: brakes },
  { jobTypeId: pending, name: 'Reglaj faruri' },
];

const write = (section: unknown, jobs: GarageJobRef[] = priced()) =>
  prisma.$transaction((tx) =>
    writeGarageBrands(tx, garageId, section, { actorId, audit, jobs }),
  );

const section = (...brands: Record<string, unknown>[]) => ({ brands });
const takenDacia = (extra: Record<string, unknown> = {}) => ({
  brandId: dacia,
  name: 'Dacia',
  stance: 'works_on',
  ...extra,
});
const takenBmw = (extra: Record<string, unknown> = {}) => ({
  brandId: bmw,
  name: 'BMW',
  stance: 'works_on',
  ...extra,
});

const ticks = async () =>
  (
    await prisma.garageBrandJob.findMany({
      select: { brandId: true, jobTypeId: true },
      where: { garageId },
    })
  )
    .map((r) => `${r.brandId}:${r.jobTypeId}`)
    .sort();
const keys = (pairs: [string, string][]) =>
  pairs.map(([b, j]) => `${b}:${j}`).sort();
const entries = () =>
  prisma.activityLog.findMany({
    where: { garageId, subjectType: 'garage_brand_job' },
  });

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
};

describe('the job ticks written with the listing brands', () => {
  it('gives a taken brand with no unticked key a row per job, once each', async () => {
    await write(section(takenDacia()));

    expect(await ticks()).toEqual(
      keys([
        [dacia, oil],
        [dacia, brakes],
        [dacia, pending],
      ]),
    );
    expect(await entries()).toHaveLength(3);
  });

  it('treats an empty unticked list as every job ticked', async () => {
    await write(section(takenDacia({ unticked: [] })));

    expect(await ticks()).toHaveLength(3);
  });

  it('writes no row and no entry when the price list holds no job', async () => {
    await write(section(takenDacia(), takenBmw()), []);

    expect(await ticks()).toEqual([]);
    expect(await entries()).toEqual([]);
    expect(await prisma.garageBrand.count({ where: { garageId } })).toBe(2);
  });

  it('writes no row when every job is unticked and still keeps the brand', async () => {
    await write(
      section(takenDacia({ unticked: [oil, brakes, 'Reglaj faruri'] })),
    );

    expect(await ticks()).toEqual([]);
    expect(await entries()).toEqual([]);
    expect(await prisma.garageBrand.count({ where: { garageId } })).toBe(1);
  });

  it('unticks per brand: the same job stays on the other brand', async () => {
    await write(section(takenDacia({ unticked: [oil] }), takenBmw()));

    expect(await ticks()).toEqual(
      keys([
        [dacia, brakes],
        [dacia, pending],
        [bmw, oil],
        [bmw, brakes],
        [bmw, pending],
      ]),
    );
  });

  it('matches an unticked uuid written in capitals', async () => {
    await write(section(takenDacia({ unticked: [oil.toUpperCase()] })));

    expect(await ticks()).toEqual(
      keys([
        [dacia, brakes],
        [dacia, pending],
      ]),
    );
  });

  it('matches a proposed name exactly and no other way', async () => {
    await write(section(takenDacia({ unticked: ['Reglaj faruri'] })));
    expect(await ticks()).toEqual(
      keys([
        [dacia, oil],
        [dacia, brakes],
      ]),
    );
  });

  it.each([
    ['a name in another case', 'reglaj faruri'],
    ['a name with a trailing space', 'Reglaj faruri '],
    ['a name nobody proposed', 'Cutie de viteze'],
    ['a uuid on no job of the garage', randomUUID()],
  ])('refuses %s whole, with nothing written', async (_, ref) => {
    const refusal = await refusalOf(
      write(section(takenBmw(), takenDacia({ unticked: [ref] }))),
    );

    expect(refusal.status).toBe(400);
    expect(refusal.body).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'unknown_job' }),
      ]),
    });
    expect(await ticks()).toEqual([]);
    expect(await entries()).toEqual([]);
    expect(await prisma.garageBrand.count({ where: { garageId } })).toBe(0);
  });

  it('does not match an unticked name against a catalogue job that has no name', async () => {
    const refusal = await refusalOf(
      write(section(takenDacia({ unticked: ['oil'] }))),
    );

    expect(refusal.status).toBe(400);
    expect(await ticks()).toEqual([]);
  });

  // The sending story writes the brands before the prices exist (jobs: []),
  // then again with the jobs the prices write returned; the first call must
  // keep the section's unticked refs for the second one to resolve.
  it('writes the brands and no tick against an empty price list, unticked refs and all', async () => {
    await write(section(takenDacia({ unticked: [oil] })), []);

    expect(await prisma.garageBrand.count({ where: { garageId } })).toBe(1);
    expect(await ticks()).toEqual([]);
  });

  it('refuses unticked on a refused brand and writes nothing', async () => {
    const refusal = await refusalOf(
      write(
        section({
          brandId: dacia,
          name: 'Dacia',
          stance: 'does_not_take',
          unticked: [oil],
        }),
      ),
    );

    expect(refusal.status).toBe(400);
    expect(await prisma.garageBrand.count({ where: { garageId } })).toBe(0);
  });

  it('gives a refused brand no row', async () => {
    await write(
      section(
        { brandId: dacia, name: 'Dacia', stance: 'does_not_take' },
        takenBmw(),
      ),
    );

    expect((await ticks()).every((t) => t.startsWith(bmw))).toBe(true);
    expect(await ticks()).toHaveLength(3);
  });

  it('counts a job listed twice by the prices write once', async () => {
    await write(section(takenDacia()), [
      { jobTypeId: oil },
      { jobTypeId: oil },
      { jobTypeId: brakes },
    ]);

    expect(await ticks()).toEqual(
      keys([
        [dacia, oil],
        [dacia, brakes],
      ]),
    );
    expect(await entries()).toHaveLength(2);
  });

  it('records one create entry per row with the brand, the actor and the role', async () => {
    await write(section(takenDacia({ unticked: [brakes] })));

    const log = await entries();
    expect(log).toHaveLength(2);
    expect(log.map((e) => e.subjectId).sort()).toEqual([oil, pending].sort());
    for (const entry of log) {
      expect(entry).toMatchObject({
        action: 'create',
        actorId,
        actorRole: 'owner',
        garageId,
        newValue: { brandId: dacia },
        subjectType: 'garage_brand_job',
      });
    }
  });

  it('handles fifty jobs with fifty unticked on one brand', async () => {
    const many = await Promise.all(
      Array.from({ length: 50 }, (_, i) => job(`bulk-${i}`)),
    );
    const refs = many.map((jobTypeId) => ({ jobTypeId }));

    await write(section(takenDacia({ unticked: many }), takenBmw()), refs);

    expect((await ticks()).every((t) => t.startsWith(bmw))).toBe(true);
    expect(await ticks()).toHaveLength(50);
  });

  it('refuses fifty-one unticked refs at the guard', async () => {
    const refs = Array.from({ length: 51 }, () => randomUUID());

    const refusal = await refusalOf(
      write(section(takenDacia({ unticked: refs }))),
    );

    expect(refusal.status).toBe(400);
    expect(await ticks()).toEqual([]);
  });

  it('refuses the same unticked job twice', async () => {
    const refusal = await refusalOf(
      write(section(takenDacia({ unticked: [oil, oil.toUpperCase()] }))),
    );

    expect(refusal.status).toBe(400);
    expect(await ticks()).toEqual([]);
  });

  it('leaves the same rows when the same section is written twice', async () => {
    const body = section(takenDacia({ unticked: [oil] }));
    await write(body);
    const first = await ticks();

    await write(body);

    expect(await ticks()).toEqual(first);
  });

  it('removes the rows of a brand that a later write refuses', async () => {
    await write(section(takenDacia()));

    await write(
      section({ brandId: dacia, name: 'Dacia', stance: 'does_not_take' }),
    );

    expect(await ticks()).toEqual([]);
  });
});
