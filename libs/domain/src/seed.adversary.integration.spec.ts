import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { hashPassword, verifyPassword } from './auth/password/password';
import { createPrisma } from './auth/prisma';
import { serialDatabase } from './auth/serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);

const PASSWORD = 'o-parola-din-secrete';

const seedAsync = (APP_ENV: string, extra: Record<string, string>) =>
  new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, [join(__dirname, 'seed.ts')], {
      env: { ...process.env, APP_ENV, DATABASE_URL: databaseUrl, ...extra },
      stdio: 'ignore',
    });
    child.on('close', (code: number | null) => resolve(code));
  });

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

const run = (password = PASSWORD) =>
  seed('staging', { SEED_PASSWORD: password });

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

const ownedTables = async () => ({
  account: await prisma.account.count(),
  garageMember: await prisma.garageMember.count(),
  identity: await prisma.accountIdentity.count(),
  mechanic: await prisma.mechanic.count(),
  role: await prisma.accountRole.count(),
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage, brand CASCADE');
});

describe('seed restore of accounts, attacked', () => {
  // @traces 1372-FR-001
  it.each([
    ['an empty string', ''],
    ['not a hash at all', 'nu-e-un-hash'],
    ['a truncated argon2 prefix', '$argon2id$v=19$m=65536,t=3,p=4$'],
    ['whitespace', '   '],
  ])('rewrites a password hash that is %s', async (_, bad) => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: bad },
      where: { accountId: nou.id, method: 'password' },
    });

    const again = run();

    expect(again.status).toBe(0);
    const identity = await passwordOf('nou@example.test');
    await expect(
      verifyPassword(PASSWORD, identity?.passwordHash ?? ''),
    ).resolves.toBe(true);
  });

  // @traces 1372-FR-001
  it('rewrites a NULL password hash', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: null },
      where: { accountId: nou.id, method: 'password' },
    });

    expect(run().status).toBe(0);

    const identity = await passwordOf('nou@example.test');
    await expect(
      verifyPassword(PASSWORD, identity?.passwordHash ?? ''),
    ).resolves.toBe(true);
  });

  // @traces 1372-FR-001
  it('rewrites a valid argon2id hash of a different password', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    const other = await hashPassword('alta-parola-valida-1');
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: other },
      where: { accountId: nou.id, method: 'password' },
    });

    expect(run().status).toBe(0);

    const identity = await passwordOf('nou@example.test');
    expect(identity?.passwordHash).not.toBe(other);
    await expect(
      verifyPassword(PASSWORD, identity?.passwordHash ?? ''),
    ).resolves.toBe(true);
  });

  // @traces 1372-FR-001
  it('rewrites every seeded hash when SEED_PASSWORD changes between runs', async () => {
    expect(run('prima-parola-lunga').status).toBe(0);

    expect(run('a-doua-parola-lunga').status).toBe(0);

    const accounts = await prisma.account.findMany({
      include: { identities: true },
      where: { email: { endsWith: '@example.test' } },
    });
    expect(accounts.length).toBeGreaterThan(10);
    for (const a of accounts) {
      const id = a.identities.find((i) => i.method === 'password');
      await expect(
        verifyPassword('a-doua-parola-lunga', id?.passwordHash ?? ''),
      ).resolves.toBe(true);
    }
  });

  // @traces 1372-FR-001
  it.each([
    ['unicode', 'pärolă-ștefan-😀-ăîșțâ'],
    ['quotes and shell characters', `a'b"c$d\`e;f|g&h\\i`],
    ['leading and trailing spaces', '  spatii in jur  '],
    ['a very long password', 'x'.repeat(5000)],
  ])('restores a drifted account with a %s seed password', async (_, pw) => {
    expect(run(pw).status).toBe(0);
    const nou = await account('nou@example.test');
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: 'veche' },
      where: { accountId: nou.id, method: 'password' },
    });

    const again = run(pw);

    expect(again.status).toBe(0);
    expect(`${again.stdout}${again.stderr}`).not.toContain(pw);
    const identity = await passwordOf('nou@example.test');
    await expect(
      verifyPassword(pw, identity?.passwordHash ?? ''),
    ).resolves.toBe(true);
  });

  // @traces 1372-FR-001
  it('sets only the subject of an identity whose hash already verifies', async () => {
    expect(run().status).toBe(0);
    const before = await passwordOf('service@example.test');
    await prisma.accountIdentity.update({
      data: { subject: 'alt@example.test' },
      where: { id: before?.id ?? '' },
    });

    expect(run().status).toBe(0);

    const after = await passwordOf('service@example.test');
    expect(after).toEqual(before);
  });

  // @traces 1372-FR-001
  it('leaves a non-password identity of a seeded account alone and still restores the password', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    await prisma.accountIdentity.create({
      data: {
        accountId: nou.id,
        method: 'google',
        passwordHash: null,
        subject: 'google-sub-123',
      },
    });
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: 'veche' },
      where: { accountId: nou.id, method: 'password' },
    });

    expect(run().status).toBe(0);

    const after = await account('nou@example.test');
    const google = after.identities.filter((i) => i.method === 'google');
    expect(google.map((i) => [i.subject, i.passwordHash])).toEqual([
      ['google-sub-123', null],
    ]);
    expect(
      after.identities.filter((i) => i.method === 'password'),
    ).toHaveLength(1);
    await expect(
      verifyPassword(
        PASSWORD,
        after.identities.find((i) => i.method === 'password')?.passwordHash ??
          '',
      ),
    ).resolves.toBe(true);
  });

  // @traces 1372-FR-002
  it('puts back a seeded role of a two-role account and keeps an unlisted one', async () => {
    expect(run().status).toBe(0);
    const acc = await account('doua-roluri@example.test');
    await prisma.accountRole.deleteMany({
      where: { accountId: acc.id, role: 'driver' },
    });
    const admin = await account('admin@example.test');
    await prisma.accountRole.create({
      data: { accountId: admin.id, role: 'driver' },
    });

    expect(run().status).toBe(0);

    expect(
      (await account('doua-roluri@example.test')).roles
        .map((r) => r.role)
        .sort(),
    ).toEqual(['driver', 'garage']);
    expect(
      (await account('admin@example.test')).roles.map((r) => r.role).sort(),
    ).toEqual(['admin', 'driver']);
  });

  // @traces 1372-FR-003
  it.each([
    ['service@example.test', 'atelier-test'],
    ['militari@example.test', 'service-auto-militari'],
  ])(
    'sets an owner link of %s that was demoted back to owner',
    async (email, slug) => {
      expect(run().status).toBe(0);
      const acc = await account(email);
      await prisma.garageMember.updateMany({
        data: { role: 'receptionist' },
        where: { accountId: acc.id },
      });

      expect(run().status).toBe(0);

      expect(
        (await account(email)).memberships.map((m) => [m.garage.slug, m.role]),
      ).toEqual([[slug, 'owner']]);
    },
  );

  // @traces 1372-FR-003
  it('turns can_answer_quotes off again for a mechanic who may not answer', async () => {
    expect(run().status).toBe(0);
    const acc = await account('mecanic@example.test');
    await prisma.mechanic.update({
      data: { canAnswerQuotes: true },
      where: { accountId: acc.id },
    });

    expect(run().status).toBe(0);

    expect(
      (await account('mecanic@example.test')).mechanic?.canAnswerQuotes,
    ).toBe(false);
  });

  // @traces 1372-FR-003
  it('re-inserts a deleted mechanic row with the account current name, and keeps a renamed mechanic card', async () => {
    expect(run().status).toBe(0);
    const gone = await account('mecanic@example.test');
    await prisma.mechanic.delete({ where: { accountId: gone.id } });
    await prisma.account.update({
      data: { name: 'Nume Nou Mecanic' },
      where: { id: gone.id },
    });
    const kept = await account('mecanic-militari@example.test');
    await prisma.mechanic.update({
      data: { name: 'Nume Pe Card' },
      where: { accountId: kept.id },
    });

    expect(run().status).toBe(0);

    expect((await account('mecanic@example.test')).mechanic?.name).toBe(
      'Nume Nou Mecanic',
    );
    expect(
      (await account('mecanic-militari@example.test')).mechanic?.name,
    ).toBe('Nume Pe Card');
  });

  // @traces 1372-FR-003
  it('leaves a second membership at a garage the seed did not make, and restores the seeded one', async () => {
    expect(run().status).toBe(0);
    const desk = await account('receptie@example.test');
    const other = await prisma.garage.findFirstOrThrow({
      where: { slug: 'service-auto-militari' },
    });
    await prisma.garageMember.create({
      data: { accountId: desk.id, garageId: other.id, role: 'owner' },
    });
    await prisma.garageMember.deleteMany({
      where: { accountId: desk.id, garage: { slug: 'atelier-test' } },
    });

    const again = run();

    expect(again.status).toBe(0);
    const after = await account('receptie@example.test');
    expect(after.memberships.map((m) => m.garage.slug).sort()).toEqual([
      'atelier-test',
      'service-auto-militari',
    ]);
    expect(
      after.memberships.find((m) => m.garage.slug === 'atelier-test')?.role,
    ).toBe('receptionist');
  });

  // @traces 1372-FR-003
  it('leaves an owner who owns a different garage there, and says the seeded link is missing', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    const other = await prisma.garage.findFirstOrThrow({
      where: { slug: 'atelier-test' },
    });
    await prisma.garageMember.deleteMany({ where: { accountId: nou.id } });
    await prisma.garageMember.create({
      data: { accountId: nou.id, garageId: other.id, role: 'owner' },
    });

    const again = run();

    // One owner role per account: the other garage keeps its owner, and the
    // seed says why the draft owner's link is missing.
    expect(again.status).toBe(0);
    expect(again.stderr).toContain(
      'seed: nou@example.test is owner at another garage, so its link to atelier-nou is not added',
    );
    const after = await account('nou@example.test');
    expect(after.memberships.map((m) => [m.garage.slug, m.role])).toEqual([
      ['atelier-test', 'owner'],
    ]);
  });

  // @traces 1372-FR-003
  it('does not crash on a mechanic whose card sits at another garage and leaves it there', async () => {
    expect(run().status).toBe(0);
    const mech = await account('mecanic@example.test');
    const other = await prisma.garage.findFirstOrThrow({
      where: { slug: 'service-auto-militari' },
    });
    await prisma.mechanic.update({
      data: { garageId: other.id },
      where: { accountId: mech.id },
    });

    const again = run();

    expect(again.status).toBe(0);
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { accountId: mech.id },
    });
    expect(row.garageId).toBe(other.id);
  });

  // @traces 1372-FR-005
  // The status is the seed's: a suspended or deleted seeded account gets its
  // seeded status back, the rest is kept.
  // @traces 1373-FR-006
  it('keeps name, phone, last role and phone verification of every seeded account, and restores its status', async () => {
    expect(run().status).toBe(0);
    const seededStatus = new Map(
      (
        await prisma.account.findMany({
          where: { email: { endsWith: '@example.test' } },
        })
      ).map((a) => [a.email, a.status]),
    );
    const verified = new Date('2026-01-02T03:04:05.000Z');
    await prisma.account.updateMany({
      data: {
        lastRole: 'driver',
        name: 'Alt Nume',
        phoneVerifiedAt: verified,
        status: 'suspended',
      },
      where: { email: { endsWith: '@example.test' } },
    });
    const before = await prisma.account.findMany({
      orderBy: { email: 'asc' },
      where: { email: { endsWith: '@example.test' } },
    });

    expect(run().status).toBe(0);

    const after = await prisma.account.findMany({
      orderBy: { email: 'asc' },
      where: { email: { endsWith: '@example.test' } },
    });
    expect(after).toEqual(
      before.map((a) => ({ ...a, status: seededStatus.get(a.email) })),
    );
    expect(after.map((a) => a.status)).toContain('suspended');
    expect(after.map((a) => a.status)).toContain('active');
  });

  // @traces 1372-FR-005
  it('writes nothing on accounts outside the list, however they look like a seeded one', async () => {
    expect(run().status).toBe(0);
    const hash = await hashPassword('parola-altcuiva-1');
    const mk = (email: string, subject: string) =>
      prisma.account.create({
        data: {
          email,
          identities: {
            create: { method: 'password', passwordHash: hash, subject },
          },
          lastRole: 'garage',
          name: 'Străin',
        },
      });
    await mk('NOU@example.test', 'NOU@example.test');
    await mk('nou@example.test.evil', 'nou@example.test.evil');
    await mk('nou+1@example.test', 'nou+1@example.test');
    await mk('admin@example.com', 'admin@example.com');
    await prisma.account.create({
      data: { lastRole: 'driver', name: 'Fără e-mail' },
    });
    const snapshot = () =>
      prisma.account.findMany({
        include: {
          identities: true,
          mechanic: true,
          memberships: true,
          roles: true,
        },
        orderBy: [{ email: 'asc' }, { name: 'asc' }],
        where: {
          OR: [
            { email: null },
            {
              email: {
                in: [
                  'NOU@example.test',
                  'nou@example.test.evil',
                  'nou+1@example.test',
                  'admin@example.com',
                ],
              },
            },
          ],
        },
      });
    const before = await snapshot();
    expect(before).toHaveLength(5);

    expect(run().status).toBe(0);

    expect(await snapshot()).toEqual(before);
  });

  // @traces 1372-FR-004
  it('adds no row to the account tables and changes no seeded row on a second run', async () => {
    expect(run().status).toBe(0);
    const everything = () =>
      prisma.account.findMany({
        include: {
          identities: { orderBy: { id: 'asc' } },
          mechanic: true,
          memberships: true,
          roles: true,
        },
        orderBy: { email: 'asc' },
      });
    const before = await everything();
    const counts = await ownedTables();

    expect(run().status).toBe(0);
    expect(run().status).toBe(0);

    expect(await ownedTables()).toEqual(counts);
    expect(await everything()).toEqual(before);
  });

  // @traces 1372-FR-004
  it('survives two seeds started at the same moment', async () => {
    expect(run().status).toBe(0);
    const counts = await ownedTables();
    const nou = await account('nou@example.test');
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: 'veche' },
      where: { accountId: nou.id, method: 'password' },
    });
    await prisma.garageMember.deleteMany({ where: { accountId: nou.id } });

    const codes = await Promise.all([
      seedAsync('staging', { SEED_PASSWORD: PASSWORD }),
      seedAsync('staging', { SEED_PASSWORD: PASSWORD }),
    ]);

    expect(codes).toEqual([0, 0]);
    expect(await ownedTables()).toEqual(counts);
    expect((await account('nou@example.test')).identities).toHaveLength(1);
  });

  // @traces 1372-FR-001 1372-FR-002 1372-FR-003
  it('restores every seeded account when all hashes, roles and links are wiped', async () => {
    expect(run().status).toBe(0);
    const reference = await prisma.account.findMany({
      include: { mechanic: true, memberships: true, roles: true },
      orderBy: { email: 'asc' },
      where: { email: { endsWith: '@example.test' } },
    });
    await prisma.accountIdentity.updateMany({ data: { passwordHash: 'x' } });
    await prisma.accountRole.deleteMany({});
    await prisma.garageMember.deleteMany({});
    await prisma.mechanic.updateMany({ data: { canAnswerQuotes: false } });

    expect(run().status).toBe(0);

    const after = await prisma.account.findMany({
      include: {
        identities: true,
        mechanic: true,
        memberships: true,
        roles: true,
      },
      orderBy: { email: 'asc' },
      where: { email: { endsWith: '@example.test' } },
    });
    const view = (a: {
      email: string | null;
      roles: { role: string }[];
      memberships: { role: string }[];
      mechanic: { canAnswerQuotes: boolean } | null;
    }) => [
      a.email,
      a.roles.map((r) => r.role).sort(),
      a.memberships.map((m) => m.role),
      a.mechanic?.canAnswerQuotes ?? null,
    ];
    expect(after.map(view)).toEqual(reference.map(view));
    for (const a of after) {
      const id = a.identities.find((i) => i.method === 'password');
      expect([a.email, id?.subject]).toEqual([a.email, a.email]);
      await expect(
        verifyPassword(PASSWORD, id?.passwordHash ?? ''),
      ).resolves.toBe(true);
    }
  });

  // @traces 1372-FR-006
  it('refuses production before any write even when accounts have drifted', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: 'veche' },
      where: { accountId: nou.id, method: 'password' },
    });

    const refused = seed('production', { SEED_PASSWORD: PASSWORD });

    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('seed refused: APP_ENV=production');
    expect((await passwordOf('nou@example.test'))?.passwordHash).toBe('veche');
  });

  // @traces 1372-FR-006
  it('refuses staging without SEED_PASSWORD and leaves drifted accounts as they are', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    await prisma.accountIdentity.updateMany({
      data: { passwordHash: 'veche' },
      where: { accountId: nou.id, method: 'password' },
    });

    const refused = seed('staging', { SEED_PASSWORD: '' });

    expect(refused.status).toBe(1);
    expect((await passwordOf('nou@example.test'))?.passwordHash).toBe('veche');
  });

  // @traces 1372-FR-006
  it('never prints the seed password, even when the database is unreachable', () => {
    const failed = spawnSync(process.execPath, [join(__dirname, 'seed.ts')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENV: 'staging',
        DATABASE_URL: 'postgresql://nobody:pw@127.0.0.1:1/none',
        SEED_PASSWORD: 'parola-care-nu-se-tipareste',
      },
    });

    expect(failed.status).not.toBe(0);
    expect(`${failed.stdout}${failed.stderr}`).not.toContain(
      'parola-care-nu-se-tipareste',
    );
  });

  // @traces 1372-FR-006
  it('never prints the seed password when a restore fails midway', async () => {
    expect(run().status).toBe(0);
    const nou = await account('nou@example.test');
    await prisma.accountIdentity.deleteMany({ where: { accountId: nou.id } });
    await prisma.account.create({
      data: {
        identities: {
          create: {
            method: 'password',
            passwordHash: 'x',
            subject: 'nou@example.test',
          },
        },
        lastRole: 'driver',
        name: 'Ocupă subiectul',
      },
    });

    const again = run();

    // The subject is another account's: the run fails and writes nothing.
    expect(again.status).toBe(1);
    expect(`${again.stdout}${again.stderr}`).not.toContain(PASSWORD);
    expect((await account('nou@example.test')).identities).toHaveLength(0);
  });
});
