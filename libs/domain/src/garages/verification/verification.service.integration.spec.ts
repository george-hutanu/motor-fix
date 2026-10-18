import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException, Logger } from '@nestjs/common';

import { VerificationService } from './verification.service';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { type EventPort, outbox } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// @traces 207-FR-001 207-FR-002 207-FR-003 207-FR-004 207-FR-008 207-FR-010

const reader = countedMetrics();
const approvals = (outcome: string) =>
  counterTotal(reader, 'motorfix_garage_approvals_total', { outcome });
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
const CHECK_KINDS = [
  'company',
  'caen',
  'rar',
  'activities',
  'representative',
  'address',
  'photos',
  'documents',
] as const;
const DOCUMENT_KINDS = ['onrc_certificate', 'rar_authorisation'] as const;

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
  const checked = ['submitted', 'in_review', 'approved'].includes(status);
  return prisma.verificationFile.create({
    data: {
      // An admin's approval needs both registers checked, and a note unless
      // every other check is ok and both documents are held.
      ...(checked && {
        checks: { create: CHECK_KINDS.map((kind) => ({ kind, result: 'ok' })) },
        documents: {
          create: DOCUMENT_KINDS.map((kind) => ({ kind, pages: ['p1'] })),
        },
      }),
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
        : { note: REASON.note, outcome: to, reason: REASON.code },
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
        expect(body.message).toBe(
          `already decided by Ioana at ${file.decidedAt?.toISOString()}`,
        );
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
      first: true,
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
      first: false,
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

  // @traces 879-FR-009
  it.each([
    ['approved', { outcome: 'approved' as const }, 1],
    [
      'rejected',
      { note: REASON.note, outcome: 'rejected' as const, reason: REASON.code },
      1,
    ],
    [
      'more_requested',
      {
        note: REASON.note,
        outcome: 'more_requested' as const,
        reason: REASON.code,
      },
      0,
    ],
  ])(
    'counts a %s decision under its outcome only when it is a verdict',
    async (outcome, decision, times) => {
      const before = await approvals(outcome);
      const file = await fileIn('in_review');

      await inTx((tx) => service().decide(tx, ioana, file.id, decision));

      expect(await approvals(outcome)).toBe(before + times);
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
    expect(more.map((entry) => entry.field)).toEqual([
      'lastCheckedOn',
      'verificationMissing',
    ]);
    expect(garageEntry).toMatchObject({
      actorId: ioana.accountId,
      field: 'status',
      newValue: 'approved',
      oldValue: 'draft',
      subjectType: 'garage',
    });
    const [event] = await events(file.id);
    expect(event).toMatchObject({
      audience: [
        'admin',
        `garage:${garageId}`,
        `public:garage:${garageId}`,
        'public:search',
      ],
      kind: 'verification.decided',
      payload: { decision: 'approved', fileId: file.id, garageId },
    });
  });

  it.each(['rejected', 'more_requested'] as const)(
    'stores the reason of a %s decision in the file and the history',
    async (outcome) => {
      const file = await fileIn('submitted');

      await inTx((tx) =>
        service().decide(tx, ioana, file.id, {
          note: REASON.note,
          outcome,
          reason: REASON.code,
        }),
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
          note: REASON.note,
          outcome: 'rejected',
          reason: REASON.code,
        }),
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [lost] = results.filter((r) => r.status === 'rejected');
    const error = lost?.reason as HttpException;
    expect(error.getStatus()).toBe(409);
    expect((error.getResponse() as { message: string }).message).toMatch(
      /^already decided by (Ioana|Dan) at \d{4}-\d{2}-\d{2}T[\d:.]+Z$/,
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
        note: REASON.note,
        outcome: 'rejected',
        reason: REASON.code,
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
    expect(garageHistory.map((entry) => entry.field)).toEqual([
      'approvedAt',
      'lastCheckedOn',
      'verificationMissing',
    ]);
  });

  it('overwrites the reopener each time and keeps every reopening in the history', async () => {
    const file = await fileIn('rejected');
    await inTx((tx) => service().reopen(tx, ioana, file.id));
    await inTx((tx) =>
      service().decide(tx, ioana, file.id, {
        note: REASON.note,
        outcome: 'rejected',
        reason: REASON.code,
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

  // @traces 312-FR-008 312-FR-012
  it('records a report as the reason when the system reopens an approved file', async () => {
    const file = await fileIn('approved');

    await inTx((tx) => service().reopen(tx, SYSTEM, file.id, 'garage_report'));

    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(after).toMatchObject({
      reopenedBy: null,
      reopenReason: 'garage_report',
      status: 'in_review',
    });
    expect(after.reopenedAt).not.toBeNull();
    const reopening = (await history(file.id)).find(
      (e) => e.kind === 'verification_reopened',
    );
    expect(reopening).toMatchObject({
      actorRole: 'system',
      text: 'garage_report',
    });
    const [event] = (await events(file.id)).filter(
      (e) => e.kind === 'verification.reopened',
    );
    expect(event?.payload).toEqual({
      adminId: null,
      fileId: file.id,
      garageId,
      reason: 'garage_report',
    });
    expect(event?.audience).toEqual(['admin', `garage:${garageId}`]);
  });

  it('leaves the reason empty when an admin reopens', async () => {
    const file = await fileIn('approved');

    await inTx((tx) => service().reopen(tx, dan, file.id));

    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(after.reopenReason).toBeNull();
    const [event] = (await events(file.id)).filter(
      (e) => e.kind === 'verification.reopened',
    );
    expect(event?.payload).toEqual({
      adminId: dan.accountId,
      fileId: file.id,
      garageId,
    });
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

describe('counting the files waiting for an admin', () => {
  it('counts the submitted and in-review files and none of the decided ones', async () => {
    for (const status of STATUSES) {
      const garage = await prisma.garage.create({
        data: { name: `Service ${status}`, slug: `${status}-${randomUUID()}` },
      });
      await prisma.verificationFile.create({
        data: { garageId: garage.id, status },
      });
    }
    await prisma.verificationFile.create({
      data: { garageId, status: 'submitted' },
    });

    expect(await service().countWaiting(prisma)).toBe(3);
  });

  it('is zero when no file waits', async () => {
    await prisma.verificationFile.create({
      data: { garageId, status: 'approved' },
    });

    expect(await service().countWaiting(prisma)).toBe(0);
  });
});

describe('the checks of a file', () => {
  const KINDS = [
    'company',
    'caen',
    'rar',
    'activities',
    'representative',
    'address',
    'photos',
    'documents',
  ];
  const checksOf = (fileId: string) =>
    prisma.verificationCheck.findMany({
      orderBy: { kind: 'asc' },
      where: { fileId },
    });

  it('are created with the submission, one per kind, none run, none automatic', async () => {
    const file = await inTx((tx) => service().submit(tx, mihai, garageId));

    const checks = await checksOf(file.id);
    expect(checks.map((c) => c.kind)).toEqual(KINDS);
    for (const check of checks) {
      expect(check).toMatchObject({
        automatic: false,
        detail: null,
        recordedAt: null,
        recordedBy: null,
        result: 'not_run',
      });
    }
    expect(
      await prisma.activityLog.count({
        where: { garageId, subjectType: 'verification_check' },
      }),
    ).toBe(0);
  });

  it('keep their results, undoubled, when the file is sent again', async () => {
    const file = await inTx((tx) => service().submit(tx, mihai, garageId));
    await prisma.verificationCheck.update({
      data: { detail: 'găsită', recordedBy: ioana.accountId, result: 'ok' },
      where: { fileId_kind: { fileId: file.id, kind: 'rar' } },
    });
    await inTx((tx) => service().open(tx, ioana, file.id));
    await inTx((tx) =>
      service().decide(tx, ioana, file.id, {
        note: REASON.note,
        outcome: 'more_requested',
        reason: REASON.code,
      }),
    );

    await inTx((tx) => service().resend(tx, mihai, file.id));

    const checks = await checksOf(file.id);
    expect(checks.map((c) => c.kind)).toEqual(KINDS);
    expect(checks.find((c) => c.kind === 'rar')).toMatchObject({
      detail: 'găsită',
      result: 'ok',
    });
  });

  it('are created for a file that follows a rejected one, which keeps its own', async () => {
    const rejected = await fileIn('rejected');
    const file = await inTx((tx) => service().submit(tx, mihai, garageId));

    expect(await checksOf(file.id)).toHaveLength(8);
    expect(await checksOf(rejected.id)).toHaveLength(0);
  });

  it('are not left behind by a submission that fails', async () => {
    const failing: EventPort = {
      record: async () => {
        throw new Error('outbox down');
      },
    };
    await expect(
      inTx((tx) => service(false, failing).submit(tx, mihai, garageId)),
    ).rejects.toThrow('outbox down');
    expect(await prisma.verificationCheck.count()).toBe(0);
  });
});

describe('opening a file no longer waiting', () => {
  // @traces 302-FR-002
  it.each(['approved', 'rejected', 'more_requested'] as FileStatus[])(
    'answers a %s file unchanged, with no entry, no event and no 409',
    async (status) => {
      const file = await fileIn(status);

      const answer = await inTx((tx) => service().open(tx, dan, file.id));

      expect(answer).toEqual({
        byAnother: true,
        first: false,
        openedAt: file.openedAt,
        openedBy: ioana.accountId,
      });
      const after = await prisma.verificationFile.findUniqueOrThrow({
        where: { id: file.id },
      });
      expect(after).toEqual(file);
      expect(await history(file.id)).toHaveLength(0);
      expect(await events(file.id)).toHaveLength(0);
    },
  );
});

type Body = {
  outcome: 'approved' | 'more_requested' | 'rejected';
  reason?: string;
  note?: string;
  requestedItems?: string[];
};

// The decision as the endpoint's body hands it to the use case.
const decideWith = (actor: Actor | typeof SYSTEM, fileId: string, body: Body) =>
  inTx((tx) => service().decide(tx, actor, fileId, body as never));

const refusals = (reason: string) =>
  counterTotal(reader, 'motorfix_verification_decision_refusals_total', {
    reason,
  });
const reopenings = (role: string) =>
  counterTotal(reader, 'motorfix_verification_reopenings_total', { role });

const setCheck = (fileId: string, kind: string, result: string) =>
  prisma.verificationCheck.upsert({
    create: { fileId, kind: kind as never, result: result as never },
    update: { result: result as never },
    where: { fileId_kind: { fileId, kind: kind as never } },
  });

const fileRow = (id: string) =>
  prisma.verificationFile.findUniqueOrThrow({ where: { id } });

describe('the decision payload', () => {
  // @traces 306-FR-001 306-FR-012
  it('answers 422 reason_required to a rejection without a reason', async () => {
    const file = await fileIn('in_review');

    const refused = await refusal(
      decideWith(ioana, file.id, {
        note: 'Lipsește ONRC',
        outcome: 'rejected',
      }),
    );

    expect(refused).toMatchObject({
      body: {
        code: 'reason_required',
        errors: [{ code: 'required', field: 'reason' }],
      },
      status: 422,
    });
    expect(await history(file.id)).toHaveLength(0);
    expect(await events(file.id)).toHaveLength(0);
  });

  // @traces 306-FR-001 306-FR-012
  it.each([
    [
      'a rejection without a note',
      { outcome: 'rejected', reason: 'documents' },
    ],
    [
      'a rejection with a blank note',
      { note: '   ', outcome: 'rejected', reason: 'documents' },
    ],
    ['a request for more without a note', { outcome: 'more_requested' }],
    [
      'a request for more with a blank note',
      { note: ' \n ', outcome: 'more_requested' },
    ],
  ] as [string, Body][])(
    'answers 422 note_required to %s',
    async (_name, body) => {
      const file = await fileIn('in_review');

      const refused = await refusal(decideWith(ioana, file.id, body));

      expect(refused).toMatchObject({
        body: {
          code: 'note_required',
          errors: [{ code: 'required', field: 'note' }],
        },
        status: 422,
      });
      expect((await fileRow(file.id)).status).toBe('in_review');
      expect(await history(file.id)).toHaveLength(0);
    },
  );

  // @traces 306-FR-001 306-FR-012
  it.each([
    ['a reason with an approval', { outcome: 'approved', reason: 'documents' }],
    [
      'requested items with a rejection',
      {
        note: 'Lipsește ONRC',
        outcome: 'rejected',
        reason: 'documents',
        requestedItems: ['photos'],
      },
    ],
    [
      'requested items with an approval',
      { outcome: 'approved', requestedItems: ['photos'] },
    ],
  ] as [string, Body][])(
    'answers 400 validation_failed to %s',
    async (_name, body) => {
      const file = await fileIn('in_review');

      const refused = await refusal(decideWith(ioana, file.id, body));

      expect(refused).toMatchObject({
        body: { code: 'validation_failed' },
        status: 400,
      });
      expect((await fileRow(file.id)).status).toBe('in_review');
      expect(await history(file.id)).toHaveLength(0);
    },
  );

  // @traces 306-FR-001
  it('stores a blank approval note as null', async () => {
    const file = await fileIn('in_review');

    await decideWith(ioana, file.id, { note: '   ', outcome: 'approved' });

    expect(await fileRow(file.id)).toMatchObject({
      reasonNote: null,
      status: 'approved',
    });
  });
});

describe('recording a decision', () => {
  // @traces 306-FR-004 306-FR-012
  it('stores an approval with its note, no reason and no items', async () => {
    const file = await fileIn('in_review');

    await decideWith(ioana, file.id, {
      note: 'CAEN confirmat din ONRC',
      outcome: 'approved',
    });

    const after = await fileRow(file.id);
    expect(after).toMatchObject({
      decidedBy: ioana.accountId,
      reasonCode: null,
      reasonNote: 'CAEN confirmat din ONRC',
      requestedItems: [],
      status: 'approved',
    });
    expect(after.decidedAt).toBeInstanceOf(Date);
    const [event] = await events(file.id);
    expect(event?.payload).toMatchObject({
      decision: 'approved',
      fileId: file.id,
      garageId,
      note: 'CAEN confirmat din ONRC',
    });
  });

  // @traces 306-FR-004 306-FR-012
  it('stores a rejection with its reason and note, in the file, the history and the event', async () => {
    const file = await fileIn('in_review');

    await decideWith(ioana, file.id, {
      note: 'Lipsește certificatul ONRC.',
      outcome: 'rejected',
      reason: 'documents',
    });

    expect(await fileRow(file.id)).toMatchObject({
      decidedBy: ioana.accountId,
      reasonCode: 'documents',
      reasonNote: 'Lipsește certificatul ONRC.',
      requestedItems: [],
      status: 'rejected',
    });
    const [entry, ...more] = await history(file.id);
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      kind: 'verification_decided',
      newValue: 'rejected',
      oldValue: 'in_review',
      text: 'documents: Lipsește certificatul ONRC.',
    });
    const [event, ...others] = await events(file.id);
    expect(others).toHaveLength(0);
    expect(event).toMatchObject({
      kind: 'verification.decided',
      payload: {
        decision: 'rejected',
        fileId: file.id,
        garageId,
        note: 'Lipsește certificatul ONRC.',
        reason: 'documents',
      },
    });
  });

  // @traces 306-FR-004 306-FR-012
  it('stores the items of a request for more, its reason optional', async () => {
    const file = await fileIn('in_review');

    await decideWith(ioana, file.id, {
      note: 'Trimite pozele atelierului.',
      outcome: 'more_requested',
      requestedItems: ['photos', 'documents'],
    });

    expect(await fileRow(file.id)).toMatchObject({
      reasonCode: null,
      reasonNote: 'Trimite pozele atelierului.',
      requestedItems: ['photos', 'documents'],
      status: 'more_requested',
    });
    const [event] = await events(file.id);
    expect(event?.payload).toMatchObject({
      decision: 'more_requested',
      note: 'Trimite pozele atelierului.',
    });
  });

  // @traces 306-FR-004 306-FR-012
  it('keeps only the latest decision in the file', async () => {
    const file = await fileIn('in_review');
    await decideWith(ioana, file.id, {
      note: 'Trimite pozele.',
      outcome: 'more_requested',
      requestedItems: ['photos'],
    });
    await inTx((tx) => service().reopen(tx, dan, file.id));

    await decideWith(dan, file.id, {
      note: 'Adresa nu corespunde.',
      outcome: 'rejected',
      reason: 'address',
    });

    expect(await fileRow(file.id)).toMatchObject({
      decidedBy: dan.accountId,
      reasonCode: 'address',
      reasonNote: 'Adresa nu corespunde.',
      requestedItems: [],
      status: 'rejected',
    });
  });

  // @traces 306-FR-004 306-FR-012
  it('rolls the columns, the history and the event back together when the outbox fails', async () => {
    const file = await fileIn('in_review');
    const failing: EventPort = {
      record: () => Promise.reject(new Error('outbox down')),
    };

    await expect(
      inTx((tx) =>
        service(false, failing).decide(tx, ioana, file.id, {
          note: 'Lipsește ONRC',
          outcome: 'rejected',
          reason: 'documents',
        } as never),
      ),
    ).rejects.toThrow('outbox down');

    expect(await fileRow(file.id)).toMatchObject({
      decidedBy: null,
      reasonCode: null,
      reasonNote: null,
      requestedItems: [],
      status: 'in_review',
    });
    expect(await history(file.id)).toHaveLength(0);
    expect(await events(file.id)).toHaveLength(0);
  });
});

describe('a file already decided', () => {
  // @traces 306-FR-002 306-FR-011 306-FR-012
  it('answers 409 naming who decided it, when, and its status', async () => {
    const file = await fileIn('rejected', new Date('2026-10-17T09:14:00Z'));
    const before = await refusals('already_decided');

    const { body, status } = await refusal(
      decideWith(dan, file.id, { outcome: 'approved' }),
    );

    expect(status).toBe(409);
    expect(body).toMatchObject({
      code: 'verification_transition_refused',
      currentStatus: 'rejected',
      decidedAt: '2026-10-17T09:14:00.000Z',
      decidedBy: 'Ioana',
      entity: 'verification_file',
      message: 'already decided by Ioana at 2026-10-17T09:14:00.000Z',
    });
    expect(await refusals('already_decided')).toBe(before + 1);
    expect(await history(file.id)).toHaveLength(0);
  });

  // @traces 306-FR-002
  it('names MotorFix when the system decided it', async () => {
    const file = await fileIn('approved');
    await prisma.verificationFile.update({
      data: { decidedBy: null },
      where: { id: file.id },
    });

    const { body } = await refusal(
      decideWith(dan, file.id, {
        note: 'Lipsește ONRC',
        outcome: 'rejected',
        reason: 'documents',
      }),
    );

    expect(body).toMatchObject({
      currentStatus: 'approved',
      decidedBy: 'MotorFix',
    });
  });

  // @traces 306-FR-002 306-FR-012
  it('lets exactly one of two racing decisions commit, every time', async () => {
    for (let lap = 0; lap < 10; lap += 1) {
      const file = await prisma.verificationFile.create({
        data: {
          checks: {
            create: [
              { kind: 'rar', result: 'ok' },
              { kind: 'caen', result: 'ok' },
            ],
          },
          garageId,
          status: 'in_review',
        },
      });

      const results = await Promise.allSettled([
        // The documents are missing, so the approval carries its note and
        // loses only to the race.
        decideWith(ioana, file.id, {
          note: 'Acte văzute la sediu',
          outcome: 'approved',
        }),
        decideWith(dan, file.id, {
          note: 'Lipsește ONRC',
          outcome: 'rejected',
          reason: 'documents',
        }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected');
      const error = lost?.reason as HttpException;
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        code: 'verification_transition_refused',
      });
      expect(await history(file.id)).toHaveLength(1);
      expect(await events(file.id)).toHaveLength(1);
      await prisma.verificationFile.delete({ where: { id: file.id } });
    }
  });
});

describe('the approval gates', () => {
  // @traces 306-FR-003 306-FR-012
  it.each(['not_run', 'warning', 'failed'])(
    'refuses an approval while the rar check is %s, before looking at caen',
    async (result) => {
      const file = await fileIn('in_review');
      await setCheck(file.id, 'rar', result);
      await setCheck(file.id, 'caen', 'failed');
      const before = await refusals('rar_check_required');

      const refused = await refusal(
        decideWith(ioana, file.id, { outcome: 'approved' }),
      );

      expect(refused).toMatchObject({
        body: { code: 'rar_check_required' },
        status: 409,
      });
      expect(await refusals('rar_check_required')).toBe(before + 1);
      expect((await fileRow(file.id)).status).toBe('in_review');
      expect(await history(file.id)).toHaveLength(0);
      expect(await events(file.id)).toHaveLength(0);
      const garage = await prisma.garage.findUniqueOrThrow({
        where: { id: garageId },
      });
      expect(garage.status).toBe('draft');
    },
  );

  // @traces 306-FR-003 306-FR-012
  it.each(['not_run', 'warning', 'failed'])(
    'refuses an approval while the caen check is %s',
    async (result) => {
      const file = await fileIn('in_review');
      await setCheck(file.id, 'caen', result);
      const before = await refusals('caen_check_required');

      const refused = await refusal(
        decideWith(ioana, file.id, { outcome: 'approved' }),
      );

      expect(refused).toMatchObject({
        body: { code: 'caen_check_required' },
        status: 409,
      });
      expect(await refusals('caen_check_required')).toBe(before + 1);
      expect(await history(file.id)).toHaveLength(0);
      expect(await events(file.id)).toHaveLength(0);
    },
  );

  // @traces 306-FR-003
  it('refuses an approval of a file with no rar check at all', async () => {
    const file = await prisma.verificationFile.create({
      data: { garageId, status: 'in_review' },
    });

    const refused = await refusal(
      decideWith(ioana, file.id, { outcome: 'approved' }),
    );

    expect(refused.body.code).toBe('rar_check_required');
  });

  // @traces 306-FR-003 306-FR-012
  it('lets an approval through when caen was recorded ok from the ONRC record alone', async () => {
    const file = await fileIn('in_review');
    await prisma.verificationCheck.update({
      data: {
        evidence: { certificate: false, certificateUploaded: false },
        recordedBy: dan.accountId,
        result: 'ok',
      },
      where: { fileId_kind: { fileId: file.id, kind: 'caen' } },
    });

    await decideWith(ioana, file.id, { outcome: 'approved' });

    expect((await fileRow(file.id)).status).toBe('approved');
  });

  // @traces 306-FR-003 306-FR-012
  it('holds no gate against the system', async () => {
    const file = await prisma.verificationFile.create({
      data: { garageId, status: 'submitted' },
    });

    await decideWith(SYSTEM, file.id, { outcome: 'approved' });

    expect((await fileRow(file.id)).status).toBe('approved');
  });

  // @traces 306-FR-003
  it.each([
    ['rejected', { note: 'Lipsește ONRC', outcome: 'rejected', reason: 'rar' }],
    ['more_requested', { note: 'Trimite RAR', outcome: 'more_requested' }],
  ] as [string, Body][])(
    'does not hold a %s decision on the checks',
    async (status, body) => {
      const file = await fileIn('in_review');
      await setCheck(file.id, 'rar', 'failed');

      await decideWith(ioana, file.id, body);

      expect((await fileRow(file.id)).status).toBe(status);
    },
  );

  // @traces 306-FR-003
  it('waits for a rar result being recorded and judges the approval by it', async () => {
    const file = await fileIn('in_review');
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const recording = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM verification_file WHERE id = ${file.id}::uuid FOR SHARE`;
      await tx.verificationCheck.update({
        data: { result: 'failed' },
        where: { fileId_kind: { fileId: file.id, kind: 'rar' } },
      });
      locked();
      await held;
    });
    await lockTaken;

    const deciding = refusal(
      decideWith(ioana, file.id, { outcome: 'approved' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await recording;

    expect((await deciding).body.code).toBe('rar_check_required');
  });
});

describe('reopening a decided file', () => {
  // @traces 306-FR-005 306-FR-012
  it.each(['approved', 'rejected', 'more_requested'] as FileStatus[])(
    'reopens a %s file for an admin, keeping its decision and naming the admin in the event',
    async (status) => {
      const at = new Date('2026-10-10T08:00:00Z');
      const file = await fileIn(status, at);
      const before = await reopenings('admin');

      await inTx((tx) => service().reopen(tx, dan, file.id));

      const after = await fileRow(file.id);
      expect(after).toMatchObject({
        decidedAt: at,
        decidedBy: ioana.accountId,
        reasonCode: file.reasonCode,
        reasonNote: file.reasonNote,
        reopenedBy: dan.accountId,
        status: 'in_review',
      });
      expect(after.reopenedAt).toBeInstanceOf(Date);
      expect(after.submittedAt.getTime()).toBeGreaterThan(at.getTime());
      const [entry] = await history(file.id);
      expect(entry).toMatchObject({
        actorId: dan.accountId,
        kind: 'verification_reopened',
        newValue: 'in_review',
        oldValue: status,
      });
      const [event, ...more] = await events(file.id);
      expect(more).toHaveLength(0);
      expect(event).toMatchObject({
        kind: 'verification.reopened',
        payload: { adminId: dan.accountId, fileId: file.id, garageId },
      });
      expect(await reopenings('admin')).toBe(before + 1);
      expect(await prisma.notification.count()).toBe(0);
    },
  );

  // @traces 306-FR-005
  it('names no admin when the system reopens', async () => {
    const file = await fileIn('approved');
    const before = await reopenings('system');

    await inTx((tx) => service().reopen(tx, SYSTEM, file.id, 'garage_report'));

    const [event] = await events(file.id);
    expect(event?.payload).toEqual({
      adminId: null,
      fileId: file.id,
      garageId,
      reason: 'garage_report',
    });
    expect(await reopenings('system')).toBe(before + 1);
  });

  // @traces 306-FR-005 306-FR-012
  it.each(['submitted', 'in_review'] as FileStatus[])(
    'refuses to reopen a %s file',
    async (status) => {
      const file = await fileIn(status);

      const { body, status: code } = await refusal(
        inTx((tx) => service().reopen(tx, dan, file.id)),
      );

      expect(code).toBe(409);
      expect(body.code).toBe('verification_transition_refused');
      expect(await events(file.id)).toHaveLength(0);
    },
  );

  // @traces 306-FR-005 306-FR-012
  it('leaves a reopened approved garage public with its last approved details', async () => {
    const approvedAt = new Date('2026-10-01T08:00:00Z');
    const file = await fileIn('approved', approvedAt);

    await inTx((tx) => service().reopen(tx, dan, file.id));

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage).toMatchObject({
      approvedAt,
      name: 'Atelier Dinamo',
      status: 'approved',
    });
    expect(await history(garageId)).toHaveLength(0);
  });
});

// @traces 204-FR-001
// @traces 204-FR-005
describe('the RAR number of a file', () => {
  const submitted = (rarNumber?: string) =>
    inTx((tx) => service().submit(tx, mihai, garageId, rarNumber));
  const correct = (fileId: string, rarNumber: string, actor: Actor = ioana) =>
    inTx((tx) => service().correctRarNumber(tx, actor, fileId, rarNumber));
  const numberOf = async (id: string) =>
    (await prisma.verificationFile.findUniqueOrThrow({ where: { id } }))
      .rarNumber;
  const corrections = (id: string) =>
    prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: { field: 'rar_number', subjectId: id },
    });

  it('is stored normalised at submitting, and empty when none is given', async () => {
    const file = await submitted('  b 1234/2019 ');
    expect(await numberOf(file.id)).toBe('B 1234/2019');

    await prisma.verificationFile.update({
      data: { status: 'rejected' },
      where: { id: file.id },
    });
    const next = await submitted();
    expect(await numberOf(next.id)).toBeNull();
  });

  it('is kept when the file is sent again', async () => {
    const file = await submitted('B 1234/2019');
    await prisma.verificationFile.update({
      data: { status: 'more_requested' },
      where: { id: file.id },
    });

    await inTx((tx) => service().resend(tx, mihai, file.id));

    expect(await numberOf(file.id)).toBe('B 1234/2019');
  });

  it('is corrected by an admin, normalised, with one history entry and no event', async () => {
    const file = await submitted();
    const before = await prisma.outboxEvent.count();

    await correct(file.id, ' cj 221/2021 ');

    expect(await numberOf(file.id)).toBe('CJ 221/2021');
    const [entry, ...more] = await corrections(file.id);
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      action: 'update',
      actorId: ioana.accountId,
      actorRole: 'admin',
      field: 'rar_number',
      garageId,
      newValue: 'CJ 221/2021',
      oldValue: null,
      subjectType: 'verification_file',
    });
    expect(await prisma.outboxEvent.count()).toBe(before);
  });

  it('cuts a long number at 40 characters', async () => {
    const file = await submitted();

    await correct(file.id, 'B'.repeat(50));

    expect(await numberOf(file.id)).toBe('B'.repeat(40));
  });

  it('writes nothing when the normalised number is unchanged', async () => {
    const file = await submitted('B 1234/2019');

    await correct(file.id, 'b 1234/2019 ');

    expect(await corrections(file.id)).toHaveLength(0);
  });

  it.each([
    ['shorter than 3 characters', ' b1 '],
    ['holding a control character', 'B 12\u000734'],
  ])('refuses a number %s', async (_, rarNumber) => {
    const file = await submitted('B 1234/2019');

    const answer = await refusal(correct(file.id, rarNumber));

    expect(answer).toMatchObject({
      body: { code: 'validation_failed' },
      status: 400,
    });
    expect(await numberOf(file.id)).toBe('B 1234/2019');
  });

  it.each([
    ['shorter than 3 characters', ' b1 '],
    ['holding a control character', 'B 12\u000734'],
  ])(
    'refuses a submitted number %s, and opens no file',
    async (_, rarNumber) => {
      const answer = await refusal(submitted(rarNumber));

      expect(answer).toMatchObject({
        body: {
          code: 'validation_failed',
          errors: [{ code: 'invalid', field: 'rarNumber' }],
        },
        status: 400,
      });
      expect(await prisma.verificationFile.count({ where: { garageId } })).toBe(
        0,
      );
    },
  );

  // @traces 204-FR-015
  it('logs a correction once with the file and the admin, and nothing for the same number', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    try {
      const file = await submitted('B 1234/2019');

      await correct(file.id, 'b 1234/2019');
      expect(log).not.toHaveBeenCalled();

      await correct(file.id, 'CJ 221/2021');
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toContain(file.id);
      expect(log.mock.calls[0][0]).toContain(ioana.accountId);
    } finally {
      log.mockRestore();
    }
  });

  // @traces 204-FR-015
  it.each([
    ['a short number', 'submitted', ' ab ', 400],
    ['a decided file', 'approved', 'CJ 221/2021', 409],
    ['a non-admin', 'submitted', 'CJ 221/2021', 404],
  ] as const)(
    'logs nothing for a correction refused for %s',
    async (_, status, number, code) => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      try {
        const file = await fileIn(status);
        const by = code === 404 ? mihai : undefined;

        expect(await refusal(correct(file.id, number, by))).toMatchObject({
          status: code,
        });
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    },
  );

  it.each(['approved', 'rejected', 'more_requested'] as const)(
    'is refused with 409 on a file that is %s',
    async (status) => {
      const file = await fileIn(status);

      expect(await refusal(correct(file.id, 'B 1234/2019'))).toEqual({
        body: {
          code: 'verification_file_decided',
          message: 'Dosarul e deja decis',
        },
        status: 409,
      });
    },
  );

  it('is corrected while the file is in review', async () => {
    const file = await fileIn('in_review');

    await correct(file.id, 'B 1234/2019');

    expect(await numberOf(file.id)).toBe('B 1234/2019');
  });

  it('answers 404 to anyone but an admin, and for an unknown file', async () => {
    const file = await submitted();

    expect(await refusal(correct(file.id, 'B 1234/2019', mihai))).toMatchObject(
      { status: 404 },
    );
    expect(await refusal(correct(randomUUID(), 'B 1234/2019'))).toMatchObject({
      status: 404,
    });
  });

  it('leaves a recorded RAR check as it is', async () => {
    const file = await submitted('B 1234/2019');
    await prisma.verificationCheck.update({
      data: { detail: 'aceeași firmă și adresă', result: 'ok' },
      where: { fileId_kind: { fileId: file.id, kind: 'rar' } },
    });

    await correct(file.id, 'B 9999/2020');

    expect(
      await prisma.verificationCheck.findUniqueOrThrow({
        where: { fileId_kind: { fileId: file.id, kind: 'rar' } },
      }),
    ).toMatchObject({ detail: 'aceeași firmă și adresă', result: 'ok' });
  });

  it('serialises two racing corrections: each history entry starts from the other', async () => {
    const file = await submitted('B 1/2019');

    await Promise.all([
      correct(file.id, 'B 2/2019'),
      correct(file.id, 'B 3/2019', dan),
    ]);

    const [first, second] = await corrections(file.id);
    expect(second?.oldValue).toEqual(first?.newValue);
    expect(await numberOf(file.id)).toBe(second?.newValue);
  });
});

describe('the approval note', () => {
  // @traces 303-FR-003 303-FR-006 303-FR-010 303-FR-012
  const GUIDE = [
    'company',
    'activities',
    'representative',
    'address',
    'photos',
    'documents',
  ] as const;
  const guide = (fileId: string, kind: string, result: string) =>
    prisma.verificationCheck.update({
      data: { result: result as never },
      where: { fileId_kind: { fileId, kind: kind as never } },
    });
  const drop = (verificationFileId: string, kind: string) =>
    prisma.legalDocument.delete({
      where: { verificationFileId_kind: { kind, verificationFileId } },
    });
  const missingOn = async () =>
    (await history(garageId)).find(
      (entry) => entry.field === 'verificationMissing',
    );
  const approve = (
    actor: Actor | typeof SYSTEM,
    fileId: string,
    note?: string,
  ) =>
    decideWith(actor, fileId, {
      outcome: 'approved',
      ...(note !== undefined && { note }),
    });

  it('saves an approval with no note when every check is ok and both documents are held', async () => {
    const file = await fileIn('in_review');

    await approve(ioana, file.id);

    expect(await fileRow(file.id)).toMatchObject({
      reasonNote: null,
      status: 'approved',
    });
    expect(await missingOn()).toMatchObject({
      newValue: [],
      oldValue: null,
      subjectType: 'garage',
    });
  });

  describe.each(GUIDE)('a %s check', (kind) => {
    it.each(['not_run', 'warning', 'failed'])(
      'that is %s refuses an approval without a note, saying so',
      async (result) => {
        const file = await fileIn('in_review');
        await guide(file.id, kind, result);
        const before = await refusals('note_required');

        const refused = await refusal(approve(ioana, file.id));

        expect(refused).toMatchObject({
          body: {
            code: 'note_required',
            errors: [{ code: 'required', field: 'note' }],
            missing: [{ kind, result }],
          },
          status: 422,
        });
        expect(await refusals('note_required')).toBe(before + 1);
        expect((await fileRow(file.id)).status).toBe('in_review');
        expect(await history(file.id)).toHaveLength(0);
        expect(await history(garageId)).toHaveLength(0);
        expect(await events(file.id)).toHaveLength(0);
      },
    );

    it.each(['not_run', 'warning', 'failed'])(
      'that is %s lets an approval with a note through, recording what it passed over',
      async (result) => {
        const file = await fileIn('in_review');
        await guide(file.id, kind, result);

        await approve(ioana, file.id, 'Am sunat service-ul, e în regulă');

        expect(await fileRow(file.id)).toMatchObject({
          reasonNote: 'Am sunat service-ul, e în regulă',
          status: 'approved',
        });
        expect((await missingOn())?.newValue).toEqual([{ kind, result }]);
      },
    );
  });

  it('counts a guide check with no row at all as not run', async () => {
    const file = await fileIn('in_review');
    await prisma.verificationCheck.delete({
      where: { fileId_kind: { fileId: file.id, kind: 'photos' } },
    });

    const refused = await refusal(approve(ioana, file.id));

    expect(refused.body).toMatchObject({
      code: 'note_required',
      missing: [{ kind: 'photos', result: 'not_run' }],
    });
  });

  it.each(['onrc_certificate', 'rar_authorisation'])(
    'refuses an approval without a note while the %s is missing, and saves it with one',
    async (document) => {
      const file = await fileIn('in_review');
      await drop(file.id, document);

      const refused = await refusal(approve(ioana, file.id));
      expect(refused).toMatchObject({
        body: { code: 'note_required', missing: [{ document }] },
        status: 422,
      });

      await approve(ioana, file.id, 'Documentul vine prin e-mail');
      expect((await fileRow(file.id)).status).toBe('approved');
      expect((await missingOn())?.newValue).toEqual([{ document }]);
    },
  );

  it('lists the checks in the drawer order, then the documents in theirs', async () => {
    const file = await fileIn('in_review');
    await guide(file.id, 'photos', 'warning');
    await guide(file.id, 'company', 'failed');
    await drop(file.id, 'rar_authorisation');
    await drop(file.id, 'onrc_certificate');

    const refused = await refusal(approve(ioana, file.id));

    expect((refused.body as { missing?: unknown }).missing).toEqual([
      { kind: 'company', result: 'failed' },
      { kind: 'photos', result: 'warning' },
      { document: 'onrc_certificate' },
      { document: 'rar_authorisation' },
    ]);
  });

  it('takes a blank note for none', async () => {
    const file = await fileIn('in_review');
    await guide(file.id, 'address', 'warning');

    const refused = await refusal(approve(ioana, file.id, '   '));

    expect(refused.body.code).toBe('note_required');
  });

  // OD-29: caen recorded ok from the ONRC record, the certificate missing.
  it('asks a note of an approval whose caen passed without the certificate', async () => {
    const file = await fileIn('in_review');
    await prisma.verificationCheck.update({
      data: { evidence: { certificate: false, certificateUploaded: false } },
      where: { fileId_kind: { fileId: file.id, kind: 'caen' } },
    });
    await drop(file.id, 'onrc_certificate');

    const refused = await refusal(approve(ioana, file.id));
    expect(refused.body).toMatchObject({
      code: 'note_required',
      missing: [{ document: 'onrc_certificate' }],
    });

    await approve(ioana, file.id, 'CAEN confirmat din ONRC');
    expect((await fileRow(file.id)).status).toBe('approved');
  });

  it('judges the rar and caen gates first', async () => {
    const file = await fileIn('in_review');
    await guide(file.id, 'photos', 'failed');
    await setCheck(file.id, 'caen', 'warning');

    const refused = await refusal(approve(ioana, file.id));

    expect(refused).toMatchObject({
      body: { code: 'caen_check_required' },
      status: 409,
    });
  });

  it('answers a file decided already with who decided it, not with the note', async () => {
    const file = await fileIn('in_review');
    await guide(file.id, 'photos', 'failed');
    await approve(ioana, file.id, 'Poze vechi, dar e în regulă');

    const refused = await refusal(approve(dan, file.id));

    expect(refused).toMatchObject({
      body: { code: 'verification_transition_refused' },
      status: 409,
    });
  });

  it('asks nothing of the system, and still records what it passed over', async () => {
    const file = await prisma.verificationFile.create({
      data: { garageId, status: 'submitted' },
    });
    const before = await refusals('note_required');

    await approve(SYSTEM, file.id);

    expect((await fileRow(file.id)).status).toBe('approved');
    expect(await refusals('note_required')).toBe(before);
    expect((await missingOn())?.newValue).toEqual([
      ...GUIDE.map((kind) => ({ kind, result: 'not_run' })),
      { document: 'onrc_certificate' },
      { document: 'rar_authorisation' },
    ]);
  });

  it('logs one line per refusal, with the file and the reason', async () => {
    const file = await fileIn('in_review');
    await guide(file.id, 'photos', 'failed');
    const log = jest.spyOn(Logger.prototype, 'log');

    await refusal(approve(ioana, file.id));

    expect(
      log.mock.calls.filter(([line]) =>
        String(line).includes(`file ${file.id} refused: note_required`),
      ),
    ).toHaveLength(1);
    log.mockRestore();
  });
});

describe('the RAR test switch', () => {
  // @traces 303-FR-004 303-FR-012
  const rules = (testRules: boolean) =>
    new VerificationService(new AuditService(), outbox, {
      skipManualApproval: false,
      testRules,
    });
  const switchTo = (value: boolean) =>
    prisma.platformRule.upsert({
      create: { defaultValue: false, key: 'skip_rar_check', value },
      update: { value },
      where: { key: 'skip_rar_check' },
    });

  afterEach(() =>
    prisma.platformRule.deleteMany({ where: { key: 'skip_rar_check' } }),
  );

  it('lets an approval through without the rar check outside production', async () => {
    const file = await fileIn('in_review');
    await setCheck(file.id, 'rar', 'not_run');
    await switchTo(true);

    await inTx((tx) =>
      rules(true).decide(tx, ioana, file.id, { outcome: 'approved' }),
    );

    expect((await fileRow(file.id)).status).toBe('approved');
  });

  it('still holds the approval on the caen check', async () => {
    const file = await fileIn('in_review');
    await setCheck(file.id, 'rar', 'not_run');
    await setCheck(file.id, 'caen', 'not_run');
    await switchTo(true);

    const refused = await refusal(
      inTx((tx) =>
        rules(true).decide(tx, ioana, file.id, { outcome: 'approved' }),
      ),
    );

    expect(refused.body.code).toBe('caen_check_required');
  });

  it('holds the rar gate when the switch is off', async () => {
    const file = await fileIn('in_review');
    await setCheck(file.id, 'rar', 'failed');
    await switchTo(false);

    const refused = await refusal(
      inTx((tx) =>
        rules(true).decide(tx, ioana, file.id, { outcome: 'approved' }),
      ),
    );

    expect(refused.body.code).toBe('rar_check_required');
  });

  it('never reads the switch in production, so the rar gate stands', async () => {
    const file = await fileIn('in_review');
    await setCheck(file.id, 'rar', 'not_run');
    await switchTo(true);
    const read = jest.spyOn(prisma.platformRule, 'findUnique');

    const refused = await refusal(
      inTx((tx) =>
        rules(false).decide(tx, ioana, file.id, { outcome: 'approved' }),
      ),
    );

    expect(refused).toMatchObject({
      body: { code: 'rar_check_required' },
      status: 409,
    });
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });
});

describe('the last check date', () => {
  // @traces 303-FR-005 303-FR-012
  const lastCheckedOn = async () =>
    (await prisma.garage.findUniqueOrThrow({ where: { id: garageId } }))
      .lastCheckedOn;
  // Only Date is faked: the database and the timers keep real time.
  const at = (iso: string) =>
    jest
      .useFakeTimers({
        doNotFake: [
          'nextTick',
          'setImmediate',
          'clearImmediate',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'queueMicrotask',
          'hrtime',
          'performance',
        ],
      })
      .setSystemTime(new Date(iso));

  afterEach(() => jest.useRealTimers());

  it('is the Bucharest day of the approval: 23:30 UTC on a summer day is the next', async () => {
    const file = await fileIn('in_review');
    at('2026-07-15T23:30:00Z');

    await decideWith(ioana, file.id, { outcome: 'approved' });

    expect(await lastCheckedOn()).toEqual(new Date('2026-07-16T00:00:00Z'));
    const entry = (await history(garageId)).find(
      (e) => e.field === 'lastCheckedOn',
    );
    expect(entry).toMatchObject({ newValue: '2026-07-16', oldValue: null });
  });

  it('is written by the system approval too', async () => {
    const file = await fileIn('submitted');
    at('2026-11-10T10:00:00Z');

    await decideWith(SYSTEM, file.id, { outcome: 'approved' });

    expect(await lastCheckedOn()).toEqual(new Date('2026-11-10T00:00:00Z'));
  });

  it('moves to the approval of a reopened file, the garage staying approved', async () => {
    const file = await fileIn('in_review');
    at('2026-10-01T08:00:00Z');
    await decideWith(ioana, file.id, { outcome: 'approved' });
    at('2026-10-20T08:00:00Z');
    await inTx((tx) => service().reopen(tx, dan, file.id));

    await decideWith(dan, file.id, { outcome: 'approved' });

    expect(await lastCheckedOn()).toEqual(new Date('2026-10-20T00:00:00Z'));
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('approved');
    const moves = (await history(garageId)).filter(
      (e) => e.field === 'lastCheckedOn',
    );
    expect(moves.map((e) => [e.oldValue, e.newValue])).toEqual([
      [null, '2026-10-01'],
      ['2026-10-01', '2026-10-20'],
    ]);
  });

  it('is left alone by a decision that is not an approval', async () => {
    const file = await fileIn('in_review');

    await decideWith(ioana, file.id, {
      note: REASON.note,
      outcome: 'rejected',
      reason: REASON.code,
    });

    expect(await lastCheckedOn()).toBeNull();
  });
});
