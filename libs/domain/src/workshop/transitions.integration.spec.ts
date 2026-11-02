import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpException } from '@nestjs/common';

import { JOB_MOVES, moveJob } from './transitions';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { outbox } from '../events/event.port';
import { JobStatus } from '../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const ports = { audit: new AuditService(), events: outbox };

let driver: string;
let owner: string;
let garageId: string;

beforeAll(async () => {
  await world.reset();
  driver = await world.account('Andrei Marin', ['driver']);
  owner = await world.account('Ion Popescu', ['garage']);
  garageId = (await world.garage('Atelier Dinamo')).id;
});

async function jobIn(status: JobStatus, mechanicId?: string) {
  const { booking } = await world.chain(driver, garageId);
  return world.job(booking.id, status, { mechanicId });
}

const move = (id: string, to: JobStatus, text?: string, auto?: boolean) =>
  prisma.$transaction((tx) =>
    moveJob(tx, ports, {
      actor: { accountId: owner, role: 'garage' },
      auto,
      event: {
        audience: {
          driverAccountId: driver,
          garageId,
          mechanicId: null,
          type: 'job',
        },
        kind: 'job.started',
      },
      id,
      text,
      to,
    }),
  );

const statuses = Object.values(JobStatus);

// @traces 220-FR-007
// @traces 220-FR-008
// @traces 276-FR-001 276-FR-003
// @traces 1259-FR-003
// @traces 1259-FR-006
describe('moveJob', () => {
  it('holds exactly the moves of the job diagram', () => {
    expect(JOB_MOVES).toEqual({
      cancelled: ['to_do'],
      done: [],
      in_work: ['paused', 'done'],
      paused: ['in_work', 'done'],
      to_do: ['in_work', 'cancelled'],
    });
  });

  const pairs = statuses.flatMap((from) =>
    statuses.map((to) => [from, to] as const),
  );
  const stamps: Partial<Record<JobStatus, Record<string, unknown>>> = {
    done: { finishedAt: expect.any(Date) },
    in_work: { startedAt: expect.any(Date) },
    paused: { pausedAt: expect.any(Date) },
  };

  it.each(pairs.filter(([from, to]) => JOB_MOVES[from].includes(to)))(
    'moves from %s to %s',
    async (from, to) => {
      const job = await jobIn(from);

      await move(job.id, to);

      const after = await prisma.job.findUniqueOrThrow({
        include: { stages: true },
        where: { id: job.id },
      });
      expect(after).toMatchObject({ status: to, ...stamps[to] });
      expect(after.stages).toEqual([
        expect.objectContaining({
          actorId: owner,
          actorRole: 'owner',
          fromStatus: from,
          toStatus: to,
        }),
      ]);
      expect(
        await prisma.activityLog.findMany({ where: { subjectId: job.id } }),
      ).toEqual([
        expect.objectContaining({
          field: 'status',
          garageId,
          isKeyChange: true,
          jobId: job.id,
          newValue: to,
          oldValue: from,
          subjectType: 'job',
        }),
      ]);
      expect(
        await prisma.outboxEvent.findMany({ where: { subjectId: job.id } }),
      ).toHaveLength(1);
    },
  );

  it.each(pairs.filter(([from, to]) => !JOB_MOVES[from].includes(to)))(
    'refuses a move from %s to %s',
    async (from, to) => {
      const job = await jobIn(from);

      const error = await move(job.id, to).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'invalid_transition',
        currentStatus: from,
        entity: 'job',
        to,
      });
      expect(
        await prisma.jobStageEntry.count({ where: { jobId: job.id } }),
      ).toBe(0);
      expect(
        await prisma.activityLog.count({ where: { subjectId: job.id } }),
      ).toBe(0);
    },
  );

  it('keeps the first start time when work resumes after a pause', async () => {
    const job = await jobIn('to_do');
    await move(job.id, 'in_work');
    const { startedAt } = await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
    });

    await move(job.id, 'paused');
    await move(job.id, 'in_work');

    const after = await prisma.job.findUniqueOrThrow({
      include: { stages: { orderBy: { at: 'asc' } } },
      where: { id: job.id },
    });
    expect(after.startedAt).toEqual(startedAt);
    expect(after.stages.map((s) => [s.fromStatus, s.toStatus])).toEqual([
      ['to_do', 'in_work'],
      ['in_work', 'paused'],
      ['paused', 'in_work'],
    ]);
  });

  it('keeps the garage’s words for the driver on the stage entry', async () => {
    const job = await jobIn('in_work');

    await move(job.id, 'paused', 'Așteptăm plăcuțele de frână');

    expect(
      await prisma.jobStageEntry.findFirstOrThrow({ where: { jobId: job.id } }),
    ).toMatchObject({
      text: 'Așteptăm plăcuțele de frână',
      toStatus: 'paused',
    });
  });

  it('writes no stage entry when the caller rolls back', async () => {
    const job = await jobIn('to_do');

    await expect(
      prisma.$transaction(async (tx) => {
        await moveJob(tx, ports, {
          actor: { accountId: owner, role: 'garage' },
          event: {
            audience: {
              driverAccountId: driver,
              garageId,
              mechanicId: null,
              type: 'job',
            },
            kind: 'job.started',
          },
          id: job.id,
          to: 'in_work',
        });
        throw new Error('the next write failed');
      }),
    ).rejects.toThrow('the next write failed');

    expect(
      await prisma.job.findUniqueOrThrow({
        include: { stages: true },
        where: { id: job.id },
      }),
    ).toMatchObject({ stages: [], startedAt: null, status: 'to_do' });
  });
});

