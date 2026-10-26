import { randomUUID } from 'node:crypto';

import { stopLiveSessions } from './stop-sessions';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, quotesWorld } from '../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());
beforeEach(() => world.reset());

const audit = new AuditService();

async function jobAt(garageId: string, driver: string) {
  const { booking } = await world.chain(driver, garageId);
  return world.job(booking.id, 'in_work');
}

const session = (jobId: string, garageId: string, stopped = false) =>
  prisma.liveSession.create({
    data: {
      garageId,
      jobId,
      provider: 'fake',
      providerInputId: randomUUID(),
      ...(stopped && { stoppedAt: new Date(), stopReason: 'job_closed' }),
    },
  });

const stopped = (where: { jobId?: string; garageId?: string }) =>
  prisma.liveSession.findMany({
    where: { ...where, stoppedAt: { not: null } },
  });

// The reset keeps the outbox and the audit log, so reads stay on this
// test's own garage.
const events = (garageId: string) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { audience: { has: `garage:${garageId}` }, kind: 'live.stopped' },
  });

const entries = (garageId: string) =>
  prisma.activityLog.findMany({
    where: { garageId, subjectType: 'live_session' },
  });

// @traces 1250-FR-006 1250-FR-007
describe('stopping live sessions for the system', () => {
  it('stops the job’s live session with one event and one system audit entry', async () => {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    const job = await jobAt(dinamo.id, driver);
    const other = await jobAt(dinamo.id, driver);
    const live = await session(job.id, dinamo.id);
    await session(other.id, dinamo.id);

    const count = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { jobId: job.id }, 'job_closed'),
    );

    expect(count).toBe(1);
    expect(await stopped({ jobId: job.id })).toEqual([
      expect.objectContaining({ id: live.id, stopReason: 'job_closed' }),
    ]);
    expect(await stopped({ jobId: other.id })).toEqual([]);
    const [event] = await events(dinamo.id);
    expect(event).toMatchObject({
      payload: { jobId: job.id, liveSessionId: live.id, reason: 'job_closed' },
      subjectId: job.id,
    });
    expect(event?.audience).toEqual(
      expect.arrayContaining([`account:${driver}`, `garage:${dinamo.id}`]),
    );
    expect(await entries(dinamo.id)).toEqual([
      expect.objectContaining({
        action: 'update',
        actorId: null,
        actorName: 'MotorFix',
        actorRole: 'system',
        field: 'status',
        garageId: dinamo.id,
        jobId: job.id,
        newValue: 'stopped',
        oldValue: 'live',
        subjectId: live.id,
      }),
    ]);
  });

  it('stops every live session of a garage and leaves the others alone', async () => {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    const militari = await world.garage('Service Militari');
    await session((await jobAt(dinamo.id, driver)).id, dinamo.id);
    await session((await jobAt(dinamo.id, driver)).id, dinamo.id);
    await session((await jobAt(militari.id, driver)).id, militari.id);

    const count = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { garageId: dinamo.id }, 'feature_off'),
    );

    expect(count).toBe(2);
    const done = await stopped({ garageId: dinamo.id });
    expect(done.map((r) => r.stopReason)).toEqual([
      'feature_off',
      'feature_off',
    ]);
    expect(await stopped({ garageId: militari.id })).toEqual([]);
    expect(await events(dinamo.id)).toHaveLength(2);
    expect(await entries(dinamo.id)).toHaveLength(2);
  });

  it('writes nothing when no session is live', async () => {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    const job = await jobAt(dinamo.id, driver);
    const old = await session(job.id, dinamo.id, true);

    const count = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { jobId: job.id }, 'job_closed'),
    );

    expect(count).toBe(0);
    expect(await events(dinamo.id)).toEqual([]);
    expect(await entries(dinamo.id)).toEqual([]);
    expect(
      (await prisma.liveSession.findUniqueOrThrow({ where: { id: old.id } }))
        .stoppedAt,
    ).toEqual(old.stoppedAt);
  });

  it('keeps one live session per job in the database', async () => {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    const job = await jobAt(dinamo.id, driver);
    await session(job.id, dinamo.id);

    await expect(session(job.id, dinamo.id)).rejects.toMatchObject({
      code: 'P2002',
    });
    await expect(session(job.id, dinamo.id, true)).resolves.toBeDefined();
  });
});
