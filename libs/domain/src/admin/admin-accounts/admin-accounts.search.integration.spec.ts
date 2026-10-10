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

type Search = NonNullable<Parameters<AdminAccountsService['page']>[2]>;

const redisUrl = redisUrlFor(9);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NOW = new Date('2026-10-08T12:00:00.000Z');
const DAY = 86_400_000;

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

// A made-up address of the letters g to v only: no digit to match a phone
// query and no a to f, so a short query such as "ab" never matches it.
const address = () =>
  `${randomUUID()
    .replace(/-/g, '')
    .replace(
      /./g,
      (c) => 'ghijklmnopqrstuv'[Number.parseInt(c, 16)],
    )}@example.test`;

let made = 0;

// Each account a day older than the one before, so the order is known.
const person = async (
  name: string,
  options: {
    email?: string;
    phone?: string;
    roles?: Role[];
    status?: 'active' | 'suspended' | 'deleted';
  } = {},
) => {
  made += 1;
  const id = await account(name, options.roles ?? ['driver'], {
    email: options.email ?? address(),
    status: options.status,
  });
  await prisma.account.update({
    data: {
      createdAt: new Date(NOW.getTime() - made * DAY),
      phone: options.phone ?? null,
    },
    where: { id },
  });
  return id;
};

const garage = (name: string) =>
  prisma.garage.create({
    data: { name, slug: `garage-${randomUUID()}` },
  });

const names = async (search: Search, cursor?: string) =>
  (await service.page(cursor, NOW, search)).items.map((i) => i.name);

// @traces 002-FR-015
describe('searching by name', () => {
  // @traces 002-FR-003
  it('finds a name by any part of it, whatever the case', async () => {
    await person('Andrei Marin');
    await person('Maria Pop');

    expect(await names({ q: 'andrei mar' })).toEqual(['Andrei Marin']);
    expect(await names({ q: 'ANDREI MARIN' })).toEqual(['Andrei Marin']);
  });

  it('ignores Romanian accents in the query and in the name', async () => {
    await person('Ștefan Țăranu');
    await person('Stefan Ionescu');

    expect(await names({ q: 'stefan' })).toEqual([
      'Ștefan Țăranu',
      'Stefan Ionescu',
    ]);
    expect(await names({ q: 'Ştefan' })).toEqual([
      'Ștefan Țăranu',
      'Stefan Ionescu',
    ]);
    expect(await names({ q: 'taranu' })).toEqual(['Ștefan Țăranu']);
    expect(await names({ q: 'ȚĂRANU' })).toEqual(['Ștefan Țăranu']);
  });

  it('finds a name stored with its marks written apart from their letters', async () => {
    // Ș as S and a combining comma below, ă as a and a combining breve.
    await person('Ștefan Țăranu');

    expect(await names({ q: 'stefan' })).toEqual([
      'Ștefan Țăranu'.normalize('NFD'),
    ]);
    expect(await names({ q: 'Țăranu' })).toEqual([
      'Ștefan Țăranu'.normalize('NFD'),
    ]);
  });

  it('collapses the spaces in the query', async () => {
    await person('Andrei Marin');

    expect(await names({ q: '  andrei    marin ' })).toEqual(['Andrei Marin']);
  });

  it('takes percent, underscore and backslash as plain text', async () => {
    await person('Ana_Maria');
    await person('Ana Maria');
    await person('Ana 100%');

    expect(await names({ q: 'a_m' })).toEqual(['Ana_Maria']);
    expect(await names({ q: '0%' })).toEqual(['Ana 100%']);
    expect(await names({ q: 'a\\' })).toEqual([]);
  });
});

describe('searching by e-mail', () => {
  // @traces 002-FR-003
  it.each(['andrei.marin@', 'gmail.com', 'MARIN@GMAIL'])(
    'finds the account by %s',
    async (q) => {
      await person('Andrei Marin', { email: 'andrei.marin@gmail.com' });
      await person('Maria Pop', { email: 'maria@yahoo.ro' });

      expect(await names({ q })).toEqual(['Andrei Marin']);
    },
  );
});

