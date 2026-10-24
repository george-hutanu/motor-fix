import { randomUUID } from 'node:crypto';

import { auditHistoryApp } from './audit-history.testing';

const { account, bearer, get, prisma } = auditHistoryApp();

const OLD = new Date('2026-01-05T10:00:00Z');
const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };

const entry = (
  subjectId: string,
  actorId: string | null,
  data: { at?: Date; garageId?: string } = {},
) =>
  prisma.activityLog.create({
    data: {
      action: 'update',
      actorId,
      actorName: 'Ana',
      actorRole: 'admin',
      at: data.at ?? OLD,
      field: 'status',
      garageId: data.garageId,
      kind: 'account_suspended',
      newValue: 'suspended',
      oldValue: 'active',
      subjectId,
      subjectType: 'account',
    },
  });

async function admin() {
  const id = await account('Ana', ['admin']);
  return { auth: bearer(id, 'admin'), id };
}

// @traces 003-FR-004
describe('GET /audit-history for one account, under attack', () => {
  it.each([
    ['a word', 'andrei'],
    ['a uuid with a letter too many', `${randomUUID()}a`],
    ['an empty value', ''],
    ['a list of two', `${randomUUID()}&accountId=${randomUUID()}`],
  ])('answers 400 to accountId as %s', async (_, value) => {
    const { auth } = await admin();

    const res = await get(`accountId=${value}`, auth);

    expect(res.status).toBe(400);
  });

  it('answers an empty page for an account that has no history', async () => {
    const { auth } = await admin();

    const res = await get({ accountId: randomUUID(), ...WINDOW }, auth);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.nextCursor ?? null).toBeNull();
  });

  it('counts an entry the account made on itself once', async () => {
    const { auth } = await admin();
    const person = await account('Ion', ['driver']);
    const own = await entry(person, person);

    const res = await get({ accountId: person, ...WINDOW }, auth);

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([own.id]);
    expect(res.body.total).toBe(1);
  });

  it('reads an upper-case account id as the same account', async () => {
    const { auth } = await admin();
    const person = await account('Ion', ['driver']);
    const own = await entry(person, null);

    const res = await get({ accountId: person.toUpperCase(), ...WINDOW }, auth);

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([own.id]);
  });

  it('walks 120 entries by 50 once each with a stable total', async () => {
    const { auth } = await admin();
    const person = await account('Ion', ['driver']);
    for (let i = 0; i < 120; i += 1) {
      await entry(person, null, { at: new Date(OLD.getTime() + i * 1000) });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    const sizes: number[] = [];

    do {
      const res = await get(
        {
          accountId: person,
          ...WINDOW,
          limit: '50',
          ...(cursor && { cursor }),
        },
        auth,
      );
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(120);
      sizes.push(res.body.items.length);
      seen.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor ?? undefined;
    } while (cursor);

    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
  });

  it('gives exactly 1 entry for the limit 1 and 50 for the limit 50', async () => {
    const { auth } = await admin();
    const person = await account('Ion', ['driver']);
    for (let i = 0; i < 51; i += 1) await entry(person, null);

    const one = await get({ accountId: person, ...WINDOW, limit: '1' }, auth);
    const most = await get({ accountId: person, ...WINDOW, limit: '50' }, auth);

    expect(one.body.items).toHaveLength(1);
    expect(most.body.items).toHaveLength(50);
    expect(most.body.nextCursor).toBe(most.body.items[49].id);
  });

  it.each([
    ['empty', 'limit='],
    ['negative', 'limit=-1'],
    ['two values', 'limit=5&limit=6'],
  ])('answers 400 to a limit that is %s', async (_, query) => {
    const { auth } = await admin();

    const res = await get(query, auth);

    expect(res.status).toBe(400);
  });

  it('does not let a garage owner see an account through its own id', async () => {
    const owner = await account('Owner', ['garage']);
    const nord = await prisma.garage.create({
      data: { name: 'Nord', slug: `nord-${randomUUID()}` },
    });
    await prisma.garageMember.create({
      data: { accountId: owner, garageId: nord.id, role: 'owner' },
    });
    await entry(owner, owner, { garageId: nord.id });

    const res = await get(
      { accountId: owner, ...WINDOW },
      bearer(owner, 'garage'),
    );

    expect(res.status).toBe(400);
  });

  it('keeps the garage filter an AND with the account', async () => {
    const { auth } = await admin();
    const person = await account('Ion', ['driver']);
    const nord = await prisma.garage.create({
      data: { name: 'Nord', slug: `nord-${randomUUID()}` },
    });
    const south = await prisma.garage.create({
      data: { name: 'Sud', slug: `sud-${randomUUID()}` },
    });
    const inNord = await entry(person, null, { garageId: nord.id });
    await entry(person, null, { garageId: south.id });

    const res = await get(
      { accountId: person, garageId: nord.id, ...WINDOW },
      auth,
    );

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      inNord.id,
    ]);
    expect(res.body.total).toBe(1);
  });

  it('answers the same page twice for the same call', async () => {
    const { auth } = await admin();
    const person = await account('Ion', ['driver']);
    for (let i = 0; i < 5; i += 1) await entry(person, null);
    const query = { accountId: person, ...WINDOW, limit: '3' };

    const first = await get(query, auth);
    const second = await get(query, auth);

    expect(second.body).toEqual(first.body);
  });
});
