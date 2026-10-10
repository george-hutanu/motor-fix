import { randomUUID } from 'node:crypto';

import { GarageBrandsService } from './garage-brands.service';
import { AuditService } from '../../audit/audit.service';
import { foreignEntries } from '../../audit/audit.testing';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { noEvents } from '../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { until } from '../../waits.testing';

const { account, prisma } = fixtures();
const brands = new GarageBrandsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let since: Date;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, brand, garage CASCADE');
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
  await foreignEntries(prisma, [
    { subjectType: 'garage_brand' },
    { subjectType: 'garage_brand_job' },
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Service Auto Nord and its owner Mihai; Dacia and Tesla in the catalogue.
async function world() {
  const garage = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  });
  const mihai = await account('Mihai Ionescu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: garage.id, role: 'owner' },
  });
  const dacia = await prisma.brand.create({
    data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
  });
  const tesla = await prisma.brand.create({
    data: { key: 'tesla', name: 'Tesla', slug: 'tesla' },
  });
  const actor: Actor = {
    accountId: mihai,
    garageId: garage.id,
    permissions: {
      canAnswerQuotes: false,
      canMoveBookings: false,
      canRecordFinalPrice: false,
    },
    role: 'garage',
    roles: ['garage'],
  };
  return { actor, dacia: dacia.id, garage: garage.id, mihai, tesla: tesla.id };
}

type World = Awaited<ReturnType<typeof world>>;

const setStance = (
  w: World,
  brandId: string,
  stance: 'works_on' | 'does_not_take',
) =>
  prisma.$transaction((tx) =>
    brands.setStance(tx, w.actor, w.garage, brandId, stance),
  );

// A job row written straight, as the PUT's createMany leaves it.
const seedJob = (w: World, brandId: string, jobTypeId: string) =>
  prisma.garageBrandJob.create({
    data: { brandId, garageId: w.garage, jobTypeId },
  });

const row = (w: World, brandId: string) =>
  prisma.garageBrand.findUniqueOrThrow({
    where: { garageId_brandId: { brandId, garageId: w.garage } },
  });

const history = (w: World) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: {
      at: { gte: since },
      garageId: w.garage,
      subjectType: { in: ['garage_brand', 'garage_brand_job'] },
    },
  });

