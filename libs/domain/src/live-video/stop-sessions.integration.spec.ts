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

const session = (
  jobId: string,
  garageId: string,
  stopped = false,
  extra: { keepRecording?: boolean; startedAt?: Date } = {},
) =>
  prisma.liveSession.create({
    data: {
      garageId,
      jobId,
      provider: 'fake',
      providerInputId: randomUUID(),
      ...extra,
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

const kinds = async (jobId: string) =>
  (
    await prisma.outboxEvent.findMany({
      orderBy: { id: 'asc' },
      where: {
        kind: { in: ['live.stopped', 'media.added'] },
        subjectId: jobId,
      },
    })
  ).map((e) => e.kind);

const media = (jobId: string) =>
  prisma.mediaItem.findMany({ where: { jobId } });

const SECOND = 1000;

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

    expect(count).toHaveLength(1);
    expect(await stopped({ jobId: job.id })).toEqual([
      expect.objectContaining({ id: live.id, stopReason: 'job_closed' }),
    ]);
    expect(await stopped({ jobId: other.id })).toEqual([]);
    const [event] = await events(dinamo.id);
    expect(event).toMatchObject({
      payload: {
        jobId: job.id,
        keep: true,
        liveSessionId: live.id,
        reason: 'job_closed',
      },
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

    expect(count).toHaveLength(2);
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

    expect(count).toEqual([]);
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

// @traces 1251-FR-003 1251-FR-007
describe('stopping a live session with its recording kept or discarded', () => {
  async function liveJob(extra: { keepRecording?: boolean; startedAt?: Date }) {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    const job = await jobAt(dinamo.id, driver);
    const live = await session(job.id, dinamo.id, false, extra);
    const owner = await world.account('Elena Dinu', ['garage']);
    return { dinamo, job, live, owner };
  }

  it('stops one session for its sender and audits the sender', async () => {
    const { dinamo, job, live } = await liveJob({});
    const neighbour = await session(
      (await jobAt(dinamo.id, await world.account('Ion Pop', ['driver']))).id,
      dinamo.id,
    );
    const mihai = await world.account('Mihai Ionescu', ['mechanic']);

    const rows = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { sessionId: live.id }, 'sender', {
        accountId: mihai,
        role: 'mechanic',
      }),
    );

    expect(rows).toEqual([expect.objectContaining({ id: live.id })]);
    expect(await stopped({ jobId: job.id })).toEqual([
      expect.objectContaining({ id: live.id, stopReason: 'sender' }),
    ]);
    expect(
      (
        await prisma.liveSession.findUniqueOrThrow({
          where: { id: neighbour.id },
        })
      ).stoppedAt,
    ).toBeNull();
    expect(
      await prisma.activityLog.findMany({
        where: { field: 'status', subjectId: live.id },
      }),
    ).toEqual([
      expect.objectContaining({
        actorId: mihai,
        actorRole: 'mechanic',
        newValue: 'stopped',
        oldValue: 'live',
      }),
    ]);
  });

  it('registers a kept recording after the stop event and links it to the session', async () => {
    const startedAt = new Date(Date.now() - 754 * SECOND - 300);
    const { job, live, owner } = await liveJob({
      keepRecording: true,
      startedAt,
    });

    const [row] = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { sessionId: live.id }, 'sender', {
        accountId: owner,
        role: 'garage',
      }),
    );

    const [item] = await media(job.id);
    expect(item).toMatchObject({
      kind: 'live',
      providerRef: live.providerInputId,
      seconds: 754,
      senderId: null,
      status: 'visible',
    });
    expect(row).toMatchObject({
      keep: true,
      recordingMediaId: item?.id,
      seconds: 754,
    });
    const after = await prisma.liveSession.findUniqueOrThrow({
      where: { id: live.id },
    });
    expect(after.recordingMediaId).toBe(item?.id);
    expect(item?.sentAt).toEqual(after.stoppedAt);
    expect(await kinds(job.id)).toEqual(['live.stopped', 'media.added']);
  });

  // @traces 1252-FR-003 1252-FR-004
  it('returns who watched and writes nothing about viewers', async () => {
    const { live } = await liveJob({});
    const firstView = new Date(Date.now() - 60 * SECOND);
    await prisma.liveSession.update({
      data: { peakViewers: 2, viewedByDriverAt: firstView },
      where: { id: live.id },
    });

    const [row] = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { sessionId: live.id }, 'job_closed'),
    );

    expect(row).toMatchObject({ peakViewers: 2, viewedByDriverAt: firstView });
    expect(
      await prisma.liveSession.findUniqueOrThrow({ where: { id: live.id } }),
    ).toMatchObject({ peakViewers: 2, viewedByDriverAt: firstView });
    expect(await prisma.liveViewer.count()).toBe(0);
  });

  it('returns no viewers for a session nobody watched', async () => {
    const { live } = await liveJob({});

    const [row] = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { sessionId: live.id }, 'feature_off'),
    );

    expect(row).toMatchObject({ peakViewers: 0, viewedByDriverAt: null });
  });

  it('writes no media for a discarded recording and says so in the event', async () => {
    const { job, live, owner } = await liveJob({ keepRecording: false });

    const [row] = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { sessionId: live.id }, 'sender', {
        accountId: owner,
        role: 'garage',
      }),
    );

    expect(row).toMatchObject({ keep: false, recordingMediaId: null });
    expect(await media(job.id)).toEqual([]);
    expect(await kinds(job.id)).toEqual(['live.stopped']);
    const [event] = await prisma.outboxEvent.findMany({
      where: { kind: 'live.stopped', subjectId: job.id },
    });
    expect(event?.payload).toMatchObject({ keep: false, reason: 'sender' });
    expect(
      (await prisma.liveSession.findUniqueOrThrow({ where: { id: live.id } }))
        .recordingMediaId,
    ).toBeNull();
  });

  it.each([
    ['job_closed', true],
    ['job_closed', false],
    ['feature_off', true],
    ['feature_off', false],
  ] as const)(
    'on a %s stop follows the session keep choice (%s)',
    async (reason, keepRecording) => {
      const { dinamo, job, live } = await liveJob({ keepRecording });
      const scope =
        reason === 'job_closed' ? { jobId: job.id } : { garageId: dinamo.id };

      await prisma.$transaction((tx) =>
        stopLiveSessions(tx, audit, scope, reason),
      );

      expect(await media(job.id)).toHaveLength(keepRecording ? 1 : 0);
      const [event] = await prisma.outboxEvent.findMany({
        where: { kind: 'live.stopped', subjectId: job.id },
      });
      expect(event?.payload).toMatchObject({ keep: keepRecording, reason });
      expect(
        (await prisma.liveSession.findUniqueOrThrow({ where: { id: live.id } }))
          .recordingMediaId,
      ).toBe(keepRecording ? (await media(job.id))[0]?.id : null);
    },
  );

  it('rounds the length down and never below zero', async () => {
    const { job, live, owner } = await liveJob({
      keepRecording: true,
      startedAt: new Date(Date.now() - 400),
    });

    const [row] = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { sessionId: live.id }, 'sender', {
        accountId: owner,
        role: 'garage',
      }),
    );

    expect(row?.seconds).toBe(0);
    expect((await media(job.id))[0]?.seconds).toBe(0);
  });

  it('writes nothing for a session already stopped', async () => {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    const job = await jobAt(dinamo.id, driver);
    const old = await session(job.id, dinamo.id, true);
    const owner = await world.account('Elena Dinu', ['garage']);

    const rows = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { sessionId: old.id }, 'sender', {
        accountId: owner,
        role: 'garage',
      }),
    );

    expect(rows).toEqual([]);
    expect(await media(job.id)).toEqual([]);
    expect(await kinds(job.id)).toEqual([]);
  });
});