const stages = (jobId: string) =>
  prisma.jobStageEntry.findMany({
    orderBy: [{ at: 'asc' }, { id: 'asc' }],
    where: { jobId },
  });

// The latest entry into work, moved back so the job has been in work a while.
// Moves the whole history and the running clock back, so the entries keep
// their order.
async function inWorkFor(jobId: string, ms: number) {
  await prisma.$executeRaw`
    UPDATE job_stage_entry SET at = at - ${ms} * interval '1 millisecond'
    WHERE job_id = ${jobId}::uuid`;
  await prisma.$executeRaw`
    UPDATE job SET in_work_since = in_work_since - ${ms} * interval '1 millisecond'
    WHERE id = ${jobId}::uuid`;
}

const worked = async (jobId: string) =>
  (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).workedSeconds;

// @traces 276-FR-004 276-FR-015
describe('the stage entry of a move', () => {
  it('carries the job’s mechanic and is not automatic by default', async () => {
    const account = await world.account('Mihai Dobre', ['mechanic']);
    const mechanic = await prisma.mechanic.create({
      data: { accountId: account, garageId, name: 'Mihai' },
    });
    const job = await jobIn('to_do', mechanic.id);

    await move(job.id, 'in_work');

    expect(await stages(job.id)).toEqual([
      expect.objectContaining({ auto: false, mechanicId: mechanic.id }),
    ]);
  });

  it('has no mechanic when the job has none, and is marked when automatic', async () => {
    const job = await jobIn('in_work');

    await move(job.id, 'paused', undefined, true);

    expect(await stages(job.id)).toEqual([
      expect.objectContaining({ auto: true, mechanicId: null }),
    ]);
  });
});

