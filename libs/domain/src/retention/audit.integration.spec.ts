import { randomUUID } from 'node:crypto';

import { anonymiseAudit } from './audit';
import { ANONYMISED, RETENTION, RETENTION_BATCH } from './retention.config';
import { ago, anonymisedShape, retentionFixtures } from './retention.testing';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl } from '../notifications/notifications.testing';

serialDatabase(databaseUrl);

const prisma = createPrisma(databaseUrl);
const data = retentionFixtures(prisma);
const now = new Date('2026-10-24T10:00:00.000Z');
const days = RETENTION.auditHistory.days;
const outside = ago(now, days, 1);
const inside = ago(now, days, -1);
const longAgo = ago(now, days * 2);

// Other spec files leave accounts behind and this one cannot clear its own
// (the log it writes is append-only), so each account here is new.
const newAccount = (
  name: string,
  ...rest: Parameters<typeof data.account> extends [string, ...infer R]
    ? R
    : never
) => data.account(`${name}-${randomUUID().slice(0, 8)}`, ...rest);

const row = (id: string) =>
  prisma.activityLog.findUniqueOrThrow({ where: { id } });

// The exact write the trigger admits, for the row `id`.
const anonymise = (id: string) => prisma.$executeRaw`
  UPDATE activity_log SET actor_id = NULL, actor_name = ${ANONYMISED},
         old_value = NULL, new_value = NULL, text = NULL
   WHERE id = ${id}::uuid`;

afterAll(() => prisma.$disconnect());
beforeAll(async () => {
  // Rows other spec files left behind are not this file's to count.
  while ((await anonymiseAudit(prisma, now)) > 0);
});

