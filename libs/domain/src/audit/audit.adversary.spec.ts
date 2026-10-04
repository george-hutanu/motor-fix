import { randomUUID } from 'node:crypto';

import { AuditService } from './audit.service';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const audit = new AuditService();

const entriesOf = (subjectId: string) =>
  prisma.activityLog.findMany({ orderBy: { at: 'asc' }, where: { subjectId } });

const actor = {
  actorId: randomUUID(),
  actorName: 'Ion Popescu',
  actorRole: 'garage' as const,
};

const base = (subjectId: string) => ({
  ...actor,
  subjectId,
  subjectType: 'job',
});

const accountNamed = (
  name: string,
  role: 'driver' | 'mechanic' | 'receptionist',
) =>
  prisma.account.create({
    data: { lastRole: role, name, roles: { create: [{ role }] } },
  });

describe('append-only history', () => {
  it('refuses to update an entry', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, { ...base(subjectId), action: 'create' }),
    );

    await expect(
      prisma.activityLog.updateMany({
        data: { actorName: 'Eve' },
        where: { subjectId },
      }),
    ).rejects.toThrow();
    expect((await entriesOf(subjectId))[0]?.actorName).toBe('Ion');
  });

  it('refuses to delete an entry', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, { ...base(subjectId), action: 'create' }),
    );

    await expect(
      prisma.activityLog.deleteMany({ where: { subjectId } }),
    ).rejects.toThrow();
    expect(await entriesOf(subjectId)).toHaveLength(1);
  });

  it('refuses a raw delete and a raw update', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, { ...base(subjectId), action: 'create' }),
    );

    await expect(
      prisma.$executeRaw`DELETE FROM activity_log WHERE subject_id = ${subjectId}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE activity_log SET text = 'x' WHERE subject_id = ${subjectId}::uuid`,
    ).rejects.toThrow();
    expect(await entriesOf(subjectId)).toHaveLength(1);
  });

  it('refuses a truncate', async () => {
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE activity_log'),
    ).rejects.toThrow();
  });

  it('refuses an update that changes nothing', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, { ...base(subjectId), action: 'create' }),
    );

    await expect(
      prisma.$executeRaw`UPDATE activity_log SET actor_name = actor_name WHERE subject_id = ${subjectId}::uuid`,
    ).rejects.toThrow();
  });

  it('keeps the entries and the name they were written with when the account is deleted later', async () => {
    const subjectId = randomUUID();
    const { id } = await accountNamed('Maria Pop', 'driver');
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'create',
        actorId: id,
        actorName: undefined,
        actorRole: 'driver',
      }),
    );

    await prisma.account.delete({ where: { id } });

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ actorId: id, actorName: 'Maria' }),
    ]);
  });
});

describe('record actor name', () => {
  const nameOf = async (given: string | undefined) => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'create',
        actorId: randomUUID(),
        actorName: given,
        actorRole: 'driver',
        subjectId,
        subjectType: 'job',
      }),
    );
    return (await entriesOf(subjectId))[0]?.actorName;
  };

  it('splits a given name on a tab', async () => {
    expect(await nameOf('Elena\tIonescu')).toBe('Elena');
  });

  it('splits a given name on a newline', async () => {
    expect(await nameOf('Elena\nIonescu')).toBe('Elena');
  });

  it('trims leading whitespace before taking the first name', async () => {
    expect(await nameOf('   \n Elena  Ionescu')).toBe('Elena');
  });

  it('keeps a single-word name whole', async () => {
    expect(await nameOf('Elena')).toBe('Elena');
  });

  it('keeps non-ASCII first names intact', async () => {
    expect(await nameOf('Ștefan Țurcanu')).toBe('Ștefan');
  });

  it('keeps a hyphenated first name whole', async () => {
    expect(await nameOf('Ana-Maria Pop')).toBe('Ana-Maria');
  });

  it('writes an empty name for a whitespace-only name', async () => {
    expect(await nameOf('   ')).toBe('');
  });

  it('names the system MotorFix whatever name the caller gives', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'update',
        actorId: null,
        actorName: 'Robot Johnson',
        actorRole: 'system',
        field: 'status',
        subjectId,
        subjectType: 'request',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        actorId: null,
        actorName: 'MotorFix',
        actorRole: 'system',
      }),
    ]);
  });

  it('names the system MotorFix even when an existing account id is given', async () => {
    const subjectId = randomUUID();
    const { id } = await accountNamed('Vlad Tepes', 'driver');
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'update',
        actorId: id,
        actorRole: 'system',
        subjectId,
        subjectType: 'request',
      }),
    );

    expect((await entriesOf(subjectId))[0]?.actorName).toBe('MotorFix');
  });

  it('writes an empty name for a null actor that is not the system', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'create',
        actorId: null,
        actorRole: 'driver',
        subjectId,
        subjectType: 'job',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ actorId: null, actorName: '' }),
    ]);
  });

  it('reduces a looked-up name that starts with a tab to its first name', async () => {
    const subjectId = randomUUID();
    const { id } = await accountNamed('\tAna\tMaria Pop', 'mechanic');
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'create',
        actorId: id,
        actorRole: 'mechanic',
        subjectId,
        subjectType: 'job',
      }),
    );

    expect((await entriesOf(subjectId))[0]?.actorName).toBe('Ana');
  });
});

