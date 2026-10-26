import { randomUUID } from 'node:crypto';

import { stopLiveSessions } from './stop-sessions';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { noEvents, outbox } from '../events/event.port';
import { GarageFeaturesService } from '../garages/features/features.service';
import {
  databaseUrl,
  garageActor,
  quotesWorld,
} from '../quotes/quotes.testing';
import { moveJob } from '../workshop/transitions';

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
const session = (jobId: string, garageId: string) =>
  prisma.liveSession.create({
    data: { garageId, jobId, provider: 'fake', providerInputId: randomUUID() },
  });
const open = (where: { jobId?: string; garageId?: string }) =>
  prisma.liveSession.count({ where: { ...where, stoppedAt: null } });
const events = (garageId: string) =>
  prisma.outboxEvent.count({
    where: { audience: { has: `garage:${garageId}` }, kind: 'live.stopped' },
  });

// @traces 1250-live-video-provider-FR-006
describe('stopping live sessions at the edges', () => {
  it('stops nothing and returns 0 for an unknown job', async () => {
    const count = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { jobId: randomUUID() }, 'job_closed'),
    );

    expect(count).toBe(0);
  });

  it('stops nothing and returns 0 for an unknown garage', async () => {
    const count = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { garageId: randomUUID() }, 'feature_off'),
    );

    expect(count).toBe(0);
  });

  it('returns 0 the second time and keeps the first reason', async () => {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    const job = await jobAt(dinamo.id, driver);
    const live = await session(job.id, dinamo.id);

    const first = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { jobId: job.id }, 'job_closed'),
    );
    const second = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { garageId: dinamo.id }, 'feature_off'),
    );

    expect([first, second]).toEqual([1, 0]);
    const row = await prisma.liveSession.findUniqueOrThrow({
      where: { id: live.id },
    });
    expect(row.stopReason).toBe('job_closed');
    expect(await events(dinamo.id)).toBe(1);
  });

  it('rolls the stops back with the transaction that asked for them', async () => {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    const job = await jobAt(dinamo.id, driver);
    await session(job.id, dinamo.id);

    await expect(
      prisma.$transaction(async (tx) => {
        await stopLiveSessions(tx, audit, { jobId: job.id }, 'job_closed');
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');

    expect(await open({ jobId: job.id })).toBe(1);
    expect(await events(dinamo.id)).toBe(0);
  });

  it('stops fifty live sessions of one garage in one call with fifty events', async () => {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 50; i++)
      await session((await jobAt(dinamo.id, driver)).id, dinamo.id);

    const count = await prisma.$transaction((tx) =>
      stopLiveSessions(tx, audit, { garageId: dinamo.id }, 'feature_off'),
    );

    expect(count).toBe(50);
    expect(await open({ garageId: dinamo.id })).toBe(0);
    expect(await events(dinamo.id)).toBe(50);
  }, 60_000);
});

// @traces 1250-live-video-provider-FR-006
describe('what leaves a live session running', () => {
  it('keeps the session when the job only pauses', async () => {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    const owner = await world.account('Owner', ['garage']);
    const job = await jobAt(dinamo.id, driver);
    await session(job.id, dinamo.id);

    await prisma.$transaction((tx) =>
      moveJob(
        tx,
        { audit, events: noEvents },
        {
          actor: { accountId: owner, role: 'garage' },
          event: {
            audience: {
              driverAccountId: driver,
              garageId: dinamo.id,
              mechanicId: null,
              type: 'job',
            },
            kind: 'job.paused',
          },
          id: job.id,
          to: 'paused',
        },
      ),
    );

    expect(await open({ jobId: job.id })).toBe(1);
  });

  it('keeps the other garage’s sessions when one garage switches live media off, and writes nothing on a repeat', async () => {
    const driver = await world.account('Andrei Marin', ['driver']);
    const dinamo = await world.garage('Atelier Dinamo');
    const militari = await world.garage('Service Militari');
    const ownerId = await world.account('Owner', ['garage']);
    await session((await jobAt(dinamo.id, driver)).id, dinamo.id);
    await session((await jobAt(militari.id, driver)).id, militari.id);
    await prisma.garageMember.create({
      data: { accountId: ownerId, garageId: dinamo.id, role: 'owner' },
    });
    const features = new GarageFeaturesService(prisma, audit, outbox);
    const actor = garageActor(ownerId, dinamo.id);

    await features.set(actor, dinamo.id, 'live_media', false);
    await features.set(actor, dinamo.id, 'live_media', false);

    expect(await open({ garageId: dinamo.id })).toBe(0);
    expect(await open({ garageId: militari.id })).toBe(1);
    expect(await events(dinamo.id)).toBe(1);
  });
});
