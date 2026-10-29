import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { stopIdleSessions } from './idle';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';
import { FakeLiveVideo } from '../providers/fake-live-video.provider';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());
beforeEach(() => world.reset());

const MINUTE = 60_000;
const logger = new Logger('LiveIdle');

let provider: FakeLiveVideo;
beforeEach(() => {
  provider = new FakeLiveVideo();
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const deps = () => ({ audit: new AuditService(), logger, prisma, provider });

// Costel live on Andrei's job at Atelier Dinamo since `startedAt`.
async function live(startedAt: Date, keepRecording = true) {
  const driver = await world.account('Andrei Marin', ['driver']);
  const dinamo = await world.garage('Atelier Dinamo');
  const { booking } = await world.chain(driver, dinamo.id);
  const job = await world.job(booking.id, 'in_work');
  const session = await prisma.liveSession.create({
    data: {
      garageId: dinamo.id,
      jobId: job.id,
      keepRecording,
      provider: 'fake',
      providerInputId: randomUUID(),
      startedAt,
    },
  });
  return { driver, garageId: dinamo.id, job, session };
}

const row = (id: string) =>
  prisma.liveSession.findUniqueOrThrow({ where: { id } });

const stoppedEvents = (jobId: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'live.stopped', subjectId: jobId },
  });

// @traces 1251-FR-011
describe('stopping a live session nobody publishes to', () => {
  it('stops a session with no publisher for ten minutes, as the system, keeping its recording', async () => {
    const now = new Date();
    const { garageId, job, session } = await live(
      new Date(now.getTime() - 30 * MINUTE),
    );
    provider.statuses.set(session.providerInputId, {
      connected: false,
      since: new Date(now.getTime() - 10 * MINUTE),
    });

    expect(await stopIdleSessions(deps(), now)).toBe(1);

    const stopped = await row(session.id);
    expect(stopped).toMatchObject({ stopReason: 'idle' });
    expect(stopped.stoppedAt).not.toBeNull();
    expect(stopped.recordingMediaId).not.toBeNull();
    expect(
      await prisma.mediaItem.findUniqueOrThrow({
        where: { id: stopped.recordingMediaId as string },
      }),
    ).toMatchObject({
      kind: 'live',
      providerRef: session.providerInputId,
      status: 'visible',
    });
    expect(await stoppedEvents(job.id)).toEqual([
      expect.objectContaining({
        payload: {
          jobId: job.id,
          keep: true,
          liveSessionId: session.id,
          reason: 'idle',
        },
      }),
    ]);
    expect(
      await prisma.activityLog.findMany({
        where: { subjectId: session.id, subjectType: 'live_session' },
      }),
    ).toEqual([
      expect.objectContaining({
        actorId: null,
        actorName: 'MotorFix',
        actorRole: 'system',
        garageId,
        newValue: 'stopped',
        oldValue: 'live',
      }),
    ]);
  });

  it('leaves a session alone before the tenth minute', async () => {
    const now = new Date();
    const { session } = await live(new Date(now.getTime() - 30 * MINUTE));
    provider.statuses.set(session.providerInputId, {
      connected: false,
      since: new Date(now.getTime() - 9 * MINUTE),
    });

    expect(await stopIdleSessions(deps(), now)).toBe(0);
    expect((await row(session.id)).stoppedAt).toBeNull();
  });

  it('starts the count again when the publisher comes back', async () => {
    const now = new Date();
    const { session } = await live(new Date(now.getTime() - 30 * MINUTE));
    provider.statuses.set(session.providerInputId, {
      connected: false,
      since: new Date(now.getTime() - 25 * MINUTE),
    });
    provider.statuses.set(session.providerInputId, {
      connected: true,
      since: new Date(now.getTime() - 5 * MINUTE),
    });

    expect(await stopIdleSessions(deps(), now)).toBe(0);
    expect((await row(session.id)).stoppedAt).toBeNull();
  });

  it('stops a session never published to ten minutes after its start', async () => {
    const now = new Date();
    const early = await live(new Date(now.getTime() - 9 * MINUTE));
    const late = await live(new Date(now.getTime() - 10 * MINUTE));

    expect(await stopIdleSessions(deps(), now)).toBe(1);
    expect((await row(early.session.id)).stoppedAt).toBeNull();
    expect(await row(late.session.id)).toMatchObject({ stopReason: 'idle' });
  });

  it('discards a recording the sender chose not to keep, leaving its delete to the worker', async () => {
    const now = new Date();
    const { job, session } = await live(
      new Date(now.getTime() - 30 * MINUTE),
      false,
    );

    expect(await stopIdleSessions(deps(), now)).toBe(1);

    expect(await row(session.id)).toMatchObject({
      recordingMediaId: null,
      stopReason: 'idle',
    });
    expect(await prisma.mediaItem.count({ where: { jobId: job.id } })).toBe(0);
    expect(await stoppedEvents(job.id)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ keep: false, reason: 'idle' }),
      }),
    ]);
    expect(provider.deleted).toEqual([]);
  });

  it('skips a session whose state the provider could not tell, and checks the rest', async () => {
    const now = new Date();
    const unknown = await live(new Date(now.getTime() - 30 * MINUTE));
    const idle = await live(new Date(now.getTime() - 30 * MINUTE));
    const read = provider.inputStatus.bind(provider);
    jest.spyOn(provider, 'inputStatus').mockImplementation(async (id) => {
      if (id === unknown.session.providerInputId) throw new Error('timeout');
      return read(id);
    });

    expect(await stopIdleSessions(deps(), now)).toBe(1);
    expect((await row(unknown.session.id)).stoppedAt).toBeNull();
    expect((await row(idle.session.id)).stopReason).toBe('idle');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(unknown.session.id),
    );
  });

  it('leaves the sessions of another provider and the stopped ones alone', async () => {
    const now = new Date();
    const other = await live(new Date(now.getTime() - 30 * MINUTE));
    await prisma.liveSession.update({
      data: { provider: 'cloudflare' },
      where: { id: other.session.id },
    });
    const ended = await live(new Date(now.getTime() - 30 * MINUTE));
    await prisma.liveSession.update({
      data: { stoppedAt: new Date(), stopReason: 'sender' },
      where: { id: ended.session.id },
    });

    expect(await stopIdleSessions(deps(), now)).toBe(0);
    expect((await row(other.session.id)).stoppedAt).toBeNull();
    expect((await row(ended.session.id)).stopReason).toBe('sender');
  });
});
