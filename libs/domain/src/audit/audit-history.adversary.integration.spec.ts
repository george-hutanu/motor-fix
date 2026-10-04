import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuditService } from './audit.service';
import { signAccessToken } from '../auth/access-token';
import { AccountsService } from '../auth/accounts.service';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import { noEvents } from '../events/event.port';
import { Prisma } from '../generated/prisma/client';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const tokenSecret = 'test-secret';
const prisma = createPrisma(databaseUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

const MASK = '•••';
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule.register({ databaseUrl, tokenSecret })],
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
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
});

async function account(name: string, roles: Role[]) {
  const { id } = await accounts.createAccount({
    identity: { method: 'google', subject: `${name}-${randomUUID()}` },
    name,
    roles,
  });
  return id;
}

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const get = (query: string | Record<string, string> = {}, auth?: string) => {
  const call = request(app.getHttpServer()).get(
    typeof query === 'string' ? `/audit-history?${query}` : '/audit-history',
  );
  if (typeof query !== 'string') call.query(query);
  return auth ? call.set('Authorization', auth) : call;
};

async function garage(name = 'Garage') {
  return prisma.garage.create({
    data: { name, slug: `${name}-${randomUUID()}` },
  });
}

async function owner(garageId: string) {
  const id = await account('Owner', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: id, garageId, role: 'owner' },
  });
  return { auth: bearer(id, 'garage'), id };
}

async function admin() {
  const id = await account('Admin', ['admin']);
  return { auth: bearer(id, 'admin'), id };
}

type Entry = Partial<Prisma.ActivityLogUncheckedCreateInput>;

const entry = (data: Entry = {}) =>
  prisma.activityLog.create({
    data: {
      action: 'update',
      actorName: 'Ion',
      actorRole: 'owner',
      field: 'note',
      newValue: 'nou',
      oldValue: 'vechi',
      subjectId: randomUUID(),
      subjectType: 'quote',
      ...data,
    },
  });

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
const ids = (res: { body: { items: { id: string }[] } }) =>
  res.body.items.map((i) => i.id);