describe('record actor role', () => {
  it.each([
    ['driver', 'driver'],
    ['garage', 'owner'],
    ['receptionist', 'receptionist'],
    ['mechanic', 'mechanic'],
    ['admin', 'admin'],
    ['system', 'system'],
  ] as const)('stores %s as %s', async (given, stored) => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'create',
        actorRole: given,
      }),
    );

    expect((await entriesOf(subjectId))[0]?.actorRole).toBe(stored);
  });

  it('rejects an unknown role and writes nothing', async () => {
    const subjectId = randomUUID();
    await expect(
      prisma.$transaction((tx) =>
        audit.record(tx, {
          ...base(subjectId),
          action: 'create',
          actorRole: 'superuser' as never,
        }),
      ),
    ).rejects.toThrow();
    expect(await entriesOf(subjectId)).toEqual([]);
  });
});

describe('record flags', () => {
  it.each([
    ['quote', 'from_bani'],
    ['quote', 'to_bani'],
    ['job', 'final_price_bani'],
    ['job', 'status'],
    ['job', 'eta_at'],
    ['booking', 'starts_at'],
    ['booking', 'mechanic_id'],
  ])('marks %s.%s as a key change', async (subjectType, field) => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'update',
        field,
        subjectType,
      }),
    );

    expect((await entriesOf(subjectId))[0]?.isKeyChange).toBe(true);
  });

  it.each([
    ['quote', 'status'],
    ['job', 'from_bani'],
    ['booking', 'status'],
    ['job', 'note'],
    ['Job', 'status'],
    ['job', 'Status'],
    ['job', 'status '],
    ['garage_price', 'from_bani'],
    ['quote_job', 'status'],
    ['job.status', 'x'],
  ])('does not mark %s.%s as a key change', async (subjectType, field) => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'update',
        field,
        subjectType,
      }),
    );

    expect((await entriesOf(subjectId))[0]?.isKeyChange).toBe(false);
  });

  it('does not mark a whole-subject create of a job as a key change', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'create',
        newValue: { status: 'in_work' },
      }),
    );

    expect((await entriesOf(subjectId))[0]?.isKeyChange).toBe(false);
  });

  it('ignores a key change flag smuggled in by the caller', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'update',
        field: 'note',
        isKeyChange: true,
      } as never),
    );

    expect((await entriesOf(subjectId))[0]?.isKeyChange).toBe(false);
  });

  it('ignores a via_assistant flag given without a grant id', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'create',
        viaAssistant: true,
      } as never),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ assistantGrantId: null, viaAssistant: false }),
    ]);
  });

  it('stores the grant id and via_assistant together', async () => {
    const subjectId = randomUUID();
    const assistantGrantId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'create',
        assistantGrantId,
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ assistantGrantId, viaAssistant: true }),
    ]);
  });

  it('stores internal as told, true or false', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await prisma.$transaction(async (tx) => {
      await audit.record(tx, { ...base(a), action: 'create', internal: false });
      await audit.record(tx, { ...base(b), action: 'create', internal: true });
    });

    expect((await entriesOf(a))[0]?.internal).toBe(false);
    expect((await entriesOf(b))[0]?.internal).toBe(true);
  });

  it('leaves scope ids, field, kind and text null when none are given', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, { ...base(subjectId), action: 'create' }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        carId: null,
        field: null,
        garageId: null,
        jobId: null,
        kind: null,
        text: null,
      }),
    ]);
  });
});