// @traces 276-FR-006 276-FR-015
describe('the time a job spends in work', () => {
  it('starts at nothing', async () => {
    const job = await jobIn('to_do');

    expect(job.workedSeconds).toBe(0);
  });

  it('adds the whole seconds since the latest start on a pause by hand or an automatic one', async () => {
    const job = await jobIn('to_do');
    await move(job.id, 'in_work');
    await inWorkFor(job.id, 90_400);

    await move(job.id, 'paused');
    expect(await worked(job.id)).toBe(90);

    await move(job.id, 'in_work');
    await inWorkFor(job.id, 30_900);
    await move(job.id, 'paused', undefined, true);
    expect(await worked(job.id)).toBe(120);
  });

  it('adds the time since the resume on a finish from work', async () => {
    const job = await jobIn('to_do');
    await move(job.id, 'in_work');
    await inWorkFor(job.id, 10_000);
    await move(job.id, 'paused');
    await move(job.id, 'in_work');
    await inWorkFor(job.id, 45_000);

    await move(job.id, 'done');

    expect(await worked(job.id)).toBe(55);
  });

  it('adds nothing on a finish from a pause', async () => {
    const job = await jobIn('to_do');
    await move(job.id, 'in_work');
    await inWorkFor(job.id, 20_000);
    await move(job.id, 'paused');

    await move(job.id, 'done');

    expect(await worked(job.id)).toBe(20);
    expect(
      await prisma.job.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({ finishedAt: expect.any(Date), status: 'done' });
  });
});

const reread = (jobId: string) =>
  prisma.job.findUniqueOrThrow({ where: { id: jobId } });

const MIGRATION = join(
  __dirname,
  '../../prisma/migrations/20261102120000_job_in_work_since/migration.sql',
);

// The database under test is already migrated, so only the migration's data
// statements can be run again over rows seeded after it.
const backfill = () =>
  readFileSync(MIGRATION, 'utf8')
    .split(/;\s*$/m)
    .map((sql) => sql.replace(/--.*$/gm, '').trim())
    .filter((sql) => /^UPDATE\b/i.test(sql));

// @traces 122-one-job-status-FR-002 122-one-job-status-FR-003
describe('the running clock of a job in work', () => {
  it('starts on a move into work and stops on every move out of it', async () => {
    const job = await jobIn('to_do');

    await move(job.id, 'in_work');
    const [start] = await stages(job.id);
    expect(await reread(job.id)).toMatchObject({ inWorkSince: start.at });

    await move(job.id, 'paused');
    expect(await reread(job.id)).toMatchObject({ inWorkSince: null });

    await move(job.id, 'in_work');
    const resumed = (await stages(job.id)).at(-1);
    expect(await reread(job.id)).toMatchObject({ inWorkSince: resumed?.at });

    await move(job.id, 'paused', undefined, true);
    expect(await reread(job.id)).toMatchObject({ inWorkSince: null });

    await move(job.id, 'in_work');
    await move(job.id, 'done');
    expect(await reread(job.id)).toMatchObject({
      inWorkSince: null,
      status: 'done',
    });
  });

  it('measures the time in work from the clock, not from the stage entries', async () => {
    const job = await jobIn('to_do');
    await move(job.id, 'in_work');
    await prisma.$executeRaw`
      UPDATE job SET in_work_since = in_work_since - interval '75500 milliseconds'
      WHERE id = ${job.id}::uuid`;

    await move(job.id, 'paused');

    expect(await reread(job.id)).toMatchObject({
      inWorkSince: null,
      workedSeconds: 75,
    });
  });

  it('is left alone by a write that moves nothing', async () => {
    const job = await jobIn('to_do');
    await move(job.id, 'in_work');
    const { inWorkSince } = await reread(job.id);

    await prisma.job.update({
      data: { etaAt: new Date(), odometerKm: 120_000 },
      where: { id: job.id },
    });

    expect(await reread(job.id)).toMatchObject({ inWorkSince });
    expect(inWorkSince).toEqual(expect.any(Date));
  });

  it('is backfilled for a job in work from its latest entry into work, then its start', async () => {
    const statements = backfill();
    expect(statements.length).toBeGreaterThanOrEqual(1);
    const fromEntry = await jobIn('to_do');
    await move(fromEntry.id, 'in_work');
    await inWorkFor(fromEntry.id, 3_600_000);
    const [entry] = await stages(fromEntry.id);
    const started = new Date('2027-12-06T08:07:00Z');
    const fromStart = await jobIn('in_work');
    await prisma.job.update({
      data: { startedAt: started },
      where: { id: fromStart.id },
    });
    const bare = await jobIn('in_work');
    const paused = await jobIn('paused');
    await prisma.$executeRaw`UPDATE job SET in_work_since = NULL`;

    for (const sql of statements) await prisma.$executeRawUnsafe(sql);

    expect(await reread(fromEntry.id)).toMatchObject({ inWorkSince: entry.at });
    expect(await reread(fromStart.id)).toMatchObject({ inWorkSince: started });
    expect((await reread(bare.id)).inWorkSince).toEqual(expect.any(Date));
    expect(await reread(paused.id)).toMatchObject({ inWorkSince: null });
  });
});

const liveOn = (jobId: string) =>
  prisma.liveSession.create({
    data: {
      garageId,
      jobId,
      provider: 'fake',
      providerInputId: randomUUID(),
    },
  });

// @traces 1250-FR-006
describe('moveJob and a live stream', () => {
  it.each([
    ['in_work', 'done'],
    ['to_do', 'cancelled'],
  ] as const)(
    'ends the live stream when a job moves from %s to %s',
    async (from, to) => {
      const job = await jobIn(from);
      const session = await liveOn(job.id);

      await move(job.id, to);

      expect(
        await prisma.liveSession.findUniqueOrThrow({
          where: { id: session.id },
        }),
      ).toMatchObject({
        stoppedAt: expect.any(Date),
        stopReason: 'job_closed',
      });
    },
  );

  it.each([
    ['to_do', 'in_work'],
    ['in_work', 'paused'],
    ['paused', 'in_work'],
  ] as const)(
    'keeps the stream live on a move from %s to %s',
    async (from, to) => {
      const job = await jobIn(from);
      const session = await liveOn(job.id);

      await move(job.id, to);

      expect(
        await prisma.liveSession.findUniqueOrThrow({
          where: { id: session.id },
        }),
      ).toMatchObject({ stoppedAt: null, stopReason: null });
    },
  );

  it('keeps the stream live when the move rolls back', async () => {
    const job = await jobIn('in_work');
    const session = await liveOn(job.id);

    await expect(
      prisma.$transaction(async (tx) => {
        await moveJob(tx, ports, {
          actor: { accountId: owner, role: 'garage' },
          event: {
            audience: {
              driverAccountId: driver,
              garageId,
              mechanicId: null,
              type: 'job',
            },
            kind: 'job.done',
          },
          id: job.id,
          to: 'done',
        });
        throw new Error('the next write failed');
      }),
    ).rejects.toThrow('the next write failed');

    expect(
      await prisma.liveSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({ stoppedAt: null });
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'live.stopped', subjectId: job.id },
      }),
    ).toBe(0);
  });
});
