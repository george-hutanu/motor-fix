import { randomUUID } from 'node:crypto';

import { anonymiseAudit } from './audit';
import { sweepLegalDocuments } from './legal-documents';
import { sweepNotifications } from './notifications';
import { ANONYMISED, RETENTION, RETENTION_BATCH } from './retention.config';
import { ago, anonymisedShape, retentionFixtures } from './retention.testing';
import { sweepExpired } from './secrets';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl } from '../notifications/notifications.testing';

serialDatabase(databaseUrl);

const prisma = createPrisma(databaseUrl);
const data = retentionFixtures(prisma);
const now = new Date('2026-10-24T10:00:00.000Z');
const auditDays = RETENTION.auditHistory.days;
const auditOutside = ago(now, auditDays, 1);
const auditAtLimit = ago(now, auditDays);
const auditInside = ago(now, auditDays, -1);
const longAgo = ago(now, auditDays * 2);

const row = (id: string) =>
  prisma.activityLog.findUniqueOrThrow({ where: { id } });

afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await data.reset();
  // Entries of earlier tests outlive their garages; none is this test's to count.
  while ((await anonymiseAudit(prisma, now)) > 0);
});

// @traces 1156-FR-008
describe('the append-only trigger against hostile statements', () => {
  it.each([
    ['a truncate with cascade', 'TRUNCATE activity_log CASCADE'],
    [
      'a truncate restarting identities',
      'TRUNCATE activity_log RESTART IDENTITY',
    ],
  ])('refuses %s', async (_, statement) => {
    const id = await data.entry({ at: now });
    await expect(prisma.$executeRawUnsafe(statement)).rejects.toThrow(
      'activity_log is append-only',
    );
    await expect(row(id)).resolves.toBeDefined();
  });

  it.each([
    ['the marker in another case', `actor_name = 'Anonymised'`],
    ['the marker with a trailing space', `actor_name = 'anonymised '`],
    ['an empty actor name', `actor_name = ''`],
    ['a NULL actor name', 'actor_name = NULL'],
    ['the id', 'id = gen_random_uuid()'],
    ['the request id', `request_id = gen_random_uuid()`],
  ])('refuses a full blanking that also sets %s', async (_, extra) => {
    const id = await data.entry({ actorId: randomUUID(), at: now });
    const original = await row(id);
    const base = `actor_id = NULL, old_value = NULL, new_value = NULL, text = NULL`;
    const set = extra.startsWith('actor_name')
      ? `${base}, ${extra}`
      : `${base}, actor_name = '${ANONYMISED}', ${extra}`;
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE activity_log SET ${set} WHERE id = $1::uuid`,
        id,
      ),
    ).rejects.toThrow('activity_log is append-only');
    expect(await row(id)).toEqual(original);
  });

  it('refuses to restore the values of an anonymised entry', async () => {
    const id = await data.entry({ actorId: randomUUID(), at: now });
    await prisma.$executeRaw`
      UPDATE activity_log SET actor_id = NULL, actor_name = ${ANONYMISED},
             old_value = NULL, new_value = NULL, text = NULL
       WHERE id = ${id}::uuid`;
    await expect(
      prisma.$executeRaw`UPDATE activity_log SET text = 'Ana Pop changed the name' WHERE id = ${id}::uuid`,
    ).rejects.toThrow('activity_log is append-only');
    await expect(
      prisma.$executeRaw`UPDATE activity_log SET actor_name = 'Ana Pop' WHERE id = ${id}::uuid`,
    ).rejects.toThrow('activity_log is append-only');
    expect((await row(id)).text).toBeNull();
  });

  it('refuses a multi-row update when one row in it is not the anonymising write', async () => {
    const a = await data.entry({ actorId: randomUUID(), at: now });
    const b = await data.entry({ actorId: randomUUID(), at: now });
    await expect(
      prisma.$executeRaw`
        UPDATE activity_log SET actor_id = NULL, actor_name = ${ANONYMISED},
               old_value = NULL, new_value = NULL, text = NULL,
               at = CASE WHEN id = ${b}::uuid THEN at - interval '1 day' ELSE at END
         WHERE id IN (${a}::uuid, ${b}::uuid)`,
    ).rejects.toThrow('activity_log is append-only');
    expect((await row(a)).actorName).toBe('Ana Pop');
    expect((await row(b)).actorName).toBe('Ana Pop');
  });
});

// @traces 1156-FR-007
describe('the audit sweep at its boundaries and owners', () => {
  it('leaves a platform entry exactly at the limit and anonymises one a millisecond older', async () => {
    const atLimit = await data.entry({ at: auditAtLimit });
    const older = await data.entry({ at: auditOutside });
    const inside = await data.entry({ at: auditInside });
    expect(await anonymiseAudit(prisma, now)).toBe(1);
    expect((await row(atLimit)).actorName).toBe('Ana Pop');
    expect((await row(inside)).actorName).toBe('Ana Pop');
    expect(await row(older)).toMatchObject(anonymisedShape);
  });

  it('leaves entries of a garage closed exactly at the limit', async () => {
    const garage = await data.garage(auditAtLimit);
    const id = await data.entry({ at: longAgo, garageId: garage });
    expect(await anonymiseAudit(prisma, now)).toBe(0);
    expect((await row(id)).actorName).toBe('Ana Pop');
  });

  it('anonymises a closed garage entry even when its actor is still active', async () => {
    const garage = await data.garage(auditOutside);
    const admin = await data.account('admin');
    const id = await data.entry({ actorId: admin, at: now, garageId: garage });
    await anonymiseAudit(prisma, now);
    expect(await row(id)).toMatchObject(anonymisedShape);
  });

  it('keeps an open garage entry whose actor was deleted six years ago', async () => {
    const garage = await data.garage(null);
    const gone = await data.account('gone', ['driver'], { status: 'deleted' });
    await data.entry({
      at: ago(now, 365 * 6),
      kind: 'account_deleted',
      subjectId: gone,
      subjectType: 'account',
    });
    const id = await data.entry({
      actorId: gone,
      at: ago(now, 365 * 6),
      garageId: garage,
    });
    // The actor's own entries age out; this one follows its open garage.
    await anonymiseAudit(prisma, now);
    expect((await row(id)).actorName).toBe('Ana Pop');
  });

  it('lets the subject account win over a long-deleted actor', async () => {
    const live = await data.account('live');
    const gone = await data.account('gone', ['driver'], { status: 'deleted' });
    await data.entry({
      at: ago(now, 365 * 6),
      kind: 'account_deleted',
      subjectId: gone,
      subjectType: 'account',
    });
    const id = await data.entry({
      actorId: gone,
      at: ago(now, 365 * 6),
      subjectId: live,
      subjectType: 'account',
    });
    await anonymiseAudit(prisma, now);
    expect((await row(id)).actorName).toBe('Ana Pop');
  });

  it('keeps entries of a suspended account however old they are', async () => {
    const suspended = await data.account('susp', ['driver'], {
      status: 'suspended',
    });
    const id = await data.entry({
      actorId: suspended,
      at: longAgo,
      subjectId: suspended,
      subjectType: 'account',
    });
    await anonymiseAudit(prisma, now);
    expect((await row(id)).actorName).toBe('Ana Pop');
  });

  it('ages an entry by its own time when its garage row no longer exists', async () => {
    const missing = randomUUID();
    const old = await data.entry({ at: auditOutside, garageId: missing });
    const young = await data.entry({ at: auditInside, garageId: missing });
    await anonymiseAudit(prisma, now);
    expect(await row(old)).toMatchObject(anonymisedShape);
    expect((await row(young)).actorName).toBe('Ana Pop');
  });

  it('still finds a deleted account after its own deletion entry was anonymised', async () => {
    const gone = await data.account('gone', ['driver'], { status: 'deleted' });
    await data.entry({
      at: auditOutside,
      kind: 'account_deleted',
      subjectId: gone,
      subjectType: 'account',
    });
    await anonymiseAudit(prisma, now);
    const late = await data.entry({
      at: now,
      subjectId: gone,
      subjectType: 'account',
    });
    expect(await anonymiseAudit(prisma, now)).toBe(1);
    expect(await row(late)).toMatchObject(anonymisedShape);
  });

  it('counts only the entries it changed when some are already anonymised', async () => {
    const done = await data.entry({ at: auditOutside });
    await anonymiseAudit(prisma, now);
    const fresh = await data.entry({ at: auditOutside });
    const before = await row(done);
    expect(await anonymiseAudit(prisma, now)).toBe(1);
    expect(await row(done)).toEqual(before);
    expect(await row(fresh)).toMatchObject(anonymisedShape);
    expect(await anonymiseAudit(prisma, now)).toBe(0);
  });

  it('anonymises more entries than one batch holds in a single run', async () => {
    const garage = await data.garage(auditOutside);
    const total = RETENTION_BATCH + 1;
    await prisma.activityLog.createMany({
      data: Array.from({ length: total }, () => ({
        action: 'update',
        actorName: 'Ana Pop',
        actorRole: 'driver',
        at: now,
        garageId: garage,
        subjectId: randomUUID(),
        subjectType: 'car',
        text: 'x',
      })),
    });
    expect(await anonymiseAudit(prisma, now)).toBe(total);
    expect(
      await prisma.activityLog.count({
        where: { garageId: garage, NOT: { actorName: ANONYMISED } },
      }),
    ).toBe(0);
    expect(await anonymiseAudit(prisma, now)).toBe(0);
  });

  it('writes no audit entry of its own', async () => {
    await data.entry({ at: auditOutside });
    const before = await prisma.activityLog.count();
    await anonymiseAudit(prisma, now);
    expect(await prisma.activityLog.count()).toBe(before);
  });
});

// @traces 1156-FR-006
describe('the legal documents sweep against a failing store', () => {
  const limit = RETENTION.legalDocuments.days;

  it('keeps the document whose page the store refuses, removes the rest, then fails', async () => {
    const garage = await data.garage(ago(now, limit, 1));
    const bad = await data.legalDocument(garage, 'valid', ['p/bad']);
    const good = await data.legalDocument(garage, 'refused', ['p/good']);
    const deleteObject = vi.fn(async (key: string) => {
      if (key === 'p/bad') throw new Error('store down');
    });
    await expect(
      sweepLegalDocuments({ prisma, storage: { deleteObject } }, now),
    ).rejects.toThrow();
    const left = (await prisma.legalDocument.findMany()).map((d) => d.id);
    expect(left).toEqual([bad]);
    expect(left).not.toContain(good);
  });

  it('keeps the documents of a garage closed exactly at the limit', async () => {
    const garage = await data.garage(ago(now, limit));
    await data.legalDocument(garage, 'valid', ['p/a']);
    const deleteObject = vi.fn(async () => undefined);
    expect(
      await sweepLegalDocuments({ prisma, storage: { deleteObject } }, now),
    ).toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('keeps the documents of a garage that is suspended but never closed', async () => {
    const garage = await data.garage(null);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garage },
    });
    await data.legalDocument(garage, 'valid', ['p/a']);
    const deleteObject = vi.fn(async () => undefined);
    expect(
      await sweepLegalDocuments({ prisma, storage: { deleteObject } }, now),
    ).toBe(0);
  });

  it('removes more documents than one batch holds, each page once', async () => {
    const garage = await data.garage(ago(now, limit, 1));
    const file = await prisma.verificationFile.create({
      data: { garageId: garage },
    });
    const total = RETENTION_BATCH + 1;
    await prisma.legalDocument.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        kind: `bulk-${i}`,
        pages: [`bulk/${i}`],
        status: 'valid',
        verificationFileId: file.id,
      })),
    });
    const deleteObject = vi.fn(async () => undefined);
    expect(
      await sweepLegalDocuments({ prisma, storage: { deleteObject } }, now),
    ).toBe(total);
    expect(deleteObject).toHaveBeenCalledTimes(total);
    expect(await prisma.legalDocument.count()).toBe(0);
  });
});

// @traces 1156-FR-005
describe('the notifications sweep at its edges', () => {
  const limit = RETENTION.notifications.days;
  const make = (accountId: string, createdAt: Date, read = false) =>
    prisma.notification.create({
      data: {
        accountId,
        channel: 'in_app',
        createdAt,
        eventId: randomUUID(),
        kind: 'quote_received',
        readAt: read ? now : null,
        status: 'sent',
      },
    });

  it('keeps a row created exactly at the limit', async () => {
    const ana = await data.account('ana');
    await make(ana, ago(now, limit));
    expect(await sweepNotifications(prisma, now)).toBe(0);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('never drives the stored unread count below zero when it was already lower than the rows lost', async () => {
    const ana = await data.account('ana');
    await make(ana, ago(now, limit, 1));
    await make(ana, ago(now, limit, 2));
    await prisma.account.update({
      data: { unreadCount: 0 },
      where: { id: ana },
    });
    await sweepNotifications(prisma, now);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: ana } }))
        .unreadCount,
    ).toBe(0);
  });

  it('removes more rows than one batch holds and keeps counts equal to the unread left', async () => {
    const ana = await data.account('ana');
    const total = RETENTION_BATCH + 1;
    await prisma.notification.createMany({
      data: Array.from({ length: total }, () => ({
        accountId: ana,
        channel: 'in_app' as const,
        createdAt: ago(now, limit, 1),
        eventId: randomUUID(),
        kind: 'quote_received',
        status: 'sent' as const,
      })),
    });
    const keep = await make(ana, ago(now, limit, -1));
    await prisma.account.update({
      data: { unreadCount: total + 1 },
      where: { id: ana },
    });
    expect(await sweepNotifications(prisma, now)).toBe(total);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: ana } }))
        .unreadCount,
    ).toBe(1);
    expect(
      await prisma.notification.findMany({ select: { id: true } }),
    ).toEqual([{ id: keep.id }]);
  });
});

// @traces 1156-FR-004
describe('the secrets sweep beyond one batch', () => {
  it('deletes more expired sign-in codes than one batch holds and leaves the live one', async () => {
    const total = RETENTION_BATCH + 1;
    await prisma.signInCode.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        codeHash: 'h',
        expiresAt: new Date(now.getTime() - 1),
        phone: `+4072${String(i).padStart(7, '0')}`,
      })),
    });
    await prisma.signInCode.create({
      data: {
        codeHash: 'h',
        expiresAt: new Date(now.getTime() + 1),
        phone: '+40729999999',
      },
    });
    expect(await sweepExpired(prisma, 'sign_in_code', now)).toBe(total);
    expect(await prisma.signInCode.count()).toBe(1);
    expect(await sweepExpired(prisma, 'sign_in_code', now)).toBe(0);
  });

  it('rejects a kind it does not sweep instead of answering zero', async () => {
    await expect(
      sweepExpired(prisma, 'bogus' as never, now),
    ).rejects.toBeDefined();
  });
});
