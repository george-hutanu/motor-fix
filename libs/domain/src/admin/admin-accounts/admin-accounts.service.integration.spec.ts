import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { AdminAccountsService, SUMMARY_KEY } from './admin-accounts.service';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';

const redisUrl = redisUrlFor(9);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NOW = new Date('2026-10-08T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const redis = new Redis(redisUrl);
const service = new AdminAccountsService(prisma, redis);

afterAll(async () => {
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.del(SUMMARY_KEY);
});

const person = async (
  name: string,
  roles: Role[],
  created: Date,
  status?: 'active' | 'suspended' | 'deleted',
) => {
  const id = await account(name, roles, { status });
  await prisma.account.update({
    data: { createdAt: created, phone: `+40799${randomUUID().slice(0, 6)}` },
    where: { id },
  });
  return id;
};

const garage = (name: string, status: 'draft' | 'approved' = 'draft') =>
  prisma.garage.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID()}`,
      status,
    },
  });

const car = async (ownerId: string, removed = false) => {
  const brand = await prisma.brand.upsert({
    create: { key: 'test-dacia', name: 'Dacia', slug: 'test-dacia' },
    update: {},
    where: { name: 'Dacia' },
  });
  await prisma.car.create({
    data: {
      brandId: brand.id,
      fuel: 'petrol',
      idempotencyKey: randomUUID(),
      model: 'Logan',
      odometerKm: 90000,
      ownerId,
      plate: 'B123ABC',
      removedAt: removed ? NOW : null,
      year: 2018,
    },
  });
};

const suspension = (accountId: string, at: Date, value = 'suspended') =>
  prisma.activityLog.create({
    data: {
      action: 'update',
      actorName: 'Admin',
      actorRole: 'admin',
      at,
      field: 'status',
      newValue: value,
      oldValue: value === 'suspended' ? 'active' : 'suspended',
      subjectId: accountId,
      subjectType: 'account',
    },
  });

const itemOf = async (id: string) =>
  (await service.page(undefined, NOW)).items.find((i) => i.id === id);

describe('the recent accounts', () => {
  it('lists the newest first, twenty to a page, and leaves deleted accounts out', async () => {
    for (let n = 0; n < 22; n++)
      await person(`Cont ${n}`, ['driver'], daysAgo(30 + n));
    await person('Șters', ['driver'], daysAgo(1), 'deleted');

    const first = await service.page(undefined, NOW);

    expect(first.items).toHaveLength(20);
    expect(first.items.map((i) => i.name)).toEqual(
      Array.from({ length: 20 }, (_, n) => `Cont ${n}`),
    );
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await service.page(first.nextCursor ?? undefined, NOW);
    expect(second.items.map((i) => i.name)).toEqual(['Cont 20', 'Cont 21']);
    expect(second.nextCursor).toBeNull();
  });

  it('shows every account exactly once across pages while newer ones arrive', async () => {
    for (let n = 0; n < 45; n++)
      await person(`Cont ${n}`, ['driver'], daysAgo(30 + n));

    const seen: string[] = [];
    let cursor: string | undefined;
    let loads = 0;
    do {
      const page = await service.page(cursor, NOW);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
      loads += 1;
      if (loads === 1) await person('Nou', ['driver'], daysAgo(0.5));
    } while (cursor);

    expect(loads).toBe(3);
    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
  });

  it('breaks a tie in creation time by id, without repeating or skipping', async () => {
    const same = daysAgo(40);
    for (let n = 0; n < 25; n++) await person(`Geamăn ${n}`, ['driver'], same);

    const first = await service.page(undefined, NOW);
    const second = await service.page(first.nextCursor ?? undefined, NOW);
    const ids = [...first.items, ...second.items].map((i) => i.id);

    expect(new Set(ids).size).toBe(25);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it.each([
    'not-base64!',
    Buffer.from('no separator').toString('base64url'),
    Buffer.from(`yesterday|${randomUUID()}`).toString('base64url'),
    Buffer.from(`${NOW.toISOString()}|not-a-uuid`).toString('base64url'),
  ])('refuses the cursor %s as invalid_cursor', async (cursor) => {
    await expect(service.page(cursor, NOW)).rejects.toMatchObject({
      response: { code: 'invalid_cursor' },
      status: 400,
    });
  });

  it('answers what follows a cursor whose account is gone', async () => {
    const older = await person('Mai vechi', ['driver'], daysAgo(50));
    const cursor = Buffer.from(
      `${daysAgo(40).toISOString()}|${randomUUID()}`,
    ).toString('base64url');

    const page = await service.page(cursor, NOW);

    expect(page.items.map((i) => i.id)).toEqual([older]);
  });
});

describe('each role in the list', () => {
  it('gives a driver their cars that are not removed and a requests count', async () => {
    const id = await person('Andrei', ['driver'], daysAgo(200));
    await car(id);
    await car(id);
    await car(id, true);

    expect(await itemOf(id)).toEqual({
      carsCount: 2,
      count: { kind: 'requests', value: 0 },
      createdAt: daysAgo(200).toISOString(),
      garageName: null,
      id,
      name: 'Andrei',
      roles: ['driver'],
      since: daysAgo(200).toISOString(),
      status: 'active',
    });
  });

  it('gives a driver with no car zero cars', async () => {
    const id = await person('Fără mașină', ['driver'], daysAgo(20));

    expect(await itemOf(id)).toMatchObject({ carsCount: 0, garageName: null });
  });

  it('gives an owner their garage and a reviews count', async () => {
    const id = await person('Mihai', ['garage'], daysAgo(100));
    const { id: garageId } = await garage('Atelier Dinamo');
    await prisma.garageMember.create({
      data: { accountId: id, garageId, role: 'owner' },
    });

    expect(await itemOf(id)).toMatchObject({
      count: { kind: 'reviews', value: 0 },
      garageName: 'Atelier Dinamo',
      roles: ['garage'],
    });
  });

  it('gives a mechanic the garage of their card and a reviews count', async () => {
    const id = await person('Costel', ['mechanic'], daysAgo(100));
    const { id: garageId } = await garage('Atelier Dinamo');
    await prisma.mechanic.create({
      data: { accountId: id, garageId, name: 'Costel' },
    });

    expect(await itemOf(id)).toMatchObject({
      count: { kind: 'reviews', value: 0 },
      garageName: 'Atelier Dinamo',
      roles: ['mechanic'],
    });
  });

  it('gives a receptionist their garage and the account age', async () => {
    const id = await person('Ioana', ['receptionist'], daysAgo(30));
    const { id: garageId } = await garage('Atelier Test');
    await prisma.garageMember.create({
      data: { accountId: id, garageId, role: 'receptionist' },
    });

    expect(await itemOf(id)).toMatchObject({
      count: { kind: 'age', value: 30 },
      garageName: 'Atelier Test',
    });
  });

  it('gives an admin no garage and the account age', async () => {
    const id = await person('Admin', ['admin'], daysAgo(400));

    expect(await itemOf(id)).toMatchObject({
      count: { kind: 'age', value: 400 },
      garageName: null,
      roles: ['admin'],
    });
  });

  it('orders a driver and owner as driver first, with the owned garage and requests', async () => {
    const id = await person('Elena', ['garage', 'driver'], daysAgo(60));
    const { id: garageId } = await garage('Service Dobre');
    await prisma.garageMember.create({
      data: { accountId: id, garageId, role: 'owner' },
    });

    expect(await itemOf(id)).toMatchObject({
      count: { kind: 'requests', value: 0 },
      garageName: 'Service Dobre',
      roles: ['driver', 'garage'],
    });
  });

  it.each([
    [0, 0],
    [0.5, 0],
    [6.99, 6],
  ])(
    'counts an account created %s days ago by its age, %s days',
    async (ago, value) => {
      const id = await person('Nou', ['driver'], daysAgo(ago));

      expect((await itemOf(id))?.count).toEqual({ kind: 'age', value });
    },
  );

  it('counts an account exactly seven days old by its role again', async () => {
    const id = await person('O săptămână', ['driver'], daysAgo(7));

    expect((await itemOf(id))?.count).toEqual({ kind: 'requests', value: 0 });
  });

  it('dates a suspension from its latest recorded change to suspended', async () => {
    const id = await person('Radu', ['driver'], daysAgo(90), 'suspended');
    await suspension(id, daysAgo(40));
    await suspension(id, daysAgo(20), 'active');
    await suspension(id, daysAgo(6));

    expect(await itemOf(id)).toMatchObject({
      since: daysAgo(6).toISOString(),
      status: 'suspended',
    });
  });

  it('leaves the suspension date empty when none is recorded', async () => {
    const id = await person('Radu', ['driver'], daysAgo(90), 'suspended');

    expect(await itemOf(id)).toMatchObject({
      since: null,
      status: 'suspended',
    });
  });

  it('carries nothing personal beyond the name', async () => {
    const id = await person('Andrei', ['driver'], daysAgo(200));
    await car(id);
    const { email, phone } = await prisma.account.findUniqueOrThrow({
      where: { id },
    });

    const page = await service.page(undefined, NOW);
    const text = JSON.stringify(page);

    expect(Object.keys(page.items[0]).sort()).toEqual([
      'carsCount',
      'count',
      'createdAt',
      'garageName',
      'id',
      'name',
      'roles',
      'since',
      'status',
    ]);
    for (const secret of [email, phone, 'B123ABC']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('the platform totals', () => {
  const activeDriver = async (name: string) => {
    const id = await person(name, ['driver'], daysAgo(100));
    await prisma.account.update({
      data: { lastActiveAt: daysAgo(2) },
      where: { id },
    });
  };

  it('counts active drivers, listed garages and mechanics with an account at listed garages', async () => {
    await activeDriver('Șofer 1');
    await activeDriver('Șofer 2');
    await person('Inactiv', ['driver'], daysAgo(100));
    const listed = await garage('Listat', 'approved');
    const draft = await garage('Ciornă');
    const withAccount = await person('Mecanic', ['mechanic'], daysAgo(10));
    const elsewhere = await person('Mecanic 2', ['mechanic'], daysAgo(10));
    await prisma.mechanic.createMany({
      data: [
        { accountId: withAccount, garageId: listed.id, name: 'Mecanic' },
        { garageId: listed.id, name: 'Fără cont' },
        { accountId: elsewhere, garageId: draft.id, name: 'Mecanic 2' },
      ],
    });

    expect(await service.summary(NOW)).toEqual({
      activeDrivers: 2,
      garagesListed: 1,
      mechanics: 1,
    });
  });

  it('keeps the totals for sixty seconds, then counts again', async () => {
    await activeDriver('Șofer 1');
    expect((await service.summary(NOW)).activeDrivers).toBe(1);

    await activeDriver('Șofer 2');
    expect((await service.summary(NOW)).activeDrivers).toBe(1);
    const ttl = await redis.ttl(SUMMARY_KEY);
    expect(ttl).toBeGreaterThan(55);
    expect(ttl).toBeLessThanOrEqual(60);

    await redis.del(SUMMARY_KEY);
    expect((await service.summary(NOW)).activeDrivers).toBe(2);
  });

  it('counts again when the kept copy cannot be read', async () => {
    await activeDriver('Șofer 1');
    await redis.set(SUMMARY_KEY, 'not json', 'EX', 60);

    expect((await service.summary(NOW)).activeDrivers).toBe(1);
  });

  it('reads the database when Redis is down', async () => {
    await activeDriver('Șofer 1');
    const down = new Redis('redis://127.0.0.1:1', {
      commandTimeout: 200,
      connectTimeout: 200,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
    });
    down.on('error', () => undefined);

    const totals = await new AdminAccountsService(prisma, down).summary(NOW);

    expect(totals.activeDrivers).toBe(1);
    down.disconnect();
  });
});
