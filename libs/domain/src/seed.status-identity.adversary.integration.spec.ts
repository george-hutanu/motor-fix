import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { verifyPassword } from './auth/password/password';
import { createPrisma } from './auth/prisma';
import { serialDatabase } from './auth/serial-db.testing';
import { atLocal, localDay } from './bucharest';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);

const PASSWORD = 'p@rola-$ecretă+(x)*[1]';

const seed = (APP_ENV: string, extra: Record<string, string> = {}) => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV,
    DATABASE_URL: databaseUrl,
    ...extra,
  };
  if (!('SEED_PASSWORD' in extra)) delete env['SEED_PASSWORD'];
  return spawnSync(process.execPath, [join(__dirname, 'seed.ts')], {
    encoding: 'utf8',
    env,
  });
};
const run = () => seed('staging', { SEED_PASSWORD: PASSWORD });

const account = (email: string) =>
  prisma.account.findUniqueOrThrow({
    include: { identities: true },
    where: { email },
  });
const summary = (stdout: string) =>
  stdout.split('\n').filter((line) => line.startsWith('seed: restored'));

const sendAt = async (email: string, key: string, createdAt: Date) => {
  const driver = await prisma.account.findUniqueOrThrow({ where: { email } });
  const car = await prisma.car.findFirstOrThrow({
    where: { ownerId: driver.id },
  });
  await prisma.quoteRequest.create({
    data: {
      carBrand: 'Dacia',
      carFuel: 'petrol',
      carId: car.id,
      carModel: car.model,
      carYear: car.year,
      createdAt,
      driverId: driver.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      idempotencyKey: key,
    },
  });
};

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage, brand CASCADE');
});

