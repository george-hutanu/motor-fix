import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { VerificationService } from './verification.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/policy';
import { serialDatabase } from '../auth/serial-db.testing';
import { outbox } from '../events/event.port';
import type { Prisma } from '../generated/prisma/client';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const SYSTEM = { accountId: null, role: 'system' } as const;
const REASON = { code: 'documents_unreadable', note: 'Blurred' };

const service = (skipManualApproval = false) =>
  new VerificationService(new AuditService(), outbox, { skipManualApproval });
const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(fn);
const person = (
  accountId: string,
  role: Actor['role'],
  garageId: string | null = null,
): Actor => ({ accountId, garageId, permissions: NONE, role, roles: [role] });

async function statusOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error.getStatus();
    throw error;
  }
  return 200;
}

let admin: Actor;
let owner: Actor;
let garageId: string;

beforeEach(async () => {
  await reset();
  const garage = await prisma.garage.create({
    data: { name: 'Atelier', slug: `a-${randomUUID()}` },
  });
  garageId = garage.id;
  admin = person(await account('Ioana Popa', ['admin']), 'admin');
  owner = person(await account('Mihai', ['garage']), 'garage', garageId);
});

afterAll(() => prisma.$disconnect());

const submitted = () =>
  prisma.verificationFile.create({ data: { garageId, status: 'submitted' } });

describe('trust and unknown ids', () => {
  it('answers 404 when a garage member opens a file', async () => {
    const file = await submitted();

    expect(
      await statusOf(inTx((tx) => service().open(tx, owner, file.id))),
    ).toBe(404);
    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(after.status).toBe('submitted');
  });

  it('refuses a garage member deciding a file and leaves it untouched', async () => {
    const file = await submitted();

    const status = await statusOf(
      inTx((tx) =>
        service().decide(tx, owner, file.id, { outcome: 'approved' }),
      ),
    );

    expect(status).not.toBe(200);
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('draft');
  });

  it('refuses a garage member reopening a decided file', async () => {
    const file = await prisma.verificationFile.create({
      data: {
        decidedAt: new Date(),
        garageId,
        reasonCode: REASON.code,
        reasonNote: REASON.note,
        status: 'rejected',
      },
    });

    expect(
      await statusOf(inTx((tx) => service().reopen(tx, owner, file.id))),
    ).not.toBe(200);
    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(after.status).toBe('rejected');
  });

  it.each(['open', 'decide'] as const)(
    'answers 404 when %s gets an id no file has',
    async (use) => {
      const status = await statusOf(
        inTx<unknown>((tx) =>
          use === 'open'
            ? service().open(tx, admin, randomUUID())
            : service().decide(tx, admin, randomUUID(), {
                outcome: 'approved',
              }),
        ),
      );

      expect(status).toBe(404);
    },
  );

  it('answers 404 rather than a server error for an id that is not a uuid', async () => {
    expect(
      await statusOf(
        inTx((tx) => service().open(tx, admin, "x'; drop table--")),
      ),
    ).toBe(404);
  });
});

describe('the system actor and the test switch', () => {
  it('lets the system approve a file, leaving no human decider', async () => {
    const file = await submitted();

    await inTx((tx) =>
      service().decide(tx, SYSTEM, file.id, { outcome: 'approved' }),
    );

    const after = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(after).toMatchObject({ decidedBy: null, status: 'approved' });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('approved');
  });

  it('approves a submission at once, and publishes the garage, when the switch is on', async () => {
    const file = await inTx((tx) => service(true).submit(tx, owner, garageId));

    expect(file.status).toBe('approved');
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.status).toBe('approved');
    expect(await prisma.verificationFile.count({ where: { garageId } })).toBe(
      1,
    );
  });
});

describe('concurrent decisions', () => {
  it('commits exactly one of two decisions racing on one file', async () => {
    const file = await submitted();

    const results = await Promise.allSettled([
      inTx((tx) =>
        service().decide(tx, admin, file.id, { outcome: 'approved' }),
      ),
      inTx((tx) =>
        service().decide(tx, admin, file.id, {
          outcome: 'rejected',
          reason: REASON,
        }),
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected');
    expect(loser && (loser.reason as HttpException).getStatus()).toBe(409);
    const entries = await prisma.activityLog.findMany({
      where: { subjectId: file.id },
    });
    expect(entries).toHaveLength(1);
  });
});
