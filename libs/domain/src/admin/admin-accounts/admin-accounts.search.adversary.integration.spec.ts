import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AdminAccountsModule } from './admin-accounts.module';
import { AdminAccountsService, SUMMARY_KEY } from './admin-accounts.service';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';

type Search = NonNullable<Parameters<AdminAccountsService['page']>[2]>;

const redisUrl = redisUrlFor(9);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NOW = new Date('2026-10-08T12:00:00.000Z');
const DAY = 86_400_000;

const redis = new Redis(redisUrl);
const service = new AdminAccountsService(prisma, redis);
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      AdminAccountsModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.del(SUMMARY_KEY);
  token = undefined;
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

const names = async (search: Search) =>
  (await service.page(undefined, NOW, search)).items.map((i) => i.name);

let token: string | undefined;
const adminAuth = async () => {
  token ??= `Bearer ${signAccessToken(
    {
      // A fixed address, so no random one matches a short query.
      accountId: await account('Cont admin', ['admin'], {
        email: 'cont.admin@example.test',
      }),
      role: 'admin',
    },
    tokenSecret,
  )}`;
  return token;
};

const get = async (path: string) =>
  request(app.getHttpServer())
    .get(path)
    .set('Authorization', await adminAuth());

describe('text search treats the query as literal text', () => {
  // @traces 002-FR-003
  it('matches a percent sign only where the name holds one', async () => {
    await person('Reducere 50% azi');
    await person('Reducere 500 azi');

    expect(await names({ q: '50%' })).toEqual(['Reducere 50% azi']);
    expect(await names({ q: '%%' })).toEqual([]);
  });

  // @traces 002-FR-003
  it('matches an underscore only where the name holds one', async () => {
    await person('ab_cd');
    await person('abxcd');

    expect(await names({ q: 'b_c' })).toEqual(['ab_cd']);
  });

  // @traces 002-FR-003
  it('matches a backslash only where the name holds one', async () => {
    await person('C:\\Users\\Ion');
    await person('C:UsersIon');

    expect(await names({ q: '\\Users' })).toEqual(['C:\\Users\\Ion']);
    expect(await names({ q: '\\' + '\\' })).toEqual([]);
  });

  // @traces 002-FR-003
  it('does not read a quote or a semicolon as syntax', async () => {
    await person("O'Brien; DROP TABLE accounts");

    expect(await names({ q: "'; DROP" })).toEqual([]);
    expect(await names({ q: "o'brien; drop" })).toEqual([
      "O'Brien; DROP TABLE accounts",
    ]);
  });

  // @traces 002-FR-003
  it('matches a percent sign in an e-mail literally', async () => {
    await person('Plus', { email: 'a%b@example.test' });
    await person('Plain', { email: 'axb@example.test' });

    expect(await names({ q: 'a%b' })).toEqual(['Plus']);
  });
});

describe('accent folding', () => {
  // @traces 002-FR-003
  it.each([
    ['ştefan', 'Ștefan'],
    ['ștefan', 'Ştefan'],
    ['stefan', 'Ștefan'],
    ['stefan', 'Ştefan'],
    ['ştefan', 'Stefan'],
    ['Ștefan', 'ștefan'],
    ['Ştefan', 'ştefan'],
    ['ȘTEFAN', 'stefan'],
  ])('finds the query %s in the stored name %s', async (q, stored) => {
    await person(stored);
    await person('Zzz Other');

    expect(await names({ q })).toEqual([stored]);
  });

  // @traces 002-FR-003
  it('folds t with comma and cedilla, and a, a-circumflex, i-circumflex', async () => {
    await person('Țăranu Âlin Îon');
    await person('Ţaranu');

    expect(await names({ q: 'taranu' })).toEqual(['Țăranu Âlin Îon', 'Ţaranu']);
    expect(await names({ q: 'alin ion' })).toEqual(['Țăranu Âlin Îon']);
    expect(await names({ q: 'ÎON' })).toEqual(['Țăranu Âlin Îon']);
  });

  // @traces 002-FR-003
  it('matches a decomposed query against a precomposed name', async () => {
    await person('Ștefan Pop');

    expect(await names({ q: 'S\u0326tefan' })).toEqual(['Ștefan Pop']);
  });

  // @traces 002-FR-003
  it('does not fold accents in an e-mail the way it folds names', async () => {
    await person('Mail', { email: 'stefan@example.test' });

    expect(await names({ q: 'ștefan@' })).toEqual([]);
    expect(await names({ q: 'STEFAN@EXAMPLE' })).toEqual(['Mail']);
  });
});