describe('searching by phone', () => {
  // @traces 002-FR-004
  it.each([
    '0722 123 456',
    '0722123456',
    '+40722123456',
    '0040722123456',
    '+40 722 123 456',
    '0722-123.456',
    '0722',
  ])('finds +40722123456 by %s', async (q) => {
    await person('Andrei Marin', { phone: '+40722123456' });
    await person('Maria Pop', { phone: '+40733000111' });

    expect(await names({ q })).toEqual(['Andrei Marin']);
  });

  it('compares a foreign number in its own country code', async () => {
    await person('John Smith', { phone: '+447700900123' });
    await person('Andrei Marin', { phone: '+40722123456' });

    expect(await names({ q: '+44 7700 900123' })).toEqual(['John Smith']);
    expect(await names({ q: '07700900123' })).toEqual([]);
  });

  it('never matches a phone with fewer than four digits', async () => {
    await person('Andrei Marin', { phone: '+40722123456' });

    expect(await names({ q: '12' })).toEqual([]);
    expect(await names({ q: '722' })).toEqual([]);
  });

  it('reads letters and digits together as text, not as a phone', async () => {
    await person('Andrei Marin', { phone: '+40722123456' });
    await person('andrei 0722', { email: 'a0722@example.test' });

    expect(await names({ q: 'andrei 0722' })).toEqual(['andrei 0722']);
  });

  it('also finds a name or e-mail holding the digits', async () => {
    await person('Andrei Marin', { phone: '+40722123456' });
    await person('Firma 0722', { email: 'f@example.test' });

    expect(await names({ q: '0722' })).toEqual(['Andrei Marin', 'Firma 0722']);
  });
});

describe('searching by garage', () => {
  // @traces 002-FR-003
  it('finds the owner, the receptionist and the mechanic of a garage', async () => {
    const { id: garageId } = await garage('Atelier Dinamo');
    const owner = await person('Mihai', { roles: ['garage'] });
    const desk = await person('Ioana', { roles: ['receptionist'] });
    const fixer = await person('Costel', { roles: ['mechanic'] });
    await person('Altcineva', { roles: ['driver'] });
    await prisma.garageMember.createMany({
      data: [
        { accountId: owner, garageId, role: 'owner' },
        { accountId: desk, garageId, role: 'receptionist' },
      ],
    });
    await prisma.mechanic.create({
      data: { accountId: fixer, garageId, name: 'Costel' },
    });

    expect(await names({ q: 'dinamo' })).toEqual(['Mihai', 'Ioana', 'Costel']);
  });

  it('finds an account at two garages by either name, accents ignored', async () => {
    const { id: first } = await garage('Atelier Dinamo');
    const { id: second } = await garage('Service Vulcan Ștefănești');
    const id = await person('Mihai', { roles: ['garage', 'receptionist'] });
    await prisma.garageMember.createMany({
      data: [
        { accountId: id, garageId: first, role: 'owner' },
        { accountId: id, garageId: second, role: 'receptionist' },
      ],
    });

    expect(await names({ q: 'dinamo' })).toEqual(['Mihai']);
    expect(await names({ q: 'stefanesti' })).toEqual(['Mihai']);
  });
});

describe('what a search never finds', () => {
  // @traces 002-FR-001
  it('leaves a deleted account out by name, e-mail and phone', async () => {
    await person('Andrei Marin', {
      email: 'andrei.marin@gmail.com',
      phone: '+40722123456',
      status: 'deleted',
    });

    expect(await names({ q: 'andrei' })).toEqual([]);
    expect(await names({ q: 'andrei.marin@' })).toEqual([]);
    expect(await names({ q: '0722 123 456' })).toEqual([]);
    expect(await names({ status: 'active' })).toEqual([]);
  });
});

describe('a query too short or too long', () => {
  // @traces 002-FR-002
  it('reads one character as no search, with no total', async () => {
    await person('Andrei');
    await person('Maria');

    const page = await service.page(undefined, NOW, { q: ' a ' });

    expect(page.items.map((i) => i.name)).toEqual(['Andrei', 'Maria']);
    expect(page.total).toBeUndefined();
  });

  it('refuses more than eighty characters as invalid_query', async () => {
    await expect(
      service.page(undefined, NOW, { q: 'a'.repeat(81) }),
    ).rejects.toMatchObject({
      response: { code: 'invalid_query' },
      status: 400,
    });
  });

  it('counts the length after collapsing the spaces', async () => {
    const page = await service.page(undefined, NOW, {
      q: `${'a'.repeat(40)}      ${'b'.repeat(39)}`,
    });

    expect(page.items).toEqual([]);
  });
});

