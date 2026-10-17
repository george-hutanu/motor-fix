import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { VerificationChecksController } from './verification-checks.controller';
import { VerificationChecksService } from './verification-checks.service';
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
import { VerificationFileService } from '../verification-file/verification-file.service';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const RAR_NUMBER = 'B 1234/2019';
const TICKED = { found: true, sameAddress: true, sameCompany: true };
const COVERED = 'toate lucrările sunt acoperite';

const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(fn);
const person = (
  accountId: string,
  role: Actor['role'],
  garageId: string | null = null,
): Actor => ({ accountId, garageId, permissions: NONE, role, roles: [role] });
const files = () =>
  new VerificationService(new AuditService(), outbox, {
    skipManualApproval: false,
  });

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

const record = (
  kind: string,
  body: Record<string, unknown>,
  actor: Actor = ioana,
) =>
  new VerificationChecksController(
    prisma,
    new VerificationChecksService(new AuditService(), outbox),
  ).record(actor, fileId, kind, body as never);

const check = (kind: 'rar' | 'activities' | 'photos' | 'company') =>
  prisma.verificationCheck.findUniqueOrThrow({
    where: { fileId_kind: { fileId, kind } },
  });
const entries = () =>
  prisma.activityLog.findMany({
    where: { garageId, subjectType: 'verification_check' },
  });
const garageActivities = async () =>
  (await prisma.garage.findUniqueOrThrow({ where: { id: garageId } }))
    .rarActivities;

let position = 0;
async function priced(
  rarActivity: string | null,
  options: {
    status?: 'approved' | 'pending' | 'rejected';
    visible?: boolean;
    garage?: string;
  } = {},
) {
  const job = await prisma.jobType.create({
    data: {
      key: `job-${randomUUID()}`,
      nameEn: 'Job',
      nameRo: 'Lucrare',
      rarActivity,
      status: options.status ?? 'approved',
    },
  });
  await prisma.garagePrice.create({
    data: {
      fromBani: 10_000,
      garageId: options.garage ?? garageId,
      jobTypeId: job.id,
      position: position++,
      updatedBy: mihai.accountId,
      visible: options.visible ?? true,
    },
  });
  return job.id;
}

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  position = 0;
  const garage = await prisma.garage.create({
    data: {
      businessKind: 'company',
      cui: '1234567897',
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
    },
  });
  garageId = garage.id;
  ioana = person(await account('Ioana Popa', ['admin']), 'admin');
  mihai = person(await account('Mihai', ['garage']), 'garage', garageId);
  await prisma.garageMember.create({
    data: { accountId: mihai.accountId, garageId, role: 'owner' },
  });
  fileId = (await inTx((tx) => files().submit(tx, mihai, garageId, RAR_NUMBER)))
    .id;
});

afterAll(() => prisma.$disconnect());

// @traces 204-FR-011
describe('a not_run record that carries more than the clearing', () => {
  it.each([
    ['rar', { detail: 'x', result: 'not_run' }],
    ['rar', { evidence: TICKED, result: 'not_run' }],
    ['rar', { evidence: {}, result: 'not_run' }],
    ['rar', { activities: [], result: 'not_run' }],
    ['activities', { activities: ['brakes'], result: 'not_run' }],
    ['activities', { activities: [], result: 'not_run' }],
    ['activities', { detail: 'x', result: 'not_run' }],
    ['company', { evidence: { name: 'SRL' }, result: 'not_run' }],
    ['photos', { detail: 'x', result: 'not_run' }],
  ])(
    'is refused with 400 on %s %j and leaves the earlier answer standing',
    async (kind, body) => {
      if (kind === 'rar')
        await record('rar', { evidence: TICKED, result: 'ok' });
      if (kind === 'activities')
        await record('activities', { activities: ['brakes'], result: 'ok' });
      const before = await entries();

      expect(await outcome(record(kind, body))).toEqual({
        code: 'validation_failed',
        status: 400,
      });

      expect(await entries()).toHaveLength(before.length);
      if (kind === 'rar' || kind === 'activities') {
        expect((await check(kind)).result).toBe('ok');
      }
      if (kind === 'activities') {
        expect(await garageActivities()).toEqual(['brakes']);
      }
    },
  );

  it.each(['detail', 'evidence', 'activities'])(
    'never fails with a server error on a null %s',
    async (field) => {
      const answer = await outcome(
        record('activities', { [field]: null, result: 'not_run' }),
      );

      expect([200, 400]).toContain(answer.status);
    },
  );
});

