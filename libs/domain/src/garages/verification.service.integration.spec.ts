import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { VerificationService } from './verification.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/policy';
import { serialDatabase } from '../auth/serial-db.testing';
import { type EventPort, outbox } from '../events/event.port';
import type { Prisma } from '../generated/prisma/client';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

// @traces 207-FR-001 207-FR-002 207-FR-003 207-FR-004 207-FR-008 207-FR-010

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

type FileStatus =
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'more_requested'
  | 'rejected';
const STATUSES: FileStatus[] = [
  'submitted',
  'in_review',
  'approved',
  'more_requested',
  'rejected',
];
const REASON = { code: 'documents_unreadable', note: 'The CUI is blurred' };
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const SYSTEM = { accountId: null, role: 'system' } as const;

const service = (skipManualApproval = false, events: EventPort = outbox) =>
  new VerificationService(new AuditService(), events, { skipManualApproval });

const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(fn);

const person = (
  accountId: string,
  role: Actor['role'],
  garageId: string | null = null,
): Actor => ({ accountId, garageId, permissions: NONE, role, roles: [role] });

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        body: error.getResponse() as { code?: string; message?: string },
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

const history = (subjectId: string) =>
  prisma.activityLog.findMany({ orderBy: { at: 'asc' }, where: { subjectId } });
const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({
    orderBy: { createdAt: 'asc' },
    where: { subjectId },
  });

let ioana: Actor;
let dan: Actor;
let mihai: Actor;
let garageId: string;

beforeEach(async () => {
  await reset();
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  garageId = garage.id;
  ioana = person(await account('Ioana Popa', ['admin']), 'admin');
  dan = person(await account('Dan Ene', ['admin']), 'admin');
  mihai = person(await account('Mihai', ['garage']), 'garage', garageId);
  await prisma.garageMember.create({
    data: { accountId: mihai.accountId, garageId, role: 'owner' },
  });
});

afterAll(() => prisma.$disconnect());

// A file already in `status`, set by Ioana where the status has an author.
async function fileIn(status: FileStatus, at = new Date()) {
  if (status === 'approved') {
    await prisma.garage.update({
      data: { approvedAt: at, status: 'approved' },
      where: { id: garageId },
    });
  }
  const opened = status !== 'submitted';
  const decided = ['approved', 'more_requested', 'rejected'].includes(status);
  const negative = status === 'more_requested' || status === 'rejected';
  return prisma.verificationFile.create({
    data: {
      createdAt: at,
      decidedAt: decided ? at : null,
      decidedBy: decided ? ioana.accountId : null,
      garageId,
      openedAt: opened ? at : null,
      openedBy: opened ? ioana.accountId : null,
      reasonCode: negative ? REASON.code : null,
      reasonNote: negative ? REASON.note : null,
      status,
    },
  });
}

// The use case a caller would run to move a file from `from` to `to`.
function attempt(from: FileStatus, to: FileStatus, fileId: string) {
  const verification = service();
  return inTx<unknown>((tx) => {
    if (to === 'in_review') {
      return from === 'submitted' || from === 'in_review'
        ? verification.open(tx, dan, fileId)
        : verification.reopen(tx, dan, fileId);
    }
    if (to === 'submitted') return verification.resend(tx, mihai, fileId);
    return verification.decide(
      tx,
      dan,
      fileId,
      to === 'approved'
        ? { outcome: 'approved' }
        : { outcome: to, reason: REASON },
    );
  });
}

const ALLOWED: [FileStatus, FileStatus][] = [
  ['submitted', 'in_review'],
  ['submitted', 'approved'],
  ['submitted', 'more_requested'],
  ['submitted', 'rejected'],
  ['in_review', 'approved'],
  ['in_review', 'more_requested'],
  ['in_review', 'rejected'],
  ['more_requested', 'submitted'],
  ['approved', 'in_review'],
  ['rejected', 'in_review'],
  ['more_requested', 'in_review'],
];
const isAllowed = (from: FileStatus, to: FileStatus) =>
  ALLOWED.some(([f, t]) => f === from && t === to);