describe('query length', () => {
  // @traces 002-FR-002
  it('accepts 80 characters after collapsing and refuses 81', async () => {
    const eighty = 'a'.repeat(80);

    expect((await get(`/admin/accounts?q=${eighty}`)).status).toBe(200);
    const res = await get(`/admin/accounts?q=${eighty}a`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_query');
  });

  // @traces 002-FR-002
  it('counts the collapsed text, not the typed whitespace', async () => {
    const typed = `${'a'.repeat(40)}${' '.repeat(30)}${'b'.repeat(39)}`;

    expect(
      (await get(`/admin/accounts?q=${encodeURIComponent(typed)}`)).status,
    ).toBe(200);
    const padded = `   ${'a'.repeat(80)}   `;
    expect(
      (await get(`/admin/accounts?q=${encodeURIComponent(padded)}`)).status,
    ).toBe(200);
  });

  // @traces 002-FR-002
  it('counts characters, not UTF-16 units or bytes', async () => {
    const eighty = 'ș'.repeat(80);

    expect(
      (await get(`/admin/accounts?q=${encodeURIComponent(eighty)}`)).status,
    ).toBe(200);
    expect(
      (await get(`/admin/accounts?q=${encodeURIComponent(`${eighty}ș`)}`))
        .status,
    ).toBe(400);
  });

  // @traces 002-FR-002
  it('treats a blank or one-character query as no search with no total', async () => {
    await person('Ana');
    for (const q of ['', '%20%20%20', 'a', '%20a%20', '%09%0A']) {
      const res = await get(`/admin/accounts?q=${q}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect('total' in res.body).toBe(false);
    }
  });

  // @traces 002-FR-002
  it('searches a two-character query and carries a total', async () => {
    await person('Ab Cd');
    await person('Zzz');

    const res = await get('/admin/accounts?q=ab');

    expect(res.body.total).toBe(1);
  });

  // @traces 002-FR-002
  it('answers 400 to a query given twice', async () => {
    const res = await get('/admin/accounts?q=ab&q=cd');

    expect(res.status).toBe(400);
  });
});

describe('phone search', () => {
  const PHONE = '+40722123456';

  // @traces 002-FR-004
  it.each([
    '0722 123 456',
    '+40 722 123 456',
    '0040722123456',
    '0040 722 123 456',
    '(0722) 123-456',
    '0722.123.456',
    '+40722123456',
    '40722123456',
    '722123456',
  ])('finds a Romanian number typed as %s', async (q) => {
    await person('Cu telefon', { phone: PHONE });
    await person('Fara', { phone: '+40733999888' });

    expect(await names({ q })).toEqual(['Cu telefon']);
  });

  // @traces 002-FR-004
  it('finds a foreign number by its country code', async () => {
    await person('Britanic', { phone: '+447911123456' });
    await person('Roman', { phone: PHONE });

    expect(await names({ q: '+44 7911 123 456' })).toEqual(['Britanic']);
    expect(await names({ q: '0044 7911' })).toEqual(['Britanic']);
  });

  // @traces 002-FR-004
  it('finds by a four-digit part and not by a three-digit one', async () => {
    await person('Cu telefon', { phone: PHONE });

    expect(await names({ q: '0722' })).toEqual(['Cu telefon']);
    expect(await names({ q: '722' })).toEqual([]);
    expect(await names({ q: '07' })).toEqual([]);
  });

  // @traces 002-FR-004
  it('matches 15 digits as a phone and 16 digits only as text', async () => {
    await person('Cu telefon', { phone: '+123456789012345' });
    await person('Nume 1234567890123456 lung');

    expect(await names({ q: '123456789012345' })).toEqual(
      expect.arrayContaining(['Cu telefon', 'Nume 1234567890123456 lung']),
    );
    expect(await names({ q: '1234567890123456' })).toEqual([
      'Nume 1234567890123456 lung',
    ]);
  });

  // @traces 002-FR-004
  it('finds a name or e-mail holding the digits as text too', async () => {
    await person('Box 0722 Inc');
    await person('Mail', { email: 'u0722@example.test' });
    await person('Phone', { phone: PHONE });

    expect((await names({ q: '0722' })).sort()).toEqual(
      ['Box 0722 Inc', 'Mail', 'Phone'].sort(),
    );
  });

  // @traces 002-FR-004
  it('does not match an account with no phone', async () => {
    await person('Fara telefon');

    expect(await names({ q: '0722' })).toEqual([]);
  });

  // @traces 002-FR-004
  it('does not read letters mixed with digits as a phone', async () => {
    await person('Cu telefon', { phone: PHONE });

    expect(await names({ q: '0722abc' })).toEqual([]);
  });
});

describe('deleted accounts are never found', () => {
  // @traces 002-FR-001
  it('hides a deleted account by name, e-mail, phone, garage, role and status', async () => {
    const id = await person('Fantoma Unica', {
      email: 'fantoma@example.test',
      phone: '+40755000111',
      roles: ['mechanic'],
      status: 'deleted',
    });
    const { id: garageId } = await prisma.garage.create({
      data: { name: 'Atelier Spectral', slug: `garage-${randomUUID()}` },
    });
    await prisma.mechanic.create({
      data: { accountId: id, garageId, name: 'Fantoma' },
    });
    await person('Viu');

    for (const search of [
      { q: 'fantoma unica' },
      { q: 'fantoma@' },
      { q: '0755 000 111' },
      { q: 'atelier spectral' },
      { role: 'mechanic' },
      { role: 'mechanic', status: 'active' },
    ] as Search[]) {
      const page = await service.page(undefined, NOW, search);
      expect(page.items.map((i) => i.name)).toEqual([]);
      expect(page.total).toBe(0);
    }
    const all = await service.page(undefined, NOW, { status: 'active' });
    expect(all.items.map((i) => i.name)).toEqual(['Viu']);
  });
});

describe('totals and pages', () => {
  // @traces 002-FR-006
  it('carries the same total on every page and chains without repeats', async () => {
    for (let i = 0; i < 45; i += 1) await person(`Client ${i}`);
    await person('Altcineva');

    const seen: string[] = [];
    const totals: (number | undefined)[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.page(cursor, NOW, { q: 'client' });
      seen.push(...page.items.map((i) => i.id));
      totals.push(page.total);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(totals).toEqual([45, 45, 45]);
    expect(new Set(seen).size).toBe(45);
    expect(seen).toHaveLength(45);
  });

  // @traces 002-FR-006
  it('carries no total without a search or filter', async () => {
    await person('Ana');

    const page = await service.page(undefined, NOW, {});

    expect(page.total).toBeUndefined();
  });

  // @traces 002-FR-006
  it('carries a total of 0 and no cursor for no match', async () => {
    await person('Ana');

    const page = await service.page(undefined, NOW, { q: 'nimeni' });

    expect(page).toMatchObject({ items: [], nextCursor: null, total: 0 });
  });

  // @traces 002-FR-001
  it('applies a cursor from one search to another without leaking rows', async () => {
    for (let i = 0; i < 25; i += 1) await person(`Alfa ${i}`);
    for (let i = 0; i < 25; i += 1) await person(`Beta ${i}`);
    const first = await service.page(undefined, NOW, { q: 'alfa' });

    const second = await service.page(first.nextCursor ?? undefined, NOW, {
      q: 'beta',
    });

    expect(second.total).toBe(25);
    expect(second.items.every((i) => i.name.startsWith('Beta'))).toBe(true);
    expect(second.items.length).toBeGreaterThan(0);
  });

  // @traces 002-FR-001
  it('answers the same page twice for the same search', async () => {
    for (let i = 0; i < 5; i += 1) await person(`Client ${i}`);

    const a = await service.page(undefined, NOW, { q: 'client' });
    const b = await service.page(undefined, NOW, { q: 'client' });

    expect(b).toEqual(a);
  });
});

describe('role and status filters', () => {
  // @traces 002-FR-005
  it('lists an account with two matching roles once and counts it once', async () => {
    await person('Dublu', { roles: ['driver', 'garage'] });
    await person('Mecanic', { roles: ['mechanic'] });

    const page = await service.page(undefined, NOW, {
      role: ['driver', 'garage', 'driver'],
    });

    expect(page.items.map((i) => i.name)).toEqual(['Dublu']);
    expect(page.total).toBe(1);
  });

  // @traces 002-FR-005
  it('reads an empty role as no role filter and carries no total', async () => {
    await person('Ana');

    const res = await get('/admin/accounts?role=');

    expect(res.status).toBe(200);
    expect('total' in res.body).toBe(false);
    expect(res.body.items).toHaveLength(2);
  });

  // @traces 002-FR-005
  it('reads repeated, comma-separated and empty parts of role together', async () => {
    await person('Sofer', { roles: ['driver'] });
    await person('Mecanic', { roles: ['mechanic'] });

    const res = await get('/admin/accounts?role=driver,&role=&role=driver');

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Sofer',
    ]);
    expect(res.body.total).toBe(1);
  });

  // @traces 002-FR-002
  it('answers 400 invalid_filter to an unknown role, even beside a valid one', async () => {
    for (const q of ['role=owner', 'role=driver,owner', 'role=Driver']) {
      const res = await get(`/admin/accounts?${q}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_filter');
    }
  });

  // @traces 002-FR-002
  it('answers 400 invalid_filter to a bad or repeated status', async () => {
    for (const q of [
      'status=deleted',
      'status=',
      'status=Active',
      'status=active&status=active',
      'status=active,suspended',
    ]) {
      const res = await get(`/admin/accounts?${q}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_filter');
    }
  });

  // @traces 002-FR-005
  it('answers an empty page with total 0 for the watch state', async () => {
    await person('Ana');

    const res = await get('/admin/accounts?status=watch');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });

  // @traces 002-FR-005
  it('splits suspended from active and intersects with the search', async () => {
    await person('Ana Activa');
    await person('Ana Suspendata', { status: 'suspended' });
    await person('Bob Suspendat', { status: 'suspended' });

    expect(await names({ q: 'ana', status: 'suspended' })).toEqual([
      'Ana Suspendata',
    ]);
    expect(await names({ q: 'ana', status: 'active' })).toEqual(['Ana Activa']);
  });
});

describe('garage names', () => {
  // @traces 002-FR-003
  it('finds the row once when two of its garages match the query', async () => {
    const one = await prisma.garage.create({
      data: { name: 'Service Nord', slug: `garage-${randomUUID()}` },
    });
    const two = await prisma.garage.create({
      data: { name: 'Service Sud', slug: `garage-${randomUUID()}` },
    });
    const id = await person('Mihai', { roles: ['garage', 'receptionist'] });
    await prisma.garageMember.createMany({
      data: [
        { accountId: id, garageId: one.id, role: 'owner' },
        { accountId: id, garageId: two.id, role: 'receptionist' },
      ],
    });

    const page = await service.page(undefined, NOW, { q: 'service' });

    expect(page.items.map((i) => i.name)).toEqual(['Mihai']);
    expect(page.total).toBe(1);
  });
});
