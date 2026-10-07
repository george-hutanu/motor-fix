import { randomUUID } from 'node:crypto';

import { ConflictException } from '@nestjs/common';

import { GarageBrandsService } from './garage-brands.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/policy';
import { serialDatabase } from '../auth/serial-db.testing';
import { noEvents } from '../events/event.port';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

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

const addJob = (w: World, brandId: string, jobTypeId: string) =>
  prisma.$transaction((tx) =>
    brands.addJob(tx, w.actor, w.garage, brandId, jobTypeId),
  );

const row = (w: World, brandId: string) =>
  prisma.garageBrand.findUniqueOrThrow({
    where: { garageId_brandId: { brandId, garageId: w.garage } },
  });

const history = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: {
      at: { gte: since },
      subjectType: { in: ['garage_brand', 'garage_brand_job'] },
    },
  });

async function conflictCode(run: Promise<unknown>) {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConflictException);
  return ((error as ConflictException).getResponse() as { code: string }).code;
}

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

  it('stores a job for a brand the garage works on, once', async () => {
    const w = await world();
    const jobType = randomUUID();
    await setStance(w, w.dacia, 'works_on');

    await addJob(w, w.dacia, jobType);
    await addJob(w, w.dacia, jobType);

    expect(
      await prisma.garageBrandJob.findMany({ where: { garageId: w.garage } }),
    ).toEqual([
      expect.objectContaining({ brandId: w.dacia, jobTypeId: jobType }),
    ]);
  });

  it.each([
    ['does not take', 'does_not_take' as const],
    ['has said nothing about', undefined],
  ])('refuses a job for a brand the garage %s', async (_, stance) => {
    const w = await world();
    if (stance) await setStance(w, w.tesla, stance);

    expect(await conflictCode(addJob(w, w.tesla, randomUUID()))).toBe(
      'brand_not_worked_on',
    );
    expect(await prisma.garageBrandJob.count()).toBe(0);
  });

  it('clears the fuels and the jobs of a brand the garage stops taking', async () => {
    const w = await world();
    await setStance(w, w.dacia, 'works_on');
    await addJob(w, w.dacia, randomUUID());
    await addJob(w, w.dacia, randomUUID());

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
    const entries = (await history()).length;

    await setStance(w, w.dacia, 'works_on');

    expect(await row(w, w.dacia)).toEqual(before);
    expect(await history()).toHaveLength(entries);
  });

  it('records the stances and jobs in the garage history as their author', async () => {
    const w = await world();
    const jobType = randomUUID();

    await setStance(w, w.dacia, 'works_on');
    await addJob(w, w.dacia, jobType);
    await setStance(w, w.dacia, 'does_not_take');

    const entries = await history();
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: w.mihai,
        garageId: w.garage,
        newValue: expect.objectContaining({ stance: 'works_on' }),
        subjectId: w.dacia,
        subjectType: 'garage_brand',
      }),
      expect.objectContaining({
        action: 'create',
        actorId: w.mihai,
        garageId: w.garage,
        subjectId: jobType,
        subjectType: 'garage_brand_job',
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
