import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { VerificationFileController } from './verification-file.controller';
import { VerificationFileService } from './verification-file.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import type { CacheService } from '../../../cache/cache.service';
import { outbox } from '../../../events/event.port';
import type { Prisma } from '../../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import type { StorageService } from '../../../storage/storage.service';
import { PublicGaragesService } from '../../public-garages/public-garages';
import { VerificationService } from '../verification.service';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const storage = {
  createDownloadUrl: async (key: string) => `https://store.test/${key}`,
  derivedKey: (key: string, copy: string) => `${key}.${copy}`,
  metadataOf: async () => null,
  ready: jest.fn(async () => undefined),
};

const verification = () =>
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

async function outcome(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        code: (error.getResponse() as { code?: string }).code,
        status: error.getStatus(),
      };
    }
    throw error;
  }
  return { code: undefined, status: 200 };
}

let ioana: Actor;
let mihai: Actor;
let garageId: string;
let fileId: string;

const controller = () =>
  new VerificationFileController(
    prisma,
    new VerificationFileService(
      prisma,
      storage as unknown as StorageService,
      new PublicGaragesService(
        prisma,
        {} as CacheService,
        storage as unknown as StorageService,
      ),
    ),
    verification(),
  );
const correct = (rarNumber: string, actor: Actor = ioana, id = fileId) =>
  controller().correct(actor, id, { rarNumber });
const stored = async () =>
  (await prisma.verificationFile.findUniqueOrThrow({ where: { id: fileId } }))
    .rarNumber;
const history = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { field: 'rar_number', subjectId: fileId },
  });

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  garageId = garage.id;
  ioana = person(await account('Ioana Popa', ['admin']), 'admin');
  mihai = person(await account('Mihai', ['garage']), 'garage', garageId);
  await prisma.garageMember.create({
    data: { accountId: mihai.accountId, garageId, role: 'owner' },
  });
  fileId = (
    await inTx((tx) =>
      verification().submit(tx, mihai, garageId, 'B 1234/2019'),
    )
  ).id;
});

afterAll(() => prisma.$disconnect());

// @traces 204-FR-001
describe('correcting the RAR number at its limits', () => {
  it('accepts exactly 3 characters and refuses 2', async () => {
    expect(await outcome(correct('ab'))).toMatchObject({ status: 400 });
    expect(await stored()).toBe('B 1234/2019');

    await correct('ab1');

    expect(await stored()).toBe('AB1');
  });

  it('counts the length after trimming', async () => {
    expect(await outcome(correct('   a   '))).toMatchObject({ status: 400 });
    expect(await outcome(correct('\t\n a1 \n'))).toMatchObject({ status: 400 });
    expect(await stored()).toBe('B 1234/2019');
  });

  it('keeps exactly 40 characters and cuts 41 down to 40', async () => {
    await correct('c'.repeat(40));
    expect(await stored()).toBe('C'.repeat(40));

    await correct('d'.repeat(41));
    expect(await stored()).toBe('D'.repeat(40));
  });

  it('answers the file read with the new number', async () => {
    const read = await correct('cj 5/2021');

    expect(read.file.rarNumber).toBe('CJ 5/2021');
  });

  it.each([
    ['a null character', 'B 12\u000034'],
    ['a delete character', 'B 12\u007f34'],
    ['a C1 control character', 'B 12\u008534'],
    ['a tab inside', 'B 12\t34'],
    ['a line break inside', 'B 12\n34'],
  ])('refuses a number with %s and keeps the stored one', async (_, value) => {
    expect(await outcome(correct(value))).toEqual({
      code: 'validation_failed',
      status: 400,
    });
    expect(await stored()).toBe('B 1234/2019');
    expect(await history()).toHaveLength(0);
  });

  it('upper-cases unicode letters without a server error, and keeps at most 40 characters', async () => {
    await correct('ăîșțâ 12/2020');
    expect(await stored()).toBe('ĂÎȘȚÂ 12/2020');

    const answer = await outcome(correct(`${'ß'.repeat(30)}`));
    expect(answer.status).toBe(200);
    expect((await stored())?.length).toBeLessThanOrEqual(40);
  });

  it('never fails with a server error when the cut splits a surrogate pair', async () => {
    const answer = await outcome(correct(`${'B'.repeat(39)}\u{1F600}`));

    expect([200, 400]).toContain(answer.status);
  });
});