const REFUSED = STATUSES.flatMap((from) =>
  STATUSES.map((to) => [from, to] as [FileStatus, FileStatus]),
).filter(
  ([from, to]) =>
    !isAllowed(from, to) && !(from === 'in_review' && to === 'in_review'),
);

const KIND: Record<string, string> = {
  approved: 'verification.decided',
  in_review: 'verification.opened',
  more_requested: 'verification.decided',
  rejected: 'verification.decided',
  submitted: 'verification.submitted',
};

describe('the allowed transitions', () => {
  it('are eleven, and the other pairs but the second open are thirteen', () => {
    expect(ALLOWED).toHaveLength(11);
    expect(REFUSED).toHaveLength(13);
  });

  it.each(ALLOWED)(
    'moves a %s file to %s with one history entry and one event',
    async (from, to) => {
      const file = await fileIn(from);

      await attempt(from, to, file.id);

      const after = await prisma.verificationFile.findUniqueOrThrow({
        where: { id: file.id },
      });
      expect(after.status).toBe(to);
      const entries = await history(file.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        field: 'status',
        newValue: to,
        oldValue: from,
        subjectType: 'verification_file',
      });
      const rows = await events(file.id);
      expect(rows).toHaveLength(1);
      const reopened = to === 'in_review' && from !== 'submitted';
      expect(rows[0]?.kind).toBe(reopened ? 'verification.reopened' : KIND[to]);
      expect(rows[0]?.payload).toMatchObject({ fileId: file.id, garageId });
      expect(rows[0]?.audience).toEqual(
        expect.arrayContaining(['admin', `garage:${garageId}`]),
      );
    },
  );

  it.each(REFUSED)(
    'refuses to move a %s file to %s, naming its status and who set it',
    async (from, to) => {
      const file = await fileIn(from);

      const { body, status } = await refusal(attempt(from, to, file.id));

      expect(status).toBe(409);
      expect(body.code).toBe('verification_transition_refused');
      if (from === 'submitted') {
        expect(body.message).toBe('already sent, waiting for review');
      } else if (from === 'in_review') {
        expect(body.message).toBe('already under review, opened by Ioana');
      } else {
        expect(body.message).toBe(`already decided by Ioana (${from})`);
      }
      const after = await prisma.verificationFile.findUniqueOrThrow({
        where: { id: file.id },
      });
      expect(after.status).toBe(from);
      expect(await history(file.id)).toHaveLength(0);
      expect(await events(file.id)).toHaveLength(0);
    },
  );
});

describe('submitting', () => {
  it('creates a submitted file for a garage without one and announces it', async () => {
    const file = await inTx((tx) => service().submit(tx, mihai, garageId));

    expect(file).toMatchObject({
      garageId,
      previousFileId: null,
      status: 'submitted',
    });
    const [entry, ...more] = await history(file.id);
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      action: 'create',
      actorId: mihai.accountId,
      actorRole: 'owner',
      subjectType: 'verification_file',
    });
    const [event] = await events(file.id);
    expect(event).toMatchObject({
      audience: ['admin', `garage:${garageId}`],
      kind: 'verification.submitted',
      payload: { fileId: file.id, garageId },
    });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('draft');
  });

  it('links a new file to the rejected one it follows, and keeps the garage hidden', async () => {
    const rejected = await fileIn('rejected');

    const file = await inTx((tx) => service().submit(tx, mihai, garageId));

    expect(file).toMatchObject({
      previousFileId: rejected.id,
      status: 'submitted',
    });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('draft');
  });

  it.each(['submitted', 'in_review', 'more_requested', 'approved'] as const)(
    'refuses a new file while the newest one is %s',
    async (status) => {
      await fileIn(status);

      const { body, status: code } = await refusal(
        inTx((tx) => service().submit(tx, mihai, garageId)),
      );

      expect(code).toBe(409);
      expect(body.code).toBe('verification_transition_refused');
      expect(await prisma.verificationFile.count({ where: { garageId } })).toBe(
        1,
      );
    },
  );

  it('keeps one file when two submissions race', async () => {
    const results = await Promise.allSettled([
      inTx((tx) => service().submit(tx, mihai, garageId)),
      inTx((tx) => service().submit(tx, mihai, garageId)),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected && (rejected.reason as HttpException).getStatus()).toBe(
      409,
    );
    expect(await prisma.verificationFile.count({ where: { garageId } })).toBe(
      1,
    );
  });
});

