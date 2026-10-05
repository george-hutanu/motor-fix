import { AccountsService } from './accounts.service';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';
import type { AuditPort } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import type { EventPort } from '../events/event.port';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);

function ports() {
  const audit = {
    record: jest.fn<
      ReturnType<AuditPort['record']>,
      Parameters<AuditPort['record']>
    >(async () => undefined),
    recordChanges: jest.fn<
      ReturnType<AuditPort['recordChanges']>,
      Parameters<AuditPort['recordChanges']>
    >(async () => undefined),
  };
  const events = {
    record: jest.fn<
      ReturnType<EventPort['record']>,
      Parameters<EventPort['record']>
    >(async () => undefined),
  };
  return { audit, events, service: new AccountsService(prisma, audit, events) };
}

const andrei = {
  identity: {
    method: 'password',
    passwordHash: '$argon2id$stub',
    subject: 'andrei@example.ro',
  },
  language: 'ro',
  name: 'Andrei',
  roles: ['driver'],
} as const;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
});

afterAll(() => prisma.$disconnect());

describe('createAccount', () => {
  it('stores a driver with language, active status and last role driver', async () => {
    const { service } = ports();

    const { id } = await service.createAccount({
      ...andrei,
      email: '  Andrei@Example.RO ',
    });

    const account = await prisma.account.findUniqueOrThrow({
      include: { identities: true, roles: true },
      where: { id },
    });
    expect(account).toMatchObject({
      email: 'andrei@example.ro',
      language: 'ro',
      lastRole: 'driver',
      name: 'Andrei',
      status: 'active',
    });
    expect(account.roles.map((r) => r.role)).toEqual(['driver']);
    expect(account.identities).toEqual([
      expect.objectContaining({
        method: 'password',
        subject: 'andrei@example.ro',
      }),
    ]);
  });

  it('defaults the language to ro', async () => {
    const { service } = ports();

    const { id } = await service.createAccount({
      ...andrei,
      language: undefined,
    });

    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id } })).language,
    ).toBe('ro');
  });

  it('leaves an e-mail given with a password unconfirmed', async () => {
    const { service } = ports();

    const { id } = await service.createAccount({
      ...andrei,
      email: 'andrei@example.ro',
    });

    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id } }))
        .emailVerifiedAt,
    ).toBeNull();
  });

  it.each([
    'google',
    'apple',
  ] as const)('counts an e-mail that %s vouches for as confirmed at once', async (method) => {
    const { service } = ports();

    const { id } = await service.createAccount({
      email: 'andrei@example.ro',
      identity: { method, subject: 'provider-subject' },
      name: 'Andrei',
      roles: ['driver'],
    });

    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id } }))
        .emailVerifiedAt,
    ).toBeInstanceOf(Date);
  });

  it('hands account.created and one audit entry per role to the ports, inside the transaction', async () => {
    const { audit, events, service } = ports();

    const { id } = await service.createAccount({
      ...andrei,
      roles: ['driver', 'admin'],
    });

    expect(events.record).toHaveBeenCalledTimes(1);
    const [eventTx, event] = events.record.mock.calls[0] ?? [];
    expect(event).toEqual({
      kind: 'account.created',
      payload: {
        accountId: id,
        method: 'password',
        roles: ['driver', 'admin'],
      },
      subjectId: id,
    });
    expect(audit.record).toHaveBeenCalledTimes(2);
    for (const [auditTx, entry] of audit.record.mock.calls) {
      expect(auditTx).toBe(eventTx);
      expect(entry).toMatchObject({
        action: 'create',
        actorId: id,
        field: 'role',
        subjectId: id,
        subjectType: 'account',
      });
    }
    expect(audit.record.mock.calls.map(([, entry]) => entry.newValue)).toEqual([
      'driver',
      'admin',
    ]);
    expect(eventTx).not.toBe(prisma);
  });

  it.each([
    'audit',
    'events',
  ] as const)('leaves no row behind when the %s port fails', async (failing) => {
    const all = ports();
    all[failing].record.mockRejectedValueOnce(new Error('port down'));

    await expect(all.service.createAccount(andrei)).rejects.toThrow(
      'port down',
    );
    expect(await prisma.account.count()).toBe(0);
  });

  it('refuses an account with no role', async () => {
    const { service } = ports();

    await expect(
      service.createAccount({ ...andrei, roles: [] }),
    ).rejects.toThrow();
    expect(await prisma.account.count()).toBe(0);
  });

  it('refuses a second account with the same e-mail in another case', async () => {
    const { service } = ports();
    await service.createAccount({ ...andrei, email: 'andrei@example.ro' });

    await expect(
      service.createAccount({
        ...andrei,
        email: 'ANDREI@example.ro',
        identity: { method: 'google', subject: 'google-1' },
      }),
    ).rejects.toThrow();
  });
});

