import {
  cities,
  countPlatformFigures,
  readGrowth,
  writeSnapshot,
} from './platform-figures';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { outbox } from '../events/event.port';
import { VerificationService } from '../garages/verification/verification.service';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const now = new Date('2026-11-10T10:00:00Z');
let slug = 0;

const CLUJ = { key: 'cluj-napoca', name: 'Cluj-Napoca' };
const BUCHAREST = { key: 'bucuresti', name: 'București' };

const garage = (
  city: { key: string; name: string } | null,
  status: 'draft' | 'approved' | 'suspended' = 'approved',
  approvedAt = '2026-11-03T08:00:00Z',
) =>
  prisma.garage.create({
    data: {
      approvedAt: status === 'draft' ? null : new Date(approvedAt),
      cityKey: city?.key ?? null,
      cityName: city?.name ?? null,
      name: 'Service',
      slug: `city-${++slug}`,
      status,
    },
  });

const seedCities = async () => {
  await garage(BUCHAREST);
  await garage(BUCHAREST, 'approved', '2026-09-03T08:00:00Z');
  await garage(CLUJ);
  await garage(null);
  await garage({ key: 'timisoara', name: 'Timișoara' }, 'suspended');
};

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE platform_daily');
});

// @traces 163-FR-003
describe('the cities of the figures', () => {
  it('lists the whole country first, then each city with a listed garage, most first', async () => {
    await seedCities();
    await garage({ key: 'arad', name: 'Arad' });

    await expect(cities(prisma)).resolves.toEqual([
      { garages: 5, key: 'all', name: 'România' },
      { garages: 2, key: 'bucuresti', name: 'București' },
      { garages: 1, key: 'arad', name: 'Arad' },
      { garages: 1, key: 'cluj-napoca', name: 'Cluj-Napoca' },
    ]);
  });

  it('lists only the whole country while no garage has a city', async () => {
    await garage(null);

    await expect(cities(prisma)).resolves.toEqual([
      { garages: 1, key: 'all', name: 'România' },
    ]);
  });
});

// @traces 163-FR-004 163-FR-013
describe('the figures of a city', () => {
  it('counts only the listed garages placed in the city', async () => {
    await seedCities();

    await expect(
      countPlatformFigures(prisma, now, { city: 'bucuresti' }),
    ).resolves.toEqual({
      activeDrivers: 0,
      garagesApprovedThisMonth: 1,
      garagesListed: 2,
    });
    await expect(
      countPlatformFigures(prisma, now, { city: 'cluj-napoca', period: '30d' }),
    ).resolves.toMatchObject({ garagesApprovedInPeriod: 1, garagesListed: 1 });
  });

  it('counts a garage with no city under the whole country only', async () => {
    await seedCities();

    await expect(
      countPlatformFigures(prisma, now, { city: 'all' }),
    ).resolves.toMatchObject({ garagesApprovedThisMonth: 3, garagesListed: 4 });
  });

  it('counts no active drivers in a city while drivers send it no requests', async () => {
    await garage(CLUJ);
    const id = await account('active-driver', ['driver']);
    await prisma.account.update({
      data: { lastActiveAt: new Date('2026-11-09T08:00:00Z') },
      where: { id },
    });

    await expect(
      countPlatformFigures(prisma, now, { city: 'cluj-napoca' }),
    ).resolves.toMatchObject({ activeDrivers: 0 });
    await expect(countPlatformFigures(prisma, now)).resolves.toMatchObject({
      activeDrivers: 1,
    });
  });

  it('counts the garages of the city waiting for verification', async () => {
    const verification = new VerificationService(new AuditService(), outbox, {
      skipManualApproval: false,
    });
    const system = { accountId: null, role: 'system' } as const;
    for (const city of [CLUJ, BUCHAREST, null]) {
      const { id } = await garage(city, 'draft');
      await prisma.$transaction((tx) => verification.submit(tx, system, id));
    }

    await expect(verification.countWaiting(prisma)).resolves.toBe(3);
    await expect(
      verification.countWaiting(prisma, 'cluj-napoca'),
    ).resolves.toBe(1);
    await expect(verification.countWaiting(prisma, 'arad')).resolves.toBe(0);
  });
});

// @traces 163-FR-006
describe('the nightly snapshot by city', () => {
  it("writes the whole country's row with its active drivers and one row per city without them", async () => {
    await seedCities();

    await writeSnapshot(prisma, now);

    const rows = await prisma.platformDaily.findMany({
      orderBy: { city: 'asc' },
      select: {
        activeDrivers: true,
        city: true,
        garagesApprovedThisMonth: true,
        garagesListed: true,
      },
    });
    expect(rows).toEqual([
      {
        activeDrivers: 0,
        city: 'all',
        garagesApprovedThisMonth: 3,
        garagesListed: 4,
      },
      {
        activeDrivers: null,
        city: 'bucuresti',
        garagesApprovedThisMonth: 1,
        garagesListed: 2,
      },
      {
        activeDrivers: null,
        city: 'cluj-napoca',
        garagesApprovedThisMonth: 1,
        garagesListed: 1,
      },
    ]);
  });

  it('writes each row once a night, however often it runs', async () => {
    await seedCities();

    await writeSnapshot(prisma, now);
    await garage(CLUJ);
    await writeSnapshot(prisma, new Date(now.getTime() + 60_000));

    const rows = await prisma.platformDaily.findMany({
      where: { city: 'cluj-napoca' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].garagesListed).toBe(2);
  });
});

// @traces 163-FR-006
describe('the growth of a city', () => {
  const closing = (day: string, city: string, garagesListed: number) =>
    prisma.platformDaily.create({
      data: {
        activeDrivers: city === 'all' ? 999 : null,
        city,
        day: new Date(day),
        garagesApprovedThisMonth: 0,
        garagesListed,
        writtenAt: new Date(`${day}T00:00:00Z`),
      },
    });

  it("reads the city's own rows, with no active drivers, and counts its month live", async () => {
    await closing('2026-10-01', 'all', 40);
    await closing('2026-10-01', 'cluj-napoca', 3);
    await closing('2026-11-01', 'all', 50);
    await garage(CLUJ, 'approved', '2026-05-03T08:00:00Z');
    await garage(BUCHAREST);

    const { months } = await readGrowth(prisma, now, 'cluj-napoca');

    expect(months.at(-3)).toStrictEqual({ garagesListed: 3, month: '2026-09' });
    expect(months.at(-2)).toStrictEqual({ month: '2026-10' });
    expect(months.at(-1)).toStrictEqual({ garagesListed: 1, month: '2026-11' });
    expect(months.slice(0, 9).every((m) => Object.keys(m).length === 1)).toBe(
      true,
    );
  });

  it("keeps reading the whole country's rows with their active drivers", async () => {
    await closing('2026-10-01', 'all', 40);
    await closing('2026-10-01', 'cluj-napoca', 3);

    const { months } = await readGrowth(prisma, now);

    expect(months.at(-3)).toStrictEqual({
      activeDrivers: 999,
      garagesListed: 40,
      month: '2026-09',
    });
  });
});
