// @traces 061-FR-001
// @traces 061-FR-002
// @traces 061-FR-003
// @traces 061-FR-004
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { REPAIR_FROM_JOB_CONSUMER, RepairFromJob } from './repair-from-job';
import { RepairFromJobModule } from './repair-from-job.module';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { BookingStatus } from '../../generated/prisma/client';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { quotesWorld } from '../../quotes/quotes.testing';

const redisUrl = redisUrlFor(10);
const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

let app: TestingModule | undefined;
let logged: string[] = [];

beforeEach(async () => {
  logged = [];
  vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
    logged.push(String(message));
  });
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  await world.reset();
  await prisma.outboxEvent.deleteMany();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

// Compiled, never started: each case hands the handler its event itself.
async function start(audit?: AuditPort) {
  let builder = Test.createTestingModule({
    imports: [
      RepairFromJobModule.registerWorker({
        notifications: NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          redisUrl,
        }),
        redisUrl,
      }),
    ],
  });
  if (audit) builder = builder.overrideProvider(AUDIT_PORT).useValue(audit);
  app = await builder.compile();
  return app.get(RepairFromJob);
}

// 16:40 in Bucharest on 3 October 2026, summer time.
const FINISHED = new Date('2026-10-03T13:40:00Z');
const HANDED_OVER = new Date('2026-10-03T14:30:00Z');

// Andrei's job at Garaj Nordic by Mihai Dumitru, quoted for the jobs named
// and handed over at the price given; a job quoted but left out of the
// accepted quote is never named.
async function handedOver(
  options: {
    bookingStatus?: BookingStatus;
    finishedAt?: Date | null;
    handedOverAt?: Date | null;
    jobs?: [string, string][];
    odometerKm?: number | null;
    priceBani?: number | null;
  } = {},
) {
  const driver = await world.account('Andrei Marin');
  const garage = await world.garage('Garaj Nordic');
  const mechanic = await prisma.mechanic.create({
    data: { garageId: garage.id, name: 'Mihai Dumitru' },
  });
  const { booking, quote, request } = await world.chain(driver, garage.id, {
    booking: options.bookingStatus ?? 'completed',
  });
  const [left] = await prisma.requestJob.findMany({
    where: { requestId: request.id },
  });
  await prisma.quoteJob.create({
    data: { included: false, quoteId: quote.id, requestJobId: left.id },
  });
  const names = options.jobs ?? [
    ['Plăcuțe și discuri față', 'Front pads and discs'],
  ];
  for (const [index, [nameRo, nameEn]] of names.entries()) {
    const type = await world.jobType(nameRo, nameEn);
    const asked = await prisma.requestJob.create({
      data: {
        jobTypeId: type.id,
        position: index + 1,
        requestId: request.id,
      },
    });
    await prisma.quoteJob.create({
      data: { included: true, quoteId: quote.id, requestJobId: asked.id },
    });
  }
  const created = await world.job(booking.id, 'done', {
    mechanicId: mechanic.id,
  });
  const handed =
    options.handedOverAt === undefined ? HANDED_OVER : options.handedOverAt;
  const job = await prisma.job.update({
    data: {
      finalPriceBani:
        options.priceBani === undefined
          ? handed
            ? 125_000
            : null
          : options.priceBani,
      finishedAt:
        options.finishedAt === undefined ? FINISHED : options.finishedAt,
      handedOverAt: handed,
      odometerKm:
        options.odometerKm === undefined ? 148_250 : options.odometerKm,
      receivedAt: new Date('2026-10-03T06:00:00Z'),
    },
    where: { id: created.id },
  });
  return { carId: request.carId, driver, garage, job };
}

const event = (
  kind: string,
  jobId: string,
  payload: Record<string, unknown> = {},
  id = '1',
) => ({ data: { id, kind, payload, subjectId: jobId } });

const handover = (jobId: string, id = '1') =>
  event('job.handed_over', jobId, { by: 'x', finalPriceBani: 125_000 }, id);

const correction = (jobId: string, id = '2') =>
  event(
    'job.final_price_corrected',
    jobId,
    { by: 'x', newBani: 1, oldBani: 2 },
    id,
  );

const repairsOf = (jobId: string) =>
  prisma.repair.findMany({ where: { jobId } });

const auditOf = (repairId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId: repairId, subjectType: 'repair' },
  });

const updatedEvents = () =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { kind: 'repair.updated' },
  });

const price = (jobId: string, finalPriceBani: number) =>
  prisma.job.update({ data: { finalPriceBani }, where: { id: jobId } });

