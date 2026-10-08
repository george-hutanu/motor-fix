import { randomUUID } from 'node:crypto';

import { NotFoundException } from '@nestjs/common';

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
  await foreignEntries(prisma, [{ subjectType: 'garage_brand' }]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const permissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

async function world() {
  const garage = await prisma.garage.create({
    data: { name: 'Nord', slug: `nord-${randomUUID()}` },
  });
  const other = await prisma.garage.create({
    data: { name: 'Sud', slug: `sud-${randomUUID()}` },
  });
  const mihai = await account('Mihai', ['garage']);
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
    permissions,
    role: 'garage',
    roles: ['garage'],
  };
  return {
    actor,
    dacia: dacia.id,
    garage: garage.id,
    other: other.id,
    tesla: tesla.id,
  };
}
type World = Awaited<ReturnType<typeof world>>;

const setStance = (
  w: World,
  brandId: string,
  stance: 'works_on' | 'does_not_take',
  garageId = w.garage,
) =>
  prisma.$transaction((tx) =>
    brands.setStance(tx, w.actor, garageId, brandId, stance),
  );
const addJob = (
  w: World,
  brandId: string,
  jobTypeId: string,
  garageId = w.garage,
) =>
  prisma.$transaction((tx) =>
    brands.addJob(tx, w.actor, garageId, brandId, jobTypeId),
  );

describe('GarageBrandsService under hostile calls', () => {
  it('answers unstated for an unknown brand and an unknown garage', async () => {
    const w = await world();

    expect(await brands.stanceFor(w.garage, randomUUID())).toBe('unstated');
    expect(await brands.stanceFor(randomUUID(), w.dacia)).toBe('unstated');
  });

  it('answers from the row for a brand that has since been retired', async () => {
    const w = await world();
    await setStance(w, w.tesla, 'does_not_take');
    await prisma.brand.update({
      data: { active: false },
      where: { id: w.tesla },
    });

    expect(await brands.stanceFor(w.garage, w.tesla)).toBe('does_not_take');
  });

  it('refuses a stance on an unknown brand and stores nothing', async () => {
    const w = await world();

    await expect(setStance(w, randomUUID(), 'works_on')).rejects.toThrow();
    expect(await prisma.garageBrand.count()).toBe(0);
  });

  it('refuses a job on an unknown brand and stores nothing', async () => {
    const w = await world();

    await expect(addJob(w, randomUUID(), randomUUID())).rejects.toThrow();
    expect(await prisma.garageBrandJob.count()).toBe(0);
  });

  it("refuses an actor writing another garage's stance", async () => {
    const w = await world();

    await expect(setStance(w, w.dacia, 'works_on', w.other)).rejects.toThrow(
      NotFoundException,
    );
    expect(await prisma.garageBrand.count()).toBe(0);
  });

  it('refuses an actor adding a job to another garage', async () => {
    const w = await world();
    await prisma.garageBrand.create({
      data: { brandId: w.dacia, garageId: w.other, stance: 'works_on' },
    });

    await expect(addJob(w, w.dacia, randomUUID(), w.other)).rejects.toThrow(
      NotFoundException,
    );
    expect(await prisma.garageBrandJob.count()).toBe(0);
  });

  it('refuses a stance outside the two values', async () => {
    const w = await world();

    await expect(
      setStance(w, w.dacia, 'maybe' as unknown as 'works_on'),
    ).rejects.toThrow();
    expect(await prisma.garageBrand.count()).toBe(0);
  });

  it('refuses a job type that is not a UUID', async () => {
    const w = await world();
    await setStance(w, w.dacia, 'works_on');

    await expect(addJob(w, w.dacia, 'oil change')).rejects.toThrow();
    expect(await prisma.garageBrandJob.count()).toBe(0);
  });

  it('persists nothing when the surrounding transaction rolls back', async () => {
    const w = await world();

    await expect(
      prisma.$transaction(async (tx) => {
        await brands.setStance(tx, w.actor, w.garage, w.dacia, 'works_on');
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');

    expect(await prisma.garageBrand.count()).toBe(0);
    expect(
      await prisma.activityLog.count({
        where: {
          at: { gte: since },
          garageId: w.garage,
          subjectType: 'garage_brand',
        },
      }),
    ).toBe(0);
  });

  it('leaves one row when the same stance is set twice at once', async () => {
    const w = await world();

    await Promise.allSettled([
      setStance(w, w.dacia, 'works_on'),
      setStance(w, w.dacia, 'works_on'),
    ]);

    expect(await prisma.garageBrand.count()).toBe(1);
    expect(await brands.stanceFor(w.garage, w.dacia)).toBe('works_on');
  });

  it('adds the same job twice at once without an error and with one row', async () => {
    const w = await world();
    const job = randomUUID();
    await setStance(w, w.dacia, 'works_on');

    const results = await Promise.allSettled([
      addJob(w, w.dacia, job),
      addJob(w, w.dacia, job),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await prisma.garageBrandJob.count()).toBe(1);
  });

  it("clears only the flipped brand's jobs, not another brand's or garage's", async () => {
    const w = await world();
    await setStance(w, w.dacia, 'works_on');
    await setStance(w, w.tesla, 'works_on');
    await prisma.garageBrand.create({
      data: { brandId: w.dacia, garageId: w.other, stance: 'works_on' },
    });
    await addJob(w, w.dacia, randomUUID());
    await addJob(w, w.tesla, randomUUID());
    await prisma.garageBrandJob.create({
      data: { brandId: w.dacia, garageId: w.other, jobTypeId: randomUUID() },
    });

    await setStance(w, w.dacia, 'does_not_take');

    expect(
      (await prisma.garageBrandJob.findMany())
        .map((j) => [j.garageId, j.brandId])
        .sort(),
    ).toEqual(
      [
        [w.garage, w.tesla],
        [w.other, w.dacia],
      ].sort(),
    );
  });

  it('drops jobs after works_on, does_not_take, works_on', async () => {
    const w = await world();
    await setStance(w, w.dacia, 'works_on');
    await addJob(w, w.dacia, randomUUID());

    await setStance(w, w.dacia, 'does_not_take');
    await setStance(w, w.dacia, 'works_on');

    expect(await prisma.garageBrandJob.count()).toBe(0);
  });

  it('refuses a job row written straight for a brand with no stance', async () => {
    const w = await world();

    await expect(
      prisma.garageBrandJob.create({
        data: { brandId: w.tesla, garageId: w.garage, jobTypeId: randomUUID() },
      }),
    ).rejects.toThrow();
  });

  it('keeps notes of 140 emoji and refuses 141', async () => {
    const w = await world();

    await prisma.garage.update({
      data: { brandNote: '🚗'.repeat(140) },
      where: { id: w.garage },
    });
    await expect(
      prisma.garage.update({
        data: { brandNote: '🚗'.repeat(141) },
        where: { id: w.garage },
      }),
    ).rejects.toThrow();
  });

  it('refuses a refusal phrase of 61 combining characters worth of text beyond the cap', async () => {
    const w = await world();

    await expect(
      prisma.garage.update({
        data: { refusalPhrase: 'ă'.repeat(61) },
        where: { id: w.garage },
      }),
    ).rejects.toThrow();
  });
});
