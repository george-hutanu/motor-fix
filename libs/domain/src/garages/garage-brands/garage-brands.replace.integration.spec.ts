import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { GarageBrandsService } from './garage-brands.service';
import { AuditService } from '../../audit/audit.service';
import { foreignEntries } from '../../audit/audit.testing';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// @traces 040-FR-008 040-FR-010 040-FR-011

type Stance = 'works_on' | 'does_not_take';

const { account, prisma } = fixtures();
const brands = new GarageBrandsService(prisma, new AuditService(), outbox);
serialDatabase(databaseUrl);

let since: Date;
// The outbox stamps an event at its transaction's start, to the millisecond:
// a later event is told by its id.
let mark = 0n;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, brand, garage CASCADE');
  await checkpoint();
});

async function checkpoint() {
  since = await now();
  mark =
    (await prisma.outboxEvent.aggregate({ _max: { id: true } }))._max.id ?? 0n;
  await foreignEntries(prisma, [
    { subjectType: 'garage' },
    { subjectType: 'garage_brand' },
    { subjectType: 'garage_brand_job' },
  ]);
}

async function now() {
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  return at;
}

afterAll(async () => {
  await prisma.$disconnect();
});

const none = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

async function brand(name: string, extra: { active?: boolean } = {}) {
  const key = name.toLowerCase();
  return (
    await prisma.brand.create({ data: { key, name, slug: key, ...extra } })
  ).id;
}

// Service Auto Nord, approved, with its owner Mihai, a receptionist and a
// mechanic; BMW, Mini, Tesla and Lada in the catalogue, Lada retired.
async function world() {
  const garage = await prisma.garage.create({
    data: {
      name: 'Service Auto Nord',
      slug: `nord-${randomUUID()}`,
      status: 'approved',
    },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: garage.id, role: 'owner' },
  });
  const owner: Actor = {
    accountId: mihai,
    garageId: garage.id,
    permissions: none,
    role: 'garage',
    roles: ['garage'],
  };
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: garage.id, role: 'receptionist' },
  });
  const receptionist: Actor = {
    ...owner,
    accountId: ioana,
    role: 'receptionist',
    roles: ['receptionist'],
  };
  return {
    bmw: await brand('BMW'),
    garage: garage.id,
    lada: await brand('Lada', { active: false }),
    mini: await brand('Mini'),
    owner,
    receptionist,
    tesla: await brand('Tesla'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const set = (
  w: World,
  marks: [string, Stance][],
  texts: { brandNote?: string; refusalPhrase?: string } = {},
  actor: Actor = w.owner,
) =>
  brands.replace(actor, w.garage, {
    brands: marks.map(([brandId, stance]) => ({ brandId, stance })),
    ...texts,
  });

type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';

const setFuels = (
  w: World,
  marks: { brandId: string; stance: Stance; fuels?: Fuel[] }[],
) => brands.replace(w.owner, w.garage, { brands: marks });

const fuelsOf = (w: World, brandId: string) =>
  prisma.garageBrand.findUniqueOrThrow({
    select: { diesel: true, electric: true, hybrid: true, petrol: true },
    where: { garageId_brandId: { brandId, garageId: w.garage } },
  });

const rows = async (w: World) =>
  Object.fromEntries(
    (
      await prisma.garageBrand.findMany({
        select: { brandId: true, stance: true },
        where: { garageId: w.garage },
      })
    ).map((r) => [r.brandId, r.stance]),
  );

const texts = (w: World) =>
  prisma.garage.findUniqueOrThrow({
    select: { brandNote: true, refusalPhrase: true, status: true },
    where: { id: w.garage },
  });

const history = (w: World) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: {
      at: { gte: since },
      garageId: w.garage,
      subjectType: { in: ['garage', 'garage_brand', 'garage_brand_job'] },
    },
  });

const events = () =>
  prisma.outboxEvent.findMany({
    where: { id: { gt: mark }, kind: 'garage.updated' },
  });

