import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { isValidCui, isWeeklyHours } from '@motor-fix/contracts';

import { verifyPassword } from './auth/password/password';
import { createPrisma } from './auth/prisma';
import { serialDatabase } from './auth/serial-db.testing';
import { addMonths, atLocal, localDay } from './bucharest';
import { BRANDS } from './catalogue/brands';
import { dayOf } from './garages/documents/document-cycle/document-cycle.service';

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
      'mecanic-militari@example.test': {
        lastRole: 'mechanic',
        roles: ['mechanic'],
        status: 'active',
      },
      'mecanic-oferte-militari@example.test': {
        lastRole: 'mechanic',
        roles: ['mechanic'],
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
      'nou@example.test': {
        lastRole: 'garage',
        roles: ['garage'],
        status: 'active',
      },
      'receptie-militari@example.test': {
        lastRole: 'receptionist',
        roles: ['receptionist'],
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
    // A mechanic there who may not answer quotes, for the reads it is refused.
    const refused = by('mecanic-militari@example.test')?.mechanic;
    expect(refused?.garageId).toBe(militari?.garageId);
    expect(refused?.canAnswerQuotes).toBe(false);
    // A receptionist and a mechanic who may answer quotes there, for the
    // reads every permitted role of a recipient garage is given.
    const desk = by('receptie-militari@example.test')?.memberships[0];
    expect(desk?.role).toBe('receptionist');
    expect(desk?.garageId).toBe(militari?.garageId);
    const permitted = by('mecanic-oferte-militari@example.test')?.mechanic;
    expect(permitted?.garageId).toBe(militari?.garageId);
    expect(permitted?.canAnswerQuotes).toBe(true);
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

  // Staging's api seeds on every deploy, after users there changed things:
  // a seeded account's name is theirs, its password is the seed's.
  // @traces 1372-FR-004
  // @traces 1372-FR-005
  it('adds no row on a second staging run, keeps a changed name and restores the seed password', async () => {
    const password = { SEED_PASSWORD: 'o-parola-din-secrete' };
    expect(seed('staging', password).status).toBe(0);
    const driver = await prisma.account.findUniqueOrThrow({
      include: { identities: true },
      where: { email: 'sofer@example.test' },
    });
    await prisma.account.update({
      data: { name: 'Șofer Redenumit' },
      where: { id: driver.id },
    });
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: 'schimbata-de-utilizator' },
      where: { accountId: driver.id, method: 'password' },
    });
    const before = await rowCounts();

    expect(seed('staging', password).status).toBe(0);

    expect(await rowCounts()).toEqual(before);
    const after = await prisma.account.findUniqueOrThrow({
      include: { identities: true },
      where: { id: driver.id },
    });
    expect(after.name).toBe('Șofer Redenumit');
    expect(after.identities).toHaveLength(1);
    await expect(
      verifyPassword(
        'o-parola-din-secrete',
        after.identities[0]?.passwordHash ?? '',
      ),
    ).resolves.toBe(true);
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
      ['atelier-nou', 'draft', []],
      ['service-dobre', 'draft', ['submitted']],
    ]);
  });

  // @traces 133-FR-006
  it("gives Atelier Test a stored phone, an address and weekly hours, so the owner's profile view shows every line", async () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);

    const garage = await prisma.garage.findUniqueOrThrow({
      select: { address: true, hours: true, phone: true },
      where: { slug: 'atelier-test' },
    });
    expect(garage.phone).toBe('+40700000202');
    expect(garage.address).toBe('Strada Atelierului 14, București');
    expect(isWeeklyHours(garage.hours)).toBe(true);
    expect((garage.hours as Record<string, unknown>)['mon']).toEqual([
      ['08:00', '18:00'],
    ]);
  });

  // @traces 204-FR-008
  it("gives Atelier Dinamo's waiting file a workshop address and priced jobs, so the RAR and activities forms show them", async () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);

    const garage = await prisma.garage.findUniqueOrThrow({
      include: {
        prices: {
          include: { jobType: { select: { key: true, rarActivity: true } } },
          orderBy: { position: 'asc' },
        },
      },
      where: { slug: 'atelier-dinamo' },
    });
    expect(garage.address).toBe('Strada Dinamo 12, Cluj-Napoca');
    expect(garage.prices.map((p) => p.jobType.key)).toEqual([
      'oil-service',
      'front-brakes',
      'reconditionare-injectoare',
    ]);
  });

  // @traces 414-FR-014
  it("gives Atelier Dinamo one pending proposal, 180–420 lei and 90 min, once, so the admins' queue has a row", async () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);

    const jobs = await prisma.jobType.findMany({
      include: { prices: true, proposedBy: { select: { slug: true } } },
      where: { key: 'reconditionare-injectoare' },
    });
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job).toMatchObject({
      decidedAt: null,
      decidedBy: null,
      nameEn: 'Recondiționare injectoare',
      nameRo: 'Recondiționare injectoare',
      proposedBy: { slug: 'atelier-dinamo' },
      rejectionReason: null,
      status: 'pending',
    });
    expect(
      job?.prices.map(({ brandId, durationMinutes, fromBani, toBani }) => ({
        brandId,
        durationMinutes,
        fromBani,
        toBani,
      })),
    ).toEqual([
      { brandId: null, durationMinutes: 90, fromBani: 18_000, toBani: 42_000 },
    ]);
  });

  it('leaves the proposal as an admin decided it when run again', async () => {
    expect(seed('test').status).toBe(0);
    await prisma.jobType.update({
      data: { rejectionReason: 'Nu este clar ce lucrare.', status: 'rejected' },
      where: { key: 'reconditionare-injectoare' },
    });

    expect(seed('test').status).toBe(0);

    const job = await prisma.jobType.findUniqueOrThrow({
      where: { key: 'reconditionare-injectoare' },
    });
    expect(job.status).toBe('rejected');
  });

  // @traces 301-FR-004
  it("sends Service Dobre's file far enough back to be flagged whatever the holidays", async () => {
    const before = Date.now();
    expect(seed('test').status).toBe(0);

    const file = await prisma.verificationFile.findFirstOrThrow({
      where: { garage: { slug: 'service-dobre' }, status: 'submitted' },
    });
    const days = (before - file.submittedAt.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(29.9);
  });

  // @traces 203-FR-002
  it('gives every seeded garage a CUI whose control digit holds, so a company check can pass', async () => {
    expect(seed('test').status).toBe(0);

    const garages = await prisma.garage.findMany({ select: { cui: true } });
    expect(garages.length).toBeGreaterThan(0);
    for (const { cui } of garages) expect(isValidCui(cui ?? '')).toBe(true);
  });

  it('adds no second waiting file when run twice', async () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);

    expect(
      await prisma.verificationFile.count({
        where: { status: { not: 'approved' } },
      }),
    ).toBe(2);
    expect(await prisma.verificationFile.count()).toBe(11);
    expect(await prisma.verificationCheck.count()).toBe(88);
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

  // @traces 208-FR-004
  it('gives each waiting file the two legal documents a sent listing carries, once', async () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);

    const files = await prisma.verificationFile.findMany({
      include: {
        documents: { orderBy: { kind: 'asc' }, where: { replacedAt: null } },
        garage: { select: { slug: true } },
      },
      orderBy: { garage: { slug: 'asc' } },
      where: { status: { not: 'approved' } },
    });
    expect(
      files.map((f) => [
        f.garage.slug,
        f.documents.map((d) => [d.kind, d.pages.length, !!d.issuedOn]),
      ]),
    ).toEqual(
      ['atelier-dinamo', 'service-dobre'].map((slug) => [
        slug,
        [
          ['onrc_certificate', 1, true],
          ['rar_authorisation', 1, false],
        ],
      ]),
    );
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
        labourFromBani: true,
        latitude: true,
        longitude: true,
        rating: true,
        reviewCount: true,
        slug: true,
      },
      where: { status: 'approved' },
    });
  const dacia = (garages: Awaited<ReturnType<typeof listed>>) =>
    garages.map(
      (g) => g.brands.find((b) => b.brand.key === 'dacia')?.stance ?? 'none',
    );

  it('lists nine garages, the staff garage without a place, six taking Dacia, one refusing it, two silent', async () => {
    expect(seed('test').status).toBe(0);

    const garages = await listed();
    expect(garages).toHaveLength(9);
    expect(dacia(garages).sort()).toEqual([
      'does_not_take',
      'none',
      'none',
      'works_on',
      'works_on',
      'works_on',
      'works_on',
      'works_on',
      'works_on',
    ]);
    for (const garage of garages.filter((g) => g.slug !== 'atelier-test')) {
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

  // @traces 227-FR-013
  it('gives the cards on Home a long brand list, an empty refused list and a mobile radius', async () => {
    expect(seed('test').status).toBe(0);

    const stances = async (slug: string) =>
      (
        await prisma.garageBrand.findMany({
          select: { stance: true },
          where: { garage: { slug } },
        })
      ).map(({ stance }) => stance);
    expect(
      (await stances('service-auto-militari')).filter((s) => s === 'works_on')
        .length,
    ).toBeGreaterThan(6);
    expect(await stances('atelier-berceni')).not.toContain('does_not_take');
    expect(
      await prisma.garage.findUnique({
        select: { businessKind: true, serviceRadiusKm: true },
        where: { slug: 'mecanic-mobil-cluj' },
      }),
    ).toEqual({ businessKind: 'mobile', serviceRadiusKm: 20 });
  });

  // @traces 355-FR-015
  it("gives Service Auto Militari the mock's price list, a BMW range and the BMW ticks", async () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);

    const militari = await prisma.garage.findUniqueOrThrow({
      select: {
        brands: {
          select: {
            brand: { select: { key: true } },
            jobs: { select: { jobTypeId: true } },
          },
        },
        labourFromBani: true,
        labourToBani: true,
        prices: {
          orderBy: [{ position: 'asc' }, { brandId: 'asc' }],
          select: {
            brand: { select: { key: true } },
            durationMinutes: true,
            fromBani: true,
            jobType: { select: { id: true, key: true } },
            toBani: true,
          },
        },
      },
      where: { slug: 'service-auto-militari' },
    });
    expect([militari.labourFromBani, militari.labourToBani]).toEqual([
      18_000, 24_000,
    ]);
    expect(
      militari.prices.map((p) => [
        p.jobType.key,
        p.brand?.key ?? null,
        p.fromBani,
        p.toBani,
        p.durationMinutes,
      ]),
    ).toEqual([
      ['diagnosis', null, 15_000, 22_000, 30],
      ['oil-service', null, 25_000, 40_000, 60],
      ['front-brakes', 'bmw', 110_000, 170_000, null],
      ['front-brakes', null, 89_000, 140_000, 120],
      ['timing-chain', null, 420_000, 680_000, 480],
      ['ac-regas', null, 28_000, 36_000, 45],
      ['suspension-alignment', null, 35_000, null, 90],
    ]);
    const keyOf = new Map(
      militari.prices.map((p) => [p.jobType.id, p.jobType.key]),
    );
    const ticked = (brand: string) =>
      (militari.brands.find((b) => b.brand.key === brand)?.jobs ?? [])
        .map((job) => keyOf.get(job.jobTypeId))
        .sort();
    expect(ticked('bmw')).toEqual([
      'ac-regas',
      'diagnosis',
      'front-brakes',
      'oil-service',
      'suspension-alignment',
    ]);
    expect(ticked('dacia')).toEqual(['oil-service']);
  });

  // @traces 389-FR-020
  it('gives Service Auto Militari two lifts, so a booking there can be confirmed on one', async () => {
    expect(seed('test').status).toBe(0);

    const militari = await prisma.garage.findUniqueOrThrow({
      select: { liftCount: true },
      where: { slug: 'service-auto-militari' },
    });
    expect(militari.liftCount).toBe(2);
  });

  // @traces 163-FR-005
  it('places six listed garages in București and two in Cluj-Napoca, the staff garage in no city, for the figures by city', async () => {
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
      [null, null, 1],
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

    it('starts with the leftover gone, so the seed links six garages to Dacia', async () => {
      expect(await prisma.brand.count({ where: { key: 'dacia-left' } })).toBe(
        0,
      );
      expect(seed('test').status).toBe(0);

      expect(
        dacia(await listed()).filter((s) => s === 'works_on'),
      ).toHaveLength(6);
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

  // @traces 007-FR-004
  it('gives every brand row it inserts the catalogue your form of that brand', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');

    expect(seed('test').status).toBe(0);

    const rows = await prisma.brand.findMany({
      select: { key: true, roPossessive: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.roPossessive).toBe(
        BRANDS.find((brand) => brand.key === row.key)?.roPossessive,
      );
    }
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
    expect(garages).toHaveLength(9);
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

  // @traces 226-FR-012
  it('gives the listed garages ratings, review counts and hourly rates for the dial', async () => {
    expect(seed('test').status).toBe(0);

    const rows = await prisma.garage.findMany({
      orderBy: { slug: 'asc' },
      select: {
        labourFromBani: true,
        rating: true,
        reviewCount: true,
        slug: true,
      },
      where: { status: 'approved' },
    });
    expect(
      rows.map(({ labourFromBani, rating, reviewCount, slug }) => [
        slug,
        rating === null ? null : Number(rating),
        reviewCount,
        labourFromBani,
      ]),
    ).toEqual([
      ['atelier-berceni', 4.9, 80, 15000],
      ['atelier-drumul-taberei', 4.2, 15, 14000],
      ['atelier-test', 5, 1, null],
      ['auto-pipera', null, 0, 22000],
      ['mecanic-mobil-cluj', 4.8, 35, 12000],
      ['service-auto-militari', 4.9, 120, 18000],
      ['service-colentina', 4.6, 40, 16000],
      ['service-marasti', 4.4, 22, 13000],
      ['service-titan', null, 0, null],
    ]);
  });

  // @traces 068-FR-001
  it('gives each approved garage its yearly documents cycle, due a year after its approval, once', async () => {
    expect(seed('test').status).toBe(0);
    const cycles = () =>
      prisma.documentCycle.findMany({
        orderBy: { garage: { slug: 'asc' } },
        select: {
          dueOn: true,
          garage: { select: { approvedAt: true, slug: true } },
          id: true,
          state: true,
        },
      });
    const once = await cycles();

    expect(seed('test').status).toBe(0);

    expect(await cycles()).toEqual(once);
    expect(once).toHaveLength(9);
    for (const { dueOn, garage, state } of once) {
      const approvedAt = garage.approvedAt ?? new Date(Number.NaN);
      expect([garage.slug, dayOf(dueOn), state]).toEqual([
        garage.slug,
        addMonths(localDay(approvedAt), 12),
        'due',
      ]);
    }
    expect(
      once.find(({ garage }) => garage.slug === 'atelier-test')?.dueOn,
    ).toEqual(new Date('2027-01-15'));
  });

  // An approved garage has had its activities check: the staff's garage
  // holds every RAR activity, which covers every job as an empty list does,
  // so a re-check (and the restore after a failed one) can be recorded on it.
  it("gives the staff's garage every RAR activity, and keeps an edited list", async () => {
    expect(seed('test').status).toBe(0);
    const codes = (
      await prisma.rarActivity.findMany({ select: { code: true } })
    )
      .map(({ code }) => code)
      .sort();
    const staff = () =>
      prisma.garage.findUniqueOrThrow({
        select: { rarActivities: true },
        where: { slug: 'atelier-test' },
      });

    expect(codes).not.toHaveLength(0);
    expect([...(await staff()).rarActivities].sort()).toEqual(codes);

    await prisma.garage.update({
      data: { rarActivities: ['brakes'] },
      where: { slug: 'atelier-test' },
    });
    expect(seed('test').status).toBe(0);

    expect((await staff()).rarActivities).toEqual(['brakes']);
    await prisma.garage.update({
      data: { rarActivities: codes },
      where: { slug: 'atelier-test' },
    });
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
      // The requester's own car; the reviewed job's request is another
      // driver's.
      where: { car: { idempotencyKey: 'seed' } },
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

  // @traces 055-FR-001
  it("gives the staff's garage a team of three on its profile, one card without an account, once however often it runs", async () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);

    const team = await prisma.mechanic.findMany({
      orderBy: { name: 'asc' },
      select: {
        accountId: true,
        name: true,
        onProfile: true,
        speciality: true,
      },
      where: { garage: { slug: 'atelier-test' } },
    });
    expect(
      team.map((m) => [
        m.name,
        m.speciality,
        m.onProfile,
        m.accountId !== null,
      ]),
    ).toEqual([
      ['Costel Radu', 'Frâne, suspensie și geometrie', true, false],
      ['Radu Oferte', 'Diagnoză electrică', true, true],
      ['Vlad Stan', 'Motor și distribuție', true, true],
    ]);
  });

  // @traces 343-FR-005
  it("gives the staff's garage a mechanic who may answer quotes beside one who may not, and the oil service ticked for Dacia", async () => {
    expect(seed('test').status).toBe(0);

    const mechanics = await prisma.mechanic.findMany({
      select: { account: { select: { email: true } }, canAnswerQuotes: true },
      where: { accountId: { not: null }, garage: { slug: 'atelier-test' } },
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

  // The mechanic's public page (GET /reviews/mechanic/:id) answers 200 only
  // for a mechanic on the profile, and QA needs one review there to read.
  it("gives the staff's mechanic a handed-over job and the second driver's published review naming him, once, the requester's one car left alone", async () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);

    const mechanic = await prisma.mechanic.findFirstOrThrow({
      select: { id: true, onProfile: true, rating: true, reviewCount: true },
      where: { account: { email: 'mecanic@example.test' } },
    });
    const reviews = await prisma.review.findMany({
      select: {
        driver: { select: { email: true } },
        garage: { select: { slug: true } },
        job: {
          select: {
            handedOverAt: true,
            mechanicId: true,
            status: true,
          },
        },
        rating: true,
        source: true,
        status: true,
        text: true,
      },
      where: { mechanicId: mechanic.id },
    });
    expect(reviews).toEqual([
      {
        driver: { email: 'sofer2@example.test' },
        garage: { slug: 'atelier-test' },
        job: {
          handedOverAt: expect.any(Date),
          mechanicId: mechanic.id,
          status: 'done',
        },
        rating: 5,
        source: 'job',
        status: 'published',
        text: expect.any(String),
      },
    ]);
    expect({ ...mechanic, rating: Number(mechanic.rating) }).toEqual({
      id: mechanic.id,
      onProfile: true,
      rating: 5,
      reviewCount: 1,
    });
    // The garage's stored figures count the same review, so its profile
    // never reads "0 recenzii" over a listed one.
    const garage = await prisma.garage.findUniqueOrThrow({
      select: { rating: true, reviewCount: true },
      where: { slug: 'atelier-test' },
    });
    expect({ ...garage, rating: Number(garage.rating) }).toEqual({
      rating: 5,
      reviewCount: 1,
    });
    // The requester keeps one car, so the request dialog chooses it.
    const cars = await prisma.car.findMany({
      select: { plate: true },
      where: { owner: { email: 'cerere@example.test' } },
    });
    expect(cars).toEqual([{ plate: 'B101QAT' }]);
  });

  it('adds no second request when run twice', async () => {
    expect(seed('test').status).toBe(0);
    const once = await chain();

    expect(seed('test').status).toBe(0);

    expect(await chain()).toEqual(once);
  });

  // Staging kept the job an older seed wrote (to do, never started, no
  // history), and the release's seed-only run must still start it: a job
  // that is not started refuses every tick.
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

// The release seeds staging before every end-to-end run, and each run sends
// requests as the seeded driver, who may send only so many a day.
describe("seed of the day's requests", () => {
  const sendAs = async (email: string, hoursAgo: number) => {
    const car = await prisma.car.findFirstOrThrow({
      where: { owner: { email } },
    });
    return prisma.quoteRequest.create({
      data: {
        carBrand: 'Dacia',
        carFuel: 'petrol',
        carId: car.id,
        carModel: car.model,
        carYear: car.year,
        createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
        driverId: car.ownerId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        idempotencyKey: `e2e-${hoursAgo}-${Math.random()}`,
      },
    });
  };
  const ids = async () =>
    (
      await prisma.quoteRequest.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
    ).map((r) => r.id);

  // @traces 1130-FR-001
  // @traces 1130-FR-002
  it('removes what seeded accounts sent in the last day and keeps its own two', async () => {
    expect(seed('test').status).toBe(0);
    const own = await ids();
    for (let n = 0; n < 20; n++) await sendAs('cerere@example.test', 0);
    await sendAs('cerere@example.test', 24);

    expect(seed('test').status).toBe(0);

    expect(await ids()).toEqual(own);
  });

  // @traces 1130-FR-002
  it('keeps a request sent more than a day ago, and one from an account it did not seed', async () => {
    expect(seed('test').status).toBe(0);
    const older = await sendAs('cerere@example.test', 26);
    const brand = await prisma.brand.findFirstOrThrow({
      where: { key: 'dacia' },
    });
    const someone = await prisma.account.create({
      data: { email: 'ana@motorfix.ro', lastRole: 'driver', name: 'Ana' },
    });
    await prisma.car.create({
      data: {
        brandId: brand.id,
        fuel: 'diesel',
        idempotencyKey: 'mine',
        model: 'Duster',
        odometerKm: 1000,
        ownerId: someone.id,
        year: 2020,
      },
    });
    const theirs = await sendAs('ana@motorfix.ro', 0);
    const kept = await ids();
    expect(kept).toEqual(expect.arrayContaining([older.id, theirs.id]));

    expect(seed('test').status).toBe(0);

    expect(await ids()).toEqual(kept);
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
  // The last case leaves the RAR switch on; the suites sharing the database
  // read both switches off.
  afterAll(() =>
    prisma.platformRule.updateMany({ data: { value: false }, where: testOnly }),
  );

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

// Staging's accounts outlive the seed that made them: a password set before
// SEED_PASSWORD, a role or a link lost. Each run puts back what it owns.
describe('seed of an account that drifted', () => {
  const PASSWORD = 'o-parola-din-secrete';
  const run = () => seed('staging', { SEED_PASSWORD: PASSWORD });
  const account = (email: string) =>
    prisma.account.findUniqueOrThrow({
      include: {
        identities: true,
        mechanic: true,
        memberships: { include: { garage: { select: { slug: true } } } },
        roles: true,
      },
      where: { email },
    });
  const passwordOf = async (email: string) =>
    (await account(email)).identities.find((i) => i.method === 'password');

  // An account the seed does not own, with what a seeded one would be
  // repaired from.
  const outsider = () =>
    prisma.account.create({
      data: {
        email: 'strain@example.test',
        identities: {
          create: {
            method: 'password',
            passwordHash: 'parola-altcuiva',
            subject: 'strain@example.test',
          },
        },
        lastRole: 'garage',
        name: 'Străin',
      },
    });

  // nou@ is the draft owner the core flows sign in as.
  const drift = async () => {
    const nou = await account('nou@example.test');
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: 'parola-veche' },
      where: { accountId: nou.id, method: 'password' },
    });
    await prisma.accountRole.deleteMany({ where: { accountId: nou.id } });
    await prisma.garageMember.deleteMany({ where: { accountId: nou.id } });
    await prisma.account.update({
      data: { name: 'Radu Redenumit', phone: '+40700000999' },
      where: { id: nou.id },
    });
    const admin2 = await account('admin2@example.test');
    await prisma.accountIdentity.deleteMany({
      where: { accountId: admin2.id },
    });
    const desk = await account('receptie@example.test');
    await prisma.garageMember.updateMany({
      data: { role: 'owner' },
      where: { accountId: desk.id },
    });
    const quoting = await account('mecanic-oferte-militari@example.test');
    await prisma.mechanic.update({
      data: { canAnswerQuotes: false },
      where: { accountId: quoting.id },
    });
    const switcher = await account('comutare@example.test');
    await prisma.accountIdentity.updateMany({
      data: { subject: 'alt@example.test' },
      where: { accountId: switcher.id, method: 'password' },
    });
  };

  // @traces 1372-FR-001
  // @traces 1372-FR-002
  // @traces 1372-FR-003
  // @traces 1372-FR-007
  it('restores a seeded account whose password, roles and garage link drifted, and keeps its name', async () => {
    expect(run().status).toBe(0);
    await drift();

    expect(run().status).toBe(0);

    const nou = await account('nou@example.test');
    const identity = nou.identities.find((i) => i.method === 'password');
    expect(identity?.subject).toBe('nou@example.test');
    await expect(
      verifyPassword(PASSWORD, identity?.passwordHash ?? ''),
    ).resolves.toBe(true);
    expect(nou.roles.map((r) => r.role)).toEqual(['garage']);
    expect(nou.memberships.map((m) => [m.garage.slug, m.role])).toEqual([
      ['atelier-nou', 'owner'],
    ]);
    expect([nou.name, nou.phone]).toEqual(['Radu Redenumit', '+40700000999']);
    const admin2 = await passwordOf('admin2@example.test');
    expect(admin2?.subject).toBe('admin2@example.test');
    await expect(
      verifyPassword(PASSWORD, admin2?.passwordHash ?? ''),
    ).resolves.toBe(true);
    const desk = await account('receptie@example.test');
    expect(desk.memberships.map((m) => [m.garage.slug, m.role])).toEqual([
      ['atelier-test', 'receptionist'],
    ]);
    const quoting = await account('mecanic-oferte-militari@example.test');
    expect(quoting.mechanic?.canAnswerQuotes).toBe(true);
    expect((await passwordOf('comutare@example.test'))?.subject).toBe(
      'comutare@example.test',
    );
  });

  // @traces 1372-FR-003
  it('leaves a link a seeded account holds at another garage, and runs on', async () => {
    expect(run().status).toBe(0);
    const garageOf = async (slug: string) =>
      (await prisma.garage.findUniqueOrThrow({ where: { slug } })).id;
    const owner = await account('doua-roluri@example.test');
    await prisma.garageMember.updateMany({
      data: { garageId: await garageOf('atelier-dinamo') },
      where: { accountId: owner.id },
    });
    // An owner elsewhere demoted at its seeded garage: the role stays wrong,
    // and the seed says so.
    const switcher = await account('comutare@example.test');
    await prisma.garageMember.updateMany({
      data: { role: 'receptionist' },
      where: { accountId: switcher.id },
    });
    await prisma.garageMember.create({
      data: {
        accountId: switcher.id,
        garageId: await garageOf('atelier-nou'),
        role: 'owner',
      },
    });
    const mechanic = await account('mecanic-militari@example.test');
    await prisma.mechanic.update({
      data: { garageId: await garageOf('atelier-test') },
      where: { accountId: mechanic.id },
    });

    const again = run();

    expect(again.status).toBe(0);
    expect(again.stderr).toContain(
      'seed: doua-roluri@example.test is owner at another garage, so its link to service-dobre is not added',
    );
    expect(again.stderr).toContain(
      'seed: mecanic-militari@example.test is mechanic at another garage',
    );
    expect(again.stderr).toContain(
      'seed: comutare@example.test is owner at another garage, so its link to atelier-dinamo is not added',
    );
    const moved = await account('doua-roluri@example.test');
    expect(moved.memberships.map((m) => [m.garage.slug, m.role])).toEqual([
      ['atelier-dinamo', 'owner'],
    ]);
    expect(
      (await account('mecanic-militari@example.test')).mechanic?.garageId,
    ).toBe(await garageOf('atelier-test'));
  });

  // @traces 1372-FR-001
  it('leaves a seeded password that already verifies as it is', async () => {
    expect(run().status).toBe(0);
    const before = await passwordOf('service@example.test');

    expect(run().status).toBe(0);

    expect(await passwordOf('service@example.test')).toEqual(before);
  });

  // @traces 1372-FR-004
  it('changes no row on the run after a repair', async () => {
    expect(run().status).toBe(0);
    await drift();
    expect(run().status).toBe(0);
    const repaired = await seeded();
    const counts = await rowCounts();

    expect(run().status).toBe(0);

    expect(await rowCounts()).toEqual(counts);
    expect(await seeded()).toEqual(repaired);
  });

  // @traces 1372-FR-005
  it('writes nothing on an account it does not own, and keeps a role a seeded account gained', async () => {
    expect(run().status).toBe(0);
    const stranger = await outsider();
    const before = await account(stranger.email ?? '');
    const pavel = await account('masina-noua@example.test');
    await prisma.accountRole.create({
      data: { accountId: pavel.id, role: 'driver' },
    });
    await prisma.account.update({
      data: { lastRole: 'driver', status: 'suspended' },
      where: { id: pavel.id },
    });

    expect(run().status).toBe(0);

    expect(await account(stranger.email ?? '')).toEqual(before);
    const after = await account('masina-noua@example.test');
    expect(after.roles.map((r) => r.role).sort()).toEqual(['driver', 'garage']);
    // The status is the seed's now, the last role still the user's.
    expect([after.lastRole, after.status]).toEqual(['driver', 'active']);
  });

  // @traces 1372-FR-006
  it('never prints the seed password while it repairs', async () => {
    expect(run().status).toBe(0);
    await drift();

    const repair = run();

    expect(repair.status).toBe(0);
    expect(`${repair.stdout}${repair.stderr}`).not.toContain(PASSWORD);
  });
});

// A deleted seeded account, or one with two password identities, still
// refused the draft owner; and the seeded driver's day must start unused.
// @traces 1373-FR-007
describe('seed of a deleted or doubled account, and of the day', () => {
  const PASSWORD = 'o-parola-din-secrete';
  const run = () => seed('staging', { SEED_PASSWORD: PASSWORD });
  const account = (email: string) =>
    prisma.account.findUniqueOrThrow({
      include: { identities: { orderBy: { subject: 'asc' } } },
      where: { email },
    });
  const passwords = async (email: string) =>
    (await account(email)).identities.filter((i) => i.method === 'password');
  // What the sign-in reads (sign-in.service.ts credentials()): a deleted
  // account has no password, and any password identity may be the one read.
  const signsIn = async (email: string) => {
    const found = await account(email);
    const [identity, ...more] = found.identities.filter(
      (i) => i.method === 'password',
    );
    return (
      found.status !== 'deleted' &&
      more.length === 0 &&
      (await verifyPassword(PASSWORD, identity?.passwordHash ?? ''))
    );
  };
  const summary = (stdout: string) =>
    stdout.split('\n').filter((line) => line.startsWith('seed: restored'));
  const sendNow = async (count: number) => {
    const car = await prisma.car.findFirstOrThrow({
      where: { owner: { email: 'cerere@example.test' } },
    });
    for (let n = 0; n < count; n++) {
      await prisma.quoteRequest.create({
        data: {
          carBrand: 'Dacia',
          carFuel: 'petrol',
          carId: car.id,
          carModel: car.model,
          carYear: car.year,
          driverId: car.ownerId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          idempotencyKey: `e2e-now-${n}`,
        },
      });
    }
  };

  // @traces 1373-FR-002
  it('gives a deleted seeded account, and one suspended by hand, its seeded status back', async () => {
    expect(run().status).toBe(0);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { email: 'nou@example.test' },
    });
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { email: 'sofer@example.test' },
    });
    await prisma.account.update({
      data: { status: 'active' },
      where: { email: 'suspendat@example.test' },
    });

    expect(run().status).toBe(0);

    expect((await account('nou@example.test')).status).toBe('active');
    expect((await account('sofer@example.test')).status).toBe('active');
    expect((await account('suspendat@example.test')).status).toBe('suspended');
    expect(await signsIn('nou@example.test')).toBe(true);
  });

  // @traces 1373-FR-003
  it('leaves exactly one password identity on a seeded account that held two, the repaired one', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    // Sorted before the e-mail, so a read in subject order meets it first.
    await prisma.accountIdentity.create({
      data: {
        accountId: nou.id,
        method: 'password',
        passwordHash: 'parola-veche',
        subject: 'a-nou@example.test',
      },
    });
    await prisma.accountIdentity.create({
      data: { accountId: nou.id, method: 'google', subject: 'google-nou' },
    });
    const stranger = await prisma.account.create({
      data: {
        email: 'dublu@example.test',
        identities: {
          create: [
            { method: 'password', passwordHash: 'unu', subject: 'dublu-1' },
            { method: 'password', passwordHash: 'doi', subject: 'dublu-2' },
          ],
        },
        lastRole: 'driver',
        name: 'Dublu',
      },
    });

    expect(run().status).toBe(0);

    expect((await passwords('nou@example.test')).map((i) => i.subject)).toEqual(
      ['nou@example.test'],
    );
    expect(await signsIn('nou@example.test')).toBe(true);
    const google = (await account('nou@example.test')).identities.filter(
      (i) => i.method === 'google',
    );
    expect(google.map((i) => i.subject)).toEqual(['google-nou']);
    const theirs = await prisma.accountIdentity.findMany({
      orderBy: { subject: 'asc' },
      where: { accountId: stranger.id },
    });
    expect(theirs.map((i) => i.subject)).toEqual(['dublu-1', 'dublu-2']);
  });

  // @traces 1373-FR-003
  it('keeps the first identity by subject, on its e-mail, when neither password identity is', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: 'parola-veche', subject: 'b-nou@example.test' },
      where: { accountId: nou.id, method: 'password' },
    });
    const first = await prisma.accountIdentity.create({
      data: {
        accountId: nou.id,
        method: 'password',
        passwordHash: 'alta-parola',
        subject: 'a-nou@example.test',
      },
    });

    expect(run().status).toBe(0);

    const left = await passwords('nou@example.test');
    expect(left.map((i) => [i.id, i.subject])).toEqual([
      [first.id, 'nou@example.test'],
    ]);
    expect(await signsIn('nou@example.test')).toBe(true);
  });

  // @traces 1373-FR-002
  // @traces 1373-FR-003
  it('changes no row on the run after it restored a status and removed an identity', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: nou.id },
    });
    await prisma.accountIdentity.create({
      data: {
        accountId: nou.id,
        method: 'password',
        passwordHash: 'parola-veche',
        subject: 'a-nou@example.test',
      },
    });
    expect(run().status).toBe(0);
    const repaired = await seeded();
    const counts = await rowCounts();

    expect(run().status).toBe(0);

    expect(await rowCounts()).toEqual(counts);
    expect(await seeded()).toEqual(repaired);
  });

  // @traces 1373-FR-004
  it("starts every seeded account's day with no request counted, the seed's own included", async () => {
    expect(run().status).toBe(0);
    await sendNow(20);

    expect(run().status).toBe(0);

    // The count QuoteRequestsService.store() refuses the 21st on.
    const today = await prisma.quoteRequest.count({
      where: {
        createdAt: { gte: atLocal(localDay(new Date()), 0) },
        driver: { email: { endsWith: '@example.test' } },
      },
    });
    expect(today).toBe(0);
    const own = await prisma.quoteRequest.count({
      where: { idempotencyKey: { startsWith: 'seed-' } },
    });
    expect(own).toBeGreaterThanOrEqual(2);
  });

  // @traces 1373-FR-005
  it('prints one summary line, by field and what it cleared, and never the password', async () => {
    const first = run();
    expect(first.status).toBe(0);
    expect(summary(first.stdout)).toHaveLength(1);
    const nou = await account('nou@example.test');
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: nou.id },
    });
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: 'parola-veche' },
      where: { accountId: nou.id, method: 'password' },
    });
    await prisma.accountIdentity.create({
      data: {
        accountId: nou.id,
        method: 'password',
        passwordHash: 'alta',
        subject: 'a-nou@example.test',
      },
    });
    await sendNow(3);

    const repair = run();

    expect(repair.status).toBe(0);
    expect(summary(repair.stdout)).toEqual([
      'seed: restored password 1, status 1, roles 0, link 0, extra password identities 1; cleared 3 quote requests',
    ]);
    expect(`${repair.stdout}${repair.stderr}`).not.toContain(PASSWORD);
    expect(summary(run().stdout)).toEqual([
      'seed: restored password 0, status 0, roles 0, link 0, extra password identities 0; cleared 0 quote requests',
    ]);
  });
});