// @traces 204-FR-001
describe('correcting the RAR number twice and in the other order', () => {
  it('writes one history entry for the same number sent twice, even in another case', async () => {
    await correct('cj 5/2021');
    await correct('CJ 5/2021');
    await correct(' cj 5/2021 ');

    expect(await history()).toHaveLength(1);
  });

  it('writes nothing for the number the file already holds', async () => {
    await correct('b 1234/2019');

    expect(await history()).toHaveLength(0);
  });

  it('writes an event for no correction at all', async () => {
    const before = await prisma.outboxEvent.count();

    await correct('x 1/2000');
    await correct('y 2/2000');

    expect(await prisma.outboxEvent.count()).toBe(before);
  });

  it('chains the history: each old value is the previous new one', async () => {
    await correct('a 1/2000');
    await correct('b 2/2000');
    await correct('a 1/2000');

    const entries = await history();
    expect(entries.map((e) => [e.oldValue, e.newValue])).toEqual([
      ['B 1234/2019', 'A 1/2000'],
      ['A 1/2000', 'B 2/2000'],
      ['B 2/2000', 'A 1/2000'],
    ]);
  });

  it('records the admin who made each correction', async () => {
    await correct('a 1/2000');

    const [entry] = await history();
    expect(entry).toMatchObject({
      actorId: ioana.accountId,
      actorRole: 'admin',
      garageId,
    });
  });
});

// @traces 204-FR-001
describe('correcting the RAR number when the file or the caller is not right', () => {
  it.each(['approved', 'rejected', 'more_requested'] as const)(
    'answers 409 on a %s file, even for the number it already holds',
    async (status) => {
      await prisma.verificationFile.update({
        data: { status },
        where: { id: fileId },
      });

      for (const value of ['z 9/2020', 'b 1234/2019']) {
        expect(await outcome(correct(value))).toEqual({
          code: 'verification_file_decided',
          status: 409,
        });
      }
      expect(await stored()).toBe('B 1234/2019');
      expect(await history()).toHaveLength(0);
    },
  );

  it('is allowed again once a decided file is reopened to review', async () => {
    await prisma.verificationFile.update({
      data: { status: 'approved' },
      where: { id: fileId },
    });
    await prisma.verificationFile.update({
      data: { status: 'in_review' },
      where: { id: fileId },
    });

    await correct('n 3/2022');

    expect(await stored()).toBe('N 3/2022');
  });

  it.each([['a garage owner', () => mihai]])(
    'answers 404 to %s and changes nothing',
    async (_, actor) => {
      expect(await outcome(correct('z 9/2020', actor()))).toMatchObject({
        status: 404,
      });
      expect(await stored()).toBe('B 1234/2019');
      expect(await history()).toHaveLength(0);
    },
  );

  it.each([randomUUID(), 'not-a-uuid', ''])(
    'answers 404 for the file id %j',
    async (id) => {
      expect(await outcome(correct('z 9/2020', ioana, id))).toMatchObject({
        status: 404,
      });
    },
  );

  it('does not let a non-admin learn that a decided file is decided', async () => {
    await prisma.verificationFile.update({
      data: { status: 'approved' },
      where: { id: fileId },
    });

    expect(await outcome(correct('z 9/2020', mihai))).toMatchObject({
      status: 404,
    });
  });

  it('sets a number on a file that holds none', async () => {
    await prisma.verificationFile.update({
      data: { rarNumber: null },
      where: { id: fileId },
    });

    await correct('q 8/2018');

    const [entry] = await history();
    expect([entry?.oldValue, entry?.newValue]).toEqual([null, 'Q 8/2018']);
  });
});