describe('seed status, identity and day count, attacked', () => {
  // @traces 1373-FR-004
  it("dates the seed's own two requests before the start of the Bucharest day, in order", async () => {
    expect(run().status).toBe(0);

    const startOfDay = atLocal(localDay(new Date()), 0);
    const own = await prisma.quoteRequest.findMany({
      orderBy: { createdAt: 'asc' },
      where: {
        createdAt: { gte: new Date(startOfDay.getTime() - 3 * 3600 * 1000) },
        idempotencyKey: { startsWith: 'seed-' },
      },
    });
    expect(own).toHaveLength(2);
    for (const row of own) expect(row.createdAt < startOfDay).toBe(true);
    const [first, second] = own;
    expect(startOfDay.getTime() - (first?.createdAt.getTime() ?? 0)).toBe(
      2 * 3600 * 1000,
    );
    expect(startOfDay.getTime() - (second?.createdAt.getTime() ?? 0)).toBe(
      3600 * 1000,
    );
  });

  // @traces 1373-FR-004
  it('does not move the seed own requests on later runs', async () => {
    expect(run().status).toBe(0);
    const before = await prisma.quoteRequest.findMany({
      orderBy: { idempotencyKey: 'asc' },
      where: { idempotencyKey: { startsWith: 'seed-' } },
    });

    expect(run().status).toBe(0);

    const after = await prisma.quoteRequest.findMany({
      orderBy: { idempotencyKey: 'asc' },
      where: { idempotencyKey: { startsWith: 'seed-' } },
    });
    expect(after.map((r) => [r.id, r.createdAt])).toEqual(
      before.map((r) => [r.id, r.createdAt]),
    );
  });

  // @traces 1373-FR-004
  it('clears a request sent a minute ago and one sent 24 hours ago by a seeded driver', async () => {
    expect(run().status).toBe(0);
    await sendAt('cerere@example.test', 'adv-1', new Date(Date.now() - 60_000));
    await sendAt(
      'cerere@example.test',
      'adv-2',
      new Date(Date.now() - 24 * 3600 * 1000),
    );

    const result = run();

    expect(result.status).toBe(0);
    expect(
      await prisma.quoteRequest.count({
        where: { idempotencyKey: { startsWith: 'adv-' } },
      }),
    ).toBe(0);
    expect(summary(result.stdout)[0]).toContain('cleared 2 quote requests');
  });

  // @traces 1373-FR-004
  // @traces 1373-FR-006
  it('leaves a request of an account outside the seed list and an old one of a seeded driver', async () => {
    expect(run().status).toBe(0);
    const stranger = await prisma.account.create({
      data: { email: 'strain@garage.test', lastRole: 'driver', name: 'Strain' },
    });
    const car = await prisma.car.findFirstOrThrow({
      where: { owner: { email: 'cerere@example.test' } },
    });
    const strangerCar = await prisma.car.create({
      data: {
        brandId: car.brandId,
        fuel: car.fuel,
        idempotencyKey: 'adv-car',
        model: car.model,
        odometerKm: 1000,
        ownerId: stranger.id,
        year: car.year,
      },
    });
    await prisma.quoteRequest.create({
      data: {
        carBrand: 'Dacia',
        carFuel: 'petrol',
        carId: strangerCar.id,
        carModel: car.model,
        carYear: car.year,
        driverId: stranger.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        idempotencyKey: 'adv-stranger',
      },
    });
    await sendAt(
      'cerere@example.test',
      'adv-old',
      new Date(Date.now() - 10 * 24 * 3600 * 1000),
    );

    expect(run().status).toBe(0);

    const kept = await prisma.quoteRequest.findMany({
      orderBy: { idempotencyKey: 'asc' },
      where: { idempotencyKey: { startsWith: 'adv-' } },
    });
    expect(kept.map((r) => r.idempotencyKey)).toEqual([
      'adv-old',
      'adv-stranger',
    ]);
  });

  // @traces 1373-FR-002
  it('restores a deleted suspended-seed account to suspended and keeps its suspended reason', async () => {
    expect(run().status).toBe(0);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { email: 'suspendat@example.test' },
    });
    await prisma.account.update({
      data: { suspendedReason: 'motiv' },
      where: { email: 'nou@example.test' },
    });

    expect(run().status).toBe(0);

    expect((await account('suspendat@example.test')).status).toBe('suspended');
    expect((await account('nou@example.test')).suspendedReason).toBe('motiv');
  });

  // @traces 1373-FR-002
  it('restores every deleted seeded account in one run and counts them', async () => {
    expect(run().status).toBe(0);
    await prisma.account.updateMany({
      data: { status: 'deleted' },
      where: { email: { in: ['nou@example.test', 'sofer@example.test'] } },
    });

    const result = run();

    expect(result.status).toBe(0);
    expect(summary(result.stdout)).toEqual([
      'seed: restored password 0, status 2, roles 0, link 0, extra password identities 0; cleared 0 quote requests',
    ]);
  });

  // @traces 1373-FR-002
  // @traces 1373-FR-006
  it('leaves a deleted account outside the seed list deleted', async () => {
    expect(run().status).toBe(0);
    const gone = await prisma.account.create({
      data: {
        email: 'sters@garage.test',
        lastRole: 'driver',
        name: 'Sters',
        status: 'deleted',
      },
    });

    expect(run().status).toBe(0);

    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: gone.id } }))
        .status,
    ).toBe('deleted');
  });

  // @traces 1373-FR-003
  it('keeps one verifying identity when an account holds three password identities', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    for (const subject of ['a-1', 'b-2', 'c-3']) {
      await prisma.accountIdentity.create({
        data: {
          accountId: nou.id,
          method: 'password',
          passwordHash: `x-${subject}`,
          subject,
        },
      });
    }
    await prisma.accountIdentity.deleteMany({
      where: { accountId: nou.id, subject: 'nou@example.test' },
    });

    const result = run();

    expect(result.status).toBe(0);
    const left = (await account('nou@example.test')).identities.filter(
      (i) => i.method === 'password',
    );
    expect(left).toHaveLength(1);
    expect(left[0]?.subject).toBe('nou@example.test');
    expect(await verifyPassword(PASSWORD, left[0]?.passwordHash ?? '')).toBe(
      true,
    );
  });

  // @traces 1373-FR-005
  it('counts extra identities by the accounts it wrote, one for an account that held three', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    for (const subject of ['a-1', 'b-2']) {
      await prisma.accountIdentity.create({
        data: {
          accountId: nou.id,
          method: 'password',
          passwordHash: 'x',
          subject,
        },
      });
    }

    const result = run();

    expect(summary(result.stdout)).toEqual([
      'seed: restored password 0, status 0, roles 0, link 0, extra password identities 1; cleared 0 quote requests',
    ]);
  });

  // @traces 1373-FR-005
  it('prints no seed line and writes nothing when the environment is production', async () => {
    const result = seed('production', { SEED_PASSWORD: PASSWORD });

    expect(result.status).not.toBe(0);
    expect(summary(result.stdout)).toEqual([]);
    expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD);
    expect(await prisma.account.count()).toBe(0);
  });

  // @traces 1373-FR-005
  it('prints no summary and does not leak the password when the seed is refused for lack of one', async () => {
    const result = seed('staging');

    expect(result.status).not.toBe(0);
    expect(summary(result.stdout)).toEqual([]);
    expect(await prisma.account.count()).toBe(0);
  });

  // @traces 1373-FR-005
  it('prints the summary as the only stdout line starting with the seed prefix and never the password, on first and repeat runs', async () => {
    for (let n = 0; n < 2; n++) {
      const result = run();
      expect(result.status).toBe(0);
      expect(summary(result.stdout)).toHaveLength(1);
      expect(summary(result.stdout)[0]).toMatch(
        /^seed: restored password \d+, status \d+, roles \d+, link \d+, extra password identities \d+; cleared \d+ quote requests$/,
      );
      expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD);
    }
  });

  // @traces 1373-FR-005
  it('does not print the password in a development run with a short password refused or accepted', async () => {
    const result = seed('development', { SEED_PASSWORD: 'x' });

    expect(`${result.stdout}${result.stderr}`).not.toMatch(/seed: .*x\b.*x\b/);
    expect(summary(result.stdout).length).toBeLessThanOrEqual(1);
  });

  // @traces 1373-FR-002
  it('changes no account row, updated or created, on a run with nothing to restore', async () => {
    expect(run().status).toBe(0);
    const before = await prisma.$queryRaw<{ xmin: string; id: string }[]>`
      SELECT id, xmin::text AS xmin FROM account ORDER BY id`;

    expect(run().status).toBe(0);

    const after = await prisma.$queryRaw<{ xmin: string; id: string }[]>`
      SELECT id, xmin::text AS xmin FROM account ORDER BY id`;
    expect(after).toEqual(before);
  });
});
