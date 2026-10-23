import { randomUUID } from 'node:crypto';

import type { ApproveCatalogueJobDto } from '@motor-fix/contracts';
import { HttpException, Logger } from '@nestjs/common';

import { JobDecisionsService } from './job-decisions.service';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { type EventPort, outbox } from '../../events/event.port';
import {
  PRICE_ROW_SELECT,
  priceListJobs,
} from '../../garages/price-list/price-list';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { JobTypesService } from '../job-types/job-types.service';

// @traces 414-FR-001 414-FR-002 414-FR-003
// @traces 414-FR-004 414-FR-005 414-FR-006
// @traces 414-FR-007 414-FR-008 414-FR-013

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const REASON = 'Este o reparație generică, nu o lucrare de catalog.';
const APPROVAL: ApproveCatalogueJobDto = {
  carSystem: 'engine',
  nameEn: 'Injector reconditioning',
  nameRo: 'Recondiționare injectoare',
};

const admin = (accountId: string): Actor => ({
  accountId,
  garageId: null,
  permissions: NONE,
  role: 'admin',
  roles: ['admin'],
});

const service = (events: EventPort = outbox) =>
  new JobDecisionsService(prisma, new AuditService(), events);

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        body: error.getResponse() as Record<string, unknown>,
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

let ana: Actor;
let mihai: Actor;
let owner: string;

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE job_type CASCADE');
  ana = admin(await account('Ana Popescu', ['admin']));
  mihai = admin(await account('Mihai Ionescu', ['admin']));
  owner = await account('Dan Dinamo', ['garage']);
});

afterAll(() => prisma.$disconnect());

const garageOf = (name = 'Atelier Dinamo', status?: 'suspended') =>
  prisma.garage.create({
    data: {
      name,
      slug: `garage-${randomUUID()}`,
      ...(status && { status }),
    },
  });

// A garage's pending proposal with its default range, created `at`.
async function proposal(
  options: {
    at?: Date;
    garageId?: string | null;
    name?: string;
    row?: boolean;
  } = {},
) {
  const garageId =
    options.garageId === undefined ? (await garageOf()).id : options.garageId;
  const name = options.name ?? 'Recondiționare injectoare';
  const job = await prisma.jobType.create({
    data: {
      key: `job-${randomUUID()}`,
      nameEn: name,
      nameRo: name,
      proposedByGarageId: garageId,
      status: 'pending',
      ...(options.at && { createdAt: options.at }),
    },
  });
  if (garageId && options.row !== false) {
    await prisma.garagePrice.create({
      data: {
        durationMinutes: 90,
        fromBani: 18_000,
        garageId,
        jobTypeId: job.id,
        position: 0,
        toBani: 42_000,
        updatedBy: owner,
      },
    });
  }
  return { garageId, job };
}

const jobOf = (id: string) =>
  prisma.jobType.findUniqueOrThrow({ where: { id } });

const entriesOf = (id: string) =>
  prisma.activityLog.findMany({
    where: { subjectId: id, subjectType: 'job_type' },
  });

const eventsOf = (kind: string, subjectId: string) =>
  prisma.outboxEvent.findMany({ where: { kind, subjectId } });

describe('the decision columns', () => {
  it('are empty on a new row and the decider is cleared when the account goes', async () => {
    const { job } = await proposal();

    expect(await jobOf(job.id)).toMatchObject({
      decidedAt: null,
      decidedBy: null,
      rejectionReason: null,
    });
    const [rule] = await prisma.$queryRaw<{ action: string }[]>`
      SELECT confdeltype::text AS action FROM pg_constraint
      WHERE conrelid = 'job_type'::regclass AND contype = 'f'
        AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
          WHERE attrelid = 'job_type'::regclass AND attname = 'decided_by')]`;
    expect(rule?.action).toBe('n');
  });

  it('refuse a rejection reason on a job that is not rejected', async () => {
    const { job } = await proposal();

    await expect(
      prisma.$executeRaw`UPDATE job_type SET rejection_reason = ${REASON}
        WHERE id = ${job.id}::uuid`,
    ).rejects.toThrow(/rejection_reason/);
  });
});