describe('the filters', () => {
  // @traces 002-FR-005
  it('keeps the accounts holding any of the roles, each once', async () => {
    await person('Șofer', { roles: ['driver'] });
    await person('Șofer și service', { roles: ['driver', 'garage'] });
    await person('Mecanic', { roles: ['mechanic'] });
    await person('Admin', { roles: ['admin'] });

    expect(await names({ role: ['mechanic'] })).toEqual(['Mecanic']);
    const page = await service.page(undefined, NOW, {
      role: ['driver', 'garage'],
    });
    expect(page.items.map((i) => i.name)).toEqual([
      'Șofer',
      'Șofer și service',
    ]);
    expect(page.total).toBe(2);
  });

  it('reads comma-separated, repeated and empty role values', async () => {
    await person('Șofer', { roles: ['driver'] });
    await person('Mecanic', { roles: ['mechanic'] });
    await person('Admin', { roles: ['admin'] });

    expect(await names({ role: 'driver,mechanic' })).toEqual([
      'Șofer',
      'Mecanic',
    ]);
    expect(await names({ role: ['driver', 'driver'] })).toEqual(['Șofer']);
    const none = await service.page(undefined, NOW, { role: '' });
    expect(none.items).toHaveLength(3);
    expect(none.total).toBeUndefined();
  });

  it('keeps the accounts in the state chosen', async () => {
    await person('Activ');
    await person('Suspendat', { status: 'suspended' });

    expect(await names({ status: 'active' })).toEqual(['Activ']);
    expect(await names({ status: 'suspended' })).toEqual(['Suspendat']);
  });

  it('answers nobody under watch, with a total of zero', async () => {
    await person('Activ');

    expect(await service.page(undefined, NOW, { status: 'watch' })).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
  });

  // @traces 002-FR-005
  it('combines the search, the roles and the state', async () => {
    const { id: garageId } = await garage('Atelier Dinamo');
    const active = await person('Costel', { roles: ['mechanic'] });
    const away = await person('Vasile', {
      roles: ['mechanic'],
      status: 'suspended',
    });
    const elsewhere = await person('Gigel', { roles: ['mechanic'] });
    const { id: other } = await garage('Atelier Vulcan');
    await person('Dinamo Fan', { roles: ['driver'] });
    await prisma.mechanic.createMany({
      data: [
        { accountId: active, garageId, name: 'Costel' },
        { accountId: away, garageId, name: 'Vasile' },
        { accountId: elsewhere, garageId: other, name: 'Gigel' },
      ],
    });

    expect(await names({ role: ['mechanic'], status: 'active' })).toEqual([
      'Costel',
      'Gigel',
    ]);
    const page = await service.page(undefined, NOW, {
      q: 'dinamo',
      role: ['mechanic'],
      status: 'active',
    });
    expect(page.items.map((i) => i.name)).toEqual(['Costel']);
    expect(page.total).toBe(1);
    expect(await names({ q: 'dinamo', role: ['driver'] })).toEqual([
      'Dinamo Fan',
    ]);
  });

  it.each([
    [{ role: ['pilot'] }],
    [{ role: 'driver,pilot' }],
    [{ status: 'deleted' }],
    [{ status: ['active', 'suspended'] }],
  ] as Search[][])('refuses %j as invalid_filter', async (search) => {
    await expect(service.page(undefined, NOW, search)).rejects.toMatchObject({
      response: { code: 'invalid_filter' },
      status: 400,
    });
  });
});

describe('paging a search', () => {
  // @traces 002-FR-006
  it('counts every match and chains the pages within the search', async () => {
    for (let n = 0; n < 23; n++) await person(`Marin ${n}`);
    await person('Altcineva');

    const first = await service.page(undefined, NOW, { q: 'marin' });
    expect(first.items).toHaveLength(20);
    expect(first.total).toBe(23);
    const second = await service.page(first.nextCursor ?? undefined, NOW, {
      q: 'marin',
    });
    expect(second.items.map((i) => i.name)).toEqual([
      'Marin 20',
      'Marin 21',
      'Marin 22',
    ]);
    expect(second.total).toBe(23);
    expect(second.nextCursor).toBeNull();
  });

  // @traces 002-FR-006
  it("reads a page's matches and their number in one statement, so both see the same accounts", async () => {
    for (let n = 0; n < 3; n++) await person(`Marin ${n}`);
    const read = jest.spyOn(prisma, '$queryRaw');
    try {
      const page = await service.page(undefined, NOW, { q: 'marin' });
      expect(page.items).toHaveLength(3);
      expect(page.total).toBe(3);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
    }
  });

  it('still counts the matches on a page past the last one', async () => {
    for (let n = 0; n < 21; n++) await person(`Marin ${n}`);
    const first = await service.page(undefined, NOW, { q: 'marin' });
    const second = await service.page(first.nextCursor ?? undefined, NOW, {
      q: 'marin',
    });
    await prisma.account.updateMany({
      data: { status: 'deleted' },
      where: { name: 'Marin 20' },
    });

    const past = await service.page(first.nextCursor ?? undefined, NOW, {
      q: 'marin',
    });

    expect(second.items).toHaveLength(1);
    expect(past.items).toEqual([]);
    expect(past.total).toBe(20);
    expect(past.nextCursor).toBeNull();
  });

  it('carries no total on the plain list', async () => {
    await person('Andrei');

    expect((await service.page(undefined, NOW)).total).toBeUndefined();
  });

  it('gives each found account the same row as the plain list', async () => {
    const id = await person('Andrei Marin', {
      email: 'andrei.marin@gmail.com',
      phone: '+40722123456',
    });

    const plain = (await service.page(undefined, NOW)).items;
    const found = (await service.page(undefined, NOW, { q: '0722123456' }))
      .items;

    expect(found).toEqual(plain.filter((i) => i.id === id));
    expect(JSON.stringify(found)).not.toMatch(/gmail|722123456/);
  });
});