describe('opening', () => {
  it("records the first admin's open", async () => {
    const file = await fileIn('submitted');

    const opened = await inTx((tx) => service().open(tx, ioana, file.id));

    expect(opened).toMatchObject({
      byAnother: false,
      openedBy: ioana.accountId,
    });
    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(after).toMatchObject({
      openedBy: ioana.accountId,
      status: 'in_review',
    });
    expect(after.openedAt).toEqual(opened.openedAt);
  });

  it('lets a second admin open the file unchanged and says who opened it first', async () => {
    const file = await fileIn('submitted');
    const first = await inTx((tx) => service().open(tx, ioana, file.id));

    const second = await inTx((tx) => service().open(tx, dan, file.id));

    expect(second).toEqual({
      byAnother: true,
      openedAt: first.openedAt,
      openedBy: ioana.accountId,
    });
    expect(await history(file.id)).toHaveLength(1);
    expect(await events(file.id)).toHaveLength(1);
  });

  it('lets two racing opens both succeed, the second answering with the first', async () => {
    const file = await fileIn('submitted');

    const results = await Promise.all([
      inTx((tx) => service().open(tx, ioana, file.id)),
      inTx((tx) => service().open(tx, dan, file.id)),
    ]);

    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    for (const result of results) {
      expect(result.openedBy).toBe(after.openedBy);
      expect(result.openedAt).toEqual(after.openedAt);
    }
    expect(results.filter((r) => r.byAnother)).toHaveLength(1);
    expect(await history(file.id)).toHaveLength(1);
    expect(await events(file.id)).toHaveLength(1);
  });
});