// @traces 1156-FR-008
describe('the append-only rule', () => {
  it('still refuses a delete and a truncate', async () => {
    const id = await data.entry({ at: now });
    await expect(
      prisma.$executeRaw`DELETE FROM activity_log WHERE id = ${id}::uuid`,
    ).rejects.toThrow('activity_log is append-only');
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE activity_log'),
    ).rejects.toThrow('activity_log is append-only');
    await expect(row(id)).resolves.toBeDefined();
  });

  it.each([
    ['the time', `at = at - interval '1 day'`],
    ['the action', `action = 'delete'`],
    ['the subject', 'subject_id = gen_random_uuid()'],
    ['the field', `field = 'other'`],
    ['the garage', 'garage_id = gen_random_uuid()'],
    ['the actor role', `actor_role = 'admin'`],
    ['the kind', `kind = 'other'`],
    ['the internal flag', 'internal = true'],
    ['only the actor', 'actor_id = NULL'],
    ['only the text', 'text = NULL'],
    ['the actor name to anything else', `actor_name = 'someone'`],
    [
      'the anonymising columns plus the time',
      `actor_id = NULL, actor_name = '${ANONYMISED}', old_value = NULL, new_value = NULL, text = NULL, at = at - interval '1 day'`,
    ],
    [
      'the values to something other than NULL',
      `actor_id = NULL, actor_name = '${ANONYMISED}', old_value = '{}'::jsonb, new_value = NULL, text = NULL`,
    ],
  ])('refuses an update of %s', async (_, set) => {
    const id = await data.entry({ actorId: randomUUID(), at: now });
    const original = await row(id);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE activity_log SET ${set} WHERE id = $1::uuid`,
        id,
      ),
    ).rejects.toThrow('activity_log is append-only');
    expect(await row(id)).toEqual(original);
  });

  it('admits the exact anonymising write and nothing else after it', async () => {
    const id = await data.entry({
      actorId: randomUUID(),
      at: now,
      garageId: randomUUID(),
    });
    const original = await row(id);
    expect(await anonymise(id)).toBe(1);
    expect(await row(id)).toEqual({ ...original, ...anonymisedShape });
    // Writing the same values again is still that write.
    expect(await anonymise(id)).toBe(1);
    await expect(
      prisma.$executeRaw`UPDATE activity_log SET kind = 'x' WHERE id = ${id}::uuid`,
    ).rejects.toThrow('activity_log is append-only');
  });
});

// @traces 1156-FR-007
// @traces 1156-FR-009
// @traces 1156-FR-014
describe('the audit anonymising sweep', () => {
  it('anonymises by garage closure, leaving the rest of the row as it was', async () => {
    const old = await data.garage(outside);
    const recent = await data.garage(inside);
    const open = await data.garage(null);
    const actor = await newAccount('ana');
    const due = await data.entry({
      actorId: actor,
      at: longAgo,
      garageId: old,
    });
    const keep = [
      await data.entry({ actorId: actor, at: longAgo, garageId: recent }),
      await data.entry({ actorId: actor, at: longAgo, garageId: open }),
    ];
    const original = await row(due);

    expect(await anonymiseAudit(prisma, now)).toBe(1);

    expect(await row(due)).toEqual({ ...original, ...anonymisedShape });
    for (const id of keep) expect((await row(id)).actorName).toBe('Ana Pop');
  });

  it('anonymises by the deletion of the account the entry is about', async () => {
    const gone = await newAccount('gone', ['driver'], { status: 'deleted' });
    const live = await newAccount('live');
    await data.entry({
      at: outside,
      kind: 'account_deleted',
      subjectId: gone,
      subjectType: 'account',
    });
    const recentlyGone = await newAccount('recent', ['driver'], {
      status: 'deleted',
    });
    await data.entry({
      at: inside,
      kind: 'account_deleted',
      subjectId: recentlyGone,
      subjectType: 'account',
    });
    const due = await data.entry({
      actorId: live,
      at: longAgo,
      subjectId: gone,
      subjectType: 'account',
    });
    // The subject decides before the actor: a live subject keeps the row.
    const keepLiveSubject = await data.entry({
      actorId: gone,
      at: longAgo,
      subjectId: live,
      subjectType: 'account',
    });
    const keepRecent = await data.entry({
      at: longAgo,
      subjectId: recentlyGone,
      subjectType: 'account',
    });

    // Every entry about the deleted account goes, its own sign-up entries too.
    await anonymiseAudit(prisma, now);

    expect(await row(due)).toMatchObject(anonymisedShape);
    expect((await row(keepLiveSubject)).actorName).toBe('Ana Pop');
    expect((await row(keepRecent)).actorName).toBe('Ana Pop');
  });

  it("anonymises by the deletion of the entry's actor when it is about something else", async () => {
    const gone = await newAccount('gone-actor', ['driver'], {
      status: 'deleted',
    });
    await data.entry({
      at: outside,
      kind: 'account_deleted',
      subjectId: gone,
      subjectType: 'account',
    });
    const live = await newAccount('live-actor');
    const due = await data.entry({ actorId: gone, at: longAgo });
    const keep = await data.entry({ actorId: live, at: longAgo });
    await anonymiseAudit(prisma, now);
    expect(await row(due)).toMatchObject(anonymisedShape);
    expect((await row(keep)).actorName).toBe('Ana Pop');
  });

  it("falls back to a deleted account's last activity, or creation, without a deletion entry", async () => {
    const quiet = await newAccount('quiet', ['driver'], {
      status: 'deleted',
    });
    await prisma.account.update({
      data: { lastActiveAt: outside },
      where: { id: quiet },
    });
    const active = await newAccount('active', ['driver'], {
      status: 'deleted',
    });
    await prisma.account.update({
      data: { lastActiveAt: inside },
      where: { id: active },
    });
    const due = await data.entry({ actorId: quiet, at: longAgo });
    const keep = await data.entry({ actorId: active, at: longAgo });
    await anonymiseAudit(prisma, now);
    expect(await row(due)).toMatchObject(anonymisedShape);
    expect((await row(keep)).actorName).toBe('Ana Pop');
  });

  it('anonymises an entry with no owner by its own time', async () => {
    const due = await data.entry({ at: outside });
    const keep = await data.entry({ at: inside });
    expect(await anonymiseAudit(prisma, now)).toBe(1);
    expect(await row(due)).toMatchObject(anonymisedShape);
    expect((await row(keep)).actorName).toBe('Ana Pop');
  });

  it('takes an entry whose garage no longer exists by its own time', async () => {
    const due = await data.entry({ at: outside, garageId: randomUUID() });
    const keep = await data.entry({ at: inside, garageId: randomUUID() });
    expect(await anonymiseAudit(prisma, now)).toBe(1);
    expect(await row(due)).toMatchObject(anonymisedShape);
    expect((await row(keep)).actorName).toBe('Ana Pop');
  });

  it('never takes an entry of a suspended garage or account', async () => {
    const garage = await data.garage(null);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garage },
    });
    const account = await newAccount('paused', ['driver'], {
      status: 'suspended',
    });
    const keep = [
      await data.entry({ at: longAgo, garageId: garage }),
      await data.entry({ actorId: account, at: longAgo }),
      await data.entry({
        at: longAgo,
        subjectId: account,
        subjectType: 'account',
      }),
    ];
    expect(await anonymiseAudit(prisma, now)).toBe(0);
    for (const id of keep) expect((await row(id)).actorName).toBe('Ana Pop');
  });

  it('never writes or counts an anonymised entry again', async () => {
    await data.entry({ at: outside });
    expect(await anonymiseAudit(prisma, now)).toBe(1);
    expect(await anonymiseAudit(prisma, now)).toBe(0);
  });
});

// @traces 1156-FR-013
describe('the audit batches', () => {
  it('keep going until every due entry is anonymised', async () => {
    const total = RETENTION_BATCH + 4;
    await prisma.$executeRaw`
      INSERT INTO activity_log (id, at, action, subject_type, subject_id, actor_role, actor_name, text)
      SELECT gen_random_uuid(), ${outside}, 'update', 'car', gen_random_uuid(), 'system', 'System', 'old'
        FROM generate_series(1, ${total})`;
    expect(await anonymiseAudit(prisma, now)).toBe(total);
    expect(await anonymiseAudit(prisma, now)).toBe(0);
  });
});
