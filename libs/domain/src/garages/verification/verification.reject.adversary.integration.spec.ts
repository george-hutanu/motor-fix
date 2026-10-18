import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException } from '@nestjs/common';

import { VerificationService } from './verification.service';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// @traces 305-FR-003 305-FR-004 305-FR-009 305-FR-011

const reader = countedMetrics();
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const CHECKS = [
  'company',
  'caen',
  'rar',
  'activities',
  'representative',
  'address',
  'photos',
  'documents',
] as const;
const GOOD = 'Autorizația RAR a expirat.';

const service = () =>
  new VerificationService(new AuditService(), outbox, {
    skipManualApproval: false,
  });
const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(fn);
const person = (
  accountId: string,
  role: Actor['role'],
  garageId: string | null = null,
): Actor => ({ accountId, garageId, permissions: NONE, role, roles: [role] });

const reject = (actor: Actor, fileId: string, body: object) =>
  inTx((tx) =>
    service().decide(tx, actor, fileId, { outcome: 'rejected', ...body }),
  );

async function refused(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        body: error.getResponse() as { code?: string },
        status: error.getStatus(),
      };
    }
    throw error;
  }
  return { body: {} as { code?: string }, status: 200 };
}

const refusals = (reason: string) =>
  counterTotal(reader, 'motorfix_verification_decision_refusals_total', {
    reason,
  });
const rejections = (reason: string) =>
  counterTotal(reader, 'motorfix_verification_rejections_total', { reason });
const row = (id: string) =>
  prisma.verificationFile.findUniqueOrThrow({ where: { id } });
const audit = (id: string) =>
  prisma.activityLog.findMany({ where: { subjectId: id } });
const outboxOf = (id: string) =>
  prisma.outboxEvent.findMany({ where: { subjectId: id } });

let admin: Actor;
let other: Actor;
let garageId: string;

beforeEach(async () => {
  await reset();
  const garage = await prisma.garage.create({
    data: { name: 'Atelier', slug: `a-${randomUUID()}` },
  });
  garageId = garage.id;
  admin = person(await account('Ioana Popa', ['admin']), 'admin');
  other = person(await account('Dan Ene', ['admin']), 'admin');
});

afterAll(() => prisma.$disconnect());

const fileIn = (status: 'submitted' | 'in_review' | 'more_requested') =>
  prisma.verificationFile.create({
    data: {
      checks: { create: CHECKS.map((kind) => ({ kind, result: 'ok' })) },
      decidedAt: status === 'more_requested' ? new Date() : null,
      decidedBy: status === 'more_requested' ? admin.accountId : null,
      garageId,
      reasonNote: status === 'more_requested' ? 'Poze' : null,
      status,
    },
  });