// @traces 204-FR-002
describe('evidence and lists sent to the wrong kind', () => {
  it.each(['documents', 'photos', 'address', 'representative', 'activities'])(
    'refuses evidence on %s',
    async (kind) => {
      for (const evidence of [{}, { found: true }]) {
        const body: Record<string, unknown> = { evidence, result: 'ok' };
        if (kind === 'activities') body['activities'] = ['brakes'];
        expect(await outcome(record(kind, body))).toEqual({
          code: 'validation_failed',
          status: 400,
        });
      }
      expect(await entries()).toHaveLength(0);
    },
  );

  it.each(['photos', 'company', 'caen', 'documents'])(
    'refuses an activities list on %s',
    async (kind) => {
      expect(
        await outcome(record(kind, { activities: ['brakes'], result: 'ok' })),
      ).toEqual({ code: 'validation_failed', status: 400 });
      expect(await garageActivities()).toEqual([]);
    },
  );

  it.each(['RAR', 'rar ', 'Activities', ''])(
    'refuses the kind %j as unknown',
    async (kind) => {
      const answer = await outcome(record(kind, { result: 'ok' }));
      expect([404, 422]).toContain(answer.status);
      expect(await entries()).toHaveLength(0);
    },
  );
});

// @traces 204-FR-003
describe('a rar record built to bypass the shape checks', () => {
  it.each([['true'], [1], ['yes'], [{}], [[true]]])(
    'does not take %j as a tick for ok',
    async (tick) => {
      const answer = await outcome(
        record('rar', {
          evidence: { found: tick, sameAddress: tick, sameCompany: tick },
          result: 'ok',
        }),
      );

      expect(answer.status).toBe(400);
      expect((await check('rar')).result).toBe('not_run');
    },
  );

  it('writes the fixed detail whatever length or text the detail sent has', async () => {
    await record('rar', {
      detail: 'x\u0007'.repeat(3000),
      evidence: TICKED,
      result: 'ok',
    });

    expect((await check('rar')).detail).toBe('aceeași firmă și adresă');
  });

  it('writes the seat wording for a garage whose business kind is not a company either way', async () => {
    await prisma.garage.update({
      data: { businessKind: 'mobile' },
      where: { id: garageId },
    });

    await record('rar', { evidence: TICKED, result: 'ok' });

    expect((await check('rar')).detail).toBe('aceeași firmă și sediu social');
  });

  it('records the corrected number, normalised, in a later ok', async () => {
    await inTx((tx) =>
      files().correctRarNumber(tx, ioana, fileId, '  cj 77/2020 '),
    );

    await record('rar', { evidence: TICKED, result: 'ok' });

    expect((await check('rar')).evidence).toMatchObject({
      rarNumber: 'CJ 77/2020',
    });
  });

  it('refuses ok when the file number was cleared by the empty string', async () => {
    await prisma.verificationFile.update({
      data: { rarNumber: '' },
      where: { id: fileId },
    });

    const answer = await outcome(
      record('rar', { evidence: TICKED, result: 'ok' }),
    );

    expect(answer.status).toBe(400);
  });

  it.each(['approved', 'rejected', 'more_requested'] as const)(
    'is refused with 409 on a file that is %s and writes nothing',
    async (status) => {
      await prisma.verificationFile.update({
        data: { status },
        where: { id: fileId },
      });

      expect(
        await outcome(record('rar', { evidence: TICKED, result: 'ok' })),
      ).toEqual({ code: 'verification_file_decided', status: 409 });
      expect((await check('rar')).result).toBe('not_run');
      expect(await entries()).toHaveLength(0);
    },
  );
});

