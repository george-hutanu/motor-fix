import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { verifyPassword } from './auth/password/password';
import { createPrisma } from './auth/prisma';
import { serialDatabase } from './auth/serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);

const seed = (APP_ENV: string, extra: Record<string, string> = {}) => {
  // The seed reads DATABASE_URL itself: hand it the database this spec checks.
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

const seeded = () =>
  prisma.account.findMany({
    include: {
      identities: true,
      mechanic: true,
      memberships: true,
      roles: true,
    },
    orderBy: { email: 'asc' },
    where: { email: { endsWith: '@example.test' } },
  });

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage, brand CASCADE');
});

describe('seed', () => {
  it('refuses to run in production', () => {
    const run = seed('production');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('seed refused: APP_ENV=production');
  });

  it.each([
    ['unset', ''],
    ['misspelled', 'stagign'],
  ])(
    'refuses an APP_ENV that is %s without SEED_PASSWORD, and writes nothing',
    async (_, appEnv) => {
      const run = seed(appEnv);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('SEED_PASSWORD');
      expect(await seeded()).toHaveLength(0);
    },
  );

  it('refuses staging without SEED_PASSWORD, and writes nothing', async () => {
    const run = seed('staging');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('SEED_PASSWORD');
    expect(await seeded()).toHaveLength(0);
  });

  it('adds one account per role, a second admin, two two-role accounts and a suspended driver', async () => {
    expect(seed('test').status).toBe(0);

    const accounts = await seeded();
    const summary = Object.fromEntries(
      accounts.map((a) => [
        a.email,
        {
          lastRole: a.lastRole,
          roles: a.roles.map((r) => r.role).sort(),
          status: a.status,
        },
      ]),
    );
    expect(summary).toEqual({
      'admin@example.test': {
        lastRole: 'admin',
        roles: ['admin'],
        status: 'active',
      },
      'admin2@example.test': {
        lastRole: 'admin',
        roles: ['admin'],
        status: 'active',
      },
      'cerere@example.test': {
        lastRole: 'driver',
        roles: ['driver'],
        status: 'active',
      },
      'comutare@example.test': {
        lastRole: 'garage',
        roles: ['driver', 'garage'],
        status: 'active',
      },
      'doua-roluri@example.test': {
        lastRole: 'garage',
        roles: ['driver', 'garage'],
        status: 'active',
      },
      'masina-noua@example.test': {
        lastRole: 'garage',
        roles: ['garage'],
        status: 'active',
      },
      'mecanic-oferte@example.test': {
        lastRole: 'mechanic',
        roles: ['mechanic'],
        status: 'active',
      },
      'mecanic@example.test': {
        lastRole: 'mechanic',
        roles: ['mechanic'],
        status: 'active',
      },
      'militari@example.test': {
        lastRole: 'garage',
        roles: ['garage'],
        status: 'active',
      },
      'receptie@example.test': {
        lastRole: 'receptionist',
        roles: ['receptionist'],
        status: 'active',
      },
      'service@example.test': {
        lastRole: 'garage',
        roles: ['garage'],
        status: 'active',
      },
      'sofer@example.test': {
        lastRole: 'driver',
        roles: ['driver'],
        status: 'active',
      },
      'sofer2@example.test': {
        lastRole: 'driver',
        roles: ['driver'],
        status: 'active',
      },
      'suspendat@example.test': {
        lastRole: 'driver',
        roles: ['driver'],
        status: 'suspended',
      },
    });
  });

  it('gives a garage owner a verified number for the sign-in by phone', async () => {
    expect(seed('test').status).toBe(0);

    const phones = (await seeded()).filter((a) => a.phone);
    expect(
      phones.map((a) => [a.email, a.phone, a.phoneVerifiedAt !== null]),
    ).toEqual([
      ['cerere@example.test', '+40700000102', true],
      ['doua-roluri@example.test', '+40700000101', true],
    ]);
  });

  it('links the garage staff to one seeded garage', async () => {
    seed('test');

    const accounts = await seeded();
    const by = (email: string) => accounts.find((a) => a.email === email);
    const owner = by('service@example.test')?.memberships[0];
    const reception = by('receptie@example.test')?.memberships[0];
    const mechanic = by('mecanic@example.test')?.mechanic;
    expect(owner?.role).toBe('owner');
    expect(reception?.role).toBe('receptionist');
    expect(reception?.garageId).toBe(owner?.garageId);
    expect(mechanic?.garageId).toBe(owner?.garageId);
    expect(by('doua-roluri@example.test')?.memberships[0]?.role).toBe('owner');
    const switcher = by('comutare@example.test')?.memberships[0];
    expect(switcher?.role).toBe('owner');
    expect(switcher?.garageId).not.toBe(owner?.garageId);
    // A garage of its own, so a test that reads its inbox shares no owner.
    const militari = by('militari@example.test')?.memberships[0];
    expect(militari?.role).toBe('owner');
    expect(militari?.garageId).not.toBe(owner?.garageId);
  });

  it('gives every account the test password as an argon2id hash', async () => {
    seed('test');

    for (const account of await seeded()) {
      const identity = account.identities.find((i) => i.method === 'password');
      expect(identity?.subject).toBe(account.email);
      await expect(
        verifyPassword('parola-de-test', identity?.passwordHash ?? ''),
      ).resolves.toBe(true);
    }
  });

  it('gives every account a confirmed e-mail address', async () => {
    seed('test');

    const accounts = await seeded();
    expect(accounts.length).toBeGreaterThan(0);
    for (const account of accounts) {
      expect(account.emailVerifiedAt).toBeInstanceOf(Date);
    }
  });

  it('uses SEED_PASSWORD when it is given', async () => {
    expect(
      seed('staging', { SEED_PASSWORD: 'o-parola-din-secrete' }).status,
    ).toBe(0);

    const [first] = await seeded();
    const hash = first?.identities[0]?.passwordHash ?? '';
    await expect(verifyPassword('o-parola-din-secrete', hash)).resolves.toBe(
      true,
    );
    await expect(verifyPassword('parola-de-test', hash)).resolves.toBe(false);
  });

  it('changes nothing when run twice', async () => {
    expect(seed('test').status).toBe(0);
    const once = await seeded();

    expect(seed('test').status).toBe(0);

    expect(await seeded()).toEqual(once);
  });

  it('leaves two draft garages waiting for verification', async () => {
    expect(seed('test').status).toBe(0);

    const garages = await prisma.garage.findMany({
      include: { verificationFiles: { select: { status: true } } },
      orderBy: { slug: 'asc' },
      where: { status: 'draft' },
    });
    expect(
      garages.map((g) => [
        g.slug,
        g.status,
        g.verificationFiles.map((f) => f.status),
      ]),
    ).toEqual([
      ['atelier-dinamo', 'draft', ['in_review']],
      ['atelier-test', 'draft', []],
      ['service-dobre', 'draft', ['submitted']],
    ]);
  });

  it('adds no second waiting file when run twice', async () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);

    expect(
      await prisma.verificationFile.count({
        where: { status: { not: 'approved' } },
      }),
    ).toBe(2);
    expect(await prisma.verificationFile.count()).toBe(10);
    expect(await prisma.verificationCheck.count()).toBe(80);
  });

  it('gives each waiting file its 8 checks, none run yet', async () => {
    expect(seed('test').status).toBe(0);

    const files = await prisma.verificationFile.findMany({
      include: { checks: { orderBy: { kind: 'asc' } } },
      where: { status: { not: 'approved' } },
    });
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(
        file.checks.map((c) => [c.kind, c.result, c.automatic, c.detail]),
      ).toEqual(
        [
          'company',
          'caen',
          'rar',
          'activities',
          'representative',
          'address',
          'photos',
          'documents',
        ].map((kind) => [kind, 'not_run', false, null]),
      );
    }
  });
});