describe('the queue', () => {
  it('lists the pending jobs oldest first with the garage and the default range', async () => {
    const later = await proposal({
      at: new Date('2026-10-22T10:00:00Z'),
      name: 'Curățare filtru particule',
    });
    const first = await proposal({ at: new Date('2026-10-20T10:00:00Z') });
    await prisma.jobType.create({
      data: {
        key: `job-${randomUUID()}`,
        nameEn: 'Oil',
        nameRo: 'Ulei',
        status: 'approved',
      },
    });

    const { items } = await service().queue(ana);

    expect(items.map((item) => item.id)).toEqual([first.job.id, later.job.id]);
    expect(items[0]).toEqual({
      durationMinutes: 90,
      fromBani: 18_000,
      garage: {
        id: first.garageId,
        name: 'Atelier Dinamo',
        slug: expect.any(String),
      },
      id: first.job.id,
      name: 'Recondiționare injectoare',
      proposedAt: '2026-10-20T10:00:00.000Z',
      toBani: 42_000,
    });
  });

  it('leaves out a gone garage and the figures of a gone row', async () => {
    const gone = await proposal({ garageId: null });
    const rowless = await proposal({ name: 'Fără rând', row: false });

    const { items } = await service().queue(ana);
    const byId = new Map(items.map((item) => [item.id, item]));

    expect(byId.get(gone.job.id)).not.toHaveProperty('garage');
    expect(byId.get(rowless.job.id)).not.toHaveProperty('fromBani');
    expect(byId.get(rowless.job.id)).not.toHaveProperty('toBani');
    expect(byId.get(rowless.job.id)).not.toHaveProperty('durationMinutes');
    expect(byId.get(rowless.job.id)?.garage?.id).toBe(rowless.garageId);
  });

  it('carries every RAR activity by Romanian name', async () => {
    const all = await prisma.rarActivity.findMany();

    const { rarActivities } = await service().queue(ana);

    expect(rarActivities).toHaveLength(all.length);
    expect(rarActivities.map((a) => a.nameRo)).toEqual(
      [...rarActivities.map((a) => a.nameRo)].sort((a, b) =>
        a.localeCompare(b, 'ro'),
      ),
    );
    expect(rarActivities).toContainEqual({
      code: 'brakes',
      nameEn: expect.any(String),
      nameRo: expect.any(String),
    });
  });
});