describe('record values', () => {
  it('stores nested JSON exactly, with unicode and money integers', async () => {
    const subjectId = randomUUID();
    const value = {
      items: [{ bani: 120000, label: 'Schimb ulei — ăîșț 🚗' }, null, [1, 2]],
      nested: { deep: { deeper: true } },
    };
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'create',
        newValue: value,
      }),
    );

    expect((await entriesOf(subjectId))[0]?.newValue).toEqual(value);
  });

  it('stores a Date as a UTC ISO string, also nested', async () => {
    const subjectId = randomUUID();
    const when = new Date('2026-10-05T14:00:00.000Z');
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'update',
        field: 'eta_at',
        newValue: { at: when, plain: when },
        oldValue: when,
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        newValue: {
          at: '2026-10-05T14:00:00.000Z',
          plain: '2026-10-05T14:00:00.000Z',
        },
        oldValue: '2026-10-05T14:00:00.000Z',
      }),
    ]);
  });

  it('stores a large value of about one megabyte', async () => {
    const subjectId = randomUUID();
    const big = { blob: 'x'.repeat(1_000_000) };
    await prisma.$transaction((tx) =>
      audit.record(tx, { ...base(subjectId), action: 'create', newValue: big }),
    );

    expect((await entriesOf(subjectId))[0]?.newValue).toEqual(big);
  });

  it('stores zero and false as values, not as missing', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'update',
        field: 'price',
        newValue: 0,
        oldValue: false,
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ newValue: 0, oldValue: false }),
    ]);
  });

  it('stores an empty string as a value', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'update',
        field: 'note',
        newValue: '',
        oldValue: 'x',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ newValue: '', oldValue: 'x' }),
    ]);
  });

  it('keeps the old value of a delete and leaves the new value empty', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'delete',
        oldValue: { a: 1 },
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ newValue: null, oldValue: { a: 1 } }),
    ]);
  });

  it('writes an open entry with no field and no old or new value', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...base(subjectId),
        action: 'open',
        actorRole: 'admin',
        subjectType: 'repair',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        action: 'open',
        field: null,
        newValue: null,
        oldValue: null,
      }),
    ]);
  });
});

