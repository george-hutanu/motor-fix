import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { SYSTEM, VerificationService } from './verification.service';
import { verificationConfig } from './verification-config';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const REASON = { code: 'documents_unreadable', note: 'The CUI is blurred' };

const build = (appEnv: string, env: Record<string, string> = {}) =>
  new VerificationService(
    new AuditService(),
    outbox,
    verificationConfig(appEnv, env),
  );

async function rules(manual: unknown, rar: unknown) {
  for (const [key, value] of [
    ['skip_manual_approval', manual],
    ['skip_rar_check', rar],
  ] as const) {
    await prisma.platformRule.upsert({
      create: { defaultValue: false, key, value: value as never },
      update: { value: value as never },
      where: { key },
    });
  }
}

const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(fn);

const person = (
  accountId: string,
  role: Actor['role'],
  garageId: string | null = null,
): Actor => ({ accountId, garageId, permissions: NONE, role, roles: [role] });

const statusOf = async (id: string) =>
  (await prisma.verificationFile.findUniqueOrThrow({ where: { id } })).status;
const entriesOf = (subjectId: string) =>
  prisma.activityLog.findMany({ orderBy: { at: 'asc' }, where: { subjectId } });

let ioana: Actor;
let mihai: Actor;
let garageId: string;

beforeEach(async () => {
  await reset();
  await rules(false, false);
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  garageId = garage.id;
  ioana = person(await account('Ioana Popa', ['admin']), 'admin');
  mihai = person(await account('Mihai', ['garage']), 'garage', garageId);
  await prisma.garageMember.create({
    data: { accountId: mihai.accountId, garageId, role: 'owner' },
  });
});

afterEach(() => rules(false, false));
afterAll(() => prisma.$disconnect());

function sentBack(rar?: 'ok' | 'failed' | 'warning' | 'not_run') {
  return prisma.verificationFile.create({
    data: {
      ...(rar && { checks: { create: [{ kind: 'rar', result: rar }] } }),
      decidedAt: new Date(),
      decidedBy: ioana.accountId,
      garageId,
      openedAt: new Date(),
      openedBy: ioana.accountId,
      reasonCode: REASON.code,
      reasonNote: REASON.note,
      status: 'more_requested',
    },
  });
}

// @traces 259-FR-001
describe('the stored rules in production', () => {
  it.each([
    ['submit', true, true],
    ['submit', true, false],
  ])(
    'ignores a stored true on a %s (manual %s, rar %s)',
    async (_name, manual, rar) => {
      await rules(manual, rar);

      const file = await inTx((tx) =>
        build('production', { SKIP_MANUAL_APPROVAL: '1' }).submit(
          tx,
          mihai,
          garageId,
        ),
      );

      expect(await statusOf(file.id)).toBe('submitted');
      expect(
        (await prisma.garage.findUniqueOrThrow({ where: { id: garageId } }))
          .status,
      ).toBe('draft');
    },
  );

  it('still asks a note of an admin approval whatever the rules store', async () => {
    await rules(true, true);
    const file = await prisma.verificationFile.create({
      data: {
        checks: {
          create: [
            { kind: 'rar', result: 'ok' },
            { kind: 'caen', result: 'ok' },
            { kind: 'photos', result: 'failed' },
          ],
        },
        garageId,
        openedAt: new Date(),
        openedBy: ioana.accountId,
        status: 'in_review',
      },
    });

    const error = await inTx((tx) =>
      build('production').decide(tx, ioana, file.id, { outcome: 'approved' }),
    ).catch((e: unknown) => e as HttpException);

    expect((error as HttpException).getStatus()).toBe(422);
    expect(await statusOf(file.id)).toBe('in_review');
  });
});