// @traces 204-FR-004
describe('an activities record judged against the price list', () => {
  it('counts only the garage own price rows', async () => {
    const other = await prisma.garage.create({
      data: { name: 'Altul', slug: `altul-${randomUUID()}` },
    });
    await priced('paintwork', { garage: other.id });
    await priced('brakes');

    await record('activities', { activities: ['brakes'], result: 'ok' });

    expect(await check('activities')).toMatchObject({
      detail: COVERED,
      evidence: { uncoveredJobTypeIds: [] },
      result: 'ok',
    });
  });

  it('covers an unmapped job and a job mapped to the empty string', async () => {
    await priced(null);
    await priced('');
    await priced('brakes');

    await record('activities', { activities: ['brakes'], result: 'ok' });

    expect((await check('activities')).result).toBe('ok');
  });

  it('refuses ok when the only uncovered job is rejected and hidden', async () => {
    await priced('paintwork', {
      status: 'rejected',
      visible: false,
    });

    const answer = await outcome(
      record('activities', { activities: ['brakes'], result: 'ok' }),
    );

    expect(answer.status).toBe(400);
    expect(await garageActivities()).toEqual([]);
  });

  it('lists no uncovered job for a problem sent with an empty list, as an empty list covers every job', async () => {
    await priced('paintwork');
    await priced('brakes');

    await record('activities', {
      activities: [],
      detail: 'nicio activitate',
      result: 'warning',
    });

    expect((await check('activities')).evidence).toMatchObject({
      uncoveredJobTypeIds: [],
    });
  });

  it('lists three hundred uncovered jobs in the price list order', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) ids.push(await priced('paintwork'));

    await record('activities', {
      activities: ['brakes'],
      detail: 'multe lucrări necoperite',
      result: 'failed',
    });

    expect(
      (await check('activities')).evidence as { uncoveredJobTypeIds: string[] },
    ).toMatchObject({ uncoveredJobTypeIds: ids });
  }, 60_000);

  it.each([['BRAKES'], [' brakes'], ['brakes\n'], ['tuning'], ['']])(
    'refuses the code %j as not in the catalogue',
    async (code) => {
      const answer = await outcome(
        record('activities', { activities: [code], result: 'ok' }),
      );

      expect(answer.status).toBe(400);
      expect(await garageActivities()).toEqual([]);
    },
  );

  it('never fails with a server error on a repeated code or a bare string list', async () => {
    for (const activities of [['brakes', 'brakes'], 'brakes']) {
      const answer = await outcome(
        record('activities', { activities, result: 'ok' }),
      );
      expect([200, 400]).toContain(answer.status);
    }
    expect(await garageActivities()).not.toContain('b');
  });

  it('is refused with 409 on a decided file and keeps the garage list', async () => {
    await prisma.garage.update({
      data: { rarActivities: ['mechanics'] },
      where: { id: garageId },
    });
    await prisma.verificationFile.update({
      data: { status: 'approved' },
      where: { id: fileId },
    });

    expect(
      await outcome(
        record('activities', { activities: ['brakes'], result: 'ok' }),
      ),
    ).toEqual({ code: 'verification_file_decided', status: 409 });
    expect(await garageActivities()).toEqual(['mechanics']);
  });

  it('is saved a second time with the same body as the same answer', async () => {
    await priced('brakes');
    const body = { activities: ['brakes'], result: 'ok' };

    await record('activities', body);
    const first = await check('activities');
    await record('activities', body);
    const second = await check('activities');

    expect(second).toMatchObject({
      detail: first.detail,
      evidence: first.evidence,
      result: 'ok',
    });
    expect(
      await prisma.verificationCheck.count({
        where: { fileId, kind: 'activities' },
      }),
    ).toBe(1);
  });
});

// @traces 204-FR-009
describe('the file read beside the record', () => {
  const storage = {
    createDownloadUrl: async (key: string) => `https://store.test/${key}`,
    derivedKey: (key: string, copy: string) => `${key}.${copy}`,
    metadataOf: async () => null,
    ready: jest.fn(async () => undefined),
  };
  const read = () =>
    new VerificationFileService(
      prisma,
      storage as unknown as StorageService,
      new PublicGaragesService(
        prisma,
        {} as CacheService,
        storage as unknown as StorageService,
      ),
    ).read(fileId);

  it('lists every job an activities record reported uncovered, hidden and pending ones included', async () => {
    const pending = await priced('paintwork', { status: 'pending' });
    const hidden = await priced('air_con', { visible: false });
    await priced('brakes');
    await record('activities', {
      activities: ['brakes'],
      detail: 'lipsesc două',
      result: 'warning',
    });

    const uncovered = (await check('activities')).evidence as {
      uncoveredJobTypeIds: string[];
    };
    const { jobs } = await read();

    expect(uncovered.uncoveredJobTypeIds).toEqual([pending, hidden]);
    expect(jobs.map((j) => j.jobTypeId)).toEqual(
      expect.arrayContaining(uncovered.uncoveredJobTypeIds),
    );
  });

  it('carries the number as stored and null after the file loses it', async () => {
    expect((await read()).file.rarNumber).toBe(RAR_NUMBER);

    await prisma.verificationFile.update({
      data: { rarNumber: null },
      where: { id: fileId },
    });

    expect((await read()).file.rarNumber).toBeNull();
  });
});
