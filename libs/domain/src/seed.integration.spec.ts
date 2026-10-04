import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { verifyPassword } from './auth/password';
import { createPrisma } from './auth/prisma';
import { serialDatabase } from './auth/serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);

const seed = (APP_ENV: string, extra: Record<string, string> = {}) => {
  const env: NodeJS.ProcessEnv = { ...process.env, APP_ENV, ...extra };
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
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
});

describe('seed', () => {
  it('refuses to run in production', () => {
    const run = seed('production');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('seed refused: APP_ENV=production');
  });

  it('refuses staging without SEED_PASSWORD, and writes nothing', async () => {
    const run = seed('staging');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('SEED_PASSWORD');
    expect(await seeded()).toHaveLength(0);
  });

  it('adds one account per role, a two-role account and a suspended driver', async () => {
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
      'doua-roluri@example.test': {
        lastRole: 'garage',
        roles: ['driver', 'garage'],
        status: 'active',
      },
      'mecanic@example.test': {
        lastRole: 'mechanic',
        roles: ['mechanic'],
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
      'suspendat@example.test': {
        lastRole: 'driver',
        roles: ['driver'],
        status: 'suspended',
      },
    });
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
});