describe('deciding', () => {
  it('refuses to approve a file of a suspended garage and leaves it suspended', async () => {
    const file = await fileIn('in_review');
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garageId },
    });

    const refused = await refusal(
      inTx((tx) =>
        service().decide(tx, ioana, file.id, { outcome: 'approved' }),
      ),
    );

    expect(refused.status).toBe(409);
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('suspended');
    expect(await history(file.id)).toHaveLength(0);
  });

  it.each([
    ['an empty code', { code: '', note: 'The CUI is blurred' }],
    ['a blank note', { code: 'documents_unreadable', note: '   ' }],
  ])(
    'refuses a decision with %s as 400 validation_failed',
    async (_n, reason) => {
      const file = await fileIn('in_review');

      const refused = await refusal(
        inTx((tx) =>
          service().decide(tx, ioana, file.id, { outcome: 'rejected', reason }),
        ),
      );

      expect(refused).toMatchObject({
        body: { code: 'validation_failed' },
        status: 400,
      });
      expect(await history(file.id)).toHaveLength(0);
    },
  );

  it('approves the garage with the file, in the same transaction', async () => {
    const file = await fileIn('in_review');

    await inTx((tx) =>
      service().decide(tx, ioana, file.id, { outcome: 'approved' }),
    );

    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(after).toMatchObject({
      decidedBy: ioana.accountId,
      status: 'approved',
    });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('approved');
    expect(garage.approvedAt).toEqual(after.decidedAt);
    const [garageEntry, ...more] = await history(garageId);
    expect(more).toHaveLength(0);
    expect(garageEntry).toMatchObject({
      actorId: ioana.accountId,
      field: 'status',
      newValue: 'approved',
      oldValue: 'draft',
      subjectType: 'garage',
    });
    const [event] = await events(file.id);
    expect(event).toMatchObject({
      audience: ['admin', `garage:${garageId}`, `public:garage:${garageId}`],
      kind: 'verification.decided',
      payload: { decision: 'approved', fileId: file.id, garageId },
    });
  });

  it.each(['rejected', 'more_requested'] as const)(
    'stores the reason of a %s decision in the file and the history',
    async (outcome) => {
      const file = await fileIn('submitted');

      await inTx((tx) =>
        service().decide(tx, ioana, file.id, { outcome, reason: REASON }),
      );

      const after = await prisma.verificationFile.findUniqueOrThrow({
        where: { id: file.id },
      });
      expect(after).toMatchObject({
        decidedBy: ioana.accountId,
        reasonCode: REASON.code,
        reasonNote: REASON.note,
        status: outcome,
      });
      const [entry] = await history(file.id);
      expect(entry).toMatchObject({
        actorName: 'Ioana',
        actorRole: 'admin',
        kind: 'verification_decided',
        text: `${REASON.code}: ${REASON.note}`,
      });
      const garage = await prisma.garage.findUniqueOrThrow({
        where: { id: garageId },
      });
      expect(garage.status).toBe('draft');
      const [event] = await events(file.id);
      expect(event?.audience).toEqual(['admin', `garage:${garageId}`]);
    },
  );

  it('lets one of two racing decisions commit and refuses the other', async () => {
    const file = await fileIn('in_review');

    const results = await Promise.allSettled([
      inTx((tx) =>
        service().decide(tx, ioana, file.id, { outcome: 'approved' }),
      ),
      inTx((tx) =>
        service().decide(tx, dan, file.id, {
          outcome: 'rejected',
          reason: REASON,
        }),
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [lost] = results.filter((r) => r.status === 'rejected');
    const error = lost?.reason as HttpException;
    expect(error.getStatus()).toBe(409);
    expect((error.getResponse() as { message: string }).message).toMatch(
      /^already decided by (Ioana|Dan) \((approved|rejected)\)$/,
    );
    expect(await history(file.id)).toHaveLength(1);
    expect(await events(file.id)).toHaveLength(1);
  });

  it('accepts the system as the one who decides', async () => {
    const file = await fileIn('submitted');

    await inTx((tx) =>
      service().decide(tx, SYSTEM, file.id, { outcome: 'approved' }),
    );

    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(after).toMatchObject({ decidedBy: null, status: 'approved' });
    const [entry] = await history(file.id);
    expect(entry).toMatchObject({ actorName: 'MotorFix', actorRole: 'system' });
  });
});

describe('reopening', () => {
  it('keeps an approved garage public through a reopened file and its rejection', async () => {
    const approvedAt = new Date('2026-10-01T08:00:00Z');
    const file = await fileIn('approved', approvedAt);

    await inTx((tx) => service().reopen(tx, dan, file.id));
    const reopened = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(reopened).toMatchObject({
      reopenedBy: dan.accountId,
      status: 'in_review',
    });
    await inTx((tx) =>
      service().decide(tx, dan, file.id, {
        outcome: 'rejected',
        reason: REASON,
      }),
    );

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage).toMatchObject({ approvedAt, status: 'approved' });
    expect(await history(garageId)).toHaveLength(0);
  });

  it('moves approved_at to the approval of a reopened file', async () => {
    const file = await fileIn('approved', new Date('2026-10-01T08:00:00Z'));
    await inTx((tx) => service().reopen(tx, dan, file.id));

    await inTx((tx) =>
      service().decide(tx, dan, file.id, { outcome: 'approved' }),
    );

    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('approved');
    expect(garage.approvedAt).toEqual(after.decidedAt);
    const garageHistory = await history(garageId);
    expect(garageHistory.map((entry) => entry.field)).toEqual(['approvedAt']);
  });

  it('overwrites the reopener each time and keeps every reopening in the history', async () => {
    const file = await fileIn('rejected');
    await inTx((tx) => service().reopen(tx, ioana, file.id));
    await inTx((tx) =>
      service().decide(tx, ioana, file.id, {
        outcome: 'rejected',
        reason: REASON,
      }),
    );

    await inTx((tx) => service().reopen(tx, dan, file.id));

    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(after.reopenedBy).toBe(dan.accountId);
    const reopenings = (await history(file.id)).filter(
      (e) => e.kind === 'verification_reopened',
    );
    expect(reopenings.map((e) => e.actorId)).toEqual([
      ioana.accountId,
      dan.accountId,
    ]);
  });

  it('refuses to reopen a file that is not the newest', async () => {
    const older = await fileIn('rejected', new Date('2026-10-01T08:00:00Z'));
    await fileIn('rejected', new Date('2026-10-02T08:00:00Z'));

    const { body, status } = await refusal(
      inTx((tx) => service().reopen(tx, dan, older.id)),
    );

    expect(status).toBe(409);
    expect(body.code).toBe('verification_transition_refused');
  });

  it('refuses to reopen while another file of the garage is live', async () => {
    const older = await fileIn('rejected', new Date('2026-10-01T08:00:00Z'));
    await prisma.verificationFile.create({
      data: {
        createdAt: new Date('2026-09-30T08:00:00Z'),
        garageId,
        status: 'submitted',
      },
    });

    const { status } = await refusal(
      inTx((tx) => service().reopen(tx, dan, older.id)),
    );

    expect(status).toBe(409);
    expect(
      (
        await prisma.verificationFile.findUniqueOrThrow({
          where: { id: older.id },
        })
      ).status,
    ).toBe('rejected');
  });
});

