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

async function jobIn(status: JobStatus) {
  const { booking } = await world.chain(driver, garageId);
  return world.job(booking.id, status);
}

const move = (id: string, to: JobStatus, text?: string) =>
  prisma.$transaction((tx) =>
    moveJob(tx, ports, {
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
      id,
      text,
      to,
    }),
  );

const statuses = Object.values(JobStatus);

// @traces 220-FR-007
// @traces 220-FR-008
describe('moveJob', () => {
  it('holds exactly the moves of the job diagram', () => {
    expect(JOB_MOVES).toEqual({
      cancelled: [],
      done: [],
      in_work: ['paused', 'done'],
      paused: ['in_work'],
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