describe('seed of the listed garages', () => {
  const listed = () =>
    prisma.garage.findMany({
      orderBy: { slug: 'asc' },
      select: {
        approvedAt: true,
        brands: {
          select: { brand: { select: { key: true } }, stance: true },
        },
        latitude: true,
        longitude: true,
        slug: true,
      },
      where: { status: 'approved' },
    });
  const dacia = (garages: Awaited<ReturnType<typeof listed>>) =>
    garages.map(
      (g) => g.brands.find((b) => b.brand.key === 'dacia')?.stance ?? 'none',
    );

  it('lists eight garages, each with a place, five taking Dacia, one refusing it, two silent', async () => {
    expect(seed('test').status).toBe(0);

    const garages = await listed();
    expect(garages).toHaveLength(8);
    expect(dacia(garages).sort()).toEqual([
      'does_not_take',
      'none',
      'none',
      'works_on',
      'works_on',
      'works_on',
      'works_on',
      'works_on',
    ]);
    for (const garage of garages) {
      expect(garage.latitude).not.toBeNull();
      expect(garage.longitude).not.toBeNull();
    }
    // Approved in an earlier month, so the admin's growth this month stays 0.
    for (const garage of garages) {
      expect(garage.approvedAt?.getTime()).toBeLessThan(
        new Date('2026-02-01T00:00:00Z').getTime(),
      );
    }
  });

  // @traces 163-FR-005
  it('places six listed garages in București and two in Cluj-Napoca, for the figures by city', async () => {
    expect(seed('test').status).toBe(0);

    const cities = await prisma.garage.groupBy({
      _count: { _all: true },
      by: ['cityKey', 'cityName'],
      orderBy: { cityKey: 'asc' },
      where: { status: 'approved' },
    });
    expect(
      cities.map(({ _count, cityKey, cityName }) => [
        cityKey,
        cityName,
        _count._all,
      ]),
    ).toEqual([
      ['bucuresti', 'București', 6],
      ['cluj-napoca', 'Cluj-Napoca', 2],
    ]);
  });

  // An earlier spec file can leave a brand behind under the seed's name; this
  // spec's own beforeEach must clear it, or the seed skips Dacia.
  describe('after another spec left a brand named Dacia', () => {
    beforeAll(async () => {
      await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
      await prisma.$executeRawUnsafe(
        `INSERT INTO brand (id, key, name, slug, popularity, updated_at)
         VALUES (gen_random_uuid(), 'dacia-left', 'Dacia', 'dacia-left', 1, now())`,
      );
    });

    it('starts with the leftover gone, so the seed links five garages to Dacia', async () => {
      expect(await prisma.brand.count({ where: { key: 'dacia-left' } })).toBe(
        0,
      );
      expect(seed('test').status).toBe(0);

      expect(
        dacia(await listed()).filter((s) => s === 'works_on'),
      ).toHaveLength(5);
    });
  });

  it('gives Dacia its catalogue slug and popularity before the API has loaded it', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');

    expect(seed('test').status).toBe(0);

    expect(
      await prisma.brand.findUnique({
        select: { active: true, name: true, popularity: true, slug: true },
        where: { key: 'dacia' },
      }),
    ).toEqual({ active: true, name: 'Dacia', popularity: 7, slug: 'dacia' });
  });

  // @traces 312-FR-008
  it('gives each listed garage one approved verification file, decided when it was approved', async () => {
    expect(seed('test').status).toBe(0);

    const garages = await prisma.garage.findMany({
      select: {
        approvedAt: true,
        createdAt: true,
        verificationFiles: {
          select: {
            decidedAt: true,
            decidedBy: true,
            openedAt: true,
            reopenedAt: true,
            reopenedBy: true,
            reopenReason: true,
            status: true,
          },
        },
      },
      where: { status: 'approved' },
    });
    const admin = await prisma.account.findUniqueOrThrow({
      where: { email: 'admin@example.test' },
    });
    expect(garages).toHaveLength(8);
    for (const garage of garages) {
      expect(garage.verificationFiles).toEqual([
        {
          decidedAt: garage.approvedAt,
          decidedBy: admin.id,
          openedAt: garage.createdAt,
          reopenedAt: null,
          reopenedBy: null,
          reopenReason: null,
          status: 'approved',
        },
      ]);
    }
  });

  it('changes nothing in the listed garages when run twice', async () => {
    expect(seed('test').status).toBe(0);
    const once = await listed();
    const brands = await prisma.garageBrand.count();

    expect(seed('test').status).toBe(0);

    expect(await listed()).toEqual(once);
    expect(await prisma.garageBrand.count()).toBe(brands);
  });
});

