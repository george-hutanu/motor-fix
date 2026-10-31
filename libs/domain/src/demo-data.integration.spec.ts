import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { isValidCui, isWeeklyHours } from '@motor-fix/contracts';

import { verifyPassword } from './auth/password/password';
import { createPrisma } from './auth/prisma';
import { serialDatabase } from './auth/serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);

const OWNER = 'hutanugeorge40@gmail.com';

const run = (script: string, APP_ENV = 'test') =>
  spawnSync(process.execPath, [join(__dirname, script)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      APP_ENV,
      DATABASE_URL: databaseUrl,
      SEED_PASSWORD: '',
    },
  });

// Every table's row count, by name.
const rowCounts = async () => {
  const tables = await prisma.$queryRaw<{ name: string }[]>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
    ORDER BY table_name`;
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "${name}"`,
    );
    counts[name] = Number(row?.n ?? 0);
  }
  return counts;
};

afterAll(() => prisma.$disconnect());

describe('demo data', () => {
  let seedAccounts = 0;
  const seeded = { email: { endsWith: '@example.test' } };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE account, garage, brand CASCADE');
    expect(run('seed.ts').status).toBe(0);
    seedAccounts = await prisma.account.count({ where: seeded });
    const demo = run('demo-data.ts');
    expect(demo.stderr).toBe('');
    expect(demo.status).toBe(0);
  });

  it('refuses to run in production', () => {
    const refused = run('demo-data.ts', 'production');

    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('demo data refused: APP_ENV=production');
  });

  it('gives the owner every role, each at its own approved garage in Timișoara', async () => {
    const owner = await prisma.account.findUniqueOrThrow({
      include: {
        identities: true,
        mechanic: { include: { garage: true } },
        memberships: { include: { garage: true } },
        roles: true,
      },
      where: { email: OWNER },
    });

    expect(owner.roles.map((r) => r.role).sort()).toEqual([
      'admin',
      'driver',
      'garage',
      'mechanic',
      'receptionist',
    ]);
    expect(owner.identities).toHaveLength(1);
    expect(
      await verifyPassword(
        'parola-de-test',
        owner.identities[0]?.passwordHash ?? '',
      ),
    ).toBe(true);
    const garages = [
      ...owner.memberships.map((m) => [m.role, m.garage] as const),
      ['mechanic', owner.mechanic?.garage] as const,
    ];
    expect(garages.map(([role]) => role).sort()).toEqual([
      'mechanic',
      'owner',
      'receptionist',
    ]);
    const ids = garages.map(([, garage]) => garage?.id);
    expect(new Set(ids).size).toBe(3);
    for (const [, garage] of garages) {
      expect(garage?.status).toBe('approved');
      expect(garage?.cityKey).toBe('timisoara');
    }
  });

  it('lists Timișoara garages a driver can find, price and book', async () => {
    const garages = await prisma.garage.findMany({
      include: { brands: true, mechanics: true, prices: true },
      where: { cityKey: 'timisoara', status: 'approved' },
    });

    expect(garages.length).toBeGreaterThanOrEqual(10);
    for (const garage of garages) {
      expect(garage.latitude).not.toBeNull();
      expect(isWeeklyHours(garage.hours)).toBe(true);
      expect(isValidCui(garage.cui ?? '')).toBe(true);
      expect(garage.brands.length).toBeGreaterThan(0);
      expect(garage.prices.length).toBeGreaterThanOrEqual(4);
      expect(garage.mechanics.length).toBeGreaterThan(0);
    }
    // Brand-specific prices and an open-ended or hidden one somewhere.
    const prices = garages.flatMap((g) => g.prices);
    expect(prices.some((p) => p.brandId !== null)).toBe(true);
    expect(prices.some((p) => p.toBani === null)).toBe(true);
    expect(prices.some((p) => !p.visible)).toBe(true);
  });

  it('spreads approved garages over several other cities', async () => {
    const cities = await prisma.garage.groupBy({
      by: ['cityKey'],
      where: { slug: { startsWith: 'demo-' }, status: 'approved' },
    });

    expect(cities.length).toBeGreaterThanOrEqual(6);
  });

  it("keeps each garage's rating and count equal to its published reviews", async () => {
    const drift = await prisma.$queryRaw<{ slug: string }[]>`
      SELECT g.slug FROM garage g
      LEFT JOIN (SELECT garage_id, round(avg(rating)::numeric, 1) AS rating, count(*)::int AS n
                 FROM review WHERE status = 'published' GROUP BY garage_id) s ON s.garage_id = g.id
      WHERE g.slug LIKE 'demo-%'
        AND (g.review_count <> coalesce(s.n, 0) OR g.rating IS DISTINCT FROM s.rating)`;

    expect(drift).toEqual([]);
    expect(
      await prisma.review.count({
        where: { garage: { slug: { startsWith: 'demo-' } } },
      }),
    ).toBeGreaterThanOrEqual(30);
  });

  it("fills the owner's garage day: requests waiting, bookings ahead, a job in work", async () => {
    const owner = await prisma.garageMember.findFirstOrThrow({
      where: { account: { email: OWNER }, role: 'owner' },
    });
    const at = { garageId: owner.garageId };

    expect(
      await prisma.requestRecipient.count({
        where: { ...at, status: 'waiting' },
      }),
    ).toBeGreaterThanOrEqual(2);
    expect(
      await prisma.booking.count({
        where: { ...at, startsAt: { gt: new Date() }, status: 'confirmed' },
      }),
    ).toBeGreaterThanOrEqual(2);
    expect(
      await prisma.bookingSegment.count({
        where: { ...at, bookingId: { not: null } },
      }),
    ).toBeGreaterThanOrEqual(2);
    expect(
      await prisma.job.count({ where: { ...at, status: 'in_work' } }),
    ).toBe(1);
  });

  it('gives the owner, as a driver, cars, quotes to compare and a past repair', async () => {
    const driver = { driver: { email: OWNER } };

    expect(await prisma.car.count({ where: { owner: { email: OWNER } } })).toBe(
      2,
    );
    expect(
      await prisma.quote.count({
        where: { request: driver, status: 'waiting' },
      }),
    ).toBeGreaterThanOrEqual(2);
    expect(await prisma.review.count({ where: driver })).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('leaves the seed accounts as the seed made them', async () => {
    expect(seedAccounts).toBeGreaterThan(0);
    expect(await prisma.account.count({ where: seeded })).toBe(seedAccounts);
    expect(
      await prisma.garageMember.count({
        where: { account: seeded, garage: { slug: { startsWith: 'demo-' } } },
      }),
    ).toBe(0);
  });

  it('changes nothing when run again', async () => {
    const before = await rowCounts();
    const again = run('demo-data.ts');

    expect(again.status).toBe(0);
    expect(again.stdout).toContain('demo data: already loaded');
    expect(await rowCounts()).toEqual(before);
  });
});
