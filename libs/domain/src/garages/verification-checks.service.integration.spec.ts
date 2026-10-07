import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { VerificationService } from './verification.service';
import { VerificationChecksService } from './verification-checks.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/policy';
import { serialDatabase } from '../auth/serial-db.testing';
import { type EventPort, outbox } from '../events/event.port';
import type { Prisma } from '../generated/prisma/client';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

// @traces 300-FR-003 300-FR-004 300-FR-005 300-FR-006 300-FR-007 300-FR-009 300-FR-010 300-FR-011

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const REASON = { code: 'documents_unreadable', note: 'The CUI is blurred' };

const checksService = (events: EventPort = outbox) =>
  new VerificationChecksService(new AuditService(), events);
const files = () =>
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

let ioana: Actor;
let dan: Actor;
let mihai: Actor;
let garageId: string;
let fileId: string;

const record = (
  kind: string,
  body: { result: string; detail?: string; activities?: string[] },
  actor: Actor = ioana,
  id = fileId,
) => inTx((tx) => checksService().record(tx, actor, id, kind, body as never));

const check = (kind: 'rar' | 'activities' | 'photos' | 'company') =>
  prisma.verificationCheck.findUniqueOrThrow({
    where: { fileId_kind: { fileId, kind } },
  });
const entries = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { garageId, subjectType: 'verification_check' },
  });
const recorded = () =>
  prisma.outboxEvent.findMany({
    orderBy: { createdAt: 'asc' },
    where: { kind: 'verification.check_recorded', subjectId: fileId },
  });

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
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
  fileId = (await inTx((tx) => files().submit(tx, mihai, garageId))).id;
});

afterAll(() => prisma.$disconnect());

describe('recording a check', () => {
  it('saves the result with who and when, its history entry and its event', async () => {
    const before = Date.now();
    const detail = 'Autorizație găsită în registru, aceeași firmă și adresă';

    const answer = await record('rar', { detail, result: 'ok' });

    const rar = await check('rar');
    expect(rar).toMatchObject({
      automatic: false,
      detail,
      recordedBy: ioana.accountId,
      result: 'ok',
    });
    expect(rar.recordedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(answer.check).toMatchObject({ detail, id: rar.id, result: 'ok' });

    const [entry, ...more] = await entries();
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      action: 'update',
      actorId: ioana.accountId,
      field: 'rar',
      garageId,
      kind: 'verification_check_recorded',
      newValue: { detail, result: 'ok' },
      oldValue: { detail: null, result: 'not_run' },
      subjectId: rar.id,
    });

    const [event, ...others] = await recorded();
    expect(others).toHaveLength(0);
    expect(event).toMatchObject({
      audience: ['admin', 'system'],
      payload: { fileId, kind: 'rar', result: 'ok' },
      subjectId: fileId,
    });
  });

  it('answers with the file summary in both languages', async () => {
    await record('company', { result: 'ok' });
    const answer = await record('rar', { result: 'ok' });

    expect(answer.summary).toEqual({
      en: 'Company ID and RAR licence checked',
      ro: 'CUI și autorizație RAR verificate',
    });

    const warned = await record('photos', {
      detail: 'neclare',
      result: 'warning',
    });
    expect(warned.summary.ro).toBe(
      'CUI și autorizație RAR verificate · fotografii neclare',
    );
  });

  it('stores the activities on the garage in the same save', async () => {
    const answer = await record('activities', {
      activities: ['mechanics', 'brakes'],
      result: 'ok',
    });

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.rarActivities).toEqual(['mechanics', 'brakes']);
    expect(answer.rarActivities).toEqual(['mechanics', 'brakes']);
    const [entry] = await entries();
    expect(entry).toMatchObject({
      newValue: {
        activities: ['mechanics', 'brakes'],
        detail: null,
        result: 'ok',
      },
      oldValue: { activities: [], detail: null, result: 'not_run' },
    });
  });

  it('accepts an empty activities list when the result is ok', async () => {
    await record('activities', { activities: ['brakes'], result: 'ok' });
    await record('activities', { activities: [], result: 'ok' });

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.rarActivities).toEqual([]);
  });

  it('leaves the garage activities as they are when a problem comes without a list', async () => {
    await record('activities', { activities: ['brakes'], result: 'ok' });
    await record('activities', {
      detail: 'lipsește direcția',
      result: 'warning',
    });

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.rarActivities).toEqual(['brakes']);
    expect(await check('activities')).toMatchObject({ result: 'warning' });
  });

  it('lets the last save win and keeps both in the history', async () => {
    await record('rar', { detail: 'nu apare', result: 'failed' });
    await record('rar', { detail: 'găsită', result: 'ok' }, dan);

    expect(await check('rar')).toMatchObject({
      detail: 'găsită',
      recordedBy: dan.accountId,
      result: 'ok',
    });
    const [first, second] = await entries();
    expect(first).toMatchObject({
      newValue: { detail: 'nu apare', result: 'failed' },
    });
    expect(second).toMatchObject({
      actorId: dan.accountId,
      newValue: { detail: 'găsită', result: 'ok' },
      oldValue: { detail: 'nu apare', result: 'failed' },
    });
    expect(await recorded()).toHaveLength(2);
  });

  it('replaces the detail with the one sent, or none', async () => {
    await record('company', { detail: 'CUI valid', result: 'ok' });
    await record('company', { result: 'ok' });

    expect(await check('company')).toMatchObject({ detail: null });
  });

  it('keeps two racing saves whole: each history entry starts from the other', async () => {
    await Promise.all([
      record('rar', { detail: 'a', result: 'warning' }),
      record('rar', { detail: 'b', result: 'failed' }, dan),
    ]);

    const [first, second] = await entries();
    expect(second?.oldValue).toEqual(first?.newValue);
    expect((await check('rar')).detail).toBe(
      (second?.newValue as { detail?: string } | undefined)?.detail,
    );
  });

  it('leaves no result, history or event when the event cannot be written', async () => {
    const failing: EventPort = {
      record: async () => {
        throw new Error('outbox down');
      },
    };

    await expect(
      inTx((tx) =>
        checksService(failing).record(tx, ioana, fileId, 'rar', {
          result: 'ok',
        }),
      ),
    ).rejects.toThrow('outbox down');

    expect(await check('rar')).toMatchObject({
      recordedBy: null,
      result: 'not_run',
    });
    expect(await entries()).toHaveLength(0);
    expect(await recorded()).toHaveLength(0);
  });
});