// @traces 220-FR-012
// @traces 424-FR-018
describe('seed of a request through to a job', () => {
  const chain = () =>
    prisma.quoteRequest.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        bookings: {
          select: {
            job: {
              select: {
                mechanicId: true,
                stages: {
                  orderBy: { at: 'asc' },
                  select: {
                    actorRole: true,
                    fromStatus: true,
                    toStatus: true,
                  },
                },
                startedAt: true,
                status: true,
              },
            },
            mechanicId: true,
            status: true,
          },
        },
        car: { select: { plate: true } },
        driver: { select: { email: true } },
        jobs: { select: { jobType: { select: { key: true } } } },
        quotes: { select: { status: true } },
        recipients: {
          select: { garage: { select: { slug: true } }, status: true },
        },
        status: true,
      },
    });

  it("sends the requester's two requests to the staff's garage: one waiting, one confirmed with the mechanic's job in work", async () => {
    expect(seed('test').status).toBe(0);

    const mechanic = await prisma.mechanic.findFirstOrThrow({
      where: { account: { email: 'mecanic@example.test' } },
    });
    const requests = await chain();
    const common = {
      car: { plate: 'B101QAT' },
      driver: { email: 'cerere@example.test' },
      jobs: [{ jobType: { key: 'oil-service' } }],
    };
    expect(requests).toEqual([
      {
        ...common,
        bookings: [],
        quotes: [],
        recipients: [{ garage: { slug: 'atelier-test' }, status: 'waiting' }],
        status: 'sent',
      },
      {
        ...common,
        bookings: [
          {
            job: {
              mechanicId: mechanic.id,
              stages: [
                { actorRole: 'mechanic', fromStatus: null, toStatus: 'to_do' },
                {
                  actorRole: 'mechanic',
                  fromStatus: 'to_do',
                  toStatus: 'in_work',
                },
              ],
              startedAt: expect.any(Date),
              status: 'in_work',
            },
            mechanicId: mechanic.id,
            status: 'confirmed',
          },
        ],
        quotes: [{ status: 'accepted' }],
        recipients: [{ garage: { slug: 'atelier-test' }, status: 'quoted' }],
        status: 'booked',
      },
    ]);
  });

  // @traces 343-FR-005
  it("gives the staff's garage a mechanic who may answer quotes beside one who may not, and the oil service ticked for Dacia", async () => {
    expect(seed('test').status).toBe(0);

    const mechanics = await prisma.mechanic.findMany({
      select: { account: { select: { email: true } }, canAnswerQuotes: true },
      where: { garage: { slug: 'atelier-test' } },
    });
    expect(
      mechanics
        .map((m) => [m.account?.email ?? '', m.canAnswerQuotes] as const)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    ).toEqual([
      ['mecanic-oferte@example.test', true],
      ['mecanic@example.test', false],
    ]);
    const oil = await prisma.jobType.findUniqueOrThrow({
      where: { key: 'oil-service' },
    });
    const ticked = await prisma.garageBrandJob.findMany({
      select: {
        garageBrand: { select: { brand: { select: { key: true } } } },
        jobTypeId: true,
      },
      where: { garageBrand: { garage: { slug: 'atelier-test' } } },
    });
    expect(ticked).toEqual([
      { garageBrand: { brand: { key: 'dacia' } }, jobTypeId: oil.id },
    ]);
  });

  it('adds no second request when run twice', async () => {
    expect(seed('test').status).toBe(0);
    const once = await chain();

    expect(seed('test').status).toBe(0);

    expect(await chain()).toEqual(once);
  });

  // Staging kept the job an older seed wrote (to do, never started, no
  // history), and the release's seed-only run must still start it: a job
  // that is not started refuses every tick (ST-1023).
  it('starts the job an older seed left to do, with its history, when run again', async () => {
    expect(seed('test').status).toBe(0);
    const started = await chain();
    await prisma.$executeRawUnsafe(
      `DELETE FROM job_stage_entry WHERE job_id IN (SELECT id FROM job)`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE job SET status = 'to_do', started_at = NULL`,
    );

    expect(seed('test').status).toBe(0);

    // Started again now, so only that it has a start is compared.
    const shape = (c: unknown) =>
      JSON.stringify(c, (k, v) => (k === 'startedAt' && v ? 'set' : v));
    expect(shape(await chain())).toEqual(shape(started));
  });

  it('leaves a job with a history as it is, whatever its stage', async () => {
    expect(seed('test').status).toBe(0);
    await prisma.$executeRawUnsafe(
      `UPDATE job SET status = 'to_do', started_at = NULL`,
    );
    const moved = await chain();

    expect(seed('test').status).toBe(0);

    expect(await chain()).toEqual(moved);
  });
});

describe('seed of the platform rules', () => {
  const rules = () =>
    prisma.platformRule.findMany({
      orderBy: { key: 'asc' },
      select: { defaultValue: true, key: true, value: true },
    });
  const testOnly = { key: { in: ['skip_manual_approval', 'skip_rar_check'] } };

  beforeEach(() => prisma.platformRule.deleteMany({ where: testOnly }));

  it('adds the two test-only rules, checks required, beside the migrated ones', async () => {
    expect(seed('test').status).toBe(0);

    // The migrated rows' values belong to other suites sharing the database.
    expect(await rules()).toEqual([
      expect.objectContaining({ defaultValue: false, key: 'maintenance_mode' }),
      expect.objectContaining({
        defaultValue: true,
        key: 'reviews_only_after_confirmed_job',
      }),
      { defaultValue: false, key: 'skip_manual_approval', value: false },
      { defaultValue: false, key: 'skip_rar_check', value: false },
    ]);
  });

  it('adds no test-only rule in production', async () => {
    expect(seed('production').status).toBe(1);

    expect(await prisma.platformRule.count({ where: testOnly })).toBe(0);
  });

  it('keeps a value an admin changed when run again', async () => {
    expect(seed('test').status).toBe(0);
    await prisma.platformRule.update({
      data: { value: true },
      where: { key: 'skip_rar_check' },
    });

    expect(seed('test').status).toBe(0);

    expect(
      await prisma.platformRule.findUniqueOrThrow({
        where: { key: 'skip_rar_check' },
      }),
    ).toMatchObject({ defaultValue: false, value: true });
  });
});

describe('seed of the suspension record', () => {
  const suspensions = async () => {
    const { id } = await prisma.account.findUniqueOrThrow({
      where: { email: 'suspendat@example.test' },
    });
    return prisma.activityLog.findMany({
      select: { at: true, field: true, newValue: true, subjectType: true },
      where: { subjectId: id },
    });
  };

  it('records the suspended driver as suspended on 2 October 2026, once', async () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);

    expect(await suspensions()).toEqual([
      {
        at: new Date('2026-10-02T10:00:00.000Z'),
        field: 'status',
        newValue: 'suspended',
        subjectType: 'account',
      },
    ]);
  });
});