describe('a rejection offered hostile input', () => {
  it.each([
    ['an empty string', ''],
    ['null', null],
  ])(
    'answers 422 reason_required for %s as the reason',
    async (_name, reason) => {
      const file = await fileIn('in_review');

      const { body, status } = await refused(
        reject(admin, file.id, { note: GOOD, reason }),
      );

      expect({ code: body.code, status }).toEqual({
        code: 'reason_required',
        status: 422,
      });
    },
  );

  it.each([
    ['no note key', {}],
    ['a null note', { note: null }],
    ['tabs and newlines', { note: '\t\n \r\n\t' }],
    ['no-break spaces', { note: '   ' }],
  ])('answers 422 note_required for %s', async (_name, extra) => {
    const file = await fileIn('in_review');

    const { body, status } = await refused(
      reject(admin, file.id, { reason: 'rar', ...extra }),
    );

    expect({ code: body.code, status }).toEqual({
      code: 'note_required',
      status: 422,
    });
    expect((await row(file.id)).status).toBe('in_review');
  });

  it('counts a note of astral characters by code points, not UTF-16 units', async () => {
    const file = await fileIn('in_review');

    const { body, status } = await refused(
      reject(admin, file.id, { note: '🚗'.repeat(5), reason: 'rar' }),
    );

    expect({ code: body.code, status }).toEqual({
      code: 'note_too_short',
      status: 422,
    });
  });

  it('keeps a combining sequence apart: nine base letters with an accent are still nine plus marks', async () => {
    const file = await fileIn('in_review');
    const note = 'é'.repeat(5);

    await reject(admin, file.id, { note, reason: 'rar' });

    expect((await row(file.id)).reasonNote).toBe(note);
  });

  it('accepts a note of exactly 1,000 code points with padding that trims away', async () => {
    const file = await fileIn('in_review');
    const note = 'a'.repeat(1000);

    await reject(admin, file.id, { note: `  ${note}\n`, reason: 'other' });

    expect((await row(file.id)).reasonNote).toBe(note);
  });

  it('trims inside the count: ten characters of which only nine are not padding is too short', async () => {
    const file = await fileIn('in_review');

    const { body } = await refused(
      reject(admin, file.id, { note: '\nabcdefghi', reason: 'other' }),
    );

    expect(body.code).toBe('note_too_short');
  });

  it('stores a note holding markup and quotes exactly as written', async () => {
    const file = await fileIn('in_review');
    const note = `<script>alert("x")</script> '; DROP TABLE x;--`;

    await reject(admin, file.id, { note, reason: 'other' });

    expect((await row(file.id)).reasonNote).toBe(note);
  });

  it('refuses a refused rejection without counting a stored one', async () => {
    const file = await fileIn('in_review');
    const before = await rejections('rar');

    await refused(reject(admin, file.id, { note: 'scurt', reason: 'rar' }));

    expect(await rejections('rar')).toBe(before);
  });

  it('does not count a refusal when the rejection is stored', async () => {
    const file = await fileIn('in_review');
    const before = {
      reason: await refusals('reason_required'),
      required: await refusals('note_required'),
      short: await refusals('note_too_short'),
    };

    await reject(admin, file.id, { note: GOOD, reason: 'rar' });

    expect({
      reason: await refusals('reason_required'),
      required: await refusals('note_required'),
      short: await refusals('note_too_short'),
    }).toEqual(before);
  });
});

describe('a rejection against file state', () => {
  it('rejects a file nobody opened yet', async () => {
    const file = await fileIn('submitted');

    await reject(admin, file.id, { note: GOOD, reason: 'photos' });

    expect(await row(file.id)).toMatchObject({
      decidedBy: admin.accountId,
      reasonCode: 'photos',
      status: 'rejected',
    });
  });

  it('answers 409 to a rejection of a file asked for more, its note kept', async () => {
    const file = await fileIn('more_requested');

    const { body, status } = await refused(
      reject(other, file.id, { note: GOOD, reason: 'rar' }),
    );

    expect({ code: body.code, status }).toEqual({
      code: 'verification_transition_refused',
      status: 409,
    });
    expect(await row(file.id)).toMatchObject({
      reasonNote: 'Poze',
      status: 'more_requested',
    });
  });

  it('answers 404 to an unknown id and to one that is not a uuid, before the note is judged', async () => {
    const unknown = await refused(
      reject(admin, randomUUID(), { note: GOOD, reason: 'rar' }),
    );
    const garbage = await refused(
      reject(admin, "x'; drop table--", { note: GOOD, reason: 'rar' }),
    );

    expect([unknown.status, garbage.status]).toEqual([404, 404]);
  });

  it('commits one of ten rejections sent at once, with one audit entry, one event and one count', async () => {
    const file = await fileIn('in_review');
    const before = await rejections('rar');

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        reject(i % 2 ? admin : other, file.id, { note: GOOD, reason: 'rar' }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const losers = results.filter((r) => r.status === 'rejected');
    expect(
      losers.map((l) => (l.reason as HttpException).getStatus?.()),
    ).toEqual(Array(9).fill(409));
    expect(await audit(file.id)).toHaveLength(1);
    expect(
      (await outboxOf(file.id)).filter(
        (e) => e.kind === 'verification.decided',
      ),
    ).toHaveLength(1);
    expect(await rejections('rar')).toBe(before + 1);
  });

  it('leaves the garage draft and creates no second garage', async () => {
    const file = await fileIn('in_review');

    await reject(admin, file.id, { note: GOOD, reason: 'address' });

    expect(await prisma.garage.count()).toBe(1);
    expect(
      (await prisma.garage.findUniqueOrThrow({ where: { id: garageId } }))
        .status,
    ).toBe('draft');
  });
});