describe('record failure', () => {
  it('rejects a subject id that is not a uuid and leaves the change unsaved', async () => {
    const name = `adv-${randomUUID()}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.account.create({
          data: {
            lastRole: 'driver',
            name,
            roles: { create: [{ role: 'driver' }] },
          },
        });
        await audit.record(tx, { ...base('not-a-uuid'), action: 'create' });
      }),
    ).rejects.toThrow();

    expect(await prisma.account.count({ where: { name } })).toBe(0);
  });

  it('rejects a scope id that is not a uuid', async () => {
    const subjectId = randomUUID();
    await expect(
      prisma.$transaction((tx) =>
        audit.record(tx, {
          ...base(subjectId),
          action: 'create',
          garageId: 'nope',
        }),
      ),
    ).rejects.toThrow();
    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('rejects an unknown action', async () => {
    const subjectId = randomUUID();
    await expect(
      prisma.$transaction((tx) =>
        audit.record(tx, { ...base(subjectId), action: 'truncate' as never }),
      ),
    ).rejects.toThrow();
    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('rolls back an earlier good entry when a later one fails', async () => {
    const good = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await audit.record(tx, { ...base(good), action: 'create' });
        await audit.record(tx, { ...base('bad'), action: 'create' });
      }),
    ).rejects.toThrow();

    expect(await entriesOf(good)).toEqual([]);
  });
});

describe('recordChanges', () => {
  it('writes nothing for two empty records', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(tx, base(subjectId), {}, {}),
    );
    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('writes nothing when every field is equal', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        base(subjectId),
        { a: 1, b: 'x', c: null },
        { a: 1, b: 'x', c: null },
      ),
    );
    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('treats objects with the same content in a different key order as unchanged', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        base(subjectId),
        { opts: { a: 1, b: { c: 2, d: 3 } } },
        JSON.parse('{"opts": {"b": {"d": 3, "c": 2}, "a": 1}}'),
      ),
    );
    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('treats arrays in a different order as changed', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        base(subjectId),
        { tags: [1, 2, 3] },
        { tags: [3, 2, 1] },
      ),
    );
    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        field: 'tags',
        newValue: [3, 2, 1],
        oldValue: [1, 2, 3],
      }),
    ]);
  });

  it('writes only the date that moved and marks a booking start as key', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        { ...base(subjectId), subjectType: 'booking' },
        {
          ends_at: new Date('2026-10-05T10:00:00Z'),
          starts_at: new Date('2026-10-05T09:00:00Z'),
        },
        {
          ends_at: new Date('2026-10-05T10:00:00Z'),
          starts_at: new Date('2026-10-05T09:30:00Z'),
        },
      ),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        field: 'starts_at',
        isKeyChange: true,
        newValue: '2026-10-05T09:30:00.000Z',
        oldValue: '2026-10-05T09:00:00.000Z',
      }),
    ]);
  });

  it('treats a date and its ISO string as unchanged', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        base(subjectId),
        { eta_at: new Date('2026-10-05T09:00:00Z') },
        { eta_at: '2026-10-05T09:00:00.000Z' },
      ),
    );
    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('does not conflate 0, false, empty string and null', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        base(subjectId),
        { a: 0, b: false, c: '', d: null },
        { a: false, b: '', c: null, d: 0 },
      ),
    );

    const rows = await entriesOf(subjectId);
    expect(rows.map((r) => r.field).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not conflate the number 1 and the string "1"', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(tx, base(subjectId), { n: 1 }, { n: '1' }),
    );
    expect(await entriesOf(subjectId)).toHaveLength(1);
  });

  it('writes a field that only exists after as a change from nothing', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(tx, base(subjectId), {}, { note: 'new' }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        action: 'update',
        field: 'note',
        newValue: 'new',
        oldValue: null,
      }),
    ]);
  });

  it('ignores a field present only in before', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        base(subjectId),
        { gone: 1, kept: 2 },
        { kept: 2 },
      ),
    );
    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('copies actor, scope, flags, kind and text onto every entry and decides key changes per field', async () => {
    const subjectId = randomUUID();
    const garageId = randomUUID();
    const carId = randomUUID();
    const jobId = randomUUID();
    const assistantGrantId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        {
          ...base(subjectId),
          assistantGrantId,
          carId,
          garageId,
          internal: true,
          jobId,
          kind: 'correction',
          text: 'typo',
        },
        { final_price_bani: 145000, note: 'a', status: 'in_work' },
        { final_price_bani: 138000, note: 'b', status: 'done' },
      ),
    );

    const rows = await entriesOf(subjectId);
    expect(rows.map((r) => [r.field, r.isKeyChange])).toEqual([
      ['final_price_bani', true],
      ['note', false],
      ['status', true],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        action: 'update',
        actorName: 'Ion',
        actorRole: 'owner',
        assistantGrantId,
        carId,
        garageId,
        internal: true,
        jobId,
        kind: 'correction',
        text: 'typo',
        viaAssistant: true,
      });
    }
  });

  it('orders entries by the order of the fields in after, with distinct times', async () => {
    const subjectId = randomUUID();
    const after: Record<string, unknown> = {};
    for (const key of ['z', 'a', 'm', 'b', 'y']) after[key] = 1;
    await prisma.$transaction((tx) =>
      audit.recordChanges(tx, base(subjectId), {}, after),
    );

    const rows = await entriesOf(subjectId);
    expect(rows.map((r) => r.field)).toEqual(['z', 'a', 'm', 'b', 'y']);
    expect(new Set(rows.map((r) => r.at.getTime())).size).toBe(rows.length);
  });

  it('handles a hundred changed fields in one call', async () => {
    const subjectId = randomUUID();
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (let i = 0; i < 100; i += 1) {
      before[`f${i}`] = i;
      after[`f${i}`] = i + 1;
    }
    await prisma.$transaction((tx) =>
      audit.recordChanges(tx, base(subjectId), before, after),
    );
    expect(await entriesOf(subjectId)).toHaveLength(100);
  });

  it('rolls every entry back when the transaction fails after the call', async () => {
    const subjectId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await audit.recordChanges(tx, base(subjectId), { a: 1 }, { a: 2 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('writes no entry at all when one of them cannot be written', async () => {
    const subjectId = randomUUID();
    await expect(
      prisma.$transaction((tx) =>
        audit.recordChanges(
          tx,
          { ...base(subjectId), garageId: 'nope' },
          { a: 1 },
          { a: 2 },
        ),
      ),
    ).rejects.toThrow();
    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('applies the looked-up first name to every entry', async () => {
    const subjectId = randomUUID();
    const { id } = await accountNamed('Carmen Dima', 'receptionist');
    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        {
          actorId: id,
          actorRole: 'receptionist',
          subjectId,
          subjectType: 'job',
        },
        { a: 1, b: 1 },
        { a: 2, b: 2 },
      ),
    );

    expect((await entriesOf(subjectId)).map((r) => r.actorName)).toEqual([
      'Carmen',
      'Carmen',
    ]);
  });

  it('does not mutate the before and after records it is given', async () => {
    const subjectId = randomUUID();
    const before = { d: new Date('2026-10-05T09:00:00Z'), o: { a: 1 } };
    const after = { d: new Date('2026-10-05T10:00:00Z'), o: { a: 2 } };
    const snapshot = structuredClone({ after, before });
    await prisma.$transaction((tx) =>
      audit.recordChanges(tx, base(subjectId), before, after),
    );
    expect({ after, before }).toEqual(snapshot);
  });

  it('keeps fields named like object prototype keys', async () => {
    const subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        base(subjectId),
        {},
        JSON.parse('{"__proto__": {"x": 1}, "constructor": 2, "toString": 3}'),
      ),
    );

    const fields = (await entriesOf(subjectId)).map((r) => r.field).sort();
    expect(fields).toEqual(['__proto__', 'constructor', 'toString'].sort());
  });
});