describe('who may act', () => {
  it.each(['garage', 'driver', 'receptionist'] as const)(
    'answers 404 to a %s opening, deciding or reopening',
    async (role) => {
      const outsider = person(
        await account(`x-${role}`, [role]),
        role,
        garageId,
      );
      const submitted = await fileIn('submitted');
      const verification = service();

      const calls = [
        inTx((tx) => verification.open(tx, outsider, submitted.id)),
        inTx((tx) =>
          verification.decide(tx, outsider, submitted.id, {
            outcome: 'approved',
          }),
        ),
        inTx((tx) => verification.reopen(tx, outsider, submitted.id)),
      ];

      for (const call of calls) {
        expect((await refusal(call)).status).toBe(404);
      }
      expect(
        (
          await prisma.verificationFile.findUniqueOrThrow({
            where: { id: submitted.id },
          })
        ).status,
      ).toBe('submitted');
    },
  );
});

describe('a failed write', () => {
  it('leaves no transition, no history and no event behind', async () => {
    const file = await fileIn('in_review');
    const failing: EventPort = {
      record: () => Promise.reject(new Error('outbox down')),
    };

    await expect(
      inTx((tx) =>
        service(false, failing).decide(tx, ioana, file.id, {
          outcome: 'approved',
        }),
      ),
    ).rejects.toThrow('outbox down');

    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(after.status).toBe('in_review');
    expect(await history(file.id)).toHaveLength(0);
    expect(await history(garageId)).toHaveLength(0);
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('draft');
  });
});

describe('the test switch', () => {
  it('approves a submission at once as MotorFix, with both transitions recorded', async () => {
    const file = await inTx((tx) => service(true).submit(tx, mihai, garageId));

    expect(file).toMatchObject({ decidedBy: null, status: 'approved' });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('approved');
    const entries = await history(file.id);
    expect(entries.map((e) => [e.action, e.actorName])).toEqual([
      ['create', 'Mihai'],
      ['update', 'MotorFix'],
    ]);
    expect((await events(file.id)).map((e) => e.kind)).toEqual([
      'verification.submitted',
      'verification.decided',
    ]);
  });

  it('leaves a submission waiting when the switch is off', async () => {
    const file = await inTx((tx) => service(false).submit(tx, mihai, garageId));

    expect(file.status).toBe('submitted');
  });
});
