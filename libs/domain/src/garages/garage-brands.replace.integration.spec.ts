import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { GarageBrandsService } from './garage-brands.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/policy';
import { serialDatabase } from '../auth/serial-db.testing';
import { outbox } from '../events/event.port';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

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

const history = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: {
      // The log is append-only and shared: another spec's future-dated rows
      // stay in it, so only what was written up to now is this test's.
      at: { gte: since, lte: new Date() },
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
        { id: w.mini, name: 'Mini', slug: 'mini' },
        { id: w.bmw, name: 'BMW', slug: 'bmw' },
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
    expect((await history()).find((e) => e.field === 'stance')).toMatchObject({
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
    const removal = (await history()).find(
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
    const changes = (await history()).filter((e) => e.subjectType === 'garage');
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

    expect(await history()).toEqual([]);
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
    expect(await history()).toEqual([]);
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
    expect(await history()).toEqual([]);
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