describe('the repair a handed-over job leaves in the car’s history', () => {
  it('takes the handover and the price correction on its own queue, nothing else', () => {
    expect(REPAIR_FROM_JOB_CONSUMER).toMatchObject({
      queue: 'repair-from-job',
    });
    expect([...REPAIR_FROM_JOB_CONSUMER.kinds].sort()).toEqual([
      'job.final_price_corrected',
      'job.handed_over',
    ]);
    expect(REPAIR_FROM_JOB_CONSUMER.jobs).toMatchObject({
      attempts: 6,
      backoff: { delay: 60_000, type: 'exponential' },
    });
  });

  it('writes the row with every field from the job at the handover', async () => {
    const { carId, garage, job } = await handedOver();
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair, ...more] = await repairsOf(job.id);
    expect(more).toEqual([]);
    expect(repair).toMatchObject({
      carId,
      costBani: 125_000,
      deletedAt: null,
      doneOn: new Date('2026-10-03T00:00:00Z'),
      garageId: garage.id,
      garageName: 'Garaj Nordic',
      jobId: job.id,
      odometerKm: 148_250,
      source: 'motorfix',
      updatedBy: null,
      updatedByRole: null,
      what: 'Plăcuțe și discuri față',
    });
  });

  it('names the included jobs in Romanian by their asked order', async () => {
    const { job } = await handedOver({
      jobs: [
        ['Plăcuțe față', 'Front pads'],
        ['Discuri față', 'Front discs'],
      ],
    });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    expect(repair.what).toBe('Plăcuțe față, Discuri față');
  });

  it('names a job with no included quoted job a MotorFix job', async () => {
    const { job } = await handedOver({ jobs: [] });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    expect(repair.what).toBe('Lucrare MotorFix');
  });

  it('records one create entry by the system naming the job, and one repair.updated by the system', async () => {
    const { carId, driver, garage, job } = await handedOver();
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    expect(await auditOf(repair.id)).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: null,
        actorRole: 'system',
        carId,
        garageId: garage.id,
        jobId: job.id,
        newValue: {
          carId,
          costBani: 125_000,
          doneOn: '2026-10-03',
          garageId: garage.id,
          garageName: 'Garaj Nordic',
          jobId: job.id,
          odometerKm: 148_250,
          source: 'motorfix',
          what: 'Plăcuțe și discuri față',
        },
      }),
    ]);
    const events = await updatedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: [`account:${driver}`],
      payload: {
        by: 'system',
        carId,
        changed: ['created'],
        garageId: garage.id,
        ownerId: driver,
        repairId: repair.id,
      },
      subjectId: repair.id,
    });
  });

  it('leaves one row, one entry and one event over two runs of the handover', async () => {
    const { job } = await handedOver();
    const handler = await start();

    await handler.onEvent(handover(job.id, '1'));
    await handler.onEvent(handover(job.id, '1'));

    const repairs = await repairsOf(job.id);
    expect(repairs).toHaveLength(1);
    expect(await auditOf(repairs[0].id)).toHaveLength(1);
    expect(await updatedEvents()).toHaveLength(1);
  });

  it('leaves one row, one entry and one event over two concurrent runs', async () => {
    const { job } = await handedOver();
    const handler = await start();

    await Promise.all([
      handler.onEvent(handover(job.id, '1')),
      handler.onEvent(handover(job.id, '2')),
    ]);

    const repairs = await repairsOf(job.id);
    expect(repairs).toHaveLength(1);
    expect(await auditOf(repairs[0].id)).toHaveLength(1);
    expect(await updatedEvents()).toHaveLength(1);
  });

  it('writes nothing for a job done but not handed over', async () => {
    const { job } = await handedOver({ handedOverAt: null });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    expect(await repairsOf(job.id)).toEqual([]);
    expect(await updatedEvents()).toEqual([]);
  });

  it('writes nothing for job.done, whatever the job', async () => {
    const { job } = await handedOver();
    const handler = await start();

    await handler.onEvent(event('job.done', job.id));

    expect(await repairsOf(job.id)).toEqual([]);
  });

  it.each(['cancelled', 'lapsed', 'no_show'] as const)(
    'writes nothing for a %s booking',
    async (bookingStatus) => {
      const { job } = await handedOver({
        bookingStatus,
        finishedAt: null,
        handedOverAt: null,
      });
      const handler = await start();

      await handler.onEvent(handover(job.id));

      expect(await repairsOf(job.id)).toEqual([]);
    },
  );

  it('counts the day finished in Bucharest, past midnight there', async () => {
    const { job } = await handedOver({
      finishedAt: new Date('2026-10-03T21:30:00Z'),
      handedOverAt: new Date('2026-10-04T06:00:00Z'),
    });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    expect(repair.doneOn).toEqual(new Date('2026-10-04T00:00:00Z'));
  });

  it('takes the handover’s day for a job with no finishing time', async () => {
    const { job } = await handedOver({
      finishedAt: null,
      handedOverAt: new Date('2026-10-05T08:00:00Z'),
    });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    expect(repair.doneOn).toEqual(new Date('2026-10-05T00:00:00Z'));
    expect(logged).toContain(
      `job ${job.id}: no finished_at, done_on from the handover day`,
    );
  });

  it('leaves the reading empty when the reception recorded none', async () => {
    const { job } = await handedOver({ odometerKm: null });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    expect(repair.odometerKm).toBeNull();
    expect(repair.costBani).toBe(125_000);
  });

  it('follows a corrected price with one update entry and one event', async () => {
    const { job } = await handedOver();
    const handler = await start();
    await handler.onEvent(handover(job.id));
    await price(job.id, 115_000);

    await handler.onEvent(correction(job.id));

    const [repair] = await repairsOf(job.id);
    expect(repair.costBani).toBe(115_000);
    const entries = await auditOf(repair.id);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      action: 'update',
      actorId: null,
      actorRole: 'system',
      field: 'cost_bani',
      jobId: job.id,
      newValue: 115_000,
      oldValue: 125_000,
    });
    const events = await updatedEvents();
    expect(events).toHaveLength(2);
    expect(events[1].payload).toMatchObject({
      by: 'system',
      changed: ['costBani'],
      repairId: repair.id,
    });
  });

  it('reads the price from the job, not from the event', async () => {
    const { job } = await handedOver({ priceBani: 99_000 });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    expect(repair.costBani).toBe(99_000);
  });

  it('writes nothing for a correction to the price the row already holds', async () => {
    const { job } = await handedOver();
    const handler = await start();
    await handler.onEvent(handover(job.id));

    await handler.onEvent(correction(job.id));

    const [repair] = await repairsOf(job.id);
    expect(await auditOf(repair.id)).toHaveLength(1);
    expect(await updatedEvents()).toHaveLength(1);
    expect(logged.some((line) => line.endsWith('unchanged'))).toBe(true);
  });

  it('creates the row from a correction that runs before the handover’s run, and the later handover changes nothing', async () => {
    const { job } = await handedOver();
    await price(job.id, 115_000);
    const handler = await start();

    await handler.onEvent(correction(job.id));
    await handler.onEvent(handover(job.id));

    const repairs = await repairsOf(job.id);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].costBani).toBe(115_000);
    const entries = await auditOf(repairs[0].id);
    expect(entries.map((entry) => entry.action)).toEqual(['create']);
  });

  it('ends without a retry for a job that is gone, and logs it without amounts', async () => {
    const handler = await start();
    const gone = '9b1f6a3e-4c2d-4e5f-8a7b-0c1d2e3f4a5b';

    await expect(handler.onEvent(handover(gone))).resolves.toBeUndefined();

    expect(await prisma.repair.count()).toBe(0);
    expect(logged).toContainEqual(expect.stringContaining(gone));
    expect(logged.some((line) => line.includes('job_missing'))).toBe(true);
  });

  it('logs the job, the repair and the outcome, never the amount', async () => {
    const { job } = await handedOver();
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    const line = logged.find((l) => l.includes(repair.id));
    expect(line).toContain(job.id);
    expect(line).toContain('created');
    expect(logged.join('\n')).not.toMatch(/125[.,]?000|1250/);
  });

  it('rolls the row and its event back when the audit write fails', async () => {
    const { job } = await handedOver();
    const failing: AuditPort = {
      record: () => Promise.reject(new Error('audit down')),
      recordChanges: () => Promise.reject(new Error('audit down')),
      recordMany: () => Promise.reject(new Error('audit down')),
    };
    const handler = await start(failing);

    await expect(handler.onEvent(handover(job.id))).rejects.toThrow(
      'audit down',
    );

    expect(await repairsOf(job.id)).toEqual([]);
    expect(await updatedEvents()).toEqual([]);
  });

  it('keeps the old price when the audit write of a correction fails', async () => {
    const { job } = await handedOver();
    const handler = await start();
    await handler.onEvent(handover(job.id));
    await app?.close();
    const failing: AuditPort = {
      record: () => Promise.reject(new Error('audit down')),
      recordChanges: () => Promise.reject(new Error('audit down')),
      recordMany: () => Promise.reject(new Error('audit down')),
    };
    const broken = await start(failing);
    await price(job.id, 115_000);

    await expect(broken.onEvent(correction(job.id))).rejects.toThrow(
      'audit down',
    );

    const [repair] = await repairsOf(job.id);
    expect(repair.costBani).toBe(125_000);
    expect(await updatedEvents()).toHaveLength(1);
  });
});
