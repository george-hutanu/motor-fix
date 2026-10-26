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
describe('moveJob', () => {
  it('holds exactly the moves of the job diagram', () => {
    expect(JOB_MOVES).toEqual({
      cancelled: [],
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
// Moves the whole history back, so the entries keep their order.
async function inWorkFor(jobId: string, ms: number) {
  await prisma.$executeRaw`
    UPDATE job_stage_entry SET at = at - ${ms} * interval '1 millisecond'
    WHERE job_id = ${jobId}::uuid`;
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