describe('grantRole', () => {
  it('adds the role and audits it with the actor, old and new value', async () => {
    const { audit, service } = ports();
    const { id } = await service.createAccount(andrei);
    audit.record.mockClear();

    await prisma.$transaction((tx) =>
      service.grantRole(tx, { id, role: 'driver' }, id, 'garage'),
    );

    const roles = await prisma.accountRole.findMany({
      where: { accountId: id },
    });
    expect(roles.map((r) => r.role).sort()).toEqual(['driver', 'garage']);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), {
      action: 'update',
      actorId: id,
      actorRole: 'driver',
      field: 'role',
      newValue: 'garage',
      oldValue: null,
      subjectId: id,
      subjectType: 'account',
    });
  });

  it('changes nothing and audits nothing for a role already held', async () => {
    const { audit, service } = ports();
    const { id } = await service.createAccount(andrei);
    audit.record.mockClear();

    await prisma.$transaction((tx) =>
      service.grantRole(tx, { id, role: 'driver' }, id, 'driver'),
    );

    expect(await prisma.accountRole.count({ where: { accountId: id } })).toBe(
      1,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('with the audit history writer', () => {
  it('stores the account entries in the audit history', async () => {
    const service = new AccountsService(prisma, new AuditService(), {
      record: async () => undefined,
    });
    const { id } = await service.createAccount(andrei);
    await prisma.$transaction((tx) =>
      service.grantRole(tx, { id, role: 'driver' }, id, 'garage'),
    );

    const entries = await prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: { subjectId: id },
    });
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: id,
        actorName: 'Andrei',
        actorRole: 'driver',
        field: 'role',
        newValue: 'driver',
        subjectType: 'account',
      }),
      expect.objectContaining({
        action: 'update',
        actorName: 'Andrei',
        field: 'role',
        newValue: 'garage',
        oldValue: null,
      }),
    ]);
  });
});

describe('garage links', () => {
  async function garage(slug: string) {
    return prisma.garage.create({ data: { name: slug, slug } });
  }

  it('lets an account own one garage at most', async () => {
    const { service } = ports();
    const { id } = await service.createAccount({
      ...andrei,
      roles: ['garage'],
    });
    const dinamo = await garage('atelier-dinamo');
    const second = await garage('atelier-doi');
    await prisma.garageMember.create({
      data: { accountId: id, garageId: dinamo.id, role: 'owner' },
    });

    await expect(
      prisma.garageMember.create({
        data: { accountId: id, garageId: second.id, role: 'owner' },
      }),
    ).rejects.toThrow();
  });

  it('starts a mechanic with every permission off', async () => {
    const { service } = ports();
    const { id } = await service.createAccount({
      ...andrei,
      roles: ['mechanic'],
    });
    const dinamo = await garage('atelier-dinamo');

    const mechanic = await prisma.mechanic.create({
      data: { accountId: id, garageId: dinamo.id },
    });

    expect(mechanic).toMatchObject({
      canAnswerQuotes: false,
      canMoveBookings: false,
      canRecordFinalPrice: false,
    });
  });

  it('keeps a mechanic at one garage', async () => {
    const { service } = ports();
    const { id } = await service.createAccount({
      ...andrei,
      roles: ['mechanic'],
    });
    const dinamo = await garage('atelier-dinamo');
    const second = await garage('atelier-doi');
    await prisma.mechanic.create({
      data: { accountId: id, garageId: dinamo.id },
    });

    await expect(
      prisma.mechanic.create({ data: { accountId: id, garageId: second.id } }),
    ).rejects.toThrow();
  });
});
