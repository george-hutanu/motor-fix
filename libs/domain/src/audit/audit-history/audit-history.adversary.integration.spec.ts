import { randomUUID } from 'node:crypto';

import { auditHistoryApp } from './audit-history.testing';
import { signAccessToken } from '../../auth/access-token';
import { Prisma } from '../../generated/prisma/client';

const { account, bearer, get, prisma } = auditHistoryApp();

const MASK = '•••';

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
  ])(
    'masks %s under a plate field because it is not null',
    async (_, value) => {
      const { staff } = await seeded({
        field: 'plate',
        newValue: value as Prisma.InputJsonValue,
        oldValue: undefined,
      });

      expect(staff.newValue).toBe(MASK);
    },
  );

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

    const res = await get({ garageId: mine.id, size: '5' }, ion.auth);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain('size');
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
});

describe('a cursor beyond the caller scope or filters', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  async function nordAndSud() {
    const nord = await garage('Nord');
    const sud = await garage('Sud');
    const ion = await owner(nord.id);
    return { ion, nord, sud };
  }

  // @traces 469-FR-004
  it.each([
    [
      'the area and the own garage',
      (n: string) => ({ area: 'quotes', garageId: n }),
    ],
    ['only the own garage', (n: string) => ({ garageId: n })],
    [
      'the own garage in capitals',
      (n: string) => ({ garageId: n.toUpperCase() }),
    ],
    ['the area alone', () => ({ area: 'quotes' })],
    [
      'a wide period',
      (n: string) => ({
        area: 'quotes',
        from: daysAgo(30).toISOString(),
        garageId: n,
      }),
    ],
  ])(
    'answers 400 invalid_cursor to staff for another garage entry with %s',
    async (_, build) => {
      const { ion, nord, sud } = await nordAndSud();
      const theirs = await entry({ at: minutesAgo(5), garageId: sud.id });

      const res = await get({ ...build(nord.id), cursor: theirs.id }, ion.auth);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
      expect(res.body.items).toBeUndefined();
    },
  );

  it('answers 400 invalid_cursor to staff for the capitals id of another garage entry', async () => {
    const { ion, nord, sud } = await nordAndSud();
    const theirs = await entry({ at: minutesAgo(5), garageId: sud.id });

    const res = await get(
      { area: 'quotes', cursor: theirs.id.toUpperCase(), garageId: nord.id },
      ion.auth,
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor to staff for a platform entry with the filters set', async () => {
    const { ion, nord } = await nordAndSud();
    const platform = await entry({ at: minutesAgo(5), garageId: null });

    const res = await get(
      { area: 'quotes', cursor: platform.id, garageId: nord.id },
      ion.auth,
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor to staff for an own entry older than the default window', async () => {
    const { ion, nord } = await nordAndSud();
    const old = await entry({ at: daysAgo(10), garageId: nord.id });

    const res = await get({ cursor: old.id }, ion.auth);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor to the admin for an entry older than the default window', async () => {
    const boss = await admin();
    const old = await entry({ at: daysAgo(10) });

    const res = await get({ cursor: old.id }, boss.auth);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor to the admin for a cursor of an entry of another garage than the one filtered', async () => {
    const boss = await admin();
    const nord = await garage('Nord');
    const sud = await garage('Sud');
    await entry({ garageId: nord.id });
    const theirs = await entry({ garageId: sud.id });

    const res = await get({ cursor: theirs.id, garageId: nord.id }, boss.auth);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor for an entry that matches the area but not the person', async () => {
    const { ion, nord } = await nordAndSud();
    const other = await entry({
      actorId: randomUUID(),
      at: minutesAgo(3),
      garageId: nord.id,
    });

    const res = await get(
      { actorId: randomUUID(), cursor: other.id },
      ion.auth,
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });
});

describe('the unfiltered admin read', () => {
  const total = async (auth: string) => (await get({}, auth)).body.total;

  // @traces 469-FR-005
  it('walks 45 entries of one instant across pages once each, newest id first', async () => {
    const boss = await admin();
    const mine = await garage();
    const at = new Date();
    const rows = [];
    for (let i = 0; i < 45; i++) {
      rows.push(await entry({ at, garageId: i % 2 ? mine.id : null }));
    }
    const expected = rows
      .map((r) => r.id)
      .sort()
      .reverse();

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const res: {
        body: { items: { id: string }[]; nextCursor: string | null };
        status: number;
      } = await get(cursor ? { cursor } : {}, boss.auth);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((i) => i.id));
      cursor = res.body.nextCursor;
      expect(cursor).not.toBeNull();
    }

    expect(seen.slice(0, 45)).toEqual(expected);
  });

  // @traces 469-FR-005
  it('counts an entry just inside seven days and not one just outside', async () => {
    const boss = await admin();
    const before = await total(boss.auth);
    await entry({ at: new Date(Date.now() - 7 * 86_400_000 + 3_600_000) });
    await entry({ at: new Date(Date.now() - 7 * 86_400_000 - 3_600_000) });

    expect(await total(boss.auth)).toBe(before + 1);
  });

  // @traces 469-FR-005
  it('gives the same total to the same call twice', async () => {
    const boss = await admin();
    await entry({ at: minutesAgo(1) });

    expect(await total(boss.auth)).toBe(await total(boss.auth));
  });
});

