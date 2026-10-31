// @traces 061-FR-001
// @traces 061-FR-002
// @traces 061-FR-003
// @traces 061-FR-004
import { PAID_BANI_MAX } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { RepairFromJob } from './repair-from-job';
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

describe('the repair-from-job handler under hostile events', () => {
  it('ends without a retry for an event with no subject and writes nothing', async () => {
    await handedOver();
    const handler = await start();

    await expect(
      handler.onEvent({
        data: { id: '1', kind: 'job.handed_over', payload: {} },
      }),
    ).resolves.toBeUndefined();

    expect(await prisma.repair.count()).toBe(0);
    expect(await updatedEvents()).toEqual([]);
  });

  it('ends without a retry for a subject that is no uuid', async () => {
    const handler = await start();

    await expect(
      handler.onEvent(handover('not-a-uuid')),
    ).resolves.toBeUndefined();

    expect(await prisma.repair.count()).toBe(0);
  });

  it('ends without a retry for an empty-string subject', async () => {
    const handler = await start();

    await expect(handler.onEvent(handover(''))).resolves.toBeUndefined();

    expect(await prisma.repair.count()).toBe(0);
  });

  it('ends without a retry for an unknown job uuid and counts job_missing', async () => {
    const handler = await start();

    const outcome = await handler.syncFromJob(
      '3f2c1b0a-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
    );

    expect(outcome).toBe('job_missing');
    expect(await prisma.repair.count()).toBe(0);
  });

  it('ignores an event of another kind even for a handed-over job', async () => {
    const { job } = await handedOver();
    const handler = await start();

    for (const kind of ['job.done', 'job.cancelled', 'job.handed_over.x', '']) {
      await handler.onEvent(event(kind, job.id));
    }

    expect(await repairsOf(job.id)).toEqual([]);
  });

  it('writes nothing for a price correction on a job never handed over', async () => {
    const { job } = await handedOver({ handedOverAt: null, priceBani: null });
    const handler = await start();

    await handler.onEvent(correction(job.id));

    expect(await repairsOf(job.id)).toEqual([]);
    expect(await updatedEvents()).toEqual([]);
  });

  it('tolerates a payload carrying hostile values since it reads none of them', async () => {
    const { job } = await handedOver();
    const handler = await start();

    await handler.onEvent(
      event('job.handed_over', job.id, {
        by: { $ne: 1 },
        finalPriceBani: 'NaN',
      }),
    );

    const [repair] = await repairsOf(job.id);
    expect(repair.costBani).toBe(125_000);
  });
});

describe('the repair-from-job handler at its boundaries', () => {
  it('creates the row for the smallest price and follows a correction up from it', async () => {
    const { job } = await handedOver({ priceBani: 1 });
    const handler = await start();

    await handler.onEvent(handover(job.id));
    const [created] = await repairsOf(job.id);
    expect(created.costBani).toBe(1);

    await price(job.id, 5_000);
    await handler.onEvent(correction(job.id));

    const [updated] = await repairsOf(job.id);
    expect(updated.costBani).toBe(5_000);
    expect(await auditOf(created.id)).toHaveLength(2);
  });

  it('follows a correction down to the smallest price', async () => {
    const { job } = await handedOver();
    const handler = await start();
    await handler.onEvent(handover(job.id));

    await price(job.id, 1);
    await handler.onEvent(correction(job.id));

    const [row] = await repairsOf(job.id);
    expect(row.costBani).toBe(1);
  });

  it('keeps a price of 92 000 000 bani', async () => {
    const { job } = await handedOver({ priceBani: 92_000_000 });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [row] = await repairsOf(job.id);
    expect(row.costBani).toBe(92_000_000);
  });

  it('does not reject a handover priced at the most the final-price route accepts', async () => {
    const { job } = await handedOver({ priceBani: PAID_BANI_MAX });
    const handler = await start();

    await expect(handler.onEvent(handover(job.id))).resolves.toBeUndefined();
  });

  it('does not reject a correction to the most the final-price route accepts', async () => {
    const { job } = await handedOver({ priceBani: 100 });
    const handler = await start();
    await handler.onEvent(handover(job.id));
    await price(job.id, PAID_BANI_MAX);

    await expect(handler.onEvent(correction(job.id))).resolves.toBeUndefined();
  });

  it('writes one entry per real change over a price that goes 1, 2, 1, 1', async () => {
    const { job } = await handedOver({ priceBani: 100 });
    const handler = await start();
    await handler.onEvent(handover(job.id));

    for (const bani of [200, 100, 100]) {
      await price(job.id, bani);
      await handler.onEvent(correction(job.id, String(bani)));
    }

    const [row] = await repairsOf(job.id);
    expect(row.costBani).toBe(100);
    expect(await auditOf(row.id)).toHaveLength(3);
    expect(await updatedEvents()).toHaveLength(3);
  });

  it.each([
    ['2026-10-03T20:59:59Z', '2026-10-03'],
    ['2026-10-03T21:00:00Z', '2026-10-04'],
    ['2026-10-24T21:00:00Z', '2026-10-25'],
    ['2026-10-25T21:59:59Z', '2026-10-25'],
    ['2026-10-25T22:00:00Z', '2026-10-26'],
    ['2026-12-31T22:00:00Z', '2027-01-01'],
    ['2026-12-31T21:59:59Z', '2026-12-31'],
    ['2027-03-27T21:59:59Z', '2027-03-27'],
    ['2027-03-27T22:00:00Z', '2027-03-28'],
  ])('puts a job finished at %s on the day %s', async (finished, day) => {
    const { job } = await handedOver({
      finishedAt: new Date(finished),
      handedOverAt: new Date('2027-04-10T06:00:00Z'),
    });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    expect(repair.doneOn).toEqual(new Date(`${day}T00:00:00Z`));
  });

  it('keeps every unicode job name and the ", " join over forty included jobs', async () => {
    const names: [string, string][] = Array.from({ length: 40 }, (_, n) => [
      `Lucrare ${n} ăîșțâ 🔧`,
      `Job ${n}`,
    ]);
    const { job } = await handedOver({ jobs: names });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    expect(repair.what).toBe(names.map(([ro]) => ro).join(', '));
  });

  it('leaves the reading as zero when the reception recorded zero', async () => {
    const { job } = await handedOver({ odometerKm: 0 });
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    expect(repair.odometerKm).toBe(0);
  });
});

