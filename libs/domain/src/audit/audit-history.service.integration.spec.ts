import { randomUUID } from 'node:crypto';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuditHistoryService } from './audit-history.service';
import type { Role } from '../auth/capabilities';
import type { Actor } from '../auth/policy';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import type { Prisma } from '../generated/prisma/client';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const history = new AuditHistoryService(prisma);

const noPermissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const actor = (role: Role, garageId: string | null): Actor => ({
  accountId: randomUUID(),
  garageId,
  permissions: noPermissions,
  role,
  roles: [role],
});

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
const daysAgo = (n: number) => minutesAgo(n * 24 * 60);

type Entry = Partial<Prisma.ActivityLogUncheckedCreateInput>;

async function entry(data: Entry = {}) {
  return prisma.activityLog.create({
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
}

// Two garages with their own entries, and one platform entry without a garage,
// a minute or two before `now`.
async function twoGarages(now = new Date()) {
  const nord = randomUUID();
  const sud = randomUUID();
  const admin = randomUUID();
  const before = (minutes: number) => new Date(+now - minutes * 60_000);
  const inNord = await entry({ at: before(3), garageId: nord });
  const inNord2 = await entry({ at: before(2), garageId: nord });
  const inSud = await entry({ at: before(1), garageId: sud });
  const platform = await entry({
    actorId: admin,
    actorRole: 'admin',
    at: before(1),
    subjectType: 'platform_rule',
  });
  return { admin, inNord, inNord2, inSud, nord, platform, sud };
}

const ids = (page: { items: { id: string }[] }) => page.items.map((i) => i.id);

const rejects404 = (call: Promise<unknown>) =>
  expect(call).rejects.toBeInstanceOf(NotFoundException);

const rejects400 = async (call: Promise<unknown>, code: string) => {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  expect((error as BadRequestException).getResponse()).toMatchObject({
    code,
  });
};

describe('who reads which history', () => {
  it.each([
    'garage',
    'receptionist',
    'mechanic',
  ] as const)('the %s reads only their own garage', async (role) => {
    const g = await twoGarages();

    const page = await history.list(actor(role, g.nord), {});

    expect(ids(page)).toEqual([g.inNord2.id, g.inNord.id]);
    expect(page.total).toBe(2);
  });

  it('the mechanic reads it whatever their permissions', async () => {
    const g = await twoGarages();
    const elena = actor('mechanic', g.nord);
    elena.permissions = {
      canAnswerQuotes: true,
      canMoveBookings: true,
      canRecordFinalPrice: true,
    };

    expect(ids(await history.list(elena, {}))).toEqual([
      g.inNord2.id,
      g.inNord.id,
    ]);
  });

  it('a staff member may name their own garage', async () => {
    const g = await twoGarages();

    const page = await history.list(actor('garage', g.nord), {
      garageId: g.nord,
    });

    expect(page.total).toBe(2);
  });

  it.each([
    'garage',
    'receptionist',
    'mechanic',
  ] as const)('the %s asking for another garage gets 404', async (role) => {
    const g = await twoGarages();

    await rejects404(history.list(actor(role, g.nord), { garageId: g.sud }));
  });

  it('the admin reads every garage and entries without a garage', async () => {
    const g = await twoGarages();
    const admin = actor('admin', null);

    const nord = await history.list(admin, { garageId: g.nord });
    const sud = await history.list(admin, { garageId: g.sud });
    const platform = await history.list(admin, { actorId: g.admin });

    expect(ids(nord)).toEqual([g.inNord2.id, g.inNord.id]);
    expect(ids(sud)).toEqual([g.inSud.id]);
    expect(ids(platform)).toEqual([g.platform.id]);
  });

  // A moment no other test writes at, so the admin's unscoped page is known.
  const quietMoment = () =>
    new Date(Date.UTC(1990, 0, 1) + Math.floor(Math.random() * 1e12));

  const around = (at: Date) => ({
    from: new Date(+at - 10 * 60_000).toISOString(),
    to: at.toISOString(),
  });

  it('the admin without a garage filter gets every garage and the platform', async () => {
    const now = quietMoment();
    const g = await twoGarages(now);

    const page = await history.list(actor('admin', null), around(now));

    expect([...ids(page)].sort()).toEqual(
      [g.platform.id, g.inSud.id, g.inNord2.id, g.inNord.id].sort(),
    );
  });

  it('a staff member never gets an entry without a garage', async () => {
    const g = await twoGarages();

    const page = await history.list(actor('garage', g.nord), {
      actorId: g.admin,
    });

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('a driver gets 404', async () => {
    await rejects404(history.list(actor('driver', null), {}));
  });

  it.each([
    'garage',
    'receptionist',
    'mechanic',
  ] as const)('the %s with no garage gets 404', async (role) => {
    await rejects404(history.list(actor(role, null), {}));
  });

  it('the admin is not scoped by a garage they also belong to', async () => {
    const now = quietMoment();
    const g = await twoGarages(now);

    const page = await history.list(actor('admin', g.nord), around(now));

    expect(page.total).toBe(4);
  });
});

describe('each entry', () => {
  it('describes who changed what, when, from what to what', async () => {
    const garageId = randomUUID();
    const carId = randomUUID();
    const jobId = randomUUID();
    const actorId = randomUUID();
    const stored = await entry({
      actorId,
      actorName: 'Elena',
      actorRole: 'mechanic',
      carId,
      field: 'final_price_bani',
      garageId,
      jobId,
      kind: 'correction',
      newValue: 130000,
      oldValue: 120000,
      subjectType: 'job',
      text: 'discount',
    });

    const [item] = (await history.list(actor('garage', garageId), {})).items;

    expect(item).toEqual({
      action: 'update',
      actor: { id: actorId, name: 'Elena', role: 'mechanic' },
      at: stored.at.toISOString(),
      carId,
      field: 'final_price_bani',
      garageId,
      id: stored.id,
      internal: false,
      jobId,
      kind: 'correction',
      newValue: 130000,
      oldValue: 120000,
      subjectId: stored.subjectId,
      subjectType: 'job',
      text: 'discount',
      viaAssistant: false,
    });
  });

  it('marks an entry made through an AI assistant', async () => {
    const garageId = randomUUID();
    await entry({
      assistantGrantId: randomUUID(),
      garageId,
      viaAssistant: true,
    });

    const [item] = (await history.list(actor('garage', garageId), {})).items;

    expect(item).toMatchObject({
      actor: { name: 'Ion', role: 'owner' },
      viaAssistant: true,
    });
  });

  it('gives empty optional fields as null', async () => {
    const garageId = randomUUID();
    await entry({
      action: 'open',
      actorId: null,
      actorName: 'MotorFix',
      actorRole: 'system',
      field: null,
      garageId,
      newValue: undefined,
      oldValue: undefined,
    });

    const [item] = (await history.list(actor('garage', garageId), {})).items;

    expect(item).toMatchObject({
      actor: { id: null, name: 'MotorFix', role: 'system' },
      carId: null,
      field: null,
      jobId: null,
      kind: null,
      newValue: null,
      oldValue: null,
      text: null,
    });
  });

  it.each([
    'garage',
    'receptionist',
    'mechanic',
  ] as const)('shows internal entries to the %s', async (role) => {
    const garageId = randomUUID();
    const note = await entry({ garageId, internal: true });

    const [item] = (await history.list(actor(role, garageId), {})).items;

    expect(item).toMatchObject({ id: note.id, internal: true });
  });

  it('shows internal entries to the admin', async () => {
    const garageId = randomUUID();
    await entry({ garageId, internal: true });

    const [item] = (await history.list(actor('admin', null), { garageId }))
      .items;

    expect(item?.internal).toBe(true);
  });
});

describe('phone and plate values', () => {
  async function sensitive(garageId: string) {
    await entry({
      at: minutesAgo(3),
      field: 'phone',
      garageId,
      newValue: '0722 111 222',
      oldValue: '0722 000 000',
      subjectType: 'quote_request',
    });
    await entry({
      at: minutesAgo(2),
      field: 'plate',
      garageId,
      newValue: 'B 123 ABC',
      oldValue: undefined,
      subjectType: 'booking',
    });
    await entry({
      action: 'create',
      at: minutesAgo(1),
      field: null,
      garageId,
      newValue: {
        car: { model: 'Logan', plate: 'CJ 01 XYZ' },
        name: 'Andrei',
        phone: '0733 333 333',
        visits: [{ phone: '0744 444 444' }],
      },
      oldValue: undefined,
      subjectType: 'quote_request',
    });
  }

  it.each([
    'garage',
    'receptionist',
    'mechanic',
  ] as const)('are masked for the %s', async (role) => {
    const garageId = randomUUID();
    await sensitive(garageId);

    const [whole, plate, phone] = (
      await history.list(actor(role, garageId), {})
    ).items;

    expect(phone).toMatchObject({ newValue: '•••', oldValue: '•••' });
    expect(plate).toMatchObject({ newValue: '•••', oldValue: null });
    expect(whole?.newValue).toEqual({
      car: { model: 'Logan', plate: '•••' },
      name: 'Andrei',
      phone: '•••',
      visits: [{ phone: '•••' }],
    });
  });

  it('are shown to the admin as stored', async () => {
    const garageId = randomUUID();
    await sensitive(garageId);

    const [whole, plate, phone] = (
      await history.list(actor('admin', null), { garageId })
    ).items;

    expect(phone).toMatchObject({
      newValue: '0722 111 222',
      oldValue: '0722 000 000',
    });
    expect(plate?.newValue).toBe('B 123 ABC');
    expect(whole?.newValue).toMatchObject({
      car: { plate: 'CJ 01 XYZ' },
      phone: '0733 333 333',
    });
  });

  it('compares names without case and leaves text alone', async () => {
    const garageId = randomUUID();
    await entry({
      field: 'Phone',
      garageId,
      newValue: { Plate: 'B 123 ABC', plates: 2 },
      oldValue: '0722 000 000',
      text: 'sunat la 0722 000 000',
    });

    const [item] = (await history.list(actor('garage', garageId), {})).items;

    expect(item).toMatchObject({
      newValue: '•••',
      oldValue: '•••',
      text: 'sunat la 0722 000 000',
    });
  });

  it('masks a key inside an object even when the field is not sensitive', async () => {
    const garageId = randomUUID();
    await entry({
      field: 'contact',
      garageId,
      newValue: { Plate: 'B 123 ABC', plates: 2 },
    });

    const [item] = (await history.list(actor('garage', garageId), {})).items;

    expect(item?.newValue).toEqual({ Plate: '•••', plates: 2 });
  });

  it('leaves other values as stored', async () => {
    const garageId = randomUUID();
    await entry({
      field: 'from_bani',
      garageId,
      newValue: 130000,
      oldValue: 120000,
      subjectType: 'garage_price',
    });

    const [item] = (await history.list(actor('mechanic', garageId), {})).items;

    expect(item).toMatchObject({ newValue: 130000, oldValue: 120000 });
  });
});

describe('filters', () => {
  it('reads the last 7 days when no start is given', async () => {
    const garageId = randomUUID();
    const recent = await entry({ at: daysAgo(6), garageId });
    await entry({ at: daysAgo(8), garageId });

    const page = await history.list(actor('garage', garageId), {});

    expect(ids(page)).toEqual([recent.id]);
    expect(page.total).toBe(1);
  });

  it('reads any period that is asked for, both ends included', async () => {
    const garageId = randomUUID();
    const from = daysAgo(30);
    const to = daysAgo(10);
    const first = await entry({ at: from, garageId });
    const last = await entry({ at: to, garageId });
    await entry({ at: daysAgo(31), garageId });
    await entry({ at: daysAgo(9), garageId });

    const page = await history.list(actor('garage', garageId), {
      from: from.toISOString(),
      to: to.toISOString(),
    });

    expect(ids(page)).toEqual([last.id, first.id]);
  });

  it('refuses a start after the end', async () => {
    await rejects400(
      history.list(actor('admin', null), {
        from: daysAgo(1).toISOString(),
        to: daysAgo(2).toISOString(),
      }),
      'validation_failed',
    );
  });

  it('gives an empty page when the default start falls after the end', async () => {
    const garageId = randomUUID();
    await entry({ at: daysAgo(20), garageId });

    const page = await history.list(actor('garage', garageId), {
      to: daysAgo(10).toISOString(),
    });

    expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('filters by person', async () => {
    const garageId = randomUUID();
    const elena = randomUUID();
    const hers = await entry({ actorId: elena, garageId });
    await entry({ actorId: randomUUID(), garageId });

    const page = await history.list(actor('garage', garageId), {
      actorId: elena,
    });

    expect(ids(page)).toEqual([hers.id]);
  });

  it('filters by job', async () => {
    const garageId = randomUUID();
    const jobId = randomUUID();
    const onJob = await entry({ garageId, jobId, subjectType: 'job' });
    await entry({ garageId, jobId: randomUUID(), subjectType: 'job' });

    const page = await history.list(actor('mechanic', garageId), { jobId });

    expect(ids(page)).toEqual([onJob.id]);
  });

  it.each([
    ['requests', 'quote_request'],
    ['quotes', 'quote'],
    ['bookings', 'booking'],
    ['jobs', 'job_step'],
    ['prices', 'garage_price'],
    ['repair_history', 'repair'],
    ['photos', 'media_item'],
    ['garage_profile', 'garage'],
    ['team', 'staff_invite'],
    ['settings', 'garage_feature'],
  ] as const)('filters by area %s', async (area, subjectType) => {
    const garageId = randomUUID();
    const inArea = await entry({ garageId, subjectType });
    await entry({ garageId, subjectType: 'something_else' });

    const page = await history.list(actor('admin', null), { area, garageId });

    expect(ids(page)).toEqual([inArea.id]);
  });

  it('admin actions are the entries an admin made', async () => {
    const garageId = randomUUID();
    const byAdmin = await entry({
      actorRole: 'admin',
      garageId,
      subjectType: 'garage',
    });
    await entry({ actorRole: 'owner', garageId, subjectType: 'garage' });

    const page = await history.list(actor('admin', null), {
      area: 'admin_actions',
      garageId,
    });

    expect(ids(page)).toEqual([byAdmin.id]);
  });

  it('combines filters: price entries of the last 7 days', async () => {
    const garageId = randomUUID();
    const price = await entry({
      at: daysAgo(2),
      garageId,
      subjectType: 'garage_price',
    });
    await entry({ at: daysAgo(9), garageId, subjectType: 'garage_price' });
    await entry({ at: daysAgo(2), garageId, subjectType: 'quote' });

    const page = await history.list(actor('garage', garageId), {
      area: 'prices',
      from: daysAgo(7).toISOString(),
    });

    expect(ids(page)).toEqual([price.id]);
    expect(page.total).toBe(1);
  });

  it('answers an empty page when nothing matches', async () => {
    const page = await history.list(actor('garage', randomUUID()), {});

    expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
  });
});

describe('paging', () => {
  it('pages newest first, 20 at a time, with the total', async () => {
    const garageId = randomUUID();
    const made = [];
    for (let i = 25; i > 0; i--) {
      made.push(await entry({ at: minutesAgo(i), garageId }));
    }
    const newestFirst = made.reverse().map((e) => e.id);
    const staff = actor('receptionist', garageId);

    const first = await history.list(staff, {});
    const second = await history.list(staff, {
      cursor: first.nextCursor ?? undefined,
    });

    expect(ids(first)).toEqual(newestFirst.slice(0, 20));
    expect(first.total).toBe(25);
    expect(first.nextCursor).toBe(newestFirst[19]);
    expect(ids(second)).toEqual(newestFirst.slice(20));
    expect(second.total).toBe(25);
    expect(second.nextCursor).toBeNull();
  });

  it('gives no next cursor when exactly one page matches', async () => {
    const garageId = randomUUID();
    for (let i = 20; i > 0; i--) {
      await entry({ at: minutesAgo(i), garageId });
    }

    const page = await history.list(actor('garage', garageId), {});

    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toBeNull();
  });

  it('keeps equal times in id order across pages', async () => {
    const garageId = randomUUID();
    const at = minutesAgo(5);
    const same = [];
    for (let i = 0; i < 23; i++) same.push(await entry({ at, garageId }));
    const expected = same
      .map((e) => e.id)
      .sort()
      .reverse();
    const staff = actor('garage', garageId);

    const first = await history.list(staff, {});
    const second = await history.list(staff, {
      cursor: first.nextCursor ?? undefined,
    });

    expect([...ids(first), ...ids(second)]).toEqual(expected);
  });

  it('keeps entries apart by microseconds within one millisecond', async () => {
    const garageId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO activity_log (id, at, action, subject_type, subject_id, actor_role, actor_name, garage_id)
      SELECT gen_random_uuid(), '2026-10-01T10:00:00.000001Z'::timestamptz + (n || ' microseconds')::interval,
             'update', 'quote', gen_random_uuid(), 'owner', 'Ion', ${garageId}::uuid
      FROM generate_series(1, 22) AS n`;
    const staff = actor('garage', garageId);
    const from = '2026-09-30T00:00:00Z';

    const first = await history.list(staff, { from });
    const second = await history.list(staff, {
      cursor: first.nextCursor ?? undefined,
      from,
    });

    const seen = [...ids(first), ...ids(second)];
    expect(seen).toHaveLength(22);
    expect(new Set(seen).size).toBe(22);
  });

  it('refuses a cursor outside the caller’s scope', async () => {
    const g = await twoGarages();

    await rejects400(
      history.list(actor('garage', g.nord), { cursor: g.inSud.id }),
      'invalid_cursor',
    );
    await rejects400(
      history.list(actor('garage', g.nord), { cursor: randomUUID() }),
      'invalid_cursor',
    );
  });

  it('lets the admin continue from an entry of any garage', async () => {
    const g = await twoGarages();

    const page = await history.list(actor('admin', null), {
      cursor: g.inNord2.id,
      garageId: g.nord,
    });

    expect(ids(page)).toEqual([g.inNord.id]);
  });

  it('refuses a cursor that no longer matches the filters', async () => {
    const g = await twoGarages();
    const shift = (seconds: number) => new Date(+g.inNord2.at + seconds * 1000);
    await entry({
      at: shift(-30),
      garageId: g.nord,
      subjectType: 'staff_invite',
    });

    await rejects400(
      history.list(actor('garage', g.nord), {
        area: 'team',
        cursor: g.inNord2.id,
      }),
      'invalid_cursor',
    );
  });

  it('continues from a cursor that matches the filters', async () => {
    const g = await twoGarages();
    const shift = (seconds: number) => new Date(+g.inNord2.at + seconds * 1000);
    const newer = await entry({
      at: shift(30),
      garageId: g.nord,
      subjectType: 'staff_invite',
    });
    const older = await entry({
      at: shift(-30),
      garageId: g.nord,
      subjectType: 'staff_invite',
    });

    const page = await history.list(actor('garage', g.nord), {
      area: 'team',
      cursor: newer.id,
    });

    expect(ids(page)).toEqual([older.id]);
  });
});

describe('reading', () => {
  it('writes no entry', async () => {
    const garageId = randomUUID();
    await entry({ garageId });
    const before = await prisma.activityLog.count();

    await history.list(actor('garage', garageId), {});
    await history.list(actor('admin', null), {});

    expect(await prisma.activityLog.count()).toBe(before);
  });
});
