import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);

const ids = (res: { body: { items: { id: string }[] } }) =>
  res.body.items.map((i) => i.id);

const moved = (
  subjectType: 'request_recipient' | 'quote_request',
  subjectId: string,
  at: Date,
  to: string,
) =>
  prisma.activityLog.create({
    data: {
      action: 'update',
      actorName: 'Sistem',
      actorRole: 'system',
      at,
      field: 'status',
      newValue: to,
      subjectId,
      subjectType,
    },
  });

async function setting() {
  const andrei = await world.account('Andrei Marin');
  const dinamo = await team('Atelier Dinamo');
  return { andrei, auth: bearer(dinamo.owner, 'garage'), dinamo };
}

// @traces 343-FR-002
describe('GET /garage/requests?status= query handling', () => {
  it.each([
    ['a repeated status', 'status=waiting&status=closed'],
    ['a bracketed status', 'status[]=waiting'],
    ['a padded status', 'status=%20waiting'],
    ['a status with a trailing newline', 'status=waiting%0A'],
    ['a null-byte status', 'status=waiting%00'],
    ['a status object', 'status[a]=waiting'],
    ['a status in another script', 'status=wa%D1%96ting'],
  ])('answers 400 naming status to %s, never a 500', async (_, query) => {
    const s = await setting();

    const res = await get(`/garage/requests?${query}`, s.auth);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/status/);
  });

  it.each([
    ['a cursor that is not an id', 'not-a-uuid'],
    ['an empty cursor', ''],
  ])(
    'answers 400 naming the cursor to %s, with either status',
    async (_name, cursor) => {
      const s = await setting();
      for (const status of ['waiting', 'closed']) {
        const res = await get(
          `/garage/requests?status=${status}&cursor=${cursor}`,
          s.auth,
        );
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toMatch(/cursor/);
      }
    },
  );
});

// @traces 343-FR-001
// @traces 343-FR-002
describe('GET /garage/requests?status=waiting selection', () => {
  it('holds back a waiting recipient on a request that is booked, closed, in work or done', async () => {
    const s = await setting();
    for (const status of ['booked', 'in_work', 'done', 'closed'] as const) {
      const r = await world.request(s.andrei, { status });
      await world.recipient(r.id, s.dinamo.garage.id);
    }
    const open = await world.request(s.andrei, { status: 'sent' });
    await world.recipient(open.id, s.dinamo.garage.id);
    const quoted = await world.request(s.andrei, { status: 'quoted' });
    await world.recipient(quoted.id, s.dinamo.garage.id);

    const res = await get('/garage/requests?status=waiting', s.auth);

    expect(ids(res).sort()).toEqual([open.id, quoted.id].sort());
    expect(res.body.total).toBe(2);
  });

  it('pages 45 requests created in the same instant without a repeat or a gap', async () => {
    const s = await setting();
    const createdAt = ago(HOUR);
    const made: string[] = [];
    for (let i = 0; i < 45; i++) {
      const r = await world.request(s.andrei, { createdAt });
      await world.recipient(r.id, s.dinamo.garage.id);
      made.push(r.id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(
        `/garage/requests?status=waiting${cursor ? `&cursor=${cursor}` : ''}`,
        s.auth,
      );
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(45);
      seen.push(...ids(res));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 5);

    expect(pages).toBe(3);
    expect(seen).toEqual([...made].sort().reverse());
  });

  it('gives the same answer to the same read twice', async () => {
    const s = await setting();
    const r = await world.request(s.andrei);
    await world.recipient(r.id, s.dinamo.garage.id);

    const first = await get('/garage/requests?status=waiting', s.auth);
    const second = await get('/garage/requests?status=waiting', s.auth);

    expect(second.body).toEqual(first.body);
  });

  it('never lists a request in both lists', async () => {
    const s = await setting();
    const open = await world.request(s.andrei);
    await world.recipient(open.id, s.dinamo.garage.id);
    const booked = await world.request(s.andrei, { status: 'booked' });
    await world.recipient(booked.id, s.dinamo.garage.id);
    await moved('quote_request', booked.id, ago(HOUR), 'booked');

    const waiting = ids(await get('/garage/requests?status=waiting', s.auth));
    const closed = ids(await get('/garage/requests?status=closed', s.auth));

    expect(waiting).toEqual([open.id]);
    expect(closed).toEqual([booked.id]);
  });
});

// @traces 343-FR-002
describe('GET /garage/requests?status=closed ordering and window', () => {
  it('orders closed rows by the request creation time, newest first, as the waiting list does', async () => {
    const s = await setting();
    const newerCreated = await world.request(s.andrei, {
      createdAt: ago(2 * HOUR),
    });
    const newerTo = await world.recipient(
      newerCreated.id,
      s.dinamo.garage.id,
      'expired',
    );
    await moved('request_recipient', newerTo.id, ago(5 * HOUR), 'expired');
    const olderCreated = await world.request(s.andrei, {
      createdAt: ago(10 * HOUR),
    });
    const olderTo = await world.recipient(
      olderCreated.id,
      s.dinamo.garage.id,
      'expired',
    );
    await moved('request_recipient', olderTo.id, ago(1 * HOUR), 'expired');

    const res = await get('/garage/requests?status=closed', s.auth);

    expect(ids(res)).toEqual([newerCreated.id, olderCreated.id]);
  });

  it('keeps a row closed 23 hours 59 minutes ago and drops one closed 24 hours 1 minute ago', async () => {
    const s = await setting();
    const inside = await world.request(s.andrei);
    const insideTo = await world.recipient(
      inside.id,
      s.dinamo.garage.id,
      'expired',
    );
    await moved(
      'request_recipient',
      insideTo.id,
      ago(24 * HOUR - 60_000),
      'expired',
    );
    const outside = await world.request(s.andrei);
    const outsideTo = await world.recipient(
      outside.id,
      s.dinamo.garage.id,
      'expired',
    );
    await moved(
      'request_recipient',
      outsideTo.id,
      ago(24 * HOUR + 60_000),
      'expired',
    );

    const res = await get('/garage/requests?status=closed', s.auth);

    expect(ids(res)).toEqual([inside.id]);
    expect(res.body.total).toBe(1);
  });

  it('keeps a row with no audit entry whose recipient was created just now', async () => {
    const s = await setting();
    const r = await world.request(s.andrei);
    await world.recipient(r.id, s.dinamo.garage.id, 'expired');

    const res = await get('/garage/requests?status=closed', s.auth);

    expect(ids(res)).toEqual([r.id]);
    expect(res.body.items[0].closedReason).toBe('expired');
    expect(typeof res.body.items[0].closedAt).toBe('string');
  });

  it('answers the first 20 of 25 closed rows with the full total and a cursor-less page', async () => {
    const s = await setting();
    for (let i = 0; i < 25; i++) {
      const r = await world.request(s.andrei);
      await world.recipient(r.id, s.dinamo.garage.id, 'expired');
    }

    const res = await get('/garage/requests?status=closed', s.auth);

    expect(res.body.items).toHaveLength(20);
    expect(res.body.total).toBe(25);
  });

  it('shows no closed row to a garage that was never a recipient', async () => {
    const s = await setting();
    const other = await team('Service Militari');
    const r = await world.request(s.andrei);
    await world.recipient(r.id, other.garage.id, 'expired');

    const res = await get('/garage/requests?status=closed', s.auth);

    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });
});