describe('a record that is refused', () => {
  const decide = async (
    outcome: 'approved' | 'rejected' | 'more_requested',
  ) => {
    await inTx((tx) => files().open(tx, ioana, fileId));
    await inTx((tx) =>
      files().decide(
        tx,
        ioana,
        fileId,
        outcome === 'approved' ? { outcome } : { outcome, reason: REASON },
      ),
    );
  };

  it.each(['approved', 'rejected', 'more_requested'] as const)(
    'is refused with 409 once the file is %s',
    async (outcome) => {
      await decide(outcome);

      expect(await refusal(record('rar', { result: 'ok' }))).toEqual({
        body: {
          code: 'verification_file_decided',
          message: 'Dosarul e deja decis',
        },
        status: 409,
      });
      expect(await entries()).toHaveLength(0);
    },
  );

  it('is accepted again once a decided file is reopened', async () => {
    await decide('rejected');
    await inTx((tx) => files().reopen(tx, dan, fileId));

    await record('rar', { result: 'ok' });

    expect(await check('rar')).toMatchObject({ result: 'ok' });
  });

  it('is accepted while the file is under review', async () => {
    await inTx((tx) => files().open(tx, ioana, fileId));

    await record('company', { result: 'ok' });

    expect(await check('company')).toMatchObject({ result: 'ok' });
  });

  it('refuses an unknown kind with 422', async () => {
    expect(await refusal(record('insurance', { result: 'ok' }))).toMatchObject({
      body: { code: 'verification_check_kind_unknown' },
      status: 422,
    });
  });

  it.each([
    ['a warning without a detail', 'photos', { result: 'warning' }],
    ['a failure without a detail', 'rar', { result: 'failed' }],
    ['a blank detail on a failure', 'rar', { detail: '   ', result: 'failed' }],
    [
      'a detail over 200 characters',
      'company',
      { detail: 'x'.repeat(201), result: 'ok' },
    ],
    [
      'an unknown activity',
      'activities',
      { activities: ['mechanics', 'tuning'], result: 'ok' },
    ],
    [
      'a list on another kind',
      'rar',
      { activities: ['mechanics'], result: 'ok' },
    ],
    ['activities ok without a list', 'activities', { result: 'ok' }],
    ['a result that is not one', 'rar', { result: 'not_run' }],
  ])('refuses %s with 400', async (_, kind, body) => {
    expect(await refusal(record(kind, body))).toMatchObject({
      body: { code: 'validation_failed' },
      status: 400,
    });
    expect(await entries()).toHaveLength(0);
  });

  it('accepts a detail of exactly 200 characters', async () => {
    await record('company', { detail: 'x'.repeat(200), result: 'ok' });

    expect((await check('company')).detail).toHaveLength(200);
  });

  it('answers 404 for an unknown or malformed file', async () => {
    for (const id of [randomUUID(), 'not-a-uuid']) {
      expect(
        await refusal(record('rar', { result: 'ok' }, ioana, id)),
      ).toMatchObject({ status: 404 });
    }
  });

  it('answers 404 to anyone but an admin', async () => {
    expect(await refusal(record('rar', { result: 'ok' }, mihai))).toMatchObject(
      { status: 404 },
    );
    expect(await check('rar')).toMatchObject({ result: 'not_run' });
  });
});