describe('scope across garages', () => {
  it.each([
    [
      'the own id and another id',
      (own: string, other: string) => `garageId=${own}&garageId=${other}`,
    ],
    [
      'another id and the own id',
      (own: string, other: string) => `garageId=${other}&garageId=${own}`,
    ],
    ['the own id twice', (own: string) => `garageId=${own}&garageId=${own}`],
    ['an array style name', (own: string) => `garageId[]=${own}`],
  ])('answers 400 to staff naming the garage as %s', async (_, build) => {
    const mine = await garage();
    const theirs = await garage();
    await entry({ garageId: theirs.id });
    const ion = await owner(mine.id);

    const res = await get(build(mine.id, theirs.id), ion.auth);

    expect(res.status).toBe(400);
    expect(res.body.items).toBeUndefined();
  });

  it('answers 404 to another garage named in capitals', async () => {
    const mine = await garage();
    const theirs = await garage();
    await entry({ garageId: theirs.id });
    const ion = await owner(mine.id);

    const res = await get({ garageId: theirs.id.toUpperCase() }, ion.auth);

    expect(res.status).toBe(404);
  });

  it('lets staff name their own garage in capitals', async () => {
    const mine = await garage();
    const own = await entry({ garageId: mine.id });
    const ion = await owner(mine.id);

    const res = await get({ garageId: mine.id.toUpperCase() }, ion.auth);

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([own.id]);
  });

  it('accepts a cursor written in capitals for an entry in scope', async () => {
    const mine = await garage();
    const newer = await entry({ at: minutesAgo(1), garageId: mine.id });
    const older = await entry({ at: minutesAgo(2), garageId: mine.id });
    const ion = await owner(mine.id);

    const res = await get({ cursor: newer.id.toUpperCase() }, ion.auth);

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([older.id]);
  });

  it('gives staff nothing of another garage through the person filter', async () => {
    const mine = await garage();
    const theirs = await garage();
    const stranger = randomUUID();
    await entry({ actorId: stranger, garageId: theirs.id });
    await entry({ actorId: stranger, garageId: null });
    const ion = await owner(mine.id);

    const res = await get({ actorId: stranger }, ion.auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('gives staff nothing of another garage through the job filter', async () => {
    const mine = await garage();
    const theirs = await garage();
    const job = randomUUID();
    await entry({ garageId: theirs.id, jobId: job });
    const ion = await owner(mine.id);

    const res = await get({ jobId: job }, ion.auth);

    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('keeps admin actions of other garages and the platform away from staff', async () => {
    const mine = await garage();
    const theirs = await garage();
    const own = await entry({ actorRole: 'admin', garageId: mine.id });
    await entry({ actorRole: 'admin', garageId: theirs.id });
    await entry({ actorRole: 'admin', garageId: null });
    const ion = await owner(mine.id);

    const res = await get({ area: 'admin_actions' }, ion.auth);

    expect(ids(res)).toEqual([own.id]);
    expect(res.body.total).toBe(1);
  });

  it('keeps a cursor from another garage refused whatever the filters', async () => {
    const mine = await garage();
    const theirs = await garage();
    const foreign = await entry({ garageId: theirs.id });
    const platform = await entry({ garageId: null });
    const ion = await owner(mine.id);

    for (const cursor of [foreign.id, platform.id, randomUUID()]) {
      const res = await get(
        { area: 'quotes', cursor, garageId: mine.id },
        ion.auth,
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    }
  });

  it('answers 404 to an owner without a garage whatever they pass', async () => {
    const theirs = await garage();
    await entry({ garageId: theirs.id });
    await entry({ garageId: null });
    const lone = await account('Lone', ['garage']);

    for (const query of [
      {} as Record<string, string>,
      { garageId: theirs.id },
      { actorId: randomUUID() },
    ]) {
      expect((await get(query, bearer(lone, 'garage'))).status).toBe(404);
    }
  });

  it('answers the same page twice to the same call', async () => {
    const mine = await garage();
    for (let i = 1; i <= 3; i++) {
      await entry({ at: minutesAgo(i), garageId: mine.id });
    }
    const ion = await owner(mine.id);
    const query = { from: minutesAgo(60).toISOString() };

    const first = await get(query, ion.auth);
    const second = await get(query, ion.auth);

    expect(second.body).toEqual(first.body);
  });
});

describe('roles', () => {
  it('reads as the role in use for an account holding garage and driver', async () => {
    const mine = await garage();
    await entry({ garageId: mine.id });
    const ion = await owner(mine.id);
    await prisma.accountRole.create({
      data: { accountId: ion.id, role: 'driver' },
    });

    expect((await get({}, bearer(ion.id, 'garage'))).body.total).toBe(1);
    expect((await get({}, bearer(ion.id, 'driver'))).status).toBe(404);
  });

  it('keeps an account holding admin and garage to its garage when it reads as the garage', async () => {
    const mine = await garage();
    const theirs = await garage();
    const own = await entry({ garageId: mine.id });
    await entry({ garageId: theirs.id });
    await entry({ garageId: null });
    const ion = await owner(mine.id);
    await prisma.accountRole.create({
      data: { accountId: ion.id, role: 'admin' },
    });

    const res = await get({}, bearer(ion.id, 'garage'));

    expect(ids(res)).toEqual([own.id]);
    expect(res.body.total).toBe(1);
  });

  it('does not make a driver an admin by naming admin in the token', async () => {
    const theirs = await garage();
    await entry({ garageId: theirs.id });
    const driver = await account('Driver', ['driver']);

    const res = await get({}, bearer(driver, 'admin'));

    expect(res.status).toBe(404);
    expect(res.body.items).toBeUndefined();
  });

  it('does not widen an owner to every garage by naming admin in the token', async () => {
    const mine = await garage();
    const theirs = await garage();
    const own = await entry({ garageId: mine.id });
    await entry({ garageId: theirs.id });
    const ion = await owner(mine.id);

    const res = await get({}, bearer(ion.id, 'admin'));

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([own.id]);
  });

  it('answers 401 to a token signed with another secret', async () => {
    const mine = await garage();
    const ion = await owner(mine.id);
    const forged = `Bearer ${signAccessToken({ accountId: ion.id, role: 'admin' }, 'other-secret')}`;

    const res = await get({}, forged);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 401 to a token for an account that does not exist', async () => {
    const res = await get({}, bearer(randomUUID(), 'admin'));

    expect(res.status).toBe(401);
  });
});

describe('masking', () => {
  async function seeded(data: Entry) {
    const mine = await garage();
    const row = await entry({ garageId: mine.id, ...data });
    const ion = await owner(mine.id);
    const staff = await get({}, ion.auth);
    const boss = await admin();
    const full = await get({ garageId: mine.id }, boss.auth);
    return { full: full.body.items[0], row, staff: staff.body.items[0] };
  }

  it('masks a phone key written in capitals inside an object', async () => {
    const { staff } = await seeded({
      field: null,
      newValue: { name: 'Ana', PHONE: '0722', Plate: 'B 1' },
      oldValue: undefined,
    });

    expect(staff.newValue).toEqual({ name: 'Ana', PHONE: MASK, Plate: MASK });
  });

  it('masks keys inside arrays nested in arrays and objects', async () => {
    const { staff } = await seeded({
      field: 'contacts',
      newValue: {
        groups: [[{ phone: '1' }, [{ deep: { plate: 'B 2' } }]], 'x'],
      },
      oldValue: [[[{ phone: '2' }]]],
    });

    expect(staff.newValue).toEqual({
      groups: [[{ phone: MASK }, [{ deep: { plate: MASK } }]], 'x'],
    });
    expect(staff.oldValue).toEqual([[[{ phone: MASK }]]]);
  });

  it('masks a whole object stored under a field named phone', async () => {
    const { staff } = await seeded({
      field: 'phone',
      newValue: { number: '0722', prefix: '+40' },
      oldValue: ['0711'],
    });

    expect(staff.newValue).toBe(MASK);
    expect(staff.oldValue).toBe(MASK);
  });

  it('masks a field named in capitals', async () => {
    const { staff } = await seeded({
      field: 'PHONE',
      newValue: '0722',
      oldValue: '0711',
    });

    expect(staff.newValue).toBe(MASK);
    expect(staff.oldValue).toBe(MASK);
  });

  it.each([
    ['zero', 0],
    ['an empty string', ''],
    ['false', false],
    ['an empty list', []],
    ['an empty object', {}],
  ])('masks %s under a plate field because it is not null', async (_, value) => {
    const { staff } = await seeded({
      field: 'plate',
      newValue: value as Prisma.InputJsonValue,
      oldValue: undefined,
    });

    expect(staff.newValue).toBe(MASK);
  });

  it('leaves null under a phone field as null', async () => {
    const { staff } = await seeded({
      field: 'phone',
      newValue: Prisma.JsonNull,
      oldValue: undefined,
    });

    expect(staff.newValue).toBeNull();
    expect(staff.oldValue).toBeNull();
  });

  it('leaves similar names and the text alone', async () => {
    const value = {
      phoneNumber: '0722',
      phones: ['0733'],
      plates: 'B 1',
      telephone: '0744',
    };
    const { staff } = await seeded({
      field: 'phone_number',
      kind: 'phone',
      newValue: value,
      oldValue: undefined,
      text: 'Phone 0722 for plate B 1',
    });

    expect(staff.newValue).toEqual(value);
    expect(staff.text).toBe('Phone 0722 for plate B 1');
    expect(staff.kind).toBe('phone');
  });

  it('gives the admin the stored values after staff have read them', async () => {
    const value = { list: [{ phone: '0722' }], plate: 'B 1' };
    const { full, row } = await seeded({
      field: null,
      newValue: value,
      oldValue: undefined,
    });

    expect(full.id).toBe(row.id);
    expect(full.newValue).toEqual(value);
  });

  it('masks a sensitive field also when an area filter selects it', async () => {
    const mine = await garage();
    await entry({
      field: 'phone',
      garageId: mine.id,
      newValue: '0722',
      oldValue: '0711',
    });
    const ion = await owner(mine.id);

    const res = await get({ area: 'quotes' }, ion.auth);

    expect(
      res.body.items.map((i: { newValue: unknown }) => i.newValue),
    ).toEqual([MASK]);
  });
});

describe('paging', () => {
  async function many(count: number) {
    const mine = await garage();
    const base = Date.now() - 10 * 60_000;
    const rows = [];
    for (let i = 0; i < count; i++) {
      rows.push(
        await entry({
          at: new Date(base - Math.floor(i / 3) * 1000),
          garageId: mine.id,
        }),
      );
    }
    const ion = await owner(mine.id);
    return { from: new Date(base - 3_600_000).toISOString(), ion, rows };
  }

  interface Page {
    items: { id: string; at: string }[];
    nextCursor: string | null;
    total: number;
  }

  async function walk(from: string, auth: string) {
    const pages: Page[] = [];
    let cursor: string | null = null;
    do {
      const query: Record<string, string> = { from };
      if (cursor) query['cursor'] = cursor;
      const res = await get(query, auth);
      expect(res.status).toBe(200);
      pages.push(res.body);
      cursor = res.body.nextCursor;
    } while (cursor && pages.length < 10);
    return pages;
  }

  it('visits 45 entries with triplicate times once each, in order, with a stable total', async () => {
    const { from, ion, rows } = await many(45);
    const expected = [...rows]
      .sort((a, b) => +b.at - +a.at || (a.id < b.id ? 1 : -1))
      .map((r) => r.id);

    const pages = await walk(from, ion.auth);

    expect(pages.map((p) => p.items.length)).toEqual([20, 20, 5]);
    expect(pages.map((p) => p.total)).toEqual([45, 45, 45]);
    expect(pages.map((p) => p.nextCursor === null)).toEqual([
      false,
      false,
      true,
    ]);
    expect(pages.flatMap((p) => p.items.map((i) => i.id))).toEqual(expected);
  });

  it('ends after exactly two full pages with no third', async () => {
    const { from, ion } = await many(40);

    const pages = await walk(from, ion.auth);

    expect(pages.map((p) => p.items.length)).toEqual([20, 20]);
    expect(pages[1]?.nextCursor).toBeNull();
  });

  it('gives a single entry and no cursor', async () => {
    const { from, ion, rows } = await many(1);

    const pages = await walk(from, ion.auth);

    expect(pages).toEqual([
      {
        items: [expect.objectContaining({ id: rows[0]?.id })],
        nextCursor: null,
        total: 1,
      },
    ]);
  });

  it('gives the cursor of the 20th entry on a full first page', async () => {
    const { from, ion } = await many(21);

    const res = await get({ from }, ion.auth);

    expect(res.body.nextCursor).toBe(res.body.items[19].id);
  });

  it('continues after the last entry with an empty page and the same total', async () => {
    const { from, ion, rows } = await many(2);
    const oldest = [...rows].sort(
      (a, b) => +a.at - +b.at || (a.id < b.id ? -1 : 1),
    )[0];

    const res = await get({ cursor: oldest?.id ?? '', from }, ion.auth);

    expect(res.body).toEqual({ items: [], nextCursor: null, total: 2 });
  });
});

describe('dates', () => {
  const at = new Date(Date.now() - 24 * 3_600_000);

  async function one() {
    const mine = await garage();
    const row = await entry({ at, garageId: mine.id });
    return { ion: await owner(mine.id), row };
  }

  const shift = (ms: number) => new Date(+at + ms).toISOString();

  it('includes an entry at exactly the start and the end', async () => {
    const { ion, row } = await one();

    const res = await get(
      { from: at.toISOString(), to: at.toISOString() },
      ion.auth,
    );

    expect(ids(res)).toEqual([row.id]);
  });

  it('excludes an entry one millisecond before the start', async () => {
    const { ion } = await one();

    const res = await get({ from: shift(1) }, ion.auth);

    expect(res.body.total).toBe(0);
  });

  it('excludes an entry one millisecond after the end', async () => {
    const { ion } = await one();

    const res = await get({ from: shift(-1000), to: shift(-1) }, ion.auth);

    expect(res.body.total).toBe(0);
  });

  it('reads an offset as the same instant in UTC', async () => {
    const { ion, row } = await one();
    const plus = new Date(+at + 5.5 * 3_600_000)
      .toISOString()
      .replace('Z', '+05:30');

    const res = await get({ from: plus, to: plus }, ion.auth);

    expect(ids(res)).toEqual([row.id]);
  });

  it('accepts a start equal to the end', async () => {
    const { ion } = await one();

    const res = await get({ from: shift(5), to: shift(5) }, ion.auth);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('answers an empty page for an end older than the default start', async () => {
    const { ion } = await one();
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const res = await get({ to: old }, ion.auth);

    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('leaves out an entry older than 7 days when no start is given', async () => {
    const mine = await garage();
    await entry({
      at: new Date(Date.now() - 8 * 86_400_000),
      garageId: mine.id,
    });
    const recent = await entry({ at: minutesAgo(5), garageId: mine.id });
    const ion = await owner(mine.id);

    const res = await get({}, ion.auth);

    expect(ids(res)).toEqual([recent.id]);
  });

  it('answers 200 with an empty page for a start in the far future', async () => {
    const { ion } = await one();

    const res = await get({ from: '9999-12-31T23:59:59Z' }, ion.auth);

    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });
});

describe('invalid input', () => {
  it.each([
    ['an empty start', 'from='],
    ['an empty end', 'to='],
    ['an empty garage', 'garageId='],
    ['an empty person', 'actorId='],
    ['an empty job', 'jobId='],
    ['an empty area', 'area='],
    ['an empty cursor', 'cursor='],
    ['an area in capitals', 'area=JOBS'],
    ['an area twice', 'area=jobs&area=quotes'],
    ['an area as a list', 'area[]=jobs'],
    ['a start as an object', 'from[a]=b'],
    ['a start twice', 'from=2026-01-01T00:00:00Z&from=2026-01-02T00:00:00Z'],
    ['a cursor twice', `cursor=${randomUUID()}&cursor=${randomUUID()}`],
    ['a lowercase zone letter', 'from=2026-01-01T00:00:00z'],
    ['a space instead of T', 'from=2026-01-01%2000:00:00Z'],
    ['an impossible day', 'from=2026-02-30T10:00:00Z'],
    ['an impossible hour', 'from=2026-01-01T25:00:00Z'],
    ['an impossible offset', 'from=2026-01-01T10:00:00%2B99:99'],
    ['an offset without a colon', 'from=2026-01-01T10:00:00%2B0200'],
    ['a year with a sign', 'from=%2B002026-01-01T10:00:00Z'],
    ['a null byte in the cursor', 'cursor=%00'],
    ['an injection in the garage', 'garageId=%27%20OR%201%3D1--'],
    ['a cursor of 36 characters that is no id', `cursor=${'z'.repeat(36)}`],
    ['an unknown name in capitals', 'Area=jobs'],
    ['a very long start', `from=${'1'.repeat(5000)}`],
  ])('answers 400 to %s', async (_, query) => {
    const mine = await garage();
    const ion = await owner(mine.id);

    const res = await get(query, ion.auth);

    expect(res.status).toBe(400);
  });

  it('answers 400 validation_failed to a start after the end', async () => {
    const mine = await garage();
    const ion = await owner(mine.id);

    const res = await get(
      { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
      ion.auth,
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('names the unknown parameter in the 400 answer', async () => {
    const mine = await garage();
    const ion = await owner(mine.id);

    const res = await get({ garageId: mine.id, limit: '5' }, ion.auth);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain('limit');
  });

  it('answers 400 invalid_cursor to the admin for an entry that does not exist', async () => {
    const boss = await admin();

    const res = await get({ cursor: randomUUID() }, boss.auth);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('never gives a driver data, whatever the parameters', async () => {
    const driver = await account('Driver', ['driver']);

    const res = await get({ area: 'reviews' }, bearer(driver, 'driver'));

    expect(res.status).toBe(400);
    expect(res.body.items).toBeUndefined();
  });

  it('refuses a start after the end for the admin too', async () => {
    const boss = await admin();

    const res = await get(
      { from: '2026-02-01T00:00:00+02:00', to: '2026-01-31T21:59:59Z' },
      boss.auth,
    );

    expect(res.status).toBe(400);
  });
});

describe('entries', () => {
  it('shows an entry whose actor account is gone with the name it was written with', async () => {
    const mine = await garage();
    const gone = randomUUID();
    await entry({
      actorId: gone,
      actorName: 'Maria',
      actorRole: 'receptionist',
      garageId: mine.id,
    });
    const ion = await owner(mine.id);

    const res = await get({}, ion.auth);

    expect(res.body.items[0].actor).toEqual({
      id: gone,
      name: 'Maria',
      role: 'receptionist',
    });
  });

  it('shows a system entry without an actor id', async () => {
    const mine = await garage();
    await entry({
      actorId: null,
      actorName: 'MotorFix',
      actorRole: 'system',
      garageId: mine.id,
    });
    const ion = await owner(mine.id);

    const res = await get({}, ion.auth);

    expect(res.body.items[0].actor).toEqual({
      id: null,
      name: 'MotorFix',
      role: 'system',
    });
  });

  it('returns unicode names and text as stored', async () => {
    const mine = await garage();
    await entry({
      actorName: 'Ștefan Țurcanu 🚗',
      garageId: mine.id,
      text: 'Schimb ulei – „Dacia” 日本語',
    });
    const ion = await owner(mine.id);

    const res = await get({}, ion.auth);

    expect(res.body.items[0]).toMatchObject({
      actor: { name: 'Ștefan Țurcanu 🚗' },
      text: 'Schimb ulei – „Dacia” 日本語',
    });
  });

  it('writes no entry when it is read, also by the admin', async () => {
    const mine = await garage();
    await entry({ garageId: mine.id });
    const ion = await owner(mine.id);
    const boss = await admin();
    const count = () =>
      prisma.activityLog.count({ where: { garageId: mine.id } });
    const before = await count();

    await get({}, ion.auth);
    await get({ garageId: mine.id }, boss.auth);

    expect(await count()).toBe(before);
  });
});