describe('the time index and the append-only rule', () => {
  const rolledBack = Symbol('rolledBack');

  // @traces 469-FR-001
  it('has one valid, non-unique, non-partial index on the time alone', async () => {
    const rows = await prisma.$queryRaw<
      {
        indisunique: boolean;
        indisvalid: boolean;
        indpred: string | null;
        cols: string;
      }[]
    >`
      SELECT i.indisunique, i.indisvalid, pg_get_expr(i.indpred, i.indrelid) AS indpred,
             (SELECT string_agg(a.attname, ',') FROM pg_attribute a
              WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) AS cols
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'activity_log_at_idx'`;

    expect(rows).toEqual([
      { cols: 'at', indisunique: false, indisvalid: true, indpred: null },
    ]);
  });

  // @traces 469-FR-001
  it('keeps the four scoped indexes beside the time index', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'activity_log' AND indexname <> 'activity_log_pkey'
      ORDER BY indexname`;

    const names = rows.map((r) => r.indexname);
    expect(names).toContain('activity_log_at_idx');
    expect(names.filter((n) => n !== 'activity_log_at_idx')).toHaveLength(4);
  });

  // @traces 469-FR-001
  it.each([
    ['an update', "UPDATE activity_log SET actor_name = 'x'"],
    ['a delete', 'DELETE FROM activity_log'],
    ['a truncate', 'TRUNCATE activity_log'],
  ])('still refuses %s of an entry', async (_, sql) => {
    const row = await entry({ at: minutesAgo(1) });
    const before = await prisma.activityLog.count();

    await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow(/append-only/);
    expect(await prisma.activityLog.count()).toBe(before);
    expect(
      (await prisma.activityLog.findUnique({ where: { id: row.id } }))
        ?.actorName,
    ).toBe('Ion');
  });

  // On a small table the planner may count through any index that holds
  // `at`; the million-row case in the service spec requires the time index.
  // @traces 469-FR-002
  it('can answer the window count from an index when a scan is not allowed', async () => {
    await entry({ at: minutesAgo(1) });
    let plan = '';

    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        const rows = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT count(*) FROM activity_log
          WHERE at >= now() - interval '7 days'`;
        plan = rows.map((r) => r['QUERY PLAN']).join('\n');
        throw rolledBack;
      })
      .catch((e: unknown) => {
        if (e !== rolledBack) throw e;
      });

    expect(plan).toMatch(/Index (Only )?Scan using activity_log_\w*idx/);
    expect(plan).not.toMatch(/Seq Scan on activity_log/);
  });

  // @traces 469-FR-002
  it('can answer the newest-first page through the time index when a scan is not allowed', async () => {
    await entry({ at: minutesAgo(1) });
    let plan = '';

    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        const rows = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT * FROM activity_log
          WHERE at >= now() - interval '7 days'
          ORDER BY at DESC, id DESC LIMIT 21`;
        plan = rows.map((r) => r['QUERY PLAN']).join('\n');
        throw rolledBack;
      })
      .catch((e: unknown) => {
        if (e !== rolledBack) throw e;
      });

    expect(plan).toMatch(/activity_log_at_idx/);
    expect(plan).not.toMatch(/Seq Scan on activity_log/);
  });
});
