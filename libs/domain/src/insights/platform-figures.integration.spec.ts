import { countPlatformFigures, monthStartSnapshot } from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const DAY = 86_400_000;
const now = new Date('2026-11-10T10:00:00Z');
let slug = 0;

const garage = (
  status: 'draft' | 'approved' | 'suspended',
  approvedAt: Date | null = null,
) =>
  prisma.garage.create({
    data: { approvedAt, name: 'Service', slug: `service-${++slug}`, status },
  });

const driver = async (
  lastActiveAt: Date | null,
  options: {
    roles?: ('driver' | 'garage' | 'admin')[];
    status?: 'active' | 'suspended' | 'deleted';
  } = {},
) => {
  const id = await account(`person-${++slug}`, options.roles ?? ['driver'], {
    status: options.status,
  });
  await prisma.account.update({ data: { lastActiveAt }, where: { id } });
  return id;
};

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE platform_daily');
});

describe('the platform figures', () => {
  it('counts zero of everything on an empty database', async () => {
    await expect(countPlatformFigures(prisma, now)).resolves.toEqual({
      activeDrivers: 0,
      garagesApprovedThisMonth: 0,
      garagesListed: 0,
    });
  });

  it('lists approved garages only, and counts those first approved this month', async () => {
    await garage('approved', new Date('2026-11-02T08:00:00Z'));
    await garage('approved', new Date('2026-11-09T08:00:00Z'));
    await garage('approved', new Date('2026-09-15T08:00:00Z'));
    await garage('draft');

    await expect(countPlatformFigures(prisma, now)).resolves.toMatchObject({
      garagesApprovedThisMonth: 2,
      garagesListed: 3,
    });
  });

  it('counts a garage approved again this month in the month of its first approval', async () => {
    const before = await garage('approved', new Date('2026-11-05T08:00:00Z'));
    const fresh = await garage('approved', new Date('2026-11-06T08:00:00Z'));
    const published = (id: string, at: Date) =>
      prisma.activityLog.create({
        data: {
          action: 'update',
          actorName: 'MotorFix',
          actorRole: 'system',
          at,
          field: 'status',
          garageId: id,
          newValue: 'approved',
          oldValue: 'draft',
          subjectId: id,
          subjectType: 'garage',
        },
      });
    await published(before.id, new Date('2026-08-20T08:00:00Z'));
    await published(fresh.id, new Date('2026-11-06T08:00:00Z'));

    await expect(countPlatformFigures(prisma, now)).resolves.toMatchObject({
      garagesApprovedThisMonth: 1,
      garagesListed: 2,
    });
  });

  it('leaves a suspended garage out of the listed ones and out of the month', async () => {
    await garage('suspended', new Date('2026-11-03T08:00:00Z'));
    await garage('approved', new Date('2026-11-04T08:00:00Z'));

    await expect(countPlatformFigures(prisma, now)).resolves.toMatchObject({
      garagesApprovedThisMonth: 1,
      garagesListed: 1,
    });
  });

  it('puts an approval at 23:30 in Bucharest on the last of the month in that month, and 00:30 on the 1st in the next', async () => {
    await garage('approved', new Date('2026-10-31T21:30:00Z'));
    await garage('approved', new Date('2026-10-31T22:30:00Z'));

    await expect(countPlatformFigures(prisma, now)).resolves.toMatchObject({
      garagesApprovedThisMonth: 1,
      garagesListed: 2,
    });
  });

  it('counts a driver active exactly 30 days ago, and not one a second earlier', async () => {
    await driver(new Date(now.getTime() - 30 * DAY));
    await driver(new Date(now.getTime() - 30 * DAY - 1000));
    await driver(new Date(now.getTime() - DAY));
    await driver(null);

    await expect(countPlatformFigures(prisma, now)).resolves.toMatchObject({
      activeDrivers: 2,
    });
  });

  it('counts only accounts holding the driver role, once each', async () => {
    const recent = new Date(now.getTime() - DAY);
    await driver(recent, { roles: ['admin'] });
    await driver(recent, { roles: ['garage'] });
    await driver(recent, { roles: ['driver', 'garage'] });

    await expect(countPlatformFigures(prisma, now)).resolves.toMatchObject({
      activeDrivers: 1,
    });
  });

  it('leaves out deleted and suspended drivers', async () => {
    const recent = new Date(now.getTime() - DAY);
    await driver(recent, { status: 'deleted' });
    await driver(recent, { status: 'suspended' });
    await driver(recent);

    await expect(countPlatformFigures(prisma, now)).resolves.toMatchObject({
      activeDrivers: 1,
    });
  });
});

describe('the month-start snapshot', () => {
  it('gives the active drivers of the row for the 1st of the month in Bucharest', async () => {
    await prisma.platformDaily.createMany({
      data: [
        {
          activeDrivers: 12168,
          day: new Date('2026-11-01'),
          garagesApprovedThisMonth: 0,
          garagesListed: 200,
          writtenAt: new Date('2026-10-31T23:00:00Z'),
        },
        {
          activeDrivers: 99,
          day: new Date('2026-11-02'),
          garagesApprovedThisMonth: 1,
          garagesListed: 201,
          writtenAt: new Date('2026-11-01T23:00:00Z'),
        },
      ],
    });

    await expect(monthStartSnapshot(prisma, now)).resolves.toBe(12168);
  });

  it('gives nothing when the 1st of the month has no row', async () => {
    await prisma.platformDaily.create({
      data: {
        activeDrivers: 50,
        day: new Date('2026-10-01'),
        garagesApprovedThisMonth: 0,
        garagesListed: 10,
        writtenAt: new Date('2026-09-30T22:00:00Z'),
      },
    });

    await expect(monthStartSnapshot(prisma, now)).resolves.toBeUndefined();
  });

  it('reads the new month from midnight in Bucharest, before midnight in UTC', async () => {
    await prisma.platformDaily.create({
      data: {
        activeDrivers: 7,
        day: new Date('2026-12-01'),
        garagesApprovedThisMonth: 0,
        garagesListed: 10,
        writtenAt: new Date('2026-11-30T23:00:00Z'),
      },
    });

    await expect(
      monthStartSnapshot(prisma, new Date('2026-11-30T22:30:00Z')),
    ).resolves.toBe(7);
  });
});