describe('an approval', () => {
  it('writes the names, the system, the activity and the decider, and keeps the key', async () => {
    const { job } = await proposal();

    const answer = await service().approve(ana, job.id, {
      ...APPROVAL,
      rarActivity: 'brakes',
    });

    const stored = await jobOf(job.id);
    expect(stored).toMatchObject({
      carSystem: 'engine',
      decidedBy: ana.accountId,
      key: job.key,
      nameEn: 'Injector reconditioning',
      nameRo: 'Recondiționare injectoare',
      rarActivity: 'brakes',
      rejectionReason: null,
      status: 'approved',
    });
    expect(stored.decidedAt).toBeInstanceOf(Date);
    expect(answer).toEqual({
      carSystem: 'engine',
      decidedAt: stored.decidedAt?.toISOString(),
      id: job.id,
      nameEn: 'Injector reconditioning',
      nameRo: 'Recondiționare injectoare',
      rarActivity: 'brakes',
      status: 'approved',
    });
  });

  it('stores no activity when none is given and ticks no brand', async () => {
    const { job } = await proposal();

    await service().approve(ana, job.id, APPROVAL);

    expect((await jobOf(job.id)).rarActivity).toBeNull();
    expect(
      await prisma.garageBrandJob.count({ where: { jobTypeId: job.id } }),
    ).toBe(0);
  });

  it('writes one audit entry with the old and the new values', async () => {
    const { job } = await proposal();

    await service().approve(ana, job.id, {
      ...APPROVAL,
      rarActivity: 'brakes',
    });

    const entries = await entriesOf(job.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: ana.accountId,
      actorRole: 'admin',
      garageId: null,
      newValue: {
        car_system: 'engine',
        name_en: 'Injector reconditioning',
        name_ro: 'Recondiționare injectoare',
        rar_activity: 'brakes',
        status: 'approved',
      },
      oldValue: { status: 'pending' },
    });
  });

  it('records the decision for the admins and the garage, and the price list for the profile', async () => {
    const { garageId, job } = await proposal();

    await service().approve(ana, job.id, APPROVAL);

    const [decided] = await eventsOf('catalogue_job.decided', job.id);
    expect(decided?.payload).toEqual({
      decision: 'approved',
      garageId,
      jobTypeId: job.id,
    });
    expect(decided?.audience).toEqual(['admin', `garage:${garageId}`]);
    const updated = await eventsOf('price_list.updated', garageId as string);
    expect(updated.map((event) => event.payload)).toEqual([
      { brandIds: [], garageId, jobTypeIds: [job.id] },
    ]);
  });

  it('records no price list update when the default row is gone, and no garage when it is gone', async () => {
    const rowless = await proposal({ row: false });
    const gone = await proposal({ garageId: null, name: 'Fără service' });

    await service().approve(ana, rowless.job.id, APPROVAL);
    await service().approve(ana, gone.job.id, {
      ...APPROVAL,
      nameEn: 'No garage',
      nameRo: 'Fără service',
    });

    expect(
      await eventsOf('price_list.updated', rowless.garageId as string),
    ).toEqual([]);
    const [decided] = await eventsOf('catalogue_job.decided', gone.job.id);
    expect(decided?.payload).toEqual({
      decision: 'approved',
      jobTypeId: gone.job.id,
    });
    expect(decided?.audience).toEqual(['admin']);
  });

  it.each([
    ['nameRo', { nameRo: 'SCHIMB ULEI' }],
    ['nameEn', { nameEn: 'oil change' }],
    ['nameEn', { nameEn: 'Schimb ulei' }],
  ] as const)(
    'refuses a %s equal to an approved job and writes nothing',
    async (field, names) => {
      const oil = await prisma.jobType.create({
        data: {
          key: 'schimb-ulei',
          nameEn: 'Oil change',
          nameRo: 'Schimb ulei',
          status: 'approved',
        },
      });
      const { job } = await proposal();

      const res = await refusal(
        service().approve(ana, job.id, { ...APPROVAL, ...names }),
      );

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'exists',
        errors: [{ code: 'exists', field }],
        jobTypeId: oil.id,
        nameRo: 'Schimb ulei',
      });
      expect((await jobOf(job.id)).status).toBe('pending');
      expect(await entriesOf(job.id)).toEqual([]);
    },
  );

  it('refuses an activity the RAR list does not hold', async () => {
    const { job } = await proposal();

    const res = await refusal(
      service().approve(ana, job.id, { ...APPROVAL, rarActivity: 'flying' }),
    );

    expect([res.status, res.body['code']]).toEqual([422, 'unknown_activity']);
    expect((await jobOf(job.id)).status).toBe('pending');
  });

  it('decides the job of a suspended garage', async () => {
    const garage = await garageOf('Service Suspendat', 'suspended');
    const { job } = await proposal({ garageId: garage.id });

    await service().approve(ana, job.id, APPROVAL);

    expect((await jobOf(job.id)).status).toBe('approved');
  });

  it('leaves nothing behind when the transaction fails', async () => {
    const { garageId, job } = await proposal();
    const failing: EventPort = {
      record: () => Promise.reject(new Error('outbox down')),
    };

    await expect(
      service(failing).approve(ana, job.id, APPROVAL),
    ).rejects.toThrow('outbox down');

    expect(await jobOf(job.id)).toMatchObject({
      decidedBy: null,
      status: 'pending',
    });
    expect(await entriesOf(job.id)).toEqual([]);
    expect(
      await prisma.outboxEvent.count({
        where: { subjectId: { in: [job.id, garageId as string] } },
      }),
    ).toBe(0);
  });

  it('makes the job pickable by another garage and public on the proposer profile', async () => {
    const { garageId, job } = await proposal();

    await service().approve(ana, job.id, APPROVAL);

    const { items } = await new JobTypesService(prisma).search({
      q: 'injectoare',
    });
    expect(items.map((item) => item.id)).toEqual([job.id]);
    const rows = await prisma.garagePrice.findMany({
      select: PRICE_ROW_SELECT,
      where: { garageId: garageId as string },
    });
    expect(priceListJobs(rows, [])).toEqual([
      expect.objectContaining({ jobTypeId: job.id, public: true }),
    ]);
  });

  it('logs the job, the decision and the admin after it commits', async () => {
    const { job } = await proposal();
    const log = jest.spyOn(Logger.prototype, 'log');

    await service().approve(ana, job.id, APPROVAL);

    expect(log).toHaveBeenCalledWith(
      `decided job=${job.id} decision=approved admin=${ana.accountId}`,
    );
    log.mockRestore();
  });
});