// @traces 259-FR-002
describe('what turns the automatic approval on', () => {
  it.each(['yes', '0', 'false', '', '2', 'on'])(
    'does not read SKIP_MANUAL_APPROVAL=%j as on under test',
    async (value) => {
      await rules(false, true);

      const file = await inTx((tx) =>
        build('test', { SKIP_MANUAL_APPROVAL: value }).submit(
          tx,
          mihai,
          garageId,
        ),
      );

      expect(await statusOf(file.id)).toBe('submitted');
    },
  );

  it.each(['staging', 'development', 'preview'])(
    'ignores the variable under APP_ENV=%s with both stored rules off',
    async (appEnv) => {
      const file = await inTx((tx) =>
        build(appEnv, { SKIP_MANUAL_APPROVAL: 'true' }).submit(
          tx,
          mihai,
          garageId,
        ),
      );

      expect(await statusOf(file.id)).toBe('submitted');
    },
  );

  it('reads the stored rules under APP_ENV=test too', async () => {
    await rules(true, true);

    const file = await inTx((tx) => build('test').submit(tx, mihai, garageId));

    expect(await statusOf(file.id)).toBe('approved');
  });

  it.each([['true'], [1], [null]])(
    'does not read the stored value %j as the boolean true',
    async (value) => {
      await rules(value, true);

      const file = await inTx((tx) =>
        build('development').submit(tx, mihai, garageId),
      );

      expect(await statusOf(file.id)).toBe('submitted');
    },
  );

  it('does not approve on the RAR switch alone', async () => {
    await rules(false, true);
    const sent = await sentBack('ok');

    await inTx((tx) => build('development').resend(tx, mihai, sent.id));

    expect(await statusOf(sent.id)).toBe('submitted');
  });

  it.each(['failed', 'warning', 'not_run'] as const)(
    'leaves a file sent again waiting with the rar check %s and the RAR switch off',
    async (rar) => {
      await rules(true, false);
      const sent = await sentBack(rar);

      await inTx((tx) => build('development').resend(tx, mihai, sent.id));

      expect(await statusOf(sent.id)).toBe('submitted');
    },
  );

  it.each(['failed', 'warning'] as const)(
    'approves a file sent again with the rar check %s when the RAR switch is on',
    async (rar) => {
      await rules(true, true);
      const sent = await sentBack(rar);

      await inTx((tx) => build('development').resend(tx, mihai, sent.id));

      expect(await statusOf(sent.id)).toBe('approved');
    },
  );

  it('approves with no note although every guide check is not run, as the system', async () => {
    await rules(true, true);

    const file = await inTx((tx) =>
      build('development').submit(tx, mihai, garageId),
    );

    expect(file.decidedBy).toBeNull();
    expect(
      (await entriesOf(file.id)).filter(
        (e) => e.kind === 'verification_approval_refused',
      ),
    ).toEqual([]);
  });

  it('refuses a second sending after an automatic approval and adds nothing', async () => {
    await rules(true, true);
    const service = build('development');
    const file = await inTx((tx) => service.submit(tx, mihai, garageId));
    const before = (await entriesOf(file.id)).length;
    const events = await prisma.outboxEvent.count();

    const error = await inTx((tx) => service.submit(tx, mihai, garageId)).catch(
      (e: unknown) => e as HttpException,
    );

    expect((error as HttpException).getStatus()).toBe(409);
    expect((await entriesOf(file.id)).length).toBe(before);
    expect(await prisma.outboxEvent.count()).toBe(events);
  });

  it('leaves a first sending by a suspended garage waiting', async () => {
    await rules(true, true);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garageId },
    });

    const file = await inTx((tx) =>
      build('development').submit(tx, mihai, garageId),
    );

    expect(await statusOf(file.id)).toBe('submitted');
    expect(
      (await prisma.garage.findUniqueOrThrow({ where: { id: garageId } }))
        .status,
    ).toBe('suspended');
  });
});

// @traces 259-FR-004
describe('the system actor and the gates', () => {
  it('is never refused by the gates and never leaves a refusal entry', async () => {
    const file = await prisma.verificationFile.create({
      data: { garageId, status: 'submitted' },
    });

    await inTx((tx) =>
      build('production').decide(tx, SYSTEM, file.id, { outcome: 'approved' }),
    );

    expect(await statusOf(file.id)).toBe('approved');
    expect(
      (await entriesOf(file.id)).filter(
        (e) => e.kind === 'verification_approval_refused',
      ),
    ).toEqual([]);
  });
});

// @traces 259-FR-005
describe('recordRefusal', () => {
  it('rejects an unknown file and writes nothing', async () => {
    const unknown = randomUUID();
    const before = await prisma.activityLog.count({
      where: { kind: 'verification_approval_refused' },
    });

    const error = await inTx((tx) =>
      build('development').recordRefusal(
        tx,
        ioana,
        unknown,
        'rar_check_required',
      ),
    ).catch((e: unknown) => e as HttpException);

    expect((error as HttpException).getStatus()).toBe(404);
    expect(
      await prisma.activityLog.count({
        where: { kind: 'verification_approval_refused' },
      }),
    ).toBe(before);
  });
});