describe('GarageBrandsService', () => {
  it('answers unstated for a brand the garage has said nothing about', async () => {
    const w = await world();

    expect(await brands.stanceFor(w.garage, w.dacia)).toBe('unstated');
  });

  it('answers works_on and does_not_take as the garage set them', async () => {
    const w = await world();
    await setStance(w, w.dacia, 'works_on');
    await setStance(w, w.tesla, 'does_not_take');

    expect(await brands.stanceFor(w.garage, w.dacia)).toBe('works_on');
    expect(await brands.stanceFor(w.garage, w.tesla)).toBe('does_not_take');
  });

  it('ticks the four fuels on a brand first marked as worked on', async () => {
    const w = await world();

    await setStance(w, w.dacia, 'works_on');

    expect(await row(w, w.dacia)).toMatchObject({
      diesel: true,
      electric: true,
      hybrid: true,
      petrol: true,
    });
  });

  it('keeps no fuel ticked on a brand the garage does not take', async () => {
    const w = await world();

    await setStance(w, w.tesla, 'does_not_take');

    expect(await row(w, w.tesla)).toMatchObject({
      diesel: false,
      electric: false,
      hybrid: false,
      petrol: false,
    });
  });

  it('refuses a fuel tick on a brand the garage does not take', async () => {
    const w = await world();
    await setStance(w, w.tesla, 'does_not_take');

    await expect(
      prisma.garageBrand.update({
        data: { electric: true },
        where: { garageId_brandId: { brandId: w.tesla, garageId: w.garage } },
      }),
    ).rejects.toThrow(/garage_brand_fuel_check/);
  });

  it('keeps one row per garage and brand', async () => {
    const w = await world();
    await setStance(w, w.dacia, 'works_on');
    await setStance(w, w.dacia, 'does_not_take');

    expect(
      await prisma.garageBrand.count({ where: { garageId: w.garage } }),
    ).toBe(1);
  });

  it('clears the fuels and the jobs of a brand the garage stops taking', async () => {
    const w = await world();
    await setStance(w, w.dacia, 'works_on');
    await seedJob(w, w.dacia, randomUUID());
    await seedJob(w, w.dacia, randomUUID());

    await setStance(w, w.dacia, 'does_not_take');

    expect(await row(w, w.dacia)).toMatchObject({
      diesel: false,
      electric: false,
      hybrid: false,
      petrol: false,
      stance: 'does_not_take',
    });
    expect(await prisma.garageBrandJob.count()).toBe(0);
  });

  it('ticks the four fuels again on a brand the garage takes back', async () => {
    const w = await world();
    await setStance(w, w.tesla, 'does_not_take');

    await setStance(w, w.tesla, 'works_on');

    expect(await row(w, w.tesla)).toMatchObject({
      diesel: true,
      electric: true,
      hybrid: true,
      petrol: true,
      stance: 'works_on',
    });
  });

  it('writes nothing when the stance is set again unchanged', async () => {
    const w = await world();
    await setStance(w, w.dacia, 'works_on');
    const before = await row(w, w.dacia);
    const entries = (await history(w)).length;

    await setStance(w, w.dacia, 'works_on');

    expect(await row(w, w.dacia)).toEqual(before);
    expect(await history(w)).toHaveLength(entries);
  });

  // Two tabs of the brand screen: the second first write starts while the
  // first one's transaction is still open, so both miss the row.
  it('takes a second first write that lands with the first as a change, not a 500', async () => {
    const w = await world();
    let written!: () => void;
    let commit!: () => void;
    const firstWritten = new Promise<void>((resolve) => {
      written = resolve;
    });
    const held = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const first = prisma.$transaction(async (tx) => {
      await brands.setStance(tx, w.actor, w.garage, w.dacia, 'works_on');
      written();
      await held;
    });
    await firstWritten;
    const second = setStance(w, w.dacia, 'does_not_take');
    // Commit the first only once the second waits on its transaction (a row
    // lock or key wait; the spec files' turn is an advisory lock, never this).
    try {
      await until('the second write to wait on the first', async () => {
        const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_locks
          WHERE NOT granted AND locktype = 'transactionid'`;
        return waiting > 0;
      });
    } finally {
      commit();
    }

    await expect(Promise.all([first, second])).resolves.toBeDefined();
    expect(await row(w, w.dacia)).toMatchObject({ stance: 'does_not_take' });
    expect((await history(w)).map((entry) => entry.action)).toEqual([
      'create',
      ...Array(5).fill('update'),
    ]);
  });

  it('records the stances and jobs in the garage history as their author', async () => {
    const w = await world();
    const jobType = randomUUID();

    await setStance(w, w.dacia, 'works_on');
    await seedJob(w, w.dacia, jobType);
    await setStance(w, w.dacia, 'does_not_take');

    const entries = await history(w);
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: w.mihai,
        garageId: w.garage,
        newValue: expect.objectContaining({ stance: 'works_on' }),
        subjectId: w.dacia,
        subjectType: 'garage_brand',
      }),
      ...['stance', 'petrol', 'diesel', 'hybrid', 'electric'].map((field) =>
        expect.objectContaining({
          action: 'update',
          field,
          garageId: w.garage,
          subjectId: w.dacia,
          subjectType: 'garage_brand',
        }),
      ),
      expect.objectContaining({
        action: 'delete',
        garageId: w.garage,
        subjectId: jobType,
        subjectType: 'garage_brand_job',
      }),
    ]);
    expect(entries.find((entry) => entry.field === 'stance')).toMatchObject({
      newValue: 'does_not_take',
      oldValue: 'works_on',
    });
  });
});

describe('garage limits', () => {
  const setLimits = (
    garageId: string,
    data: { brandNote?: string; refusalPhrase?: string },
  ) => prisma.garage.update({ data, where: { id: garageId } });

  it('keeps a brand note of 140 characters and a refusal phrase of 60', async () => {
    const w = await world();

    await setLimits(w.garage, {
      brandNote: 'Ș'.repeat(140),
      refusalPhrase: 'Ș'.repeat(60),
    });

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: w.garage } }),
    ).toMatchObject({
      brandNote: 'Ș'.repeat(140),
      refusalPhrase: 'Ș'.repeat(60),
    });
  });

  it.each([
    ['a brand note of 141 characters', { brandNote: 'a'.repeat(141) }],
    ['a blank brand note', { brandNote: '   ' }],
    ['a refusal phrase of 61 characters', { refusalPhrase: 'a'.repeat(61) }],
    ['a blank refusal phrase', { refusalPhrase: '' }],
  ])('refuses %s', async (_, data) => {
    const w = await world();

    await expect(setLimits(w.garage, data)).rejects.toThrow(
      /garage_brand_note_check|garage_refusal_phrase_check/,
    );
    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: w.garage } }),
    ).toMatchObject({ brandNote: null, refusalPhrase: null });
  });
});