describe('the repair-from-job handler over many and mixed runs', () => {
  it('leaves one row, one entry and one event over twelve concurrent runs of both kinds', async () => {
    const { job } = await handedOver();
    const handler = await start();

    await Promise.all(
      Array.from({ length: 12 }, (_, n) =>
        handler.onEvent(
          n % 2 ? handover(job.id, String(n)) : correction(job.id, String(n)),
        ),
      ),
    );

    const repairs = await repairsOf(job.id);
    expect(repairs).toHaveLength(1);
    expect(await auditOf(repairs[0].id)).toHaveLength(1);
    expect(await updatedEvents()).toHaveLength(1);
  });

  it('settles on the job’s price when corrections run concurrently with the handover', async () => {
    const { job } = await handedOver({ priceBani: 100 });
    const handler = await start();
    await handler.onEvent(handover(job.id));
    await price(job.id, 900);

    await Promise.all(
      Array.from({ length: 6 }, (_, n) =>
        handler.onEvent(correction(job.id, String(n))),
      ),
    );

    const [row] = await repairsOf(job.id);
    expect(row.costBani).toBe(900);
    const updates = (await auditOf(row.id)).filter(
      (e) => e.action === 'update',
    );
    expect(updates).toHaveLength(1);
    expect(await updatedEvents()).toHaveLength(2);
  });

  it('gives each of two handed-over jobs on one car its own row', async () => {
    const first = await handedOver();
    const second = await handedOver();
    const handler = await start();

    await handler.onEvent(handover(first.job.id));
    await handler.onEvent(handover(second.job.id));

    expect(await repairsOf(first.job.id)).toHaveLength(1);
    expect(await repairsOf(second.job.id)).toHaveLength(1);
    expect(await prisma.repair.count()).toBe(2);
  });

  it('never writes a second row after the first was soft-deleted', async () => {
    const { job } = await handedOver();
    const handler = await start();
    await handler.onEvent(handover(job.id));
    await prisma.repair.updateMany({
      data: { deletedAt: new Date() },
      where: { jobId: job.id },
    });

    await handler.onEvent(handover(job.id, '9'));

    expect(await repairsOf(job.id)).toHaveLength(1);
  });

  it('records the repair.updated event for the owner of the car with the repair and car named', async () => {
    const { carId, driver, job } = await handedOver();
    const handler = await start();

    await handler.onEvent(handover(job.id));

    const [repair] = await repairsOf(job.id);
    const [emitted] = await updatedEvents();
    expect(emitted.payload).toEqual({
      by: 'system',
      carId,
      changed: ['created'],
      garageId: repair.garageId,
      ownerId: driver,
      repairId: repair.id,
    });
  });

  it('logs no price, no plate and no phone over a handover and a correction', async () => {
    const { job } = await handedOver({ priceBani: 987_654 });
    const handler = await start();

    await handler.onEvent(handover(job.id));
    await price(job.id, 123_456);
    await handler.onEvent(correction(job.id));

    const text = logged.join('\n');
    expect(text).not.toContain('987654');
    expect(text).not.toContain('123456');
    expect(text).not.toContain('987_654');
    expect(text).not.toContain('B123ABC');
  });
});