describe('a rejection', () => {
  it('writes the trimmed reason and the decider, the audit entry and the event', async () => {
    const { garageId, job } = await proposal();

    const answer = await service().reject(ana, job.id, {
      reason: `  ${REASON} `,
    });

    const stored = await jobOf(job.id);
    expect(stored).toMatchObject({
      decidedBy: ana.accountId,
      nameRo: 'Recondiționare injectoare',
      rejectionReason: REASON,
      status: 'rejected',
    });
    expect(answer).toEqual({
      decidedAt: stored.decidedAt?.toISOString(),
      id: job.id,
      nameEn: 'Recondiționare injectoare',
      nameRo: 'Recondiționare injectoare',
      rejectionReason: REASON,
      status: 'rejected',
    });
    const entries = await entriesOf(job.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorRole: 'admin',
      newValue: { rejection_reason: REASON, status: 'rejected' },
      oldValue: { status: 'pending' },
    });
    const [decided] = await eventsOf('catalogue_job.decided', job.id);
    expect(decided?.payload).toEqual({
      decision: 'rejected',
      garageId,
      jobTypeId: job.id,
    });
    expect(await eventsOf('price_list.updated', garageId as string)).toEqual(
      [],
    );
  });

  it('logs a line that never carries the reason', async () => {
    const { job } = await proposal();
    const log = jest.spyOn(Logger.prototype, 'log');

    await service().reject(ana, job.id, { reason: REASON });

    expect(log).toHaveBeenCalledWith(
      `decided job=${job.id} decision=rejected admin=${ana.accountId}`,
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('generică');
    log.mockRestore();
  });
});

describe('a second decision', () => {
  it.each([
    ['approved', 'Already approved by Ana'],
    ['rejected', 'Already rejected by Ana'],
  ] as const)(
    'is refused with 409 naming who %s it, and writes nothing',
    async (first, message) => {
      const { job } = await proposal();
      if (first === 'approved') await service().approve(ana, job.id, APPROVAL);
      else await service().reject(ana, job.id, { reason: REASON });
      const decided = await jobOf(job.id);

      const res = await refusal(
        service().approve(mihai, job.id, {
          ...APPROVAL,
          nameEn: 'Other name',
          nameRo: 'Alt nume',
        }),
      );

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'already_decided', message });
      expect(await jobOf(job.id)).toEqual(decided);
      expect(await entriesOf(job.id)).toHaveLength(1);
      expect(await eventsOf('catalogue_job.decided', job.id)).toHaveLength(1);
    },
  );

  it('says only that it was decided when the deciding account is gone', async () => {
    const { job } = await proposal();
    await service().reject(ana, job.id, { reason: REASON });
    await prisma.jobType.update({
      data: { decidedBy: null },
      where: { id: job.id },
    });

    const res = await refusal(
      service().reject(mihai, job.id, { reason: REASON }),
    );

    expect(res.body).toMatchObject({
      code: 'already_decided',
      message: 'Already decided',
    });
  });

  it('leaves one decision when two arrive at once', async () => {
    const { job } = await proposal();

    const outcomes = await Promise.allSettled([
      service().approve(ana, job.id, APPROVAL),
      service().reject(mihai, job.id, { reason: REASON }),
    ]);

    expect(outcomes.map((o) => o.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(await entriesOf(job.id)).toHaveLength(1);
    expect(await eventsOf('catalogue_job.decided', job.id)).toHaveLength(1);
  });

  it('answers 404 for an unknown job', async () => {
    const res = await refusal(
      service().reject(ana, randomUUID(), { reason: REASON }),
    );

    expect([res.status, res.body['code']]).toEqual([404, 'not_found']);
  });
});
