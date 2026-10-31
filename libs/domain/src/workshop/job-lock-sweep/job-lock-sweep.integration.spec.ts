import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { Redis } from 'ioredis';

import { JobLockSweepModule } from './job-lock-sweep.module';
import { JobLockSweep } from './job-lock-sweep.service';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const { bearer, provider, send, team, world } = quotesApp([JobLockSweepModule]);
const { prisma } = world;

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const keys = new Redis(redisUrl);
const subscriber = new Redis(redisUrl);
let published: { audience: string[]; event: { kind: string; id: string } }[] =
  [];

beforeAll(async () => {
  await subscriber.subscribe('live:events');
  subscriber.on('message', (_channel, message: string) =>
    published.push(JSON.parse(message)),
  );
});

afterAll(() => {
  subscriber.disconnect();
  keys.disconnect();
});

beforeEach(() => {
  published = [];
});

async function expired() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((m) => m.descriptor.name === 'motorfix_job_lock_outcomes_total');
  return ((found?.dataPoints ?? []).find(
    (p) => p.attributes['action'] === 'expired',
  )?.value ?? 0) as number;
}

async function heldJob() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const job = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'to_do',
    { mechanicId: dinamo.plainMechanic.id },
  );
  const res = await send(
    'post',
    `/garage/jobs/${job.id}/lock`,
    bearer(dinamo.plain, 'mechanic'),
  );
  expect(res.status).toBe(200);
  return { dinamo, job };
}

// The key's own five minute time to live is asserted where the lock is
// taken; here it runs out at once, as it would after five idle minutes.
const runOut = async (jobId: string) => {
  await keys.pexpire(`job:lock:${jobId}`, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
};

const reread = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

// @traces 395-FR-007 395-FR-008 395-FR-010 395-FR-016 395-FR-018
describe('the job lock sweep', () => {
  it('clears the mirror of a lock whose key ran out and publishes it', async () => {
    const { dinamo, job } = await heldJob();
    await runOut(job.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    published = [];
    const before = await expired();

    const cleared = await provider(JobLockSweep).sweep();

    expect(cleared).toBe(1);
    expect(await reread(job.id)).toMatchObject({
      lockHolderId: null,
      lockLastChangeAt: null,
      lockSince: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      published.filter((m) => m.event.kind === 'job.lock_changed'),
    ).toEqual([
      {
        audience: [
          `garage:${dinamo.garage.id}`,
          `mechanic:${dinamo.plainMechanic.id}`,
        ],
        event: expect.objectContaining({
          id: job.id,
          kind: 'job.lock_changed',
        }),
      },
    ]);
    expect((await expired()) - before).toBe(1);
  });

  it('leaves a lock still held alone', async () => {
    const { dinamo, job } = await heldJob();

    expect(await provider(JobLockSweep).sweep()).toBe(0);

    expect((await reread(job.id)).lockHolderId).toBe(dinamo.plain);
  });

  it('writes a held key back onto a mirror that lost it', async () => {
    const { dinamo, job } = await heldJob();
    await prisma.job.update({
      data: { lockHolderId: null, lockLastChangeAt: null, lockSince: null },
      where: { id: job.id },
    });

    await provider(JobLockSweep).sweep();

    expect(await reread(job.id)).toMatchObject({
      lockHolderId: dinamo.plain,
      lockSince: expect.any(Date),
    });
  });

  it('writes no audit entry for an expiry', async () => {
    const { job } = await heldJob();
    await runOut(job.id);

    await provider(JobLockSweep).sweep();

    expect(
      await prisma.activityLog.count({ where: { subjectId: job.id } }),
    ).toBe(0);
  });
});