async function status(run: Promise<unknown>) {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

const every = { diesel: true, electric: true, hybrid: true, petrol: true };

describe("replacing a garage's brand answer", () => {
  it('stores exactly the marked brands with their stance and the two texts', async () => {
    const w = await world();

    await set(
      w,
      [
        [w.bmw, 'works_on'],
        [w.mini, 'works_on'],
        [w.tesla, 'does_not_take'],
      ],
      {
        brandNote: 'Fără mașini 100% electrice',
        refusalPhrase: 'orice nu e BMW',
      },
    );

    expect(await rows(w)).toEqual({
      [w.bmw]: 'works_on',
      [w.mini]: 'works_on',
      [w.tesla]: 'does_not_take',
    });
    expect(await texts(w)).toEqual({
      brandNote: 'Fără mașini 100% electrice',
      refusalPhrase: 'orice nu e BMW',
      status: 'approved',
    });
  });

  it('answers with the stored lists, in catalogue order, and the texts', async () => {
    const w = await world();
    await prisma.brand.update({
      data: { popularity: 1 },
      where: { id: w.mini },
    });
    await prisma.brand.update({
      data: { popularity: 2 },
      where: { id: w.bmw },
    });

    const answer = await set(
      w,
      [
        [w.bmw, 'works_on'],
        [w.mini, 'works_on'],
        [w.tesla, 'does_not_take'],
      ],
      { refusalPhrase: 'orice nu e BMW' },
    );

    expect(answer).toEqual({
      brandNote: null,
      doesNotTake: [{ id: w.tesla, name: 'Tesla', slug: 'tesla' }],
      refusalPhrase: 'orice nu e BMW',
      worksOn: [
        { id: w.mini, jobs: [], name: 'Mini', slug: 'mini' },
        { id: w.bmw, jobs: [], name: 'BMW', slug: 'bmw' },
      ],
    });
  });

  it('turns a refused brand taken, with all four fuels, and audits the change', async () => {
    const w = await world();
    await set(w, [[w.tesla, 'does_not_take']]);
    await checkpoint();

    await set(w, [[w.tesla, 'works_on']]);

    expect(
      await prisma.garageBrand.findUniqueOrThrow({
        where: { garageId_brandId: { brandId: w.tesla, garageId: w.garage } },
      }),
    ).toMatchObject({
      diesel: true,
      electric: true,
      hybrid: true,
      petrol: true,
      stance: 'works_on',
    });
    expect((await history(w)).find((e) => e.field === 'stance')).toMatchObject({
      action: 'update',
      actorId: w.owner.accountId,
      actorRole: 'owner',
      garageId: w.garage,
      newValue: 'works_on',
      oldValue: 'does_not_take',
      subjectId: w.tesla,
    });
  });

  it('switches off a brand left out of the set: its row and its jobs go, audited', async () => {
    const w = await world();
    await set(w, [
      [w.bmw, 'works_on'],
      [w.mini, 'works_on'],
    ]);
    await prisma.garageBrandJob.create({
      data: { brandId: w.bmw, garageId: w.garage, jobTypeId: randomUUID() },
    });
    await checkpoint();

    await set(w, [[w.mini, 'works_on']]);

    expect(await rows(w)).toEqual({ [w.mini]: 'works_on' });
    expect(await brands.stanceFor(w.garage, w.bmw)).toBe('unstated');
    expect(
      await prisma.garageBrandJob.count({ where: { garageId: w.garage } }),
    ).toBe(0);
    const removal = (await history(w)).find(
      (e) => e.subjectType === 'garage_brand' && e.action === 'delete',
    );
    expect(removal).toMatchObject({
      actorId: w.owner.accountId,
      actorRole: 'owner',
      garageId: w.garage,
      subjectId: w.bmw,
    });
    expect(removal?.oldValue).toMatchObject({ stance: 'works_on' });
  });

  it('audits a changed note and a cleared phrase', async () => {
    const w = await world();
    await set(w, [], {
      brandNote: 'Doar benzină',
      refusalPhrase: 'orice nu e BMW',
    });
    await checkpoint();

    await set(w, [], { brandNote: 'Doar diesel' });

    expect(await texts(w)).toMatchObject({
      brandNote: 'Doar diesel',
      refusalPhrase: null,
    });
    const changes = (await history(w)).filter(
      (e) => e.subjectType === 'garage',
    );
    expect(
      changes.map((e) => [e.field, e.oldValue, e.newValue]).sort(),
    ).toEqual([
      ['brandNote', 'Doar benzină', 'Doar diesel'],
      ['refusalPhrase', 'orice nu e BMW', null],
    ]);
  });

  it('saves one garage.updated event naming brands, for the garage, its page and each changed search', async () => {
    const w = await world();
    await set(w, [[w.bmw, 'works_on']]);
    await checkpoint();

    await set(w, [
      [w.mini, 'works_on'],
      [w.bmw, 'works_on'],
      [w.tesla, 'does_not_take'],
    ]);

    const saved = await events();
    expect(saved).toHaveLength(1);
    expect(saved[0].subjectId).toBe(w.garage);
    expect(saved[0].payload).toMatchObject({
      fields: ['brands'],
      garageId: w.garage,
    });
    expect([...saved[0].audience].sort()).toEqual(
      [
        `garage:${w.garage}`,
        `public:garage:${w.garage}`,
        `public:search:${w.mini}`,
        `public:search:${w.tesla}`,
      ].sort(),
    );
  });

  it('records nothing and emits nothing when the set equals what is stored', async () => {
    const w = await world();
    const marks: [string, Stance][] = [
      [w.bmw, 'works_on'],
      [w.tesla, 'does_not_take'],
    ];
    await set(w, marks, { brandNote: 'Doar benzină' });
    await checkpoint();

    await set(w, marks, { brandNote: 'Doar benzină' });

    expect(await history(w)).toEqual([]);
    expect(await events()).toEqual([]);
  });

  it('takes a stored brand sent with its id in capitals as the same brand', async () => {
    const w = await world();
    await set(w, [[w.bmw, 'works_on']]);
    await prisma.garageBrandJob.create({
      data: { brandId: w.bmw, garageId: w.garage, jobTypeId: randomUUID() },
    });
    await checkpoint();

    await set(w, [[w.bmw.toUpperCase(), 'works_on']]);

    expect(await rows(w)).toEqual({ [w.bmw]: 'works_on' });
    expect(
      await prisma.garageBrandJob.count({ where: { garageId: w.garage } }),
    ).toBe(1);
    expect(await history(w)).toEqual([]);
    expect(await events()).toEqual([]);
  });

  it('accepts a retired brand', async () => {
    const w = await world();

    await set(w, [[w.lada, 'works_on']]);

    expect(await rows(w)).toEqual({ [w.lada]: 'works_on' });
  });

  it('refuses the whole set with 400 when one brand is not in the catalogue, changing nothing', async () => {
    const w = await world();
    await set(w, [[w.bmw, 'works_on']], { brandNote: 'Doar benzină' });
    await checkpoint();

    expect(
      await status(
        set(
          w,
          [
            [w.mini, 'works_on'],
            [randomUUID(), 'works_on'],
          ],
          {
            brandNote: 'Altceva',
          },
        ),
      ),
    ).toBe(400);

    expect(await rows(w)).toEqual({ [w.bmw]: 'works_on' });
    expect((await texts(w)).brandNote).toBe('Doar benzină');
    expect(await history(w)).toEqual([]);
    expect(await events()).toEqual([]);
  });

  it("answers 403 to the garage's receptionist and 404 to another garage's owner, changing nothing", async () => {
    const w = await world();
    const other: Actor = { ...w.owner, garageId: randomUUID() };

    expect(
      await status(set(w, [[w.bmw, 'works_on']], {}, w.receptionist)),
    ).toBe(403);
    expect(await status(set(w, [[w.bmw, 'works_on']], {}, other))).toBe(404);
    expect(
      await status(
        set(
          w,
          [[w.bmw, 'works_on']],
          {},
          { ...w.owner, garageId: null, role: 'admin', roles: ['admin'] },
        ),
      ),
    ).toBe(404);

    expect(await rows(w)).toEqual({});
    expect(await events()).toEqual([]);
  });

  it('leaves the garage status untouched, also for a garage not yet approved', async () => {
    const w = await world();
    await prisma.garage.update({
      data: { status: 'draft' },
      where: { id: w.garage },
    });

    await set(w, [[w.bmw, 'works_on']]);

    expect((await texts(w)).status).toBe('draft');
    expect(await rows(w)).toEqual({ [w.bmw]: 'works_on' });
  });

  it('runs two writes at once one after the other, so one set wins whole', async () => {
    const w = await world();
    const first: [string, Stance][] = [
      [w.bmw, 'works_on'],
      [w.mini, 'does_not_take'],
    ];
    const second: [string, Stance][] = [
      [w.tesla, 'works_on'],
      [w.mini, 'works_on'],
    ];

    await Promise.all([set(w, first), set(w, second)]);

    expect([
      { [w.bmw]: 'works_on', [w.mini]: 'does_not_take' },
      { [w.mini]: 'works_on', [w.tesla]: 'works_on' },
    ]).toContainEqual(await rows(w));
    expect(await events()).toHaveLength(2);
  });
});

describe("a taken brand's fuels in the brand answer", () => {
  it('sets the four fuel columns of a newly taken brand from its fuels', async () => {
    const w = await world();

    await setFuels(w, [
      { brandId: w.bmw, fuels: ['petrol', 'diesel'], stance: 'works_on' },
    ]);

    expect(await fuelsOf(w, w.bmw)).toEqual({
      diesel: true,
      electric: false,
      hybrid: false,
      petrol: true,
    });
  });

  it('keeps the fuels of a brand already taken when its fuels are left out', async () => {
    const w = await world();
    await setFuels(w, [
      { brandId: w.bmw, fuels: ['petrol'], stance: 'works_on' },
    ]);
    await checkpoint();

    await setFuels(w, [{ brandId: w.bmw, stance: 'works_on' }]);

    expect(await fuelsOf(w, w.bmw)).toEqual({
      diesel: false,
      electric: false,
      hybrid: false,
      petrol: true,
    });
    expect(await history(w)).toEqual([]);
    expect(await events()).toEqual([]);
  });

  it('unticks all four fuels with an empty list', async () => {
    const w = await world();
    await set(w, [[w.bmw, 'works_on']]);

    await setFuels(w, [{ brandId: w.bmw, fuels: [], stance: 'works_on' }]);

    expect(await fuelsOf(w, w.bmw)).toEqual({
      diesel: false,
      electric: false,
      hybrid: false,
      petrol: false,
    });
  });

  it('refuses fuels on a refused brand with 400 validation_failed, changing nothing', async () => {
    const w = await world();
    await set(w, [[w.bmw, 'works_on']]);
    await checkpoint();

    const error = await setFuels(w, [
      { brandId: w.bmw, stance: 'works_on' },
      { brandId: w.tesla, fuels: ['electric'], stance: 'does_not_take' },
    ]).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'validation_failed',
    });
    expect(await rows(w)).toEqual({ [w.bmw]: 'works_on' });
    expect(await history(w)).toEqual([]);
    expect(await events()).toEqual([]);
  });

  it('records a newly taken brand as one create entry carrying its fuels', async () => {
    const w = await world();

    await setFuels(w, [
      { brandId: w.bmw, fuels: ['electric'], stance: 'works_on' },
    ]);

    const entries = (await history(w)).filter(
      (e) => e.subjectType === 'garage_brand' && e.subjectId === w.bmw,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: w.owner.accountId,
      newValue: {
        diesel: false,
        electric: true,
        hybrid: false,
        petrol: false,
        stance: 'works_on',
      },
    });
  });

  it('records one entry per changed fuel of a brand already taken', async () => {
    const w = await world();
    await set(w, [[w.bmw, 'works_on']]);
    expect(await fuelsOf(w, w.bmw)).toEqual(every);
    await checkpoint();

    await setFuels(w, [
      { brandId: w.bmw, fuels: ['petrol', 'diesel'], stance: 'works_on' },
    ]);

    const entries = await history(w);
    expect(
      entries
        .map((e) => [e.subjectType, e.field, e.oldValue, e.newValue])
        .sort(),
    ).toEqual([
      ['garage_brand', 'electric', true, false],
      ['garage_brand', 'hybrid', true, false],
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        actorId: w.owner.accountId,
        actorRole: 'owner',
        garageId: w.garage,
        subjectId: w.bmw,
      });
    }
  });

  it('names brand_fuels in the one event when only a fuel changed', async () => {
    const w = await world();
    await set(w, [[w.bmw, 'works_on']]);
    await checkpoint();

    await setFuels(w, [
      { brandId: w.bmw, fuels: ['petrol'], stance: 'works_on' },
    ]);

    const saved = await events();
    expect(saved).toHaveLength(1);
    expect(saved[0].payload).toMatchObject({
      fields: ['brand_fuels'],
      garageId: w.garage,
    });
  });

  it('names brands and brand_fuels in the one event when a stance and a fuel changed', async () => {
    const w = await world();
    await set(w, [[w.bmw, 'works_on']]);
    await checkpoint();

    await setFuels(w, [
      { brandId: w.bmw, fuels: ['petrol'], stance: 'works_on' },
      { brandId: w.mini, stance: 'works_on' },
    ]);

    const saved = await events();
    expect(saved).toHaveLength(1);
    expect(
      [...(saved[0].payload as { fields: string[] }).fields].sort(),
    ).toEqual(['brand_fuels', 'brands']);
  });
});

describe("a taken brand's jobs in the brand answer", () => {
  async function jobType(key: string) {
    return (
      await prisma.jobType.create({
        data: { key, nameEn: key, nameRo: key, status: 'approved' },
      })
    ).id;
  }

  // Oil, brakes and gearbox on the price list in that order; oil also has a
  // BMW range, which lists it once.
  async function priced(w: World) {
    const oil = await jobType(`oil-${randomUUID()}`);
    const brakes = await jobType(`brakes-${randomUUID()}`);
    const gearbox = await jobType(`gearbox-${randomUUID()}`);
    const price = (jobTypeId: string, position: number, brandId?: string) => ({
      brandId,
      fromBani: 30_000,
      garageId: w.garage,
      jobTypeId,
      position,
      updatedBy: w.owner.accountId,
    });
    await prisma.garagePrice.createMany({
      data: [
        price(oil, 0),
        price(oil, 1, w.bmw),
        price(brakes, 2),
        price(gearbox, 3),
      ],
    });
    return { brakes, gearbox, oil };
  }

  const setJobs = (
    w: World,
    marks: { brandId: string; stance: Stance; jobs?: string[] }[],
  ) => brands.replace(w.owner, w.garage, { brands: marks });

  const ticks = async (w: World, brandId: string) =>
    (
      await prisma.garageBrandJob.findMany({
        select: { jobTypeId: true },
        where: { brandId, garageId: w.garage },
      })
    )
      .map((r) => r.jobTypeId)
      .sort();

  const jobEntries = async (w: World) =>
    (await history(w)).filter((e) => e.subjectType === 'garage_brand_job');

  async function refused(run: Promise<unknown>) {
    const error = await run.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpException);
    return {
      body: (error as HttpException).getResponse(),
      status: (error as HttpException).getStatus(),
    };
  }

  // @traces 412-FR-007 412-FR-008
  it('ticks exactly the jobs sent: one left out loses its row, audited, and the one event names brand_jobs', async () => {
    const w = await world();
    const { brakes, gearbox, oil } = await priced(w);
    await set(w, [[w.bmw, 'works_on']]);
    await checkpoint();

    await setJobs(w, [
      { brandId: w.bmw, jobs: [oil, gearbox], stance: 'works_on' },
    ]);

    expect(await ticks(w, w.bmw)).toEqual([gearbox, oil].sort());
    const entries = await jobEntries(w);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'delete',
      actorId: w.owner.accountId,
      actorRole: 'owner',
      garageId: w.garage,
      oldValue: { brandId: w.bmw },
      subjectId: brakes,
    });
    const saved = await events();
    expect(saved).toHaveLength(1);
    expect(saved[0].payload).toMatchObject({
      brandIds: [w.bmw],
      fields: ['brand_jobs'],
      garageId: w.garage,
    });
  });

  // @traces 412-FR-008
  it('records one create entry for a job ticked again', async () => {
    const w = await world();
    const { brakes, oil } = await priced(w);
    await setJobs(w, [{ brandId: w.bmw, jobs: [oil], stance: 'works_on' }]);
    await checkpoint();

    await setJobs(w, [
      { brandId: w.bmw, jobs: [oil, brakes], stance: 'works_on' },
    ]);

    expect(await ticks(w, w.bmw)).toEqual([brakes, oil].sort());
    const entries = await jobEntries(w);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: w.owner.accountId,
      newValue: { brandId: w.bmw },
      subjectId: brakes,
    });
  });

  // @traces 412-FR-007
  it('leaves the ticks of a brand already taken as they are when jobs are left out, recording nothing', async () => {
    const w = await world();
    const { oil } = await priced(w);
    await setJobs(w, [{ brandId: w.bmw, jobs: [oil], stance: 'works_on' }]);
    await checkpoint();

    await setJobs(w, [{ brandId: w.bmw, stance: 'works_on' }]);

    expect(await ticks(w, w.bmw)).toEqual([oil]);
    expect(await history(w)).toEqual([]);
    expect(await events()).toEqual([]);
  });

  // @traces 412-FR-007
  it('gives a newly taken brand every job of the price list when jobs are left out, and none for an empty list', async () => {
    const w = await world();
    const { brakes, gearbox, oil } = await priced(w);

    await setJobs(w, [
      { brandId: w.bmw, stance: 'works_on' },
      { brandId: w.mini, jobs: [], stance: 'works_on' },
    ]);

    expect(await ticks(w, w.bmw)).toEqual([brakes, gearbox, oil].sort());
    expect(await ticks(w, w.mini)).toEqual([]);
  });

  // @traces 412-FR-007
  it('deletes every tick of a taken brand for an empty list, each audited', async () => {
    const w = await world();
    await priced(w);
    await set(w, [[w.bmw, 'works_on']]);
    await checkpoint();

    await setJobs(w, [{ brandId: w.bmw, jobs: [], stance: 'works_on' }]);

    expect(await ticks(w, w.bmw)).toEqual([]);
    expect((await jobEntries(w)).map((e) => e.action)).toEqual([
      'delete',
      'delete',
      'delete',
    ]);
  });

  // @traces 412-FR-007
  it('refuses jobs on a refused brand with jobs_on_refused, changing nothing', async () => {
    const w = await world();
    const { oil } = await priced(w);
    await set(w, [[w.bmw, 'works_on']]);
    await checkpoint();

    const answer = await refused(
      setJobs(w, [
        { brandId: w.bmw, jobs: [oil], stance: 'works_on' },
        { brandId: w.tesla, jobs: [oil], stance: 'does_not_take' },
      ]),
    );

    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'jobs_on_refused', field: 'brands[1].jobs' }],
    });
    expect(await rows(w)).toEqual({ [w.bmw]: 'works_on' });
    expect(await ticks(w, w.bmw)).toHaveLength(3);
    expect(await history(w)).toEqual([]);
    expect(await events()).toEqual([]);
  });

  // @traces 412-FR-007
  it('refuses a job the price list does not hold with job_not_priced, changing nothing', async () => {
    const w = await world();
    const { oil } = await priced(w);
    const unpriced = await jobType(`clutch-${randomUUID()}`);
    await set(w, [[w.bmw, 'works_on']]);
    await checkpoint();

    const answer = await refused(
      setJobs(w, [
        { brandId: w.bmw, jobs: [oil, unpriced], stance: 'works_on' },
      ]),
    );

    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'job_not_priced', field: 'brands[0].jobs' }],
    });
    expect(await ticks(w, w.bmw)).toHaveLength(3);
    expect(await history(w)).toEqual([]);
    expect(await events()).toEqual([]);
  });

  // @traces 412-FR-009
  it('removes the ticks of a brand turned refused, one entry each', async () => {
    const w = await world();
    const { brakes, oil } = await priced(w);
    await setJobs(w, [
      { brandId: w.bmw, jobs: [oil, brakes], stance: 'works_on' },
    ]);
    await checkpoint();

    await set(w, [[w.bmw, 'does_not_take']]);

    expect(await ticks(w, w.bmw)).toEqual([]);
    expect(
      (await jobEntries(w)).map((e) => [e.action, e.subjectId]).sort(),
    ).toEqual(
      [
        ['delete', brakes],
        ['delete', oil],
      ].sort(),
    );
  });

  // @traces 412-FR-008
  it('writes no entry and no event when the ticks sent equal the stored ones, in any order', async () => {
    const w = await world();
    const { gearbox, oil } = await priced(w);
    await setJobs(w, [
      { brandId: w.bmw, jobs: [oil, gearbox], stance: 'works_on' },
    ]);
    await checkpoint();

    await setJobs(w, [
      {
        brandId: w.bmw.toUpperCase(),
        jobs: [gearbox.toUpperCase(), oil],
        stance: 'works_on',
      },
    ]);

    expect(await ticks(w, w.bmw)).toEqual([gearbox, oil].sort());
    expect(await history(w)).toEqual([]);
    expect(await events()).toEqual([]);
  });

  // @traces 412-FR-010
  it('leaves the garage status as it was after a tick change', async () => {
    const w = await world();
    const { oil } = await priced(w);
    await prisma.garage.update({
      data: { status: 'draft' },
      where: { id: w.garage },
    });
    await set(w, [[w.bmw, 'works_on']]);

    await setJobs(w, [{ brandId: w.bmw, jobs: [oil], stance: 'works_on' }]);

    expect((await texts(w)).status).toBe('draft');
  });

  // @traces 412-FR-008
  it('answers each taken brand with its ticked jobs in price-list order', async () => {
    const w = await world();
    const { brakes, gearbox, oil } = await priced(w);

    const answer = await setJobs(w, [
      { brandId: w.bmw, jobs: [gearbox, oil], stance: 'works_on' },
      { brandId: w.mini, stance: 'works_on' },
      { brandId: w.tesla, stance: 'does_not_take' },
    ]);

    expect(answer.worksOn).toEqual(
      expect.arrayContaining([
        { id: w.bmw, jobs: [oil, gearbox], name: 'BMW', slug: 'bmw' },
        {
          id: w.mini,
          jobs: [oil, brakes, gearbox],
          name: 'Mini',
          slug: 'mini',
        },
      ]),
    );
    expect(answer.doesNotTake).toEqual([
      { id: w.tesla, name: 'Tesla', slug: 'tesla' },
    ]);
  });
});
